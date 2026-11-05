const LOCAL_HOST_HEADER = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * İstek bu makinedeki bir sayfadan mı geliyor? Bilgisayarda açık herhangi bir site toplayıcıya istek atmayı
 * deneyebilir; başlık yoksa veya `null` ise de reddedilir. Not: Origin tarayıcı dışından sahte gönderilebilir,
 * ama toplayıcıya sadece bu makineden ulaşılır.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase();
  return LOCAL_HOST_HEADER.test(hostname) || hostname.endsWith(".localhost");
}

/** DNS rebinding'e karşı: kötü niyetli bir alan adı 127.0.0.1'e çözülse de `Host` başlığı o alan adı kalır. */
export function isLocalHost(host: string | undefined): boolean {
  return host !== undefined && LOCAL_HOST_HEADER.test(host);
}
