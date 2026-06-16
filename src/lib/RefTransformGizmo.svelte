<script lang="ts">
  import { onMount } from "svelte";
  import type { Viewport } from "../core/viewport";
  import { state as appState, bump } from "../state/appState.svelte";
  import { containRect, mediaIntrinsicSize, type ReferenceLayer } from "../anim/document";
  import { transformedCorners, rotateHandlePos } from "../core/ref-transform";

  let { getViewport, getContainer }: { getViewport: () => Viewport | null; getContainer: () => HTMLElement | null } = $props();

  const ROTATE_GAP_PX = 28;
  let visible = $state(false);
  let corners = $state<{ x: number; y: number }[]>([]);
  let rotatePt = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let raf = 0;

  function activeRef(): ReferenceLayer | null {
    const l = appState.project.layers.find((x) => x.id === appState.activeLayerId);
    return l && l.kind === "ref" ? l : null;
  }

  function tick() {
    const vp = getViewport();
    const container = getContainer();
    const layer = activeRef();
    if (vp && container && layer) {
      const size = mediaIntrinsicSize(layer.media);
      if (size.w > 0 && size.h > 0) {
        const base = containRect(size.w, size.h, appState.project.width, appState.project.height);
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
    const layer = activeRef();
    if (layer) { layer.transform = { dx: 0, dy: 0, scale: 1, rotation: 0 }; bump(); }
  }

  onMount(() => { raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf); });
</script>

{#if visible && corners.length === 4}
  <svg class="absolute inset-0 w-full h-full pointer-events-none" style="overflow: visible">
    <polygon points={corners.map((c) => `${c.x},${c.y}`).join(" ")}
             fill="none" stroke="#3b82f6" stroke-width="1.5" />
    <line x1={(corners[0].x + corners[1].x) / 2} y1={(corners[0].y + corners[1].y) / 2}
          x2={rotatePt.x} y2={rotatePt.y} stroke="#3b82f6" stroke-width="1.5" />
    {#each corners as c, i (i)}
      <rect x={c.x - 5} y={c.y - 5} width="10" height="10" fill="#fff" stroke="#3b82f6" stroke-width="1.5" />
    {/each}
    <circle cx={rotatePt.x} cy={rotatePt.y} r="6" fill="#fff" stroke="#3b82f6" stroke-width="1.5" />
  </svg>
  <div class="absolute left-2 top-2 flex items-center gap-2 text-xs text-text-secondary bg-surface/90 rounded px-2 py-1 pointer-events-auto">
    <span>Reference: drag to move · corners scale · top handle rotates</span>
    <button class="underline hover:text-text" onclick={resetTransform}>Reset to fit</button>
  </div>
{/if}
