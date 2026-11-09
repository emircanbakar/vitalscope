import { describe, expect, it } from "vitest";
import { apiQuery, parseView, viewUrl } from "../src/filters.js";

describe("parseView", () => {
  it("reads every filter", () => {
    expect(parseView("?metric=LCP&env=development&page=%2Fa&device=mobile&range=7d")).toEqual({ metric: "LCP", env: "development", page: "/a", device: "mobile", range: "7d" });
  });

  it("defaults to the last 30 days", () => {
    expect(parseView("")).toEqual({ range: "30d" });
  });

  it("keeps all time in the address", () => {
    expect(parseView(viewUrl({ range: "all" }))).toEqual({ range: "all" });
  });

  it.each(["?metric=NOPE", "?env=staging", "?range=1y", "?range=__proto__", "?metric=__proto__", "?page=", "?device="])("ignores %s", (search) => {
    expect(parseView(search)).toEqual({ range: "30d" });
  });
});

describe("viewUrl", () => {
  it("round-trips, including characters that need encoding", () => {
    const view = { metric: "INP", env: "production", page: `/a b?c=1&d="<>`, device: "mobile", range: "24h" } as const;
    expect(parseView(viewUrl(view))).toEqual(view);
  });

  it("leaves defaults out of the address", () => {
    expect(viewUrl({ range: "30d" })).toBe(location.pathname);
    expect(viewUrl({ range: "all" })).toBe("?range=all");
  });
});

describe("apiQuery", () => {
  it("always names the environment", () => {
    expect(apiQuery({ range: "all" }, "production")).toBe("env=production");
    expect(apiQuery({ range: "7d", page: "/a", device: "mobile" }, "development")).toBe("env=development&page=%2Fa&device=mobile&range=7d");
  });
});
