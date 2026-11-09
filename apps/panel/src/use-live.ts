import { createContext, useEffect, useState } from "react";

/** Art arda gelen yazımlarda en sık bu aralıkla yeniden çekilir. */
const MIN_REFRESH_MS = 2000;
const SHARED_NAME = "vitalscope-live";

export type LiveStatus = "connecting" | "live" | "offline";
type Message = LiveStatus | "change" | "hello";

/** Her değişimde artar; `useData` bu değere bağlı olarak yeniden çeker. */
export const LiveVersion = createContext(0);

/**
 * Tarayıcı aynı adrese en fazla 6 bağlantı açar; toplayıcı SDK'nın olaylarını da aynı adresten alır.
 * Her sekme kendi akışını açsa altıncı panel sekmesi hem paneli hem SDK'yı kilitlerdi. Bu yüzden akışı
 * kilidi alan tek sekme tutar, diğerlerine haber verir. O sekme kapanınca kilit sıradakine geçer.
 */
export function useLive() {
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<LiveStatus>("connecting");

  useEffect(() => {
    const channel = new BroadcastChannel(SHARED_NAME);
    const locks = new AbortController();
    let source: EventSource | undefined;
    let current: LiveStatus = "connecting";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastRefresh = 0;
    let releaseLock: (() => void) | undefined;

    const send = (message: Message) => channel.postMessage(message);

    function refresh() {
      if (timer !== undefined) return;
      const wait = lastRefresh + MIN_REFRESH_MS - Date.now();
      if (wait > 0) {
        timer = setTimeout(() => {
          timer = undefined;
          refresh();
        }, wait);
        return;
      }
      lastRefresh = Date.now();
      setVersion((value) => value + 1);
    }

    function publish(next: LiveStatus) {
      current = next;
      setStatus(next);
      send(next);
    }

    function announceChange() {
      refresh();
      send("change");
    }

    channel.onmessage = ({ data }: MessageEvent<Message>) => {
      if (data === "change") refresh();
      // Yeni açılan sekme durumu sorar; sadece akışı tutan yanıtlar.
      else if (data === "hello") {
        if (source) send(current);
      } else setStatus(data);
    };
    send("hello");

    navigator.locks
      .request(SHARED_NAME, { signal: locks.signal }, () => {
        source = new EventSource("/api/live");
        source.addEventListener("open", () => {
          publish("live");
          // Bağlantı yokken gelen veriler kaçmış olabilir.
          announceChange();
        });
        source.addEventListener("change", announceChange);
        // Tarayıcı kendisi yeniden bağlanmayı dener.
        source.addEventListener("error", () => publish("offline"));
        return new Promise<void>((resolve) => (releaseLock = resolve));
      })
      // Sekme kilit sırasındayken kapanırsa istek iptal edilir.
      .catch(() => {});

    return () => {
      locks.abort();
      source?.close();
      releaseLock?.();
      channel.close();
      clearTimeout(timer);
    };
  }, []);

  return { version, status };
}
