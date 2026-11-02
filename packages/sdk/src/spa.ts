type HistoryMethod = "pushState" | "replaceState";

/**
 * SPA rota değişimlerini izler; `onChange` URL değiştikten sonra çağrılır. Durdurma fonksiyonu döner.
 * Navigation API varsa yerleşik fonksiyonlara hiç dokunulmaz.
 */
export function watchRoutes(onChange: () => void): () => void {
  const navigation = (globalThis as { navigation?: EventTarget }).navigation;
  if (navigation) {
    // pushState/replaceState, geri/ileri ve router navigasyonlarının hepsinde URL değiştikten sonra tetiklenir.
    navigation.addEventListener("currententrychange", onChange);
    return () => navigation.removeEventListener("currententrychange", onChange);
  }

  const unwrap = (["pushState", "replaceState"] as const).map((name) => wrap(name, onChange));
  addEventListener("popstate", onChange);
  return () => {
    for (const restore of unwrap) restore();
    removeEventListener("popstate", onChange);
  };
}

/** Orijinal fonksiyon `this`, argümanlar ve dönüş değeriyle birebir çağrılır; hata fırlatırsa aynen iletilir. */
function wrap(name: HistoryMethod, onChange: () => void): () => void {
  const original = history[name];
  const wrapped = function (this: History, ...args: Parameters<History[HistoryMethod]>) {
    const result = original.apply(this, args);
    onChange();
    return result;
  };
  history[name] = wrapped;
  // Bizden sonra başka biri sarmaladıysa onun sarmalaması bozulmasın diye geri alınmaz.
  return () => {
    if (history[name] === wrapped) history[name] = original;
  };
}
