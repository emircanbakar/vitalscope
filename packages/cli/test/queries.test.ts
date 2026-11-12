import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { METRIC_NAMES, getRating, type MetricName } from "@vitalscope/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { getMetricDetail, getOptions, getOverview, sortedPercentile, type Filters } from "../src/queries.js";
import { DB_FILE, openStore, type Store } from "../src/sqlite.js";
import type { StoredEvent } from "../src/types.js";

const NOW = Date.UTC(2026, 10, 6, 12);
const MINUTE = 60_000;
const opened: { store: Store; dir: string }[] = [];

afterEach(() => {
  for (const { store, dir } of opened.splice(0)) {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

type Ctx = Partial<StoredEvent["ctx"]>;
const stored = (event: StoredEvent["event"], ctx: Ctx = {}): StoredEvent => ({
  receivedAt: NOW,
  sdk: "0.1.1",
  ctx: { sid: "0123456789abcdef", path: "/", env: "production", device: "desktop", sr: 1, ...ctx },
  event,
});
let nextId = 0;
const lcp = (value: number, ctx: Ctx = {}, ts = NOW, id = `m${nextId++}`) => stored({ t: "vital", ts, name: "LCP", value, rating: "good", id }, ctx);
const view = (ctx: Ctx = {}) => stored({ t: "pageview", ts: NOW }, ctx);

async function dbWith(events: StoredEvent[]) {
  const dir = mkdtempSync(join(tmpdir(), "vitalscope-queries-"));
  const store = openStore(dir);
  opened.push({ store, dir });
  await store.sink.write(events);
  return store.db;
}

const production: Filters = { env: "production" };

describe("sortedPercentile", () => {
  it("uses the nearest rank", () => {
    expect(sortedPercentile([100, 200, 300, 400], 0.75)).toBe(300);
    expect(sortedPercentile([100, 200], 0.5)).toBe(100);
    expect(sortedPercentile([100, 200], 0.75)).toBe(200);
    expect(sortedPercentile([7], 0.95)).toBe(7);
  });
});

describe("repeated metrics", () => {
  it("keeps only the last value, also across batches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vitalscope-queries-"));
    const store = openStore(dir);
    opened.push({ store, dir });
    await store.sink.write([lcp(9000, {}, NOW, "same")]);
    await store.sink.write([lcp(100, {}, NOW + MINUTE, "same"), lcp(500, { sid: "fedcba9876543210" }, NOW, "same")]);
    expect(store.db.prepare("SELECT value, ts FROM vitals ORDER BY value").all()).toEqual([
      { value: 100, ts: NOW + MINUTE },
      { value: 500, ts: NOW },
    ]);
  });

  it("removes repeats written by an earlier version", () => {
    const dir = mkdtempSync(join(tmpdir(), "vitalscope-queries-"));
    const old = new DatabaseSync(join(dir, DB_FILE));
    old.exec(`CREATE TABLE vitals (ts INTEGER NOT NULL, received_at INTEGER NOT NULL, sample_rate REAL NOT NULL, sdk TEXT NOT NULL, path TEXT NOT NULL,
      route TEXT, release TEXT, env TEXT NOT NULL, device TEXT NOT NULL, conn TEXT, nav_type TEXT, session_id TEXT NOT NULL, name TEXT NOT NULL,
      metric_id TEXT NOT NULL, value REAL NOT NULL, rating TEXT NOT NULL, attr_target TEXT, attr_url TEXT, attr_script TEXT, attr_type TEXT, attr TEXT)`);
    const insert = old.prepare("INSERT INTO vitals VALUES (?, 0, 1, '0.1.1', '/', NULL, NULL, 'production', 'desktop', NULL, NULL, 's', 'LCP', 'm', ?, 'good', NULL, NULL, NULL, NULL, NULL)");
    insert.run(NOW, 9000);
    insert.run(NOW, 100);
    old.close();

    const store = openStore(dir);
    opened.push({ store, dir });
    expect(getOverview(store.db, production).metrics[0]).toMatchObject({ count: 1, p75: 100 });
  });
});

