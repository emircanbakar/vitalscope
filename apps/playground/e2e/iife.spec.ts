import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { captureIngest, hide } from "./helpers.js";

// Yanlışlıkla canlıya çıkan SDK: gerçek bir alan adında, geçerli bir adres ve anahtar verilse de veri göndermemeli.
test("collects nothing on a real domain", async ({ page }) => {
  const ingest = await captureIngest(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.route("http://production.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><h1>canlı</h1><script src="/vitalscope.iife.js" data-key="pk_3f9a0c1d2e4b5a6978c0d1e2" data-endpoint="http://127.0.0.1:4174/v1/e/${ingest.run}"></script>`,
    }),
  );
  await page.route("http://production.test/vitalscope.iife.js", (route) =>
    route.fulfill({ path: fileURLToPath(new URL("../dist/iife/vitalscope.iife.js", import.meta.url)), contentType: "text/javascript" }),
  );

  await page.goto("http://production.test/");
  // Betik çalıştı (kontrol): SDK yüklenmeseydi test de boşuna geçerdi.
  expect(await page.evaluate(() => Object.isFrozen((window as { vitalscope?: object }).vitalscope))).toBe(true);
  await page.evaluate(() => (window as unknown as { vitalscope: { track(name: string): void; flush(): void } }).vitalscope.track("sizinti"));
  await hide(page);
  await page.waitForTimeout(500);

  expect(await ingest.bodies()).toEqual([]);
  expect(requests.filter((url) => url.includes("/v1/e"))).toEqual([]);
});

// CDN kurulumu: ayrı dosya, `integrity` (SRI) ve `crossorigin` ile; ayar etiketin data özelliklerinden okunur.
test("the script tag build runs with a matching integrity hash", async ({ page }) => {
  const ingest = await captureIngest(page);
  await page.goto("/iife/");
  await expect(page.locator("body[data-sdk]")).toHaveAttribute("data-sdk", "loaded");
  expect(await page.evaluate(() => Object.isFrozen((window as { vitalscope?: object }).vitalscope))).toBe(true);
  await hide(page);
  await expect.poll(async () => (await ingest.events()).some((e) => e.t === "pageview")).toBe(true);
  expect((await ingest.batches())[0]?.ctx.env).toBe("development");
});

test("a modified script is blocked by its integrity hash", async ({ page }) => {
  const ingest = await captureIngest(page);
  await page.goto("/iife/?tamper");
  await expect(page.locator("body[data-sdk]")).toHaveAttribute("data-sdk", "blocked");
  expect(await page.evaluate(() => "vitalscope" in window)).toBe(false);
  await hide(page);
  await page.waitForTimeout(500);
  expect(await ingest.bodies()).toEqual([]);
});
