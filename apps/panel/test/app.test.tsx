import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOSTILE = `/"><img src=x onerror=alert(1)>`;
const summary = (name: string, p75: number | null, rating: string | null = "good") => ({ name, count: p75 === null ? 0 : 10, p75, rating, counts: { good: p75 === null ? 0 : 7, needsImprovement: p75 === null ? 0 : 2, poor: p75 === null ? 0 : 1 } });
const OVERVIEW = {
  metrics: [summary("LCP", 1200), summary("INP", 700, "poor"), summary("CLS", 0.2, "needs-improvement"), summary("FCP", null), summary("TTFB", 300)],
  pages: [
    { page: "/", views: 12, p75: { LCP: 1200, INP: 700 } },
    { page: HOSTILE, views: 1, p75: {} },
  ],
  morePages: 3,
};
const DETAIL = {
  summary: summary("LCP", 1200),
  series: { x: [1_800_000_000_000, 1_800_000_060_000], p50: [900, 950], p75: [1200, 1250], p95: [2000, 2100] },
  histogram: { bins: [{ start: 0, end: 2500, count: 8 }, { start: 2500, end: 4000, count: 1 }, { start: 4000, end: 4500, count: 1 }], above: 2, percentiles: { p50: 900, p75: 1200, p95: 2000 } },
  pages: [{ key: "/checkout", count: 10, p75: 1200, rating: "good" }],
  devices: [{ key: "mobile", count: 10, p75: 1200, rating: "good" }],
};
const OPTIONS = { environments: ["production", "development"], pages: ["/", "/checkout"], devices: ["desktop", "mobile"] };

let root: Root;
let container: HTMLElement;
let responses: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;

function respond(url: string) {
  const path = url.split("?")[0]!;
  const body = path in responses ? responses[path] : undefined;
  if (body === undefined) return Promise.resolve(new Response(null, { status: 500 }));
  return Promise.resolve(new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }));
}

beforeEach(() => {
  responses = { "/api/options": OPTIONS, "/api/overview": OVERVIEW, "/api/metrics/LCP": DETAIL, "/api/metrics/CLS": { ...DETAIL, summary: summary("CLS", 0.05), histogram: { ...DETAIL.histogram, above: 0 } } };
  fetchMock = vi.fn((url: string) => respond(url));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  history.replaceState(null, "", "/");
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve));
  });
}

async function show(url = "/") {
  history.replaceState(null, "", url);
  await act(async () => root.render(<App />));
  await flush();
}

const text = () => container.textContent ?? "";
const select = (label: string) => [...container.querySelectorAll("label")].find((element) => element.textContent?.startsWith(label))!.querySelector("select")!;
const link = (name: string) => [...container.querySelectorAll("a")].find((element) => element.textContent === name)!;
const requested = () => fetchMock.mock.calls.map(([url]) => url as string);

