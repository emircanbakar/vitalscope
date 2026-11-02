import { expect, test } from "@playwright/test";
import { getRating } from "@vitalscope/protocol";
import { captureIngest, events, hide, nextFrame, supportsEntryType, supportsInp, vitals } from "./helpers.js";

// Desteklenmeyen metrikte de bir test durumu vardır: olay gönderilmez ve sayfa kırılmaz.

test("slow LCP is reported with a matching rating", async ({ page }) => {
  const sent = await captureIngest(page);
  await page.goto("/slow-lcp/");
  await expect(page.locator("#hero img")).toBeVisible({ timeout: 6000 });
  await nextFrame(page);
  await hide(page);
  await expect.poll(() => events(sent).some((e) => e.t === "pageview")).toBe(true);

  if (!(await supportsEntryType(page, "largest-contentful-paint"))) {
    expect(vitals(sent, "LCP")).toEqual([]);
    return;
  }
  await expect.poll(() => vitals(sent, "LCP").length).toBe(1);
  const [lcp] = vitals(sent, "LCP");
  if (lcp?.t !== "vital") throw new Error("LCP missing");
  expect(lcp.value).toBeGreaterThanOrEqual(3000);
  // Yavaş açılan tarayıcıda (CI, ilk Firefox açılışı) 3 sn'ye başlangıç süresi eklenip 4 sn'yi geçebilir.
  expect(lcp.rating).not.toBe("good");
  expect(lcp.rating).toBe(getRating("LCP", lcp.value));
});

test("a 400 ms click handler is reported as INP", async ({ page }) => {
  const sent = await captureIngest(page);
  await page.goto("/janky-button/");
  await page.click("#buy");
  await nextFrame(page);
  await hide(page);
  await expect.poll(() => events(sent).some((e) => e.t === "pageview")).toBe(true);

  if (!(await supportsInp(page))) {
    expect(vitals(sent, "INP")).toEqual([]);
    return;
  }
  await expect.poll(() => vitals(sent, "INP").length).toBe(1);
  const [inp] = vitals(sent, "INP");
  expect(inp?.t === "vital" && inp.value).toBeGreaterThanOrEqual(400);
});

test("a late banner is reported as CLS", async ({ page }) => {
  const sent = await captureIngest(page);
  await page.goto("/layout-shift/");
  await expect(page.getByText("Kampanya!")).toBeVisible();
  await nextFrame(page);
  await hide(page);
  await expect.poll(() => events(sent).some((e) => e.t === "pageview")).toBe(true);

  if (!(await supportsEntryType(page, "layout-shift"))) {
    expect(vitals(sent, "CLS")).toEqual([]);
    return;
  }
  await expect.poll(() => vitals(sent, "CLS").length).toBe(1);
  const [cls] = vitals(sent, "CLS");
  expect(cls?.t === "vital" && cls.value).toBeGreaterThan(0.1);
});

test("errors are captured with storm protection", async ({ page }) => {
  const sent = await captureIngest(page);
  await page.goto("/throws/");
  await nextFrame(page);
  await hide(page);

  const messages = () => events(sent).flatMap((e) => (e.t === "error" ? [e.msg] : []));
  await expect.poll(() => messages().filter((m) => m === "repeat boom").length).toBe(5);
  expect(messages().sort()).toEqual(["async boom", ...Array(5).fill("repeat boom"), "sync boom"].sort());
});

test("SPA route changes send one pageview each", async ({ page }) => {
  const sent = await captureIngest(page);
  await page.goto("/spa/");
  await expect(page).toHaveURL(/\/spa\/c$/);
  await hide(page);

  await expect.poll(() => events(sent).filter((e) => e.t === "pageview").length).toBe(4);
  const pageviewPaths = sent.batches.filter((b) => b.e.some((e) => e.t === "pageview")).map((b) => b.ctx.path);
  expect(pageviewPaths).toEqual(["/spa/", "/spa/a", "/spa/b", "/spa/c"]);
});

test("no personal data leaves the page", async ({ page }) => {
  const sent = await captureIngest(page);
  await page.goto("/pii/?email=a@b.com&token=xyz");
  await hide(page);

  await expect.poll(() => events(sent).some((e) => e.t === "error")).toBe(true);
  for (const body of sent.bodies) expect(body).not.toMatch(/a@b\.com|a%40b\.com|xyz/);
  expect(sent.batches[0]?.ctx.path).toBe("/pii/");
});

test("the SDK does not block the back/forward cache", async ({ page }) => {
  const persistedAfterBack = async (path: string) => {
    await page.goto(path);
    await page.goto("/");
    await page.goBack();
    return page.locator("body").getAttribute("data-persisted");
  };

  // Tarayıcı bu ortamda bfcache kullanmıyorsa sonuç SDK hakkında bir şey söylemez.
  test.skip((await persistedAfterBack("/bfcache/control/")) !== "true", "bfcache is not available here");
  await captureIngest(page);
  expect(await persistedAfterBack("/bfcache/")).toBe("true");
});

test("works under a strict CSP with Trusted Types", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  const sent = await captureIngest(page);
  await page.goto("/csp/");
  await hide(page);

  await expect.poll(() => events(sent).some((e) => e.t === "custom" && e.name === "csp_page_loaded")).toBe(true);
  expect(problems).toEqual([]);
});

// Gerçek bir sayfa kapanışı (pagehide) sırasında gönderilen olaylar kaybolmaz. `page.close()` kullanılmaz:
// Playwright kapanan sayfanın isteklerini yönlendirmeye düşürmüyor, sonuç SDK hakkında bir şey söylemiyor.
test("events survive leaving the page", async ({ page, browserName }) => {
  // Chromium'da pagehide içinde gönderilen düz bir sendBeacon denemesi de `true` döner ama Playwright'a görünmez.
  test.skip(browserName === "chromium", "Playwright does not see beacons Chromium sends during pagehide");
  const sent = await captureIngest(page.context());
  await page.goto("/spa/");
  await expect(page).toHaveURL(/\/spa\/c$/);
  // Ana sayfada SDK yok: gelen her olay /spa/ sayfası kapanırken gönderilmiştir.
  await page.goto("/");
  await expect.poll(() => events(sent).filter((e) => e.t === "pageview").length).toBe(4);
});
