import {
  getRating,
  LIMITS,
  scrubPath,
  type Attribution,
  type CustomEvent,
  type Event,
  type MetricName,
  type VitalEvent,
} from "@vitalscope/protocol";
import { isLocalPage, resolveConfig, type Config, type ResolvedConfig } from "./config.js";
import { buildContext, createSessionId, getPath, markRestored, type PageUrl } from "./context.js";
import { createErrorCollector } from "./errors.js";
import { isPrerendering } from "./navigation-timing.js";
import { watchRoutes } from "./spa.js";
import { encodeBatches, send } from "./transport.js";
import { startVitals } from "./vitals.js";

export type { Config } from "./config.js";

declare const __SDK_VERSION__: string;

/** Kuyrukta bu kadar olay birikince hemen gönderilir. */
const FLUSH_AT = 20;
/** İlk olaydan bu kadar sonra kuyruk boşaltılır. */
const FLUSH_AFTER_MS = 10_000;

interface State {
  config: ResolvedConfig;
  sid: string;
  /** Kuyruktaki olayların ait olduğu sayfa; rota değişince önce kuyruk gönderilir, sonra güncellenir. */
  path: string | undefined;
  /** İlk sayfanın ham URL'i: temizleme regex'leri `init`i yavaşlatmasın diye path ilk gerektiğinde üretilir. */
  initialUrl: PageUrl;
  route: string | undefined;
  queue: Event[];
  timer: ReturnType<typeof setTimeout> | undefined;
  stopVitals: () => void;
  stopRoutes: () => void;
  errors: ReturnType<typeof createErrorCollector> | undefined;
}

let state: State | undefined;

function pathOf(s: State): string {
  return (s.path ??= getPath(s.config.keepQuery, s.initialUrl));
}
let initialized = false;

/** SDK'nın kendi hatası sitenin hatasına dönüşmez: her dış giriş noktası bununla sarılır. */
function safe<A extends unknown[], R>(fn: (...args: A) => R) {
  return (...args: A): R | undefined => {
    try {
      return fn(...args);
    } catch {
      return undefined;
    }
  };
}

function whenIdle(fn: () => void): void {
  if (typeof requestIdleCallback === "function") requestIdleCallback(fn);
  else fn();
}

function enqueue(event: Event): void {
  if (!state) return;
  state.queue.push(event);
  if (state.queue.length >= FLUSH_AT) {
    flushNow();
  } else if (state.timer === undefined) {
    state.timer = setTimeout(() => whenIdle(safe(flushNow)), FLUSH_AFTER_MS);
  }
}

function flushNow(): void {
  if (!state) return;
  // Boşta işlenmeyi bekleyen hatalar sayfa kapanmadan senkron işlenir.
  state.errors?.drain();
  clearTimeout(state.timer);
  state.timer = undefined;
  // Prerender edilen sayfa henüz kullanıcıya gösterilmedi: olaylar kuyrukta bekler.
  if (state.queue.length === 0 || isPrerendering()) return;

  const events = state.queue;
  state.queue = [];
  const { config } = state;
  const header = { k: config.key, sdk: __SDK_VERSION__, ctx: buildContext(config, state.sid, pathOf(state), state.route) };

  for (const body of encodeBatches(header, events)) {
    if (config.debug) console.debug("[vitalscope]", JSON.parse(body));
    else send(config.endpoint, body);
  }
}

// `unload`/`beforeunload` bilerek dinlenmez: sayfanın bfcache'e girmesini engeller.
const onVisibilityChange = safe(() => {
  if (document.visibilityState === "hidden") flushNow();
});
const onPageHide = safe(flushNow);
const onPageShow = safe((event: PageTransitionEvent) => {
  if (event.persisted) markRestored();
});

// Önceki sayfanın olayları kendi path'iyle gider. Sadece hash veya atılan query değiştiyse yeni sayfa sayılmaz.
// Not: INP ve CLS sayfa gizlenince raporlanır, o anki rotaya atanır (SPA içi metrikler MVP'de yok).
const onRouteChange = safe(() => {
  if (!state) return;
  const path = getPath(state.config.keepQuery);
  if (path === pathOf(state)) return;
  flushNow();
  state.path = path;
  state.route = undefined;
  enqueue({ t: "pageview", ts: Date.now() });
});

