import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createEventBuffer } from "../src/buffer.js";
import { createLive } from "../src/live.js";
import { getComparison, getErrorDetail, getErrorGroups, getErrorList, getOptions, getReleases, type ErrorDetail, type ErrorList, type Filters } from "../src/queries.js";
import { openStore, type Store } from "../src/sqlite.js";
import type { StoredEvent } from "../src/types.js";
import { fakeSink } from "./helpers.js";

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
const FRAME = "at load (http://localhost:5173/src/a.js:1:1)";
const error = (msg: string, ctx: Ctx = {}, ts = NOW, stack: string[] = [FRAME], handled = false) => stored({ t: "error", ts, type: "Error", msg, stack, handled }, ctx);
let nextId = 0;
const lcp = (value: number, ctx: Ctx = {}) => stored({ t: "vital", ts: NOW, name: "LCP", value, rating: "good", id: `m${nextId++}` }, ctx);
const view = (ctx: Ctx = {}) => stored({ t: "pageview", ts: NOW }, ctx);

async function dbWith(events: StoredEvent[]) {
  const dir = mkdtempSync(join(tmpdir(), "vitalscope-errors-"));
  const store = openStore(dir);
  opened.push({ store, dir });
  await store.sink.write(events);
  return store.db;
}

const production: Filters = { env: "production" };

