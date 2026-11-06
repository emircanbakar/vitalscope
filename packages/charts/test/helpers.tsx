import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
export let container: HTMLElement;
export const resizeCallbacks: ResizeObserverCallback[] = [];

beforeEach(() => {
  container = document.body.appendChild(document.createElement("div"));
  resizeCallbacks.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({ addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

export function render(node: ReactNode) {
  act(() => {
    root ??= createRoot(container);
    root.render(node);
  });
}

export const query = (selector: string) => container.querySelector(selector);
export const queryAll = (selector: string) => [...container.querySelectorAll(selector)];
export const texts = (selector: string) => queryAll(selector).map((element) => element.textContent);

export function key(element: Element, name: string) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });
}

export function focus(element: HTMLElement) {
  act(() => element.focus());
}

export function blur(element: HTMLElement) {
  act(() => element.blur());
}

export function openTable() {
  const details = query("details") as HTMLDetailsElement;
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
}

export function resize(width: number) {
  act(() => {
    for (const callback of resizeCallbacks) callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
  });
}
