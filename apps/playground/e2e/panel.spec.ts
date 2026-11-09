import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Gerçek toplayıcı ve panel (`vitalscope dev`), gerçek SDK'lı sayfa. Her test boş bir veri klasörüyle, worker'ın portunda.
const CLI = resolve(import.meta.dirname, "../../../packages/cli/dist/cli.js");
const SITE = "http://localhost:4173";
const HOSTILE = `<img src=x onerror="window.__xss=1">`;
const SCRIPT = "<script>window.__xss=1</script>";

let collector: ChildProcess;
let dir: string;
let panel: string;

test.beforeEach(async () => {
  const port = 4180 + test.info().parallelIndex;
  dir = mkdtempSync(join(tmpdir(), "vitalscope-panel-"));
  collector = spawn(process.execPath, [CLI, "dev", "--port", String(port), "--dir", dir], { stdio: ["ignore", "pipe", "inherit"] });
  await once(collector.stdout!, "data");
  panel = `http://localhost:${port}`;
});

test.afterEach(async () => {
  const exited = once(collector, "exit");
  collector.kill();
  await exited;
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** Toplayıcıya site sayfasından gönderir: tarayıcı `Origin`'i kendisi koyar, toplayıcı yerel siteleri kabul eder. */
async function send(page: Page, release: string, path: string, message: string) {
  const ts = Date.now();
  const batch = {
    v: 1,
    k: "pk_3f9a0c1d2e4b5a6978c0d1e2",
    sdk: "0.1.1",
    ctx: { sid: Math.random().toString(16).slice(2, 18).padEnd(16, "0"), path, release, env: "development", device: "desktop" },
    e: [
      { t: "pageview", ts },
      ...["LCP", "FCP", "TTFB"].map((name, i) => ({ t: "vital", ts, name, value: 900 + i * 300, rating: "good", id: `v4-${ts}-${name}` })),
      { t: "error", ts, type: "TypeError", msg: message, handled: false, stack: [`at ${HOSTILE} (${SITE}/${SCRIPT}.js:1:1)`] },
    ],
  };
  await page.goto(SITE);
  const status = await page.evaluate(
    async ({ url, body }) => (await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body })).status,
    { url: `${panel}/v1/e`, body: JSON.stringify(batch) },
  );
  expect(status).toBe(202);
}

/** Toplayıcı tamponu en geç 1 sn'de yazar; panel canlı görünümle kendiliğinden dolar. */
async function openPanel(page: Page, search = "") {
  await page.goto(`${panel}/${search}`);
  await expect(page.getByRole("status")).toHaveText("Live");
}

test("fills in by itself with what the SDK sends", async ({ page, context }) => {
  await openPanel(page);
  await expect(page.getByRole("heading", { name: "No measurements yet" })).toBeVisible();

  const app = await context.newPage();
  await app.addInitScript((endpoint) => {
    (globalThis as { __vitalscopeEndpoint?: string }).__vitalscopeEndpoint = endpoint;
  }, `${panel}/v1/e`);
  await app.goto(`${SITE}/throws/`);
  await app.waitForTimeout(500);
  // Sayfadan çıkış SDK'nın kuyruğunu gönderir.
  await app.goto("about:blank");

  await expect(page.getByRole("rowheader", { name: "/throws/" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Errors", exact: true }).click();
  await expect(page.getByText("Error: sync boom")).toBeVisible();
});

test("shows text from the browser as text, never as markup", async ({ page }) => {
  let dialogs = 0;
  page.on("dialog", (dialog) => {
    dialogs++;
    void dialog.dismiss();
  });
  await send(page, "1.0.0", "/safe", "first");
  await send(page, HOSTILE, `/${HOSTILE}`, `${SCRIPT}${HOSTILE}`);

  const views = ["", `?page=${encodeURIComponent(`/${HOSTILE}`)}`, "?tab=errors", `?tab=releases&a=1.0.0&b=${encodeURIComponent(HOSTILE)}`];
  for (const search of views) {
    await openPanel(page, search);
    // Seçenek listeleri gizli `<option>` olarak da içerir; görünen bir kopyası aranır.
    await expect(page.getByText(HOSTILE).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
    expect(await page.locator("img, script:not([src])").count()).toBe(0);
  }
  await page.getByRole("link", { name: "Errors", exact: true }).click();
  await page.getByRole("link", { name: `TypeError: ${SCRIPT}${HOSTILE}` }).click();
  await expect(page.getByRole("heading", { name: `TypeError: ${SCRIPT}${HOSTILE}` })).toBeVisible();
  await expect(page.locator("pre.stack")).toContainText(`at ${HOSTILE}`);
  expect(await page.locator("img, script:not([src])").count()).toBe(0);

  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
  expect(dialogs).toBe(0);
});

test.describe("accessibility", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`every view passes axe, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const check = async (label: string) => {
        const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        expect(violations.flatMap(({ id, nodes }) => nodes.map((node) => `${label}: ${id} at ${node.target.join(" ")}: ${node.failureSummary}`))).toEqual([]);
      };

      await openPanel(page);
      await expect(page.getByRole("heading", { name: "No measurements yet" })).toBeVisible();
      await check("empty");
      await send(page, "1.0.0", "/", "first");
      await send(page, "1.1.0", "/", "second");

      await openPanel(page);
      await expect(page.locator(".card-value").first()).toBeVisible({ timeout: 15_000 });
      await check("overview");
      await openPanel(page, "?metric=LCP");
      await expect(page.locator(".detail-value")).toBeVisible();
      await check("metric");
      await openPanel(page, "?tab=errors");
      await page.getByRole("link", { name: "TypeError: second" }).click();
      await expect(page.getByRole("heading", { name: "Latest stack" })).toBeVisible();
      await check("error");
      await page.getByRole("link", { name: "Errors", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Errors" })).toBeVisible();
      await check("errors");
      await openPanel(page, "?tab=releases");
      await expect(page.getByRole("heading", { name: "Metrics" })).toBeVisible();
      await check("releases");
    });
  }
});
