import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { METRIC_NAMES, THRESHOLDS, getRating, type MetricName, type Rating } from "@vitalscope/protocol";

export const ENVIRONMENTS = ["production", "preview", "development"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** Aralık genişliği eşiklerin katı: her aralık tek bir değerlendirmeye düşer, eşik çizgisi aralık sınırındadır. */
const BIN_WIDTH: Record<MetricName, number> = { LCP: 500, INP: 50, CLS: 0.05, FCP: 300, TTFB: 200 };
const MAX_BINS = 40;
const MAX_BUCKETS = 60;
const MIN_BUCKET_SAMPLES = 5;
const MINUTE = 60_000;
const BUCKETS = [MINUTE, 5 * MINUTE, 15 * MINUTE, 60 * MINUTE, 360 * MINUTE, 1440 * MINUTE, 10_080 * MINUTE];
const MAX_ROWS = 100;
/** Aynı metrik örneği değeri büyüdükçe yeniden gönderilebilir; sadece son değeri sayılır. */
export const LATEST_SAMPLE = "rowid IN (SELECT MAX(rowid) FROM vitals GROUP BY session_id, metric_id)";

export interface Filters {
  env: Environment;
  page?: string;
  device?: string;
  /** Bu andan (epoch ms) sonraki ölçümler. */
  since?: number;
}

export type RatingCounts = { good: number; needsImprovement: number; poor: number };

export interface MetricSummary {
  name: MetricName;
  count: number;
  p75: number | null;
  rating: Rating | null;
  counts: RatingCounts;
}

export interface PageRow {
  page: string;
  views: number;
  p75: Partial<Record<MetricName, number>>;
}

export interface Options {
  environments: Environment[];
  pages: string[];
  devices: string[];
}

export interface Overview {
  metrics: MetricSummary[];
  pages: PageRow[];
  morePages: number;
}

export interface BreakdownRow {
  key: string;
  count: number;
  p75: number;
  rating: Rating;
}

export interface MetricDetail {
  summary: MetricSummary;
  series: { x: number[]; p50: number[]; p75: number[]; p95: number[] };
  histogram: {
    bins: { start: number; end: number; count: number }[];
    /** Grafiğe sığmayan, son aralıktan büyük ölçüm sayısı. */
    above: number;
    percentiles: { p50: number; p75: number; p95: number } | null;
  };
  pages: BreakdownRow[];
  devices: BreakdownRow[];
}

interface Sample {
  page: string;
  device: string;
  name: MetricName;
  value: number;
  ts: number;
}

/** En yakın sıra yöntemi; `values` boş olmamalı. */
export function percentile(values: readonly number[], q: number) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * q) - 1]!;
}

function where({ env, page, device, since }: Filters) {
  const clauses = ["env = ?"];
  const params: SQLInputValue[] = [env];
  if (page !== undefined) {
    clauses.push("COALESCE(route, path) = ?");
    params.push(page);
  }
  if (device !== undefined) {
    clauses.push("device = ?");
    params.push(device);
  }
  if (since !== undefined) {
    clauses.push("ts >= ?");
    params.push(since);
  }
  return { sql: clauses.join(" AND "), params };
}

function samples(db: DatabaseSync, filters: Filters, name?: MetricName) {
  const { sql, params } = where(filters);
  const metric = name ? " AND name = ?" : "";
  return db
    .prepare(`SELECT COALESCE(route, path) AS page, device, name, value, ts FROM vitals WHERE ${sql}${metric} AND ${LATEST_SAMPLE}`)
    .all(...params, ...(name ? [name] : [])) as unknown as Sample[];
}

function summarize(name: MetricName, values: readonly number[]): MetricSummary {
  const counts: RatingCounts = { good: 0, needsImprovement: 0, poor: 0 };
  for (const value of values) {
    const rating = getRating(name, value);
    counts[rating === "needs-improvement" ? "needsImprovement" : rating]++;
  }
  if (values.length === 0) return { name, count: 0, p75: null, rating: null, counts };
  const p75 = percentile(values, 0.75);
  return { name, count: values.length, p75, rating: getRating(name, p75), counts };
}

