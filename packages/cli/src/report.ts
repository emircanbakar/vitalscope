import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { styleText } from "node:util";
import { METRIC_NAMES, getRating, type MetricName, type Rating } from "@vitalscope/protocol";
import { errorGroup } from "./fingerprint.js";
import { DB_FILE } from "./sqlite.js";

const MAX_PAGES = 30;
const MAX_ERRORS = 20;
const PAGE_WIDTH = 40;
const ERROR_WIDTH = 80;
/** Renksiz çıktıda da (dosyaya yönlendirme, `NO_COLOR`) okunabilsin diye değerin yanında işaret. */
const MARKS: Record<Rating, string> = { good: "", "needs-improvement": " ~", poor: " !" };
const COLORS = { good: "green", "needs-improvement": "yellow", poor: "red" } as const;
/** Geliştirme sunucusu ile build'in sayıları tek p75'te karışmasın diye her ortamın kendi tablosu var. */
const ENVIRONMENTS = ["production", "preview", "development"] as const;
const DEV_WARNING = "Development servers run unminified code with HMR, so these numbers differ from a production build.";

/**
 * Yollar ve hata mesajları tarayıcıdan gelir, sayfadaki herhangi bir betik belirleyebilir.
 * Kontrol karakterleri temizlenmezse bir hata mesajı terminale kaçış dizisi basabilir.
 */
function clean(text: string, width: number) {
  const safe = text.toWellFormed().replace(/[\p{Cc}\p{Cf}]/gu, " ");
  return safe.length > width ? `${safe.slice(0, width - 1)}…` : safe;
}

function percentile75(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.75) - 1]!;
}

function formatValue(name: MetricName, value: number) {
  if (name === "CLS") return value.toFixed(2);
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

function more(total: number, shown: number, label: string) {
  return total > shown ? [`…and ${total - shown} more ${label}`] : [];
}

function pagesTable(db: DatabaseSync, env: string) {
  const views = new Map(
    db
      .prepare("SELECT COALESCE(route, path) AS page, SUM(1.0 / sample_rate) AS views FROM pageviews WHERE env = ? GROUP BY page")
      .all(env)
      .map((row) => [row.page as string, Math.round(row.views as number)]),
  );
  // Aynı metrik örneği değeri büyüdükçe yeniden gönderilebilir; sadece son değeri sayılır.
  const samples = db
    .prepare("SELECT COALESCE(route, path) AS page, name, value FROM vitals WHERE env = ? AND rowid IN (SELECT MAX(rowid) FROM vitals GROUP BY session_id, metric_id)")
    .all(env) as { page: string; name: MetricName; value: number }[];

  const byPage = new Map<string, Partial<Record<MetricName, number[]>>>();
  for (const { page, name, value } of samples) {
    const metrics = byPage.get(page) ?? {};
    (metrics[name] ??= []).push(value);
    byPage.set(page, metrics);
  }

  const pages = [...new Set([...views.keys(), ...byPage.keys()])].sort((a, b) => (views.get(b) ?? 0) - (views.get(a) ?? 0) || a.localeCompare(b));
  if (pages.length === 0) return [];

  const rows = pages.slice(0, MAX_PAGES).map((page) => ({
    page: clean(page, PAGE_WIDTH),
    views: String(views.get(page) ?? 0),
    cells: METRIC_NAMES.map((name) => {
      const values = byPage.get(page)?.[name];
      if (!values) return { text: "-", rating: undefined };
      const p75 = percentile75(values);
      const rating = getRating(name, p75);
      return { text: formatValue(name, p75) + MARKS[rating], rating };
    }),
  }));

  const pageWidth = Math.max("Page".length, ...rows.map((row) => row.page.length));
  const viewsWidth = Math.max("Views".length, ...rows.map((row) => row.views.length));
  const widths = METRIC_NAMES.map((name, i) => Math.max(name.length, ...rows.map((row) => row.cells[i]!.text.length)));

  const header = ["Page".padEnd(pageWidth), "Views".padStart(viewsWidth), ...METRIC_NAMES.map((name, i) => name.padStart(widths[i]!))].join("  ");
  const lines = rows.map((row) =>
    [
      row.page.padEnd(pageWidth),
      row.views.padStart(viewsWidth),
      // Hizalama rengi etkilemesin: önce doldurulur, sonra renklenir.
      ...row.cells.map(({ text, rating }, i) => {
        const padded = text.padStart(widths[i]!);
        return rating ? styleText(COLORS[rating], padded, { stream: process.stdout }) : padded;
      }),
    ].join("  "),
  );
  return [header, ...lines, ...more(pages.length, rows.length, "pages")];
}

function errorsList(db: DatabaseSync) {
  const rows = db.prepare("SELECT type, message, stack, sample_rate FROM errors ORDER BY ts DESC, rowid DESC").all() as {
    type: string;
    message: string;
    stack: string;
    sample_rate: number;
  }[];
  // En yeni olay önce geldiği için her grupta son mesaj gösterilir.
  const groups = new Map<string, { title: string; location: string | undefined; total: number }>();
  for (const { type, message, stack, sample_rate } of rows) {
    const { key, location } = errorGroup(type, message, JSON.parse(stack) as string[]);
    const group = groups.get(key) ?? { title: `${type}: ${message}`, location, total: 0 };
    group.total += 1 / sample_rate;
    groups.set(key, group);
  }
  const errors = [...groups.values()].sort((a, b) => b.total - a.total);
  return [
    ...errors.slice(0, MAX_ERRORS).flatMap(({ title, location, total }) => [
      `${String(Math.round(total)).padStart(5)}×  ${clean(title, ERROR_WIDTH)}`,
      ...(location ? [`        at ${clean(location, ERROR_WIDTH)}`] : []),
    ]),
    ...more(errors.length, MAX_ERRORS, "errors"),
  ];
}

/** Toplanan veriden terminal raporu üretir. Veri yoksa klasör oluşturmaz, ne yapılacağını söyler. */
export function buildReport(dir: string): string {
  const file = join(dir, DB_FILE);
  const empty = `No measurements yet. Run "vitalscope dev" and open your site.`;
  if (!existsSync(file)) return empty;

  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const sections = ENVIRONMENTS.flatMap((env) => {
      const pages = pagesTable(db, env);
      if (pages.length === 0) return [];
      return [[`p75 by page, ${env}  (~ needs improvement, ! poor)`, ...(env === "development" ? [DEV_WARNING] : []), "", ...pages]];
    });
    const errors = errorsList(db);
    if (errors.length > 0) sections.push(["Errors", "", ...errors]);
    if (sections.length === 0) return empty;
    return sections.map((section) => section.join("\n")).join("\n\n");
  } finally {
    db.close();
  }
}
