// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

  it("leaves NODE_ENV for the site's bundler to replace", () => {
    const code = readdirSync(dist)
      .filter((f) => f.endsWith(".mjs"))
      .map((f) => readFileSync(new URL(f, dist), "utf8"))
      .join("");
    expect(code).toContain("process.env.NODE_ENV");
  });

  it("react and next entries import only their peers and are client components", () => {
    expect(importsOf("react.mjs")).toEqual(["react"]);
    expect(importsOf("next.mjs").sort()).toEqual(["next/navigation", "react"]);
    for (const file of ["react.mjs", "next.mjs"]) {
      expect(readFileSync(new URL(file, dist), "utf8").startsWith('"use client";')).toBe(true);
    }
  });
});

// Yayınlanan paketin dosya listesi (doküman 9.6): beklenmeyen bir dosya pakete girerse test kırılır.
// Ortak parçaların adındaki içerik hash'i `[hash]` olarak karşılaştırılır.
describe("npm pack", () => {
  it("contains only the expected files", () => {
    const root = new URL("..", import.meta.url);
    const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8", shell: true }));
    const files = (pack.files as { path: string }[]).map((f) => f.path.replace(/-[\w-]{8}\.(d\.mts|mjs)$/, "-[hash].$1")).sort();
    const entries = ["attribution", "index", "next", "react"].flatMap((e) => [`dist/${e}.d.mts`, `dist/${e}.mjs`]);
    const changelog = existsSync(new URL("CHANGELOG.md", root)) ? ["CHANGELOG.md"] : [];
    expect(files).toEqual(
      [...changelog, "LICENSE", "README.md", "SECURITY.md", ...entries, "dist/index-[hash].d.mts", "dist/src-[hash].mjs", "dist/vitalscope.iife.js", "package.json"].sort(),
    );
  });
});
