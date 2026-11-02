import { getRating, LIMITS, type CustomEvent, type Event, type MetricName } from "@vitalscope/protocol";
import { resolveConfig, type Config, type ResolvedConfig } from "./config.js";
import { buildContext, createSessionId, markRestored } from "./context.js";
import { isPrerendering } from "./navigation-timing.js";
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
  queue: Event[];
  timer: ReturnType<typeof setTimeout> | undefined;
  stopVitals: () => void;
}

let state: State | undefined;
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
  clearTimeout(state.timer);
  state.timer = undefined;
  // Prerender edilen sayfa henüz kullanıcıya gösterilmedi: olaylar kuyrukta bekler.
  if (state.queue.length === 0 || isPrerendering()) return;

  const events = state.queue;
  state.queue = [];
  const { config } = state;
  const header = { k: config.key, sdk: __SDK_VERSION__, ctx: buildContext(config, state.sid) };

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

const reportMetric = safe((name: MetricName, value: number, id: string) => {
  enqueue({ t: "vital", ts: Date.now(), name, value, rating: getRating(name, value), id });
});

export const init = safe((config: Config): void => {
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
  // Örneklem dışı kalan sayfada hiçbir olay toplanmaz (metrikler arası tutarlılık için).
  if (Math.random() >= resolved.sampleRate) return;

  state = { config: resolved, sid: createSessionId(), queue: [], timer: undefined, stopVitals: () => {} };
  document.addEventListener("visibilitychange", onVisibilityChange);
  addEventListener("pagehide", onPageHide);
  addEventListener("pageshow", onPageShow);
  enqueue({ t: "pageview", ts: Date.now() });
  state.stopVitals = startVitals(reportMetric);
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
  document.removeEventListener("visibilitychange", onVisibilityChange);
  removeEventListener("pagehide", onPageHide);
  removeEventListener("pageshow", onPageShow);
  state = undefined;
});
