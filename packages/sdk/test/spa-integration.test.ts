import { Batch } from "@vitalscope/protocol/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Sdk = typeof import("../src/index.js");

const config = { key: "pk_3f9a0c1d2e4b5a6978c0d1e2", endpoint: "https://ingest.test/v1/e" };

let sdk: Sdk;
let beacon: ReturnType<typeof vi.fn<(url: string, body: string) => boolean>>;

/** Gönderilen her batch: bağlamdaki path/route ve içindeki olay tipleri. */
const sentBatches = () =>
  beacon.mock.calls.map(([, body]) => {
    const batch = Batch.parse(JSON.parse(body));
    return { path: batch.ctx.path, route: batch.ctx.route, events: batch.e.map((e) => e.t) };
  });

beforeEach(async () => {
  vi.resetModules();
  beacon = vi.fn(() => true);
  vi.stubGlobal("navigator", { sendBeacon: beacon });
  window.history.replaceState(null, "", "/");
  sdk = await import("../src/index.js");
});

afterEach(() => {
  sdk.disable();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

describe("route changes", () => {
  it("sends a pageview per route and keeps each page's events under its own path", () => {
    sdk.init(config);
    sdk.track("viewed_home");
    history.pushState(null, "", "/urun/1");
    sdk.captureError(new Error("on product"));
    history.pushState(null, "", "/sepet");
    history.pushState(null, "", "/odeme");
    sdk.flush();

    expect(sentBatches()).toEqual([
      { path: "/", route: undefined, events: ["pageview", "custom"] },
      { path: "/urun/1", route: undefined, events: ["pageview", "error"] },
      { path: "/sepet", route: undefined, events: ["pageview"] },
      { path: "/odeme", route: undefined, events: ["pageview"] },
    ]);
  });

  it("counts back/forward navigation", () => {
    sdk.init(config);
    history.pushState(null, "", "/a");
    // Tarayıcı geri gidince URL'i kendisi değiştirir (sarmalanmış fonksiyon çağrılmaz), sonra popstate gelir.
    History.prototype.replaceState.call(history, null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    sdk.flush();
    expect(sentBatches().map((b) => b.path)).toEqual(["/", "/a", "/"]);
  });

  it("ignores hash changes, dropped query params and same-path replaceState", () => {
    sdk.init(config);
    history.pushState(null, "", "/#section");
    history.replaceState({ scroll: 1 }, "", "/?utm_source=x");
    history.pushState(null, "", "/?page=2");
    sdk.flush();
    expect(sentBatches()).toEqual([{ path: "/", route: undefined, events: ["pageview"] }]);
  });

  it("treats a change in a kept query param as a new page", () => {
    sdk.init({ ...config, keepQuery: ["page"] });
    history.pushState(null, "", "/?page=2");
    sdk.flush();
    expect(sentBatches().map((b) => b.path)).toEqual(["/", "/?page=2"]);
  });

  it("scrubs personal data from the new path", () => {
    sdk.init(config);
    history.pushState(null, "", "/kullanici/a@b.com");
    sdk.flush();
    expect(sentBatches().at(-1)?.path).toBe("/kullanici/[email]");
  });

  it("does nothing with trackSpa: false", () => {
    const { pushState } = History.prototype;
    sdk.init({ ...config, trackSpa: false });
    expect(history.pushState).toBe(pushState);
    history.pushState(null, "", "/a");
    sdk.flush();
    expect(sentBatches()).toEqual([{ path: "/", route: undefined, events: ["pageview"] }]);
  });

  it("restores history functions on disable", () => {
    const { pushState } = History.prototype;
    sdk.init(config);
    sdk.disable();
    expect(history.pushState).toBe(pushState);
    history.pushState(null, "", "/a");
    expect(beacon).not.toHaveBeenCalled();
  });
});

describe("setRoute", () => {
  it("attaches the route template to the current page until the next route change", () => {
    sdk.init(config);
    history.pushState(null, "", "/urun/42");
    sdk.setRoute("/urun/[id]");
    history.pushState(null, "", "/hakkimizda");
    sdk.flush();
    expect(sentBatches().slice(1)).toEqual([
      { path: "/urun/42", route: "/urun/[id]", events: ["pageview"] },
      { path: "/hakkimizda", route: undefined, events: ["pageview"] },
    ]);
  });

  it("scrubs and truncates the template and ignores invalid input", () => {
    sdk.init(config);
    sdk.setRoute(`/u/a@b.com/${"x".repeat(300)}`);
    sdk.flush();
    const route = sentBatches()[0]?.route;
    expect(route?.startsWith("/u/[email]/")).toBe(true);
    expect(route).toHaveLength(200);

    expect(() => sdk.setRoute(42 as unknown as string)).not.toThrow();
  });

  it("is a no-op before init", () => {
    expect(() => sdk.setRoute("/x")).not.toThrow();
  });
});
