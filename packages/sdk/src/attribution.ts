import { LIMITS, scrubPath, type Attribution } from "@vitalscope/protocol";
import { init as baseInit, type Config } from "./index.js";
import { getActivationStart, getNavigationEntry } from "./navigation-timing.js";
import { getSelector } from "./selector.js";
import { setAttributor, type Attributor, type LayoutShift } from "./vitals.js";

// `@vitalscope/sdk/attribution`: çekirdekle aynı API, metrik olaylarına "neden yavaş" bilgisi (`attr`) eklenir.
// Çekirdek bu dosyayı içermez; ölçüm kodu aynıdır, sadece ilgili girdi burada yorumlanır.

export * from "./index.js";

/** Bu kadar son long animation frame tutulur; INP'nin hangi betikte geçtiği bunlardan bulunur. */
const MAX_FRAMES = 50;

interface ScriptTiming {
  duration: number;
  sourceURL: string;
}
interface AnimationFrame extends PerformanceEntry {
  scripts: ScriptTiming[];
}
interface LayoutShiftSource {
  node?: Node | null;
}
interface LargestContentfulPaint extends PerformanceEntry {
  element?: Element | null;
  url?: string;
}

/** Değeri `undefined` olan alanlar atılır: protokolde opsiyonel alan ya vardır ya yoktur. */
function defined(attr: Record<string, string | number | undefined>): Attribution {
  return Object.fromEntries(Object.entries(attr).filter(([, value]) => value !== undefined)) as Attribution;
}

/** Attribution hatası metriği düşürmez ve sayfaya sızmaz: metrik attribution'sız gönderilir. */
function guard<T>(fn: (input: T) => Attribution): (input: T) => Attribution | undefined {
  return (input) => {
    try {
      return fn(input);
    } catch {
      return undefined;
    }
  };
}

/** Sadece http(s) adresleri; query ve hash atılır, path temizlenir. */
function cleanUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url, location.href);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return (parsed.origin + scrubPath(parsed.pathname)).slice(0, LIMITS.maxUrlLength);
  } catch {
    return undefined;
  }
}

let frames: AnimationFrame[] = [];

/** Etkileşimle çakışan karelerdeki en uzun betiğin adresi. */
function longestScript(start: number, end: number): string | undefined {
  let longest: ScriptTiming | undefined;
  for (const frame of frames) {
    if (frame.startTime > end || frame.startTime + frame.duration < start) continue;
    for (const script of frame.scripts) if (!longest || script.duration > longest.duration) longest = script;
  }
  return longest?.sourceURL ? cleanUrl(longest.sourceURL) : undefined;
}

const attributor: Attributor = {
  observe(supported) {
    frames = [];
    if (!supported.includes("long-animation-frame")) return () => {};
    const observer = new PerformanceObserver((list) => {
      frames.push(...(list.getEntries() as AnimationFrame[]));
      frames.splice(0, frames.length - MAX_FRAMES);
    });
    try {
      observer.observe({ type: "long-animation-frame", buffered: true });
    } catch {
      // Gözlemci kurulamazsa INP sadece betik bilgisi olmadan gider.
    }
    return () => observer.disconnect();
  },

  // Alt parçalar web.dev tanımıyla: TTFB + kaynak yükleme gecikmesi + yükleme süresi + render gecikmesi = LCP.
  lcp: guard((entry: PerformanceEntry) => {
    const lcp = entry as LargestContentfulPaint;
    const activationStart = getActivationStart();
    const nav = getNavigationEntry();
    const ttfb = nav ? Math.max(nav.responseStart - activationStart, 0) : 0;
    const resource = lcp.url
      ? (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).find((r) => r.name === lcp.url)
      : undefined;
    const requestStart = Math.max(ttfb, resource ? (resource.requestStart || resource.startTime) - activationStart : 0);
    const responseEnd = Math.max(requestStart, resource ? resource.responseEnd - activationStart : 0);
    const renderTime = Math.max(responseEnd, lcp.startTime - activationStart);
    return defined({
      target: getSelector(lcp.element),
      url: lcp.url ? cleanUrl(lcp.url) : undefined,
      ttfb,
      loadDelay: requestStart - ttfb,
      loadTime: responseEnd - requestStart,
      renderDelay: renderTime - responseEnd,
    });
  }),

  cls: guard((shift: LayoutShift) => {
    const sources = (shift as LayoutShift & { sources?: LayoutShiftSource[] }).sources ?? [];
    const source = sources.find((s) => s.node?.nodeType === Node.ELEMENT_NODE) ?? sources[0];
    return defined({ target: getSelector(source?.node), time: Math.max(shift.startTime - getActivationStart(), 0) });
  }),

  // Bir etkileşim birden çok olaydan oluşur (pointerdown, pointerup, click). Fazlar, en uzun olayla aynı karede
  // biten olayların birleşimidir (süreler 8 ms'ye yuvarlanır): girdi gecikmesi ilk olaya, işleme ilk işleme
  // başlangıcından son işleme bitişine, sunum o andan sonraki kareye. Önceki karede bitmiş olay (ör. ayrı
  // işlenen pointerdown) INP'nin parçası değildir.
  inp: guard((all: PerformanceEventTiming[]) => {
    const longest = all.reduce((a, b) => (b.duration > a.duration ? b : a));
    const frameEnd = longest.startTime + longest.duration;
    const entries = all.filter((e) => Math.abs(e.startTime + e.duration - frameEnd) <= 8);
    const first = entries.reduce((a, b) => (b.startTime < a.startTime ? b : a));
    const processingStart = Math.min(...entries.map((e) => e.processingStart));
    const processingEnd = Math.max(...entries.map((e) => e.processingEnd));
    const end = Math.max(...entries.map((e) => e.startTime + e.duration));
    return defined({
      target: getSelector(entries.find((e) => e.target)?.target),
      type: first.name.startsWith("key") ? "keyboard" : "pointer",
      inputDelay: Math.max(processingStart - first.startTime, 0),
      processing: Math.max(processingEnd - processingStart, 0),
      presentation: Math.max(end - processingEnd, 0),
      script: longestScript(first.startTime, end),
    });
  }),
};

/** Çekirdekteki `init` ile aynı; metrik olaylarına attribution eklenir. */
export const init = (config: Config): void => {
  setAttributor(attributor);
  baseInit(config);
};
