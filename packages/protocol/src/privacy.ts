// Kişisel veri ve sır temizliği: SDK gönderirken, ingest ikinci kez (savunma derinliği) uygular.
// Sadece regex; runtime bağımlılığı yoktur.

export const REDACTED = "[redacted]";

/**
 * E-posta önce `@alan.adi` kısmından bulunur, yerel kısım sonra geriye doğru eklenir.
 * Tek regex (`[yerel]*@alan`) her konumdan yeniden taradığı için uzun girdilerde karesel yavaşlıyordu
 * (CodeQL js/polynomial-redos); bu yol doğrusal ve sonucu aynı.
 * Yerel kısım RFC 5322 karakterlerini kapsar; `/` hariç, yoksa path'in önceki parçalarını yutar.
 * Yerel kısım boş da olabilir: `/@a.co` gibi adreslerde en azından `@alan.adi` temizlenir.
 */
const EMAIL_DOMAIN = /@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi;
const EMAIL_LOCAL_CHAR = /[\w.!#$%&'*+=?^`{|}~-]/;

function replaceEmails(text: string, replacement: string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(EMAIL_DOMAIN)) {
    let start = match.index;
    while (start > last && EMAIL_LOCAL_CHAR.test(text.charAt(start - 1))) start--;
    out += text.slice(last, start) + replacement;
    last = match.index + match[0].length;
  }
  return out + text.slice(last);
}
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** JWT ve benzeri base64url token'lar `eyJ` ile başlar; kesilmiş parçalar da yakalanır. */
const JWT = /eyJ[\w-]{4,}(?:\.[\w-]*)*/g;
const BEARER = /\bBearer\s+[\w.~+/-]+=*/gi;
/** Kart numarası, kimlik numarası gibi uzun rakam dizileri. */
const LONG_NUMBER = /\d{13,}/g;
/** Hassas parametrelerin değerleri: URL'de `?token=…`, `&api_key=…`, serbest metinde `token=…`. */
const SECRET_PARAM =
  /(\b(?:access_token|id_token|refresh_token|token|api_?key|key|secret|password|passwd|pwd|auth|session(?:id)?|code|signature|sig)=)[^&#\s'"]*/gi;

const SCRUB_PASSES = 3;

/** Hata mesajı ve stack satırlarındaki e-posta, token ve uzun sayıları `[redacted]` ile değiştirir. */
export function scrubText(input: string): string {
  let text = input;
  // Bir değiştirme yeni bir eşleşme ortaya çıkarabilir; sonuç değişmeyene kadar tekrarlanır.
  for (let i = 0; i < SCRUB_PASSES; i++) {
    const next = replaceEmails(
      text.replace(SECRET_PARAM, `$1${REDACTED}`).replace(BEARER, REDACTED).replace(JWT, REDACTED),
      REDACTED,
    ).replace(LONG_NUMBER, REDACTED);
    if (next === text) break;
    text = next;
  }
  return text;
}

/**
 * Path'teki kişisel veriyi yer tutucuyla değiştirir: `/kullanici/a@b.com` → `/kullanici/[email]`.
 * 9+ haneli rakam dizileri (telefon, kart) `[number]` olur; kısa id'leri sunucu `[id]` ile gruplar.
 */
export function scrubPath(path: string): string {
  return replaceEmails(path, "[email]")
    .replace(UUID, "[uuid]")
    .replace(JWT, REDACTED)
    .replace(/\d{9,}/g, "[number]");
}
