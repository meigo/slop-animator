<script lang="ts">
  import { onMount } from "svelte";
  import {
    state as appState,
    pressureCurve,
    bumpCurve,
    activeLayer,
    selectionActions,
  } from "../state/appState.svelte";
  import { isIdentityTransform } from "../anim/document";
  import { createCurveEditor } from "../core/pressure-curve";
  import { clickOutside } from "./click-outside";
  import { Spline, Copy, Scissors, ClipboardPaste, Trash2 } from "@lucide/svelte";

  const SIZE_PRESETS = [0.5, 1, 2, 4, 8, 16, 32, 60];

  const stroke = $derived(appState.tool === "eraser" ? appState.eraser : appState.brush);

  let curveOpen = $state(false);
  let curvePopupEl: HTMLDivElement = $state()!;
  let curveEditor: (HTMLElement & { redraw: () => void }) | null = null;

  onMount(() => {
    curveEditor = createCurveEditor(pressureCurve, bumpCurve);
  });

  // Re-attach the curve editor whenever the popup div is (re)created — it lives inside the brush/eraser
  // {#if} branch, so it's torn down/recreated on tool switches. appendChild moves the single node into
  // the current div.
  $effect(() => {
    if (curvePopupEl && curveEditor) curvePopupEl.appendChild(curveEditor);
  });

  // Keep the popup within the viewport: it's left-anchored to its trigger, but the toolbar
  // wraps, so the trigger can sit near the right (or left) edge. Shift it back into view.
  // The popup is position:fixed (so it escapes the ToolOptions bar's overflow-x-auto clip). Anchor it
  // just below its trigger wrapper in viewport coords, then clamp horizontally into view.
  function positionPopup() {
    if (!curvePopupEl) return;
    const margin = 8;
    const anchor = curvePopupEl.parentElement?.getBoundingClientRect();
    if (!anchor) return;
    curvePopupEl.style.top = `${anchor.bottom + 4}px`;
    curvePopupEl.style.left = `${anchor.left}px`;
    const rect = curvePopupEl.getBoundingClientRect();
    const overflowRight = rect.right - (window.innerWidth - margin);
    if (overflowRight > 0) curvePopupEl.style.left = `${anchor.left - overflowRight}px`;
    else if (anchor.left < margin) curvePopupEl.style.left = `${margin}px`;
  }

  // Redraw the editor whenever its popup opens, so it reflects the current (e.g. restored) curve,
  // then reposition once it's laid out (next frame) so it can't open off-screen.
  $effect(() => {
    if (curveOpen) {
      curveEditor?.redraw();
      requestAnimationFrame(positionPopup);
    }
  });
</script>

<div
  class="flex items-center gap-2 px-2 h-10 border-b border-border bg-surface text-text overflow-x-auto"
