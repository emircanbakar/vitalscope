import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { toRows, type Rows } from "./rows.js";
import type { EventSink } from "./types.js";

export const DB_FILE = "vitalscope.db";

const COMMON = ["ts", "received_at", "sample_rate", "sdk", "path", "route", "release", "env", "device", "conn", "nav_type", "session_id"];

const COLUMNS: Record<keyof Rows, string[]> = {
  vitals: [...COMMON, "name", "metric_id", "value", "rating", "attr_target", "attr_url", "attr_script", "attr_type", "attr"],
  errors: [...COMMON, "type", "message", "stack", "handled"],
  pageviews: COMMON,
  custom_events: [...COMMON, "name", "value"],
};

const COMMON_SCHEMA = `
  ts INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  sample_rate REAL NOT NULL,
  sdk TEXT NOT NULL,
  path TEXT NOT NULL,
  route TEXT,
  release TEXT,
  env TEXT NOT NULL,
  device TEXT NOT NULL,
  conn TEXT,
  nav_type TEXT,
  session_id TEXT NOT NULL`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS vitals (${COMMON_SCHEMA},
  name TEXT NOT NULL,
  metric_id TEXT NOT NULL,
  value REAL NOT NULL,
  rating TEXT NOT NULL,
  attr_target TEXT,
  attr_url TEXT,
  attr_script TEXT,
  attr_type TEXT,
  attr TEXT
);
CREATE TABLE IF NOT EXISTS errors (${COMMON_SCHEMA},
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT NOT NULL,
  handled INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pageviews (${COMMON_SCHEMA});
CREATE TABLE IF NOT EXISTS custom_events (${COMMON_SCHEMA},
  name TEXT NOT NULL,
  value REAL
);`;

export interface Store {
  sink: EventSink;
  db: DatabaseSync;
  close(): void;
}

/** Klasörü ve veritabanını gerekirse oluşturur. Klasördeki `.gitignore` ölçümlerin commit'lenmesini önler. */
export function openStore(dir: string): Store {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".gitignore"), "*\n");

  const db = new DatabaseSync(join(dir, DB_FILE));
  // WAL: rapor ve panel, toplayıcı yazarken de okuyabilir. Kilitliyse kısa süre beklenir; sonrası tamponun yeniden denemesi.
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 1000;");
  db.exec(SCHEMA);

  const inserts = Object.entries(COLUMNS).map(([table, columns]) => ({
    table: table as keyof Rows,
    columns,
    statement: db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((column) => `:${column}`).join(", ")})`),
  }));

  return {
    db,
    sink: {
      // Tek transaction: parti ya tamamen yazılır ya hiç, yeniden deneme çift kayıt üretmez.
      async write(events) {
        const rows = toRows(events);
        db.exec("BEGIN");
        try {
          for (const { table, columns, statement } of inserts) {
            for (const row of rows[table]) {
              statement.run(Object.fromEntries(columns.map((column) => [column, (row[column] ?? null) as string | number | null])));
            }
          }
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    },
    close: () => db.close(),
  };
}
