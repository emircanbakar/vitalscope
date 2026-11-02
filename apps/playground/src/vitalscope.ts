import { init } from "@vitalscope/sdk";

/**
 * Olaylar yerel sahte ingest'e gider (`e2e/ingest-server.ts`). Testler her sayfaya kendi çalıştırma
 * kimliğini verir, böylece paralel testlerin olayları karışmaz; elle gezinmede `manual` kullanılır.
 */
const run = (globalThis as { __vitalscopeRun?: string }).__vitalscopeRun ?? "manual";

init({
  key: "pk_3f9a0c1d2e4b5a6978c0d1e2",
  endpoint: `http://127.0.0.1:4174/v1/e/${run}`,
  environment: "development",
});
