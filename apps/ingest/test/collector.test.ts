import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { RunningServer } from "../src/server.js";
import { openStore } from "../src/sqlite.js";
import { start } from "../src/start.js";
import type { StoredEvent } from "../src/types.js";

const ORIGIN = "http://localhost:3000";
const KEY = "pk_3f9a0c1d2e4b5a6978c0d1e2";

const dirs: string[] = [];
let running: RunningServer | undefined;

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "vitalscope-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await running?.shutdown();
  running = undefined;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function select(dir: string, table: string) {
  const db = new DatabaseSync(join(dir, "vitalscope.db"), { readOnly: true });
  try {
    return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  } finally {
    db.close();
  }
}

const batchFor = (e: unknown[], ctx: object = {}) =>
  JSON.stringify({ v: 1, k: KEY, sdk: "0.1.1", ctx: { sid: "0123456789abcdef", path: "/a", device: "desktop", ...ctx }, e });

const send = (url: string, body: string, origin = ORIGIN) =>
  fetch(`${url}/v1/e`, { method: "POST", body, headers: { "Content-Type": "text/plain", Origin: origin } });

async function serve(dir = tempDir()) {
  running = await start({ PORT: 0, VITALSCOPE_DIR: dir });
  return { dir, url: `http://127.0.0.1:${running.port}` };
}

