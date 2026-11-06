import type { MetricName, Rating } from "@vitalscope/protocol";

const time = (value: number) => (value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`);
const score = (value: number) => value.toFixed(2);

/** Sabit fonksiyonlar: grafikler bunları `useMemo` bağımlılığı olarak kullanır. */
export const FORMATS: Record<MetricName, (value: number) => string> = { LCP: time, INP: time, FCP: time, TTFB: time, CLS: score };

export const METRIC_TITLES: Record<MetricName, string> = {
  LCP: "Largest Contentful Paint",
  INP: "Interaction to Next Paint",
  CLS: "Cumulative Layout Shift",
  FCP: "First Contentful Paint",
  TTFB: "Time to First Byte",
};

/** Rapordaki işaretlerle aynı: değerlendirme renge bağlı kalmaz. */
export const RATING_LABELS: Record<Rating, { mark: string; label: string }> = {
  good: { mark: "✓", label: "Good" },
  "needs-improvement": { mark: "~", label: "Needs improvement" },
  poor: { mark: "!", label: "Poor" },
};
