import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareMeasured } from "../src/change.js";
import { formatRunSummary, getRunSummary, saveRun, type RunRecord } from "../src/runs.js";
import { openStore, type Store } from "../src/sqlite.js";
import type { StoredEvent } from "../src/types.js";

const NOW = Date.UTC(2026, 10, 20, 12);
const opened: { store: Store; dir: string }[] = [];

afterEach(() => {
  for (const { store, dir } of opened.splice(0)) {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function storeWith() {
  const dir = mkdtempSync(join(tmpdir(), "vitalscope-runs-"));
  const store = openStore(dir);
  opened.push({ store, dir });
  return store;
}

const sid = (n: number) => n.toString(16).padStart(16, "0");
const ctx = (session: number): StoredEvent["ctx"] => ({ sid: sid(session), path: "/draw", env: "production", device: "desktop", sr: 1 });
const at = (session: number, event: StoredEvent["event"]): StoredEvent => ({ receivedAt: NOW, sdk: "0.3.0", ctx: ctx(session), event });

/** Her oturum: bir sayfa görüntüleme, LCP ve INP (verilmişse). */
function sessionEvents(session: number, lcp: number, inp?: number, attr?: object): StoredEvent[] {
  return [
    at(session, { t: "pageview", ts: NOW }),
    at(session, { t: "vital", ts: NOW, name: "LCP", value: lcp, rating: "good", id: `lcp-${session}` }),
    ...(inp === undefined ? [] : [at(session, { t: "vital", ts: NOW, name: "INP", value: inp, rating: "good", id: `inp-${session}`, ...(attr && { attr }) })]),
  ];
}

const record = (label: string, scenario = "scenarios/editor.js"): RunRecord => ({ scenario, label, url: "http://localhost:4173/", cpuRate: 4.2, runs: 5, startedAt: NOW, endedAt: NOW + 1000 });

async function addRun(store: Store, label: string, first: number, values: [lcp: number, inp?: number][], scenario?: string) {
  const sessions = values.map((_, i) => first + i);
  await store.sink.write(values.flatMap(([lcp, inp], i) => sessionEvents(first + i, lcp, inp)));
  return saveRun(store.db, record(label, scenario), sessions.map(sid));
}

describe("compareMeasured", () => {
  it("gives the panel's verdicts", () => {
    expect(compareMeasured("INP", { value: null, count: 0 }, { value: 100, count: 5 })).toEqual({ kind: "no-data" });
    expect(compareMeasured("INP", { value: 100, count: 4 }, { value: 900, count: 5 })).toEqual({ kind: "too-few" });
    expect(compareMeasured("INP", { value: 100, count: 5 }, { value: 115, count: 5 })).toEqual({ kind: "same" });
    expect(compareMeasured("INP", { value: 1000, count: 5 }, { value: 1040, count: 5 })).toEqual({ kind: "same" });
    expect(compareMeasured("INP", { value: 112, count: 5 }, { value: 752, count: 5 })).toMatchObject({ kind: "worse", difference: 640 });
    expect(compareMeasured("CLS", { value: 0, count: 5 }, { value: 0.1, count: 5 })).toMatchObject({ kind: "worse", ratio: Infinity });
    expect(compareMeasured("LCP", { value: 2000, count: 5 }, { value: 1000, count: 5 })).toMatchObject({ kind: "better", difference: -1000, ratio: 0.5 });
  });
});

describe("runs", () => {
  it("summarizes only the run's own sessions", async () => {
    const store = storeWith();
    // Elle gezinme: run'a ait değil, özete girmez.
    await store.sink.write(sessionEvents(99, 9000, 9000));
    const id = await addRun(store, "a1b2c3d", 1, [[1300, 720], [1200, 752], [1180, 760], [1250], [1210, 784]]);

    const summary = getRunSummary(store.db, id);
    expect(summary).toMatchObject({ label: "a1b2c3d", sessions: 5, pageViews: 5, runs: 5, previous: null, changes: {} });
    expect(summary.metrics.find((m) => m.name === "LCP")).toEqual({ name: "LCP", count: 5, median: 1210, min: 1180, max: 1300 });
    expect(summary.metrics.find((m) => m.name === "INP")).toEqual({ name: "INP", count: 4, median: 752, min: 720, max: 784 });
    expect(summary.metrics.find((m) => m.name === "CLS")).toEqual({ name: "CLS", count: 0, median: null, min: null, max: null });
    expect(summary.interactions.map((row) => row.duration)).toEqual([784, 760, 752]);
  });

  it("compares with the previous run of the same scenario", async () => {
    const store = storeWith();
    await addRun(store, "old", 1, Array.from({ length: 5 }, () => [1200, 112] as [number, number]));
    await addRun(store, "other", 10, Array.from({ length: 5 }, () => [5000, 5000] as [number, number]), "scenarios/other.js");
    const id = await addRun(store, "new", 20, Array.from({ length: 5 }, () => [1220, 752] as [number, number]));

    const summary = getRunSummary(store.db, id);
    expect(summary.previous?.label).toBe("old");
    expect(summary.changes.LCP).toEqual({ kind: "same" });
    expect(summary.changes.INP).toMatchObject({ kind: "worse", difference: 640 });
    expect(summary.changes.CLS).toEqual({ kind: "no-data" });

    const text = formatRunSummary(summary);
    expect(text).toContain("vitalscope run: scenarios/editor.js, label new, 5 runs, CPU 4.2×");
    expect(text).toMatch(/INP\s+752 ms !\s+752 ms – 752 ms\s+5\/5\s+112 ms\s+! slower, \+640 ms \(\+571%\)/);
    expect(text).toMatch(/LCP\s+1\.22 s\s+.*about the same/);
    expect(text).not.toContain("No earlier run");
  });

  it("says when there is nothing to compare with and lists the slowest interactions", async () => {
    const store = storeWith();
    const hostile = "div#x\u001b[31m";
    await store.sink.write([
      ...sessionEvents(1, 1000, 120, { target: "button#buy", event: "click", inputDelay: 2, processing: 100, presentation: 18, slowest: { duration: 500, target: hostile, event: "keydown", inputDelay: 400, processing: 30, presentation: 70 } }),
    ]);
    const text = formatRunSummary(getRunSummary(store.db, saveRun(store.db, record("only"), [sid(1)])));
    expect(text).toContain("No earlier run of this scenario to compare with.");
    expect(text).toContain("Slowest interactions");
    expect(text).toContain("500 ms (not in INP)  div#x [31m keydown  /draw");
    expect(text).toContain("input delay 400 ms, processing 30 ms, presentation 70 ms");
    expect(text).not.toContain("\u001b");
  });

  it("fails for an unknown run", () => {
    expect(() => getRunSummary(storeWith().db, 42)).toThrow("No run with id 42");
  });
});