describe("getErrorGroups", () => {
  it("groups the same error and keeps its latest message", async () => {
    const db = await dbWith([error("User 1 not found", {}, NOW - 2000), error("User 2 not found", {}, NOW), error("User 3 not found", {}, NOW - 1000)]);
    const [group, ...rest] = getErrorGroups(db, production);
    expect(rest).toEqual([]);
    expect(group).toMatchObject({ type: "Error", message: "User 2 not found", location: "load (/src/a.js)", count: 3, firstSeen: NOW - 2000, lastSeen: NOW });
    expect(group?.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("gives an error the same id everywhere", async () => {
    const db = await dbWith([error("User 1 not found"), error("Other")]);
    const other = await dbWith([error("User 99 not found")]);
    const id = getErrorGroups(other, production)[0]?.id;
    expect(getErrorGroups(db, production).map((group) => group.id)).toContain(id);
  });

  it("sorts by count, then by the latest", async () => {
    const db = await dbWith([error("old", {}, NOW - 5000), error("new", {}, NOW), error("often"), error("often")]);
    expect(getErrorGroups(db, production).map((group) => group.message)).toEqual(["often", "new", "old"]);
  });

  it("scales by the sample rate and applies filters", async () => {
    const db = await dbWith([error("a", { sr: 0.5 }), error("b", { env: "development" }), error("c", { device: "mobile" }), error("d", { path: "/x" }), error("e", {}, NOW - 120 * MINUTE)]);
    expect(getErrorGroups(db, production).find((group) => group.message === "a")?.count).toBe(2);
    expect(getErrorGroups(db, production).map((group) => group.message)).not.toContain("b");
    expect(getErrorGroups(db, { ...production, device: "mobile" }).map((group) => group.message)).toEqual(["c"]);
    expect(getErrorGroups(db, { ...production, page: "/x" }).map((group) => group.message)).toEqual(["d"]);
    expect(getErrorGroups(db, { ...production, since: NOW - 60 * MINUTE }).map((group) => group.message)).not.toContain("e");
    expect(getErrorGroups(db, {}).length).toBe(5);
  });
});

describe("getErrorList", () => {
  it("limits the list and says how many are hidden", async () => {
    const db = await dbWith(Array.from({ length: 103 }, (_, i) => error(`e${"x".repeat(i)}`)));
    const list = getErrorList(db, production);
    expect(list.errors).toHaveLength(100);
    expect(list.moreErrors).toBe(3);
  });
});

describe("getErrorDetail", () => {
  const idOf = async (db: Awaited<ReturnType<typeof dbWith>>) => getErrorGroups(db, production)[0]!.id;

  it("returns the latest stack and how the error was reported", async () => {
    const db = await dbWith([error("x", {}, NOW - 1000, ["at load (http://localhost:1/src/a.js:1:1)", "at old"], false), error("x", {}, NOW, ["at load (http://localhost:9/src/a.js:7:7)", "at new"], true)]);
    expect(getErrorDetail(db, await idOf(db), production)).toMatchObject({ stack: ["at load (http://localhost:9/src/a.js:7:7)", "at new"], handled: true, count: 2 });
  });

  it("breaks down by page, device and release, largest first", async () => {
    const db = await dbWith([error("x", { path: "/a", release: "v1" }), error("x", { path: "/a", device: "mobile" }), error("x", { path: "/b", release: "v1" })]);
    const detail = getErrorDetail(db, await idOf(db), production)!;
    expect(detail.pages).toEqual([{ key: "/a", count: 2 }, { key: "/b", count: 1 }]);
    expect(detail.devices).toEqual([{ key: "desktop", count: 2 }, { key: "mobile", count: 1 }]);
    expect(detail.releases).toEqual([{ key: "v1", count: 2 }, { key: "", count: 1 }]);
  });

  it("fills quiet time with zeros", async () => {
    const db = await dbWith([error("x", {}, NOW), error("x", {}, NOW), error("x", {}, NOW + 3 * MINUTE)]);
    const { series } = getErrorDetail(db, await idOf(db), production)!;
    expect(series.counts).toEqual([2, 0, 0, 1]);
    expect(series.x[1]! - series.x[0]!).toBe(MINUTE);
  });

  it("keeps the series short over a long time", async () => {
    const db = await dbWith([error("x", {}, NOW - 25 * 86_400_000), error("x", {}, NOW)]);
    const { series } = getErrorDetail(db, await idOf(db), production)!;
    expect(series.x.length).toBeLessThanOrEqual(61);
    expect(series.counts.reduce((sum, value) => sum + value, 0)).toBe(2);
  });

  it("is null for an unknown error or one outside the filters", async () => {
    const db = await dbWith([error("x")]);
    expect(getErrorDetail(db, "0000000000000000", production)).toBeNull();
    expect(getErrorDetail(db, await idOf(db), { env: "development" })).toBeNull();
  });
});

describe("getOptions", () => {
  it("includes data that only has errors", async () => {
    const db = await dbWith([error("x", { env: "preview", path: "/only", device: "tablet" })]);
    expect(getOptions(db)).toEqual({ environments: ["preview"], pages: ["/only"], devices: ["tablet"] });
  });
});

describe("getReleases", () => {
  it("lists releases from every table, latest first", async () => {
    const db = await dbWith([view({ release: "old" }), stored({ t: "error", ts: NOW + 1000, type: "E", msg: "m", stack: [], handled: false }, { release: "newest" }), stored({ t: "vital", ts: NOW + 500, name: "LCP", value: 1, rating: "good", id: "x" }, { release: "middle" }), view()]);
    expect(getReleases(db, production)).toEqual(["newest", "middle", "old"]);
  });

  it("respects filters", async () => {
    const db = await dbWith([view({ release: "a" }), view({ release: "b", env: "development" })]);
    expect(getReleases(db, production)).toEqual(["a"]);
  });
});

describe("getComparison", () => {
  it("compares p75 per metric and keeps releases apart", async () => {
    const db = await dbWith([lcp(1000, { release: "a" }), lcp(2000, { release: "a" }), lcp(5000, { release: "b" }), lcp(9999, { release: "other" }), view({ release: "a" }), view({ release: "a" }), view({ release: "b" })]);
    const comparison = getComparison(db, production, "a", "b");
    expect(comparison.metrics[0]).toEqual({
      name: "LCP",
      a: { count: 2, p75: 2000, rating: "good" },
      b: { count: 1, p75: 5000, rating: "poor" },
    });
    expect(comparison.metrics[1]).toEqual({ name: "INP", a: { count: 0, p75: null, rating: null }, b: { count: 0, p75: null, rating: null } });
    expect(comparison.views).toEqual({ a: 2, b: 1 });
  });

  it("matches errors between releases and shows what appeared or went away", async () => {
    const db = await dbWith([error("shared 1", { release: "a" }), error("shared 2", { release: "b" }), error("shared 3", { release: "b" }), error("gone", { release: "a" }), error("new", { release: "b" }), error("new", { release: "b" }), error("new", { release: "b" })]);
    const { errors } = getComparison(db, production, "a", "b");
    expect(errors.map(({ message, a, b }) => [message, a, b])).toEqual([
      ["new", 0, 3],
      ["shared 3", 1, 2],
      ["gone", 1, 0],
    ]);
  });

  it("applies the other filters to both sides", async () => {
    const db = await dbWith([lcp(100, { release: "a" }), lcp(9000, { release: "a", device: "mobile" }), lcp(200, { release: "b" })]);
    expect(getComparison(db, { ...production, device: "desktop" }, "a", "b").metrics[0]?.a.p75).toBe(100);
  });

  it("limits the error list", async () => {
    const db = await dbWith(Array.from({ length: 101 }, (_, i) => error(`e${"x".repeat(i)}`, { release: "b" })));
    const comparison = getComparison(db, production, "a", "b");
    expect(comparison.errors).toHaveLength(100);
    expect(comparison.moreErrors).toBe(1);
  });
});

describe("routes", () => {
  async function setup(events: StoredEvent[]) {
    const db = await dbWith(events);
    const app = createApp({ buffer: createEventBuffer(fakeSink().sink), now: () => NOW, panel: { db, assets: new Map(), live: createLive() } });
    return (url: string, headers: Record<string, string> = {}) => app.request(url, { headers: { Host: "localhost:8787", ...headers } });
  }

  it("lists errors and opens one", async () => {
    const get = await setup([error("boom")]);
    const list = (await (await get("/api/errors?env=production")).json()) as ErrorList;
    expect(list.errors[0]?.message).toBe("boom");
    const detail = (await (await get(`/api/errors/${list.errors[0]!.id}?env=production`)).json()) as ErrorDetail;
    expect(detail.stack).toEqual([FRAME]);
  });

  it("answers null for an error outside the filters", async () => {
    const res = await (await setup([]))("/api/errors/0000000000000000?env=production");
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it.each(["/api/errors/nope?env=production", "/api/errors/..%2f..%2fetc?env=production", "/api/errors/ABCDEF0123456789?env=production"])("does not know %s", async (url) => {
    expect((await (await setup([]))(url)).status).toBe(404);
  });

  it.each(["/api/errors", "/api/errors/0000000000000000", "/api/releases", "/api/compare?env=production", "/api/compare?env=production&a=x", "/api/compare?a=x&b=y"])("rejects %s", async (url) => {
    expect((await (await setup([]))(url)).status).toBe(400);
  });

  it("lists releases and compares two", async () => {
    const get = await setup([view({ release: "a" }), view({ release: "b" })]);
    expect((await get("/api/releases?env=production")).status).toBe(200);
    const res = await get("/api/compare?env=production&a=a&b=b");
    expect(await res.json()).toMatchObject({ views: { a: 1, b: 1 } });
  });

  it.each(["/api/errors?env=production", "/api/releases?env=production", "/api/compare?env=production&a=a&b=b"])("refuses other sites on %s", async (url) => {
    expect((await (await setup([]))(url, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
  });
});