describe("collector on a real database", () => {
  it("stores every event type", async () => {
    const { dir, url } = await serve();
    const ts = Date.now() - 1000;
    const res = await send(
      url,
      batchFor(
        [
          { t: "pageview", ts, path: "/b" },
          { t: "vital", ts, name: "LCP", value: 1234.5, rating: "good", id: "m1", attr: { target: "img", url: "https://x.test/a.png", ttfb: 10, loadDelay: 0 } },
          { t: "error", ts, type: "TypeError", msg: "boom", stack: ["at a", "at b"], handled: true },
          { t: "custom", ts, name: "signup", value: 2 },
          { t: "custom", ts, name: "no-value" },
        ],
        { route: "/[id]", release: "1.2.3", sr: 0.5, conn: "4g", nav: "reload" },
      ),
    );
    expect(res.status).toBe(202);
    await expect(running!.shutdown()).resolves.toBe(0);

    expect(select(dir, "pageviews")).toEqual([
      expect.objectContaining({ path: "/b", ts, route: "/[id]", release: "1.2.3", sample_rate: 0.5, conn: "4g", nav_type: "reload", env: "production" }),
    ]);
    const [vital] = select(dir, "vitals");
    expect(vital).toMatchObject({ name: "LCP", value: 1234.5, metric_id: "m1", attr_target: "img", attr_url: "https://x.test/a.png", attr_script: null });
    expect(JSON.parse(vital!.attr as string)).toEqual({ ttfb: 10, loadDelay: 0 });
    const [error] = select(dir, "errors");
    expect(error).toMatchObject({ type: "TypeError", message: "boom", handled: 1 });
    expect(JSON.parse(error!.stack as string)).toEqual(["at a", "at b"]);
    expect(select(dir, "custom_events").map(({ name, value }) => [name, value])).toEqual([
      ["signup", 2],
      ["no-value", null],
    ]);
  });

  it("is not stopped by hostile but schema-valid values", async () => {
    const { dir, url } = await serve();
    const hostile = "\ud800 kırık \u0000 \"'; DROP TABLE custom_events; --";
    expect((await send(url, batchFor([{ t: "custom", ts: 1, name: hostile }], { sid: "ğüşıöçĞÜŞİÖÇabcd" }))).status).toBe(202);
    await expect(running!.shutdown()).resolves.toBe(0);

    const rows = select(dir, "custom_events");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toContain("DROP TABLE");
  });

  it("keeps data across restarts and can be read while running", async () => {
    const dir = tempDir();
    const first = await serve(dir);
    await send(first.url, batchFor([{ t: "pageview", ts: Date.now() }]));
    await running!.shutdown();

    const second = await serve(dir);
    expect(select(dir, "pageviews")).toHaveLength(1);
    await send(second.url, batchFor([{ t: "pageview", ts: Date.now() }]));
    await running!.shutdown();
    expect(select(dir, "pageviews")).toHaveLength(2);
  });

  it("creates its folder and keeps measurements out of git", async () => {
    const dir = join(tempDir(), "yeni", ".vitalscope");
    await serve(dir);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe("*\n");
    expect(existsSync(join(dir, "vitalscope.db"))).toBe(true);
  });

  it("writes a whole batch or nothing, so a retry cannot duplicate", async () => {
    const dir = tempDir();
    const store = openStore(dir);
    const event = (ts: number, name: string): StoredEvent => ({
      receivedAt: ts,
      sdk: "0.1.1",
      ctx: { sid: "0123456789abcdef", path: "/", env: "production", device: "desktop", sr: 1 },
      event: { t: "custom", ts, name },
    });
    // NOT NULL sütunu boş kalan satır, önceki tablonun yazılmasından sonra hata verir.
    const broken = { ...event(1, "b"), ctx: { ...event(1, "b").ctx, sid: null as unknown as string } };
    const pageview: StoredEvent = { ...event(1, "a"), event: { t: "pageview", ts: 1 } };
    await expect(store.sink.write([pageview, broken])).rejects.toThrow();
    await store.sink.write([pageview, event(1, "c")]);
    store.close();
    expect(select(dir, "pageviews")).toHaveLength(1);
    expect(select(dir, "custom_events")).toHaveLength(1);
  });

  it("rejects foreign origins over HTTP", async () => {
    const { dir, url } = await serve();
    expect((await send(url, batchFor([{ t: "pageview", ts: Date.now() }]), "https://other.test")).status).toBe(403);
    await running!.shutdown();
    expect(select(dir, "pageviews")).toHaveLength(0);
  });

  it("rejects a rebound domain over HTTP", async () => {
    const { url } = await serve();
    const status = await new Promise((resolve, reject) => {
      http.get(`${url}/healthz`, { headers: { Host: "evil.io" } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).on("error", reject);
    });
    expect(status).toBe(403);
  });

  const external = Object.values(networkInterfaces())
    .flat()
    .find((address) => address && address.family === "IPv4" && !address.internal)?.address;

  it.skipIf(!external)("cannot be reached from the network", async () => {
    await serve();
    const socket = net.connect(running!.port, external!);
    const [error] = (await once(socket, "error")) as [NodeJS.ErrnoException];
    expect(error.code).toBe("ECONNREFUSED");
  });
});

describe("process", () => {
  const entry = fileURLToPath(new URL("../dist/main.js", import.meta.url));

  it("does not start with a bad variable and does not print its value", async () => {
    const child = spawn(process.execPath, [entry], { env: { PATH: process.env.PATH, PORT: "gizli-deger" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stderr.on("data", (chunk) => (output += chunk));
    const [code] = await once(child, "exit");
    expect(code).not.toBe(0);
    expect(output).toContain("PORT");
    expect(output).not.toContain("gizli-deger");
  });

  // Windows'ta `kill` süreci sinyalsiz öldürür; bu test CI'da (Linux) çalışır.
  it.skipIf(process.platform === "win32")("writes buffered events and exits cleanly on SIGTERM", async () => {
    const dir = tempDir();
    const child = spawn(process.execPath, [entry], { env: { ...process.env, PORT: "0", VITALSCOPE_DIR: dir }, stdio: ["ignore", "pipe", "inherit"] });
    const [line] = (await once(child.stdout, "data")) as [Buffer];
    const port = /:(\d+)/.exec(line.toString())?.[1];
    const res = await send(`http://127.0.0.1:${port}`, batchFor([{ t: "pageview", ts: Date.now() }]));
    expect(res.status).toBe(202);

    child.kill("SIGTERM");
    const [code] = await once(child, "exit");
    expect(code).toBe(0);
    expect(select(dir, "pageviews")).toHaveLength(1);
  });
});
