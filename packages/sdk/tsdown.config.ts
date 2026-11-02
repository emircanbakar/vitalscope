import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  define: { __SDK_VERSION__: JSON.stringify(version) },
  deps: {
    // Çıktı hiçbir paketi runtime'da import edemez; protokol sabitleri pakete gömülür.
    onlyImport: [],
  },
});
