import { Batch } from "@vitalscope/protocol/schema";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Sdk = typeof import("../src/index.js");
type ReactEntry = typeof import("../src/react.js");

const config = { key: "pk_3f9a0c1d2e4b5a6978c0d1e2", endpoint: "https://ingest.test/v1/e" };

let sdk: Sdk;
let entry: ReactEntry;
let root: Root;
let beacon: ReturnType<typeof vi.fn<(url: string, body: string) => boolean>>;

const sentContexts = () =>
  beacon.mock.calls.map(([, body]) => {
    const { ctx } = Batch.parse(JSON.parse(body));
    return { path: ctx.path, route: ctx.route };
  });

function render(props: { route?: string; text?: string }) {
  act(() => {
    root.render(createElement(entry.VitalscopeProvider, { config, route: props.route }, props.text ?? "app"));
  });
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetModules();
  beacon = vi.fn(() => true);
  vi.stubGlobal("navigator", { sendBeacon: beacon });
  window.history.replaceState(null, "", "/");
  sdk = await import("../src/index.js");
  entry = await import("../src/react.js");
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  sdk.disable();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

describe("VitalscopeProvider", () => {
  it("renders its children and initialises the SDK once", () => {
    const container = document.createElement("div");
    root = createRoot(container);
    render({ text: "hello" });
    render({ text: "again" });
    expect(container.textContent).toBe("again");
    sdk.flush();
    expect(beacon).toHaveBeenCalledOnce();
  });

  it("reports the route template and re-sends it after a route change with the same template", () => {
    render({ route: "/urun/[id]" });
    history.pushState(null, "", "/urun/1");
    render({ route: "/urun/[id]" });
    history.pushState(null, "", "/urun/2");
    render({ route: "/urun/[id]" });
    sdk.flush();
    expect(sentContexts()).toEqual([
      { path: "/", route: "/urun/[id]" },
      { path: "/urun/1", route: "/urun/[id]" },
      { path: "/urun/2", route: "/urun/[id]" },
    ]);
  });

  it("works without a route", () => {
    render({});
    sdk.flush();
    expect(sentContexts()).toEqual([{ path: "/", route: undefined }]);
  });
});
