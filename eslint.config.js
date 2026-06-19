import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import svelteConfig from "./svelte.config.js";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-constant-condition": "warn",
      "prefer-const": "warn",
    },
  },
  {
    // TypeScript parsing for `<script lang="ts">` + runes awareness via svelte.config.js.
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".svelte"],
        svelteConfig,
      },
    },
  },
  {
    rules: {
      // svelte-check owns Svelte compiler + a11y diagnostics — don't duplicate them in ESLint.
      "svelte/valid-compile": "off",
      // The Maps in this codebase (glyph cache, temp byId lookups) are intentional NON-reactive
      // caches — SvelteMap is not wanted here.
      "svelte/prefer-svelte-reactivity": "off",
      // SortableJS and pointer-capture deliberately touch the DOM (the {#key dragNonce} pattern
      // reconciles Svelte afterward).
      "svelte/no-dom-manipulating": "off",
    },
  },
  {
    // Core prefer-const mis-fires on runes destructures (`let { x } = $props()`, `let x = $state()`
    // legitimately need `let`); use the runes-aware svelte/prefer-const instead.
    files: ["**/*.svelte"],
    rules: { "prefer-const": "off", "svelte/prefer-const": "warn" },
  },
  // Disable rules that conflict with Prettier (must be after the rule configs).
  prettier,
  ...svelte.configs.prettier,
  {
    ignores: ["dist/"],
  },
);
