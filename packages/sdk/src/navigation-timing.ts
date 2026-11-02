// TypeScript'in DOM kütüphanesinde henüz olmayan alanlar.
interface NavigationEntry extends PerformanceNavigationTiming {
  activationStart?: number;
}

export function getNavigationEntry(): NavigationEntry | undefined {
  return performance.getEntriesByType?.("navigation")[0] as NavigationEntry | undefined;
}

/** Prerender edilmiş sayfada sürelerin sıfır noktası aktivasyon anıdır. */
export function getActivationStart(): number {
  return getNavigationEntry()?.activationStart ?? 0;
}

export function isPrerendering(): boolean {
  return (document as Document & { prerendering?: boolean }).prerendering === true;
}
