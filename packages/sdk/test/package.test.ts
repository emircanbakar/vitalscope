// @vitest-environment node
import { readFileSync } from "node:fs";
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
});
