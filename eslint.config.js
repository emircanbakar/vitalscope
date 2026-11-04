import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const HTML_SINK = "HTML dizgisinden DOM üretilmez: SDK başkalarının sayfasında çalışır ve DOM'a yazmaz.";

export default defineConfig([
  globalIgnores(["**/dist/", "**/coverage/", "**/.turbo/"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Kod çalıştıran ve HTML yazan API'ler yasak (SDK dokümanı, güvenli kodlama).
    // `no-implied-eval` zamanlayıcıları ancak global olarak tanıyorsa denetler.
    languageOptions: { globals: { setTimeout: "readonly", setInterval: "readonly" } },
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-properties": [
        "error",
        { object: "document", property: "write", message: HTML_SINK },
        { object: "document", property: "writeln", message: HTML_SINK },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "MemberExpression[property.name=/^(innerHTML|outerHTML|srcdoc)$/]", message: HTML_SINK },
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: HTML_SINK },
        { selector: "CallExpression[callee.property.name='createContextualFragment']", message: HTML_SINK },
        { selector: "CallExpression[callee.property.name='parseFromString']", message: HTML_SINK },
      ],
    },
  },
  {
    // Testler sayfayı kurmak için HTML yazabilir; kod çalıştıran API'ler burada da yasak kalır.
    files: ["**/test/**", "**/e2e/**"],
    rules: { "no-restricted-syntax": "off", "no-restricted-properties": "off" },
  },
]);
