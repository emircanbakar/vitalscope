import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/env.js";

describe("parseEnv", () => {
  it("accepts valid values", () => {
    expect(parseEnv({ PORT: "9000", VITALSCOPE_DIR: "olcumler" })).toEqual({ PORT: 9000, VITALSCOPE_DIR: "olcumler" });
  });

  it("needs no configuration", () => {
    expect(parseEnv({})).toEqual({ PORT: 8787, VITALSCOPE_DIR: ".vitalscope" });
  });

  it("names every bad variable but never its value", () => {
    const parse = () => parseEnv({ PORT: "gizli-deger", VITALSCOPE_DIR: "" });
    expect(parse).toThrow("PORT, VITALSCOPE_DIR");
    expect(parse).not.toThrow("gizli-deger");
  });
});
