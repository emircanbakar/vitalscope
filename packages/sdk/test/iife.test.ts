// @vitest-environment node
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

// Build çıktısı test edilir: CDN'den yüklenen dosya tam olarak budur.
const code = readFileSync(new URL("../dist/vitalscope.iife.js", import.meta.url), "utf8");

const KEY = "pk_3f9a0c1d2e4b5a6978c0d1e2";
const ENDPOINT = "https://ingest.test/v1/e";

/** Sayfaya IIFE'yi verilen data özellikleriyle bir script etiketi olarak ekler. */
function load(attributes: Record<string, string> = {}, times = 1) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "dangerously", url: "https://site.test/" });
  const { window } = dom;
  const beacon = vi.fn(() => true);
  Object.defineProperty(window.navigator, "sendBeacon", { value: beacon });
  const errors: string[] = [];
  window.addEventListener("error", (event) => errors.push(event.message));
  const before = new Set(Object.keys(window));
  for (let i = 0; i < times; i++) {
    const script = window.document.createElement("script");
    for (const [name, value] of Object.entries(attributes)) script.dataset[name] = value;
    script.textContent = code;
    window.document.body.append(script);
  }
  const added = Object.keys(window).filter((name) => !before.has(name));
  const sdk = (window as unknown as { vitalscope: Record<string, (...args: unknown[]) => unknown> }).vitalscope;
  return { window, beacon, added, sdk, errors };
}

describe("vitalscope.iife.js", () => {
  it("defines only a frozen window.vitalscope", () => {
    const { added, sdk } = load();
    expect(added).toEqual(["vitalscope"]);
    expect(Object.isFrozen(sdk)).toBe(true);
    expect(Object.keys(sdk).sort()).toEqual(["captureError", "disable", "flush", "init", "setRoute", "track"]);
  });

  it("starts from the script tag's data attributes", () => {
    const { beacon, sdk } = load({ key: KEY, endpoint: ENDPOINT, release: "9f2c1ab", environment: "preview" });
    sdk.flush?.();
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, body] = beacon.mock.calls[0] as unknown as [string, string];
    expect(url).toBe(ENDPOINT);
    expect(JSON.parse(body)).toMatchObject({ k: KEY, ctx: { release: "9f2c1ab", env: "preview" }, e: [{ t: "pageview" }] });
  });

  it("waits for init() without data-key", () => {
    const { beacon, sdk } = load();
    sdk.flush?.();
    expect(beacon).not.toHaveBeenCalled();
    sdk.init?.({ key: KEY, endpoint: ENDPOINT });
    sdk.flush?.();
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("keeps the first copy when loaded twice", () => {
    const { window, sdk, errors } = load({}, 2);
    expect(errors).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(window, "vitalscope")).toMatchObject({ writable: false, configurable: false });
    expect(Object.isFrozen(sdk)).toBe(true);
  });
});
