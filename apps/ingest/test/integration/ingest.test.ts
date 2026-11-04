import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createClient } from "@clickhouse/client";
import { project, publicKey } from "@vitalscope/db";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createClickHouseSink } from "../../src/clickhouse.js";
import { parseEnv } from "../../src/env.js";
import { createKeyResolver } from "../../src/postgres.js";
import { start } from "../../src/start.js";
import type { RunningServer } from "../../src/server.js";
import { storedEvents } from "../helpers.js";

process.loadEnvFile(fileURLToPath(new URL("../../../../infra/dev.env", import.meta.url)));
const env = { ...parseEnv(process.env), PORT: 0 };
const ORIGIN = "https://site.test";

const admin = createClient({
  url: env.CLICKHOUSE_URL,
  username: process.env.CLICKHOUSE_ADMIN_USER!,
  password: process.env.CLICKHOUSE_ADMIN_PASSWORD!,
  database: "vitalscope",
});
const postgres = drizzle(env.DATABASE_URL);
const projects: string[] = [];

async function createProject() {
  const [created] = await postgres.insert(project).values({ ownerId: "test", name: "test", allowedOrigins: ["site.test"] }).returning();
  const id = created!.id;
  projects.push(id);
  const key = `pk_${randomBytes(12).toString("hex")}`;
  await postgres.insert(publicKey).values({ projectId: id, key });
  return { id, key };
}

async function select<T>(table: string, projectId: string) {
  const result = await admin.query({
    query: `SELECT * FROM ${table} WHERE project_id = {id:UUID} ORDER BY ts`,
    query_params: { id: projectId },
    format: "JSONEachRow",
  });
  return result.json<T>();
}

const batchFor = (key: string, e: unknown[], ctx: object = {}) =>
  JSON.stringify({ v: 1, k: key, sdk: "0.1.1", ctx: { sid: "0123456789abcdef", path: "/a", device: "desktop", ...ctx }, e });

const send = (url: string, body: string, origin = ORIGIN) =>
  fetch(`${url}/v1/e`, { method: "POST", body, headers: { "Content-Type": "text/plain", Origin: origin } });

let running: RunningServer | undefined;
async function serve(overrides = {}) {
  running = await start({ ...env, ...overrides });
  return `http://127.0.0.1:${running.port}`;
}

afterEach(async () => {
  await running?.shutdown();
  running = undefined;
});
afterAll(async () => {
  if (projects.length > 0) await postgres.delete(project).where(inArray(project.id, projects));
  await Promise.all([admin.close(), postgres.$client.end()]);
});

