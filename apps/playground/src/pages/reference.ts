import "../vitalscope.js";
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";
import { busyWait, noiseImage } from "../noise-image.js";

// web-vitals sadece burada, karşılaştırma için kullanılır; SDK'ya girmez.
const results: Record<string, number> = {};
(globalThis as { __webVitals?: Record<string, number> }).__webVitals = results;
const save = (metric: Metric) => {
  results[metric.name] = metric.value;
};
for (const on of [onCLS, onFCP, onINP, onLCP, onTTFB]) on(save);

// Her metrik için ölçülecek bir şey olur: geç gelen görsel (LCP), üstte beliren banner (CLS) ve takılan buton (INP).
setTimeout(() => {
  document.getElementById("hero")?.append(noiseImage());
}, 300);
setTimeout(() => {
  const banner = document.createElement("div");
  banner.style.height = "200px";
  banner.textContent = "Kampanya!";
  document.body.prepend(banner);
}, 600);
document.getElementById("buy")?.addEventListener("click", () => busyWait(150));
