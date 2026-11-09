// Büyük dosyada denemek için gerçekçi ölçüm üretir. Önce `pnpm build`.
// Kullanım: pnpm seed --events 1000000 [--dir .vitalscope-seed] [--days 365]
import { performance } from "node:perf_hooks";
import process from "node:process";
import { parseArgs } from "node:util";
import { openStore } from "../dist/sqlite.js";
import { seedEvents } from "../test/seed.ts";

const { values } = parseArgs({ options: { events: { type: "string", default: "100000" }, dir: { type: "string", default: ".vitalscope-seed" }, days: { type: "string", default: "365" } } });
const count = Number(values.events);
const days = Number(values.days);
if (!Number.isInteger(count) || count <= 0 || !(days > 0)) throw new Error("--events must be a positive integer and --days a positive number");

const store = openStore(values.dir);
const started = performance.now();
let batch = [];
for (const event of seedEvents(count, { days, now: Date.now() })) {
  batch.push(event);
  if (batch.length === 5000) {
    await store.sink.write(batch);
    batch = [];
  }
}
await store.sink.write(batch);
store.close();
process.stdout.write(`Wrote ${count} events to ${values.dir} in ${Math.round((performance.now() - started) / 1000)} s\n`);
