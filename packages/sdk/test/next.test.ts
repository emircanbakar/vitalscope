import { Batch } from "@vitalscope/protocol/schema";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toRouteTemplate } from "../src/next.js";

const navigation = vi.hoisted(() => ({
  pathname: "/" as string | null,
  params: {} as Record<string, string | string[]>,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useParams: () => navigation.params,
}));

describe("toRouteTemplate", () => {
  it.each([
    ["/urun/42", { id: "42" }, "/urun/[id]"],
    ["/blog/2026/merhaba", { year: "2026", slug: "merhaba" }, "/blog/[year]/[slug]"],
    ["/docs/a/b/c", { path: ["a", "b", "c"] }, "/docs/[...path]"],
    ["/docs", { path: [] }, "/docs"],
    ["/ara/kahve%20makinesi", { q: "kahve makinesi" }, "/ara/[q]"],
    ["/1/urun/1", { id: "1" }, "/1/urun/[id]"],
    ["/hakkimizda", {}, "/hakkimizda"],
    ["/", null, "/"],
  ])("%s with %j → %s", (pathname, params, expected) => {
    expect(toRouteTemplate(pathname, params)).toBe(expected);
  });
});

describe("Next.js VitalscopeProvider", () => {
  const config = { key: "pk_3f9a0c1d2e4b5a6978c0d1e2", endpoint: "https://ingest.test/v1/e" };
  let sdk: typeof import("../src/index.js");
  let entry: typeof import("../src/next.js");
  let root: Root;
  let beacon: ReturnType<typeof vi.fn<(url: string, body: string) => boolean>>;

  function navigate(pathname: string, params: Record<string, string | string[]>) {
    history.pushState(null, "", pathname);
    navigation.pathname = pathname;
    navigation.params = params;
    act(() => root.render(createElement(entry.VitalscopeProvider, { config }, "app")));
  }

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.resetModules();
    beacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    window.history.replaceState(null, "", "/");
    sdk = await import("../src/index.js");
    entry = await import("../src/next.js");
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
    sdk.disable();
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  });

  it("derives the route template from the pathname and params", () => {
    navigate("/", {});
    navigate("/urun/42", { id: "42" });
    sdk.flush();
    const contexts = beacon.mock.calls.map(([, body]) => Batch.parse(JSON.parse(body)).ctx);
    expect(contexts.map((c) => [c.path, c.route])).toEqual([
      ["/", "/"],
      ["/urun/42", "/urun/[id]"],
    ]);
  });
});
