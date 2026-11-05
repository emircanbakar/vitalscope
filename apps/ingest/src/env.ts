import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().min(0).max(65_535).default(8787),
  /** Ölçümlerin tutulduğu klasör; çalışılan dizine göre. */
  VITALSCOPE_DIR: z.string().min(1).default(".vitalscope"),
});

export type Env = z.output<typeof Env>;

/** Biçimsiz değişkende durur; hata mesajı değişken adını söyler, değerini yazmaz. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = Env.safeParse(source);
  if (parsed.success) return parsed.data;
  const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
  throw new Error(`Geçersiz ortam değişkeni: ${names.join(", ")}`);
}
