import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

describe("package.json", () => {
  it("has no install lifecycle scripts", () => {
    for (const script of ["preinstall", "install", "postinstall"]) {
      expect(pkg.scripts?.[script]).toBeUndefined();
    }
  });

  it("depends only on the server and the protocol; the panel is built in", () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@hono/node-server", "@vitalscope/protocol", "hono"]);
  });
});

// Yayınlanan paketin dosya listesi (doküman 9.6): beklenmeyen bir dosya pakete girerse test kırılır.
// Panel dosyalarının adındaki içerik hash'i `[hash]` olarak karşılaştırılır.
describe("npm pack", () => {
  it("contains only the expected files", () => {
    const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8", shell: true }));
    const files = (pack.files as { path: string }[]).map((f) => f.path.replace(/-[\w-]{8}\.(css|js)$/, "-[hash].$1")).sort();
    const modules = ["app", "buffer", "cli", "commands", "fingerprint", "live", "node-version", "origin", "panel", "queries", "report", "rows", "server", "sqlite", "start", "types"];
    const panel = ["dist/panel/assets/index-[hash].css", "dist/panel/assets/index-[hash].js", "dist/panel/index.html"];
    const changelog = existsSync(new URL("CHANGELOG.md", root)) ? ["CHANGELOG.md"] : [];
    expect(files).toEqual(
      [...changelog, "LICENSE", "README.md", "SECURITY.md", ...modules.flatMap((m) => [`dist/${m}.js`, `dist/${m}.js.map`]), ...panel, "package.json"].sort(),
    );
    // `npm` süreci paralel işler arasında birkaç saniye sürebilir.
  }, 30_000);

  it("starts the binary with a Node shebang", () => {
    expect(readFileSync(new URL("dist/cli.js", root), "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  });
});
