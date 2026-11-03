declare const __IIFE_INTEGRITY__: string;

// Etiket, CDN kurulumundaki gibi data özellikleriyle eklenir; endpoint testin çalıştırma kimliğini taşır.
const run = (globalThis as { __vitalscopeRun?: string }).__vitalscopeRun ?? "manual";
const tamper = new URLSearchParams(location.search).has("tamper");

const script = document.createElement("script");
script.async = true;
script.src = "/iife/vitalscope.iife.js";
script.integrity = tamper ? "sha384-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" : __IIFE_INTEGRITY__;
script.crossOrigin = "anonymous";
script.dataset.key = "pk_3f9a0c1d2e4b5a6978c0d1e2";
script.dataset.endpoint = `http://127.0.0.1:4174/v1/e/${run}`;
script.dataset.environment = "development";
script.addEventListener("load", () => (document.body.dataset.sdk = "loaded"));
script.addEventListener("error", () => (document.body.dataset.sdk = "blocked"));
document.head.append(script);
