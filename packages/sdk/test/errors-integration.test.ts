import { Batch } from "@vitalscope/protocol/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Sdk = typeof import("../src/index.js");

const config = { key: "pk_3f9a0c1d2e4b5a6978c0d1e2", endpoint: "https://ingest.test/v1/e" };

let sdk: Sdk;
let beacon: ReturnType<typeof vi.fn<(url: string, body: string) => boolean>>;
let privacy: { doNotTrack?: string; globalPrivacyControl?: boolean };

const sentEvents = () => beacon.mock.calls.flatMap(([, body]) => Batch.parse(JSON.parse(body)).e);
const sentErrors = () => sentEvents().filter((e) => e.t === "error");

function dispatchError(error: unknown, message = "Uncaught") {
  window.dispatchEvent(new ErrorEvent("error", { error, message }));
}

beforeEach(async () => {
  vi.resetModules();
  beacon = vi.fn(() => true);
  privacy = {};
  vi.stubGlobal("navigator", {
    sendBeacon: beacon,
    get doNotTrack() {
      return privacy.doNotTrack;
    },
    get globalPrivacyControl() {
      return privacy.globalPrivacyControl;
    },
  });
  sdk = await import("../src/index.js");
});

afterEach(() => {
  sdk.disable();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("automatic capture", () => {
  it("captures window errors and unhandled rejections", () => {
    sdk.init(config);
    dispatchError(new TypeError("a is undefined"));
    const rejection = new Event("unhandledrejection") as Event & { reason: unknown };
    rejection.reason = new Error("fetch failed");
    window.dispatchEvent(rejection);
    sdk.flush();
    expect(sentErrors().map((e) => [e.type, e.msg, e.handled])).toEqual([
      ["TypeError", "a is undefined", false],
      ["Error", "fetch failed", false],
    ]);
  });

  it("does not replace an existing window.onerror handler", () => {
    const existing = vi.fn();
    window.onerror = existing;
    sdk.init(config);
    expect(window.onerror).toBe(existing);
    window.onerror = null;
  });

  it("can be turned off with captureErrors: false", () => {
    // SDK dinlemediği için olayı test işler; yoksa test ortamı onu yakalanmamış hata sayar.
    const markHandled = (event: Event) => event.preventDefault();
    window.addEventListener("error", markHandled);
    sdk.init({ ...config, captureErrors: false });
    dispatchError(new Error("ignored"));
    window.removeEventListener("error", markHandled);
    sdk.flush();
    expect(sentErrors()).toEqual([]);
  });
});

describe("captureError", () => {
  it("sends handled errors by default and respects handled: false", () => {
    sdk.init(config);
    sdk.captureError(new Error("caught"));
    sdk.captureError(new Error("boundary"), { handled: false });
    sdk.flush();
    expect(sentErrors().map((e) => [e.msg, e.handled])).toEqual([
      ["caught", true],
      ["boundary", false],
    ]);
  });

  it("is a no-op before init and never throws", () => {
    expect(() => sdk.captureError(new Error("early"))).not.toThrow();
    sdk.init(config);
    expect(() => sdk.captureError(Object.create(null))).not.toThrow();
    sdk.flush();
    expect(sentErrors().map((e) => e.msg)).not.toContain("early");
  });
});

describe("path privacy", () => {
  it("drops query and hash but keeps allowlisted params with scrubbed values", () => {
    window.history.replaceState(null, "", "/kullanici/a@b.com?utm_source=x%40y.com&token=s3cr3t&page=2#section");
    sdk.init({ ...config, keepQuery: ["utm_source", "page"] });
    sdk.flush();
    const body = JSON.parse(beacon.mock.calls[0]![1]);
    expect(body.ctx.path).toBe("/kullanici/[email]?utm_source=%5Bredacted%5D&page=2");
  });

  it("sends only the scrubbed pathname by default", () => {
    window.history.replaceState(null, "", "/siparis/550e8400-e29b-41d4-a716-446655440000?email=a@b.com");
    sdk.init(config);
    sdk.flush();
    expect(JSON.parse(beacon.mock.calls[0]![1]).ctx.path).toBe("/siparis/[uuid]");
  });
});

describe("respectDoNotTrack", () => {
  it.each([
    ["Global Privacy Control", { globalPrivacyControl: true }],
    ["Do Not Track", { doNotTrack: "1" }],
  ])("collects nothing when %s is on", (_, signal) => {
    Object.assign(privacy, signal);
    sdk.init({ ...config, respectDoNotTrack: true });
    sdk.flush();
    expect(beacon).not.toHaveBeenCalled();
  });

  it("ignores the signals unless the option is enabled", () => {
    privacy.globalPrivacyControl = true;
    sdk.init(config);
    sdk.flush();
    expect(beacon).toHaveBeenCalledOnce();
  });
});
