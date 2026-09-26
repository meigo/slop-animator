<script lang="ts">
  // One swatch showing the current colour, palette behind it — ported from slop-paint (fa213aa) so
  // the two apps pick colours the same way. Replaces the bare native picker, which on iPad opened
  // the system sheet for every change, even black to white.
  import { clickOutside } from "./click-outside";

  let { value, title, onPick }: { value: string; title: string; onPick: (color: string) => void } =
    $props();

  // Three rows of eight: neutrals, hues, then skin/earth tones and tints. `#1a1a1a` is the ink
  // black (the default brush and fill colour), so a fresh project shows its marker.
  const swatches = [
    { color: "#000000", name: "Black" },
    { color: "#1a1a1a", name: "Ink" },
    { color: "#4b4b4b", name: "Dark grey" },
    { color: "#808080", name: "Grey" },
    { color: "#b3b3b3", name: "Light grey" },
    { color: "#d9d9d9", name: "Pale grey" },
    { color: "#f5f0e6", name: "Paper" },
    { color: "#ffffff", name: "White" },
    { color: "#e53935", name: "Red" },
    { color: "#fb8c00", name: "Orange" },
    { color: "#fdd835", name: "Yellow" },
    { color: "#43a047", name: "Green" },
    { color: "#00897b", name: "Teal" },
    { color: "#1e88e5", name: "Blue" },
    { color: "#3949ab", name: "Indigo" },
    { color: "#8e24aa", name: "Purple" },
    { color: "#d81b60", name: "Pink" },
    { color: "#6d4c41", name: "Brown" },
    { color: "#a1887f", name: "Tan" },
    { color: "#f1c8a9", name: "Light skin" },
    { color: "#d7a17d", name: "Medium skin" },
    { color: "#8d5a3b", name: "Dark skin" },
    { color: "#90caf9", name: "Light blue" },
    { color: "#a5d6a7", name: "Light green" },
  ];

  let open = $state(false);
  // The eyedropper and saved projects may carry upper-case hex; the marker must still find it.
  const current = $derived(value.toLowerCase());
</script>

<div class="relative flex items-center" use:clickOutside={() => (open = false)}>
  <button
    class="size-7 shrink-0 rounded-md border-2 border-border transition-colors hover:border-text-muted"
    style:background={value}
    aria-haspopup="dialog"
    aria-expanded={open}
    onclick={() => (open = !open)}
    title="{title} — {value}"
  ></button>
  {#if open}
    <div
      class="absolute right-0 top-full z-30 mt-2 flex w-72 flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-md"
    >
      <div class="grid grid-cols-8 gap-1.5">
        {#each swatches as { color, name } (color)}
          <button
            class="aspect-square w-full cursor-pointer rounded-md border-2 transition-transform hover:scale-105 {color ===
            current
              ? 'border-accent'
              : 'border-border'}"
            style:background={color}
            title={name}
            onclick={() => onPick(color)}
          ></button>
        {/each}
      </div>
      <label class="flex items-center gap-2 text-xs text-text-secondary">
        Custom
        <input
          type="color"
          {value}
          oninput={(e) => onPick(e.currentTarget.value)}
          title="Pick any color"
        />
      </label>
    </div>
  {/if}
</div>
