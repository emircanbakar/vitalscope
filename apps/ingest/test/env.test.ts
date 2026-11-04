import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/env.js";

const valid = {
  PORT: "8787",
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  CLICKHOUSE_URL: "http://localhost:8123",
  CLICKHOUSE_WRITE_USER: "ingest",
  CLICKHOUSE_WRITE_PASSWORD: "gizli-deger",
};

describe("parseEnv", () => {
  it("accepts valid values", () => {
    expect(parseEnv(valid)).toMatchObject({ PORT: 8787, CLICKHOUSE_WRITE_USER: "ingest" });
  });

  it("does not fall back to a default port", () => {
    expect(() => parseEnv({ ...valid, PORT: undefined })).toThrow("PORT");
  });

  it("names every bad variable but never its value", () => {
    const parse = () => parseEnv({ ...valid, DATABASE_URL: "gizli-deger", CLICKHOUSE_WRITE_PASSWORD: "" });
    expect(parse).toThrow("DATABASE_URL, CLICKHOUSE_WRITE_PASSWORD");
    expect(parse).not.toThrow("gizli-deger");
  });
});
