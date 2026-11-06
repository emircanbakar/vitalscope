const encoder = new TextEncoder();
/** Yorum satırı: yanıt başlıklarının hemen gitmesini sağlar, tarayıcı bağlantıyı açık sayar. */
const OPENED = encoder.encode(": connected\n\n");
const CHANGE = encoder.encode("event: change\ndata: \n\n");

export interface Live {
  /** Yeni veri yazıldı; açık panellere haber verir. */
  notify(): void;
  /** Sunucu olayları akışı. Sadece "değişti" der, veri taşımaz: panel normal API'den yeniden çeker. */
  stream(): Response;
  /** Açık akışları kapatır; yoksa sunucunun kapanışı onları beklerdi. */
  close(): void;
  readonly connections: number;
}

export function createLive(): Live {
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  return {
    notify() {
      for (const stream of streams) stream.enqueue(CHANGE);
    },
    stream() {
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          streams.add(c);
          c.enqueue(OPENED);
        },
        cancel() {
          streams.delete(controller);
        },
      });
      // Akış bitince bağlantı da kapanmalı; canlı kalırsa kapanış, zorla kapatma süresini bekler.
      return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", Connection: "close" } });
    },
    close() {
      for (const stream of streams) stream.close();
      streams.clear();
    },
    get connections() {
      return streams.size;
    },
  };
}
