import { useCallback, useEffect, useState } from "react";
import { METRIC_NAMES, type MetricName } from "@vitalscope/protocol";

export const RANGES = { all: "All time", "1h": "Last hour", "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days" } as const;
export type Range = keyof typeof RANGES;
const ENVIRONMENTS = ["production", "preview", "development"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** Panelin bütün durumu adreste: paylaşılabilir, geri tuşu çalışır, sayfa yenilenince korunur. */
export interface ViewState {
  env?: Environment;
  page?: string;
  device?: string;
  range: Range;
  metric?: MetricName;
}

/** Adres elle değiştirilebilir: bilinmeyen değerler varsayılana düşer. */
export function parseView(search: string): ViewState {
  const params = new URLSearchParams(search);
  const env = params.get("env") as Environment | null;
  const page = params.get("page");
  const device = params.get("device");
  const range = params.get("range") as Range | null;
  const metric = params.get("metric") as MetricName | null;
  return {
    ...(env && ENVIRONMENTS.includes(env) ? { env } : {}),
    ...(page ? { page } : {}),
    ...(device ? { device } : {}),
    range: range && Object.hasOwn(RANGES, range) ? range : "all",
    ...(metric && METRIC_NAMES.includes(metric) ? { metric } : {}),
  };
}

export function viewUrl(view: ViewState) {
  const params = new URLSearchParams();
  if (view.metric) params.set("metric", view.metric);
  if (view.env) params.set("env", view.env);
  if (view.page) params.set("page", view.page);
  if (view.device) params.set("device", view.device);
  if (view.range !== "all") params.set("range", view.range);
  const search = params.toString();
  return search ? `?${search}` : location.pathname;
}

/** Sunucuya giden filtreler; ortam her zaman açıktır, ortamlar tek bir p75'te karışmaz. */
export function apiQuery(view: ViewState, env: Environment) {
  const params = new URLSearchParams({ env });
  if (view.page) params.set("page", view.page);
  if (view.device) params.set("device", view.device);
  if (view.range !== "all") params.set("range", view.range);
  return params.toString();
}

export function useView() {
  const [view, setView] = useState(() => parseView(location.search));

  useEffect(() => {
    const update = () => setView(parseView(location.search));
    addEventListener("popstate", update);
    return () => removeEventListener("popstate", update);
  }, []);

  const navigate = useCallback((next: ViewState) => {
    history.pushState(null, "", viewUrl(next));
    setView(next);
  }, []);

  return [view, navigate] as const;
}
