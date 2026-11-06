import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { METRIC_NAMES, type MetricName } from "@vitalscope/protocol";
import type { Context, Hono } from "hono";
import { ENVIRONMENTS, getComparison, getErrorDetail, getErrorList, getMetricDetail, getOptions, getOverview, getReleases, type Environment, type Filters } from "./queries.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
const ERROR_ID = /^[0-9a-f]{16}$/;
const RANGES: Record<string, number> = { "1h": 3_600_000, "24h": 86_400_000, "7d": 604_800_000, "30d": 2_592_000_000 };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
/** Tarayıcı dışı istemcide başlık yoktur; adres çubuğundan açılış `none` gönderir. */
const SAME_SITE_REQUESTS = new Set(["same-origin", "none"]);

export type PanelAssets = ReadonlyMap<string, { body: Uint8Array<ArrayBuffer>; type: string }>;

/**
 * Build çıktısı açılışta belleğe alınır. İstek sadece bu tabloya bakar, dosya sistemine dokunmaz:
 * yol aşımı (`/../`) ve sonradan eklenen dosyalar sunulamaz. Panel paketlenmemişse tablo boş kalır.
 */
export function loadPanelAssets(dir: string): PanelAssets {
  const assets = new Map<string, { body: Uint8Array<ArrayBuffer>; type: string }>();
  if (!existsSync(dir)) return assets;
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const type = CONTENT_TYPES[extname(entry.name)];
    if (!entry.isFile() || !type) continue;
    const path = join(entry.parentPath, entry.name);
    const route = `/${path.slice(dir.length).replace(/\\/g, "/").replace(/^\/+/, "")}`;
    assets.set(route, { body: new Uint8Array(readFileSync(path)), type });
  }
  return assets;
}

function parseFilters(c: Context, now: number): Filters | null {
  const { env, page, device, range } = c.req.query();
  if (!ENVIRONMENTS.includes(env as Environment)) return null;
  if (range !== undefined && !Object.hasOwn(RANGES, range)) return null;
  return {
    env: env as Environment,
    ...(page !== undefined ? { page } : {}),
    ...(device !== undefined ? { device } : {}),
    ...(range !== undefined ? { since: now - RANGES[range]! } : {}),
  };
}

export function addPanelRoutes(app: Hono, { db, assets, now }: { db: DatabaseSync; assets: PanelAssets; now: () => number }) {
  // Ölçümler sayfa adresleri ve hata izleri içerir. CORS başlığı yok; başka sitelere yanıt hiç verilmez.
  app.use("/api/*", async (c, next) => {
    const site = c.req.header("Sec-Fetch-Site");
    if (site !== undefined && !SAME_SITE_REQUESTS.has(site)) return new Response(null, { status: 403 });
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  });

  app.get("/api/options", (c) => c.json(getOptions(db)));

  app.get("/api/overview", (c) => {
    const filters = parseFilters(c, now());
    return filters ? c.json(getOverview(db, filters)) : new Response(null, { status: 400 });
  });

  app.get("/api/metrics/:name", (c) => {
    const name = c.req.param("name");
    if (!METRIC_NAMES.includes(name as MetricName)) return new Response(null, { status: 404 });
    const filters = parseFilters(c, now());
    return filters ? c.json(getMetricDetail(db, name as MetricName, filters)) : new Response(null, { status: 400 });
  });

  app.get("/api/errors", (c) => {
    const filters = parseFilters(c, now());
    return filters ? c.json(getErrorList(db, filters)) : new Response(null, { status: 400 });
  });

  app.get("/api/errors/:id", (c) => {
    const id = c.req.param("id");
    if (!ERROR_ID.test(id)) return new Response(null, { status: 404 });
    const filters = parseFilters(c, now());
    return filters ? c.json(getErrorDetail(db, id, filters)) : new Response(null, { status: 400 });
  });

  app.get("/api/releases", (c) => {
    const filters = parseFilters(c, now());
    return filters ? c.json(getReleases(db, filters)) : new Response(null, { status: 400 });
  });

  app.get("/api/compare", (c) => {
    const filters = parseFilters(c, now());
    const { a, b } = c.req.query();
    if (!filters || !a || !b) return new Response(null, { status: 400 });
    return c.json(getComparison(db, filters, a, b));
  });

  const serve = (route: string) => {
    const asset = assets.get(route);
    if (!asset) return new Response(null, { status: 404 });
    return new Response(asset.body, {
      headers: {
        "Content-Type": asset.type,
        // Dosya adları içerik özeti taşır; sayfanın kendisi her açılışta yeniden istenir.
        "Cache-Control": route === "/index.html" ? "no-cache" : "public, max-age=31536000, immutable",
        "Content-Security-Policy": CSP,
        "Referrer-Policy": "no-referrer",
      },
    });
  };
  app.get("/", () => serve("/index.html"));
  app.get("/assets/*", (c) => serve(c.req.path));
}
