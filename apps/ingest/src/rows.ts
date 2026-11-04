import type { Attribution } from "@vitalscope/protocol";
import type { StoredEvent } from "./types.js";

const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 60 * 1000;

/**
 * İstemci saatine güvenilmez: uç değerli `ts`'ler tek insert'te çok sayıda aylık bölüm açar,
 * ClickHouse tüm partiyi reddeder ve yeniden deneme de hiç bitmez. Makul aralık dışında sunucu zamanı kullanılır.
 */
function eventTime(ts: number, receivedAt: number) {
  return ts >= receivedAt - MAX_EVENT_AGE_MS && ts <= receivedAt + MAX_CLOCK_SKEW_MS ? ts : receivedAt;
}

/** `DateTime64(3, 'UTC')` metin biçimi; sütunun saat dilimi UTC olduğu için böyle okunur. */
const dateTime = (ms: number) => new Date(ms).toISOString().slice(0, -1).replace("T", " ");

function timings({ ttfb, loadDelay, loadTime, renderDelay, inputDelay, processing, presentation, time }: Attribution) {
  const all = { ttfb, loadDelay, loadTime, renderDelay, inputDelay, processing, presentation, time };
  return Object.fromEntries(Object.entries(all).filter(([, value]) => value !== undefined));
}

export type Rows = Record<"vitals" | "errors" | "pageviews" | "custom_events", Record<string, unknown>[]>;

/** Olayları türüne göre tablo satırlarına ayırır; verilmeyen sütunlar tablodaki varsayılanı alır. */
export function toRows(events: readonly StoredEvent[]): Rows {
  const rows: Rows = { vitals: [], errors: [], pageviews: [], custom_events: [] };
  for (const { projectId, receivedAt, sdk, ctx, event } of events) {
    const common = {
      project_id: projectId,
      ts: dateTime(eventTime(event.ts, receivedAt)),
      received_at: dateTime(receivedAt),
      sample_rate: ctx.sr,
      sdk,
      path: ctx.path,
      route: ctx.route,
      release: ctx.release,
      env: ctx.env,
      device: ctx.device,
      conn: ctx.conn,
      nav_type: ctx.nav,
      session_id: ctx.sid,
    };
    switch (event.t) {
      case "vital":
        rows.vitals.push({
          ...common,
          name: event.name,
          metric_id: event.id,
          value: event.value,
          rating: event.rating,
          attr_target: event.attr?.target,
          attr_url: event.attr?.url,
          attr_script: event.attr?.script,
          attr_type: event.attr?.type,
          attr: event.attr ? timings(event.attr) : {},
        });
        break;
      case "error":
        rows.errors.push({ ...common, type: event.type, message: event.msg, stack: event.stack, handled: event.handled });
        break;
      case "pageview":
        rows.pageviews.push({ ...common, path: event.path ?? ctx.path });
        break;
      case "custom":
        rows.custom_events.push({ ...common, name: event.name, value: event.value });
        break;
    }
  }
  return rows;
}
