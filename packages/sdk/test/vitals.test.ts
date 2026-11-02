import { afterEach, describe, expect, it, vi } from "vitest";
import { startVitals } from "../src/vitals.js";
import { emit, installFakePerformance, observerFor, setVisibility } from "./fake-performance.js";

let stop: (() => void) | undefined;
const report = vi.fn<(name: string, value: number, id: string) => void>();

function start(options?: Parameters<typeof installFakePerformance>[0]) {
  stop?.();
  installFakePerformance(options);
  stop = startVitals(report);
}
const reported = (name: string) => report.mock.calls.filter(([n]) => n === name).map(([, value, id]) => ({ value, id }));

afterEach(() => {
  stop?.();
  stop = undefined;
  report.mockReset();
  setVisibility("visible");
  delete (performance as { interactionCount?: number }).interactionCount;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TTFB", () => {
  it("reports responseStart immediately", () => {
    start({ navigation: { responseStart: 210, type: "navigate" } });
    expect(reported("TTFB")).toEqual([{ value: 210, id: expect.any(String) }]);
  });

  it("measures from activationStart on prerendered pages", () => {
    start({ navigation: { responseStart: 210, activationStart: 500, type: "navigate" } });
    expect(reported("TTFB")[0]?.value).toBe(0);
  });

  it("skips a missing or future responseStart", () => {
    start({ navigation: { responseStart: 0 } });
    start({ navigation: { responseStart: 20_000 }, now: 10_000 });
    expect(reported("TTFB")).toEqual([]);
  });
});

describe("FCP", () => {
  it("reports first-contentful-paint once and stops observing", () => {
    start();
    emit("paint", [{ name: "first-paint", startTime: 100 }, { name: "first-contentful-paint", startTime: 350 }]);
    expect(reported("FCP").map((r) => r.value)).toEqual([350]);
    expect(observerFor("paint")?.disconnected).toBe(true);
  });

  it("is not reported when the page was hidden before painting", () => {
    setVisibility("hidden");
    start();
    emit("paint", [{ name: "first-contentful-paint", startTime: 350 }]);
    expect(reported("FCP")).toEqual([]);
  });
});

describe("LCP", () => {
  it("keeps the last candidate and finalizes on first input", () => {
    start();
    emit("largest-contentful-paint", [{ startTime: 900 }, { startTime: 1730 }]);
    expect(reported("LCP")).toEqual([]);
    window.dispatchEvent(new Event("keydown"));
    window.dispatchEvent(new Event("pointerdown"));
    emit("largest-contentful-paint", [{ startTime: 5000 }]);
    expect(reported("LCP").map((r) => r.value)).toEqual([1730]);
  });

  it("finalizes when the page is hidden, including pending records", () => {
    start();
    emit("largest-contentful-paint", [{ startTime: 900 }]);
    observerFor("largest-contentful-paint")?.queue([{ startTime: 1200 }]);
    setVisibility("hidden");
    setVisibility("hidden");
    expect(reported("LCP").map((r) => r.value)).toEqual([1200]);
  });

  it("ignores candidates painted after the page was hidden", () => {
    start({ now: 1000 });
    setVisibility("hidden");
    emit("largest-contentful-paint", [{ startTime: 1500 }]);
    expect(reported("LCP")).toEqual([]);
  });
});

