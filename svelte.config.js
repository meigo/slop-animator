import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
  // All components are runes-mode; enforce it so a future component can't silently reintroduce
  // legacy coarse reactivity (the scrub-jitter deep_read_state regression).
  compilerOptions: { runes: true },
};
