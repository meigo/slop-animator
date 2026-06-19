<script lang="ts">
  import { onMount } from "svelte";
  import { Move, SquareDashed, Grid3x3, Check, X } from "@lucide/svelte";
  import type { Selection } from "../core/selection";
  import type { Viewport } from "../core/viewport";
  import { computeAnchor } from "../core/selection-anchor";

  // Selection/viewport are read through getters and polled each frame — they are created
  // in the parent's onMount (after this child mounts), so direct props would be undefined.
  let {
    getSelection,
    getViewport,
    getContainer,
    onTransform,
    onDistort,
    onMesh,
    onCommit,
    onCancel,
  }: {
    getSelection: () => Selection | null;
    getViewport: () => Viewport | null;
    getContainer: () => HTMLElement | null;
    onTransform: () => void;
    onDistort: () => void;
    onMesh: () => void;
    onCommit: () => void;
    onCancel: () => void;
  } = $props();

  const MARGIN = 12;
  let panelEl: HTMLDivElement;
  let visible = $state(false);
  let mode = $state<"selected" | "transforming" | "warping">("selected");
  let warp = $state({ rows: 2, cols: 2 });
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

  const distortActive = $derived(mode === "warping" && warp.rows === 2 && warp.cols === 2);
  const meshActive = $derived(mode === "warping" && (warp.rows !== 2 || warp.cols !== 2));

  // Stop taps from bleeding through to the canvas (which would start a new selection).
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
  class="selection-actions-panel absolute z-30 flex items-center gap-1 p-1 rounded-lg bg-surface border border-border shadow-md"
  style="left: {pos.x}px; top: {pos.y}px; opacity: {visible ? 1 : 0}; pointer-events: {visible
    ? 'auto'
    : 'none'}; touch-action: none;"
>
  {#if mode === "selected"}
    <button
      class="w-10 h-10 rounded-md border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover"
      onpointerdown={tap(onTransform)}
      title="Free transform"
    >
      <Move size={18} />
    </button>
  {/if}
  <button
    class="w-10 h-10 rounded-md border flex items-center justify-center"
    class:bg-accent={distortActive}
    class:text-accent-text={distortActive}
    class:border-accent={distortActive}
    class:bg-surface={!distortActive}
    class:text-text-secondary={!distortActive}
    class:border-border={!distortActive}
    onpointerdown={tap(onDistort)}
    title="Distort (4-corner)"
  >
    <SquareDashed size={18} />
  </button>
  <button
    class="w-10 h-10 rounded-md border flex items-center justify-center"
    class:bg-accent={meshActive}
    class:text-accent-text={meshActive}
    class:border-accent={meshActive}
    class:bg-surface={!meshActive}
    class:text-text-secondary={!meshActive}
    class:border-border={!meshActive}
    onpointerdown={tap(onMesh)}
    title="Mesh warp (3×3)"
  >
    <Grid3x3 size={18} />
  </button>
  {#if mode !== "selected"}
    <div class="w-px h-6 bg-border mx-0.5"></div>
    <button
      class="w-10 h-10 rounded-md border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover"
      onpointerdown={tap(onCommit)}
      title="Commit"
    >
      <Check size={18} />
    </button>
    <button
      class="w-10 h-10 rounded-md border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover"
      onpointerdown={tap(onCancel)}
      title="Cancel"
    >
      <X size={18} />
    </button>
  {/if}
</div>
