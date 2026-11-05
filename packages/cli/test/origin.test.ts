import { describe, expect, it } from "vitest";
import { isAllowedOrigin, isLocalHost } from "../src/origin.js";

describe("isAllowedOrigin", () => {
  it.each(["http://localhost:3000", "https://localhost", "http://LOCALHOST:5173", "http://127.0.0.1:4173", "http://[::1]:3000", "http://app.localhost:3000"])(
    "allows %s",
    (origin) => {
      expect(isAllowedOrigin(origin)).toBe(true);
    },
  );

  it.each([
    "https://ecbakar.com",
    "http://localhost.evil.io",
    "http://evillocalhost",
    "http://127.0.0.1.evil.io",
    "http://127.0.0.2",
    "http://192.168.1.10:3000",
    "chrome-extension://abc",
    "file:///index.html",
    "null",
    "not a url",
    "",
    undefined,
  ])("rejects %s", (origin) => {
    expect(isAllowedOrigin(origin)).toBe(false);
  });
});

describe("isLocalHost", () => {
  it.each(["localhost", "localhost:8787", "127.0.0.1:8787", "[::1]:8787", "LOCALHOST:8787"])("allows %s", (host) => {
    expect(isLocalHost(host)).toBe(true);
  });

  it.each(["evil.io", "evil.io:8787", "localhost.evil.io", "evil.io@localhost", "127.0.0.1.evil.io:8787", "app.localhost:8787", "192.168.1.10:8787", "", undefined])(
    "rejects %s",
    (host) => {
      expect(isLocalHost(host)).toBe(false);
    },
  );
});
