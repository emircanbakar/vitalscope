import { LIMITS, PROTOCOL_VERSION, type BatchInput, type ContextInput, type Event } from "@vitalscope/protocol";

export interface BatchHeader {
  k: string;
  sdk: string;
  ctx: ContextInput;
}

const encoder = new TextEncoder();
const byteLength = (s: string) => encoder.encode(s).length;

/**
 * Olayları protokol sınırlarına uyan JSON gövdelerine böler: batch başına en fazla
 * `maxEventsPerBatch` olay ve `maxBatchBytes` bayt. Tek başına sınırı aşan olay düşürülür.
 */
export function encodeBatches(header: BatchHeader, events: readonly Event[]): string[] {
  const shell: BatchInput = { v: PROTOCOL_VERSION, ...header, e: [] };
  // `"e":[]` sona yazılır; olaylar köşeli parantezin içine eklenir.
  const prefix = JSON.stringify(shell).slice(0, -2);
  const suffix = "]}";
  const baseBytes = byteLength(prefix) + byteLength(suffix);

  const bodies: string[] = [];
  let parts: string[] = [];
  let bytes = baseBytes;

  const close = () => {
    if (parts.length > 0) bodies.push(prefix + parts.join(",") + suffix);
    parts = [];
    bytes = baseBytes;
  };

  for (const event of events) {
    const json = JSON.stringify(event);
    const size = byteLength(json);
    if (baseBytes + size > LIMITS.maxBatchBytes) continue;
    const comma = () => (parts.length > 0 ? 1 : 0);
    if (parts.length >= LIMITS.maxEventsPerBatch || bytes + comma() + size > LIMITS.maxBatchBytes) close();
    bytes += comma() + size;
    parts.push(json);
  }
  close();
  return bodies;
}

/**
 * Önce sendBeacon: string gövde `text/plain` gider, CORS preflight gerekmez.
 * Kuyruk/boyut nedeniyle reddedilirse fetch keepalive; o da yoksa olay düşürülür (yeniden deneme yok).
 */
export function send(endpoint: string, body: string): void {
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    if (navigator.sendBeacon(endpoint, body)) return;
  }
  if (typeof fetch === "function") {
    fetch(endpoint, {
      method: "POST",
      body,
      keepalive: true,
      credentials: "omit",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    }).catch(() => {});
  }
}
