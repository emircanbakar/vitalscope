import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

const define = { __SDK_VERSION__: JSON.stringify(version) };

export default defineConfig([
  {
    // Ortak kod ayrı bir parçaya bölünür: tüm giriş noktaları aynı SDK durumunu paylaşır.
    entry: ["src/index.ts", "src/attribution.ts", "src/react.ts", "src/next.ts"],
    format: ["esm"],
    dts: true,
    define,
    deps: {
      // Protokol sabitleri pakete gömülür; sadece React alt export'ları peer dependency'leri import eder.
      // Çekirdeğin hiçbir şey import etmediğini test/package.test.ts doğrular.
      onlyImport: ["react", "next"],
    },
  },
  {
    // Script etiketi için tek dosya: `dist/vitalscope.iife.js`, küçültülmüş; CDN'de SRI ile kullanılır.
    entry: { vitalscope: "src/iife.ts" },
    format: ["iife"],
    minify: true,
    clean: false,
    define,
  },
]);
