import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/dist/**",
      "**/coverage/**",
      "**/storybook-static/**",
      "**/next-env.d.ts",
      "scripts/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.tsx"],
    ...reactHooks.configs.flat.recommended
  },
  {
    files: ["**/*.tsx"],
    ...jsxA11y.flatConfigs.recommended
  },
  {
    // Service worker: runs in a ServiceWorkerGlobalScope, not window.
    files: ["apps/web/public/**/*.js"],
    languageOptions: {
      globals: {
        self: "readonly",
        caches: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Request: "readonly",
        clients: "readonly"
      }
    }
  },
  eslintConfigPrettier
);
