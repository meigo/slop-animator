<script lang="ts">
  import { onMount } from "svelte";
  import type { Viewport } from "../core/viewport";
  import { state as appState, bump, DPR } from "../state/appState.svelte";
  import {
    transformBaseRect,
    cellTransform,
    resolvedKeyCell,
    groupOf,
    groupTransform,
    isIdentityTransform,
    type Cell,
    type Layer,
    type LayerGroup,
    type RefTransform,
  } from "../anim/document";
  import { contentBoxLogical, groupBoxLogical } from "./cell-ink";
  import {
    transformedCorners,
    rotateHandlePos,
    transformCenter,
    applyScale,
    applyRotate,
    forwardChain,
    inverseChain,
    type ComposeStep,
    type Pt,
  } from "../core/ref-transform";

  const IDENTITY: RefTransform = { dx: 0, dy: 0, scale: 1, rotation: 0 };

  let {
    getViewport,
    getContainer,
  }: { getViewport: () => Viewport | null; getContainer: () => HTMLElement | null } = $props();

  const ROTATE_GAP_PX = 28;
  let visible = $state(false);
  let corners = $state<{ x: number; y: number }[]>([]);
  let rotatePt = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let raf = 0;

  type DragHandle = "nw" | "ne" | "se" | "sw" | "rotate";
  // Active handle drag. center/start are in the TARGET's local logical coords (pointer mapped
  // through `outer` chain inverse); startT is a snapshot of the target transform at grab time so
  // each move recomputes from the original. setT writes back to the target (layer, cell, or group).
  let drag: {
    handle: DragHandle;
    startT: RefTransform;
    start: Pt;
    center: Pt;
    outer: ComposeStep[];
    setT: (t: RefTransform) => void;
  } | null = null;

  function activeTransformLayer(): Layer | null {
    const l = appState.project.layers.find((x) => x.id === appState.activeLayerId);
    if (!l) return null;
    if (l.kind === "ref") return l; // refs: any tool (unchanged)
    if (l.kind === "draw" && appState.tool === "transform") return l; // draw: only under the Transform tool
    return null;
  }

  function baseRect(layer: Layer) {
    return transformBaseRect(layer, appState.project.width, appState.project.height); // {x,y,w,h} | null
  }

  type Rect = { x: number; y: number; w: number; h: number };
  // Scope-aware transform target: which transform the gizmo edits/displays, its logical base
  // rect, and the outer compose chain (inner-to-outer) for display/pointer mapping.
  function transformTarget(): {
    getT: () => RefTransform;
    setT: (t: RefTransform) => void;
    base: Rect | null;
    outer: ComposeStep[]; // inner-to-outer (innermost first)
    cell: Extract<Cell, { kind: "key" }> | null;
    group: LayerGroup | null;
    scope: "frame" | "layer" | "group";
  } | null {
    const l = activeTransformLayer();
    if (!l) return null;
    const W = appState.project.width,
      H = appState.project.height;
    const g = groupOf(l, appState.project.groups);
    const groupStep: ComposeStep[] = g
      ? [
          {
            base: groupBoxLogical(g, appState.project, appState.playhead, DPR, appState.version),
            t: groupTransform(g),
          },
        ]
      : [];

    if (l.kind === "draw" && appState.transformScope === "group") {
      if (!g) return null; // Group scope is disabled when ungrouped; safety fallback.
      return {
        getT: () => groupTransform(g),
        setT: (t: RefTransform) => (g.transform = t),
        base: groupBoxLogical(g, appState.project, appState.playhead, DPR, appState.version),
        outer: [], // group is top of the compose chain
        cell: null,
        group: g,
        scope: "group",
      };
    }

    if (l.kind === "draw" && appState.transformScope === "frame") {
      const rk = resolvedKeyCell(l, appState.playhead);
      if (!rk) return null;
      const outer: ComposeStep[] = [
        { base: { x: 0, y: 0, w: W, h: H }, t: l.transform },
        ...groupStep,
      ];
      return {
        getT: () => cellTransform(rk.cell),
        setT: (t: RefTransform) => (rk.cell.transform = t),
        base: contentBoxLogical(rk.cell.canvas, rk.cell.transformBox, W, H, DPR, appState.version),
        outer,
        cell: rk.cell,
        group: g,
        scope: "frame",
      };
    }

    // scope = "layer" (or ref layer of any scope)
    const outer: ComposeStep[] = [...groupStep];
    return {
      getT: () => l.transform,
      setT: (t: RefTransform) => (l.transform = t),
      base: baseRect(l),
      outer,
      cell: null,
      group: g,
      scope: "layer",
    };
  }

  function startHandleDrag(handle: DragHandle, e: PointerEvent) {
    const vp = getViewport();
    const tgt = transformTarget();
    if (!vp || !tgt || !tgt.base) return;
    const base = tgt.base;
    const t = tgt.getT();
    // Keep this gesture out of the touch-pan/pinch path and the display canvas's drawing path.
    e.stopPropagation();
    e.preventDefault();
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    // Freeze the content box on grab for a frame or group transform that's currently identity,
    // so the gizmo's box stays put as content moves under the new transform.
    if (isIdentityTransform(t)) {
      if (tgt.scope === "frame" && tgt.cell) tgt.cell.transformBox = base;
      else if (tgt.scope === "group" && tgt.group) tgt.group.transformBox = base;
    }
    // Map the grab point through the outer chain inverse into the target's local space.
    const start = inverseChain(tgt.outer, vp.screenToCanvas(e.clientX, e.clientY));
    drag = {
      handle,
      startT: { ...t },
      start,
      center: transformCenter(base, t),
      outer: tgt.outer,
      setT: tgt.setT,
    };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", endHandleDrag);
    window.addEventListener("pointercancel", endHandleDrag);
  }

  function onDragMove(e: PointerEvent) {
    const d = drag;
    const vp = getViewport();
    if (!d || !vp) return;
    e.preventDefault();
    const p = inverseChain(d.outer, vp.screenToCanvas(e.clientX, e.clientY));
    if (d.handle === "rotate") d.setT(applyRotate(d.startT, d.center, d.start, p));
    else d.setT(applyScale(d.startT, d.center, d.start, p)); // any corner = uniform scale
    bump();
  }

  function endHandleDrag(e: PointerEvent) {
    if (drag) {
      try {
        (e.target as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        /* may already be released */
      }
    }
    drag = null;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", endHandleDrag);
    window.removeEventListener("pointercancel", endHandleDrag);
  }

  function tick() {
    const vp = getViewport();
    const container = getContainer();
    const tgt = transformTarget();
    if (vp && container && tgt && tgt.base) {
      const base = tgt.base;
      const t = tgt.getT();
      const gap = ROTATE_GAP_PX / vp.zoom;
      const rect = container.getBoundingClientRect();
      // Map the target-local point out through the outer chain, then to screen.
      const toLocal = (p: { x: number; y: number }) => {
        const q = forwardChain(tgt.outer, p);
        const s = vp.canvasToScreen(q.x, q.y);
        return { x: s.x - rect.left, y: s.y - rect.top };
      };
      corners = transformedCorners(base, t).map(toLocal);
      rotatePt = toLocal(rotateHandlePos(base, t, gap));
      visible = true;
    } else visible = false;
    raf = requestAnimationFrame(tick);
  }

  function resetTransform() {
    const tgt = transformTarget();
    if (!tgt) return;
    if (tgt.scope === "frame" && tgt.cell) {
      tgt.cell.transform = { ...IDENTITY };
      tgt.cell.transformBox = null;
    } else if (tgt.scope === "group" && tgt.group) {
      tgt.group.transform = { ...IDENTITY };
      tgt.group.transformBox = null;
    } else {
      tgt.setT({ ...IDENTITY });
    }
    bump();
  }

  onMount(() => {
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Drop any in-flight drag listeners if the component unmounts mid-drag.
      window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", endHandleDrag);
      window.removeEventListener("pointercancel", endHandleDrag);
    };
  });
