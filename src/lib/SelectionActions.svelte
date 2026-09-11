<script lang="ts">
  import { onMount } from "svelte";
  import {
    Move,
    SquareDashed,
    Grid3x3,
    FlipHorizontal2,
    FlipVertical2,
    Check,
    X,
  } from "@lucide/svelte";
  import type { Selection } from "../core/selection";
  import type { Viewport } from "../core/viewport";
  import { computeAnchor } from "../core/selection-anchor";
  import { state as appState, activeLayer } from "../state/appState.svelte";
  import { whyNotEditable } from "../anim/document";
  import { editBlockLabel } from "./status-hint";

  // Selection/viewport are read through getters and polled each frame — they are created
  // in the parent's onMount (after this child mounts), so direct props would be undefined.
  let {
    getSelection,
    getViewport,
    getContainer,
    onTransform,
    onDistort,
    onMesh,
    onFlip,
    onCommit,
    onCancel,
    onDensify,
    onSetDeformMode,
    onResetPins,
  }: {
    getSelection: () => Selection | null;
    getViewport: () => Viewport | null;
    getContainer: () => HTMLElement | null;
    onTransform: () => void;
    onDistort: () => void;
    onMesh: () => void;
    onFlip: (axis: "h" | "v") => void;
    onCommit: () => void;
    onCancel: () => void;
    onDensify: (delta: number) => void;
    onSetDeformMode: (m: "ffd" | "rigid") => void;
    onResetPins: () => void;
  } = $props();

  const MARGIN = 12;
  let panelEl: HTMLDivElement;
  let visible = $state(false);
  let mode = $state<"selected" | "transforming" | "warping">("selected");
  let warp = $state({ rows: 2, cols: 2 });
  let deformMode = $state<"ffd" | "rigid">("ffd");
  let pos = $state({ x: 0, y: 0 });
  let rafId = 0;

  function tick() {
    const selection = getSelection();
    const viewport = getViewport();
    const containerEl = getContainer();
    if (panelEl && containerEl && selection && viewport) {
      const bounds = selection.getScreenBounds();
      if (!bounds || selection.isDragging) {
        visible = false;
      } else {
        mode = selection.state as "selected" | "transforming" | "warping";
        warp = { rows: selection.warpRows, cols: selection.warpCols };
        deformMode = selection.deformMode;
        const wsRect = containerEl.getBoundingClientRect();
        const panelRect = panelEl.getBoundingClientRect();
        const a = computeAnchor({
          bboxDoc: bounds,
          docToScreen: (p) => {
            const s = viewport.canvasToScreen(p.x, p.y);
            return { x: s.x - wsRect.left, y: s.y - wsRect.top };
          },
          panelSize: { w: panelRect.width || 180, h: panelRect.height || 40 },
          viewport: { w: containerEl.clientWidth, h: containerEl.clientHeight },
          margin: MARGIN,
        });
        pos = { x: a.x, y: a.y };
        visible = true;
      }
    } else {
      visible = false;
    }
    rafId = requestAnimationFrame(tick);
  }

  onMount(() => {
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  });

  const transformActive = $derived(mode === "transforming");
  const distortActive = $derived(mode === "warping" && warp.rows === 2 && warp.cols === 2);
  const meshActive = $derived(mode === "warping" && (warp.rows !== 2 || warp.cols !== 2));
  const liftBlock = $derived(whyNotEditable(activeLayer(), appState.project.groups));
  // Only the lift tools (transform / distort / mesh) are blocked. Deselect stays live.
  const liftBlocked = $derived(liftBlock !== null && mode === "selected");
  const liftBlockLabel = $derived(liftBlock ? editBlockLabel(liftBlock) : "");

  // stopPropagation is not enough on its own: Svelte 5 delegates pointerdown to the
  // document, so the stage's native bubble listener in setupInput fires first and
  // would treat this tap as "click outside → cancel the selection". setupInput
  // filters `.selection-actions-panel`; keep both.
  function tap(handler: () => void) {
    return (e: PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      handler();
    };
  }
</script>

<div
  bind:this={panelEl}
  class="selection-actions-panel absolute z-30 flex flex-col items-stretch gap-1 p-1 rounded-lg bg-surface border border-border shadow-md"
  style="left: {pos.x}px; top: {pos.y}px; opacity: {visible ? 1 : 0}; pointer-events: {visible
    ? 'auto'
    : 'none'}; touch-action: none;"
