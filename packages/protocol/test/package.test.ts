import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url);

// Yayınlanan paketin dosya listesi (doküman 9.6): beklenmeyen bir dosya pakete girerse test kırılır.
describe("npm pack", () => {
  it("contains only the expected files", () => {
    const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8", shell: true }));
    const files = (pack.files as { path: string }[]).map((f) => f.path).sort();
    const modules = ["constants", "index", "privacy", "schema"].flatMap((m) => [`dist/${m}.d.ts`, `dist/${m}.js`, `dist/${m}.js.map`]);
    const changelog = existsSync(new URL("CHANGELOG.md", root)) ? ["CHANGELOG.md"] : [];
    expect(files).toEqual([...changelog, "LICENSE", "README.md", ...modules, "package.json"].sort());
  });
});
