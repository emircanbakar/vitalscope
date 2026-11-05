import { captureError, disable, flush, init, setRoute, track, type Config } from "./index.js";

// Script etiketi sürümü (`dist/vitalscope.iife.js`). Tek global tanımlar: dondurulmuş `window.vitalscope`.
// Kendiliğinden başlar; ayarlar isteğe bağlı `data-*` özelliklerinden okunur. `data-manual` varsa `init()` beklenir:
// <script async src=".../vitalscope.iife.js" integrity="sha384-…" crossorigin="anonymous"></script>

const ENVIRONMENTS: readonly string[] = ["production", "preview", "development"];

const api = Object.freeze({ init, track, captureError, setRoute, flush, disable });

// İkinci kez yüklenirse ilk kopya geçerli kalır; mevcut bir `vitalscope` ezilmez.
if (!("vitalscope" in window)) Object.defineProperty(window, "vitalscope", { value: api, enumerable: true });

const script = document.currentScript;
const data = script instanceof HTMLScriptElement ? script.dataset : undefined;
if (data && data.manual === undefined) {
  const config: Config = {};
  if (data.key) config.key = data.key;
  if (data.endpoint) config.endpoint = data.endpoint;
  if (data.release) config.release = data.release;
  if (data.environment && ENVIRONMENTS.includes(data.environment)) {
    config.environment = data.environment as NonNullable<Config["environment"]>;
  }
  init(config);
}
