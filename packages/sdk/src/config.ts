import { LIMITS, PUBLIC_KEY_PATTERN } from "@vitalscope/protocol";
import type { IgnorePattern } from "./errors.js";

export interface Config {
  /** `pk_` ile başlayan public proje anahtarı. Yerel toplayıcı değerine bakmaz; varsayılanı yeterlidir. */
  key?: string;
  /** Toplayıcı URL'i; `https:` olmalı (localhost hariç). Varsayılan `vitalscope dev` adresi. */
  endpoint?: string;
  release?: string;
  environment?: "production" | "preview" | "development";
  /** 0–1 arası; karar sayfa yüklemesi başına bir kez verilir. Varsayılan 1. */
  sampleRate?: number;
  /** Yakalanmamış hataları ve reddedilmiş promise'leri otomatik toplar. Varsayılan `true`. */
  captureErrors?: boolean;
  /** SPA rota değişimlerini algılar ve her birinde pageview gönderir. Varsayılan `true`. */
  trackSpa?: boolean;
  /** Mesajı bu metni içeren ya da bu desene uyan hatalar gönderilmez. */
  ignoreErrors?: IgnorePattern[];
  /** Gönderilmesine izin verilen query parametreleri; geri kalanı atılır. */
  keepQuery?: string[];
  /** `true` ise GPC/DNT sinyali olan kullanıcıda hiç veri toplanmaz. */
  respectDoNotTrack?: boolean;
  /** Olayları göndermek yerine konsola yazar. */
  debug?: boolean;
}

export interface ResolvedConfig {
  key: string;
  endpoint: string;
  release: string | undefined;
  environment: "production" | "preview" | "development";
  sampleRate: number;
  captureErrors: boolean;
  trackSpa: boolean;
  ignoreErrors: IgnorePattern[];
  keepQuery: string[];
  respectDoNotTrack: boolean;
  debug: boolean;
}

const ENVIRONMENTS = ["production", "preview", "development"] as const;
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
/** Protokol anahtar ister; tek proje olan yerel toplayıcı için sabit bir değer yeterlidir. */
const LOCAL_KEY = "pk_localvitalscope000000000";
const LOCAL_ENDPOINT = "http://localhost:8787/v1/e";

/**
 * Sayfa bu makinede mi açık? `devDependencies` paketi bundler'la canlıya sızabilir;
 * gerçek bir alan adında SDK hiç başlamaz, canlı kullanıcıdan veri toplanmaz.
 */
export function isLocalPage(hostname: string = location.hostname): boolean {
  return LOCAL_HOSTS.includes(hostname) || hostname.endsWith(".localhost");
}

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

function isListOf<T>(value: unknown, check: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(check);
}
const isString = (item: unknown): item is string => typeof item === "string";
const isPattern = (item: unknown): item is IgnorePattern => typeof item === "string" || item instanceof RegExp;

/**
 * Sadece bilinen alanlar tek tek okunur; `__proto__` gibi anahtarlar hiç kopyalanmaz.
 * Geçersiz config'de `null` döner ve SDK başlamaz.
 */
export function resolveConfig(input: unknown = {}): ResolvedConfig | null {
  if (typeof input !== "object" || input === null) return null;
  const {
    key = LOCAL_KEY,
    endpoint = LOCAL_ENDPOINT,
    release,
    environment,
    sampleRate,
    captureErrors,
    trackSpa,
    ignoreErrors,
    keepQuery,
    respectDoNotTrack,
    debug,
  } = input as Record<string, unknown>;

  if (typeof key !== "string" || !PUBLIC_KEY_PATTERN.test(key)) return null;
  if (typeof endpoint !== "string" || !isAllowedEndpoint(endpoint)) return null;
  if (release !== undefined && (typeof release !== "string" || release.length > LIMITS.maxReleaseLength)) return null;
  if (environment !== undefined && !ENVIRONMENTS.includes(environment as never)) return null;
  if (sampleRate !== undefined && (typeof sampleRate !== "number" || !(sampleRate >= 0 && sampleRate <= 1))) {
    return null;
  }
  if (ignoreErrors !== undefined && !isListOf(ignoreErrors, isPattern)) return null;
  if (keepQuery !== undefined && !isListOf(keepQuery, isString)) return null;

  return {
    key,
    endpoint,
    release,
    environment: (environment as ResolvedConfig["environment"] | undefined) ?? "production",
    sampleRate: sampleRate ?? 1,
    captureErrors: captureErrors !== false,
    trackSpa: trackSpa !== false,
    // Diziler kopyalanır: init'ten sonra dışarıdan değiştirilemez.
    ignoreErrors: [...(ignoreErrors ?? [])],
    keepQuery: [...(keepQuery ?? [])],
    respectDoNotTrack: respectDoNotTrack === true,
    debug: debug === true,
  };
}
