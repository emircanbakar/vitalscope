import { LIMITS, type Event } from "@vitalscope/protocol";
import { Batch } from "@vitalscope/protocol/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeBatches, send, type BatchHeader } from "../src/transport.js";

const header: BatchHeader = {
  k: "pk_3f9a0c1d2e4b5a6978c0d1e2",
  sdk: "0.0.0-test",
  ctx: { sid: "a81f0c33b7e94d12", path: "/", device: "desktop" },
};
const pageview = (i: number): Event => ({ t: "pageview", ts: 1792044000000 + i });
const bigError = (i: number): Event => ({
  t: "error",
  ts: 1792044000000 + i,
  type: "Error",
  msg: "m".repeat(LIMITS.maxErrorMessageLength),
  stack: Array(LIMITS.maxStackFrames).fill("s".repeat(LIMITS.maxStackFrameLength)),
  handled: true,
});
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe("encodeBatches", () => {
  it("produces bodies that pass the protocol schema", () => {
    const [body] = encodeBatches(header, [pageview(0), { t: "custom", ts: 1792044000001, name: "signup" }]);
    const parsed = Batch.parse(JSON.parse(body!));
    expect(parsed.e).toHaveLength(2);
  });

  it("splits by event count", () => {
    const bodies = encodeBatches(header, Array.from({ length: 120 }, (_, i) => pageview(i)));
    expect(bodies.map((b) => JSON.parse(b).e.length)).toEqual([50, 50, 20]);
    for (const b of bodies) expect(Batch.safeParse(JSON.parse(b)).success).toBe(true);
  });

  it("splits by size and keeps every body within the byte budget", () => {
    const events = Array.from({ length: 12 }, (_, i) => bigError(i));
    const bodies = encodeBatches(header, events);
    expect(bodies.length).toBeGreaterThan(1);
    for (const b of bodies) {
      expect(bytes(b)).toBeLessThanOrEqual(LIMITS.maxBatchBytes);
      expect(Batch.safeParse(JSON.parse(b)).success).toBe(true);
    }
    expect(bodies.reduce((n, b) => n + JSON.parse(b).e.length, 0)).toBe(12);
  });

  it("returns nothing for an empty queue", () => {
    expect(encodeBatches(header, [])).toEqual([]);
  });
});

describe("send", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses sendBeacon with a string body (text/plain, no preflight)", () => {
    const beacon = vi.fn(() => true);
    const fetchMock = vi.fn();
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    vi.stubGlobal("fetch", fetchMock);
    send("https://ingest.test/v1/e", "{}");
    expect(beacon).toHaveBeenCalledWith("https://ingest.test/v1/e", "{}");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to fetch keepalive without credentials when sendBeacon refuses", () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("navigator", { sendBeacon: () => false });
    vi.stubGlobal("fetch", fetchMock);
    expect(() => send("https://ingest.test/v1/e", "{}")).not.toThrow();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ingest.test/v1/e",
      expect.objectContaining({ method: "POST", keepalive: true, credentials: "omit", body: "{}" }),
    );
  });

  it("drops silently when neither transport exists", () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", undefined);
    expect(() => send("https://ingest.test/v1/e", "{}")).not.toThrow();
  });
});
