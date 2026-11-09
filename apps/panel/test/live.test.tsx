import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app.js";
import { FakeEventSource, stubLive } from "./live-stubs.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const last = () => FakeEventSource.instances.at(-1)!;
const open = () => FakeEventSource.instances.filter((source) => !source.closed);

const empty = { good: 0, needsImprovement: 0, poor: 0 };
const overview = (p75: number) => ({
  metrics: [{ name: "LCP", count: 1, p75, rating: "good", counts: { ...empty, good: 1 } }],
  pages: [{ page: "/", views: 1, p75: { LCP: p75 } }],
  morePages: 0,
});

let root: Root;
let container: HTMLElement;
let responses: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(10_000_000);
  stubLive();
  responses = { "/api/options": { environments: ["production"], pages: ["/"], devices: ["desktop"] }, "/api/overview": overview(100) };
  fetchMock = vi.fn(async (url: string) => {
    const path = url.split("?")[0]!;
    const body = responses[path];
    return body === undefined ? new Response(null, { status: 500 }) : new Response(JSON.stringify(body));
  });
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function show() {
  await act(async () => root.render(<App />));
  await flush();
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await flush();
}

const status = () => container.querySelector(".live")?.textContent;
const value = () => container.querySelector(".card-value")?.textContent;
const overviewCalls = () => fetchMock.mock.calls.filter(([url]) => (url as string).startsWith("/api/overview")).length;

describe("live view", () => {
  it("connects to the stream and shows the state in words", async () => {
    await show();
    expect(last().url).toBe("/api/live");
    expect(status()).toBe("Connecting…");
    last().emit("open");
    expect(status()).toBe("Live");
    last().emit("error");
    expect(status()).toBe("Not connected, retrying…");
    last().emit("open");
    expect(status()).toBe("Live");
  });

  it("shows new data when it changes, without dimming the page", async () => {
    await show();
    last().emit("open");
    await advance(2000);
    expect(value()).toBe("100 ms");

    const before = overviewCalls();
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    last().emit("change");
    await flush();
    expect(overviewCalls()).toBe(before + 1);
    expect(value()).toBe("100 ms");
    expect(container.querySelector(".stale")).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("refreshes every view that is on screen", async () => {
    await show();
    responses["/api/overview"] = overview(200);
    last().emit("change");
    await flush();
    expect(value()).toBe("200 ms");
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/options")).toHaveLength(2);
  });

  it("leaves the empty state as soon as data arrives", async () => {
    responses["/api/options"] = { environments: [], pages: [], devices: [] };
    await show();
    expect(container.textContent).toContain("No measurements yet");
    expect(container.textContent).toContain("as soon as they arrive");
    responses["/api/options"] = { environments: ["production"], pages: ["/"], devices: ["desktop"] };
    last().emit("change");
    await flush();
    expect(value()).toBe("100 ms");
  });

  it("refreshes at most once per two seconds, and never misses the last change", async () => {
    await show();
    const before = overviewCalls();
    last().emit("change");
    await flush();
    expect(overviewCalls()).toBe(before + 1);

    responses["/api/overview"] = overview(300);
    last().emit("change");
    last().emit("change");
    last().emit("change");
    await flush();
    expect(overviewCalls()).toBe(before + 1);

    await advance(1999);
    expect(overviewCalls()).toBe(before + 1);
    await advance(1);
    expect(overviewCalls()).toBe(before + 2);
    expect(value()).toBe("300 ms");
  });

  it("keeps the data on screen when a refresh fails, and recovers", async () => {
    await show();
    delete responses["/api/overview"];
    last().emit("change");
    await flush();
    expect(value()).toBe("100 ms");
    expect(container.querySelector('[role="alert"]')).toBeNull();

    responses["/api/overview"] = overview(400);
    await advance(2000);
    last().emit("change");
    await flush();
    expect(value()).toBe("400 ms");
  });

  it("recovers from an error on screen once the collector is back", async () => {
    delete responses["/api/overview"];
    await show();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    responses["/api/overview"] = overview(500);
    last().emit("change");
    await flush();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(value()).toBe("500 ms");
  });

  it("catches up after losing the connection", async () => {
    await show();
    last().emit("open");
    await advance(2000);
    last().emit("error");
    responses["/api/overview"] = overview(600);
    last().emit("open");
    await flush();
    expect(value()).toBe("600 ms");
  });

  describe("several tabs", () => {
    const tabs: { root: Root; element: HTMLElement }[] = [];

    async function openTab() {
      const element = document.body.appendChild(document.createElement("div"));
      const tab = { root: createRoot(element), element };
      tabs.push(tab);
      await act(async () => tab.root.render(<App />));
      await flush();
      return tab;
    }

    afterEach(() => {
      for (const { root: tabRoot, element } of tabs.splice(0)) {
        act(() => tabRoot.unmount());
        element.remove();
      }
    });

    it("holds one connection however many tabs are open", async () => {
      await show();
      for (let i = 0; i < 7; i++) await openTab();
      expect(open()).toHaveLength(1);
    });

    it("passes changes to the other tabs", async () => {
      await show();
      const tab = await openTab();
      responses["/api/overview"] = overview(700);
      last().emit("change");
      await flush();
      expect(tab.element.querySelector(".card-value")?.textContent).toBe("700 ms");
    });

    it("tells other tabs the state, including a tab opened later", async () => {
      await show();
      const early = await openTab();
      last().emit("open");
      expect(early.element.querySelector(".live")?.textContent).toBe("Live");
      const late = await openTab();
      expect(late.element.querySelector(".live")?.textContent).toBe("Live");
      last().emit("error");
      expect(late.element.querySelector(".live")?.textContent).toBe("Not connected, retrying…");
    });

    it("hands the connection over when the holding tab closes, and catches up", async () => {
      const first = await openTab();
      const second = await openTab();
      const third = await openTab();
      expect(open()).toHaveLength(1);
      const held = last();

      act(() => first.root.unmount());
      tabs.splice(tabs.indexOf(first), 1);
      first.element.remove();
      await flush();
      expect(held.closed).toBe(true);
      expect(open()).toHaveLength(1);
      expect(last()).not.toBe(held);

      responses["/api/overview"] = overview(800);
      last().emit("open");
      await flush();
      expect(second.element.querySelector(".card-value")?.textContent).toBe("800 ms");
      expect(third.element.querySelector(".card-value")?.textContent).toBe("800 ms");
    });

    it("leaves the queue when a waiting tab closes", async () => {
      await show();
      const waiting = await openTab();
      act(() => waiting.root.unmount());
      tabs.splice(tabs.indexOf(waiting), 1);
      waiting.element.remove();
      await flush();
      expect(open()).toHaveLength(1);
    });
  });

  it("closes the connection on unmount", async () => {
    await show();
    const source = last();
    act(() => root.render(null));
    expect(source.closed).toBe(true);
  });
});
