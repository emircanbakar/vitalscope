import { expect, test } from "@playwright/test";
import { captureIngest, hide, nextFrame } from "./helpers.js";

/** SDK ile web-vitals arasında izin verilen fark; diğer metrikler birebir aynı olmalı. */
const TOLERANCE: Record<string, number> = { CLS: 0.001, INP: 8 };

// Aynı sayfada iki ölçüm yan yana çalışır. Tarayıcının desteklemediği metriği ikisi de raporlamaz.
test("metrics match the web-vitals reference library", async ({ page }) => {
  const ingest = await captureIngest(page);
  await page.goto("/reference/");
  await expect(page.locator("#hero img")).toBeVisible();
  await expect(page.getByText("Kampanya!")).toBeVisible();
  await nextFrame(page);
  await page.click("#buy");
  await nextFrame(page);
  await hide(page);

  const reference = await page.evaluate(() => (globalThis as { __webVitals?: Record<string, number> }).__webVitals ?? {});
  const sdkValues = async () => {
    const values: Record<string, number> = {};
    // Aynı metrik birden fazla raporlanırsa son değer geçerlidir.
    for (const e of await ingest.events()) if (e.t === "vital") values[e.name] = e.value;
    return values;
  };
  await expect.poll(async () => Object.keys(await sdkValues()).sort()).toEqual(Object.keys(reference).sort());

  const sdk = await sdkValues();
  for (const [name, expected] of Object.entries(reference)) {
    const tolerance = TOLERANCE[name] ?? 0;
    expect(Math.abs((sdk[name] ?? NaN) - expected), `${name}: SDK ${sdk[name]}, web-vitals ${expected}`).toBeLessThanOrEqual(tolerance);
  }
});
