import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  // HTTPS only when requested (dev:lan): the Clipboard API needs a secure context, so an iPad
  // reaching the LAN dev server must use https. localhost (`npm run dev`) is already secure.
  plugins: [svelte(), tailwindcss(), ...(process.env.HTTPS ? [basicSsl()] : [])],
  test: {
    passWithNoTests: true,
  },
});
