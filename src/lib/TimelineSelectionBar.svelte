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
  let barEl = $state<HTMLElement | null>(null);

  // Recompute the anchor whenever the selection or the document changes (rows can move/scroll).
  // The grid wrapper clips vertically (overflow-x:auto forces overflow-y:auto), so the bar must stay
  // inside its visible band. Prefer ABOVE the top selected row; if that clips at the top, drop BELOW
  // the bottom selected row; if neither fits (a selection taller than the viewport), pin it inside.
  // A final clamp guarantees the whole bar is visible on both edges. Reading barEl re-runs the effect
  // once the bar mounts so its measured height corrects the first-frame estimate.
  $effect(() => {
    if (!container || !rect) return;
    // read appState.version so the effect re-runs on structural changes
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    appState.version;
    const cRect = container.getBoundingClientRect();
    const topEl = container.querySelector<HTMLElement>(`[data-layer-id="${rect.layerIds[0]}"]`);
    if (!topEl) return;
    const tRect = topEl.getBoundingClientRect();
    // rowEl starts at the grid's left edge (after the sticky label), so its left already includes labelW.
    x = tRect.left - cRect.left + container.scrollLeft + rect.startFrame * cellW;

    const bottomId = rect.layerIds[rect.layerIds.length - 1];
    const bottomEl = container.querySelector<HTMLElement>(`[data-layer-id="${bottomId}"]`);
    const bRect = (bottomEl ?? topEl).getBoundingClientRect();

    const barH = barEl?.offsetHeight ?? 28;
    const rowTop = tRect.top - cRect.top + container.scrollTop; // top of the top selected row (content px)
    const rowBottom = bRect.top - cRect.top + container.scrollTop + bRect.height; // bottom of bottom row
    const viewTop = container.scrollTop;
    const viewBottom = container.scrollTop + container.clientHeight;

    const aboveTop = rowTop - barH - 2;
    const belowTop = rowBottom + 2;
    let top: number;
    if (aboveTop >= viewTop)
      top = aboveTop; // room above → sit above the selection
    else if (belowTop + barH <= viewBottom)
      top = belowTop; // else below if it fits inside
    else top = viewTop + 2; // taller than the viewport → pin near the top (overlaps the selection)
    y = Math.max(viewTop, Math.min(top, viewBottom - barH)); // clamp fully into the visible band
    void labelW; // labelW reserved for future absolute layouts; keep the prop stable
  });

  const btn =
    "w-6 h-6 rounded flex items-center justify-center text-text hover:bg-surface-hover disabled:opacity-40 disabled:cursor-default";
</script>

{#if rect}
  <div
    bind:this={barEl}
    class="absolute z-30 flex items-center gap-0.5 rounded border border-border bg-surface px-1 py-0.5 shadow"
    style="left: {x}px; top: {y}px;"
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
