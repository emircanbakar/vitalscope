// Sorgu süresi testi ve `pnpm seed` aynı veriyi üretir. Sadece tip import'u var: Node bu dosyayı derlemeden çalıştırır.
import type { StoredEvent } from "../src/types.js";

const ROUTES = Array.from({ length: 40 }, (_, i) => (i % 4 === 0 ? { path: `/products/${i}`, route: "/products/[id]" } : { path: `/page-${i}` }));
const DEVICES = ["desktop", "mobile", "tablet"] as const;
const ENVIRONMENTS = ["development", "development", "development", "production", "preview"] as const;
const RELEASES = Array.from({ length: 20 }, (_, i) => `1.${i}.0`);
const ERRORS = Array.from({ length: 30 }, (_, i) => ({
  type: ["TypeError", "Error", "ReferenceError"][i % 3]!,
  message: (id: number) => `Cannot read properties of undefined (reading 'item${i}') #${id}`,
  stack: [`at handler${i} (http://localhost:5173/src/component-${i}.tsx?t=${i}:${10 + i}:5)`, "at callback (http://localhost:5173/node_modules/.vite/deps/react-dom.js:100:1)"],
}));
const METRICS = [
  { name: "TTFB", median: 120, spread: 0.6 },
  { name: "FCP", median: 900, spread: 0.5 },
  { name: "LCP", median: 1800, spread: 0.6 },
  { name: "CLS", median: 0.04, spread: 1 },
  { name: "INP", median: 120, spread: 0.7 },
] as const;

/**
 * Sayfa açılışları: pageview, beş metrik (INP her sayfada yok, LCP ve CLS büyüdükçe yeniden gönderilir), %5'inde hata.
 * Değerler log-normal, sayfa ve cihazlar eşit dağılmaz. Aynı ayarlar aynı olayları üretir.
 */
export function* seedEvents(count: number, { days, now }: { days: number; now: number }): Generator<StoredEvent> {
  let state = 42;
  const random = () => (state = (state * 48_271) % 2_147_483_647) / 2_147_483_647;
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() ** 2 * items.length)]!;
  const lognormal = (median: number, spread: number) => median * Math.exp(spread * Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random()));
  const start = now - days * 86_400_000;

  for (let produced = 0, session = 0; produced < count; session++) {
    const ctx: StoredEvent["ctx"] = { sid: session.toString(16).padStart(16, "0"), ...pick(ROUTES), env: pick(ENVIRONMENTS), device: pick(DEVICES), sr: 1, release: pick(RELEASES) };
    const ts = Math.floor(start + random() * (now - start));
    const events: StoredEvent["event"][] = [{ t: "pageview", ts }];
    for (const { name, median, spread } of METRICS) {
      if (name === "INP" && random() < 0.4) continue;
      const sends = name === "LCP" || name === "CLS" ? 1 + Math.floor(random() * 3) : 1;
      for (let i = 0; i < sends; i++) {
        const value = lognormal(median, spread) * (1 + i * 0.2);
        events.push({ t: "vital", ts: ts + i * 1000, name, value: name === "CLS" ? Number(value.toFixed(4)) : Math.round(value), rating: "good", id: `v1-${name}` });
      }
    }
    if (random() < 0.05) {
      const error = pick(ERRORS);
      events.push({ t: "error", ts: ts + 500, type: error.type, msg: error.message(Math.floor(random() * 1e6)), stack: error.stack, handled: false });
    }
    for (const event of events.slice(0, count - produced)) yield { receivedAt: event.ts, sdk: "0.1.1", ctx, event };
    produced += events.length;
  }
}
