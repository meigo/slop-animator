<script lang="ts">
  import type { Snippet } from "svelte";
  import { clickOutside } from "./click-outside";

  // `children` receives a `close()` so menu items can dismiss the popover after acting.
  let { label, children }: { label: string; children: Snippet<[() => void]> } = $props();
  let open = $state(false);
  const close = () => (open = false);
</script>

<div class="relative" use:clickOutside={close}>
  <button
    class="h-8 px-2 rounded flex items-center gap-1 text-sm text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={open}
    onclick={() => (open = !open)}
  >
    {label}<span class="text-[10px] opacity-70">▾</span>
  </button>
  {#if open}
    <div
      class="absolute right-0 top-full mt-1 z-30 min-w-44 rounded border border-border bg-surface shadow-lg py-1"
      role="menu"
    >
      {@render children(close)}
    </div>
  {/if}
</div>
