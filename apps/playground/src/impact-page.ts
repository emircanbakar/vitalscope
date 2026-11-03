import { busyWait, noiseImage } from "./noise-image.js";

// SDK'lı ve SDK'sız sayfanın ortak içeriği: tek fark SDK'nın yüklenip yüklenmemesi.
document.getElementById("hero")?.append(noiseImage());
document.getElementById("buy")?.addEventListener("click", () => busyWait(100));
