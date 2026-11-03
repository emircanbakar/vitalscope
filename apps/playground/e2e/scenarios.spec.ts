import { expect, test, type Page } from "@playwright/test";
import { getRating } from "@vitalscope/protocol";
import { bodiesOf, captureIngest, hide, nextFrame, supportsEntryType, supportsInp } from "./helpers.js";

// Desteklenmeyen metrikte de bir test durumu vardır: olay gönderilmez ve sayfa kırılmaz.

test("slow LCP is reported with a matching rating", async ({ page }) => {
  const ingest = await captureIngest(page);
  await page.goto("/slow-lcp/");
  await expect(page.locator("#hero img")).toBeVisible({ timeout: 6000 });
  await nextFrame(page);
  await hide(page);
  await expect.poll(async () => (await ingest.events()).some((e) => e.t === "pageview")).toBe(true);

  if (!(await supportsEntryType(page, "largest-contentful-paint"))) {
    expect(await ingest.vitals("LCP")).toEqual([]);
    return;
  }
  await expect.poll(async () => (await ingest.vitals("LCP")).length).toBe(1);
  const [lcp] = await ingest.vitals("LCP");
  if (lcp?.t !== "vital") throw new Error("LCP missing");
  expect(lcp.value).toBeGreaterThanOrEqual(3000);
  // Yavaş açılan tarayıcıda (CI, ilk Firefox açılışı) 3 sn'ye başlangıç süresi eklenip 4 sn'yi geçebilir.
  expect(lcp.rating).not.toBe("good");
  expect(lcp.rating).toBe(getRating("LCP", lcp.value));
});

test("a 400 ms click handler is reported as INP", async ({ page }) => {
  const ingest = await captureIngest(page);
  await page.goto("/janky-button/");
  await page.click("#buy");
  await nextFrame(page);
  await hide(page);
  await expect.poll(async () => (await ingest.events()).some((e) => e.t === "pageview")).toBe(true);

  if (!(await supportsInp(page))) {
    expect(await ingest.vitals("INP")).toEqual([]);
    return;
  }
  await expect.poll(async () => (await ingest.vitals("INP")).length).toBe(1);
  const [inp] = await ingest.vitals("INP");
  expect(inp?.t === "vital" && inp.value).toBeGreaterThanOrEqual(400);
});

test("a late banner is reported as CLS", async ({ page }) => {
  const ingest = await captureIngest(page);
  await page.goto("/layout-shift/");
  await expect(page.getByText("Kampanya!")).toBeVisible();
  await nextFrame(page);
  await hide(page);
  await expect.poll(async () => (await ingest.events()).some((e) => e.t === "pageview")).toBe(true);

  if (!(await supportsEntryType(page, "layout-shift"))) {
    expect(await ingest.vitals("CLS")).toEqual([]);
    return;
  }
  await expect.poll(async () => (await ingest.vitals("CLS")).length).toBe(1);
  const [cls] = await ingest.vitals("CLS");
  expect(cls?.t === "vital" && cls.value).toBeGreaterThan(0.1);
});

test("errors are captured with storm protection", async ({ page }) => {
  const ingest = await captureIngest(page);
  await page.goto("/throws/");
  await nextFrame(page);
  await hide(page);

  const messages = async () => (await ingest.events()).flatMap((e) => (e.t === "error" ? [e.msg] : []));
  await expect.poll(async () => (await messages()).filter((m) => m === "repeat boom").length).toBe(5);
  expect((await messages()).sort()).toEqual(["async boom", ...Array(5).fill("repeat boom"), "sync boom"].sort());
});

test("SPA route changes send one pageview each", async ({ page }) => {
  const ingest = await captureIngest(page);
  await page.goto("/spa/");
  await expect(page).toHaveURL(/\/spa\/c$/);
  await hide(page);

  await expect.poll(async () => (await ingest.events()).filter((e) => e.t === "pageview").length).toBe(4);
  // Beacon'lar sunucuya gönderim sırasıyla gelmeyebilir ve rota değişimleri aynı milisaniyede olabilir;
  // önemli olan her pageview'ın kendi sayfasının path'iyle gitmesi.
  const pageviewPaths = (await ingest.batches()).flatMap((b) => b.e.filter((e) => e.t === "pageview").map(() => b.ctx.path));
  expect(pageviewPaths.sort()).toEqual(["/spa/", "/spa/a", "/spa/b", "/spa/c"]);
});

test("no personal data leaves the page", async ({ page }) => {
  const ingest = await captureIngest(page);
  await page.goto("/pii/?email=a@b.com&token=xyz");
  await hide(page);

  await expect.poll(async () => (await ingest.events()).some((e) => e.t === "error")).toBe(true);
  for (const body of await ingest.bodies()) expect(body).not.toMatch(/a@b\.com|a%40b\.com|xyz/);
  expect((await ingest.batches())[0]?.ctx.path).toBe("/pii/");
});

