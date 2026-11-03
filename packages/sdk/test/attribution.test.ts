import { Batch } from "@vitalscope/protocol/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSelector } from "../src/selector.js";
import { emit, installFakePerformance, setVisibility } from "./fake-performance.js";

type Sdk = typeof import("../src/index.js");

const config = { key: "pk_3f9a0c1d2e4b5a6978c0d1e2", endpoint: "https://ingest.test/v1/e" };
const SUPPORTED = ["largest-contentful-paint", "layout-shift", "event", "first-input", "long-animation-frame"];

let sdk: Sdk | undefined;
let beacon: ReturnType<typeof vi.fn<(url: string, body: string) => boolean>>;

const vitals = () =>
  beacon.mock.calls
    .flatMap(([, body]) => Batch.parse(JSON.parse(body)).e)
    .filter((e) => e.t === "vital");
const attrOf = (name: string) => vitals().find((v) => v.name === name)?.attr;

/** SDK'yı başlatır; metrik gözlemcileri ayrı task'te kurulduğu için zamanlayıcı ilerletilir. */
async function start(entry: "attribution" | "index" = "attribution") {
  sdk = entry === "index" ? await import("../src/index.js") : await import("../src/attribution.js");
  vi.useFakeTimers();
  sdk?.init(config);
  vi.advanceTimersByTime(0);
  vi.useRealTimers();
}

beforeEach(() => {
  vi.resetModules();
  beacon = vi.fn(() => true);
  vi.stubGlobal("navigator", { sendBeacon: beacon });
  document.body.innerHTML = "";
});

afterEach(() => {
  sdk?.disable();
  sdk = undefined;
  setVisibility("visible");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getSelector", () => {
  it("uses tag, id and classes up to the nearest id, never text", () => {
    document.body.innerHTML = '<main id="app"><div class="card big"><img class="hero"></div><p>Ayşe Yılmaz</p></main>';
    expect(getSelector(document.querySelector("img"))).toBe("main#app>div.card.big>img.hero");
    expect(getSelector(document.querySelector("p")?.firstChild)).toBe("main#app>p");
  });

  it("stays within 100 characters", () => {
    document.body.innerHTML = `<section class="${"x".repeat(80)}"><div class="${"y".repeat(40)}"><span></span></div></section>`;
    const selector = getSelector(document.querySelector("span"));
    expect(selector?.length).toBeLessThanOrEqual(100);
    expect(selector).toBe(`div.${"y".repeat(40)}>span`);
  });

  it("returns undefined without a node", () => {
    expect(getSelector(null)).toBeUndefined();
  });
});

