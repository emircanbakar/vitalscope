// Runtime'da bağımlılığı olmayan sabitler: SDK bu dosyayı paketine gömebilir.

export const PROTOCOL_VERSION = 1;

export const METRIC_NAMES = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type MetricName = (typeof METRIC_NAMES)[number];

export const RATINGS = ["good", "needs-improvement", "poor"] as const;
export type Rating = (typeof RATINGS)[number];

/** p75 eşikleri: değer `good` ise iyi, `poor`dan büyükse kötü. LCP/INP/FCP/TTFB ms, CLS birimsiz. */
export const THRESHOLDS: Readonly<Record<MetricName, { good: number; poor: number }>> = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
};

export function getRating(name: MetricName, value: number): Rating {
  const { good, poor } = THRESHOLDS[name];
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

/** Public project key biçimi: yazma yetkili, gizli değil. */
export const PUBLIC_KEY_PATTERN = /^pk_[a-z0-9]{24}$/;

export const LIMITS = {
  /** Ingest'in kabul ettiği en büyük istek gövdesi (sendBeacon sınırıyla uyumlu). */
  maxBodyBytes: 64 * 1024,
  /** SDK bu boyutu aşan batch'i parçalara böler. */
  maxBatchBytes: 60 * 1024,
  maxEventsPerBatch: 50,
  maxPathLength: 300,
  maxRouteLength: 200,
  maxReleaseLength: 64,
  maxSdkVersionLength: 20,
  maxMetricIdLength: 40,
  maxVitalValue: 600_000,
  maxSelectorLength: 100,
  maxUrlLength: 300,
  maxErrorTypeLength: 100,
  maxErrorMessageLength: 500,
  maxStackFrames: 30,
  maxStackFrameLength: 300,
  maxCustomNameLength: 50,
  sessionIdLength: 16,
} as const;
