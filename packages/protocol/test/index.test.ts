import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../src/index.js";

describe("protocol", () => {
  it("exposes the current protocol version", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
