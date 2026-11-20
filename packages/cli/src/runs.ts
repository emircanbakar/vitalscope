import type { DatabaseSync } from "node:sqlite";
import { METRIC_NAMES, getRating, type MetricName, type Rating } from "@vitalscope/protocol";
import { compareMeasured, type Change } from "./change.js";
import { slowInteractions, sortedPercentile, type SlowInteraction } from "./queries.js";
import { clean, formatValue } from "./report.js";

const SHOWN_INTERACTIONS = 3;
const TARGET_WIDTH = 40;
const PAGE_WIDTH = 40;
const MARKS: Record<Rating, string> = { good: "", "needs-improvement": " ~", poor: " !" };

export interface RunRecord {
  /** Projeye göre yol; aynı senaryonun önceki çalıştırması bununla bulunur. */
  scenario: string;
  label: string;
  url: string;
  cpuRate: number;
  /** İstenen oturum sayısı; çok sayfalı senaryoda her sayfa açılışı ayrı oturumdur. */
  runs: number;
  startedAt: number;
  endedAt: number;
}

export function saveRun(db: DatabaseSync, run: RunRecord, sessions: Iterable<string>): number {
  db.exec("BEGIN");
  try {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO runs (scenario, label, url, cpu_rate, runs, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(run.scenario, run.label, run.url, run.cpuRate, run.runs, run.startedAt, run.endedAt);
    const insert = db.prepare("INSERT OR IGNORE INTO run_sessions (run_id, session_id) VALUES (?, ?)");
    for (const session of sessions) insert.run(lastInsertRowid, session);
    db.exec("COMMIT");
    return Number(lastInsertRowid);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export interface RunMetric {
  name: MetricName;
  /** Bu metriği gönderen sayfa görüntülemeleri. */
  count: number;
  median: number | null;
  min: number | null;
  max: number | null;
}

export interface RunInfo {
  id: number;
  label: string;
  sessions: number;
  pageViews: number;
  metrics: RunMetric[];
}

export interface RunSummary extends RunInfo {
  scenario: string;
  url: string;
  cpuRate: number;
  runs: number;
  previous: RunInfo | null;
  changes: Partial<Record<MetricName, Change>>;
  interactions: SlowInteraction[];
}

function runInfo(db: DatabaseSync, id: number, label: string): RunInfo {
  const count = (sql: string) => (db.prepare(sql).get(id) as { n: number }).n;
  const sessions = count("SELECT COUNT(*) AS n FROM run_sessions WHERE run_id = ?");
  const pageViews = count("SELECT COUNT(*) AS n FROM pageviews WHERE session_id IN (SELECT session_id FROM run_sessions WHERE run_id = ?)");
  const values = db
    .prepare("SELECT name, value FROM vitals WHERE session_id IN (SELECT session_id FROM run_sessions WHERE run_id = ?) ORDER BY value")
    .all(id) as { name: MetricName; value: number }[];
  const metrics = METRIC_NAMES.map((name): RunMetric => {
    const sorted = values.filter((row) => row.name === name).map((row) => row.value);
    if (sorted.length === 0) return { name, count: 0, median: null, min: null, max: null };
    return { name, count: sorted.length, median: sortedPercentile(sorted, 0.5), min: sorted[0]!, max: sorted.at(-1)! };
  });
  return { id, label, sessions, pageViews, metrics };
}

/** Çalıştırmanın özeti ve aynı senaryonun bir önceki çalıştırmasıyla karşılaştırma. */
export function getRunSummary(db: DatabaseSync, id: number): RunSummary {
  const run = db.prepare("SELECT scenario, label, url, cpu_rate AS cpuRate, runs FROM runs WHERE id = ?").get(id) as Pick<RunSummary, "scenario" | "label" | "url" | "cpuRate" | "runs"> | undefined;
  if (!run) throw new Error(`No run with id ${id}`);
  const previousRow = db.prepare("SELECT id, label FROM runs WHERE scenario = ? AND id < ? ORDER BY id DESC LIMIT 1").get(run.scenario, id) as { id: number; label: string } | undefined;

  const info = runInfo(db, id, run.label);
  const previous = previousRow ? runInfo(db, previousRow.id, previousRow.label) : null;
  const changes: RunSummary["changes"] = {};
  if (previous) {
    for (const metric of info.metrics) {
      const before = previous.metrics.find((m) => m.name === metric.name)!;
      changes[metric.name] = compareMeasured(metric.name, { value: before.median, count: before.count }, { value: metric.median, count: metric.count });
    }
  }
  return { ...info, scenario: run.scenario, url: run.url, cpuRate: run.cpuRate, runs: run.runs, previous, changes, interactions: slowInteractions(db, { run: id }, SHOWN_INTERACTIONS) };
}

function describe(name: MetricName, change: Change | undefined): string {
  if (change === undefined) return "-";
  switch (change.kind) {
    case "no-data":
      return "-";
    case "too-few":
      return "too few measurements";
    case "same":
      return "about the same";
    default: {
      const sign = change.difference > 0 ? "+" : "-";
      const percent = Number.isFinite(change.ratio) ? ` (${sign}${Math.round(change.ratio * 100)}%)` : "";
      const word = name === "CLS" ? (change.kind === "worse" ? "worse" : "better") : change.kind === "worse" ? "slower" : "faster";
      // Renksiz çıktıda da görünsün: kötüleşme raporun "poor" işaretiyle başlar.
      return `${change.kind === "worse" ? "! " : ""}${word}, ${sign}${formatValue(name, Math.abs(change.difference))}${percent}`;
    }
  }
}

function table(rows: string[][]): string[] {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));
  return rows.map((row) => row.map((cell, i) => cell.padEnd(widths[i]!)).join("  ").trimEnd());
}

const valueText = (name: MetricName, value: number | null) => (value === null ? "-" : formatValue(name, value));

export function formatRunSummary(summary: RunSummary): string {
  const { previous } = summary;
  const head = `vitalscope run: ${clean(summary.scenario, 80)}, label ${clean(summary.label, 40)}, ${summary.runs} runs, CPU ${summary.cpuRate.toFixed(1)}×`;

  const header = ["Metric", "Median", "Range", "Measured", ...(previous ? [`Previous (${clean(previous.label, 20)})`, "Change"] : [])];
  const rows = summary.metrics.map((metric) => {
    const before = previous?.metrics.find((m) => m.name === metric.name);
    const median = metric.median === null ? "-" : formatValue(metric.name, metric.median) + MARKS[getRating(metric.name, metric.median)];
    const range = metric.min === null || metric.max === null ? "-" : `${formatValue(metric.name, metric.min)} – ${formatValue(metric.name, metric.max)}`;
    return [
      metric.name,
      median,
      range,
      `${metric.count}/${summary.pageViews}`,
      ...(before ? [valueText(metric.name, before.median), describe(metric.name, summary.changes[metric.name])] : []),
    ];
  });

  const lines = [head, "", ...table([header, ...rows]), "", "~ needs improvement, ! poor. Measured: page views that sent the metric."];
  if (!previous) lines.push("No earlier run of this scenario to compare with.");
  if (summary.interactions.length > 0) {
    lines.push("", "Slowest interactions");
    for (const row of summary.interactions) {
      const phases = [
        row.inputDelay === undefined ? null : `input delay ${formatValue("INP", row.inputDelay)}`,
        row.processing === undefined ? null : `processing ${formatValue("INP", row.processing)}`,
        row.presentation === undefined ? null : `presentation ${formatValue("INP", row.presentation)}`,
      ].filter((part) => part !== null);
      const what = [row.target ?? "-", row.event ?? row.type].filter((part) => part !== undefined).join(" ");
      lines.push(
        `  ${formatValue("INP", row.duration).padStart(7)}${row.inInp ? "" : " (not in INP)"}  ${clean(what, TARGET_WIDTH)}  ${clean(row.page, PAGE_WIDTH)}`,
        ...(phases.length > 0 ? [`           ${phases.join(", ")}`] : []),
      );
    }
  }
  return lines.join("\n");
}
