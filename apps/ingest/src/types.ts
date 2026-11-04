import type { Context, Event } from "@vitalscope/protocol";

/** Public key'in bağlı olduğu proje; sadece ingest'in ihtiyaç duyduğu alanlar. */
export interface Project {
  id: string;
  allowedOrigins: readonly string[];
}

/** `pk_…` → proje. Anahtar geçersiz veya iptal edilmişse `null`. */
export type ResolveKey = (key: string) => Promise<Project | null>;

/** Tamponda ve depoda tek satırlık olay; bağlam her olaya kopyalanır. */
export interface StoredEvent {
  projectId: string;
  /** Sunucunun olayı aldığı an (epoch ms). */
  receivedAt: number;
  sdk: string;
  ctx: Context;
  event: Event;
}

/** Olayların yazıldığı yer. Tampon arkasında durur; ClickHouse veya başka bir kuyruk olabilir. */
export interface EventSink {
  write(events: readonly StoredEvent[]): Promise<void>;
}
