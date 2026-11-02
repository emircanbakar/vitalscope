import { defineConfig, devices } from "@playwright/test";

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: ci,
  reporter: ci ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://localhost:4173" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Yeni headless modu gerçek Chrome'a daha yakın; Playwright'ın varsayılan bayrağı bfcache'i kapatır.
        channel: "chromium",
        launchOptions: { ignoreDefaultArgs: ["--disable-back-forward-cache"] },
      },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    // Testler geliştirme sunucusunda değil, build edilmiş sitede çalışır.
    { command: "pnpm build && pnpm preview", url: "http://localhost:4173", reuseExistingServer: !ci },
    { command: "node e2e/ingest-server.ts", url: "http://127.0.0.1:4174/health", reuseExistingServer: !ci },
  ],
});
