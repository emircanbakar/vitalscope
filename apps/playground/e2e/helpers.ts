import type { BrowserContext, Page } from "@playwright/test";
import { Batch } from "@vitalscope/protocol/schema";
import { ENDPOINT } from "../src/vitalscope.js";

export interface Sent {
  /** Ham gövdeler: gizlilik testleri metin üzerinde arama yapar. */
  bodies: string[];
  /** Protokol şemasından geçmiş batch'ler; geçmeyen gövde testi düşürür. */
  batches: Batch[];
}

/**
 * Ingest isteklerini yakalar; sendBeacon ve fetch ikisi de buraya düşer.
 * Sayfa kapanırken gönderilenler için context verilir: sayfa düzeyindeki yönlendirme sayfayla birlikte kapanır.
 */
export async function captureIngest(target: Page | BrowserContext): Promise<Sent> {
  const sent: Sent = { bodies: [], batches: [] };
  await target.route(ENDPOINT, async (route) => {
    const body = route.request().postData() ?? "";
    sent.bodies.push(body);
    sent.batches.push(Batch.parse(JSON.parse(body)));
    await route.fulfill({ status: 204 });
  });
  return sent;
}

export const events = (sent: Sent) => sent.batches.flatMap((b) => b.e);

export const vitals = (sent: Sent, name: string) => events(sent).filter((e) => e.t === "vital" && e.name === name);

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
