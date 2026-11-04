import { defineConfig } from "vitest/config";

// Gerçek veritabanı ister: `docker compose -f infra/docker-compose.dev.yml up -d --wait`.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
