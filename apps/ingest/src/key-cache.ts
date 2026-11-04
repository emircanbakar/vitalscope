import type { Project, ResolveKey } from "./types.js";

const DEFAULT_TTL_MS = 60_000;
/** Rastgele anahtar saldırısı önbelleği de büyütemesin diye üst sınır. */
const DEFAULT_MAX_ENTRIES = 10_000;

interface CacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

/**
 * Anahtar çözümlemeyi süreli önbelleğe alır. "Anahtar yok" sonucu da saklanır, böylece rastgele anahtar
 * saldırısı veritabanını yormaz. Kaynak hata verirse sonuç saklanmaz, hata çağırana geçer.
 */
export function cacheKeys(resolve: ResolveKey, options: CacheOptions = {}): ResolveKey {
  const { ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES, now = Date.now } = options;
  const entries = new Map<string, { project: Project | null; expiresAt: number }>();

  return async (key) => {
    const cached = entries.get(key);
    if (cached && cached.expiresAt > now()) return cached.project;
    const project = await resolve(key);
    entries.delete(key);
    // Map ekleme sırasını korur: ilk anahtar en eski kayıttır.
    if (entries.size >= maxEntries) entries.delete(entries.keys().next().value!);
    entries.set(key, { project, expiresAt: now() + ttlMs });
    return project;
  };
}
