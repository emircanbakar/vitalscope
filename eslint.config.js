import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/dist/", "**/coverage/", "**/.turbo/"]),
  js.configs.recommended,
  tseslint.configs.recommended,
]);