describe("CLS", () => {
  const shift = (startTime: number, value: number, hadRecentInput = false) => ({ startTime, value, hadRecentInput });

  it("reports the largest session window on hide", () => {
    start();
    emit("layout-shift", [
      shift(0, 0.1),
      shift(500, 0.1), // aynı pencere → 0.2
      shift(2000, 0.15), // > 1 sn boşluk → yeni pencere
      shift(2100, 0.3, true), // kullanıcı girdisinden sonra → sayılmaz
    ]);
    setVisibility("hidden");
    expect(reported("CLS").map((r) => r.value)).toEqual([0.2]);
  });

  it("splits a session window after 5 seconds", () => {
    start();
    emit("layout-shift", Array.from({ length: 12 }, (_, i) => shift(i * 900, 0.05)));
    setVisibility("hidden");
    // 0..4500 ms: 6 kayma (0.30); 5400'den itibaren yeni pencere.
    expect(reported("CLS")[0]?.value).toBeCloseTo(0.3);
  });

  it("reports 0 when supported but nothing shifted", () => {
    start();
    setVisibility("hidden");
    expect(reported("CLS").map((r) => r.value)).toEqual([0]);
  });

  it("re-reports with the same id only when the value changed", () => {
    start();
    emit("layout-shift", [shift(0, 0.1)]);
    setVisibility("hidden");
    setVisibility("hidden");
    emit("layout-shift", [shift(200, 0.05)]);
    setVisibility("hidden");
    const reports = reported("CLS");
    expect(reports.map((r) => r.value)).toEqual([0.1, 0.15000000000000002]);
    expect(reports[0]?.id).toBe(reports[1]?.id);
  });
});

describe("INP", () => {
  const interaction = (interactionId: number, duration: number) => ({ interactionId, duration, startTime: 0 });

  it("uses the longest entry per interaction and ignores non-interactions", () => {
    start();
    emit("event", [interaction(1, 80), interaction(1, 120), interaction(0, 900), interaction(2, 60)]);
    setVisibility("hidden");
    expect(reported("INP").map((r) => r.value)).toEqual([120]);
  });

  it("skips one worst interaction per 50 interactions (≈ p98)", () => {
    start({ interactionCount: 120 });
    emit("event", [500, 400, 300, 200, 100].map((d, i) => interaction(i + 1, d)));
    setVisibility("hidden");
    // 120 / 50 = 2 → üçüncü en kötü
    expect(reported("INP").map((r) => r.value)).toEqual([300]);
  });

  it("counts first-input entries and reports nothing without interactions", () => {
    start();
    setVisibility("hidden");
    expect(reported("INP")).toEqual([]);
    emit("first-input", [interaction(7, 64)]);
    setVisibility("hidden");
    expect(reported("INP").map((r) => r.value)).toEqual([64]);
  });

  it("observes event timing with a 40 ms threshold", () => {
    start();
    expect(observerFor("event")?.options).toMatchObject({ type: "event", buffered: true, durationThreshold: 40 });
  });
});

describe("bfcache restore", () => {
  it("starts new CLS and INP measurements", () => {
    start();
    emit("layout-shift", [{ startTime: 0, value: 0.2, hadRecentInput: false }]);
    emit("event", [interaction(1, 300)]);
    setVisibility("hidden");
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    setVisibility("visible");
    emit("event", [interaction(2, 90)]);
    setVisibility("hidden");

    const cls = reported("CLS");
    const inp = reported("INP");
    expect(cls.map((r) => r.value)).toEqual([0.2, 0]);
    expect(cls[0]?.id).not.toBe(cls[1]?.id);
    expect(inp.map((r) => r.value)).toEqual([300, 90]);
    expect(inp[0]?.id).not.toBe(inp[1]?.id);

    function interaction(interactionId: number, duration: number) {
      return { interactionId, duration, startTime: 0 };
    }
  });
});

describe("unsupported browsers", () => {
  it("skips metrics whose entry types are not supported", () => {
    start({ supported: [] });
    setVisibility("hidden");
    expect(report).not.toHaveBeenCalled();
  });

  it("does nothing when PerformanceObserver is missing", () => {
    installFakePerformance();
    vi.stubGlobal("PerformanceObserver", undefined);
    expect(() => {
      stop = startVitals(report);
      setVisibility("hidden");
    }).not.toThrow();
    expect(report).not.toHaveBeenCalled();
  });
});

describe("stop", () => {
  it("disconnects observers and removes listeners", () => {
    start();
    stop?.();
    emit("layout-shift", [{ startTime: 0, value: 0.2, hadRecentInput: false }]);
    setVisibility("hidden");
    expect(report).not.toHaveBeenCalled();
  });
});
