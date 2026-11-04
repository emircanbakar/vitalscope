import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().min(0).max(65_535),
  DATABASE_URL: z.url(),
  CLICKHOUSE_URL: z.url(),
  CLICKHOUSE_WRITE_USER: z.string().min(1),
  CLICKHOUSE_WRITE_PASSWORD: z.string().min(1),
});

export type Env = z.output<typeof Env>;

/** Eksik veya biçimsiz değişkende durur; hata mesajı değişken adını söyler, değerini yazmaz. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = Env.safeParse(source);
  if (parsed.success) return parsed.data;
  const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
  throw new Error(`Eksik veya geçersiz ortam değişkeni: ${names.join(", ")}`);
}
