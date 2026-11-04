import type { EventSink, StoredEvent } from "./types.js";

const DEFAULTS = {
  flushIntervalMs: 1_000,
  flushAt: 5_000,
  /** Sınır dolunca yeni olaylar düşürülür; servis bellek taşmasıyla çökmez. */
  maxSize: 50_000,
  maxBackoffMs: 30_000,
};

/** Kapanışta yeniden denemeler daha sık yapılır: tanınan süre kısadır. */
const DRAIN_RETRY_MS = 100;

function sleep(ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  const done = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { done, cancel: () => clearTimeout(timer) };
}

export type BufferOptions = Partial<typeof DEFAULTS>;

export interface EventBuffer {
  /** Kabul edilen olay sayısını döner; sınırı aşanlar düşürülür. */
  add(events: readonly StoredEvent[]): number;
  /** Tamponu bir kez yazmayı dener. Yazma sürüyorsa onun bitmesini bekler. */
  flush(): Promise<void>;
  /** Düzenli yazmayı durdurur ve tamponu süre dolana kadar boşaltmaya çalışır; kaybolan olay sayısını döner. */
  drain(timeoutMs: number): Promise<number>;
  stats(): { size: number; dropped: number };
}

/**
 * Olayları bellekte biriktirip toplu yazar: ClickHouse çok sayıda küçük insert'i sevmez.
 * Süreç çökerse tampondaki en fazla ≈ 1 saniyelik veri kaybolur; izleme verisi için kabul edilen risk.
 * Yazma hata verirse olaylar tampona döner ve üstel geri çekilmeyle yeniden denenir.
 */
export function createEventBuffer(sink: EventSink, options: BufferOptions = {}): EventBuffer {
  const { flushIntervalMs, flushAt, maxSize, maxBackoffMs } = { ...DEFAULTS, ...options };
  let queue: StoredEvent[] = [];
  let dropped = 0;
  let failures = 0;
  let inFlight: Promise<void> | undefined;
  let writing = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let draining = false;

  function schedule(delay: number) {
    if (draining || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, delay);
    // Bekleyen zamanlayıcı süreci tek başına ayakta tutmaz.
    timer.unref();
  }

  function flush(): Promise<void> {
    if (inFlight) return inFlight;
    clearTimeout(timer);
    timer = undefined;
    if (queue.length === 0) return Promise.resolve();

    const batch = queue;
    queue = [];
    writing = batch.length;
    inFlight = Promise.resolve()
      .then(() => sink.write(batch))
      .then(
        () => {
          failures = 0;
        },
        () => {
          failures++;
          // Önce yazılamayanlar gelir; arada gelenlerle sınır aşılırsa fazlası düşürülür.
          const merged = [...batch, ...queue];
          dropped += Math.max(merged.length - maxSize, 0);
          queue = merged.slice(0, maxSize);
        },
      )
      .finally(() => {
        inFlight = undefined;
        writing = 0;
        // Yazma sürerken eklenen olayın zamanlayıcısı geri çekilme süresini kısaltmasın.
        clearTimeout(timer);
        timer = undefined;
        if (queue.length > 0) schedule(failures ? Math.min(flushIntervalMs * 2 ** failures, maxBackoffMs) : flushIntervalMs);
      });
    return inFlight;
  }

  return {
    add(events) {
      const accepted = events.slice(0, Math.max(maxSize - queue.length, 0));
      dropped += events.length - accepted.length;
      queue.push(...accepted);
      // Geri çekilme sırasında sınıra ulaşmak yeni deneme başlatmaz; bekleme süresi korunur.
      if (queue.length >= flushAt && failures === 0) void flush();
      else schedule(flushIntervalMs);
      return accepted.length;
    },
    flush,
    async drain(timeoutMs) {
      draining = true;
      clearTimeout(timer);
      timer = undefined;
      const deadline = Date.now() + timeoutMs;
      for (let remaining = timeoutMs; remaining > 0 && (inFlight || queue.length > 0); remaining = deadline - Date.now()) {
        const expired = sleep(remaining);
        await Promise.race([flush(), expired.done]);
        expired.cancel();
        remaining = deadline - Date.now();
        if (failures > 0 && queue.length > 0 && remaining > 0) await sleep(Math.min(DRAIN_RETRY_MS * 2 ** failures, remaining)).done;
      }
      // Süre dolarken yazılmakta olanların sonucu bilinmez; onlar da kayıp sayılır.
      const lost = queue.length + writing;
      dropped += lost;
      queue = [];
      return lost;
    },
    stats: () => ({ size: queue.length, dropped }),
  };
}
