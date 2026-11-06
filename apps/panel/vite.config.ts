import { defineConfig } from "vitest/config";

export default defineConfig({
  server: { proxy: { "/api": "http://localhost:8787" } },
  test: {
    environment: "jsdom",
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/main.tsx"],
      thresholds: { lines: 90 },
    },
  },
});
