import { defineConfig } from "vitest/config";

// Bu paketin tek testi gerçek veritabanı ister: `docker compose -f infra/docker-compose.dev.yml up -d --wait`.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
