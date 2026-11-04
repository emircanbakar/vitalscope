/**
 * `Origin` başlığı projenin izinli alan adlarından biri mi? Liste elemanları alan adıdır:
 * `ecbakar.com` tam eşleşir, `*.ecbakar.com` sadece alt alan adlarıyla eşleşir (`ecbakar.com` ile değil).
 * Başlık yoksa veya `null` ise reddedilir. Not: Origin tarayıcı dışından sahte gönderilebilir; bu kontrol
 * başka sitelerin yanlışlıkla veri göndermesini engeller, kötü niyetli kullanıcıyı değil.
 */
export function isAllowedOrigin(origin: string | undefined, allowed: readonly string[]): boolean {
  if (!origin) return false;
  let hostname: string;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowed.some((entry) => {
    const pattern = entry.toLowerCase();
    return pattern.startsWith("*.") ? hostname.endsWith(pattern.slice(1)) : hostname === pattern;
  });
}
