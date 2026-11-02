import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = import.meta.dirname;

/** Her senaryo kendi klasöründe bir `index.html`; hepsi çok sayfalı build'e girer. */
function pages(dir = root, prefix = ""): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    if (name === "index.html") entries[prefix || "main"] = path;
    else if (statSync(path).isDirectory() && !["node_modules", "dist", "src", "public", "e2e", "test-results", "playwright-report"].includes(name)) {
      Object.assign(entries, pages(path, prefix ? `${prefix}/${name}` : name));
    }
  }
  return entries;
}

export default defineConfig({
  build: { rolldownOptions: { input: pages() } },
});
