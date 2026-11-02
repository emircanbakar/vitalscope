import { init } from "@vitalscope/sdk";

/** Testler bu adrese giden istekleri `page.route` ile yakalar; gerçek bir sunucu yoktur. */
export const ENDPOINT = "https://ingest.playground.test/v1/e";

init({ key: "pk_3f9a0c1d2e4b5a6978c0d1e2", endpoint: ENDPOINT, environment: "development" });
