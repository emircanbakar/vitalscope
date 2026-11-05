import { Batch } from "@vitalscope/protocol/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Sdk = typeof import("../src/index.js");

const config = { key: "pk_3f9a0c1d2e4b5a6978c0d1e2", endpoint: "https://ingest.test/v1/e" };

let sdk: Sdk;
let beacon: ReturnType<typeof vi.fn<(url: string, body: string) => boolean>>;

/** Gönderilen tüm gövdeler, protokol şemasından geçirilerek. */
const sent = () => beacon.mock.calls.map(([, body]) => Batch.parse(JSON.parse(body)));
const sentEvents = () => sent().flatMap((b) => b.e);

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(async () => {
  vi.resetModules();
  beacon = vi.fn(() => true);
  vi.stubGlobal("navigator", { sendBeacon: beacon });
  sdk = await import("../src/index.js");
});

afterEach(() => {
  sdk.disable();
  setVisibility("visible");
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("init", () => {
  it("queues a pageview and sends a protocol-valid batch on flush", () => {
    sdk.init({ ...config, release: "9f2c1ab" });
    expect(beacon).not.toHaveBeenCalled();
    sdk.flush();
    const [batch] = sent();
    expect(batch?.k).toBe(config.key);
    expect(batch?.sdk).toBe("0.0.0-test");
    expect(batch?.ctx).toMatchObject({ path: "/", release: "9f2c1ab", env: "development", device: "desktop" });
    expect(batch?.ctx.sid).toMatch(/^[0-9a-f]{16}$/);
    expect(batch?.e).toEqual([{ t: "pageview", ts: expect.any(Number) }]);
  });

  it("starts without any configuration and sends to the local collector", () => {
    sdk.init();
    sdk.flush();
    expect(beacon.mock.calls[0]?.[0]).toBe("http://localhost:8787/v1/e");
    expect(sentEvents()).toEqual([{ t: "pageview", ts: expect.any(Number) }]);
  });

  it("does nothing at all on a page that is not local, even in dev mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const listen = vi.spyOn(globalThis, "addEventListener");
    vi.stubGlobal("location", new URL("https://ecbakar.com/urun"));
    sdk.init({ ...config, environment: "development", debug: true });
    sdk.track("x");
    sdk.captureError(new Error("x"));
    sdk.flush();
    expect(beacon).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not start with an invalid config and warns only in dev mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    sdk.init({ key: "nope", endpoint: config.endpoint });
    sdk.flush();
    expect(beacon).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();

    sdk.init({ key: "nope", endpoint: config.endpoint, environment: "development" });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("ignores a second init call", () => {
    sdk.init(config);
    sdk.init({ ...config, release: "other" });
    sdk.flush();
    expect(sentEvents()).toHaveLength(1);
    expect(sent()[0]?.ctx.release).toBeUndefined();
  });

  it("never registers unload or beforeunload listeners (bfcache)", () => {
    const winAdd = vi.spyOn(window, "addEventListener");
    const docAdd = vi.spyOn(document, "addEventListener");
    sdk.init(config);
    const types = [...winAdd.mock.calls, ...docAdd.mock.calls].map(([type]) => type);
    expect(types).toEqual(expect.arrayContaining(["visibilitychange", "pagehide"]));
    expect(types).not.toContain("unload");
    expect(types).not.toContain("beforeunload");
  });
});

describe("flush triggers", () => {
  it("flushes when the page becomes hidden", () => {
    sdk.init(config);
    setVisibility("hidden");
    expect(sentEvents()).toHaveLength(1);
  });

  it("flushes on pagehide", () => {
    sdk.init(config);
    window.dispatchEvent(new Event("pagehide"));
    expect(sentEvents()).toHaveLength(1);
  });

  it("flushes as soon as 20 events are queued", () => {
    sdk.init(config);
    for (let i = 0; i < 18; i++) sdk.track("click");
    expect(beacon).not.toHaveBeenCalled();
    sdk.track("click");
    expect(sentEvents()).toHaveLength(20);
  });

  it("flushes 10 seconds after the first event", () => {
    vi.useFakeTimers();
    sdk.init(config);
    vi.advanceTimersByTime(9_999);
    expect(beacon).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(sentEvents()).toHaveLength(1);
  });

  it("sends nothing when the queue is empty", () => {
    sdk.init(config);
    sdk.flush();
    sdk.flush();
    expect(beacon).toHaveBeenCalledOnce();
  });
});

describe("track", () => {
  it("sends custom events and drops non-finite values", () => {
    sdk.init(config);
    sdk.track("checkout_completed", 42);
    sdk.track("bad_value", Number.NaN);
    sdk.track("");
    sdk.flush();
    expect(sentEvents().slice(1)).toEqual([
      { t: "custom", ts: expect.any(Number), name: "checkout_completed", value: 42 },
      { t: "custom", ts: expect.any(Number), name: "bad_value" },
    ]);
  });

  it("does nothing before init", () => {
    sdk.track("early");
    sdk.flush();
    expect(beacon).not.toHaveBeenCalled();
  });
});

describe("debug mode", () => {
  it("logs batches instead of sending them", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    sdk.init({ ...config, debug: true });
    sdk.flush();
    expect(beacon).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith("[vitalscope]", expect.objectContaining({ k: config.key }));
  });
});

describe("disable", () => {
  it("drops queued events and stops listening", () => {
    sdk.init(config);
    sdk.disable();
    setVisibility("hidden");
    sdk.track("after");
    sdk.flush();
    expect(beacon).not.toHaveBeenCalled();
  });
});

describe("error isolation", () => {
  it("never throws into the host page", () => {
    beacon.mockImplementation(() => {
      throw new Error("boom");
    });
    sdk.init(config);
    expect(() => sdk.flush()).not.toThrow();
    expect(() => setVisibility("hidden")).not.toThrow();
    expect(() => sdk.init(null as never)).not.toThrow();
    expect(() => sdk.track(123 as never)).not.toThrow();
  });
});
