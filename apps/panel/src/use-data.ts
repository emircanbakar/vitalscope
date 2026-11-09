import { useContext, useEffect, useRef, useState } from "react";
import { LiveVersion } from "./use-live.js";

/**
 * Filtre değişince önceki istek iptal edilir, geç gelen eski yanıt yenisini ezemez.
 * Yeni veri gelene kadar eski veri ekranda kalır; sayfa zıplamaz.
 *
 * Canlı yenilemede ekran soluklaşmaz, başarısız olursa da eski veri kalır: bu yenilemeyi kullanıcı istemedi.
 */
export function useData<T>(url: string | undefined) {
  const version = useContext(LiveVersion);
  const lastUrl = useRef<string>(undefined);
  const [state, setState] = useState<{ data?: T; failed: boolean; loading: boolean }>({ failed: false, loading: url !== undefined });

  useEffect(() => {
    if (url === undefined) return;
    const requested = lastUrl.current !== url;
    lastUrl.current = url;
    const controller = new AbortController();
    if (requested) setState((current) => ({ ...current, failed: false, loading: true }));
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<T>;
      })
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, failed: false, loading: false });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState((current) => (requested || current.data === undefined ? { ...current, failed: true, loading: false } : { ...current, loading: false }));
      });
    return () => controller.abort();
  }, [url, version]);

  return state;
}
