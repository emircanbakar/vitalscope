const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_HEX = /\b(?=[a-f]*\d)(?:0x)?[0-9a-f]{8,}\b/gi;
const NUMBER = /\b\d+(?:\.\d+)?\b/g;
/** Bundler'ın dosya adına eklediği içerik özeti: `index-CyA1sY9x.js`, `main.a1b2c3d4.js`. */
const BUILD_HASH = /[-.]([\w-]{8,})(\.[cm]?js)$/;

/** Mesajdaki değişken kısımlar: "User 42 not found" ile "User 43 not found" aynı hatadır. */
function normalizeMessage(message: string) {
  return message.replace(UUID, "#").replace(LONG_HEX, "#").replace(NUMBER, "#");
}

/** Sunucu adresi, port, `?t=` gibi eklentiler ve build özeti düşer; kaynak aynıysa yol aynı kalır. */
function normalizePath(location: string) {
  let path: string;
  try {
    path = new URL(location).pathname;
  } catch {
    path = location.split(/[?#]/, 1)[0]!;
  }
  return path.replace(BUILD_HASH, (match, hash: string, extension: string) => (/[\dA-Z]/.test(hash) ? extension : match));
}

/** Chrome: `at fn (url:1:2)`, `at url:1:2`. Firefox ve Safari: `fn@url:1:2`, `@url:1:2`. Yeri olmayan satır (`map@[native code]`) kare sayılmaz. */
function parseFrame(frame: string) {
  let name = "";
  let location = frame;
  if (frame.startsWith("at ")) {
    const text = frame.slice(3).replace(/^async /, "");
    const call = /^(.*?) \((.+)\)$/.exec(text);
    [name, location] = call ? [call[1]!, call[2]!] : ["", text];
  } else if (!/^[a-z-]+:\/\//.test(frame) && frame.includes("@")) {
    const at = frame.indexOf("@");
    [name, location] = [frame.slice(0, at), frame.slice(at + 1)];
  }
  const position = /:\d+(?::\d+)?$/.exec(location);
  if (!position) return undefined;
  return {
    // Adsız fonksiyon her tarayıcıda başka yazılır: `HTMLButtonElement.<anonymous>`, `later/<`, boş.
    name: name.includes("<") ? "" : name,
    path: normalizePath(location.slice(0, position.index)),
  };
}

/**
 * Aynı hatanın olayları için ortak anahtar: tür, temizlenmiş mesaj ve uygulama kodundaki ilk kare.
 * Satır ve sütun bilerek dışarıda: kod düzenlenince kayar, tarayıcılar arasında da farklıdır.
 */
export function errorGroup(type: string, message: string, stack: readonly string[]) {
  const frames = stack.flatMap((frame) => parseFrame(frame) ?? []);
  const top = frames.find((frame) => !frame.path.includes("/node_modules/")) ?? frames[0];
  const location = top && (top.name ? `${top.name} (${top.path})` : top.path);
  return { key: JSON.stringify([type, normalizeMessage(message), location]), location };
}
