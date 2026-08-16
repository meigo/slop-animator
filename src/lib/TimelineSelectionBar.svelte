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
  import { isLayerEditable } from "../anim/document";
  import { anyEditablePasteTarget } from "../anim/timeline-block";

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

  // Every mutating action skips locked/hidden rows, so on an all-read-only selection they would
  // silently do nothing. Disable them instead — Copy stays (reading a locked row is fine).
  const anyEditable = $derived(
    !!rect &&
      rect.layerIds.some((id) => {
        const l = appState.project.layers.find((x) => x.id === id);
        return !!l && isLayerEditable(l, appState.project.groups);
      }),
  );
  const readOnlyTitle = " — selection is on locked/hidden layers";
  // Paste stamps at (active layer, playhead), not the selection — a read-only selection can
  // still paste onto a writable active layer, and an editable selection cannot if the dest is inert.
  const pasteTargetOk = $derived(anyEditablePasteTarget(appState.project, appState.activeLayerId));
  const canPaste = $derived(!!appState.cellClipboard && pasteTargetOk);
  /** Why a bar action is currently refused, appended to its title= so the status bar can say it.
   *  Read-only outranks an empty clipboard: it is the harder block, and matches the status-hint
   *  precedence elsewhere (a hint for the more fundamental refusal first). */
  const why = (needsClipboard: boolean) =>
    !anyEditable
      ? readOnlyTitle
      : needsClipboard && !appState.cellClipboard
        ? " — nothing copied yet"
        : "";
  const whyPaste = $derived(
    !pasteTargetOk
      ? " — no writable layer at or below the active layer"
      : !appState.cellClipboard
        ? " — nothing copied yet"
        : "",
  );

  let x = $state(0);
  let y = $state(0);
  let barEl = $state<HTMLElement | null>(null);

  // Anchor the bar. The grid wrapper clips vertically (overflow-x:auto forces overflow-y:auto), so
  // the bar must stay inside its visible band. Prefer ABOVE the top selected row; if that clips at
  // the top, drop BELOW the bottom selected row; if neither fits (a selection taller than the
  // viewport), pin it inside. A final clamp guarantees the whole bar is visible on both edges.
  function place() {
    if (!container || !rect) return;
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
  }

  // Re-place whenever the selection or the document changes (rows can move) — AND on every scroll of
  // the container. The clamp above is computed FROM `scrollTop`/`clientHeight`, which no reactive
  // dependency tracks: without the listener it was computed once and never again, so scrolling after
  // selecting left the bar glued to a stale position, ending up under the ruler or out of view.
  // Reading barEl re-runs the effect once the bar mounts so its measured height corrects the
  // first-frame estimate.
  $effect(() => {
    if (!container || !rect) return;
    // read appState.version so the effect re-runs on structural changes
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    appState.version;
    void barEl;
    place();
    const el = container;
    const onScroll = () => place();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  });

  // `aria-disabled`, NOT `disabled`: a disabled button dispatches no pointer events, so App.svelte's
  // delegated pointerover/pointerdown hint can never read its title= — the control that most needs
  // to explain its refusal would be the only one structurally unable to. aria-disabled keeps the
  // dimmed, inert look while still speaking on hover and on an iPad tap. Every handler below is
  // guarded to match, since the button stays clickable and keyboard-activatable.
  const btn =
    "w-6 h-6 rounded flex items-center justify-center text-text hover:bg-surface-hover aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent";
</script>

{#if rect}
  <!-- z-45: ABOVE the sticky ruler row (z-35) and the gutter resize grip (z-40). At z-30 the ruler
       painted over this bar and — having no pointer-events:none — swallowed its taps, so pressing
       Copy/Cut/Paste/Delete scrubbed the playhead instead. Reachable immediately whenever a
       selection is taller than the viewport, since the fallback placement is `viewTop + 2`, which is
       exactly the ruler's band. -->
  <div
    bind:this={barEl}
    class="absolute z-45 flex items-center gap-0.5 rounded border border-border bg-surface px-1 py-0.5 shadow"
    style="left: {x}px; top: {y}px;"
    role="toolbar"
    aria-label="Selection actions"
  >
    <button class={btn} title="Copy" onclick={copyTimelineSelection}><Copy size={14} /></button>
    <button
      class={btn}
      title={"Cut" + why(false)}
      aria-disabled={!anyEditable}
      onclick={() => {
        if (anyEditable) cutTimelineSelection();
      }}><Scissors size={14} /></button
    >
    <button
      class={btn}
      title={"Paste (overwrite)" + whyPaste}
      aria-disabled={!canPaste}
      onclick={() => {
        if (canPaste) pasteCells(false);
      }}><ClipboardPaste size={14} /></button
    >
    <button
      class={btn}
      title={"Paste insert" + whyPaste}
      aria-disabled={!canPaste}
      onclick={() => {
        if (canPaste) pasteCells(true);
      }}><Rows3 size={14} /></button
    >
    <button
      class={btn}
      title={"Delete" + why(false)}
      aria-disabled={!anyEditable}
      onclick={() => {
        if (anyEditable) deleteTimelineSelection();
      }}><Trash2 size={14} /></button
    >
    <button class={btn} title="Clear selection" onclick={clearTimelineSelection}
      ><X size={14} /></button
    >
  </div>
{/if}
