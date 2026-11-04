import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as migratePostgres } from "drizzle-orm/node-postgres/migrator";
import { parseEnv, type Env } from "./env.js";

const POSTGRES_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));
const CLICKHOUSE_DIR = fileURLToPath(new URL("../clickhouse/", import.meta.url));

async function migrateClickHouse(client: ClickHouseClient) {
  await client.command({
    query: "CREATE TABLE IF NOT EXISTS schema_migrations (name String, applied_at DateTime DEFAULT now()) ENGINE = MergeTree ORDER BY name",
  });
  const result = await client.query({ query: "SELECT name FROM schema_migrations", format: "JSONEachRow" });
  const applied = new Set((await result.json<{ name: string }>()).map((row) => row.name));

  const files = (await readdir(CLICKHOUSE_DIR)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files.filter((file) => !applied.has(file))) {
    const sql = (await readFile(CLICKHOUSE_DIR + name, "utf8")).replace(/^--.*$/gm, "");
    for (const query of sql.split(/;\s*$/m).map((part) => part.trim()).filter(Boolean)) {
      await client.command({ query });
    }
    await client.insert({ table: "schema_migrations", values: [{ name }], format: "JSONEachRow" });
  }
}

/** Şifre sorgu günlüğüne düşmesin diye özeti gönderilir; her çalıştırma şifreyi ortamdakiyle eşitler. */
async function syncUser(client: ClickHouseClient, user: string, password: string, role: string) {
  const hash = createHash("sha256").update(password).digest("hex");
  const auth = `IDENTIFIED WITH sha256_hash BY '${hash}'`;
  await client.command({ query: `CREATE USER IF NOT EXISTS ${user} ${auth}` });
  await client.command({ query: `GRANT ${role} TO ${user}` });
  await client.command({ query: `ALTER USER ${user} ${auth} DEFAULT ROLE ${role}` });
}

/** Tekrar çalıştırılabilir: uygulanmış migration'lar atlanır, kullanıcılar ortamla eşitlenir. */
export async function runMigrations(env: Env) {
  const postgres = drizzle(env.DATABASE_URL);
  try {
    await migratePostgres(postgres, { migrationsFolder: POSTGRES_DIR });
  } finally {
    await postgres.$client.end();
  }

  const clickhouse = createClient({
    url: env.CLICKHOUSE_URL,
    username: env.CLICKHOUSE_ADMIN_USER,
    password: env.CLICKHOUSE_ADMIN_PASSWORD,
    database: "vitalscope",
  });
  try {
    await migrateClickHouse(clickhouse);
    await syncUser(clickhouse, env.CLICKHOUSE_WRITE_USER, env.CLICKHOUSE_WRITE_PASSWORD, "vitalscope_ingest");
    await syncUser(clickhouse, env.CLICKHOUSE_READ_USER, env.CLICKHOUSE_READ_PASSWORD, "vitalscope_read");
  } finally {
    await clickhouse.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runMigrations(parseEnv(process.env));
  console.log("Migration'lar uygulandı.");
}
