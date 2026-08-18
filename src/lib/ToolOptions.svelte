<script lang="ts">
  import { onMount } from "svelte";
  import { animateTargetGroup, animateTargetLayer } from "./transform-target";
  import {
    state as appState,
    pressureCurve,
    bumpCurve,
    activeLayer,
    selectionActions,
    transformActions,
    fillActions,
    animateLayer,
    removeLayerAnimation,
    animateGroup,
    removeGroupAnimation,
  } from "../state/appState.svelte";

  import { createCurveEditor } from "../core/pressure-curve";
  import { clickOutside } from "./click-outside";
  import { Spline, Copy, Scissors, ClipboardPaste, Trash2, MousePointerBan } from "@lucide/svelte";
  import { whyNotEditable, layerTransformTrack } from "../anim/document";
  import TrackKeyControls from "./TrackKeyControls.svelte";
  import { editBlockLabel } from "./status-hint";
  import { MAX_GAP } from "../core/fill-holes";

  const WRITING_TOOLS = ["brush", "eraser", "fill", "deform", "pose", "transform"];
  const editBlock = $derived(whyNotEditable(activeLayer(), appState.project.groups));
  // Selection bar already carries this caption when a marquee is up — don't double it.
  const showEditBlock = $derived(
    editBlock !== null &&
      WRITING_TOOLS.includes(appState.tool) &&
      !appState.selectionActive &&
      !appState.selectionFloating,
  );

  // Whose transform the Animate controls act on — see `animateTargetLayer` in the module script
  // above, which StatusBar shares so the controls and the status hint cannot drift apart.
  const animTarget = $derived(
    animateTargetLayer(
      appState.project.layers.find((x) => x.id === appState.activeLayerId),
      appState.project.groups,
      appState.tool,
      appState.transformScope,
      appState.playhead,
      appState.project.fps,
    ),
  );
  // At GROUP scope the drag writes the group's transform, so the layer predicate above is right to
  // return null and this is who the key belongs to. Without it `animateGroup`/`removeGroupAnimation`
  // would have no caller at all and a group track could never be created.
  const animGroup = $derived(
    animateTargetGroup(
      appState.project.layers.find((x) => x.id === appState.activeLayerId),
      appState.project.groups,
      appState.project.layers,
      appState.tool,
      appState.transformScope,
    ),
  );

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
  {#if showEditBlock && editBlock}
    <span class="text-xs text-amber-500 shrink-0">{editBlockLabel(editBlock)}</span>
  {/if}
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
        class="size-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
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
    <label
      class="flex items-center gap-1 text-xs text-text-secondary"
      title="Bridge breaks in the outline before filling, up to about twice this many pixels"
      >Gap
      <input type="range" min="0" max={MAX_GAP} class="w-16" bind:value={appState.fill.gap} />
      <span class="text-xs w-4 tabular-nums">{appState.fill.gap}</span>
    </label>
    <button
      class="h-7 px-2 rounded border border-border bg-surface text-text-secondary text-xs hover:bg-surface-hover hover:text-text"
      title="Fill every area enclosed by the outline, behind the strokes"
      onclick={() => fillActions.allEnclosed?.()}>Fill enclosed</button
    >
    <input type="color" bind:value={appState.brush.color} title="Fill color" />
  {:else if appState.tool === "select" || appState.tool === "lasso"}
    <!-- aria-disabled, NOT disabled: a disabled button dispatches no pointer events, so the status
         bar's delegated title= hint can never reach it — see CLAUDE.md's 2026-08-12 entry. Handlers
         are guarded to match, since the button stays clickable and keyboard-activatable. -->
    {@const btn =
      "w-9 h-9 rounded border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-surface"}
    {@const noSel = appState.selectionActive ? "" : " — select an area first"}
    {@const noClip = appState.hasPixelClipboard ? "" : " — nothing copied yet"}
    {@const canDeselect = appState.selectionActive || appState.selectionFloating}
    <button
      class={btn}
      title={"Copy (Cmd/Ctrl+C)" + noSel}
      aria-disabled={!appState.selectionActive}
      onclick={() => {
        if (appState.selectionActive) selectionActions.copy?.();
      }}><Copy size={16} /></button
    >
    <button
      class={btn}
      title={"Cut (Cmd/Ctrl+X)" + noSel}
      aria-disabled={!appState.selectionActive}
      onclick={() => {
        if (appState.selectionActive) selectionActions.cut?.();
      }}><Scissors size={16} /></button
    >
    <button
      class={btn}
      title={"Paste (Cmd/Ctrl+V)" + noClip}
      aria-disabled={!appState.hasPixelClipboard}
      onclick={() => {
        if (appState.hasPixelClipboard) selectionActions.paste?.();
      }}><ClipboardPaste size={16} /></button
    >
    <button
      class={btn}
      title={"Delete (Del)" + noSel}
      aria-disabled={!appState.selectionActive}
      onclick={() => {
        if (appState.selectionActive) selectionActions.del?.();
      }}><Trash2 size={16} /></button
    >
    <button
      class={btn}
      title={canDeselect
        ? "Deselect (Esc) — drops the selection; reverts an in-progress move"
        : "Deselect (Esc) — nothing selected"}
      aria-disabled={!canDeselect}
      onclick={() => {
        if (canDeselect) selectionActions.deselect?.();
      }}><MousePointerBan size={16} /></button
    >
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
        aria-disabled={!_groupedActive}
        title={_groupedActive ? "Transform the group" : "Active layer is not in a group"}
        onclick={() => {
          if (_groupedActive) appState.transformScope = "group";
        }}>Group</button
      >
    </div>
  {:else if appState.tool === "deform"}
    <span class="text-xs text-text-muted"
      >Drag the grid handles on the canvas · FFD/Rigid in the selection bar</span
    >
  {:else}
    <span class="text-xs text-text-muted"></span>
  {/if}
  <!-- Outside the per-tool branches on purpose: a REFERENCE layer's gizmo is live under EVERY tool,
       so gating this on the Transform tool would leave a moved reference unresettable. It appears
       only when a gizmo is up AND its transform is non-identity — a Reset that would do nothing is
       worse than no button (2026-08-15). -->
  {#if appState.canResetTransform}
    <button
      class="h-7 px-2 rounded border border-border bg-surface text-text-secondary text-xs hover:bg-surface-hover hover:text-text"
      title="Reset the current transform back to fit"
      onclick={() => transformActions.reset?.()}>Reset to fit</button
    >
  {/if}
  <!-- Animate / Delete key / Stop animating / interpolation. Vanishes (rather than disabling) for a
       locked or hidden layer: a locked/hidden active layer already gets a top-precedence status-bar
       hint and its transform gizmo doesn't render at all, so a visible-but-disabled Animate button
       would point at chrome that isn't there — see task-8 report for the full reasoning. -->
  {#if animTarget}
    {@const track = layerTransformTrack(animTarget)}
    {#if !track}
      <button
        class="h-7 shrink-0 whitespace-nowrap px-2 rounded border border-border bg-surface text-text-secondary text-xs hover:bg-surface-hover hover:text-text"
        title="Animate this layer's transform — its current position becomes a key at frame 0"
        onclick={() => animateLayer(animTarget.id)}>Animate</button
      >
    {:else}
      <!-- The key controls are shared with every other animated property (see `TrackKeyControls`).
           Copy/Paste stay transform-only, so this is the one host that asks for them.
           `animateTargetLayer` has already refused a locked or hidden layer, so there is no
           `blocked` reason to pass. -->
      <TrackKeyControls
        trackRef={{ owner: "layer", id: animTarget.id, prop: "transform" }}
        showCopyPaste
      />
      <button
        class="h-7 shrink-0 whitespace-nowrap px-2 rounded border border-border bg-surface text-text-secondary text-xs hover:bg-surface-hover hover:text-text"
        title="Stop animating — keeps the position you can see now"
        onclick={() => removeLayerAnimation(animTarget.id)}>Stop animating</button
      >
    {/if}
  {/if}
  <!-- Group scope: the same controls, one level out. No Copy/Paste — the clipboard holds a
       LAYER-relative transform key, so pasting one onto a group is a separate design (see
       `TrackKeyControls`). Guarded on LOCK alone, not lock-plus-hidden: `activeTransformLayer` returns
       its layer unconditionally at group scope so a hidden or locked anchor cannot veto a group
       drag, so a hidden group is draggable — refusing to animate what you may still drag would be
       the inconsistency. See `animateTargetGroup`. -->
  {#if animGroup}
    {#if !animGroup.tracks?.transform}
      <button
        class="h-7 shrink-0 whitespace-nowrap px-2 rounded border border-border bg-surface text-text-secondary text-xs hover:bg-surface-hover hover:text-text"
        title="Animate this group's transform — its current position becomes a key at frame 0"
        onclick={() => animateGroup(animGroup.id)}>Animate</button
      >
    {:else}
      <TrackKeyControls trackRef={{ owner: "group", id: animGroup.id, prop: "transform" }} />
      <button
        class="h-7 shrink-0 whitespace-nowrap px-2 rounded border border-border bg-surface text-text-secondary text-xs hover:bg-surface-hover hover:text-text"
        title="Stop animating — keeps the position you can see now"
        onclick={() => removeGroupAnimation(animGroup.id)}>Stop animating</button
      >
    {/if}
  {/if}
</div>
