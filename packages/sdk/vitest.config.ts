import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __SDK_VERSION__: JSON.stringify("0.0.0-test") },
  test: {
    environment: "jsdom",
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // Build çıktısı üzerinden test edilir (test/iife.test.ts, e2e); kaynak üzerinden ölçülemez.
      exclude: ["src/iife.ts"],
      // Taşıma veriyi dışarı gönderen tek katman: her satırı testli olmalı.
      thresholds: { lines: 95, "src/transport.ts": { lines: 100 } },
    },
  },
});
