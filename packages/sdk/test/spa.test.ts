import { afterEach, describe, expect, it, vi } from "vitest";
import { watchRoutes } from "../src/spa.js";

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

describe("history fallback", () => {
  it("reports pushState, replaceState and popstate after the URL changes", () => {
    const seen: string[] = [];
    stop = watchRoutes(() => seen.push(location.pathname));
    history.pushState(null, "", "/a");
    history.replaceState(null, "", "/b");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(seen).toEqual(["/a", "/b", "/b"]);
  });

  it("keeps the original behaviour: this, arguments, return value and errors", () => {
    const original = vi.fn(function (this: unknown) {
      return this;
    });
    history.pushState = original as unknown as History["pushState"];
    const onChange = vi.fn();
    stop = watchRoutes(onChange);

    expect(history.pushState({ id: 1 }, "", "/x")).toBe(history);
    expect(original).toHaveBeenCalledWith({ id: 1 }, "", "/x");

    original.mockImplementationOnce(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => history.pushState(null, "", "/y")).toThrow("blocked");
    expect(onChange).toHaveBeenCalledOnce();
    stop();
    stop = undefined;
    expect(history.pushState).toBe(original);
    delete (history as Partial<History>).pushState;
  });

  it("restores the original functions on stop", () => {
    const { pushState, replaceState } = History.prototype;
    stop = watchRoutes(() => {});
    expect(history.pushState).not.toBe(pushState);
    stop();
    stop = undefined;
    expect(history.pushState).toBe(pushState);
    expect(history.replaceState).toBe(replaceState);
  });

  it("does not undo a wrapper added after its own", () => {
    stop = watchRoutes(() => {});
    const later = vi.fn();
    history.pushState = later;
    stop();
    stop = undefined;
    expect(history.pushState).toBe(later);
    delete (history as Partial<History>).pushState;
  });
});

describe("Navigation API", () => {
  it("listens to currententrychange and leaves history untouched", () => {
    const navigation = new EventTarget();
    vi.stubGlobal("navigation", navigation);
    const { pushState } = History.prototype;
    const onChange = vi.fn();
    stop = watchRoutes(onChange);

    expect(history.pushState).toBe(pushState);
    navigation.dispatchEvent(new Event("currententrychange"));
    expect(onChange).toHaveBeenCalledOnce();

    stop();
    stop = undefined;
    navigation.dispatchEvent(new Event("currententrychange"));
    expect(onChange).toHaveBeenCalledOnce();
  });
});
