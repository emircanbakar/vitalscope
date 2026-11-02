// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// SDK'yı kuran her site bu paketin bağımlılıklarını da çalıştırır: runtime bağımlılığı olmamalı.
describe("package.json", () => {
  it.each(["dependencies", "optionalDependencies", "bundleDependencies", "bundledDependencies"])(
    "has no %s",
    (field) => {
      expect(pkg[field] ?? {}).toEqual({});
    },
  );

  it("has no install lifecycle scripts", () => {
    for (const script of ["preinstall", "install", "postinstall"]) {
      expect(pkg.scripts?.[script]).toBeUndefined();
    }
  });

  it("keeps React and Next optional peers, so non-React sites install nothing", () => {
    expect(Object.keys(pkg.peerDependencies)).toEqual(["next", "react"]);
    expect(pkg.peerDependenciesMeta).toEqual({ next: { optional: true }, react: { optional: true } });
  });
});

const dist = new URL("../dist/", import.meta.url);
const importsOf = (file: string) =>
  [...readFileSync(new URL(file, dist), "utf8").matchAll(/(?:import|from)\s*["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((spec) => !spec?.startsWith("./"));

// Build sonrası çıktı: çekirdek hiçbir paket import etmez, React sadece alt export'larda yer alır.
describe("dist", () => {
  it.each(readdirSync(dist).filter((f) => f.endsWith(".mjs") && !["react.mjs", "next.mjs"].includes(f)))(
    "%s imports no packages",
    (file) => {
      expect(importsOf(file)).toEqual([]);
    },
  );

  it("react and next entries import only their peers and are client components", () => {
    expect(importsOf("react.mjs")).toEqual(["react"]);
    expect(importsOf("next.mjs").sort()).toEqual(["next/navigation", "react"]);
    for (const file of ["react.mjs", "next.mjs"]) {
      expect(readFileSync(new URL(file, dist), "utf8").startsWith('"use client";')).toBe(true);
    }
  });
});
