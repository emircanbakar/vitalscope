import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createEventBuffer } from "../src/buffer.js";
import { createLive } from "../src/live.js";
import { loadPanelAssets, type PanelAssets } from "../src/panel.js";
import type { MetricDetail, Overview } from "../src/queries.js";
import { openStore, type Store } from "../src/sqlite.js";
import { fakeSink } from "./helpers.js";

const HOST = "localhost:8787";
const NOW = 1_800_000_000_000;
const opened: { store: Store; dir: string }[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const { store, dir } of opened.splice(0)) {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const asset = (text: string, type: string) => ({ body: new TextEncoder().encode(text), type });
const ASSETS: PanelAssets = new Map([
  ["/index.html", asset("<!doctype html>panel", "text/html; charset=utf-8")],
  ["/assets/app-abc.js", asset("console.log(1)", "text/javascript; charset=utf-8")],
]);

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "vitalscope-panel-"));
  const store = openStore(dir);
  opened.push({ store, dir });
  const ctx = { sid: "0123456789abcdef", path: "/", env: "production", device: "desktop", sr: 1 } as const;
  await store.sink.write([
    { receivedAt: NOW, sdk: "0.1.1", ctx, event: { t: "vital", ts: NOW, name: "LCP", value: 1000, rating: "good", id: "a" } },
    { receivedAt: NOW, sdk: "0.1.1", ctx, event: { t: "vital", ts: NOW - 7_200_000, name: "LCP", value: 9000, rating: "poor", id: "b" } },
    { receivedAt: NOW, sdk: "0.1.1", ctx, event: { t: "pageview", ts: NOW } },
  ]);
  const app = createApp({ buffer: createEventBuffer(fakeSink().sink), now: () => NOW, panel: { db: store.db, assets: ASSETS, live: createLive() } });
  return (url: string, headers: Record<string, string> = {}) => app.request(url, { headers: { Host: HOST, ...headers } });
}

describe("read API", () => {
  it("returns filter options", async () => {
    const res = await (await setup())("/api/options");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ environments: ["production"], pages: ["/"], devices: ["desktop"] });
  });

  it("returns the overview for one environment", async () => {
    const get = await setup();
    const body = (await (await get("/api/overview?env=production")).json()) as Overview;
    expect(body.metrics[0]).toMatchObject({ name: "LCP", count: 2 });
    const empty = (await (await get("/api/overview?env=development")).json()) as Overview;
    expect(empty.metrics[0]?.count).toBe(0);
  });

  it("applies the time range from the current time", async () => {
    const body = (await (await (await setup())("/api/overview?env=production&range=1h")).json()) as Overview;
    expect(body.metrics[0]).toMatchObject({ count: 1, p75: 1000 });
  });

  it("returns a metric's detail", async () => {
    const body = (await (await (await setup())("/api/metrics/LCP?env=production&device=desktop&page=/")).json()) as MetricDetail;
    expect(body.summary.count).toBe(2);
    expect(body.devices[0]?.key).toBe("desktop");
  });

  it.each(["/api/overview", "/api/overview?env=nope", "/api/overview?env=production&range=__proto__", "/api/overview?env=production&range=1y", "/api/metrics/LCP"])("rejects %s", async (url) => {
    expect((await (await setup())(url)).status).toBe(400);
  });

  it("does not know other metrics", async () => {
    const get = await setup();
    expect((await get("/api/metrics/NOPE?env=production")).status).toBe(404);
    expect((await get("/api/metrics/__proto__?env=production")).status).toBe(404);
  });

  it("is never cached and never allows other origins", async () => {
    const res = await (await setup())("/api/options", { Origin: "https://evil.example" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it.each(["cross-site", "same-site"])("refuses %s requests from browsers", async (site) => {
    const res = await (await setup())("/api/options", { "Sec-Fetch-Site": site });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("");
  });

  it.each(["same-origin", "none"])("serves %s requests", async (site) => {
    expect((await (await setup())("/api/options", { "Sec-Fetch-Site": site })).status).toBe(200);
  });

  it("refuses a rebound host name", async () => {
    expect((await (await setup())("/api/options", { Host: "evil.example" })).status).toBe(403);
    expect((await (await setup())("/", { Host: "evil.example" })).status).toBe(403);
  });
});

describe("panel files", () => {
  it("serves the page with a strict policy, revalidated on every visit", async () => {
    const res = await (await setup())("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("panel");
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    const policy = res.headers.get("Content-Security-Policy")!;
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("unsafe");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("serves hashed files for a long time", async () => {
    const res = await (await setup())("/assets/app-abc.js");
    expect(await res.text()).toBe("console.log(1)");
    expect(res.headers.get("Cache-Control")).toContain("immutable");
  });

  it.each(["/index.html", "/assets/nope.js", "/assets/../index.html", "/assets/..%2f..%2fpackage.json", "/package.json", "/.vitalscope/vitalscope.db"])("does not serve %s", async (url) => {
    expect((await (await setup())(url)).status).toBe(404);
  });

  it("leaves the collector alone when there is no panel", async () => {
    const app = createApp({ buffer: createEventBuffer(fakeSink().sink) });
    expect((await app.request("/", { headers: { Host: HOST } })).status).toBe(404);
    expect((await app.request("/api/options", { headers: { Host: HOST } })).status).toBe(404);
    expect((await app.request("/healthz", { headers: { Host: HOST } })).status).toBe(204);
  });
});

describe("loadPanelAssets", () => {
  it("reads known file types into a table, with web paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "vitalscope-assets-"));
    dirs.push(dir);
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "x");
    writeFileSync(join(dir, "assets", "a.js"), "y");
    writeFileSync(join(dir, "assets", "b.css"), "z");
    writeFileSync(join(dir, "secret.db"), "no");
    const assets = loadPanelAssets(dir);
    expect([...assets.keys()].sort()).toEqual(["/assets/a.js", "/assets/b.css", "/index.html"]);
    expect(assets.get("/assets/a.js")?.type).toContain("javascript");
  });

  it("works with a trailing separator, as the CLI passes it", () => {
    const dir = mkdtempSync(join(tmpdir(), "vitalscope-assets-"));
    dirs.push(dir);
    writeFileSync(join(dir, "index.html"), "x");
    expect([...loadPanelAssets(join(dir, "/")).keys()]).toEqual(["/index.html"]);
  });

  it("is empty when the panel was not built", () => {
    expect(loadPanelAssets(join(tmpdir(), "vitalscope-does-not-exist")).size).toBe(0);
  });
});
