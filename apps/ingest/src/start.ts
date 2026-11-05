import { createApp } from "./app.js";
import { createEventBuffer } from "./buffer.js";
import type { Env } from "./env.js";
import { startServer, type RunningServer } from "./server.js";
import { openStore } from "./sqlite.js";
import type { EventSink } from "./types.js";

/** Sadece bu makineden ulaşılır; ağdaki başka cihazlar ölçümleri göremez, veri gönderemez. */
const HOSTNAME = "127.0.0.1";

/** Yazma hataları yeniden denenir; görünür olmalarının tek yolu bu. */
function logFailures(sink: EventSink): EventSink {
  return {
    write: (events) =>
      sink.write(events).catch((error: unknown) => {
        console.error(`SQLite yazması başarısız (${events.length} olay): ${error instanceof Error ? error.message : "bilinmeyen hata"}`);
        throw error;
      }),
  };
}

/** Depoyu ve servisi kurar; `shutdown` tamponu boşaltıp veritabanını da kapatır. */
export async function start(env: Env): Promise<RunningServer> {
  const store = openStore(env.VITALSCOPE_DIR);
  const buffer = createEventBuffer(logFailures(store.sink));
  const server = await startServer(createApp({ buffer }), buffer, { port: env.PORT, hostname: HOSTNAME });

  let closing: Promise<number> | undefined;
  return {
    port: server.port,
    shutdown: () =>
      (closing ??= server.shutdown().then((lost) => {
        store.close();
        return lost;
      })),
  };
}
