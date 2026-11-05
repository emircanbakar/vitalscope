import { describe, expect, it } from "vitest";
import { PUBLIC_KEY_PATTERN } from "@vitalscope/protocol";
import { isLocalPage, resolveConfig } from "../src/config.js";

const key = "pk_3f9a0c1d2e4b5a6978c0d1e2";
const endpoint = "https://ingest.vitalscope.dev/v1/e";

describe("resolveConfig", () => {
  it("accepts a minimal valid config and applies defaults", () => {
    expect(resolveConfig({ key, endpoint })).toEqual({
      key,
      endpoint,
      release: undefined,
      environment: "production",
      sampleRate: 1,
      captureErrors: true,
      trackSpa: true,
      ignoreErrors: [],
      keepQuery: [],
      respectDoNotTrack: false,
      debug: false,
    });
  });

  it.each([[undefined], [{}]])("needs no configuration for the local collector (%j)", (input) => {
    const resolved = resolveConfig(input);
    expect(resolved?.endpoint).toBe("http://localhost:8787/v1/e");
    expect(resolved?.key).toMatch(PUBLIC_KEY_PATTERN);
  });

  it("keeps the local key when only the port changes", () => {
    expect(resolveConfig({ endpoint: "http://localhost:9000/v1/e" })).toMatchObject({ endpoint: "http://localhost:9000/v1/e", key: expect.stringMatching(PUBLIC_KEY_PATTERN) });
  });

  it.each([
    ["null config", null],
    ["a non-object config", "pk_3f9a0c1d2e4b5a6978c0d1e2"],
    ["malformed key", { key: "pk_ABC", endpoint }],
    ["secret key", { key: "sk_3f9a0c1d2e4b5a6978c0d1e2", endpoint }],
    ["plain http endpoint", { key, endpoint: "http://ingest.vitalscope.dev/v1/e" }],
    ["non-http endpoint", { key, endpoint: "javascript:alert(1)" }],
    ["unparseable endpoint", { key, endpoint: "not a url" }],
    ["unknown environment", { key, endpoint, environment: "staging" }],
    ["too long release", { key, endpoint, release: "x".repeat(65) }],
    ["sample rate above 1", { key, endpoint, sampleRate: 1.5 }],
    ["negative sample rate", { key, endpoint, sampleRate: -0.1 }],
    ["NaN sample rate", { key, endpoint, sampleRate: Number.NaN }],
    ["non-list ignoreErrors", { key, endpoint, ignoreErrors: "ResizeObserver" }],
    ["ignoreErrors with a number", { key, endpoint, ignoreErrors: [1] }],
    ["keepQuery with a RegExp", { key, endpoint, keepQuery: [/utm/] }],
  ])("rejects %s", (_, input) => {
    expect(resolveConfig(input)).toBeNull();
  });

  it.each(["http://localhost:8787/v1/e", "http://127.0.0.1/v1/e", "http://[::1]:8787/v1/e"])(
    "allows plain http on %s",
    (url) => {
      expect(resolveConfig({ key, endpoint: url })).not.toBeNull();
    },
  );

  it("ignores unknown and prototype keys", () => {
    const input = JSON.parse(`{"key":"${key}","endpoint":"${endpoint}","__proto__":{"debug":true},"extra":1}`);
    const resolved = resolveConfig(input);
    expect(resolved?.debug).toBe(false);
    expect(resolved).not.toHaveProperty("extra");
    expect(({} as Record<string, unknown>).debug).toBeUndefined();
  });
});

describe("isLocalPage", () => {
  it.each(["localhost", "127.0.0.1", "[::1]", "app.localhost"])("is true on %s", (hostname) => {
    expect(isLocalPage(hostname)).toBe(true);
  });

  it.each(["ecbakar.com", "localhost.evil.io", "evillocalhost", "127.0.0.1.evil.io", "192.168.1.10", "my-app.test", ""])("is false on %j", (hostname) => {
    expect(isLocalPage(hostname)).toBe(false);
  });
});
