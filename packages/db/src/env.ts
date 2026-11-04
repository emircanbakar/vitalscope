import { z } from "zod";

const Secret = z.string().min(1);
// Kullanıcı adı SQL'e yazılır: ClickHouse DDL'i parametre almaz.
const UserName = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/);

const Env = z.object({
  DATABASE_URL: z.url(),
  CLICKHOUSE_URL: z.url(),
  CLICKHOUSE_ADMIN_USER: z.string().min(1),
  CLICKHOUSE_ADMIN_PASSWORD: Secret,
  CLICKHOUSE_WRITE_USER: UserName,
  CLICKHOUSE_WRITE_PASSWORD: Secret,
  CLICKHOUSE_READ_USER: UserName,
  CLICKHOUSE_READ_PASSWORD: Secret,
});

export type Env = z.output<typeof Env>;

/** Eksik veya biçimsiz değişkende durur; hata mesajı değişken adını söyler, değerini yazmaz. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = Env.safeParse(source);
  if (parsed.success) return parsed.data;
  const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
  throw new Error(`Eksik veya geçersiz ortam değişkeni: ${names.join(", ")}`);
}
