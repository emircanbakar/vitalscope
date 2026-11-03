import "../vitalscope.js";
import { noiseImage } from "../noise-image.js";

// Sayfanın en büyük öğesi 3 sn sonra gelir: LCP ≥ 3000 ms, "needs-improvement".
setTimeout(() => {
  document.getElementById("hero")?.append(noiseImage());
}, 3000);