describe("getOptions", () => {
  it("lists what was collected, environments in a fixed order", async () => {
    const db = await dbWith([view({ env: "development", device: "mobile" }), view({ path: "/a", route: "/[id]" }), view({ path: "/b" })]);
    expect(getOptions(db)).toEqual({ environments: ["production", "development"], pages: ["/", "/[id]", "/b"], devices: ["desktop", "mobile"] });
  });

  it("is empty without data", async () => {
    expect(getOptions(await dbWith([]))).toEqual({ environments: [], pages: [], devices: [] });
  });
});

describe("getOverview", () => {
  it("summarises each metric with p75 and rating counts", async () => {
    const db = await dbWith([lcp(1000), lcp(2000), lcp(3000), lcp(5000)]);
    const [metric, inp] = getOverview(db, production).metrics;
    expect(metric).toEqual({ name: "LCP", count: 4, p75: 3000, rating: "needs-improvement", counts: { good: 2, needsImprovement: 1, poor: 1 } });
    expect(inp).toEqual({ name: "INP", count: 0, p75: null, rating: null, counts: { good: 0, needsImprovement: 0, poor: 0 } });
  });

  it("never mixes environments", async () => {
    const db = await dbWith([lcp(1000), lcp(9000, { env: "development" }), view(), view({ env: "development" }), view({ env: "development" })]);
    const overview = getOverview(db, production);
    expect(overview.metrics[0]?.p75).toBe(1000);
    expect(overview.pages[0]?.views).toBe(1);
    expect(getOverview(db, { env: "development" }).pages[0]).toMatchObject({ views: 2, p75: { LCP: 9000 } });
  });

  it("counts only the last value of a repeated metric", async () => {
    const db = await dbWith([lcp(9000, {}, NOW, "same"), lcp(100, {}, NOW, "same")]);
    expect(getOverview(db, production).metrics[0]).toMatchObject({ count: 1, p75: 100 });
  });

  it("filters by page, device and time", async () => {
    const db = await dbWith([lcp(100, { path: "/a" }), lcp(200, { path: "/b" }), lcp(300, { device: "mobile" }), lcp(400, { path: "/old" }, NOW - 120 * MINUTE)]);
    expect(getOverview(db, { ...production, page: "/a" }).metrics[0]?.p75).toBe(100);
    expect(getOverview(db, { ...production, device: "mobile" }).metrics[0]?.p75).toBe(300);
    expect(getOverview(db, { ...production, since: NOW - 60 * MINUTE }).pages.map((row) => row.page)).not.toContain("/old");
  });

  it("does not treat filter values as SQL", async () => {
    const db = await dbWith([lcp(100)]);
    expect(getOverview(db, { ...production, page: "' OR 1=1 --" }).metrics[0]?.count).toBe(0);
  });

  it("groups pages by route template and sorts by views", async () => {
    const db = await dbWith([view({ path: "/other" }), view({ path: "/p/1", route: "/p/[id]" }), view({ path: "/p/2", route: "/p/[id]" }), lcp(100, { path: "/p/1", route: "/p/[id]" })]);
    const { pages } = getOverview(db, production);
    expect(pages.map(({ page, views }) => [page, views])).toEqual([["/p/[id]", 2], ["/other", 1]]);
    expect(pages[0]?.p75).toEqual({ LCP: 100 });
  });

  it("scales views by the sample rate", async () => {
    const db = await dbWith([view({ sr: 0.5 })]);
    expect(getOverview(db, production).pages[0]?.views).toBe(2);
  });

  it("finds the same percentiles and counts as sorting in memory", async () => {
    // Index üzerinde sıra atlama ile hesaplanır; eşit değerler, CLS kesirleri ve filtreler sonucu değiştirmemeli.
    let state = 7;
    const random = () => (state = (state * 48_271) % 2_147_483_647) / 2_147_483_647;
    const pages = ["/a", "/b", "/c"];
    const devices = ["desktop", "mobile"] as const;
    const events = Array.from({ length: 600 }, (_, i) => {
      const name = METRIC_NAMES[i % METRIC_NAMES.length]!;
      const value = name === "CLS" ? Math.round(random() * 40) / 100 : Math.round(random() * 60) * 100;
      const ctx = { path: pages[Math.floor(random() * 3)]!, device: devices[Math.floor(random() * 2)]!, sid: `s${i}` };
      return stored({ t: "vital", ts: NOW - Math.floor(random() * 120) * MINUTE, name, value, rating: "good", id: "m" }, ctx);
    });
    const db = await dbWith(events);
    const rows = events.map(({ ctx, event }) => ({ page: ctx.path, device: ctx.device, ...(event as { name: MetricName; value: number; ts: number }) }));

    for (const filters of [production, { ...production, device: "mobile" }, { ...production, since: NOW - 60 * MINUTE }, { ...production, page: "/b" }]) {
      const matching = rows.filter((row) => (!filters.device || row.device === filters.device) && (!filters.since || row.ts >= filters.since) && (!filters.page || row.page === filters.page));
      const p75 = (items: typeof rows) => sortedPercentile(items.map((row) => row.value).toSorted((a, b) => a - b), 0.75);
      const overview = getOverview(db, filters);
      for (const metric of overview.metrics) {
        const items = matching.filter((row) => row.name === metric.name);
        const ratings = items.map((row) => getRating(metric.name, row.value));
        expect(metric).toMatchObject({
          count: items.length,
          p75: p75(items),
          counts: { good: ratings.filter((r) => r === "good").length, needsImprovement: ratings.filter((r) => r === "needs-improvement").length, poor: ratings.filter((r) => r === "poor").length },
        });
        for (const page of overview.pages) {
          const onPage = items.filter((row) => row.page === page.page);
          expect(page.p75[metric.name]).toBe(onPage.length > 0 ? p75(onPage) : undefined);
        }
      }
    }
  });

  it("limits the page list and says how many are hidden", async () => {
    const db = await dbWith(Array.from({ length: 103 }, (_, i) => view({ path: `/${i}` })));
    const overview = getOverview(db, production);
    expect(overview.pages).toHaveLength(100);
    expect(overview.morePages).toBe(3);
  });
});

