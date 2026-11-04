import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // Temizleme kişisel veriyi koruyan tek katman: her satırı testli olmalı.
      thresholds: { "src/privacy.ts": { lines: 100 } },
    },
  },
});
