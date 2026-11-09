import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app.js";
import { baseView, parseView, viewUrl } from "../src/filters.js";
import { describeChange } from "../src/releases.js";
import { stubLive } from "./live-stubs.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "0123456789abcdef";
const HOSTILE = `<img src=x onerror=alert(1)>`;
const OPTIONS = { environments: ["production"], pages: ["/"], devices: ["desktop"] };
const GROUP = { id: ID, type: "TypeError", message: HOSTILE, location: "load (/src/a.js)", count: 12, firstSeen: 1_800_000_000_000, lastSeen: 1_800_000_060_000 };
const LIST = { errors: [GROUP, { ...GROUP, id: "fedcba9876543210", location: undefined, message: "plain", count: 1 }], moreErrors: 2 };
const DETAIL = {
  ...GROUP,
  stack: [`at load (${HOSTILE})`, "at main"],
  handled: false,
  series: { x: [1_800_000_000_000, 1_800_000_060_000], counts: [10, 2] },
  pages: [{ key: "/checkout", count: 12 }],
  devices: [{ key: "mobile", count: 12 }],
  releases: [{ key: "v2", count: 10 }, { key: "", count: 2 }],
};
const side = (count: number, p75: number | null, rating: string | null = "good") => ({ count, p75, rating });
const COMPARISON = {
  views: { a: 20, b: 18 },
  metrics: [
    { name: "LCP", a: side(20, 1000), b: side(18, 2000) },
    { name: "INP", a: side(20, 300, "needs-improvement"), b: side(18, 150) },
    { name: "CLS", a: side(20, 0.1), b: side(18, 0.101) },
    { name: "FCP", a: side(2, 800), b: side(18, 3000, "poor") },
    { name: "TTFB", a: side(0, null, null), b: side(0, null, null) },
  ],
  errors: [
    { id: ID, type: "Error", message: "fresh", location: "a (/a.js)", a: 0, b: 3 },
    { id: "fedcba9876543210", type: "Error", message: "gone", location: undefined, a: 2, b: 0 },
    { id: "aaaaaaaaaaaaaaaa", type: "Error", message: "both", location: undefined, a: 1, b: 1 },
  ],
  moreErrors: 4,
};

let root: Root;
let container: HTMLElement;
let responses: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  responses = { "/api/options": OPTIONS, "/api/errors": LIST, [`/api/errors/${ID}`]: DETAIL, "/api/releases": ["v2", "v1", "v0"], "/api/compare": COMPARISON };
  fetchMock = vi.fn((url: string) => {
    const path = url.split("?")[0]!;
    if (!(path in responses)) return Promise.resolve(new Response(null, { status: 500 }));
    return Promise.resolve(new Response(JSON.stringify(responses[path])));
  });
  vi.stubGlobal("fetch", fetchMock);
  stubLive();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
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

async function show(url: string) {
  history.replaceState(null, "", url);
  await act(async () => root.render(<App />));
  await flush();
}

const text = () => container.textContent ?? "";
const link = (name: string) => [...container.querySelectorAll("a")].find((element) => element.textContent === name)!;
const requested = () => fetchMock.mock.calls.map(([url]) => url as string);
const select = (label: string) => [...container.querySelectorAll("label")].find((element) => element.textContent?.startsWith(label))!.querySelector("select")!;
const rowOf = (name: string) => [...container.querySelectorAll("tr")].find((row) => row.textContent?.includes(name))!;

