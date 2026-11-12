import type { Attribution } from "@vitalscope/protocol";
import type { StoredEvent } from "./types.js";

const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 60 * 1000;

/** İstemci saatine güvenilmez: uç değerli `ts`'ler zaman serilerini bozar. Makul aralık dışında alınma zamanı kullanılır. */
function eventTime(ts: number, receivedAt: number) {
  return ts >= receivedAt - MAX_EVENT_AGE_MS && ts <= receivedAt + MAX_CLOCK_SKEW_MS ? ts : receivedAt;
}

/** Sütunu olmayan attribution alanları; INP'nin atladığı en yavaş etkileşim de burada saklanır. */
function details({ ttfb, loadDelay, loadTime, renderDelay, event, inputDelay, processing, presentation, slowest, time }: Attribution) {
  const all = { ttfb, loadDelay, loadTime, renderDelay, event, inputDelay, processing, presentation, slowest, time };
  return Object.fromEntries(Object.entries(all).filter(([, value]) => value !== undefined));
}

export type Rows = Record<"vitals" | "errors" | "pageviews" | "custom_events", Record<string, unknown>[]>;

/** Olayları türüne göre tablo satırlarına ayırır; verilmeyen sütunlar `NULL` kalır. */
export function toRows(events: readonly StoredEvent[]): Rows {
  const rows: Rows = { vitals: [], errors: [], pageviews: [], custom_events: [] };
  for (const { receivedAt, sdk, ctx, event } of events) {
    const common = {
      ts: eventTime(event.ts, receivedAt),
      received_at: receivedAt,
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
          attr: event.attr ? JSON.stringify(details(event.attr)) : undefined,
        });
        break;
      case "error":
        rows.errors.push({ ...common, type: event.type, message: event.msg, stack: JSON.stringify(event.stack), handled: event.handled ? 1 : 0 });
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
