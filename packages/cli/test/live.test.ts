import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createEventBuffer } from "../src/buffer.js";
import { createLive } from "../src/live.js";
import { startServer } from "../src/server.js";
import { start } from "../src/start.js";
import { openStore, type Store } from "../src/sqlite.js";
import { fakeSink } from "./helpers.js";

const decoder = new TextDecoder();
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "vitalscope-live-"));
  dirs.push(dir);
  return dir;
}

const read = async (reader: ReadableStreamDefaultReader<Uint8Array>) => decoder.decode((await reader.read()).value);

describe("createLive", () => {
  it("announces each write to every open stream, without any data", async () => {
    const live = createLive();
    const readers = [live.stream(), live.stream()].map((res) => res.body!.getReader());
    expect(live.connections).toBe(2);
    for (const reader of readers) expect(await read(reader)).toBe(": connected\n\n");
    live.notify();
    for (const reader of readers) expect(await read(reader)).toBe("event: change\ndata: \n\n");
    live.close();
  });

  it("is an event stream", () => {
    const live = createLive();
    expect(live.stream().headers.get("Content-Type")).toContain("text/event-stream");
    live.close();
  });

  it("forgets a stream when its reader goes away", async () => {
    const live = createLive();
    const reader = live.stream().body!.getReader();
    await reader.cancel();
    expect(live.connections).toBe(0);
    live.notify();
  });

  it("ends open streams on close", async () => {
    const live = createLive();
    const reader = live.stream().body!.getReader();
    await read(reader);
    live.close();
    expect((await reader.read()).done).toBe(true);
    expect(live.connections).toBe(0);
    live.notify();
  });
});

describe("/api/live", () => {
  const stores: Store[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
  });

  function setup() {
    const store = openStore(tempDir());
    stores.push(store);
    const buffer = createEventBuffer(fakeSink().sink);
    const live = createLive();
    return { app: createApp({ buffer, panel: { db: store.db, assets: new Map(), live } }), buffer, live };
  }

  it("refuses other sites and rebound hosts like the rest of the API", async () => {
    const { app, live } = setup();
    const request = (headers: Record<string, string>) => app.request("/api/live", { headers: { Host: "localhost:8787", ...headers } });
    expect((await request({ "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
    expect((await request({ Host: "evil.example" })).status).toBe(403);
    expect(live.connections).toBe(0);
  });

  it("allows no other origins and is never cached", async () => {
    const { app, live } = setup();
    const res = await app.request("/api/live", { headers: { Host: "localhost:8787", "Sec-Fetch-Site": "same-origin", Origin: "https://evil.example" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    live.close();
  });

  it("forgets a client that disconnects from a real server", async () => {
    const { app, buffer, live } = setup();
    const server = await startServer(app, buffer, { port: 0, hostname: "127.0.0.1" });
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${server.port}/api/live`, { signal: controller.signal });
    const reader = res.body!.getReader();
    await read(reader);
    expect(live.connections).toBe(1);
    controller.abort();
    await expect.poll(() => live.connections).toBe(0);
    await server.shutdown();
  });
});

describe("start", () => {
  it("announces data once it is written, and shuts down at once with a panel open", async () => {
    const server = await start({ port: 0, dir: tempDir() });
    const base = `http://127.0.0.1:${server.port}`;
    const res = await fetch(`${base}/api/live`);
    const reader = res.body!.getReader();
    await read(reader);

    const batch = { v: 1, k: "pk_3f9a0c1d2e4b5a6978c0d1e2", sdk: "0.1.1", ctx: { sid: "0123456789abcdef", path: "/", device: "desktop" }, e: [{ t: "pageview", ts: Date.now() }] };
    await fetch(`${base}/v1/e`, { method: "POST", body: JSON.stringify(batch), headers: { "Content-Type": "text/plain", Origin: "http://localhost:3000" } });
    expect(await read(reader)).toContain("event: change");
    const options = (await (await fetch(`${base}/api/options`)).json()) as { pages: string[] };
    expect(options.pages).toEqual(["/"]);

    const started = performance.now();
    await server.shutdown();
    // Bağlantıyı kapatmasaydık zorla kapatma süresi olan 2 sn beklerdi.
    expect(performance.now() - started).toBeLessThan(1500);
    expect((await reader.read()).done).toBe(true);
  });
});
