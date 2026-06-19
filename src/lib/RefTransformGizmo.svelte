<script lang="ts">
  import { onMount } from "svelte";
  import type { Viewport } from "../core/viewport";
  import { state as appState, bump } from "../state/appState.svelte";
  import { transformBaseRect, type Layer } from "../anim/document";
  import { transformedCorners, rotateHandlePos, transformCenter, applyScale, applyRotate, type Pt } from "../core/ref-transform";

  let { getViewport, getContainer }: { getViewport: () => Viewport | null; getContainer: () => HTMLElement | null } = $props();

  const ROTATE_GAP_PX = 28;
  let visible = $state(false);
  let corners = $state<{ x: number; y: number }[]>([]);
  let rotatePt = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let raf = 0;

  type DragHandle = "nw" | "ne" | "se" | "sw" | "rotate";
  // Active handle drag. center/start are in document logical coords; startT is a snapshot
  // of the layer transform at grab time so each move recomputes from the original.
  let drag: { handle: DragHandle; layer: Layer; startT: Layer["transform"]; start: Pt; center: Pt } | null = null;

  function activeTransformLayer(): Layer | null {
    const l = appState.project.layers.find((x) => x.id === appState.activeLayerId);
    if (!l) return null;
    if (l.kind === "ref") return l;                                   // refs: any tool (unchanged)
    if (l.kind === "draw" && appState.tool === "transform") return l; // draw: only under the Transform tool
    return null;
  }

  function baseRect(layer: Layer) {
    return transformBaseRect(layer, appState.project.width, appState.project.height); // {x,y,w,h} | null
  }

  function startHandleDrag(handle: DragHandle, e: PointerEvent) {
    const vp = getViewport();
    const layer = activeTransformLayer();
    if (!vp || !layer) return;
    const base = baseRect(layer);
    if (!base) return;
    // Keep this gesture out of the touch-pan/pinch path and the display canvas's drawing path.
    e.stopPropagation();
    e.preventDefault();
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ }
    drag = {
      handle,
      layer,
      startT: { ...layer.transform },
      start: vp.screenToCanvas(e.clientX, e.clientY),
      center: transformCenter(base, layer.transform),
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
    const p = vp.screenToCanvas(e.clientX, e.clientY);
    if (d.handle === "rotate") d.layer.transform = applyRotate(d.startT, d.center, d.start, p);
    else d.layer.transform = applyScale(d.startT, d.center, d.start, p); // any corner = uniform scale
    bump();
  }

  function endHandleDrag(e: PointerEvent) {
    if (drag) {
      try { (e.target as Element).releasePointerCapture?.(e.pointerId); } catch { /* may already be released */ }
    }
    drag = null;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", endHandleDrag);
    window.removeEventListener("pointercancel", endHandleDrag);
  }

  function tick() {
    const vp = getViewport();
    const container = getContainer();
    const layer = activeTransformLayer();
    if (vp && container && layer) {
      const base = baseRect(layer);
      if (base) {
        const gap = ROTATE_GAP_PX / vp.zoom;
        const rect = container.getBoundingClientRect();
        const toLocal = (p: { x: number; y: number }) => {
          const s = vp.canvasToScreen(p.x, p.y);
          return { x: s.x - rect.left, y: s.y - rect.top };
        };
        corners = transformedCorners(base, layer.transform).map(toLocal);
        rotatePt = toLocal(rotateHandlePos(base, layer.transform, gap));
        visible = true;
      } else visible = false;
    } else visible = false;
    raf = requestAnimationFrame(tick);
  }

  function resetTransform() {
    const layer = activeTransformLayer();
    if (layer) { layer.transform = { dx: 0, dy: 0, scale: 1, rotation: 0 }; bump(); }
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
    <polygon points={corners.map((c) => `${c.x},${c.y}`).join(" ")}
             fill="none" stroke="#3b82f6" stroke-width="1.5" />
    <line x1={(corners[0].x + corners[1].x) / 2} y1={(corners[0].y + corners[1].y) / 2}
          x2={rotatePt.x} y2={rotatePt.y} stroke="#3b82f6" stroke-width="1.5" />
    {#each corners as c, i (i)}
      <rect role="button" tabindex="-1" aria-label="Scale reference" class="pointer-events-auto cursor-pointer" data-ref-handle="" x={c.x - 6} y={c.y - 6} width="12" height="12"
            fill="#fff" stroke="#3b82f6" stroke-width="1.5"
            onpointerdown={(e) => startHandleDrag((["nw", "ne", "se", "sw"] as const)[i], e)} />
    {/each}
    <circle role="button" tabindex="-1" aria-label="Rotate reference" class="pointer-events-auto cursor-grab" data-ref-handle="" cx={rotatePt.x} cy={rotatePt.y} r="7"
            fill="#fff" stroke="#3b82f6" stroke-width="1.5"
            onpointerdown={(e) => startHandleDrag("rotate", e)} />
  </svg>
  <div class="absolute left-2 top-2 flex items-center gap-2 text-xs text-text-secondary bg-surface/90 rounded px-2 py-1 pointer-events-auto">
    <span>Transform: drag to move · corners scale · top handle rotates</span>
    <button class="underline hover:text-text" onclick={resetTransform}>Reset to fit</button>
  </div>
{/if}
