import "../vitalscope.js";

/**
 * Chromium tek renkli (düşük entropili) görselleri LCP adayı saymaz; rastgele pikselli bir görsel üretilir.
 * 400×200 piksel, sayfadaki metinden büyük olduğu için LCP öğesi olur.
 */
function noiseImage(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 200;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const pixels = ctx.createImageData(canvas.width, canvas.height);
  crypto.getRandomValues(pixels.data.subarray(0, 65536));
  for (let i = 65536; i < pixels.data.length; i += 65536) {
    crypto.getRandomValues(pixels.data.subarray(i, Math.min(i + 65536, pixels.data.length)));
  }
  for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255;
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
}

// Sayfanın en büyük öğesi 3 sn sonra gelir: LCP ≥ 3000 ms, "needs-improvement".
setTimeout(() => {
  const img = document.createElement("img");
  img.src = noiseImage();
  img.width = 400;
  img.height = 200;
  img.alt = "";
  document.getElementById("hero")?.append(img);
}, 3000);
