import { describe, expect, it } from "vitest";
import { linear, maxOf, minOf, nearestIndex, niceTicks, timeTicks } from "../src/scale.js";

describe("linear", () => {
  it("maps a domain onto a range, in either direction", () => {
    expect(linear([0, 10], [0, 100])(5)).toBe(50);
    expect(linear([0, 10], [100, 0])(2)).toBe(80);
  });

  it("puts a single value in the middle", () => {
    expect(linear([7, 7], [0, 100])(7)).toBe(50);
  });
});

describe("niceTicks", () => {
  it("starts at zero, uses round steps and covers the maximum", () => {
    expect(niceTicks(2300)).toEqual([0, 1000, 2000, 3000]);
    expect(niceTicks(90)).toEqual([0, 50, 100]);
    expect(niceTicks(1000)).toEqual([0, 500, 1000]);
  });

  it("keeps fractions free of floating point noise", () => {
    expect(niceTicks(0.27)).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it("gives a usable axis when every value is zero", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});

describe("timeTicks", () => {
  const start = new Date(2026, 10, 5, 12, 3, 20).getTime();

  it("aligns to round local times inside the range", () => {
    const { ticks } = timeTicks(start, start + 60 * 60_000);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    for (const tick of ticks) {
      expect(tick).toBeGreaterThanOrEqual(start);
      expect(tick).toBeLessThanOrEqual(start + 60 * 60_000);
      expect(new Date(tick).getSeconds()).toBe(0);
      expect(new Date(tick).getMinutes() % 15).toBe(0);
    }
  });

  it("shows seconds, hours or dates depending on the span", () => {
    const seconds = timeTicks(start, start + 20_000);
    const days = timeTicks(start, start + 10 * 86_400_000);
    expect(seconds.format(seconds.ticks[0]!)).toMatch(/\d+.\d+.\d+/);
    expect(days.format(days.ticks[0]!)).not.toMatch(/:/);
  });

  it("always has a tick for a single point", () => {
    expect(timeTicks(start, start).ticks).toEqual([start]);
  });
});

describe("nearestIndex", () => {
  it("finds the closest value", () => {
    const sorted = [0, 10, 20, 100];
    expect(nearestIndex(sorted, -5)).toBe(0);
    expect(nearestIndex(sorted, 12)).toBe(1);
    expect(nearestIndex(sorted, 16)).toBe(2);
    expect(nearestIndex(sorted, 500)).toBe(3);
  });

  it("works with a single value", () => {
    expect(nearestIndex([5], 9)).toBe(0);
  });
});

describe("maxOf and minOf", () => {
  it("handle more values than a spread call can take", () => {
    const values = Array.from({ length: 300_000 }, (_, i) => i);
    expect(maxOf(values)).toBe(299_999);
    expect(minOf(values)).toBe(0);
  });
});
