import { expect, test, type Page } from "@playwright/test";
import { captureIngest, hide, nextFrame } from "./helpers.js";

// Performans bütçeleri (SDK dokümanı 7.1). CPU yavaşlatma ve long task gözlemi sadece Chromium'da var.
// Bu dosya ayrı bir projede, diğer testler bittikten sonra tek başına çalışır; ölçümler birbirini etkilemez.

/**
 * Hedef cihaz: orta seviye mobil. Dokümandaki "4× yavaşlatma" hızlı bir geliştirici makinesini varsayar;
 * CI makineleri daha yavaş olduğu için oran sabit değil, makinenin hızına göre hesaplanır (Lighthouse gibi).
 * `benchmark` işi referans makinede (Intel Core i5-12500, Windows 11, Chromium) ≈ 27 ms sürdü;
 * hedef cihazda bunun 4 katı sürmesi beklenir.
 */
const BENCHMARK_REFERENCE_MS = 27;
const TARGET_BENCHMARK_MS = BENCHMARK_REFERENCE_MS * 4;
const INIT_BUDGET_MS = 1;
const INIT_LOADS = 15;
const RUNS = 20;

test.describe.configure({ mode: "default" });

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** Yavaşlatmasız sabit bir JS işinin (nesne, string, sıralama, regex) medyan süresi. */
async function benchmark(page: Page): Promise<number> {
  await page.goto("/");
  const times = await page.evaluate(() => {
    const result: number[] = [];
    for (let round = 0; round < 7; round++) {
      const start = performance.now();
      const rows: { id: number; name: string }[] = [];
      for (let i = 0; i < 100_000; i++) rows.push({ id: (i * 7919) % 100_000, name: `row-${i}` });
      rows.sort((a, b) => a.id - b.id);
      const text = JSON.stringify(rows);
      (globalThis as { __sink?: number }).__sink = text.match(/row-\d+5"/g)?.length ?? 0;
      result.push(performance.now() - start);
    }
    return result;
  });
  return median(times.slice(1));
}

/** Makineyi hedef cihaz hızına indirir; uygulanan oranı döner. */
async function slowDownCpu(page: Page): Promise<number> {
  const rate = Math.min(Math.max(TARGET_BENCHMARK_MS / (await benchmark(page)), 1), 20);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  test.info().annotations.push({ type: "CPU yavaşlatma", description: `${rate.toFixed(1)}×` });
  return rate;
}

test("init() takes under 1 ms on a mid-tier mobile CPU", async ({ page }) => {
  await captureIngest(page);
  await slowDownCpu(page);
  const durations: number[] = [];
  for (let i = 0; i < INIT_LOADS; i++) {
    await page.goto("/sdk-only/");
    durations.push(await page.evaluate(() => performance.getEntriesByName("vitalscope:init")[0]?.duration ?? NaN));
  }
  // İlk açılış soğuktur (kod önbelleği yok); bütçe sıcak açılışların medyanına uygulanır, soğuk değer raporlanır.
  const [cold, ...warm] = durations;
  const summary = `soğuk ${cold} ms, sıcak medyan ${median(warm)} ms (${warm.join(", ")})`;
  test.info().annotations.push({ type: "init", description: summary });
  expect(median(warm), summary).toBeLessThan(INIT_BUDGET_MS);
});

interface ScriptTiming {
  sourceURL: string;
  duration: number;
}

/**
 * Yavaşlatılmış CPU'da ilk açılış, SDK'sız sayfada bile tarayıcının kendi işiyle bir long task oluşturur.
 * Bu yüzden long task'ler değil, long animation frame girdilerindeki betik süreleri ölçülür:
 * SDK'nın hiçbir betiği (yükleme, gözlemci geri çağrıları, gizlenmede gönderim) 50 ms sürmemeli.
 */
test("the SDK creates no long tasks on a mid-tier mobile CPU", async ({ page }) => {
  const ingest = await captureIngest(page);
  await page.addInitScript(() => {
    const scripts: ScriptTiming[] = [];
    (globalThis as { __scripts?: ScriptTiming[] }).__scripts = scripts;
    new PerformanceObserver((list) => {
      for (const frame of list.getEntries() as (PerformanceEntry & { scripts: ScriptTiming[] })[]) {
        for (const { sourceURL, duration } of frame.scripts) scripts.push({ sourceURL, duration });
      }
    }).observe({ type: "long-animation-frame", buffered: true });
  });
  await slowDownCpu(page);
  await page.goto("/sdk-only/");
  await nextFrame(page);
  // Kuyruğun gönderildiği an da dahil.
  await hide(page);
  await expect.poll(async () => (await ingest.events()).length).toBeGreaterThan(0);
  await nextFrame(page);

  const scripts = await page.evaluate(() => (globalThis as { __scripts?: ScriptTiming[] }).__scripts ?? []);
  const sdk = scripts.filter((s) => /\/assets\/vitalscope-[\w-]+\.js$/.test(s.sourceURL));
  test.info().annotations.push({ type: "SDK betikleri", description: sdk.map((s) => `${s.duration} ms`).join(", ") || "yok" });
  for (const script of sdk) expect(script.duration, script.sourceURL).toBeLessThan(50);
});

interface PageMetrics {
  lcp: number;
  inp: number;
}

/** Sayfayı açar ve butona tıklar; LCP ve tıklama süresi SDK'dan bağımsız gözlemcilerden okunur. */
async function measure(page: Page, path: string): Promise<PageMetrics> {
  await page.goto(path);
  await expect(page.locator("#hero img")).toBeVisible();
  await nextFrame(page);
  await page.click("#buy");
  await nextFrame(page);
  return page.evaluate(() => (globalThis as { __metrics?: PageMetrics }).__metrics ?? { lcp: NaN, inp: NaN });
}

test("the SDK has no measurable effect on LCP and INP", async ({ page }) => {
  await captureIngest(page);
  // Gözlemciler sayfa kodundan önce kurulur; LCP girdisi performans zaman çizelgesinden okunamaz.
  await page.addInitScript(() => {
    const metrics: PageMetrics = { lcp: NaN, inp: 0 };
    (globalThis as { __metrics?: PageMetrics }).__metrics = metrics;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) metrics.lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEventTiming[]) {
        if (entry.interactionId) metrics.inp = Math.max(metrics.inp, entry.duration);
      }
    }).observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);
  });

  const withSdk: PageMetrics[] = [];
  const without: PageMetrics[] = [];
  // Sıra karışık: zamanla değişen makine yükü iki tarafa eşit dağılır.
  for (let i = 0; i < RUNS; i++) {
    withSdk.push(await measure(page, "/impact/"));
    without.push(await measure(page, "/impact/control/"));
  }

  const report = (key: keyof PageMetrics) =>
    `${key}: SDK'lı medyan ${median(withSdk.map((m) => m[key]))} ms, SDK'sız ${median(without.map((m) => m[key]))} ms`;
  test.info().annotations.push({ type: "LCP", description: report("lcp") }, { type: "INP", description: report("inp") });

  // "Ölçülebilir fark yok": medyanlar arasındaki fark bir kareden (60 Hz'de ≈ 16,7 ms) küçük.
  // Event Timing süreleri 8 ms'ye yuvarlanır; INP için bir yuvarlama adımı da kabul edilir.
  expect(median(withSdk.map((m) => m.lcp)) - median(without.map((m) => m.lcp)), report("lcp")).toBeLessThan(16.7);
  expect(median(withSdk.map((m) => m.inp)) - median(without.map((m) => m.inp)), report("inp")).toBeLessThanOrEqual(8);
});
