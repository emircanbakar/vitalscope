import "../vitalscope.js";

// Üç rota değişimi: ilk yükleme dahil 4 pageview.
for (const path of ["/spa/a", "/spa/b", "/spa/c"]) history.pushState(null, "", path);
