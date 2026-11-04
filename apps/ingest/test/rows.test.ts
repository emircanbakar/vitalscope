import { describe, expect, it } from "vitest";
import { toRows } from "../src/rows.js";
import type { StoredEvent } from "../src/types.js";

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0, 123);
const stored = (event: StoredEvent["event"]): StoredEvent => ({
  projectId: "p1",
  receivedAt: NOW,
  sdk: "0.1.1",
  ctx: { sid: "0123456789abcdef", path: "/a", route: "/[id]", env: "production", device: "mobile", conn: "4g", nav: "reload", sr: 0.5 },
  event,
});

describe("toRows", () => {
  it("copies the context to every row and writes UTC times", () => {
    const { pageviews } = toRows([stored({ t: "pageview", ts: NOW })]);
    expect(pageviews).toEqual([
      expect.objectContaining({
        project_id: "p1",
        ts: "2026-11-04 12:00:00.123",
        received_at: "2026-11-04 12:00:00.123",
        sample_rate: 0.5,
        sdk: "0.1.1",
        path: "/a",
        route: "/[id]",
        env: "production",
        device: "mobile",
        conn: "4g",
        nav_type: "reload",
        session_id: "0123456789abcdef",
      }),
    ]);
  });

  it("uses the pageview's own path after an SPA navigation", () => {
    expect(toRows([stored({ t: "pageview", ts: NOW, path: "/b" })]).pageviews[0]?.path).toBe("/b");
  });

  it("sends each event type to its table", () => {
    const rows = toRows([
      stored({ t: "pageview", ts: NOW }),
      stored({ t: "vital", ts: NOW, name: "LCP", value: 1, rating: "good", id: "m1" }),
      stored({ t: "error", ts: NOW, type: "TypeError", msg: "x", stack: ["a"], handled: false }),
      stored({ t: "custom", ts: NOW, name: "signup", value: 2 }),
    ]);
    expect(Object.fromEntries(Object.entries(rows).map(([table, values]) => [table, values.length]))).toEqual({
      vitals: 1,
      errors: 1,
      pageviews: 1,
      custom_events: 1,
    });
    expect(rows.errors[0]).toMatchObject({ type: "TypeError", message: "x", stack: ["a"], handled: false });
    expect(rows.custom_events[0]).toMatchObject({ name: "signup", value: 2 });
  });

  it("splits attribution into text columns and a timing map", () => {
    const { vitals } = toRows([
      stored({
        t: "vital",
        ts: NOW,
        name: "INP",
        value: 200,
        rating: "needs-improvement",
        id: "m1",
        attr: { target: "button", type: "pointer", script: "https://x.test/a.js", url: "https://x.test/i.png", inputDelay: 1, processing: 0, presentation: 3 },
      }),
    ]);
    expect(vitals[0]).toMatchObject({
      metric_id: "m1",
      attr_target: "button",
      attr_type: "pointer",
      attr_script: "https://x.test/a.js",
      attr_url: "https://x.test/i.png",
      attr: { inputDelay: 1, processing: 0, presentation: 3 },
    });
  });

  it.each([
    ["far in the past", 1],
    ["older than seven days", NOW - 8 * 24 * 60 * 60 * 1000],
    ["more than an hour ahead", NOW + 2 * 60 * 60 * 1000],
    ["beyond what a date can hold", Number.MAX_SAFE_INTEGER],
  ])("falls back to the server time when ts is %s", (_, ts) => {
    expect(toRows([stored({ t: "pageview", ts })]).pageviews[0]?.ts).toBe("2026-11-04 12:00:00.123");
  });

  it("keeps a plausible client time", () => {
    const ts = NOW - 60_000;
    expect(toRows([stored({ t: "pageview", ts })]).pageviews[0]?.ts).toBe("2026-11-04 11:59:00.123");
  });
});
