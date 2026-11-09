import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getComparison, getErrorDetail, getErrorList, getMetricDetail, getOptions, getOverview, getReleases, type Filters } from "../src/queries.js";
import { buildReport } from "../src/report.js";
import { openStore, type Store } from "../src/sqlite.js";
import { seedEvents } from "./seed.js";

/**
 * Panel her değişiklikte, en sık 2 sn'de bir bütün sorgularını yeniden çalıştırır. 1 milyon olayda (≈ bir yıllık yoğun
 * kullanım) en yavaş sorgu ≈ 0,3 sn; CI'da daha küçük dosyada ölçülür, bütçe makine farkına pay bırakır.
 */
const EVENTS = 100_000;
const BUDGET_MS = 500;
const NOW = Date.UTC(2026, 10, 6, 12);
const DAY = 86_400_000;

let store: Store;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "vitalscope-budget-"));
  store = openStore(dir);
  const events = [...seedEvents(EVENTS, { days: 365, now: NOW })];
  for (let i = 0; i < events.length; i += 5000) await store.sink.write(events.slice(i, i + 5000));
}, 120_000);

afterAll(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function timed<T>(run: () => T) {
  run();
  const started = performance.now();
  const result = run();
  return { result, ms: performance.now() - started };
}

const all: Filters = { env: "development" };
const views: [string, Filters][] = [
  ["all time", all],
  ["last 30 days", { ...all, since: NOW - 30 * DAY }],
  ["one device", { ...all, device: "mobile" }],
  ["one page", { ...all, page: "/products/[id]" }],
];

describe(`queries on ${EVENTS.toLocaleString("en")} events`, () => {
  it("seeds what the panel shows", () => {
    expect(getOptions(store.db).environments).toEqual(["production", "preview", "development"]);
    expect(getOverview(store.db, all).metrics.every((metric) => metric.count > 1000)).toBe(true);
    expect(getErrorList(store.db, all).errors.length).toBeGreaterThan(10);
  });

  it("lists options within budget", () => {
    expect(timed(() => getOptions(store.db)).ms).toBeLessThan(BUDGET_MS);
  });

  it.each(views)("shows the overview within budget, %s", (_, filters) => {
    expect(timed(() => getOverview(store.db, filters)).ms).toBeLessThan(BUDGET_MS);
  });

  it.each(views)("shows a metric within budget, %s", (_, filters) => {
    expect(timed(() => getMetricDetail(store.db, "LCP", filters)).ms).toBeLessThan(BUDGET_MS);
  });

  it.each(views)("shows errors within budget, %s", (_, filters) => {
    const { result, ms } = timed(() => getErrorList(store.db, filters));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(timed(() => getErrorDetail(store.db, result.errors[0]!.id, filters)).ms).toBeLessThan(BUDGET_MS);
  });

  it.each(views)("compares releases within budget, %s", (_, filters) => {
    const { result, ms } = timed(() => getReleases(store.db, filters));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(timed(() => getComparison(store.db, filters, result[1]!, result[0]!)).ms).toBeLessThan(BUDGET_MS);
  });

  it("prints the report within budget", () => {
    expect(timed(() => buildReport(dir)).ms).toBeLessThan(BUDGET_MS);
  });
});
