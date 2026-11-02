import "../vitalscope.js";

// Tıklama ana thread'i 400 ms bloklar: INP ≥ 400 ms.
document.getElementById("buy")?.addEventListener("click", () => {
  const end = performance.now() + 400;
  while (performance.now() < end) {
    // bilerek meşgul bekleme
  }
});
