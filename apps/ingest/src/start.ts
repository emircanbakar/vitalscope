import { ClickHouseLogLevel, createClient } from "@clickhouse/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { createApp } from "./app.js";
import { createEventBuffer } from "./buffer.js";
import { createClickHouseSink } from "./clickhouse.js";
import type { Env } from "./env.js";
import { cacheKeys } from "./key-cache.js";
import { createKeyResolver } from "./postgres.js";
import { startServer, type RunningServer } from "./server.js";
import type { EventSink } from "./types.js";

/** Yazma hataları yeniden denenir; `/metrics` gelene kadar görünür olmalarının tek yolu bu. */
function logFailures(sink: EventSink): EventSink {
  return {
    write: (events) =>
      sink.write(events).catch((error: unknown) => {
        console.error(`ClickHouse yazması başarısız (${events.length} olay): ${error instanceof Error ? error.message : "bilinmeyen hata"}`);
        throw error;
      }),
  };
}

/** Bağlantıları ve servisi kurar; `shutdown` tamponu boşaltıp bağlantıları da kapatır. */
export async function start(env: Env): Promise<RunningServer> {
  const clickhouse = createClient({
    url: env.CLICKHOUSE_URL,
    username: env.CLICKHOUSE_WRITE_USER,
    password: env.CLICKHOUSE_WRITE_PASSWORD,
    database: "vitalscope",
    // Hatalar `logFailures` ile tek satır yazılır.
    log: { level: ClickHouseLogLevel.OFF },
  });
  const postgres = drizzle(env.DATABASE_URL);
  // Bağlantısı kopan boştaki istemci hatası yakalanmazsa süreci düşürür; sıradaki sorgu yenisini açar.
  postgres.$client.on("error", (error) => console.error(`Postgres bağlantı hatası: ${error.message}`));

  const buffer = createEventBuffer(logFailures(createClickHouseSink(clickhouse)));
  const app = createApp({
    resolveKey: cacheKeys(createKeyResolver(postgres)),
    buffer,
    isReady: async () => {
      // `ping` kimlik doğrulamaz; yanlış şifreyi de yakalamak için gerçek sorgu.
      const result = await clickhouse.query({ query: "SELECT 1" });
      await result.text();
      await postgres.execute(sql`SELECT 1`);
      return true;
    },
  });

  const server = await startServer(app, buffer, { port: env.PORT });
  return {
    port: server.port,
    shutdown: async () => {
      const lost = await server.shutdown();
      await Promise.allSettled([clickhouse.close(), postgres.$client.end()]);
      return lost;
    },
  };
}
