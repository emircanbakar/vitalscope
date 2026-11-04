import type { ClickHouseClient } from "@clickhouse/client";
import { toRows } from "./rows.js";
import type { EventSink } from "./types.js";

const SETTINGS = {
  // Toplu yazmayı tampon yapar; tekilleştirme de bloğun tamponun verdiği biçimde kalmasına dayanır.
  async_insert: 0,
  // Eşi olmayan surrogate geçerli bir JS dizgisidir (şemadan geçer); tek olay yüzünden parti reddedilmesin.
  input_format_json_throw_on_bad_escape_sequence: 0,
} as const;

/**
 * Tablo başına tek insert. Biri hata verirse parti yeniden denenir; yazılmış tabloların
 * aynı blokları `non_replicated_deduplication_window` sayesinde ikinci kez kaydedilmez.
 */
export function createClickHouseSink(client: ClickHouseClient): EventSink {
  return {
    async write(events) {
      const inserts = Object.entries(toRows(events)).filter(([, values]) => values.length > 0);
      await Promise.all(inserts.map(([table, values]) => client.insert({ table, values, format: "JSONEachRow", clickhouse_settings: SETTINGS })));
    },
  };
}
