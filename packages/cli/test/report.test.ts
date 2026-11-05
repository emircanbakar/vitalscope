import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildReport } from "../src/report.js";
import { openStore } from "../src/sqlite.js";
import type { StoredEvent } from "../src/types.js";

const NOW = Date.now();
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "vitalscope-report-"));
  dirs.push(dir);
  return dir;
}

type Ctx = Partial<StoredEvent["ctx"]>;
const stored = (event: StoredEvent["event"], ctx: Ctx = {}): StoredEvent => ({
  receivedAt: NOW,
  sdk: "0.1.1",
  ctx: { sid: "0123456789abcdef", path: "/", env: "production", device: "desktop", sr: 1, ...ctx },
  event,
});
const pageview = (ctx: Ctx = {}) => stored({ t: "pageview", ts: NOW }, ctx);
let nextId = 0;
const vital = (name: "LCP" | "INP" | "CLS" | "FCP" | "TTFB", value: number, ctx: Ctx = {}, id = `m${nextId++}`) =>
  stored({ t: "vital", ts: NOW, name, value, rating: "good", id }, ctx);
const error = (msg: string, type = "TypeError", ctx: Ctx = {}) => stored({ t: "error", ts: NOW, type, msg, stack: [], handled: false }, ctx);

async function reportOf(events: StoredEvent[]) {
  const dir = tempDir();
  const store = openStore(dir);
  await store.sink.write(events);
  store.close();
  return buildReport(dir);
}

/** Tablo satırını sütunlara böler. */
const cells = (report: string, page: string) =>
  report
    .split("\n")
    .find((line) => line.startsWith(page))
    ?.trim()
    .split(/\s{2,}/);

describe("buildReport", () => {
  it("says what to do when nothing was collected, without creating the folder", () => {
    const dir = join(tempDir(), "yok");
    expect(buildReport(dir)).toContain("vitalscope dev");
    expect(existsSync(dir)).toBe(false);
  });

  it("says the same for a database with no rows", async () => {
    expect(await reportOf([])).toContain("vitalscope dev");
  });

  it("uses the 75th percentile per page and metric", async () => {
    const report = await reportOf([pageview(), ...[100, 200, 300, 400].map((value) => vital("LCP", value))]);
    expect(cells(report, "/")).toEqual(["/", "1", "300 ms", "-", "-", "-", "-"]);
  });

  it("counts only the last value of a repeated metric", async () => {
    const report = await reportOf([vital("CLS", 0.5, {}, "same"), vital("CLS", 0.01, {}, "same")]);
    expect(cells(report, "/")).toEqual(["/", "0", "-", "-", "0.01", "-", "-"]);
  });

  it("keeps the same metric id from different sessions apart", async () => {
    const report = await reportOf([vital("LCP", 100, {}, "same"), vital("LCP", 900, { sid: "fedcba9876543210" }, "same")]);
    expect(cells(report, "/")?.[2]).toBe("900 ms");
  });

  it("groups by route template and sorts pages by views", async () => {
    const report = await reportOf([
      pageview({ path: "/other" }),
      pageview({ path: "/products/1", route: "/products/[id]" }),
      pageview({ path: "/products/2", route: "/products/[id]" }),
    ]);
    expect(cells(report, "/products/[id]")?.[1]).toBe("2");
    expect(report.indexOf("/products/[id]")).toBeLessThan(report.indexOf("/other"));
    expect(report).not.toContain("/products/1");
  });

  it("scales counts by the sample rate", async () => {
    const report = await reportOf([pageview({ sr: 0.5 }), error("boom", "Error", { sr: 0.5 })]);
    expect(cells(report, "/")?.[1]).toBe("2");
    expect(report).toContain("2×  Error: boom");
  });

  it("marks ratings without relying on color", async () => {
    const report = await reportOf([vital("LCP", 2000), vital("INP", 300), vital("TTFB", 5000)]);
    expect(cells(report, "/")).toEqual(["/", "0", "2.00 s", "300 ms ~", "-", "-", "5.00 s !"]);
  });

  it("groups errors and lists the most frequent first", async () => {
    const report = await reportOf([error("rare"), error("often"), error("often")]);
    expect(report).toContain("2×  TypeError: often");
    expect(report.indexOf("often")).toBeLessThan(report.indexOf("rare"));
    expect(report).not.toContain("p75 by page");
  });

  it("removes terminal control sequences from page data", async () => {
    const hostile = "\u001b]0;pwned\u0007\u001b[2Jboom\r\n‮\ud800";
    const report = await reportOf([pageview({ path: `/\u001b[31mred` }), error(hostile, `\u001b[2J`)]);
    // Satır sonu tablonun kendisinden gelir; başka kontrol karakteri kalmamalı.
    expect(report.replaceAll("\n", "")).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    expect(report.isWellFormed()).toBe(true);
    expect(report).toContain("boom");
  });

  it("shortens long values and says how many rows are hidden", async () => {
    const pages = Array.from({ length: 35 }, (_, i) => pageview({ path: `/${i}` }));
    const errors = Array.from({ length: 25 }, (_, i) => error(`e${i} ${"x".repeat(200)}`));
    const report = await reportOf([...pages, ...errors]);
    expect(report).toContain("…and 5 more pages");
    expect(report).toContain("…and 5 more errors");
    expect(Math.max(...report.split("\n").map((line) => line.length))).toBeLessThan(120);
  });

  it("never mixes environments in one p75", async () => {
    const report = await reportOf([
      pageview({ env: "development" }),
      vital("LCP", 4000, { env: "development" }),
      pageview({ env: "production" }),
      pageview({ env: "production" }),
      vital("LCP", 500, { env: "production" }),
    ]);
    const [production, development] = report.split("p75 by page, development");
    expect(production).toContain("500 ms");
    expect(production).not.toContain("4.00 s");
    expect(development).toContain("4.00 s");
    expect(development).not.toContain("500 ms");
    expect(cells(production!, "/")?.[1]).toBe("2");
    expect(cells(development!, "/")?.[1]).toBe("1");
  });

  it("warns about development numbers only when there are any", async () => {
    expect(await reportOf([vital("LCP", 500, { env: "development" })])).toContain("differ from a production build");
    expect(await reportOf([vital("LCP", 500, { env: "production" })])).not.toContain("differ from a production build");
  });
});
