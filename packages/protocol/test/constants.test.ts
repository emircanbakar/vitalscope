import { describe, expect, it } from "vitest";
import { getRating, METRIC_NAMES, THRESHOLDS } from "../src/index.js";

describe("THRESHOLDS", () => {
  it("defines good < poor for every metric", () => {
    for (const name of METRIC_NAMES) {
      expect(THRESHOLDS[name].good).toBeLessThan(THRESHOLDS[name].poor);
    }
  });
});

describe("getRating", () => {
  it.each([
    ["LCP", 2500, "good"],
    ["LCP", 2501, "needs-improvement"],
    ["LCP", 4000, "needs-improvement"],
    ["LCP", 4001, "poor"],
    ["INP", 200, "good"],
    ["INP", 501, "poor"],
    ["CLS", 0.1, "good"],
    ["CLS", 0.25, "needs-improvement"],
    ["CLS", 0.26, "poor"],
    ["FCP", 0, "good"],
    ["TTFB", 1801, "poor"],
  ] as const)("%s %d → %s", (name, value, expected) => {
    expect(getRating(name, value)).toBe(expected);
  });
});
