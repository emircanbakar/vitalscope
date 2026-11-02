import "../vitalscope.js";

setTimeout(() => {
  throw new Error("sync boom");
});
void Promise.reject(new Error("async boom"));
// Aynı hatanın 100 tekrarı: fırtına koruması en fazla 5'ini gönderir.
for (let i = 0; i < 100; i++) {
  setTimeout(() => {
    throw new Error("repeat boom");
  });
}
