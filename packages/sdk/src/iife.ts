import { captureError, disable, flush, init, setRoute, track, type Config } from "./index.js";

// Script etiketi sürümü (`dist/vitalscope.iife.js`). Tek global tanımlar: dondurulmuş `window.vitalscope`.
// Etikette `data-key` ve `data-endpoint` varsa kendiliğinden başlar:
// <script async src=".../vitalscope.iife.js" integrity="sha384-…" crossorigin="anonymous"
//         data-key="pk_…" data-endpoint="https://…/v1/e"></script>

const ENVIRONMENTS: readonly string[] = ["production", "preview", "development"];

const api = Object.freeze({ init, track, captureError, setRoute, flush, disable });

// İkinci kez yüklenirse ilk kopya geçerli kalır; mevcut bir `vitalscope` ezilmez.
if (!("vitalscope" in window)) Object.defineProperty(window, "vitalscope", { value: api, enumerable: true });

const script = document.currentScript;
const data = script instanceof HTMLScriptElement ? script.dataset : undefined;
if (data?.key && data.endpoint) {
  const config: Config = { key: data.key, endpoint: data.endpoint };
  if (data.release) config.release = data.release;
  if (data.environment && ENVIRONMENTS.includes(data.environment)) {
    config.environment = data.environment as NonNullable<Config["environment"]>;
  }
  init(config);
}
