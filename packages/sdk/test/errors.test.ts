import type { ErrorEvent as VitalscopeError } from "@vitalscope/protocol";
import { describe, expect, it, vi } from "vitest";
import { createErrorCollector, type IgnorePattern, type RawError } from "../src/errors.js";

function collect(raws: RawError[], ignore: IgnorePattern[] = []) {
  const reported: VitalscopeError[] = [];
  const schedule = vi.fn();
  const collector = createErrorCollector((e) => reported.push(e), ignore, schedule);
  for (const raw of raws) collector.capture(raw);
  collector.drain();
  return { reported, schedule };
}

const chromeError = (message: string, frames = ["at render (https://ecbakar.com/app.js:1:200)"]) => {
  const error = new TypeError(message);
  error.stack = [`TypeError: ${message}`, ...frames.map((f) => `    ${f}`)].join("\n");
  return error;
};

describe("error events", () => {
  it("captures type, message and stack frames without the message line", () => {
    const { reported } = collect([{ error: chromeError("x is undefined"), handled: false }]);
    expect(reported).toEqual([
      {
        t: "error",
        ts: expect.any(Number),
        type: "TypeError",
        msg: "x is undefined",
        stack: ["at render (https://ecbakar.com/app.js:1:200)"],
        handled: false,
      },
    ]);
  });

  it("keeps Firefox/Safari style stacks as they are", () => {
    const error = new Error("boom");
    error.stack = "render@https://ecbakar.com/app.js:1:200\n@https://ecbakar.com/app.js:2:10";
    const { reported } = collect([{ error, handled: true }]);
    expect(reported[0]?.stack).toEqual(["render@https://ecbakar.com/app.js:1:200", "@https://ecbakar.com/app.js:2:10"]);
  });

  it("handles promise rejections with non-Error values", () => {
    const { reported } = collect([{ error: "payment failed", handled: false }]);
    expect(reported[0]).toMatchObject({ type: "UnhandledRejection", msg: "payment failed", stack: [] });
  });

  it("survives values that cannot be converted to a string", () => {
    const { reported } = collect([
      { error: Object.create(null), handled: false },
      { error: { message: Object.create(null) }, handled: false },
      { error: new Error("still reported"), handled: false },
    ]);
    expect(reported.map((e) => e.msg)).toEqual(["", "", "still reported"]);
  });

  it("falls back to the ErrorEvent location when there is no error object", () => {
    const { reported } = collect([
      { error: null, handled: false, message: "Uncaught boom", source: "https://ecbakar.com/a.js", line: 3, column: 7 },
    ]);
    expect(reported[0]).toMatchObject({ msg: "Uncaught boom", stack: ["https://ecbakar.com/a.js:3:7"] });
  });

  it("redacts personal data and enforces protocol limits", () => {
    const frames = Array.from({ length: 40 }, (_, i) => `at f${i} (https://ecbakar.com/app.js?token=abc${i}:1:1)`);
    const { reported } = collect([{ error: chromeError(`user a@b.com ${"x".repeat(900)}`, frames), handled: false }]);
    const [event] = reported;
    expect(event?.msg.startsWith("user [redacted] ")).toBe(true);
    expect(event?.msg.length).toBe(500);
    expect(event?.stack).toHaveLength(30);
    expect(event?.stack.join("\n")).not.toMatch(/token=abc/);
  });
});

describe("noise filters", () => {
  it.each([
    ["browser extensions", { error: chromeError("ext", ["at x (chrome-extension://abc/content.js:1:1)"]), handled: false }],
    ["Firefox extensions", { error: null, handled: false, message: "ext", source: "moz-extension://abc/c.js" }],
    ["opaque cross-origin errors", { error: null, handled: false, message: "Script error." }],
  ])("drops %s", (_, raw) => {
    expect(collect([raw as RawError]).reported).toEqual([]);
  });

  it("drops errors matching ignoreErrors strings and patterns", () => {
    const { reported } = collect(
      [
        { error: new Error("ResizeObserver loop limit exceeded"), handled: false },
        { error: new Error("Network request failed 503"), handled: false },
        { error: new Error("kept"), handled: false },
      ],
      ["ResizeObserver", /failed \d{3}/],
    );
    expect(reported.map((e) => e.msg)).toEqual(["kept"]);
  });
});

describe("storm protection", () => {
  it("sends the same error at most 5 times per page", () => {
    const raws = Array.from({ length: 100 }, () => ({ error: chromeError("same"), handled: false }));
    expect(collect(raws).reported).toHaveLength(5);
  });

  it("sends at most 50 errors per page", () => {
    const raws = Array.from({ length: 80 }, (_, i) => ({ error: chromeError(`err ${i}`), handled: false }));
    expect(collect(raws).reported).toHaveLength(50);
  });
});

describe("deferred processing", () => {
  it("schedules processing once and processes on drain", () => {
    const reported: VitalscopeError[] = [];
    const schedule = vi.fn();
    const collector = createErrorCollector((e) => reported.push(e), [], schedule);
    collector.capture({ error: new Error("a"), handled: true });
    collector.capture({ error: new Error("b"), handled: true });
    expect(schedule).toHaveBeenCalledOnce();
    expect(reported).toEqual([]);
    schedule.mock.calls[0]![0]();
    expect(reported.map((e) => e.msg)).toEqual(["a", "b"]);
  });
});
