/**
 * Chromium tek renkli (düşük entropili) görselleri LCP adayı saymaz; rastgele pikselli bir görsel üretilir.
 * 400×200 piksel, sayfadaki metinden büyük olduğu için LCP öğesi olur.
 */
export function noiseImage(): HTMLImageElement {
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 200;
  const ctx = canvas.getContext("2d");
  const img = document.createElement("img");
  img.width = 400;
  img.height = 200;
  img.alt = "";
  if (!ctx) return img;
  const pixels = ctx.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 65536) {
    crypto.getRandomValues(pixels.data.subarray(i, Math.min(i + 65536, pixels.data.length)));
  }
  for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255;
  ctx.putImageData(pixels, 0, 0);
  img.src = canvas.toDataURL("image/png");
  return img;
}

/** Ana thread'i verilen süre boyunca bilerek meşgul eder. */
export function busyWait(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // bilerek meşgul bekleme
  }
}
