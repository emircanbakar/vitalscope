import "../vitalscope.js";

// İçeriğin üstüne geç gelen banner kullanıcı etkileşimi olmadan kaydırır: CLS > 0,1.
setTimeout(() => {
  const banner = document.createElement("div");
  banner.style.height = "300px";
  banner.style.background = "#fc6";
  banner.textContent = "Kampanya!";
  document.body.prepend(banner);
}, 500);
