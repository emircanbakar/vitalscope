import { init } from "@vitalscope/sdk/attribution";
import { config } from "../config.js";
import { busyWait } from "../noise-image.js";

init(config);

// LCP: sayfadaki görsel; CLS: içeriğin üstüne geç gelen banner; INP: takılan buton.
setTimeout(() => {
  const banner = document.createElement("div");
  banner.id = "banner";
  banner.style.height = "200px";
  banner.textContent = "Kampanya!";
  document.getElementById("content")?.before(banner);
}, 500);
document.getElementById("buy")?.addEventListener("click", () => busyWait(150));