function groupBy<T>(items: readonly T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

export function getOptions(db: DatabaseSync): Options {
  const column = (sql: string) => db.prepare(sql).all().map((row) => row.value as string);
  const pages = "SELECT COALESCE(route, path) AS value FROM vitals UNION SELECT COALESCE(route, path) FROM pageviews ORDER BY 1 LIMIT 200";
  const devices = "SELECT device AS value FROM vitals UNION SELECT device FROM pageviews ORDER BY 1";
  const environments = new Set(column("SELECT env AS value FROM vitals UNION SELECT env FROM pageviews"));
  return { environments: ENVIRONMENTS.filter((env) => environments.has(env)), pages: column(pages), devices: column(devices) };
}

export function getOverview(db: DatabaseSync, filters: Filters): Overview {
  const all = samples(db, filters);
  const byName = groupBy(all, (sample) => sample.name);
  const { sql, params } = where(filters);
  const views = new Map(
    db
      .prepare(`SELECT COALESCE(route, path) AS page, SUM(1.0 / sample_rate) AS views FROM pageviews WHERE ${sql} GROUP BY page`)
      .all(...params)
      .map((row) => [row.page as string, Math.round(row.views as number)]),
  );
  const byPage = groupBy(all, (sample) => sample.page);
  const names = [...new Set([...views.keys(), ...byPage.keys()])].sort((a, b) => (views.get(b) ?? 0) - (views.get(a) ?? 0) || a.localeCompare(b));

  return {
    metrics: METRIC_NAMES.map((name) => summarize(name, (byName.get(name) ?? []).map((sample) => sample.value))),
    pages: names.slice(0, MAX_ROWS).map((page) => {
      const metrics = groupBy(byPage.get(page) ?? [], (sample) => sample.name);
      const p75 = Object.fromEntries([...metrics].map(([name, items]) => [name, percentile(items.map((item) => item.value), 0.75)]));
      return { page, views: views.get(page) ?? 0, p75 };
    }),
    morePages: Math.max(0, names.length - MAX_ROWS),
  };
}

function timeSeries(items: readonly Sample[]): MetricDetail["series"] {
  const series: MetricDetail["series"] = { x: [], p50: [], p75: [], p95: [] };
  if (items.length === 0) return series;
  const times = items.map((item) => item.ts);
  const span = Math.max(...times) - Math.min(...times);
  // İki ölçümden yüzdelik çıkmaz: az veride kovalar büyür, p75 ile p95 aynı çizgiye düşmez.
  const maxBuckets = Math.max(1, Math.min(MAX_BUCKETS, Math.floor(items.length / MIN_BUCKET_SAMPLES)));
  const step = BUCKETS.find((bucket) => span / bucket <= maxBuckets) ?? BUCKETS.at(-1)!;
  const buckets = [...groupBy(items, (item) => String(Math.floor(item.ts / step) * step))].sort(([a], [b]) => Number(a) - Number(b));
  for (const [time, group] of buckets) {
    const values = group.map((item) => item.value);
    series.x.push(Number(time));
    series.p50.push(percentile(values, 0.5));
    series.p75.push(percentile(values, 0.75));
    series.p95.push(percentile(values, 0.95));
  }
  return series;
}

function histogram(name: MetricName, values: readonly number[]): MetricDetail["histogram"] {
  const width = BIN_WIDTH[name];
  // Değerler eşiğin çok altında olsa da eşikler görünsün; değerlendirme nerede durduğunuzu göstermeli.
  const needed = Math.ceil(Math.max(THRESHOLDS[name].poor + width, ...values) / width - 1e-9);
  const count = Math.min(MAX_BINS, needed);
  const round = (value: number) => Number(value.toFixed(6));
  const bins = Array.from({ length: count }, (_, i) => ({ start: round(i * width), end: round((i + 1) * width), count: 0 }));
  let above = 0;
  for (const value of values) {
    // `getRating` eşiği iyi sayar: aralıklar üstten kapalı, 2500 ms son iyi aralıkta.
    const index = Math.max(0, Math.ceil(value / width - 1e-9) - 1);
    if (index < count) bins[index]!.count++;
    else above++;
  }
  const percentiles = values.length === 0 ? null : { p50: percentile(values, 0.5), p75: percentile(values, 0.75), p95: percentile(values, 0.95) };
  return { bins, above, percentiles };
}

function breakdown(name: MetricName, items: readonly Sample[], key: (item: Sample) => string): BreakdownRow[] {
  return [...groupBy(items, key)]
    .map(([group, rows]) => {
      const p75 = percentile(rows.map((row) => row.value), 0.75);
      return { key: group, count: rows.length, p75, rating: getRating(name, p75) };
    })
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, MAX_ROWS);
}

export function getMetricDetail(db: DatabaseSync, name: MetricName, filters: Filters): MetricDetail {
  const items = samples(db, filters, name);
  const values = items.map((item) => item.value);
  return {
    summary: summarize(name, values),
    series: timeSeries(items),
    histogram: histogram(name, values),
    pages: breakdown(name, items, (item) => item.page),
    devices: breakdown(name, items, (item) => item.device),
  };
}
