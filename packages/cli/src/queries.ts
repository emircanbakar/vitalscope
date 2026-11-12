import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { METRIC_NAMES, THRESHOLDS, getRating, type MetricName, type Rating } from "@vitalscope/protocol";
import { errorGroup } from "./fingerprint.js";

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

export interface Filters {
  env: Environment;
  page?: string;
  device?: string;
  /** Bu andan (epoch ms) sonraki ölçümler. */
  since?: number;
  release?: string;
}

export interface ErrorGroup {
  id: string;
  type: string;
  /** Grubun en son mesajı. */
  message: string;
  location: string | undefined;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

export interface ErrorList {
  errors: ErrorGroup[];
  moreErrors: number;
}

export interface CountRow {
  key: string;
  count: number;
}

export interface ErrorDetail extends ErrorGroup {
  stack: string[];
  handled: boolean;
  series: { x: number[]; counts: number[] };
  pages: CountRow[];
  devices: CountRow[];
  /** `key` boşsa release verilmeden gönderilmiştir. */
  releases: CountRow[];
}

export interface ReleaseSide {
  count: number;
  p75: number | null;
  rating: Rating | null;
}

export interface Comparison {
  views: { a: number; b: number };
  metrics: { name: MetricName; a: ReleaseSide; b: ReleaseSide }[];
  errors: { id: string; type: string; message: string; location: string | undefined; a: number; b: number }[];
  moreErrors: number;
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
  /** Sadece INP'de: sayfa görüntülemelerinin en yavaş etkileşimleri, en yavaştan başlayarak. */
  interactions?: SlowInteraction[];
}

/** Bir sayfa görüntülemesinin en yavaş etkileşimi; `inInp` yanlışsa INP bu etkileşimi atlamıştır. */
export interface SlowInteraction {
  duration: number;
  inInp: boolean;
  page: string;
  ts: number;
  release: string | null;
  target?: string;
  type?: string;
  event?: string;
  inputDelay?: number;
  processing?: number;
  presentation?: number;
}

/** Büyük dosyada süre satırları JS'e taşımakta geçer; satırlar nesne yerine dizi olarak gelir. */
type Sample = [page: string, device: string, name: MetricName, value: number, ts: number];
const PAGE = 0;
const DEVICE = 1;
const NAME = 2;
const VALUE = 3;
const TS = 4;

/** En yakın sıra yöntemi; `sorted` küçükten büyüğe sıralı ve boş olmamalı. */
export function sortedPercentile(sorted: readonly number[], q: number) {
  return sorted[Math.ceil(sorted.length * q) - 1]!;
}

function where({ env, page, device, since, release }: Partial<Filters>) {
  const clauses = ["1"];
  const params: SQLInputValue[] = [];
  if (env !== undefined) {
    clauses.push("env = ?");
    params.push(env);
  }
  if (release !== undefined) {
    clauses.push("release = ?");
    params.push(release);
  }
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

/**
 * Değere göre sıralı gelir: gruplar da sıralı kalır, yüzdelik için yeniden sıralanmaz.
 * Satırların çoğu okunur; index'ten gidip her satır için tabloya bakmak sırayla taramadan katlarca yavaş.
 */
function samples(db: DatabaseSync, filters: Filters, name?: MetricName) {
  const { sql, params } = where(filters);
  const metric = name ? " AND name = ?" : "";
  const statement = db.prepare(`SELECT COALESCE(route, path), device, name, value, ts FROM vitals NOT INDEXED WHERE ${sql}${metric} ORDER BY value`);
  statement.setReturnArrays(true);
  return statement.all(...params, ...(name ? [name] : [])) as unknown as Sample[];
}

const valuesOf = (items: readonly Sample[]) => items.map((item) => item[VALUE]);

/** `values` sıralı olmalı. */
function summarize(name: MetricName, values: readonly number[]): MetricSummary {
  const counts: RatingCounts = { good: 0, needsImprovement: 0, poor: 0 };
  for (const value of values) {
    const rating = getRating(name, value);
    counts[rating === "needs-improvement" ? "needsImprovement" : rating]++;
  }
  if (values.length === 0) return { name, count: 0, p75: null, rating: null, counts };
  const p75 = sortedPercentile(values, 0.75);
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

/** SDK her sayfa açılışında metriklerden önce pageview gönderir; seçenekler çok daha küçük `pageviews` ve `errors`'tan okunur. */
export function getOptions(db: DatabaseSync): Options {
  const column = (sql: string) => db.prepare(sql).all().map((row) => row.value as string);
  const pages = "SELECT COALESCE(route, path) AS value FROM pageviews UNION SELECT COALESCE(route, path) FROM errors ORDER BY 1 LIMIT 200";
  const devices = "SELECT device AS value FROM pageviews UNION SELECT device FROM errors ORDER BY 1";
  const environments = new Set(column("SELECT env AS value FROM pageviews UNION SELECT env FROM errors"));
  return { environments: ENVIRONMENTS.filter((env) => environments.has(env)), pages: column(pages), devices: column(devices) };
}

/**
 * Satırlar JS'e taşınmaz: sayılar ve yüzdelikler index üzerinde bulunur (`vitals_metric`, `vitals_page`).
 * Yüzdelik, değere göre sıralı index'te en yakın sıradaki satırdır; `sortedPercentile` ile aynı sonucu verir.
 */
export function getOverview(db: DatabaseSync, filters: Filters): Overview {
  const { sql, params } = where(filters);
  const p75At = (extra: string, extraParams: SQLInputValue[], count: number) =>
    db.prepare(`SELECT value FROM vitals WHERE ${sql}${extra} ORDER BY value LIMIT 1 OFFSET ?`).get(...params, ...extraParams, Math.ceil(count * 0.75) - 1)!.value as number;

  const metrics = METRIC_NAMES.map((name): MetricSummary => {
    const { good, poor } = THRESHOLDS[name];
    const row = db.prepare(`SELECT COUNT(*) AS count, TOTAL(value <= ?) AS good, TOTAL(value > ?) AS poor FROM vitals WHERE ${sql} AND name = ?`).get(good, poor, ...params, name)!;
    const count = row.count as number;
    const counts = { good: row.good as number, needsImprovement: count - (row.good as number) - (row.poor as number), poor: row.poor as number };
    if (count === 0) return { name, count, p75: null, rating: null, counts };
    const p75 = p75At(" AND name = ?", [name], count);
    return { name, count, p75, rating: getRating(name, p75), counts };
  });

  const views = new Map(
    db
      .prepare(`SELECT COALESCE(route, path) AS page, SUM(1.0 / sample_rate) AS views FROM pageviews WHERE ${sql} GROUP BY page`)
      .all(...params)
      .map((row) => [row.page as string, Math.round(row.views as number)]),
  );
  // Sayfa seçiliyse sayılar metriklerinkiyle aynı. Sorgu sayfa ifadesini her satırda tablodan okur, 1 milyon olayda ≈ 0,8 sn.
  const counts =
    filters.page === undefined
      ? (db.prepare(`SELECT COALESCE(route, path) AS page, name, COUNT(*) AS count FROM vitals WHERE ${sql} GROUP BY page, name`).all(...params) as unknown as { page: string; name: MetricName; count: number }[])
      : metrics.filter(({ count }) => count > 0).map(({ name, count }) => ({ page: filters.page!, name, count }));
  const groups = groupBy(counts, (group) => group.page);
  const names = [...new Set([...views.keys(), ...groups.keys()])].sort((a, b) => (views.get(b) ?? 0) - (views.get(a) ?? 0) || a.localeCompare(b));

  return {
    metrics,
    // Yüzdelik sadece gösterilen sayfalar için aranır.
    pages: names.slice(0, MAX_ROWS).map((page) => {
      const p75 = Object.fromEntries((groups.get(page) ?? []).map(({ name, count }) => [name, p75At(" AND COALESCE(route, path) = ? AND name = ?", [page, name], count)]));
      return { page, views: views.get(page) ?? 0, p75 };
    }),
    morePages: Math.max(0, names.length - MAX_ROWS),
  };
}

function timeSeries(items: readonly Sample[]): MetricDetail["series"] {
  const series: MetricDetail["series"] = { x: [], p50: [], p75: [], p95: [] };
  if (items.length === 0) return series;
  const times = items.map((item) => item[TS]);
  const span = maxOf(times) - minOf(times);
  // İki ölçümden yüzdelik çıkmaz: az veride kovalar büyür, p75 ile p95 aynı çizgiye düşmez.
  const maxBuckets = Math.max(1, Math.min(MAX_BUCKETS, Math.floor(items.length / MIN_BUCKET_SAMPLES)));
  const step = BUCKETS.find((bucket) => span / bucket <= maxBuckets) ?? BUCKETS.at(-1)!;
  const buckets = [...groupBy(items, (item) => String(Math.floor(item[TS] / step) * step))].sort(([a], [b]) => Number(a) - Number(b));
  for (const [time, group] of buckets) {
    const values = valuesOf(group);
    series.x.push(Number(time));
    series.p50.push(sortedPercentile(values, 0.5));
    series.p75.push(sortedPercentile(values, 0.75));
    series.p95.push(sortedPercentile(values, 0.95));
  }
  return series;
}

/** `values` sıralı olmalı. */
function histogram(name: MetricName, values: readonly number[]): MetricDetail["histogram"] {
  const width = BIN_WIDTH[name];
  // Değerler eşiğin çok altında olsa da eşikler görünsün; değerlendirme nerede durduğunuzu göstermeli.
  const needed = Math.ceil(Math.max(THRESHOLDS[name].poor + width, values.at(-1) ?? 0) / width - 1e-9);
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
  const percentiles = values.length === 0 ? null : { p50: sortedPercentile(values, 0.5), p75: sortedPercentile(values, 0.75), p95: sortedPercentile(values, 0.95) };
  return { bins, above, percentiles };
}

function breakdown(name: MetricName, items: readonly Sample[], key: (item: Sample) => string): BreakdownRow[] {
  return [...groupBy(items, key)]
    .map(([group, rows]) => {
      const p75 = sortedPercentile(valuesOf(rows), 0.75);
      return { key: group, count: rows.length, p75, rating: getRating(name, p75) };
    })
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, MAX_ROWS);
}

const MAX_INTERACTIONS = 20;

interface InteractionRow {
  page: string;
  ts: number;
  release: string | null;
  value: number;
  target: string | null;
  type: string | null;
  attr: string | null;
}

type InteractionDetails = Pick<SlowInteraction, "target" | "type" | "event" | "inputDelay" | "processing" | "presentation">;

/**
 * INP 50'den fazla etkileşimde en yavaşını atlar; SDK atlanan etkileşimi `slowest` olarak gönderir.
 * Her sayfa görüntülemesinin en yavaş etkileşimi ya o ya da INP'nin kendisidir.
 */
function slowInteractions(db: DatabaseSync, filters: Filters): SlowInteraction[] {
  const { sql, params } = where(filters);
  const rows = db
    .prepare(
      `SELECT COALESCE(route, path) AS page, ts, release, value, attr_target AS target, attr_type AS type, attr FROM vitals
       WHERE ${sql} AND name = 'INP' ORDER BY COALESCE(json_extract(attr, '$.slowest.duration'), value) DESC, ts DESC LIMIT ?`,
    )
    .all(...params, MAX_INTERACTIONS) as unknown as InteractionRow[];
  return rows.map(({ page, ts, release, value, target, type, attr }) => {
    const { slowest, event, inputDelay, processing, presentation } = (attr ? JSON.parse(attr) : {}) as InteractionDetails & { slowest?: InteractionDetails & { duration: number } };
    const common = { page, ts, release };
    if (slowest) return { duration: slowest.duration, inInp: false, ...common, ...pick(slowest) };
    return { duration: value, inInp: true, ...common, ...pick({ target, type, event, inputDelay, processing, presentation }) };
  });
}

const DETAIL_KEYS = ["target", "type", "event", "inputDelay", "processing", "presentation"];

/** Sadece gösterilen alanlar; boş olanlar atılır. */
function pick(fields: object): InteractionDetails {
  return Object.fromEntries(Object.entries(fields).filter(([key, value]) => DETAIL_KEYS.includes(key) && value !== undefined && value !== null));
}

export function getMetricDetail(db: DatabaseSync, name: MetricName, filters: Filters): MetricDetail {
  const items = samples(db, filters, name);
  const values = valuesOf(items);
  return {
    summary: summarize(name, values),
    series: timeSeries(items),
    histogram: histogram(name, values),
    pages: breakdown(name, items, (item) => item[PAGE]),
    devices: breakdown(name, items, (item) => item[DEVICE]),
    ...(name === "INP" && { interactions: slowInteractions(db, filters) }),
  };
}

interface ErrorRow {
  id: string;
  type: string;
  message: string;
  location: string | undefined;
  stack: string[];
  handled: number;
  page: string;
  device: string;
  release: string | null;
  ts: number;
  weight: number;
}

/** En yeni olay önce; her grubun ilk satırı son mesajı ve son stack'i taşır. */
function errorRows(db: DatabaseSync, filters: Partial<Filters>) {
  const { sql, params } = where(filters);
  const rows = db
    .prepare(`SELECT type, message, stack, handled, COALESCE(route, path) AS page, device, release, ts, sample_rate FROM errors WHERE ${sql} ORDER BY ts DESC, rowid DESC`)
    .all(...params) as unknown as (Omit<ErrorRow, "id" | "location" | "stack" | "weight"> & { stack: string; sample_rate: number })[];
  return rows.map(({ stack, sample_rate, ...row }): ErrorRow => {
    const frames = JSON.parse(stack) as string[];
    const { id, location } = errorGroup(row.type, row.message, frames);
    return { ...row, id, location, stack: frames, weight: 1 / sample_rate };
  });
}

function toGroup(rows: readonly ErrorRow[]): ErrorGroup {
  const { id, type, message, location, ts: lastSeen } = rows[0]!;
  const count = Math.round(rows.reduce((sum, row) => sum + row.weight, 0));
  return { id, type, message, location, count, firstSeen: rows.at(-1)!.ts, lastSeen };
}

/** Rapor ve panel aynı gruplamayı kullanır: aynı hata ikisinde de aynı sayılır. */
export function getErrorGroups(db: DatabaseSync, filters: Partial<Filters>): ErrorGroup[] {
  const groups = [...groupBy(errorRows(db, filters), (row) => row.id).values()].map(toGroup);
  return groups.sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
}

export function getErrorList(db: DatabaseSync, filters: Filters): ErrorList {
  const groups = getErrorGroups(db, filters);
  return { errors: groups.slice(0, MAX_ROWS), moreErrors: Math.max(0, groups.length - MAX_ROWS) };
}

function countBy(rows: readonly ErrorRow[], key: (row: ErrorRow) => string): CountRow[] {
  return [...groupBy(rows, key)]
    .map(([group, items]) => ({ key: group, count: Math.round(items.reduce((sum, item) => sum + item.weight, 0)) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, MAX_ROWS);
}

/** Boş kovalar sıfırla doldurulur: hatasız geçen süre çizgide görünmeli. */
function occurrences(rows: readonly ErrorRow[]): ErrorDetail["series"] {
  const times = rows.map((row) => row.ts);
  const first = minOf(times);
  const last = maxOf(times);
  const step = BUCKETS.find((bucket) => (last - first) / bucket <= MAX_BUCKETS) ?? BUCKETS.at(-1)!;
  const start = Math.floor(first / step) * step;
  const x = Array.from({ length: Math.floor((last - start) / step) + 1 }, (_, i) => start + i * step);
  const totals = x.map(() => 0);
  for (const { ts, weight } of rows) totals[Math.floor((ts - start) / step)]! += weight;
  return { x, counts: totals.map(Math.round) };
}

/** Bu filtrelerde hatası yoksa `null`. */
export function getErrorDetail(db: DatabaseSync, id: string, filters: Filters): ErrorDetail | null {
  const rows = errorRows(db, filters).filter((row) => row.id === id);
  if (rows.length === 0) return null;
  return {
    ...toGroup(rows),
    stack: rows[0]!.stack,
    handled: rows[0]!.handled === 1,
    series: occurrences(rows),
    pages: countBy(rows, (row) => row.page),
    devices: countBy(rows, (row) => row.device),
    releases: countBy(rows, (row) => row.release ?? ""),
  };
}

/** Son görülen önce. */
export function getReleases(db: DatabaseSync, filters: Filters): string[] {
  const { sql, params } = where(filters);
  // `vitals`'ın index'leri `release` taşımaz; sırayla taramak her satırda tabloya dönmekten hızlı.
  const union = ["vitals NOT INDEXED", "pageviews", "errors"].map((table) => `SELECT release, ts FROM ${table} WHERE ${sql}`).join(" UNION ALL ");
  return db
    .prepare(`SELECT release FROM (${union}) WHERE release IS NOT NULL GROUP BY release ORDER BY MAX(ts) DESC LIMIT ${MAX_ROWS}`)
    .all(...params, ...params, ...params)
    .map((row) => row.release as string);
}

export function getComparison(db: DatabaseSync, filters: Filters, a: string, b: string): Comparison {
  const views = (release: string) => {
    const { sql, params } = where({ ...filters, release });
    const row = db.prepare(`SELECT SUM(1.0 / sample_rate) AS views FROM pageviews WHERE ${sql}`).get(...params);
    return Math.round((row?.views as number | null) ?? 0);
  };
  const side = (release: string) => groupBy(samples(db, { ...filters, release }), (sample) => sample[NAME]);
  const metricsA = side(a);
  const metricsB = side(b);
  const pick = (name: MetricName, groups: Map<string, Sample[]>): ReleaseSide => {
    const { count, p75, rating } = summarize(name, valuesOf(groups.get(name) ?? []));
    return { count, p75, rating };
  };

  const errorsA = new Map(getErrorGroups(db, { ...filters, release: a }).map((group) => [group.id, group]));
  const errorsB = new Map(getErrorGroups(db, { ...filters, release: b }).map((group) => [group.id, group]));
  const errors = [...new Set([...errorsB.keys(), ...errorsA.keys()])]
    .map((id) => {
      const { type, message, location } = (errorsB.get(id) ?? errorsA.get(id))!;
      return { id, type, message, location, a: errorsA.get(id)?.count ?? 0, b: errorsB.get(id)?.count ?? 0 };
    })
    // Yeni release'te en çok görülen önce.
    .sort((x, y) => y.b - x.b || y.a - x.a);

  return {
    views: { a: views(a), b: views(b) },
    metrics: METRIC_NAMES.map((name) => ({ name, a: pick(name, metricsA), b: pick(name, metricsB) })),
    errors: errors.slice(0, MAX_ROWS),
    moreErrors: Math.max(0, errors.length - MAX_ROWS),
  };
}

function minOf(values: readonly number[]) {
  return values.reduce((min, value) => Math.min(min, value), Infinity);
}

function maxOf(values: readonly number[]) {
  return values.reduce((max, value) => Math.max(max, value), -Infinity);
}
