<script lang="ts">
  import { Copy, Scissors, ClipboardPaste, Rows3, Trash2, X } from "@lucide/svelte";
  import {
    state as appState,
    copyTimelineSelection,
    cutTimelineSelection,
    pasteCells,
    deleteTimelineSelection,
    clearTimelineSelection,
  } from "../state/appState.svelte";
  import type { SelectionRect } from "../anim/timeline-selection";

  // The bar anchors to the top-left selected cell. `container` is the timeline's positioned
  // (relative) scroll wrapper; `rect` is the derived selection. `cellW`/`labelW` size the grid.
  let {
    container,
    rect,
    cellW,
    labelW,
  }: {
    container: HTMLElement | null;
    rect: SelectionRect | null;
    cellW: number;
    labelW: number;
  } = $props();

  let x = $state(0);
  let y = $state(0);

  // Recompute the anchor whenever the selection or the document changes (rows can move/scroll).
  $effect(() => {
    if (!container || !rect) return;
    // read appState.version so the effect re-runs on structural changes
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    appState.version;
    const topId = rect.layerIds[0];
    const rowEl = container.querySelector<HTMLElement>(`[data-layer-id="${topId}"]`);
    if (!rowEl) return;
    const cRect = container.getBoundingClientRect();
    const rRect = rowEl.getBoundingClientRect();
    // rowEl starts at the grid's left edge (after the sticky label), so its left already includes labelW.
    x = rRect.left - cRect.left + container.scrollLeft + rect.startFrame * cellW;
    y = rRect.top - cRect.top + container.scrollTop;
    void labelW; // labelW reserved for future absolute layouts; keep the prop stable
  });

  const btn =
    "w-6 h-6 rounded flex items-center justify-center text-text hover:bg-surface-hover disabled:opacity-40 disabled:cursor-default";
</script>

{#if rect}
  <div
    class="absolute z-30 flex items-center gap-0.5 rounded border border-border bg-surface px-1 py-0.5 shadow"
    style="left: {x}px; top: {y}px; transform: translateY(-100%);"
    role="toolbar"
    aria-label="Selection actions"
  >
    <button class={btn} title="Copy" onclick={copyTimelineSelection}><Copy size={14} /></button>
    <button class={btn} title="Cut" onclick={cutTimelineSelection}><Scissors size={14} /></button>
    <button
      class={btn}
      title="Paste (overwrite)"
      disabled={!appState.cellClipboard}
      onclick={() => pasteCells(false)}><ClipboardPaste size={14} /></button
    >
    <button
      class={btn}
      title="Paste insert"
      disabled={!appState.cellClipboard}
      onclick={() => pasteCells(true)}><Rows3 size={14} /></button
    >
    <button class={btn} title="Delete" onclick={deleteTimelineSelection}
      ><Trash2 size={14} /></button
    >
    <button class={btn} title="Clear selection" onclick={clearTimelineSelection}
      ><X size={14} /></button
    >
  </div>
{/if}
