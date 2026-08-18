<script lang="ts">
  import { onMount } from "svelte";
  import type { Viewport } from "../core/viewport";
  import { state as appState, activeLayer, DPR } from "../state/appState.svelte";
  import {
    isIdentityTransform,
    isLayerEditable,
    groupOf,
    groupTransformAt,
    cellTransform,
    resolvedKeyCell,
    transformAt,
  } from "../anim/document";
  import { forwardChain, type ComposeStep } from "../core/ref-transform";
  import { contentBoxLogical, groupBoxLogical } from "./cell-ink";

  let {
    getViewport,
    getContainer,
  }: {
    getViewport: () => Viewport | null;
    getContainer: () => HTMLElement | null;
  } = $props();

  /**
   * A cell canvas is exactly document-sized, so a transformed layer's paintable area is the DOC
   * RECT pushed through `group ∘ layer ∘ cell` — scale a layer down and strokes stop landing part
   * way across the screen, with nothing to say where. This traces that boundary.
   *
   * Only for tools that write pixels into the cell, and deliberately NOT for "transform": its
   * gizmo already draws this exact box, and two outlines on the same rect read as a bug.
   */
  const PAINT_TOOLS = ["brush", "eraser", "fill", "deform", "pose"];

  let corners = $state<{ x: number; y: number }[]>([]);
  let visible = $state(false);
  let raf = 0;

  /** The paintable bound in LOGICAL canvas space, or null when there is nothing worth drawing. */
  function paintableCorners(): { x: number; y: number }[] | null {
    if (!PAINT_TOOLS.includes(appState.tool)) return null;
    const l = activeLayer();
    // A locked/hidden layer refuses the stroke outright (and says so) — no edge to warn about.
    if (!isLayerEditable(l, appState.project.groups)) return null;

    const W = appState.project.width,
      H = appState.project.height;
    const g = groupOf(l, appState.project.groups);
    const rk = resolvedKeyCell(l, appState.playhead);
    // Inner-to-outer, matching the render's compose order (gotcha #4).
    const steps: ComposeStep[] = [];
    if (rk)
      steps.push({
        base: contentBoxLogical(rk.cell.canvas, rk.cell.transformBox, W, H, DPR, appState.version),
        t: cellTransform(rk.cell),
      });
    steps.push({ base: { x: 0, y: 0, w: W, h: H }, t: transformAt(l, appState.playhead) });
    if (g)
      steps.push({
        base: groupBoxLogical(g, appState.project, appState.playhead, DPR, appState.version),
        // At the playhead, like the cell and layer steps above: the hint traces the paintable edge
        // of the frame you are on, so an animated group has to resolve there too.
        t: groupTransformAt(g, appState.playhead),
      });

    // Untransformed: the paintable bound IS the document edge, which the canvas already shows.
    if (steps.every((s) => isIdentityTransform(s.t))) return null;
    return [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ].map((p) => forwardChain(steps, p));
  }

  // Screen-space, like the gizmo: a hairline must stay one pixel at every zoom level, which a
  // stroke on the document-space overlay canvas would not.
  function tick() {
    const vp = getViewport();
    const container = getContainer();
    const pts = vp && container ? paintableCorners() : null;
    if (vp && container && pts) {
      const rect = container.getBoundingClientRect();
      corners = pts.map((p) => {
        const s = vp.canvasToScreen(p.x, p.y);
        return { x: s.x - rect.left, y: s.y - rect.top };
      });
      visible = true;
    } else visible = false;
    raf = requestAnimationFrame(tick);
  }

  onMount(() => {
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });
</script>

{#if visible && corners.length === 4}
  {@const pts = corners.map((c) => `${c.x},${c.y}`).join(" ")}
  <svg class="absolute inset-0 size-full pointer-events-none" style="overflow: visible">
    <!-- White under, black dashed over — the marquee's trick (selection.ts), so the line stays
         legible over both black ink and white paper. Passive: dashes never animate. -->
    <polygon points={pts} fill="none" stroke="#fff" stroke-width="1" />
    <polygon points={pts} fill="none" stroke="#000" stroke-width="1" stroke-dasharray="4 4" />
  </svg>
{/if}
