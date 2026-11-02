import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { Event as VitalscopeEvent } from "@vitalscope/protocol";
import { Batch } from "@vitalscope/protocol/schema";

const INGEST = "http://127.0.0.1:4174";

/** Sahte ingest'e bu çalıştırma kimliğiyle gelmiş ham gövdeler. */
export async function bodiesOf(run: string): Promise<string[]> {
  return (await fetch(`${INGEST}/runs/${run}`)).json() as Promise<string[]>;
}

export interface Ingest {
  run: string;
  /** Ham gövdeler: gizlilik testleri metin üzerinde arama yapar. */
  bodies(): Promise<string[]>;
  /** Protokol şemasından geçmiş batch'ler; geçmeyen gövde testi düşürür. */
  batches(): Promise<Batch[]>;
  events(): Promise<VitalscopeEvent[]>;
  vitals(name: string): Promise<VitalscopeEvent[]>;
}

/**
 * Sayfaya ayrı bir çalıştırma kimliği verir; SDK olaylarını sahte ingest'te bu kimliğe gönderir.
 * Kimlik her navigasyonda yeniden enjekte edilir, sayfa kapanırken giden istekler de aynı kayda düşer.
 */
export async function captureIngest(page: Page): Promise<Ingest> {
  const run = randomUUID();
  await page.addInitScript((id) => {
    (globalThis as { __vitalscopeRun?: string }).__vitalscopeRun = id;
  }, run);

  const bodies = () => bodiesOf(run);
  const batches = async () => (await bodies()).map((body) => Batch.parse(JSON.parse(body)));
  const events = async () => (await batches()).flatMap((b) => b.e);
  const vitals = async (name: string) => (await events()).filter((e) => e.t === "vital" && e.name === name);
  return { run, bodies, batches, events, vitals };
}

/** Sekmenin gizlenmesini taklit eder: SDK metrikleri sonlandırır ve kuyruğu gönderir. */
export async function hide(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** Performans girdilerinin gelmesi için bir kare ve kısa bir süre bekler. */
export async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 100))));
}

export async function supportsEntryType(page: Page, type: string): Promise<boolean> {
  return page.evaluate((t) => PerformanceObserver.supportedEntryTypes.includes(t), type);
}

/** INP için Event Timing ve `interactionId` gerekir. */
export async function supportsInp(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      PerformanceObserver.supportedEntryTypes.includes("event") &&
      typeof PerformanceEventTiming !== "undefined" &&
      "interactionId" in PerformanceEventTiming.prototype,
  );
}