async function choose(element: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

describe("App", () => {
  it("teaches the setup when nothing was collected", async () => {
    responses["/api/options"] = { environments: [], pages: [], devices: [] };
    await show();
    expect(text()).toContain("No measurements yet");
    expect(text()).toContain('import("@vitalscope/sdk")');
    expect(container.querySelector("form")).toBeNull();
    expect(requested()).toEqual(["/api/options"]);
  });

  it("explains a failure to load", async () => {
    delete responses["/api/options"];
    await show();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("vitalscope dev");
  });

  it("explains a failure to load the data", async () => {
    delete responses["/api/overview"];
    await show();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("opens on production when it exists", async () => {
    await show();
    expect(select("Environment").value).toBe("production");
    expect(requested()).toContain("/api/overview?env=production");
    expect(container.querySelector(".warning")).toBeNull();
  });

  it("falls back to the environment that has data, and warns about development", async () => {
    responses["/api/options"] = { ...OPTIONS, environments: ["development"] };
    await show();
    expect(select("Environment").value).toBe("development");
    expect(container.querySelector(".warning")?.textContent).toContain("differ from a production build");
  });

  it("shows each metric's p75 with a rating in words", async () => {
    await show();
    const cards = [...container.querySelectorAll(".card")];
    expect(cards).toHaveLength(5);
    expect(cards[0]?.textContent).toContain("1.20 s");
    expect(cards[1]?.textContent).toContain("Poor");
    expect(cards[2]?.textContent).toContain("0.20");
    expect(cards[3]?.textContent).toContain("No measurements");
    expect(container.querySelectorAll(".vs-chart-legend")).toHaveLength(1);
  });

  it("lists pages and says how many are hidden", async () => {
    await show();
    const row = container.querySelector(".table-section tbody tr")!;
    expect(row.textContent).toContain("1.20 s");
    expect(row.textContent).toContain("700 ms");
    expect(row.textContent).toContain("-");
    expect(text()).toContain("…and 3 more pages");
  });

  it("renders page data as text, not markup", async () => {
    await show();
    expect(container.querySelector("main img")).toBeNull();
    expect(link(HOSTILE)).toBeDefined();
  });

  it("says when filters match nothing", async () => {
    responses["/api/overview"] = { metrics: [], pages: [], morePages: 0 };
    await show("/?page=%2Fgone");
    expect(text()).toContain("No measurements match these filters.");
    expect(select("Page").value).toBe("/gone");
  });

  it("puts filters in the address and sends them to the server", async () => {
    await show();
    await choose(select("Device"), "mobile");
    expect(location.search).toBe("?device=mobile");
    expect(requested().at(-1)).toBe("/api/overview?env=production&device=mobile");
    await choose(select("Range"), "7d");
    expect(location.search).toBe("?device=mobile&range=7d");
    await choose(select("Environment"), "development");
    expect(requested().at(-1)).toBe("/api/overview?env=development&device=mobile&range=7d");
    await choose(select("Page"), "/checkout");
    expect(new URLSearchParams(location.search).get("page")).toBe("/checkout");
  });

  it("clears filters", async () => {
    await show("/?device=mobile&page=%2Fa");
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Clear"))!.click());
    await flush();
    expect(location.search).toBe("");
    expect(select("Device").value).toBe("");
    await choose(select("Device"), "mobile");
    await choose(select("Device"), "");
    expect(location.search).toBe("");
  });

  it("restores the view on back", async () => {
    await show();
    await choose(select("Device"), "mobile");
    history.replaceState(null, "", "/");
    await act(async () => {
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await flush();
    expect(select("Device").value).toBe("");
  });

  it("opens from a shared address", async () => {
    await show("/?metric=LCP&env=development&device=mobile");
    expect(requested()).toContain("/api/metrics/LCP?env=development&device=mobile");
    expect(link("LCP").getAttribute("aria-current")).toBe("page");
  });

  it("cancels the previous request and ignores its late answer", async () => {
    const signals: AbortSignal[] = [];
    let answerFirst: (response: Response) => void = () => {};
    let overviewCalls = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (!url.startsWith("/api/overview")) return respond(url);
      signals.push(init!.signal!);
      overviewCalls++;
      if (overviewCalls === 1) return new Promise<Response>((resolve) => (answerFirst = resolve));
      return respond(url);
    });
    await show();
    await choose(select("Device"), "mobile");
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect(container.querySelector(".card")).not.toBeNull();
    await act(async () => answerFirst(new Response(JSON.stringify({ metrics: [], pages: [], morePages: 0 }))));
    await flush();
    expect(container.querySelector(".card")).not.toBeNull();
  });

  it("keeps the previous view dimmed while new data loads", async () => {
    await show();
    let answer: (response: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (answer = resolve)));
    await choose(select("Device"), "mobile");
    expect(container.querySelector(".stale .card")).not.toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(async () => answer(new Response(JSON.stringify(OVERVIEW))));
    await flush();
    expect(container.querySelector(".stale")).toBeNull();
  });

  it("navigates to a metric without reloading and leaves modified clicks to the browser", async () => {
    await show();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    act(() => link("TTFB").dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(location.search).toBe("");
    event.preventDefault();
    await act(async () => link("LCP").click());
    await flush();
    expect(location.search).toBe("?metric=LCP");
  });

  describe("metric view", () => {
    it("draws the rating bar, time series, histogram and breakdowns", async () => {
      await show("/?metric=LCP");
      expect(text()).toContain("LCP ratings");
      expect(text()).toContain("LCP over time");
      expect(text()).toContain("LCP distribution");
      expect(container.querySelectorAll("path.vs-line")).toHaveLength(3);
      expect(container.querySelector("path.vs-bar")).not.toBeNull();
      expect(link("/checkout").getAttribute("href")).toContain("page=%2Fcheckout");
      expect(link("mobile").getAttribute("href")).toContain("device=mobile");
    });

    it("draws the thresholds of the metric", async () => {
      await show("/?metric=LCP");
      const labels = [...container.querySelectorAll("text.vs-marker-label")].map((label) => label.textContent);
      expect(labels).toContain("Good up to 2.50 s");
      expect(labels).toContain("Poor above 4.00 s");
      expect(labels).toContain("p75 1.20 s");
    });

    it("says when measurements are off the chart", async () => {
      await show("/?metric=LCP");
      expect(text()).toContain("2 slower measurements are off the chart");
    });

    it("notes which browsers measure CLS", async () => {
      await show("/?metric=CLS");
      expect(text()).toContain("Only Chromium-based browsers measure CLS.");
      expect(text()).not.toContain("off the chart");
    });

    it("says when filters match nothing", async () => {
      responses["/api/metrics/LCP"] = { ...DETAIL, summary: summary("LCP", null, null) };
      await show("/?metric=LCP");
      expect(text()).toContain("No measurements match these filters.");
    });

    it("explains a failure to load", async () => {
      delete responses["/api/metrics/LCP"];
      await show("/?metric=LCP");
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    });
  });
});
