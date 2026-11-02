"use client";

import { useEffect, type ReactNode } from "react";
import { init, setRoute, type Config } from "./index.js";

export interface VitalscopeProviderProps {
  config: Config;
  /** Mevcut sayfanın rota şablonu, örn. `/urun/[id]`; router state'inden hesaplanmalıdır. */
  route?: string | undefined;
  children?: ReactNode;
}

/**
 * Her React uygulamasında çalışır: `init`'i bir kez çağırır, `route` verilirse her render'da bildirir.
 * Rota değişince SDK şablonu sıfırladığı için şablon aynı kalsa bile (`/urun/1` → `/urun/2`) yeniden bildirilir.
 */
export function VitalscopeProvider({ config, route, children }: VitalscopeProviderProps): ReactNode {
  // İkinci init çağrısı SDK tarafından yok sayılır; config sonradan değişirse etkisi olmaz.
  useEffect(() => {
    init(config);
  }, []);
  useEffect(() => {
    if (route !== undefined) setRoute(route);
  });
  return children;
}
