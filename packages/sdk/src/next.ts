"use client";

import { useParams, usePathname } from "next/navigation";
import { createElement, type ReactNode } from "react";
import type { Config } from "./index.js";
import { VitalscopeProvider as BaseProvider } from "./react.js";

type Params = Record<string, string | string[] | undefined>;

/**
 * Gerçek path'teki parametre değerlerini Next.js segment adlarıyla değiştirir:
 * `/urun/42` + `{ id: "42" }` → `/urun/[id]`, catch-all için `[...slug]`.
 */
export function toRouteTemplate(pathname: string, params: Params | null): string {
  const segments = pathname.split("/");
  for (const [name, value] of Object.entries(params ?? {})) {
    if (value === undefined) continue;
    const parts = Array.isArray(value) ? value : [value];
    if (parts.length === 0) continue;
    const label = Array.isArray(value) ? `[...${name}]` : `[${name}]`;
    const matches = (segment: string | undefined, part: string) =>
      segment === part || segment === encodeURIComponent(part);
    // Dinamik segmentler genelde sondadır; aynı değerli statik bir segmenti yanlışlıkla değiştirmemek için sağdan aranır.
    for (let i = segments.length - parts.length; i >= 1; i--) {
      if (parts.every((part, j) => matches(segments[i + j], part))) {
        segments.splice(i, parts.length, label);
        break;
      }
    }
  }
  return segments.join("/");
}

export interface VitalscopeProviderProps {
  config: Config;
  children?: ReactNode;
}

/** Next.js App Router için: rota şablonunu `usePathname` ve `useParams` ile kendisi çıkarır. */
export function VitalscopeProvider({ config, children }: VitalscopeProviderProps): ReactNode {
  const pathname = usePathname();
  const params = useParams<Params>();
  const route = pathname ? toRouteTemplate(pathname, params) : undefined;
  return createElement(BaseProvider, { config, route }, children);
}