>
  <div class="flex items-center gap-1">
    <!-- Free transform stays in the bar once lifted, shown ACTIVE like Distort/Mesh below, rather than
         disappearing: every button after it used to slide one slot left on the lift, so a second tap on
         Flip horizontal (which lifts) landed on Flip vertical. Positions must not shift under the pen. -->
    <button
      class="size-10 rounded-md border flex items-center justify-center aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-surface"
      class:bg-accent={transformActive}
      class:text-accent-text={transformActive}
      class:border-accent={transformActive}
      class:bg-surface={!transformActive}
      class:text-text-secondary={!transformActive}
      class:border-border={!transformActive}
      class:hover:bg-surface-hover={!transformActive}
      aria-disabled={liftBlocked}
      onpointerdown={tap(() => {
        if (!liftBlocked && mode === "selected") onTransform();
      })}
      title={liftBlocked ? liftBlockLabel : "Free transform"}
    >
      <Move size={18} />
    </button>
    <button
      class="size-10 rounded-md border flex items-center justify-center aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-surface"
      class:bg-accent={distortActive}
      class:text-accent-text={distortActive}
      class:border-accent={distortActive}
      class:bg-surface={!distortActive}
      class:text-text-secondary={!distortActive}
      class:border-border={!distortActive}
      aria-disabled={liftBlocked}
      onpointerdown={tap(() => {
        if (!liftBlocked) onDistort();
      })}
      title={liftBlocked ? liftBlockLabel : "Distort (4-corner)"}
    >
      <SquareDashed size={18} />
    </button>
    <button
      class="size-10 rounded-md border flex items-center justify-center aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-surface"
      class:bg-accent={meshActive}
      class:text-accent-text={meshActive}
      class:border-accent={meshActive}
      class:bg-surface={!meshActive}
      class:text-text-secondary={!meshActive}
      class:border-border={!meshActive}
      aria-disabled={liftBlocked}
      onpointerdown={tap(() => {
        if (!liftBlocked) onMesh();
      })}
      title={liftBlocked ? liftBlockLabel : "Mesh warp (3×3)"}
    >
      <Grid3x3 size={18} />
    </button>
    {#if mode !== "warping"}
      <!-- Flip: mirrors the float about its own centre. On a plain selection it lifts first (the same
           lift as Free transform, so the same block applies), so you see the handles on the flipped
           result; ✓ or a click outside commits it. Hidden in Distort/Mesh, which have their own grid. -->
      <div class="w-px h-6 bg-border mx-0.5"></div>
      {#each [{ axis: "h", title: "Flip horizontal" }, { axis: "v", title: "Flip vertical" }] as const as f (f.axis)}
        <button
          class="size-10 rounded-md border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-surface"
          aria-disabled={liftBlocked}
          onpointerdown={tap(() => {
            if (!liftBlocked) onFlip(f.axis);
          })}
          title={liftBlocked ? liftBlockLabel : f.title}
        >
          {#if f.axis === "h"}<FlipHorizontal2 size={18} />{:else}<FlipVertical2 size={18} />{/if}
        </button>
      {/each}
    {/if}
    {#if mode === "warping"}
      <button
        class="px-2 py-1 text-xs border border-border rounded bg-surface"
        title="Less detail"
        onpointerdown={tap(() => onDensify(-1))}>−</button
      >
      <span class="text-xs text-text-secondary tabular-nums">{warp.rows}×{warp.cols}</span>
      <button
        class="px-2 py-1 text-xs border border-border rounded bg-surface"
        title="More detail"
        onpointerdown={tap(() => onDensify(1))}>+</button
      >
      <div class="flex rounded border border-border overflow-hidden text-xs">
        <button
          class="px-2 py-1"
          class:ui-on={deformMode === "ffd"}
          onpointerdown={tap(() => onSetDeformMode("ffd"))}>FFD</button
        >
        <button
          class="px-2 py-1"
          class:ui-on={deformMode === "rigid"}
          onpointerdown={tap(() => onSetDeformMode("rigid"))}>Rigid</button
        >
      </div>
      {#if deformMode === "rigid"}
        <button
          class="px-2 py-1 text-xs border border-border rounded bg-surface"
          title="Clear pinned handles"
          onpointerdown={tap(onResetPins)}>Reset pins</button
        >
      {/if}
    {/if}
    {#if mode === "selected"}
      <!-- A dimmed ✓ holds the slot Commit takes once lifted. The bar is CENTRED on the selection, so
           a bar that gains a button on the lift re-centres and every button slides ~half a slot:
           Flip lifts, so a second tap on the same Flip button missed it. Same width in both states
           keeps positions still under the pen. -->
      <div class="w-px h-6 bg-border mx-0.5"></div>
      <button
        class="size-10 rounded-md border border-border bg-surface text-text-secondary flex items-center justify-center opacity-40 cursor-default"
        aria-disabled="true"
        tabindex="-1"
        title="Commit — nothing lifted yet"
      >
        <Check size={18} />
      </button>
      <!-- Deselect: the bar is the ONLY reachable deselect while a paint tool is active (the
         ToolOptions Deselect shows for select/lasso, tap-outside draws instead, Esc needs a
         keyboard) — and a selection clips brush/eraser/fill, so a forgotten one is confusing. -->
      <button
        class="size-10 rounded-md border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover"
        onpointerdown={tap(onCancel)}
        title="Deselect (Esc)"
      >
        <X size={18} />
      </button>
    {/if}
    {#if mode !== "selected"}
      <div class="w-px h-6 bg-border mx-0.5"></div>
      <button
        class="size-10 rounded-md border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover"
        onpointerdown={tap(onCommit)}
        title="Commit"
      >
        <Check size={18} />
      </button>
      <button
        class="size-10 rounded-md border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover"
        onpointerdown={tap(onCancel)}
        title="Cancel"
      >
        <X size={18} />
      </button>
    {/if}
  </div>
  {#if liftBlocked}
    <p class="text-xs text-warn px-1 pb-0.5 text-center max-w-56">{liftBlockLabel}</p>
  {/if}
</div>