describe("getMetricDetail", () => {
  it("keeps percentiles apart on sparse data by widening the buckets", async () => {
    // Üç günde 100 ölçüm: 60 kovada kova başına 2 ölçüm düşer ve p75 ile p95 aynı çıkardı.
    const events = Array.from({ length: 100 }, (_, i) => lcp(1000 + i * 37, {}, NOW - i * 43 * MINUTE));
    const { series } = getMetricDetail(await dbWith(events), "LCP", production);
    expect(series.x.length).toBeLessThanOrEqual(21);
    expect(series.p75.some((value, i) => value !== series.p95[i])).toBe(true);
  });

  it("returns sorted, aligned series", async () => {
    const events = Array.from({ length: 300 }, (_, i) => lcp(1000 + i, {}, NOW - i * MINUTE));
    const { series } = getMetricDetail(await dbWith(events), "LCP", production);
    expect(series.x).toEqual(series.x.toSorted((a, b) => a - b));
    expect(series.x.length).toBeGreaterThan(5);
    expect(series.x.length).toBeLessThanOrEqual(61);
    expect(series.p50).toHaveLength(series.x.length);
    series.x.forEach((_, i) => {
      expect(series.p50[i]!).toBeLessThanOrEqual(series.p75[i]!);
      expect(series.p75[i]!).toBeLessThanOrEqual(series.p95[i]!);
    });
  });

  it("uses a single bucket for a single measurement", async () => {
    const { series } = getMetricDetail(await dbWith([lcp(500)]), "LCP", production);
    expect(series.x).toHaveLength(1);
    expect(series.p95).toEqual([500]);
  });

  it("keeps thresholds on bin edges, for every metric", async () => {
    const db = await dbWith([]);
    for (const [name, { good, poor }] of [["LCP", { good: 2500, poor: 4000 }], ["INP", { good: 200, poor: 500 }], ["CLS", { good: 0.1, poor: 0.25 }], ["FCP", { good: 1800, poor: 3000 }], ["TTFB", { good: 800, poor: 1800 }]] as const) {
      const edges = getMetricDetail(db, name, production).histogram.bins.flatMap((bin) => [bin.start, bin.end]);
      expect(edges).toContain(good);
      expect(edges).toContain(poor);
    }
  });

  it("puts a value equal to a threshold on the same side as its rating", async () => {
    const { histogram, summary } = getMetricDetail(await dbWith([lcp(2500), lcp(0)]), "LCP", production);
    expect(summary.counts.good).toBe(2);
    expect(histogram.bins.find((bin) => bin.end === 2500)?.count).toBe(1);
    expect(histogram.bins.find((bin) => bin.start === 2500)?.count).toBe(0);
    expect(histogram.bins[0]?.count).toBe(1);
  });

  it("reports values off the chart instead of hiding them", async () => {
    const { histogram, summary } = getMetricDetail(await dbWith([lcp(100), lcp(90_000)]), "LCP", production);
    expect(histogram.bins).toHaveLength(40);
    expect(histogram.above).toBe(1);
    expect(histogram.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(1);
    expect(summary.count).toBe(2);
    expect(histogram.percentiles?.p95).toBe(90_000);
  });

  it("has an empty histogram without data", async () => {
    const { histogram, series, summary } = getMetricDetail(await dbWith([]), "LCP", production);
    expect(summary.count).toBe(0);
    expect(series.x).toEqual([]);
    expect(histogram.percentiles).toBeNull();
    expect(histogram.bins.length).toBeGreaterThan(0);
  });

  it("breaks down by page and device, largest first", async () => {
    const { pages, devices } = getMetricDetail(
      await dbWith([lcp(100, { path: "/a" }), lcp(200, { path: "/a" }), lcp(5000, { path: "/b", device: "mobile" })]),
      "LCP",
      production,
    );
    expect(pages).toEqual([
      { key: "/a", count: 2, p75: 200, rating: "good" },
      { key: "/b", count: 1, p75: 5000, rating: "poor" },
    ]);
    expect(devices.map((row) => row.key)).toEqual(["desktop", "mobile"]);
  });
});

describe("slowest interactions", () => {
  type Attr = Extract<StoredEvent["event"], { t: "vital" }>["attr"];
  const inp = (value: number, attr?: Attr, ctx: Ctx = {}, ts = NOW) =>
    stored({ t: "vital", ts, name: "INP", value, rating: getRating("INP", value), id: `m${nextId++}`, ...(attr && { attr }) }, ctx);

  it("lists each page view's slowest interaction, including those INP skipped", async () => {
    const db = await dbWith([
      inp(120, { target: "button#buy", type: "pointer", event: "click", inputDelay: 5, processing: 80, presentation: 35, slowest: { duration: 500, target: "div#canvas", type: "keyboard", event: "keydown", inputDelay: 1, processing: 30, presentation: 469, script: "https://a.test/app.js" } }, { path: "/draw", release: "v2" }, NOW - MINUTE),
      inp(300, { target: "button#buy", type: "pointer", event: "pointerup", inputDelay: 2, processing: 250, presentation: 48 }, { path: "/shop" }),
      inp(80),
      lcp(4000),
    ]);
    const { interactions } = getMetricDetail(db, "INP", production);
    expect(interactions).toEqual([
      { duration: 500, inInp: false, page: "/draw", ts: NOW - MINUTE, release: "v2", target: "div#canvas", type: "keyboard", event: "keydown", inputDelay: 1, processing: 30, presentation: 469 },
      { duration: 300, inInp: true, page: "/shop", ts: NOW, release: null, target: "button#buy", type: "pointer", event: "pointerup", inputDelay: 2, processing: 250, presentation: 48 },
      { duration: 80, inInp: true, page: "/", ts: NOW, release: null },
    ]);
  });

  it("follows the filters and keeps the 20 slowest", async () => {
    const db = await dbWith([...Array.from({ length: 25 }, (_, i) => inp(100 + i, undefined, { path: "/a" })), inp(900, undefined, { path: "/b" })]);
    const all = getMetricDetail(db, "INP", production).interactions!;
    expect(all).toHaveLength(20);
    expect(all.map((row) => row.duration).slice(0, 3)).toEqual([900, 124, 123]);
    expect(getMetricDetail(db, "INP", { ...production, page: "/b" }).interactions!.map((row) => row.duration)).toEqual([900]);
  });

  it("is only part of INP", async () => {
    expect(getMetricDetail(await dbWith([lcp(100)]), "LCP", production)).not.toHaveProperty("interactions");
  });
});
