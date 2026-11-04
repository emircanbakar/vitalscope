import { describe, expect, it, vi } from "vitest";
import { cacheKeys } from "../src/key-cache.js";
import type { Project } from "../src/types.js";

const project: Project = { id: "p1", allowedOrigins: ["a.com"] };

describe("cacheKeys", () => {
  it("serves repeated lookups from the cache until the TTL ends", async () => {
    let time = 0;
    const source = vi.fn(async () => project);
    const resolve = cacheKeys(source, { ttlMs: 60_000, now: () => time });
    await resolve("k");
    time = 59_999;
    await expect(resolve("k")).resolves.toBe(project);
    expect(source).toHaveBeenCalledTimes(1);
    time = 60_000;
    await resolve("k");
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("caches unknown keys too", async () => {
    const source = vi.fn(async () => null);
    const resolve = cacheKeys(source);
    await expect(resolve("nope")).resolves.toBeNull();
    await expect(resolve("nope")).resolves.toBeNull();
    expect(source).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures", async () => {
    const source = vi.fn<() => Promise<Project | null>>().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(project);
    const resolve = cacheKeys(source);
    await expect(resolve("k")).rejects.toThrow("db down");
    await expect(resolve("k")).resolves.toBe(project);
  });

  it("evicts the oldest entry at the limit", async () => {
    const source = vi.fn(async () => null);
    const resolve = cacheKeys(source, { maxEntries: 2 });
    await resolve("a");
    await resolve("b");
    await resolve("c");
    await resolve("b");
    expect(source).toHaveBeenCalledTimes(3);
    await resolve("a");
    expect(source).toHaveBeenCalledTimes(4);
  });
});
