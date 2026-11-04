import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIMITS } from "@vitalscope/protocol";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createEventBuffer } from "../src/buffer.js";
import type { Project, ResolveKey } from "../src/types.js";
import { fakeSink } from "./helpers.js";

const KEY = "pk_3f9a0c1d2e4b5a6978c0d1e2";
const ORIGIN = "https://site.test";
const project: Project = { id: "p1", allowedOrigins: ["site.test"] };

const batch = {
  v: 1,
  k: KEY,
  sdk: "0.1.1",
  ctx: { sid: "0123456789abcdef", path: "/", device: "desktop" },
  e: [{ t: "pageview", ts: 1730000000000 }, { t: "custom", ts: 1730000000001, name: "x" }],
};

function setup(resolveKey: ResolveKey = async () => project, isReady?: () => Promise<boolean>) {
  const fake = fakeSink();
  const buffer = createEventBuffer(fake.sink, { flushAt: 1_000_000 });
  const app = createApp({ resolveKey, buffer, now: () => 42, ...(isReady ? { isReady } : {}) });
  const post = (body: string, headers: Record<string, string> = {}) =>
    app.request("/v1/e", { method: "POST", body, headers: { "Content-Type": "text/plain;charset=UTF-8", Origin: ORIGIN, ...headers } });
  return { app, buffer, fake, post };
}

async function expectEmpty(res: Response, status: number) {
  expect(res.status).toBe(status);
  expect(await res.text()).toBe("");
}

