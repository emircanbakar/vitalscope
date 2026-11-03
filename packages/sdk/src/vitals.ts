import type { Attribution, MetricName } from "@vitalscope/protocol";
import { getActivationStart, getNavigationEntry } from "./navigation-timing.js";

// Ölçüm kuralları web.dev'deki resmi metrik tanımlarını izler; runtime bağımlılığı yoktur.

export type ReportMetric = (name: MetricName, value: number, id: string, attr?: Attribution) => void;

export interface LayoutShift extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

/**
 * "Neden yavaş" bilgisini üretir. Sadece `@vitalscope/sdk/attribution` kurar; çekirdek bu kodu içermez,
 * metrik ölçümü sadece ilgili girdiyi verir.
 */
export interface Attributor {
  /** Ek gözlemcileri (ör. long animation frame) başlatır; durdurma fonksiyonu döner. */
  observe(supported: readonly string[]): () => void;
  lcp(entry: PerformanceEntry): Attribution | undefined;
  /** En büyük CLS penceresindeki en büyük kayma. */
  cls(shift: LayoutShift): Attribution | undefined;
  /** En kötü etkileşimin tüm girdileri. */
  inp(entries: PerformanceEventTiming[]): Attribution | undefined;
}

let attributor: Attributor | undefined;

export function setAttributor(value: Attributor): void {
  attributor = value;
}

/** CLS oturum penceresi: kaymalar arası < 1 sn, pencere toplamı ≤ 5 sn. */
const CLS_GAP_MS = 1000;
const CLS_WINDOW_MS = 5000;
/** INP için tutulan en kötü etkileşim sayısı ve her kaç etkileşimde bir en kötünün atlanacağı (≈ p98). */
const INP_KEEP = 10;
const INP_SKIP_EVERY = 50;

const newId = () => `${Date.now()}-${Math.floor(Math.random() * 9e12) + 1e12}`;

