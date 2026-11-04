import { parseEnv } from "./env.js";
import { start } from "./start.js";

const server = await start(parseEnv(process.env));
console.log(`Ingest ${server.port} portunda çalışıyor.`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const lost = await server.shutdown();
  if (lost > 0) console.error(`Kapanışta ${lost} olay yazılamadı.`);
}

process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
