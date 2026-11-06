import { useEffect, useState } from "react";

/**
 * Filtre değişince önceki istek iptal edilir, geç gelen eski yanıt yenisini ezemez.
 * Yeni veri gelene kadar eski veri ekranda kalır; sayfa zıplamaz.
 */
export function useData<T>(url: string | undefined) {
  const [state, setState] = useState<{ data?: T; failed: boolean; loading: boolean }>({ failed: false, loading: url !== undefined });

  useEffect(() => {
    if (url === undefined) return;
    const controller = new AbortController();
    setState((current) => ({ ...current, failed: false, loading: true }));
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<T>;
      })
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, failed: false, loading: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState((current) => ({ ...current, failed: true, loading: false }));
      });
    return () => controller.abort();
  }, [url]);

  return state;
}
