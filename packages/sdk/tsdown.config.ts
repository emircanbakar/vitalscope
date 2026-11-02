import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  // Ortak kod ayrı bir parçaya bölünür: üç giriş noktası da aynı SDK durumunu paylaşır.
  entry: ["src/index.ts", "src/react.ts", "src/next.ts"],
  format: ["esm"],
  dts: true,
  define: { __SDK_VERSION__: JSON.stringify(version) },
  deps: {
    // Protokol sabitleri pakete gömülür; sadece React alt export'ları peer dependency'leri import eder.
    // Çekirdeğin hiçbir şey import etmediğini test/package.test.ts doğrular.
    onlyImport: ["react", "next"],
  },
});
