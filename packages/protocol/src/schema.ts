import { z } from "zod";
import { LIMITS, METRIC_NAMES, PROTOCOL_VERSION, PUBLIC_KEY_PATTERN, RATINGS } from "./constants.js";

// Bilinmeyen alanlar hata vermeden atılır (z.object varsayılanı): yeni SDK eski sunucuya veri gönderebilir.

const Ts = z.number().int().positive();
const Path = z.string().startsWith("/").max(LIMITS.maxPathLength);
const Duration = z.number().nonnegative().max(LIMITS.maxVitalValue);

/** Ham stack satırı; ayrıştırma ve gruplama sunucuda yapılır. */
export const StackFrame = z.string().max(LIMITS.maxStackFrameLength);

/** "Neden yavaş" bilgisi. Seçiciler metin içeriği taşımaz; süreler ms. */
export const Attribution = z.object({
  target: z.string().max(LIMITS.maxSelectorLength).optional(),
  url: z.string().max(LIMITS.maxUrlLength).optional(),
  // LCP alt parçaları
  ttfb: Duration.optional(),
  loadDelay: Duration.optional(),
  loadTime: Duration.optional(),
  renderDelay: Duration.optional(),
  // INP
  type: z.enum(["pointer", "keyboard"]).optional(),
  inputDelay: Duration.optional(),
  processing: Duration.optional(),
  presentation: Duration.optional(),
  script: z.string().max(LIMITS.maxUrlLength).optional(),
  // CLS: en büyük kaymanın sayfa yüklenmesinden itibaren zamanı
  time: Duration.optional(),
});

export const Context = z.object({
  sid: z.string().length(LIMITS.sessionIdLength),
  path: Path,
  route: z.string().max(LIMITS.maxRouteLength).optional(),
  release: z.string().max(LIMITS.maxReleaseLength).optional(),
  env: z.enum(["production", "preview", "development"]).default("production"),
  device: z.enum(["mobile", "tablet", "desktop"]),
  conn: z.enum(["slow-2g", "2g", "3g", "4g"]).optional(),
  nav: z.enum(["navigate", "reload", "back_forward", "prerender", "restore"]).optional(),
  /** Örnekleme oranı; dashboard sayımları 1 / sr ile ölçekler. */
  sr: z.number().gt(0).lte(1).default(1),
});

export const PageviewEvent = z.object({
  t: z.literal("pageview"),
  ts: Ts,
  /** SPA rota değişiminde batch bağlamındaki path'ten farklı olabilir. */
  path: Path.optional(),
});

export const VitalEvent = z.object({
  t: z.literal("vital"),
  ts: Ts,
  name: z.enum(METRIC_NAMES),
  value: z.number().nonnegative().max(LIMITS.maxVitalValue),
  rating: z.enum(RATINGS),
  /** Metrik örneği id'si; tekrar gönderimde tekilleştirme için. */
  id: z.string().max(LIMITS.maxMetricIdLength),
  attr: Attribution.optional(),
});

export const ErrorEvent = z.object({
  t: z.literal("error"),
  ts: Ts,
  type: z.string().max(LIMITS.maxErrorTypeLength),
  msg: z.string().max(LIMITS.maxErrorMessageLength),
  stack: z.array(StackFrame).max(LIMITS.maxStackFrames),
  handled: z.boolean(),
});

export const CustomEvent = z.object({
  t: z.literal("custom"),
  ts: Ts,
  name: z.string().max(LIMITS.maxCustomNameLength),
  value: z.number().optional(),
});

export const Event = z.discriminatedUnion("t", [PageviewEvent, VitalEvent, ErrorEvent, CustomEvent]);

export const Batch = z.object({
  v: z.literal(PROTOCOL_VERSION),
  k: z.string().regex(PUBLIC_KEY_PATTERN),
  sdk: z.string().max(LIMITS.maxSdkVersionLength),
  ctx: Context,
  e: z.array(Event).min(1).max(LIMITS.maxEventsPerBatch),
});

/** Ingest'in doğrulamadan sonra gördüğü biçim (varsayılanlar uygulanmış). */
export type Batch = z.output<typeof Batch>;
export type Context = z.output<typeof Context>;
export type Event = z.output<typeof Event>;
export type Attribution = z.output<typeof Attribution>;
export type PageviewEvent = z.output<typeof PageviewEvent>;
export type VitalEvent = z.output<typeof VitalEvent>;
export type ErrorEvent = z.output<typeof ErrorEvent>;
export type CustomEvent = z.output<typeof CustomEvent>;

/** SDK'nın gönderdiği biçim (varsayılanlı alanlar opsiyonel). */
export type BatchInput = z.input<typeof Batch>;
export type ContextInput = z.input<typeof Context>;