async function choose(element: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

describe("view state", () => {
  it("reads and writes errors and releases", () => {
    const errors = { range: "all", tab: "errors", error: ID } as const;
    expect(parseView(viewUrl(errors))).toEqual(errors);
    const releases = { range: "all", tab: "releases", a: "v 1&", b: "v2" } as const;
    expect(parseView(viewUrl(releases))).toEqual(releases);
  });

  it.each(["?tab=nope", "?error=" + ID, "?tab=errors&error=nope", "?tab=errors&error=../../x", "?a=v1"])("ignores %s", (search) => {
    const view = parseView(search);
    expect(view.error).toBeUndefined();
    expect(view.a).toBeUndefined();
  });

  it("keeps only the filters when switching tabs", () => {
    expect(baseView({ range: "7d", env: "production", page: "/", device: "mobile", tab: "errors", error: ID, metric: "LCP", a: "x", b: "y" })).toEqual({ range: "7d", env: "production", page: "/", device: "mobile" });
  });
});

describe("error list", () => {
  it("lists groups with count and location, as text", async () => {
    await show("/?tab=errors");
    expect(requested()).toContain("/api/errors?env=production&range=30d");
    expect(rowOf("load (/src/a.js)").textContent).toContain("12");
    expect(text()).toContain(`TypeError: ${HOSTILE}`);
    expect(container.querySelector("main img")).toBeNull();
    expect(text()).toContain("…and 2 more errors");
    expect(link("Errors").getAttribute("aria-current")).toBe("page");
  });

  it("says when no error matches", async () => {
    responses["/api/errors"] = { errors: [], moreErrors: 0 };
    await show("/?tab=errors");
    expect(text()).toContain("No errors match these filters.");
  });

  it("explains a failure", async () => {
    delete responses["/api/errors"];
    await show("/?tab=errors");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("opens an error and keeps the filters", async () => {
    await show("/?tab=errors&device=mobile");
    await act(async () => link(`TypeError: ${HOSTILE}`).click());
    await flush();
    expect(location.search).toContain(`error=${ID}`);
    expect(location.search).toContain("device=mobile");
    expect(requested().at(-1)).toBe(`/api/errors/${ID}?env=production&device=mobile&range=30d`);
  });
});

describe("error detail", () => {
  it("shows the stack, facts, occurrences and breakdowns", async () => {
    await show(`/?tab=errors&error=${ID}`);
    expect(container.querySelector(".stack")?.textContent).toBe(`at load (${HOSTILE})\nat main`);
    expect(container.querySelector("main img")).toBeNull();
    expect(text()).toContain("uncaught");
    expect(text()).toContain("Occurrences over time");
    expect(container.querySelector("path.vs-line")).not.toBeNull();
    expect(rowOf("/checkout").textContent).toContain("12");
    expect(rowOf("v2").textContent).toContain("10");
    expect(text()).toContain("No release set");
  });

  it("names errors reported by the app", async () => {
    responses[`/api/errors/${ID}`] = { ...DETAIL, handled: true, stack: [], location: undefined };
    await show(`/?tab=errors&error=${ID}`);
    expect(text()).toContain("captureError");
    expect(container.querySelector(".stack")).toBeNull();
  });

  it("goes back to the list", async () => {
    await show(`/?tab=errors&error=${ID}&range=7d`);
    await act(async () => link("← All errors").click());
    await flush();
    expect(location.search).toBe("?range=7d&tab=errors");
  });

  it("says when the error is outside the filters", async () => {
    responses[`/api/errors/${ID}`] = null;
    await show(`/?tab=errors&error=${ID}`);
    expect(text()).toContain("No errors match these filters.");
    expect(link("← All errors")).toBeDefined();
  });

  it("explains a failure", async () => {
    delete responses[`/api/errors/${ID}`];
    await show(`/?tab=errors&error=${ID}`);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe("describeChange", () => {
  it("names the direction and amount", () => {
    expect(describeChange("LCP", side(9, 1000) as never, side(9, 1500) as never)).toEqual({ text: "Slower, +500 ms (+50%)", tone: "change-worse" });
    expect(describeChange("LCP", side(9, 2000) as never, side(9, 1000) as never)).toEqual({ text: "Faster, −1.00 s (−50%)", tone: "change-better" });
    expect(describeChange("CLS", side(9, 0.1) as never, side(9, 0.2) as never)).toEqual({ text: "Worse, +0.10 (+100%)", tone: "change-worse" });
    expect(describeChange("CLS", side(9, 0.2) as never, side(9, 0.1) as never)).toEqual({ text: "Better, −0.10 (−50%)", tone: "change-better" });
  });

  it("does not let a large percentage of a tiny value look like a change", () => {
    expect(describeChange("TTFB", side(9, 9) as never, side(9, 4) as never).text).toBe("About the same");
    expect(describeChange("LCP", side(9, 36) as never, side(9, 24) as never).text).toBe("About the same");
    expect(describeChange("CLS", side(9, 0.01) as never, side(9, 0.015) as never).text).toBe("About the same");
  });

  it("does not call small differences a change", () => {
    expect(describeChange("LCP", side(9, 1000) as never, side(9, 1040) as never).text).toBe("About the same");
    expect(describeChange("CLS", side(9, 0) as never, side(9, 0) as never).text).toBe("About the same");
  });

  it("gives no verdict on few measurements or no data", () => {
    expect(describeChange("LCP", side(4, 1000) as never, side(9, 9000) as never).text).toBe("Too few measurements");
    expect(describeChange("LCP", side(9, 1000) as never, side(4, 9000) as never).text).toBe("Too few measurements");
    expect(describeChange("LCP", side(0, null, null) as never, side(9, 1) as never).text).toBe("No data");
  });

  it("handles a baseline of zero", () => {
    expect(describeChange("CLS", side(9, 0) as never, side(9, 0.2) as never)).toEqual({ text: "Worse, +0.20", tone: "change-worse" });
  });
});

describe("releases", () => {
  it("compares the latest two by default", async () => {
    await show("/?tab=releases");
    expect(requested()).toContain("/api/compare?env=production&range=30d&a=v1&b=v2");
    expect(select("Baseline").value).toBe("v1");
    expect(select("Compare with").value).toBe("v2");
    expect(rowOf("LCP p75").textContent).toContain("Slower");
    expect(rowOf("INP p75").textContent).toContain("Faster");
    expect(rowOf("CLS p75").textContent).toContain("About the same");
    expect(rowOf("FCP p75").textContent).toContain("Too few measurements");
    expect(rowOf("FCP p75").textContent).toContain("2 measured");
    expect(rowOf("TTFB p75").textContent).toContain("No data");
    expect(rowOf("Page views").textContent).toContain("20");
  });

  it("marks errors that appeared or went away, and links to them", async () => {
    await show("/?tab=releases");
    expect(rowOf("fresh").textContent).toContain("New in v2");
    expect(rowOf("gone").textContent).toContain("Not seen in v2");
    expect(link("Error: fresh").getAttribute("href")).toContain(`error=${ID}`);
    expect(text()).toContain("…and 4 more errors");
  });

  it("puts the chosen releases in the address, encoded", async () => {
    responses["/api/releases"] = ["v2", "v1", "a&b=c"];
    await show("/?tab=releases");
    await choose(select("Baseline"), "a&b=c");
    expect(parseView(location.search).a).toBe("a&b=c");
    expect(requested().at(-1)).toBe("/api/compare?env=production&range=30d&a=a%26b%3Dc&b=v2");
  });

  it("opens from a shared address", async () => {
    await show("/?tab=releases&a=v0&b=v1");
    expect(requested()).toContain("/api/compare?env=production&range=30d&a=v0&b=v1");
  });

  it("asks for two different releases", async () => {
    await show("/?tab=releases&a=v1&b=v1");
    expect(text()).toContain("Choose two different releases.");
    expect(requested().some((url) => url.startsWith("/api/compare"))).toBe(false);
  });

  it("teaches how to set a release", async () => {
    responses["/api/releases"] = [];
    await show("/?tab=releases");
    expect(text()).toContain("No releases yet");
    expect(text()).toContain('init({ release: "9f2c1ab" });');
  });

  it("says when there is only one", async () => {
    responses["/api/releases"] = ["v1"];
    await show("/?tab=releases");
    expect(text()).toContain("Only one release so far: v1");
  });

  it("says when neither has errors", async () => {
    responses["/api/compare"] = { ...COMPARISON, errors: [], moreErrors: 0 };
    await show("/?tab=releases");
    expect(text()).toContain("Neither release has errors.");
  });

  it("explains a failure", async () => {
    delete responses["/api/compare"];
    await show("/?tab=releases");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
