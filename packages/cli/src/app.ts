import type { DatabaseSync } from "node:sqlite";
import { LIMITS, PROTOCOL_VERSION } from "@vitalscope/protocol";
import { Batch } from "@vitalscope/protocol/schema";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { EventBuffer } from "./buffer.js";
import { isAllowedOrigin, isLocalHost } from "./origin.js";
import { addPanelRoutes, type PanelAssets } from "./panel.js";
import type { StoredEvent } from "./types.js";

/** Tarayıcının preflight yanıtını önbelleğe alacağı süre (sn): 24 saat. */
const PREFLIGHT_MAX_AGE = "86400";
/** sendBeacon string gövdeyi `text/plain` gönderir; ikisi de JSON olarak ayrıştırılır. */
const JSON_BODY_TYPE = /^(text\/plain|application\/json)\s*(;|$)/i;

export interface AppOptions {
  buffer: EventBuffer;
  now?: () => number;
  /** Verilirse panel ve okuma API'si de sunulur. */
  panel?: { db: DatabaseSync; assets: PanelAssets };
}

/** Yanıtların hepsi boş gövdelidir; hata detayı istemciye dönmez. */
const empty = (status: 202 | 204 | 400 | 403 | 413 | 415 | 422 | 500) => new Response(null, { status });

export function createApp({ buffer, now = Date.now, panel }: AppOptions) {
  const app = new Hono();

  app.use(async (c, next) => {
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
  });
  app.use(async (c, next) => {
    if (!isLocalHost(c.req.header("Host"))) return empty(403);
    return next();
  });
  app.onError(() => empty(500));
  app.notFound(() => new Response(null, { status: 404 }));

  app.get("/healthz", () => new Response(null, { status: 204 }));
  if (panel) addPanelRoutes(app, { ...panel, now });

  // Çerez izni hiç verilmez.
  app.options("/v1/e", (c) => {
    const origin = c.req.header("Origin");
    const res = new Response(null, { status: 204 });
    if (isAllowedOrigin(origin)) res.headers.set("Access-Control-Allow-Origin", origin!);
    res.headers.set("Access-Control-Allow-Methods", "POST");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type");
    res.headers.set("Access-Control-Max-Age", PREFLIGHT_MAX_AGE);
    res.headers.set("Vary", "Origin");
    return res;
  });

  app.post(
    "/v1/e",
    bodyLimit({ maxSize: LIMITS.maxBodyBytes, onError: () => empty(413) }),
    async (c) => {
      if (!JSON_BODY_TYPE.test(c.req.header("Content-Type") ?? "")) return empty(415);

      let body: unknown;
      try {
        body = JSON.parse(await c.req.text());
      } catch {
        return empty(400);
      }
      const version = (body as { v?: unknown } | null)?.v;
      if (typeof version === "number" && version !== PROTOCOL_VERSION) return empty(422);
      const parsed = Batch.safeParse(body);
      if (!parsed.success) return empty(400);
      const { sdk, ctx, e } = parsed.data;

      const origin = c.req.header("Origin");
      if (!isAllowedOrigin(origin)) return empty(403);

      const receivedAt = now();
      buffer.add(e.map((event): StoredEvent => ({ receivedAt, sdk, ctx, event })));

      const res = empty(202);
      res.headers.set("Access-Control-Allow-Origin", origin!);
      res.headers.set("Vary", "Origin");
      return res;
    },
  );

  return app;
}