/** Metrik toplamayı başlatır; durdurmak için dönen fonksiyon çağrılır. */
export function startVitals(report: ReportMetric): () => void {
  const cleanups: (() => void)[] = [];
  const supported = typeof PerformanceObserver === "function" ? PerformanceObserver.supportedEntryTypes ?? [] : [];
  if (attributor) cleanups.push(attributor.observe(supported));

  function observe(type: string, handle: (entries: PerformanceEntry[]) => void, extra?: object) {
    if (!supported.includes(type)) return undefined;
    const po = new PerformanceObserver((list) => handle(list.getEntries()));
    po.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
    cleanups.push(() => po.disconnect());
    return { flush: () => handle(po.takeRecords()), stop: () => po.disconnect() };
  }

  // Capture fazında dinlenir: kuyruğu boşaltan dinleyiciden önce çalışıp son değerleri kuyruğa ekler.
  function on(target: EventTarget, type: string, fn: (event: Event) => void) {
    target.addEventListener(type, fn, true);
    cleanups.push(() => target.removeEventListener(type, fn, true));
  }
  const onHidden = (fn: () => void) =>
    on(document, "visibilitychange", () => {
      if (document.visibilityState === "hidden") fn();
    });

  const activationStart = getActivationStart();
  const relative = (time: number) => Math.max(time - activationStart, 0);
  // Sayfa ilk çizimden önce arka plandaysa FCP/LCP raporlanmaz.
  let firstHidden = document.visibilityState === "hidden" ? 0 : Infinity;
  onHidden(() => {
    firstHidden = Math.min(firstHidden, performance.now());
  });

  // TTFB
  const nav = getNavigationEntry();
  if (nav && nav.responseStart > 0 && nav.responseStart <= performance.now()) {
    report("TTFB", relative(nav.responseStart), newId());
  }

  // FCP
  const fcp = observe("paint", (entries) => {
    const entry = entries.find((e) => e.name === "first-contentful-paint");
    if (!entry) return;
    fcp?.stop();
    if (entry.startTime < firstHidden) report("FCP", relative(entry.startTime), newId());
  });

  // LCP: son aday tutulur, ilk girdi veya sayfa gizlenince kesinleşir.
  let lcp: PerformanceEntry | undefined;
  const lcpObserver = observe("largest-contentful-paint", (entries) => {
    for (const entry of entries) if (entry.startTime < firstHidden) lcp = entry;
  });
  let lcpDone = !lcpObserver;
  const finalizeLcp = () => {
    if (lcpDone) return;
    lcpDone = true;
    lcpObserver?.flush();
    lcpObserver?.stop();
    if (lcp) report("LCP", relative(lcp.startTime), newId(), attributor?.lcp(lcp));
  };
  on(window, "keydown", finalizeLcp);
  on(window, "pointerdown", finalizeLcp);
  onHidden(finalizeLcp);

  // CLS: en büyük oturum penceresinin toplamı.
  let cls = 0;
  let sessionValue = 0;
  let sessionStart = 0;
  let sessionLast = 0;
  // Attribution için: o anki pencerenin ve en büyük CLS penceresinin en büyük kayması.
  let sessionLargest: LayoutShift | undefined;
  let clsLargest: LayoutShift | undefined;
  let clsId = newId();
  let clsReported = -1;
  const clsObserver = observe("layout-shift", (entries) => {
    for (const shift of entries as LayoutShift[]) {
      if (shift.hadRecentInput) continue;
      const sameSession =
        sessionValue > 0 &&
        shift.startTime - sessionLast < CLS_GAP_MS &&
        shift.startTime - sessionStart < CLS_WINDOW_MS;
      if (sameSession) {
        sessionValue += shift.value;
        if (shift.value > sessionLargest!.value) sessionLargest = shift;
      } else {
        sessionValue = shift.value;
        sessionStart = shift.startTime;
        sessionLargest = shift;
      }
      sessionLast = shift.startTime;
      if (sessionValue > cls) {
        cls = sessionValue;
        clsLargest = sessionLargest;
      }
    }
  });
  onHidden(() => {
    if (!clsObserver) return;
    clsObserver.flush();
    if (cls === clsReported) return;
    clsReported = cls;
    report("CLS", cls, clsId, clsLargest && attributor?.cls(clsLargest));
  });

  // INP: etkileşim başına en uzun süre; en kötü 10 tutulur, her 50 etkileşimde bir en kötü atlanır.
  // Etkileşimin tüm girdileri (pointerdown, pointerup, click…) attribution için tutulur.
  let worst: { id: number; duration: number; entries: PerformanceEventTiming[] }[] = [];
  let seenInteractions = 0;
  let inpId = newId();
  let inpReported = -1;
  const handleEvents = (entries: PerformanceEntry[]) => {
    for (const entry of entries as PerformanceEventTiming[]) {
      if (!entry.interactionId) continue;
      const existing = worst.find((w) => w.id === entry.interactionId);
      if (existing) {
        existing.duration = Math.max(existing.duration, entry.duration);
        existing.entries.push(entry);
        continue;
      }
      seenInteractions++;
      worst.push({ id: entry.interactionId, duration: entry.duration, entries: [entry] });
      worst.sort((a, b) => b.duration - a.duration);
      worst.length = Math.min(worst.length, INP_KEEP);
    }
  };
  const eventObserver = observe("event", handleEvents, { durationThreshold: 40 });
  const firstInputObserver = observe("first-input", handleEvents);
  onHidden(() => {
    eventObserver?.flush();
    firstInputObserver?.flush();
    if (worst.length === 0) return;
    const interactions = performance.interactionCount || seenInteractions;
    const interaction = worst[Math.min(worst.length - 1, Math.floor(interactions / INP_SKIP_EVERY))]!;
    const value = interaction.duration;
    if (value === inpReported) return;
    inpReported = value;
    report("INP", value, inpId, attributor?.inp(interaction.entries));
  });

  // bfcache'ten dönüşte CLS ve INP yeni bir ölçüm olarak baştan başlar.
  on(window, "pageshow", (event) => {
    if (!(event as PageTransitionEvent).persisted) return;
    cls = sessionValue = sessionStart = sessionLast = 0;
    sessionLargest = clsLargest = undefined;
    clsReported = -1;
    clsId = newId();
    worst = [];
    seenInteractions = 0;
    inpReported = -1;
    inpId = newId();
  });

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
