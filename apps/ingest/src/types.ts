import type { Context, Event } from "@vitalscope/protocol";

/** Tamponda ve depoda tek satırlık olay; bağlam her olaya kopyalanır. */
export interface StoredEvent {
  /** Toplayıcının olayı aldığı an (epoch ms). */
  receivedAt: number;
  sdk: string;
  ctx: Context;
  event: Event;
}

/** Olayların yazıldığı yer. Tampon arkasında durur. */
export interface EventSink {
  write(events: readonly StoredEvent[]): Promise<void>;
}
