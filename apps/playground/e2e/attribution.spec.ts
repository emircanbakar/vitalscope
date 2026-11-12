import { expect, test } from "@playwright/test";
import { captureIngest, hide, nextFrame, supportsEntryType, supportsInp } from "./helpers.js";

// `@vitalscope/sdk/attribution`: metriklerin yanında "neden yavaş" bilgisi. Desteklenmeyen metrikte olay yoktur.
test("vitals carry attribution", async ({ page }) => {
  const ingest = await captureIngest(page);
  await page.goto("/attribution/");
  await expect(page.locator("#hero")).toBeVisible();
  await expect(page.getByText("Kampanya!")).toBeVisible();
  await nextFrame(page);
  await page.click("#buy");
  await nextFrame(page);
  await hide(page);
  await expect.poll(async () => (await ingest.events()).some((e) => e.t === "pageview")).toBe(true);

  const attr = async (name: string) => {
    const vital = (await ingest.vitals(name)).at(-1);
    return vital?.t === "vital" ? { value: vital.value, attr: vital.attr } : undefined;
  };

  if (await supportsEntryType(page, "largest-contentful-paint")) {
    await expect.poll(async () => (await attr("LCP"))?.attr?.url).toBe("http://localhost:4173/attribution/hero.png");
    const lcp = await attr("LCP");
    expect(lcp?.attr?.target).toBe("img#hero");
    // Alt parçaların toplamı LCP'nin kendisidir.
    const { ttfb = 0, loadDelay = 0, loadTime = 0, renderDelay = 0 } = lcp?.attr ?? {};
    expect(ttfb + loadDelay + loadTime + renderDelay).toBeCloseTo(lcp?.value ?? NaN, 5);
  }

  if (await supportsEntryType(page, "layout-shift")) {
    await expect.poll(async () => (await attr("CLS"))?.attr?.target).toMatch(/#content|#hero/);
  }

  if (await supportsInp(page)) {
    await expect.poll(async () => (await attr("INP"))?.attr?.target).toBe("button#buy");
    const inp = await attr("INP");
    expect(inp?.attr?.type).toBe("pointer");
    expect(inp?.attr?.event).toMatch(/^(pointerdown|pointerup|click)$/);
    expect(inp?.attr?.processing).toBeGreaterThanOrEqual(150);
    // Süre 8 ms'ye yuvarlanır; fazlar ham zamanlardan hesaplanır.
    const { inputDelay = 0, processing = 0, presentation = 0 } = inp?.attr ?? {};
    expect(Math.abs(inputDelay + processing + presentation - (inp?.value ?? NaN))).toBeLessThanOrEqual(8);
    if (await supportsEntryType(page, "long-animation-frame")) {
      expect(inp?.attr?.script).toMatch(/^http:\/\/localhost:4173\/assets\/attribution-[\w-]+\.js$/);
    }
  }
});