/** Sayfaya gidip başka sayfaya geçer ve geri döner; sayfa bfcache'ten geldiyse `true`. */
async function restoredFromBfcache(page: Page, path: string): Promise<boolean> {
  await page.goto(path);
  await page.goto("/");
  // bfcache'ten dönen sayfa `load` tetiklemez; sadece navigasyonun başlaması beklenir.
  await page.goBack({ waitUntil: "commit" });
  const body = page.locator("body[data-persisted]");
  await body.waitFor();
  return (await body.getAttribute("data-persisted")) === "true";
}

test("the SDK does not block the back/forward cache", async ({ page }) => {
  await captureIngest(page);
  // Önce SDK'sız sayfa: tarayıcı bu ortamda bfcache kullanmıyorsa sonuç SDK hakkında bir şey söylemez.
  test.skip(!(await restoredFromBfcache(page, "/bfcache/control/")), "this browser does not restore pages from bfcache here");
  expect(await restoredFromBfcache(page, "/bfcache/")).toBe(true);
});

test("works under a strict CSP with Trusted Types", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  const ingest = await captureIngest(page);
  await page.goto("/csp/");
  await hide(page);

  await expect
    .poll(async () => (await ingest.events()).some((e) => e.t === "custom" && e.name === "csp_page_loaded"))
    .toBe(true);
  expect(problems).toEqual([]);
});

// Gerçek bir sayfa kapanışı (pagehide) sırasında gönderilen olaylar kaybolmaz.
test("events survive leaving the page", async ({ page }) => {
  const ingest = await captureIngest(page);
  await page.goto("/spa/");
  await expect(page).toHaveURL(/\/spa\/c$/);
  // Ana sayfada SDK yok: son batch /spa/c sayfası kapanırken gönderilmiştir.
  await page.goto("/");
  await expect.poll(async () => (await ingest.events()).filter((e) => e.t === "pageview").length).toBe(4);
});

test("events survive closing the page", async ({ page }) => {
  const ingest = await captureIngest(page);
  // Playwright'ın Firefox'u kapanışta o an çalışan pagehide betiğini arada bir yarıda kesiyor (`finally`
  // bile çalışmıyor). Her pagehide dinleyicisi sarılır; yarıda kalan olursa sonuç SDK hakkında bir şey söylemez.
  await page.addInitScript(() => {
    const unfinished = new Set<number>();
    (globalThis as { __unfinishedPagehide?: Set<number> }).__unfinishedPagehide = unfinished;
    const add = EventTarget.prototype.addEventListener;
    let next = 0;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (type !== "pagehide" || typeof listener !== "function") return add.call(this, type, listener, options);
      const id = next++;
      return add.call(
        this,
        type,
        function (this: unknown, event: Event) {
          unfinished.add(id);
          listener.call(this, event);
          unfinished.delete(id);
        },
        options,
      );
    };
  });
  await page.goto("/spa/");
  await expect(page).toHaveURL(/\/spa\/c$/);
  // Kontrol: SDK'dan sonra pagehide içinde düz bir sendBeacon; önceki dinleyicilerden yarıda kalan var mı, onu da bildirir.
  const probe = `${ingest.run}-probe`;
  await page.evaluate((id) => {
    const unfinished = (globalThis as { __unfinishedPagehide?: Set<number> }).__unfinishedPagehide;
    window.addEventListener("pagehide", () =>
      // Bu dinleyici de sarılı ve şu an çalışıyor: kendisi dışında yarıda kalan var mı?
      navigator.sendBeacon(`http://127.0.0.1:4174/v1/e/${id}`, (unfinished?.size ?? 0) > 1 ? "interrupted" : "ok"),
    );
  }, probe);
  await page.close({ runBeforeUnload: true });

  const probeBody = await expect
    .poll(async () => (await bodiesOf(probe)).length, { timeout: 3000 })
    .toBe(1)
    .then(
      async () => (await bodiesOf(probe))[0],
      () => undefined,
    );
  test.skip(probeBody === undefined, "this browser does not deliver beacons sent while page.close() runs");
  const pageviews = expect.poll(async () => (await ingest.events()).filter((e) => e.t === "pageview").length).toBe(4);
  // Kesinti çoğu zaman başka bir dinleyiciye denk gelir; sadece olay eksikse ve kesinti kanıtlıysa atlanır.
  if (probeBody === "interrupted") {
    const delivered = await pageviews.then(
      () => true,
      () => false,
    );
    test.skip(!delivered, "the browser cut a pagehide listener short while closing the page");
  } else {
    await pageviews;
  }
});
