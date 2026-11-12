import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LIMITS } from "../src/constants.js";
import { Batch } from "../src/schema.js";

const fixturesDir = fileURLToPath(new URL("../fixtures/v1", import.meta.url));

function loadFixtures(kind: "valid" | "invalid"): [string, unknown][] {
  const dir = path.join(fixturesDir, kind);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))]);
}

function fixture(kind: "valid" | "invalid", name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, kind, `${name}.json`), "utf8"));
}

describe("v1 fixtures", () => {
  it.each(loadFixtures("valid"))("accepts valid/%s", (_, body) => {
    const result = Batch.safeParse(body);
    expect(result.error).toBeUndefined();
  });

  it.each(loadFixtures("invalid"))("rejects invalid/%s", (_, body) => {
    expect(Batch.safeParse(body).success).toBe(false);
  });
});

describe("Batch", () => {
  it("strips unknown fields instead of rejecting them", () => {
    const parsed = Batch.parse(fixture("valid", "unknown-fields-are-stripped"));
    expect(parsed).not.toHaveProperty("future");
    expect(parsed.ctx).not.toHaveProperty("locale");
    expect(parsed.e[0]).not.toHaveProperty("extra");
  });

  it("applies context defaults", () => {
    const parsed = Batch.parse(fixture("valid", "minimal"));
    expect(parsed.ctx.env).toBe("production");
    expect(parsed.ctx.sr).toBe(1);
  });

  it("caps events per batch", () => {
    const body = fixture("valid", "minimal");
    const pageview = { t: "pageview", ts: 1792044000123 };
    expect(Batch.safeParse({ ...body, e: Array(LIMITS.maxEventsPerBatch).fill(pageview) }).success).toBe(true);
    expect(Batch.safeParse({ ...body, e: Array(LIMITS.maxEventsPerBatch + 1).fill(pageview) }).success).toBe(false);
  });

  it("caps error message and stack size", () => {
    const body = fixture("valid", "minimal");
    const error = (msg: string, stack: string[]) => ({ ...body, e: [{ t: "error", ts: 1792044000123, type: "Error", msg, stack, handled: true }] });
    const max = "x".repeat(LIMITS.maxErrorMessageLength);
    expect(Batch.safeParse(error(max, [])).success).toBe(true);
    expect(Batch.safeParse(error(max + "x", [])).success).toBe(false);
    expect(Batch.safeParse(error("x", Array(LIMITS.maxStackFrames + 1).fill("at f (a.js:1:1)"))).success).toBe(false);
  });

  it("caps attribution selector length", () => {
    const body = fixture("valid", "doc-example");
    const vital = (target: string) => ({
      ...body,
      e: [{ t: "vital", ts: 1792044001877, name: "LCP", value: 1, rating: "good", id: "x", attr: { target } }],
    });
    expect(Batch.safeParse(vital("a".repeat(LIMITS.maxSelectorLength))).success).toBe(true);
    expect(Batch.safeParse(vital("a".repeat(LIMITS.maxSelectorLength + 1))).success).toBe(false);
  });

  it("accepts an INP's event name and slowest interaction", () => {
    const body = fixture("valid", "doc-example");
    const inp = (attr: object) => ({ ...body, e: [{ t: "vital", ts: 1792044001877, name: "INP", value: 120, rating: "good", id: "x", attr }] });
    const slowest = { duration: 500, target: "div#canvas", type: "keyboard", event: "keydown", inputDelay: 1, processing: 30, presentation: 469 };
    const parsed = Batch.parse(inp({ event: "click", slowest }));
    expect(parsed.e[0]).toMatchObject({ attr: { event: "click", slowest } });

    // Olay adı sadece küçük harf; tuş ya da metin taşıyamaz.
    expect(Batch.safeParse(inp({ event: "keydown Enter" })).success).toBe(false);
    expect(Batch.safeParse(inp({ event: "a".repeat(LIMITS.maxEventNameLength + 1) })).success).toBe(false);
    // En yavaş etkileşimin süresi zorunlu; LCP alanları orada atılır.
    expect(Batch.safeParse(inp({ slowest: { event: "keydown" } })).success).toBe(false);
    const [stripped] = Batch.parse(inp({ slowest: { duration: 500, url: "https://a.test/" } })).e;
    expect(stripped).toMatchObject({ attr: { slowest: { duration: 500 } } });
    expect(stripped?.t === "vital" && stripped.attr?.slowest).not.toHaveProperty("url");
  });
});
