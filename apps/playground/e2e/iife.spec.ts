import { expect, test } from "@playwright/test";
import { captureIngest, hide } from "./helpers.js";

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
