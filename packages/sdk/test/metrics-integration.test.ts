import { Batch } from "@vitalscope/protocol/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emit, installFakePerformance, observerFor, setVisibility } from "./fake-performance.js";

type Sdk = typeof import("../src/index.js");

const config = { key: "pk_3f9a0c1d2e4b5a6978c0d1e2", endpoint: "https://ingest.test/v1/e" };

let sdk: Sdk;
let beacon: ReturnType<typeof vi.fn<(url: string, body: string) => boolean>>;
let connection: { effectiveType?: string } | undefined;

const sent = () => beacon.mock.calls.map(([, body]) => Batch.parse(JSON.parse(body)));

function setPrerendering(value: boolean) {
  Object.defineProperty(document, "prerendering", { configurable: true, value });
}

beforeEach(async () => {
  vi.resetModules();
  beacon = vi.fn(() => true);
  connection = undefined;
  vi.stubGlobal("navigator", {
    sendBeacon: beacon,
    get connection() {
      return connection;
    },
  });
  sdk = await import("../src/index.js");
});

afterEach(() => {
  sdk.disable();
  setVisibility("visible");
  setPrerendering(false);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("vital events", () => {
  it("are sent with a rating and pass the protocol schema", () => {
    vi.useFakeTimers();
    installFakePerformance({ navigation: { responseStart: 2000, type: "navigate" } });
    sdk.init(config);
    vi.advanceTimersByTime(0);
    vi.useRealTimers();
    emit("largest-contentful-paint", [{ startTime: 1730 }]);
    emit("layout-shift", [{ startTime: 0, value: 0.3, hadRecentInput: false }]);
    setVisibility("hidden");

    const vitals = sent().flatMap((b) => b.e).filter((e) => e.t === "vital");
    expect(vitals.map((v) => [v.name, v.value, v.rating])).toEqual([
      ["TTFB", 2000, "poor"],
      ["LCP", 1730, "good"],
      ["CLS", 0.3, "poor"],
    ]);
  });

  it("are observed from a later task, so init stays short", () => {
    vi.useFakeTimers();
    installFakePerformance();
    sdk.init(config);
    expect(observerFor("largest-contentful-paint")).toBeUndefined();
    vi.advanceTimersByTime(0);
    expect(observerFor("largest-contentful-paint")?.options).toMatchObject({ buffered: true });
    vi.useRealTimers();
  });

  it("are not observed when the SDK is disabled before that task", () => {
    vi.useFakeTimers();
    installFakePerformance();
    sdk.init(config);
    sdk.disable();
    vi.advanceTimersByTime(0);
    expect(observerFor("largest-contentful-paint")).toBeUndefined();
    vi.useRealTimers();
  });
});

describe("context", () => {
  it("includes navigation type, connection and sample rate", () => {
    installFakePerformance({ navigation: { responseStart: 100, type: "reload" } });
    connection = { effectiveType: "3g" };
    sdk.init(config);
    sdk.flush();
    expect(sent()[0]?.ctx).toMatchObject({ nav: "reload", conn: "3g", sr: 1 });
  });

  it("drops unknown connection types", () => {
    installFakePerformance();
    connection = { effectiveType: "5g" };
    sdk.init(config);
    sdk.flush();
    expect(sent()[0]?.ctx.conn).toBeUndefined();
  });

  it("marks prerendered pages", () => {
    installFakePerformance({ navigation: { responseStart: 100, activationStart: 400, type: "navigate" } });
    sdk.init(config);
    sdk.flush();
    expect(sent()[0]?.ctx.nav).toBe("prerender");
  });

  it("uses nav restore after a bfcache restore", () => {
    installFakePerformance({ navigation: { responseStart: 100, type: "navigate" } });
    sdk.init(config);
    setVisibility("hidden");
    window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    setVisibility("visible");
    sdk.track("after_restore");
    sdk.flush();
    const batches = sent();
    expect(batches[0]?.ctx.nav).toBe("navigate");
    expect(batches.at(-1)?.ctx.nav).toBe("restore");
  });
});

describe("prerender", () => {
  it("holds events until the page is activated", () => {
    installFakePerformance();
    setPrerendering(true);
    sdk.init(config);
    sdk.flush();
    expect(beacon).not.toHaveBeenCalled();
    setPrerendering(false);
    sdk.flush();
    expect(sent().flatMap((b) => b.e).map((e) => e.t)).toContain("pageview");
  });
});

describe("sampling", () => {
  it("collects nothing on a page outside the sample", () => {
    installFakePerformance({ navigation: { responseStart: 100, type: "navigate" } });
    vi.spyOn(Math, "random").mockReturnValue(0.6);
    sdk.init({ ...config, sampleRate: 0.5 });
    sdk.track("ignored");
    setVisibility("hidden");
    expect(beacon).not.toHaveBeenCalled();
  });

  it("sends the sample rate with sampled pages", () => {
    installFakePerformance();
    vi.spyOn(Math, "random").mockReturnValue(0.4);
    sdk.init({ ...config, sampleRate: 0.5 });
    sdk.flush();
    expect(sent()[0]?.ctx.sr).toBe(0.5);
  });

  it("never samples with a rate of 0", () => {
    installFakePerformance();
    vi.spyOn(Math, "random").mockReturnValue(0);
    sdk.init({ ...config, sampleRate: 0 });
    sdk.flush();
    expect(beacon).not.toHaveBeenCalled();
  });
});
