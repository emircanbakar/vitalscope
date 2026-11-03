import { defineConfig, devices } from "@playwright/test";

const ci = Boolean(process.env.CI);
const PERF = "perf.spec.ts";

const chromium = {
  ...devices["Desktop Chrome"],
  // Yeni headless modu gerçek Chrome'a daha yakın; Playwright'ın varsayılan bayrağı bfcache'i kapatır.
  channel: "chromium",
  launchOptions: { ignoreDefaultArgs: ["--disable-back-forward-cache"] },
};

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: ci,
  reporter: ci ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://localhost:4173" },
  projects: [
    { name: "chromium", use: chromium, testIgnore: PERF },
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, testIgnore: PERF },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, testIgnore: PERF },
    // Performans ölçümleri ayrı komutla (`test:perf`) tek başına çalışır; paralel yük sonuçları bozar.
    { name: "perf", use: chromium, testMatch: PERF },
  ],
  webServer: [
    // Testler geliştirme sunucusunda değil, build edilmiş sitede çalışır.
    { command: "pnpm build && pnpm preview", url: "http://localhost:4173", reuseExistingServer: !ci },
    { command: "node e2e/ingest-server.ts", url: "http://127.0.0.1:4174/health", reuseExistingServer: !ci },
  ],
});