>
  {#if appState.tool === "brush" || appState.tool === "eraser"}
    {#if appState.tool === "eraser"}<span class="text-xs text-amber-500">Eraser</span>{/if}
    <label class="flex items-center gap-1 text-sm text-text-secondary"
      >Size
      <input type="range" min="0.5" max="60" step="0.5" bind:value={stroke.size} />
      <input
        class="w-12 text-xs bg-surface border border-border rounded px-1 text-text"
        type="number"
        min="0.5"
        max="60"
        step="0.5"
        bind:value={stroke.size}
        title="Brush size"
      />
    </label>
    <div class="flex items-center gap-0.5" title="Size presets">
      {#each SIZE_PRESETS as preset (preset)}
        <button
          class="px-1 text-xs rounded text-text-secondary hover:bg-surface-hover tabular-nums"
          class:bg-surface-active={stroke.size === preset}
          onclick={() => (stroke.size = preset)}>{preset}</button
        >
      {/each}
    </div>
    <label
      class="flex items-center gap-1 text-sm text-text-secondary"
      title="How much pen pressure widens the stroke"
      >Press
      <input type="range" min="1" max="8" step="0.5" bind:value={stroke.sizeRange} />
      <span class="text-xs text-text-secondary w-6">{stroke.sizeRange}×</span>
    </label>
    <select
      class="h-7 border border-border rounded bg-surface text-text-secondary text-xs px-1"
      bind:value={stroke.brushType}
      title="Brush type"
    >
      <option value="smooth">Smooth</option>
      <option value="ink">Ink</option>
      <option value="pencil">Pencil</option>
      <option value="charcoal">Charcoal</option>
      <option value="airbrush">Airbrush</option>
    </select>
    <label class="flex items-center gap-1 text-xs text-text-secondary"
      >Opacity
      <input type="range" min="1" max="100" class="w-16" bind:value={stroke.opacity} />
    </label>
    <label class="flex items-center gap-1 text-xs text-text-secondary"
      >Smooth
      <input type="range" min="0" max="100" class="w-16" bind:value={stroke.smoothing} />
    </label>
    <label class="flex items-center gap-1 text-xs text-text-secondary"
      >Stream
      <input type="range" min="0" max="100" class="w-16" bind:value={stroke.streamline} />
    </label>
    <label class="flex items-center gap-1 text-xs text-text-secondary" title="Taper stroke ends">
      <input type="checkbox" bind:checked={stroke.taper} /> Taper
    </label>
    {#if appState.tool !== "eraser"}
      <label
        class="flex items-center gap-1 text-xs text-text-secondary"
        title="Paint behind existing pixels (e.g. white fill under a black outline)"
      >
        <input type="checkbox" bind:checked={stroke.drawBehind} /> Behind
      </label>
    {/if}
    <div class="relative" use:clickOutside={() => (curveOpen = false)}>
      <button
        class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
        class:bg-surface-active={curveOpen}
        title="Pressure curve"
        onclick={() => (curveOpen = !curveOpen)}
      >
        <Spline size={18} />
      </button>
      <div class="curve-popup" class:open={curveOpen} bind:this={curvePopupEl}></div>
    </div>
    {#if appState.tool !== "eraser"}<input type="color" bind:value={appState.brush.color} />{/if}
  {:else if appState.tool === "fill"}
    <label class="flex items-center gap-1 text-xs text-text-secondary" title="Fill color tolerance"
      >Tolerance
      <input type="range" min="0" max="128" class="w-24" bind:value={appState.fill.tolerance} />
      <span class="text-xs w-6 tabular-nums">{appState.fill.tolerance}</span>
    </label>
    <label
      class="flex items-center gap-1 text-xs text-text-secondary"
      title="Grow the filled region (px)"
      >Expand
      <input type="range" min="0" max="8" class="w-16" bind:value={appState.fill.expand} />
      <span class="text-xs w-4 tabular-nums">{appState.fill.expand}</span>
    </label>
    <input type="color" bind:value={appState.brush.color} title="Fill color" />
  {:else if appState.tool === "select" || appState.tool === "lasso"}
    {@const btn =
      "w-9 h-9 rounded border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover disabled:opacity-40 disabled:cursor-default"}
    <button
      class={btn}
      title="Copy (Cmd/Ctrl+C)"
      disabled={!appState.selectionActive}
      onclick={() => selectionActions.copy?.()}><Copy size={16} /></button
    >
    <button
      class={btn}
      title="Cut (Cmd/Ctrl+X)"
      disabled={!appState.selectionActive}
      onclick={() => selectionActions.cut?.()}><Scissors size={16} /></button
    >
    <button
      class={btn}
      title="Paste (Cmd/Ctrl+V)"
      disabled={!appState.hasPixelClipboard}
      onclick={() => selectionActions.paste?.()}><ClipboardPaste size={16} /></button
    >
    <button
      class={btn}
      title="Delete (Del)"
      disabled={!appState.selectionActive}
      onclick={() => selectionActions.del?.()}><Trash2 size={16} /></button
    >
    {#if activeLayer().kind === "draw" && !isIdentityTransform(activeLayer().transform)}
      <span class="text-xs text-amber-500" title="Selection is disabled on a transformed layer"
        >Apply layer transform to select</span
      >
    {/if}
  {:else if appState.tool === "transform"}
    {@const _activeLayer = activeLayer()}
    {@const _groupedActive = _activeLayer.groupId != null}
    <div class="flex rounded border border-border overflow-hidden text-xs" title="Transform scope">
      <button
        class="px-2 py-1"
        class:bg-surface-active={appState.transformScope === "frame"}
        onclick={() => (appState.transformScope = "frame")}>Frame</button
      >
      <button
        class="px-2 py-1"
        class:bg-surface-active={appState.transformScope === "layer"}
        onclick={() => (appState.transformScope = "layer")}>Layer</button
      >
      <button
        class="px-2 py-1"
        class:bg-surface-active={appState.transformScope === "group"}
        class:opacity-40={!_groupedActive}
        class:cursor-not-allowed={!_groupedActive}
        disabled={!_groupedActive}
        title={_groupedActive ? "Transform the group" : "Active layer is not in a group"}
        onclick={() => _groupedActive && (appState.transformScope = "group")}>Group</button
      >
    </div>
  {:else if appState.tool === "deform"}
    <span class="text-xs text-text-muted"
      >Drag the grid handles on the canvas · FFD/Rigid in the selection bar</span
    >
  {:else}
    <span class="text-xs text-text-muted"></span>
  {/if}
</div>