describe("ingest against real databases", () => {
  it("stores every event type with the insert-only user", async () => {
    const { id, key } = await createProject();
    const url = await serve();
    const ts = Date.now() - 1000;
    const res = await send(
      url,
      batchFor(
        key,
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

    const expectedTs = new Date(ts).toISOString().slice(0, -1).replace("T", " ");
    expect(await select("pageviews", id)).toEqual([
      expect.objectContaining({ path: "/b", ts: expectedTs, route: "/[id]", release: "1.2.3", sample_rate: 0.5, conn: "4g", nav_type: "reload", env: "production" }),
    ]);
    expect(await select("vitals", id)).toEqual([
      expect.objectContaining({
        name: "LCP",
        value: 1234.5,
        metric_id: "m1",
        attr_target: "img",
        attr_url: "https://x.test/a.png",
        attr: { ttfb: 10, loadDelay: 0 },
      }),
    ]);
    expect(await select("errors", id)).toEqual([expect.objectContaining({ type: "TypeError", message: "boom", stack: ["at a", "at b"], handled: true })]);
    const custom = await select<{ name: string; value: number | null }>("custom_events", id);
    expect(custom.map(({ name, value }) => [name, value]).sort()).toEqual([
      ["no-value", null],
      ["signup", 2],
    ]);
  });

  it("is not stopped by hostile but schema-valid values", async () => {
    const { id, key } = await createProject();
    const url = await serve();
    // Her olay ayrı bir aylık bölüm isteseydi tek insert ClickHouse'un sınırını (100) aşar, parti hiç yazılamazdı.
    const MONTH = 30 * 24 * 60 * 60 * 1000;
    for (const start of [0, 50, 100]) {
      const old = Array.from({ length: 50 }, (_, i) => ({ t: "pageview", ts: 1 + (start + i) * MONTH }));
      // Karakter sayısı doğru, bayt sayısı değil: `FixedString(16)` bu oturum kimliğini reddederdi.
      expect((await send(url, batchFor(key, old, { sid: "ğüşıöçĞÜŞİÖÇabcd" }))).status).toBe(202);
    }
    await send(url, batchFor(key, [{ t: "custom", ts: Date.now(), name: "\ud800 kırık \u0000 \"'" }]));
    await expect(running!.shutdown()).resolves.toBe(0);

    expect(await select("pageviews", id)).toHaveLength(150);
    expect(await select("custom_events", id)).toHaveLength(1);
  });

  it("stores a retried batch once", async () => {
    const { id } = await createProject();
    const writer = createClient({ url: env.CLICKHOUSE_URL, username: env.CLICKHOUSE_WRITE_USER, password: env.CLICKHOUSE_WRITE_PASSWORD, database: "vitalscope" });
    const sink = createClickHouseSink(writer);
    const receivedAt = Date.now();
    const events = storedEvents(3).map((event) => ({ ...event, projectId: id, receivedAt, event: { t: "pageview" as const, ts: receivedAt - event.receivedAt } }));
    await sink.write(events);
    await sink.write(events);
    await writer.close();
    expect(await select("pageviews", id)).toHaveLength(3);
  });

  it("rejects unknown and revoked keys and foreign origins", async () => {
    const { id, key } = await createProject();
    const url = await serve();
    const body = (k: string) => batchFor(k, [{ t: "pageview", ts: Date.now() }]);
    expect((await send(url, body(`pk_${randomBytes(12).toString("hex")}`))).status).toBe(401);
    expect((await send(url, body(key), "https://other.test")).status).toBe(403);

    await postgres.update(publicKey).set({ revokedAt: new Date() }).where(eq(publicKey.projectId, id));
    await expect(createKeyResolver(postgres)(key)).resolves.toBeNull();
  });

  it("resolves a key to its project", async () => {
    const { id, key } = await createProject();
    await expect(createKeyResolver(postgres)(key)).resolves.toEqual({ id, allowedOrigins: ["site.test"] });
  });

  it("reports ready only when the databases accept its credentials", async () => {
    const url = await serve();
    expect((await fetch(`${url}/readyz`)).status).toBe(204);
    await running!.shutdown();

    const badUrl = await serve({ CLICKHOUSE_WRITE_PASSWORD: "yanlis" });
    expect((await fetch(`${badUrl}/readyz`)).status).toBe(503);
    await running!.shutdown();

    const noPostgres = await serve({ DATABASE_URL: "postgres://dev:yanlis@127.0.0.1:5432/vitalscope" });
    expect((await fetch(`${noPostgres}/readyz`)).status).toBe(503);
    expect((await fetch(`${noPostgres}/healthz`)).status).toBe(204);
  });

  it("answers 503 when the key source is down", async () => {
    const url = await serve({ DATABASE_URL: "postgres://dev:yanlis@127.0.0.1:5432/vitalscope" });
    const res = await send(url, batchFor(`pk_${randomBytes(12).toString("hex")}`, [{ t: "pageview", ts: Date.now() }]));
    expect(res.status).toBe(503);
  });

  it("reports buffered events as lost when ClickHouse stays down", async () => {
    const { key } = await createProject();
    const url = await serve({ CLICKHOUSE_WRITE_PASSWORD: "yanlis" });
    expect((await send(url, batchFor(key, [{ t: "pageview", ts: Date.now() }]))).status).toBe(202);
    await expect(running!.shutdown()).resolves.toBe(1);
  }, 20_000);
});

describe("process", () => {
  const entry = fileURLToPath(new URL("../../dist/main.js", import.meta.url));

  it("does not start with a missing variable and does not print values", async () => {
    const child = spawn(process.execPath, [entry], {
      env: { PATH: process.env.PATH, DATABASE_URL: "postgres://dev:gizli-sifre@127.0.0.1:5432/vitalscope" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stderr.on("data", (chunk) => (output += chunk));
    const [code] = await once(child, "exit");
    expect(code).not.toBe(0);
    expect(output).toContain("CLICKHOUSE_URL");
    expect(output).not.toContain("gizli-sifre");
  });

  // Windows'ta `kill` süreci sinyalsiz öldürür; bu test CI'da (Linux) çalışır.
  it.skipIf(process.platform === "win32")("writes buffered events and exits cleanly on SIGTERM", async () => {
    const { id, key } = await createProject();
    const child = spawn(process.execPath, [entry], { env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "inherit"] });
    const [line] = (await once(child.stdout, "data")) as [Buffer];
    const port = /(\d+)/.exec(line.toString())?.[1];
    const res = await send(`http://127.0.0.1:${port}`, batchFor(key, [{ t: "pageview", ts: Date.now() }]));
    expect(res.status).toBe(202);

    child.kill("SIGTERM");
    const [code] = await once(child, "exit");
    expect(code).toBe(0);
    expect(await select("pageviews", id)).toHaveLength(1);
  });
});