</script>

{#if visible && corners.length === 4}
  <svg class="absolute inset-0 w-full h-full pointer-events-none" style="overflow: visible">
    <polygon
      points={corners.map((c) => `${c.x},${c.y}`).join(" ")}
      fill="none"
      stroke="#3b82f6"
      stroke-width="1.5"
    />
    <line
      x1={(corners[0].x + corners[1].x) / 2}
      y1={(corners[0].y + corners[1].y) / 2}
      x2={rotatePt.x}
      y2={rotatePt.y}
      stroke="#3b82f6"
      stroke-width="1.5"
    />
    {#each corners as c, i (i)}
      <rect
        role="button"
        tabindex="-1"
        aria-label="Scale reference"
        class="pointer-events-auto cursor-pointer"
        data-ref-handle=""
        x={c.x - 6}
        y={c.y - 6}
        width="12"
        height="12"
        fill="#fff"
        stroke="#3b82f6"
        stroke-width="1.5"
        onpointerdown={(e) => startHandleDrag((["nw", "ne", "se", "sw"] as const)[i], e)}
      />
    {/each}
    <circle
      role="button"
      tabindex="-1"
      aria-label="Rotate reference"
      class="pointer-events-auto cursor-grab"
      data-ref-handle=""
      cx={rotatePt.x}
      cy={rotatePt.y}
      r="7"
      fill="#fff"
      stroke="#3b82f6"
      stroke-width="1.5"
      onpointerdown={(e) => startHandleDrag("rotate", e)}
    />
  </svg>
  <div
    class="absolute left-2 top-2 flex items-center gap-2 text-xs text-text-secondary bg-surface/90 rounded px-2 py-1 pointer-events-auto"
  >
    <span>Transform: drag to move · corners scale · top handle rotates</span>
    <button class="underline hover:text-text" onclick={resetTransform}>Reset to fit</button>
  </div>
{/if}
