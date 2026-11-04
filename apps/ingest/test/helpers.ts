import type { EventSink, StoredEvent } from "../src/types.js";

/** Yazılanları toplayan sahte depo; `fail` ile hata, `hold` ile bekleyen yazma üretir. */
export function fakeSink() {
  const batches: StoredEvent[][] = [];
  let failing = false;
  let holding = false;
  let release: (() => void) | undefined;
  const sink: EventSink = {
    async write(events) {
      if (holding) await new Promise<void>((resolve) => (release = resolve));
      if (failing) throw new Error("sink down");
      batches.push([...events]);
    },
  };
  return {
    sink,
    batches,
    written: () => batches.flat(),
    fail: (value: boolean) => {
      failing = value;
    },
    hold: () => {
      holding = true;
    },
    release: () => {
      holding = false;
      release?.();
      release = undefined;
    },
  };
}

export function storedEvents(count: number): StoredEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    projectId: "p1",
    receivedAt: i + 1,
    sdk: "0.1.1",
    ctx: { sid: "0123456789abcdef", path: "/", env: "production", device: "desktop", sr: 1 },
    event: { t: "pageview", ts: i + 1 },
  }));
}
