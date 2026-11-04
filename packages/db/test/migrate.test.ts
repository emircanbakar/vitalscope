import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@clickhouse/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnv, type Env } from "../src/env.js";
import { runMigrations } from "../src/migrate.js";
import { project, publicKey } from "../src/schema.js";

process.loadEnvFile(fileURLToPath(new URL("../../../infra/dev.env", import.meta.url)));
const env: Env = parseEnv(process.env);

const asUser = (username: string, password: string) =>
  createClient({ url: env.CLICKHOUSE_URL, username, password, database: "vitalscope" });

const writer = asUser(env.CLICKHOUSE_WRITE_USER, env.CLICKHOUSE_WRITE_PASSWORD);
const reader = asUser(env.CLICKHOUSE_READ_USER, env.CLICKHOUSE_READ_PASSWORD);
const postgres = drizzle(env.DATABASE_URL);

const row = (projectId: string) => ({ project_id: projectId, ts: "2026-11-04 12:00:00.000", received_at: "2026-11-04 12:00:00.000", path: "/" });
const count = async (projectId: string) => {
  const result = await reader.query({
    query: "SELECT count() AS n FROM pageviews WHERE project_id = {id:UUID}",
    query_params: { id: projectId },
    format: "JSONEachRow",
  });
  return Number((await result.json<{ n: string }>())[0]?.n);
};

beforeAll(() => runMigrations(env));
afterAll(async () => {
  await Promise.all([writer.close(), reader.close(), postgres.$client.end()]);
});

describe("migrations", () => {
  it("can run again without changing anything", async () => {
    await expect(runMigrations(env)).resolves.toBeUndefined();
  });

  it("rejects a bad user name and names only the variable", () => {
    const secret = "gizli'; DROP TABLE vitals; --";
    expect(() => parseEnv({ ...env, CLICKHOUSE_WRITE_USER: secret })).toThrow("CLICKHOUSE_WRITE_USER");
    expect(() => parseEnv({ ...env, CLICKHOUSE_WRITE_USER: secret })).not.toThrow("gizli");
  });
});

describe("ClickHouse access", () => {
  it("lets the ingest user insert but not read or delete", async () => {
    const id = randomUUID();
    await writer.insert({ table: "pageviews", values: [row(id)], format: "JSONEachRow" });
    expect(await count(id)).toBe(1);
    await expect(writer.query({ query: "SELECT * FROM pageviews LIMIT 1" })).rejects.toThrow(/ACCESS_DENIED|Not enough privileges/);
    await expect(writer.command({ query: "TRUNCATE TABLE pageviews" })).rejects.toThrow(/ACCESS_DENIED|Not enough privileges/);
  });

  it("lets the read user read but not write or delete", async () => {
    await expect(reader.insert({ table: "pageviews", values: [row(randomUUID())], format: "JSONEachRow" })).rejects.toThrow(
      /ACCESS_DENIED|Not enough privileges/,
    );
    await expect(reader.command({ query: "TRUNCATE TABLE pageviews" })).rejects.toThrow(/ACCESS_DENIED|Not enough privileges/);
  });

  it("applies query limits to the read user", async () => {
    const result = await reader.query({
      query: "SELECT getSetting('max_execution_time') AS time, getSetting('max_result_rows') AS result_rows",
      format: "JSONEachRow",
    });
    expect((await result.json<{ time: unknown; result_rows: unknown }>())[0]).toMatchObject({ time: 10, result_rows: 100000 });
  });

  it("keeps a retried block once", async () => {
    const id = randomUUID();
    const values = [row(id), row(id)];
    await writer.insert({ table: "pageviews", values, format: "JSONEachRow" });
    await writer.insert({ table: "pageviews", values, format: "JSONEachRow" });
    expect(await count(id)).toBe(2);
  });
});

describe("Postgres schema", () => {
  it("deletes a project's keys with the project and keeps keys unique", async () => {
    const [created] = await postgres.insert(project).values({ ownerId: "test", name: "test", allowedOrigins: ["site.test"] }).returning();
    const projectId = created!.id;
    const key = `pk_test_${randomUUID()}`;
    await postgres.insert(publicKey).values({ projectId, key });
    await expect(postgres.insert(publicKey).values({ projectId, key })).rejects.toThrow();
    await postgres.delete(project).where(eq(project.id, projectId));
    expect(await postgres.select().from(publicKey).where(eq(publicKey.key, key))).toEqual([]);
  });
});