const reportMetric = safe((name: MetricName, value: number, id: string, attr?: Attribution) => {
  const event: VitalEvent = { t: "vital", ts: Date.now(), name, value, rating: getRating(name, value), id };
  if (attr) event.attr = attr;
  enqueue(event);
});

// Mevcut `window.onerror` ezilmez; hata yutulmaz, sadece gözlemlenir.
const onError = safe((event: ErrorEvent) => {
  state?.errors?.capture({
    error: event.error,
    handled: false,
    message: event.message,
    source: event.filename,
    line: event.lineno,
    column: event.colno,
  });
});
const onRejection = safe((event: PromiseRejectionEvent) => {
  state?.errors?.capture({ error: event.reason, handled: false });
});

function prefersNoTracking(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1";
}

export const init = safe((config?: Config): void => {
  if (!isLocalPage()) return;
  const resolved = resolveConfig(config);
  const devMode = resolved?.debug === true || (config as Partial<Config> | undefined)?.environment === "development";

  if (initialized) {
    if (devMode) console.warn("[vitalscope] init() was already called; ignoring.");
    return;
  }
  if (!resolved) {
    if (devMode) console.warn("[vitalscope] invalid config; SDK not started.");
    return;
  }

  initialized = true;
  if (resolved.respectDoNotTrack && prefersNoTracking()) return;
  // Örneklem dışı kalan sayfada hiçbir olay toplanmaz (metrikler arası tutarlılık için).
  if (Math.random() >= resolved.sampleRate) return;

  state = {
    config: resolved,
    sid: createSessionId(),
    path: undefined,
    initialUrl: { pathname: location.pathname, search: location.search },
    route: undefined,
    queue: [],
    timer: undefined,
    stopVitals: () => {},
    stopRoutes: () => {},
    errors: undefined,
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  addEventListener("pagehide", onPageHide);
  addEventListener("pageshow", onPageShow);
  if (resolved.captureErrors) {
    state.errors = createErrorCollector(enqueue, resolved.ignoreErrors, (fn) => whenIdle(safe(fn)));
    addEventListener("error", onError);
    addEventListener("unhandledrejection", onRejection);
  }
  enqueue({ t: "pageview", ts: Date.now() });
  // Metrik gözlemcileri ayrı bir task'te kurulur: `init` sitenin betiğini bekletmez. Gözlemciler
  // `buffered` olduğu için o ana kadarki girdiler kaybolmaz; `disable` önce gelirse kurulum yapılmaz.
  const active = state;
  setTimeout(
    safe(() => {
      if (state === active) active.stopVitals = startVitals(reportMetric);
    }),
  );
  if (resolved.trackSpa) state.stopRoutes = watchRoutes(onRouteChange);
});

/**
 * Mevcut sayfanın rota şablonunu bildirir, örn. `setRoute("/urun/[id]")`; dashboard'da gruplamayı sağlar.
 * Rota değiştikten sonra çağrılmalıdır: her rota değişiminde şablon sıfırlanır.
 */
export const setRoute = safe((template: string): void => {
  if (!state || typeof template !== "string") return;
  const route = scrubPath(template).slice(0, LIMITS.maxRouteLength);
  state.route = route || undefined;
});

/** Elle hata gönderir (try/catch, error boundary). Varsayılan olarak `handled: true`. */
export const captureError = safe((error: unknown, options?: { handled?: boolean }): void => {
  state?.errors?.capture({ error, handled: options?.handled !== false });
});

/** Özel olay, örn. `track("checkout_completed")`. */
export const track = safe((name: string, value?: number): void => {
  if (typeof name !== "string" || name.length === 0) return;
  const event: CustomEvent = { t: "custom", ts: Date.now(), name: name.slice(0, LIMITS.maxCustomNameLength) };
  if (typeof value === "number" && Number.isFinite(value)) event.value = value;
  enqueue(event);
});

/** Kuyruğu hemen gönderir. */
export const flush = safe(flushNow);

/** Toplamayı durdurur ve kuyruktaki olayları atar (örn. kullanıcı izni reddettiğinde). */
export const disable = safe((): void => {
  if (!state) return;
  clearTimeout(state.timer);
  state.stopVitals();
  state.stopRoutes();
  document.removeEventListener("visibilitychange", onVisibilityChange);
  removeEventListener("pagehide", onPageHide);
  removeEventListener("pageshow", onPageShow);
  removeEventListener("error", onError);
  removeEventListener("unhandledrejection", onRejection);
  state = undefined;
});