describe("attribution", () => {
  it("breaks LCP into parts and keeps only the image URL's path", async () => {
    document.body.innerHTML = '<main><img class="hero"></main>';
    installFakePerformance({ supported: SUPPORTED, navigation: { responseStart: 100, type: "navigate" } });
    const url = "https://cdn.test/u/a@b.com/hero.png?token=xyz";
    vi.mocked(performance.getEntriesByType).mockImplementation((type: string) =>
      (type === "navigation"
        ? [{ responseStart: 100, type: "navigate" }]
        : type === "resource"
          ? [{ name: url, startTime: 250, requestStart: 300, responseEnd: 800 }]
          : []) as unknown as PerformanceEntryList,
    );
    await start();
    emit("largest-contentful-paint", [{ startTime: 1200, element: document.querySelector("img"), url }]);
    setVisibility("hidden");

    expect(attrOf("LCP")).toEqual({
      target: "body>main>img.hero",
      url: "https://cdn.test/u/[email]/hero.png",
      ttfb: 100,
      loadDelay: 200,
      loadTime: 500,
      renderDelay: 400,
    });
  });

  it("names the element that shifted most and when", async () => {
    document.body.innerHTML = '<div id="banner"></div><p></p>';
    installFakePerformance({ supported: SUPPORTED });
    await start();
    emit("layout-shift", [
      { startTime: 400, value: 0.05, hadRecentInput: false, sources: [{ node: document.querySelector("p") }] },
      { startTime: 500, value: 0.2, hadRecentInput: false, sources: [{ node: document.getElementById("banner") }] },
    ]);
    setVisibility("hidden");

    expect(attrOf("CLS")).toEqual({ target: "div#banner", time: 500 });
  });

  it("splits INP into phases and finds the longest script", async () => {
    document.body.innerHTML = '<button id="buy"></button>';
    installFakePerformance({ supported: SUPPORTED });
    await start();
    emit("long-animation-frame", [
      {
        startTime: 990,
        duration: 420,
        scripts: [
          { duration: 30, sourceURL: "https://site.test/vendor.js" },
          { duration: 240, sourceURL: "https://site.test/app.js?v=1#x" },
        ],
      },
    ]);
    emit("event", [
      {
        name: "click",
        interactionId: 7,
        startTime: 1000,
        processingStart: 1050,
        processingEnd: 1300,
        duration: 400,
        target: document.getElementById("buy"),
      },
    ]);
    setVisibility("hidden");

    expect(attrOf("INP")).toEqual({
      target: "button#buy",
      type: "pointer",
      inputDelay: 50,
      processing: 250,
      presentation: 100,
      script: "https://site.test/app.js",
    });
  });

  it("combines all events of one interaction", async () => {
    document.body.innerHTML = '<button id="buy"></button>';
    installFakePerformance({ supported: SUPPORTED });
    await start();
    const target = document.getElementById("buy");
    // Aynı karede biten olayların süresi eşittir; asıl iş click'te.
    emit("event", [
      { name: "pointerdown", interactionId: 3, startTime: 1000, processingStart: 1010, processingEnd: 1011, duration: 200, target },
      { name: "pointerup", interactionId: 3, startTime: 1020, processingStart: 1021, processingEnd: 1022, duration: 180, target },
      { name: "click", interactionId: 3, startTime: 1020, processingStart: 1022, processingEnd: 1172, duration: 180, target },
    ]);
    setVisibility("hidden");

    expect(attrOf("INP")).toEqual({ target: "button#buy", type: "pointer", inputDelay: 10, processing: 162, presentation: 28 });
  });

  it("leaves out events that ended in an earlier frame", async () => {
    document.body.innerHTML = '<button id="buy"></button>';
    installFakePerformance({ supported: SUPPORTED });
    await start();
    const target = document.getElementById("buy");
    // pointerdown kendi karesinde biter (1016); click sonraki karede başlayıp 1176'da biter.
    emit("event", [
      { name: "pointerdown", interactionId: 4, startTime: 1000, processingStart: 1002, processingEnd: 1003, duration: 16, target },
      { name: "click", interactionId: 4, startTime: 1016, processingStart: 1018, processingEnd: 1168, duration: 160, target },
    ]);
    setVisibility("hidden");

    const inp = vitals().find((v) => v.name === "INP");
    expect(inp?.attr).toMatchObject({ inputDelay: 2, processing: 150, presentation: 8 });
    const { inputDelay = 0, processing = 0, presentation = 0 } = inp?.attr ?? {};
    expect(inputDelay + processing + presentation).toBe(inp?.value);
  });

  it("still sends the metric when attribution fails", async () => {
    installFakePerformance({ supported: SUPPORTED });
    await start();
    const broken = {
      startTime: 1200,
      get element(): Element {
        throw new Error("boom");
      },
    };
    emit("largest-contentful-paint", [broken]);
    setVisibility("hidden");

    expect(vitals().find((v) => v.name === "LCP")).toMatchObject({ value: 1200 });
    expect(attrOf("LCP")).toBeUndefined();
  });

  it("is not added by the core entry", async () => {
    document.body.innerHTML = "<img>";
    installFakePerformance({ supported: SUPPORTED });
    await start("index");
    emit("largest-contentful-paint", [{ startTime: 1200, element: document.querySelector("img") }]);
    setVisibility("hidden");

    expect(vitals().find((v) => v.name === "LCP")).toMatchObject({ value: 1200 });
    expect(attrOf("LCP")).toBeUndefined();
  });
});
