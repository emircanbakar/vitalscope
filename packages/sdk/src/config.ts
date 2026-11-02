import { LIMITS, PUBLIC_KEY_PATTERN } from "@vitalscope/protocol";

export interface Config {
  /** `pk_` ile başlayan public proje anahtarı. */
  key: string;
  /** Ingest URL'i; `https:` olmalı (localhost hariç). */
  endpoint: string;
  release?: string;
  environment?: "production" | "preview" | "development";
  /** Olayları göndermek yerine konsola yazar. */
  debug?: boolean;
}

export interface ResolvedConfig {
  key: string;
  endpoint: string;
  release: string | undefined;
  environment: "production" | "preview" | "development";
  debug: boolean;
}

const ENVIRONMENTS = ["production", "preview", "development"] as const;
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function isAllowedEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOCAL_HOSTS.includes(url.hostname);
}

/**
 * Sadece bilinen alanlar tek tek okunur; `__proto__` gibi anahtarlar hiç kopyalanmaz.
 * Geçersiz config'de `null` döner ve SDK başlamaz.
 */
export function resolveConfig(input: unknown): ResolvedConfig | null {
  if (typeof input !== "object" || input === null) return null;
  const { key, endpoint, release, environment, debug } = input as Record<string, unknown>;

  if (typeof key !== "string" || !PUBLIC_KEY_PATTERN.test(key)) return null;
  if (typeof endpoint !== "string" || !isAllowedEndpoint(endpoint)) return null;
  if (release !== undefined && (typeof release !== "string" || release.length > LIMITS.maxReleaseLength)) return null;
  if (environment !== undefined && !ENVIRONMENTS.includes(environment as never)) return null;

  return {
    key,
    endpoint,
    release,
    environment: (environment as ResolvedConfig["environment"] | undefined) ?? "production",
    debug: debug === true,
  };
}
