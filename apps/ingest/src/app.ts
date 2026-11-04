import { LIMITS, PROTOCOL_VERSION } from "@vitalscope/protocol";
import { Batch } from "@vitalscope/protocol/schema";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { EventBuffer } from "./buffer.js";
import { isAllowedOrigin } from "./origin.js";
import type { ResolveKey, StoredEvent } from "./types.js";

/** Tarayıcının preflight yanıtını önbelleğe alacağı süre (sn): 24 saat. */
const PREFLIGHT_MAX_AGE = "86400";
/** sendBeacon string gövdeyi `text/plain` gönderir; ikisi de JSON olarak ayrıştırılır. */
const JSON_BODY_TYPE = /^(text\/plain|application\/json)\s*(;|$)/i;

export interface AppOptions {
  resolveKey: ResolveKey;
  buffer: EventBuffer;
  /** `/readyz`: bağlı servisler (depo, veritabanı) hazır mı? */
  isReady?: () => Promise<boolean>;
  now?: () => number;
}

/** Yanıtların hepsi boş gövdelidir; hata detayı istemciye dönmez. */
const empty = (status: 202 | 204 | 400 | 401 | 403 | 413 | 415 | 422 | 500 | 503) => new Response(null, { status });

export function createApp({ resolveKey, buffer, isReady = async () => true, now = Date.now }: AppOptions) {
  const app = new Hono();

  app.use(async (c, next) => {
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
  });
  app.onError(() => empty(500));
  app.notFound(() => new Response(null, { status: 404 }));

  app.get("/healthz", () => new Response(null, { status: 204 }));
  app.get("/readyz", async () => empty((await isReady().catch(() => false)) ? 204 : 503));

  // Preflight'ta gövde yok, proje bilinmez: Origin'i asıl kontrol POST'ta yapılır. Çerez izni hiç verilmez.
  app.options("/v1/e", (c) => {
    const origin = c.req.header("Origin");
    const res = new Response(null, { status: 204 });
    if (origin) res.headers.set("Access-Control-Allow-Origin", origin);
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
      const { k, sdk, ctx, e } = parsed.data;

      let project;
      try {
        project = await resolveKey(k);
      } catch {
        return empty(503);
      }
      if (!project) return empty(401);

      const origin = c.req.header("Origin");
      if (!isAllowedOrigin(origin, project.allowedOrigins)) return empty(403);

      const receivedAt = now();
      const projectId = project.id;
      buffer.add(e.map((event): StoredEvent => ({ projectId, receivedAt, sdk, ctx, event })));

      const res = empty(202);
      res.headers.set("Access-Control-Allow-Origin", origin!);
      res.headers.set("Vary", "Origin");
      return res;
    },
  );

  return app;
}
