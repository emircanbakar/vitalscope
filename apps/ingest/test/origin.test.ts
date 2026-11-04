import { describe, expect, it } from "vitest";
import { isAllowedOrigin } from "../src/origin.js";

describe("isAllowedOrigin", () => {
  it.each([
    ["https://ecbakar.com", ["ecbakar.com"]],
    ["http://localhost:3000", ["localhost"]],
    ["https://ECBAKAR.com", ["ecbakar.COM"]],
    ["https://app.ecbakar.com", ["*.ecbakar.com"]],
    ["https://a.b.ecbakar.com", ["*.ecbakar.com"]],
    ["https://x.com", ["ecbakar.com", "x.com"]],
  ])("allows %s for %j", (origin, allowed) => {
    expect(isAllowedOrigin(origin, allowed)).toBe(true);
  });

  it.each([
    ["https://ecbakar.com", ["*.ecbakar.com"]],
    ["https://evilecbakar.com", ["*.ecbakar.com"]],
    ["https://ecbakar.com.evil.io", ["ecbakar.com"]],
    ["https://app.ecbakar.com", ["ecbakar.com"]],
    ["https://ecbakar.com", []],
    ["null", ["ecbakar.com"]],
    ["not a url", ["ecbakar.com"]],
    ["", ["ecbakar.com"]],
    [undefined, ["ecbakar.com"]],
  ])("rejects %s for %j", (origin, allowed) => {
    expect(isAllowedOrigin(origin, allowed)).toBe(false);
  });
});
