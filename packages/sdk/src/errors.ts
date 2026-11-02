import { LIMITS, scrubText, type ErrorEvent } from "@vitalscope/protocol";

export type IgnorePattern = string | RegExp;

export interface RawError {
  error: unknown;
  handled: boolean;
  /** `ErrorEvent`'ten gelen yedek bilgiler (error nesnesi olmadığında). */
  message?: string;
  source?: string;
  line?: number;
  column?: number;
}

/** Aynı hata (tip + mesaj + ilk stack satırı) sayfa başına en fazla bu kadar gönderilir. */
const MAX_SAME_ERROR = 5;
const MAX_ERRORS_PER_PAGE = 50;
/** Ham mesaj temizlenmeden önce bu uzunlukta kesilir (regex maliyetini sınırlar). */
const MAX_RAW_MESSAGE = 2000;
/** chrome-extension://, moz-extension://, safari-web-extension:// */
const EXTENSION_URL = /-extension:\/\//;

/** `Object.create(null)` gibi `toString`'i olmayan değerlerde `String()` hata fırlatır. */
function toText(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "";
  }
}

function describe(raw: RawError): { type: string; msg: string; stack: string } {
  const { error } = raw;
  if (typeof error === "object" && error !== null && "message" in error) {
    const e = error as { name?: unknown; message?: unknown; stack?: unknown };
    return {
      type: typeof e.name === "string" && e.name ? e.name : "Error",
      msg: toText(e.message),
      stack: typeof e.stack === "string" ? e.stack : "",
    };
  }
  if (error !== undefined && error !== null) {
    // Promise'i Error olmayan bir değerle reddetmek: `Promise.reject("x")`
    return { type: "UnhandledRejection", msg: toText(error), stack: "" };
  }
  const location = raw.source ? `${raw.source}:${raw.line ?? 0}:${raw.column ?? 0}` : "";
  return { type: "Error", msg: raw.message ?? "", stack: location };
}

function toStackFrames(stack: string, type: string): string[] {
  const lines = stack
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  // Chrome stack'in ilk satırı "TypeError: mesaj"dır; mesaj zaten ayrı gönderilir.
  if (lines[0]?.startsWith(`${type}:`) || lines[0] === type) lines.shift();
  return lines
    .slice(0, LIMITS.maxStackFrames)
    .map((line) => scrubText(line).slice(0, LIMITS.maxStackFrameLength));
}

/**
 * Hataları ham haliyle toplar; stack işleme `schedule` ile boşta çalışır ya da `drain()`
 * çağrılınca (sayfa kapanırken) hemen yapılır. Gürültü ve tekrarlar burada elenir.
 */
export function createErrorCollector(
  report: (event: ErrorEvent) => void,
  ignore: readonly IgnorePattern[],
  schedule: (fn: () => void) => void,
) {
  let pending: (RawError & { ts: number })[] = [];
  let scheduled = false;
  let total = 0;
  const counts = new Map<string, number>();
  // Aynı yerden tekrar eden hata bekleme kuyruğunu doldurup farklı hataları düşürmesin diye
  // stack işlenmeden önce ucuz bir anahtarla da sınırlanır.
  const rawCounts = new Map<string, number>();

  function rawKey(raw: RawError): string {
    const { error } = raw;
    const msg = typeof error === "object" && error !== null ? toText((error as { message?: unknown }).message) : toText(error ?? raw.message);
    return `${msg.slice(0, MAX_RAW_MESSAGE)}|${raw.source ?? ""}:${raw.line ?? ""}:${raw.column ?? ""}`;
  }

  function toEvent(raw: RawError & { ts: number }): ErrorEvent | undefined {
    const { type, msg, stack } = describe(raw);
    if (EXTENSION_URL.test(stack) || EXTENSION_URL.test(raw.source ?? "")) return undefined;
    // Cross-origin script hatası: tarayıcı detayları gizler, anlamsızdır.
    if (/^Script error\.?$/.test(msg) && !stack) return undefined;
    if (ignore.some((p) => (typeof p === "string" ? msg.includes(p) : p.test(msg)))) return undefined;

    return {
      t: "error",
      ts: raw.ts,
      type: type.slice(0, LIMITS.maxErrorTypeLength),
      msg: scrubText(msg.slice(0, MAX_RAW_MESSAGE)).slice(0, LIMITS.maxErrorMessageLength),
      stack: toStackFrames(stack, type),
      handled: raw.handled,
    };
  }

  function drain(): void {
    scheduled = false;
    const batch = pending;
    pending = [];
    for (const raw of batch) {
      const event = toEvent(raw);
      if (!event || total >= MAX_ERRORS_PER_PAGE) continue;
      const key = `${event.type}|${event.msg}|${event.stack[0] ?? ""}`;
      const seen = counts.get(key) ?? 0;
      if (seen >= MAX_SAME_ERROR) continue;
      counts.set(key, seen + 1);
      total++;
      report(event);
    }
  }

  function capture(raw: RawError): void {
    if (total >= MAX_ERRORS_PER_PAGE || pending.length >= MAX_ERRORS_PER_PAGE) return;
    const key = rawKey(raw);
    const seen = rawCounts.get(key) ?? 0;
    if (seen >= MAX_SAME_ERROR) return;
    rawCounts.set(key, seen + 1);
    pending.push({ ...raw, ts: Date.now() });
    if (!scheduled) {
      scheduled = true;
      schedule(drain);
    }
  }

  return { capture, drain };
}
