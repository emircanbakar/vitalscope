import { execFileSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import type { BrowserType, Page } from "playwright";
import { isAllowedOrigin } from "./origin.js";
import { formatRunSummary, getRunSummary, saveRun } from "./runs.js";
import { openStore } from "./sqlite.js";
import { start } from "./start.js";

/** Kullanıcıya olduğu gibi gösterilen hata; çıkış kodu 1. */
export class RunError extends Error {}

export interface RunOptions {
  scenario: string;
  url: string;
  runs: number;
  /** `auto`: orta seviye telefona göre kalibre edilir. */
  cpu: number | "auto";
  label?: string;
  dir: string;
  port: number;
  json: boolean;
}

export type Scenario = (context: { page: Page }) => Promise<void> | void;

/** Sayfa kapandıktan sonra son partinin gelmesi için beklenen sessizlik. */
const QUIET_MS = 300;
const SETTLE_TIMEOUT_MS = 5_000;

/**
 * SDK performans testleriyle aynı kalibrasyon (apps/playground/e2e/perf.spec.ts): sabit bir JS işi
 * referans makinede (Intel Core i5-12500) ≈ 27 ms sürüyor; hedef cihazda 4 katı sürmesi beklenir.
 */
const BENCHMARK_REFERENCE_MS = 27;
const TARGET_BENCHMARK_MS = BENCHMARK_REFERENCE_MS * 4;
const MAX_CPU_RATE = 20;

const INSTALL_HINT = `vitalscope run needs Playwright and its Chromium:

  npm install --save-dev playwright
  npx playwright install chromium`;

type ImportPlaywright = () => Promise<{ chromium: BrowserType }>;

async function loadChromium(importPlaywright: ImportPlaywright): Promise<BrowserType> {
  try {
    return (await importPlaywright()).chromium;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") throw new RunError(INSTALL_HINT);
    throw error;
  }
}

async function loadScenario(file: string): Promise<Scenario> {
  let module: { default?: unknown };
  try {
    module = (await import(pathToFileURL(resolve(file)).href)) as { default?: unknown };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" && (error as Error).message.includes(resolve(file))) throw new RunError(`Scenario not found: ${file}`);
    throw error;
  }
  if (typeof module.default !== "function") throw new RunError(`${file} must have a default export: a function that receives { page }.`);
  return module.default as Scenario;
}

/** Commit varsa kısa SHA, yoksa zaman. */
function defaultLabel(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return new Date().toISOString().slice(0, 19).replace("T", " ");
  }
}

/** Yavaşlatmasız sabit bir JS işinin (nesne, string, sıralama, regex) medyan süresi. */
async function benchmark(page: Page): Promise<number> {
  const times = await page.evaluate(() => {
    const result: number[] = [];
    for (let round = 0; round < 7; round++) {
      const begin = performance.now();
      const rows: { id: number; name: string }[] = [];
      for (let i = 0; i < 100_000; i++) rows.push({ id: (i * 7919) % 100_000, name: `row-${i}` });
      rows.sort((a, b) => a.id - b.id);
      const text = JSON.stringify(rows);
      (globalThis as { __sink?: number }).__sink = text.match(/row-\d+5"/g)?.length ?? 0;
      result.push(performance.now() - begin);
    }
    return result;
  });
  const warm = times.slice(1).sort((a, b) => a - b);
  return (warm[2]! + warm[3]!) / 2;
}

const log = (message: string) => process.stderr.write(`${message}\n`);

/** `importPlaywright` sadece testte değişir. */
export async function runScenario(options: RunOptions, importPlaywright: ImportPlaywright = () => import("playwright")): Promise<string> {
  if (!isAllowedOrigin(options.url)) throw new RunError(`--url must be a local page (localhost, 127.0.0.1, [::1] or *.localhost). The SDK sends nothing from other sites.`);
  const scenario = await loadScenario(options.scenario);
  const chromium = await loadChromium(importPlaywright);

  const sessions = new Set<string>();
  let lastReceived = 0;
  let server;
  try {
    server = await start({
      port: options.port,
      dir: options.dir,
      onReceive: (events) => {
        lastReceived = Date.now();
        for (const { ctx } of events) sessions.add(ctx.sid);
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    throw new RunError(`Port ${options.port} is in use. Stop "vitalscope dev", or pass --port with the port your SDK sends to.`);
  }

  const startedAt = Date.now();
  let cpuRate: number;
  try {
    const browser = await chromium.launch();
    try {
      if (options.cpu === "auto") {
        const page = await browser.newPage();
        cpuRate = Math.min(Math.max(TARGET_BENCHMARK_MS / (await benchmark(page)), 1), MAX_CPU_RATE);
        await page.close();
      } else {
        cpuRate = options.cpu;
      }

      for (let i = 1; i <= options.runs; i++) {
        const before = sessions.size;
        const sessionStart = Date.now();
        // Her oturum boş önbellek ve depolamayla başlar.
        const context = await browser.newContext();
        const page = await context.newPage();
        if (cpuRate > 1) await (await context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
        await page.goto(options.url, { waitUntil: "load" });
        try {
          await scenario({ page });
        } catch (error) {
          throw new RunError(`Session ${i} failed in the scenario: ${error instanceof Error ? error.message : String(error)}`);
        }
        // SDK son partisini pagehide'da gönderir.
        await page.close();
        await context.close();
        const closedAt = Date.now();
        while (Date.now() - closedAt < SETTLE_TIMEOUT_MS && Date.now() - Math.max(closedAt, lastReceived) < QUIET_MS) await delay(50);
        const received = lastReceived >= sessionStart && sessions.size > before;
        log(`Session ${i}/${options.runs} ${received ? "done" : "sent nothing"}`);
      }
    } finally {
      await browser.close();
    }
  } finally {
    const lost = await server.shutdown();
    if (lost > 0) log(`${lost} events could not be written.`);
  }

  if (sessions.size === 0) {
    throw new RunError(`No measurements arrived. Check that ${options.url} loads @vitalscope/sdk and sends to http://localhost:${options.port}/v1/e.`);
  }

  const store = openStore(options.dir);
  try {
    const scenarioPath = relative(process.cwd(), resolve(options.scenario)).split(sep).join("/");
    const id = saveRun(store.db, { scenario: scenarioPath, label: options.label ?? defaultLabel(), url: options.url, cpuRate, runs: options.runs, startedAt, endedAt: Date.now() }, sessions);
    const summary = getRunSummary(store.db, id);
    return options.json ? JSON.stringify(summary, null, 2) : formatRunSummary(summary);
  } finally {
    store.close();
  }
}