describe("POST /v1/e", () => {
  it("accepts a batch with an empty 202 and buffers one row per event", async () => {
    const { buffer, fake, post } = setup();
    const res = await post(JSON.stringify(batch));
    await expectEmpty(res, 202);
    await buffer.flush();
    expect(fake.written()).toEqual([
      expect.objectContaining({ projectId: "p1", receivedAt: 42, sdk: "0.1.1", event: batch.e[0] }),
      expect.objectContaining({ projectId: "p1", receivedAt: 42, sdk: "0.1.1", event: batch.e[1] }),
    ]);
    // Şemanın varsayılanları uygulanmış olur.
    expect(fake.written()[0]?.ctx).toMatchObject({ env: "production", sr: 1 });
  });

  it("reflects only an allowed Origin and never allows credentials", async () => {
    const { post } = setup();
    const res = await post(JSON.stringify(batch));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(res.headers.get("Vary")).toBe("Origin");
    const rejected = await post(JSON.stringify(batch), { Origin: "https://other.test" });
    expect(rejected.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("accepts application/json", async () => {
    const { post } = setup();
    expect((await post(JSON.stringify(batch), { "Content-Type": "application/json" })).status).toBe(202);
  });

  it("rejects other content types with 415", async () => {
    const { post } = setup();
    await expectEmpty(await post(JSON.stringify(batch), { "Content-Type": "application/x-www-form-urlencoded" }), 415);
  });

  it("rejects a body over the limit with 413, by header or by actual size", async () => {
    const { app, post } = setup();
    const large = "x".repeat(LIMITS.maxBodyBytes + 1);
    await expectEmpty(await post(large), 413);
    const stream = new Blob([large]).stream();
    const res = await app.request("/v1/e", {
      method: "POST",
      body: stream,
      duplex: "half",
      headers: { "Content-Type": "text/plain", Origin: ORIGIN },
    } as RequestInit);
    await expectEmpty(res, 413);
  });

  it.each([
    ["broken JSON", "{"],
    ["null", "null"],
    ["a string version", JSON.stringify({ ...batch, v: "1" })],
    ["no version", JSON.stringify({ ...batch, v: undefined })],
  ])("rejects %s with 400", async (_, body) => {
    const { post } = setup();
    await expectEmpty(await post(body), 400);
  });

  it("rejects an unsupported protocol version with 422 before looking up the key", async () => {
    const resolveKey = vi.fn(async () => project);
    const { post } = setup(resolveKey);
    await expectEmpty(await post(JSON.stringify({ ...batch, v: 2 })), 422);
    expect(resolveKey).not.toHaveBeenCalled();
  });

  it("rejects an unknown key with 401", async () => {
    const { buffer, post } = setup(async () => null);
    await expectEmpty(await post(JSON.stringify(batch)), 401);
    expect(buffer.stats().size).toBe(0);
  });

  it.each([
    ["a foreign Origin", { Origin: "https://other.test" }],
    ["a null Origin", { Origin: "null" }],
  ])("rejects %s with 403", async (_, headers) => {
    const { buffer, post } = setup();
    await expectEmpty(await post(JSON.stringify(batch), headers), 403);
    expect(buffer.stats().size).toBe(0);
  });

  it("rejects a missing Origin with 403", async () => {
    const { app, buffer } = setup();
    const res = await app.request("/v1/e", { method: "POST", body: JSON.stringify(batch), headers: { "Content-Type": "text/plain" } });
    await expectEmpty(res, 403);
    expect(buffer.stats().size).toBe(0);
  });

  it("answers 503 without details when the key source fails", async () => {
    const { post } = setup(async () => {
      throw new Error("postgres://secret@db");
    });
    await expectEmpty(await post(JSON.stringify(batch)), 503);
  });

  it("still answers 202 when the buffer is full; the drop is counted", async () => {
    const fake = fakeSink();
    const buffer = createEventBuffer(fake.sink, { maxSize: 1, flushAt: 100 });
    const app = createApp({ resolveKey: async () => project, buffer });
    const res = await app.request("/v1/e", { method: "POST", body: JSON.stringify(batch), headers: { "Content-Type": "text/plain", Origin: ORIGIN } });
    expect(res.status).toBe(202);
    expect(buffer.stats()).toEqual({ size: 1, dropped: 1 });
  });
});

describe("protocol fixtures", () => {
  const dir = fileURLToPath(new URL("../../../packages/protocol/fixtures/v1", import.meta.url));
  const load = (kind: string): [string, string][] =>
    fs
      .readdirSync(path.join(dir, kind))
      .filter((f) => f.endsWith(".json"))
      .map((f) => [f, fs.readFileSync(path.join(dir, kind, f), "utf8")]);

  it.each(load("valid"))("accepts valid/%s", async (_, body) => {
    expect((await setup().post(body)).status).toBe(202);
  });

  it.each(load("invalid"))("rejects invalid/%s", async (name, body) => {
    const { buffer, post } = setup();
    expect((await post(body)).status).toBe(name === "unsupported-version.json" ? 422 : 400);
    expect(buffer.stats().size).toBe(0);
  });
});

describe("OPTIONS /v1/e", () => {
  it("allows only POST and Content-Type, cached for 24 hours, without credentials", async () => {
    const { app } = setup();
    const res = await app.request("/v1/e", { method: "OPTIONS", headers: { Origin: ORIGIN } });
    await expectEmpty(res, 204);
    expect(Object.fromEntries(res.headers)).toMatchObject({
      "access-control-allow-origin": ORIGIN,
      "access-control-allow-methods": "POST",
      "access-control-allow-headers": "Content-Type",
      "access-control-max-age": "86400",
    });
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});

describe("other routes", () => {
  it("/healthz answers without checking dependencies", async () => {
    const isReady = vi.fn(async () => false);
    await expectEmpty(await setup(undefined, isReady).app.request("/healthz"), 204);
    expect(isReady).not.toHaveBeenCalled();
  });

  it.each([
    ["ready", async () => true, 204],
    ["not ready", async () => false, 503],
    ["failing", async () => Promise.reject(new Error("down")), 503],
  ])("/readyz when %s", async (_, isReady, status) => {
    await expectEmpty(await setup(undefined, isReady).app.request("/readyz"), status);
  });

  it("answers unknown routes with an empty 404 and sets nosniff everywhere", async () => {
    const { app, post } = setup();
    const missing = await app.request("/nope");
    await expectEmpty(missing, 404);
    expect(missing.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect((await post(JSON.stringify(batch))).headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("answers an unexpected failure with an empty 500", async () => {
    const buffer = createEventBuffer(fakeSink().sink);
    vi.spyOn(buffer, "add").mockImplementation(() => {
      throw new Error("boom");
    });
    const app = createApp({ resolveKey: async () => project, buffer });
    const res = await app.request("/v1/e", { method: "POST", body: JSON.stringify(batch), headers: { "Content-Type": "text/plain", Origin: ORIGIN } });
    await expectEmpty(res, 500);
  });
});
