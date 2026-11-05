import { createApp } from "./app.js";
import { createEventBuffer } from "./buffer.js";
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
        console.error(`Could not write ${events.length} events: ${error instanceof Error ? error.message : "unknown error"}`);
        throw error;
      }),
  };
}

/** Depoyu ve servisi kurar; `shutdown` tamponu boşaltıp veritabanını da kapatır. */
export async function start({ port, dir }: { port: number; dir: string }): Promise<RunningServer> {
  const store = openStore(dir);
  const buffer = createEventBuffer(logFailures(store.sink));
  let server: RunningServer;
  try {
    server = await startServer(createApp({ buffer }), buffer, { port, hostname: HOSTNAME });
  } catch (error) {
    store.close();
    throw error;
  }

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
