import { LIMITS } from "@vitalscope/protocol";

/**
 * `main>div.kart>img#hero` gibi seçici: sadece etiket, id ve sınıf; metin içeriği asla alınmaz.
 * id'li bir elemana ulaşınca veya 100 karakter dolunca durur.
 */
export function getSelector(node: Node | null | undefined): string | undefined {
  let element = node && node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement;
  let selector = "";
  while (element && element.localName !== "html") {
    const classes = [...element.classList].map((name) => `.${name}`).join("");
    const part = element.localName + (element.id ? `#${element.id}` : "") + classes;
    const next = selector ? `${part}>${selector}` : part;
    if (next.length > LIMITS.maxSelectorLength) {
      if (!selector) selector = part.slice(0, LIMITS.maxSelectorLength);
      break;
    }
    selector = next;
    if (element.id) break;
    element = element.parentElement;
  }
  return selector || undefined;
}
