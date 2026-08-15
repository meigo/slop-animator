import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  // HTTPS only when requested (dev:lan): the Clipboard API needs a secure context, so an iPad
  // reaching the LAN dev server must use https. localhost (`npm run dev`) is already secure.
  plugins: [svelte(), tailwindcss(), ...(process.env.HTTPS ? [basicSsl()] : [])],
  test: {
    passWithNoTests: true,
    // The superpowers workflow puts git worktrees under .worktrees/ INSIDE the repo, each with its
    // own src/ — without this, a live worktree silently doubles the suite (37 files/458 tests became
    // 74/916), and the README and CLAUDE.md both quote a count that is supposed to be measured.
    // Spread the defaults rather than replacing them: `exclude` overrides, it does not merge.
    exclude: [...configDefaults.exclude, "**/.worktrees/**"],
  },
});
