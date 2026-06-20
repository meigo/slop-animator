<script lang="ts">
  import { onMount } from "svelte";
  import type { Viewport } from "../core/viewport";
  import { state as appState, activeStroke } from "../state/appState.svelte";

  let {
    getViewport,
    getContainer,
    sampleColor,
  }: {
    getViewport: () => Viewport | null;
    getContainer: () => HTMLElement | null;
    sampleColor?: (clientX: number, clientY: number) => string | null;
  } = $props();

  let visible = $state(false);
  let x = $state(0);
  let y = $state(0);
  let diameter = $state(0);
  let dashed = $state(false);
  let swatch = $state<string | null>(null);
  let clientX = $state(0);
  let clientY = $state(0);
  let raf = 0;

  const isStrokeTool = () => appState.tool === "brush" || appState.tool === "eraser";

  function onMove(e: PointerEvent) {
    // Mouse/pen only; finger touches (which pan/draw via gestures) get no cursor.
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") {
      visible = false;
      return;
    }
    const c = getContainer();
    if (!c) return;
    const r = c.getBoundingClientRect();
    x = e.clientX - r.left;
    y = e.clientY - r.top;
    visible = true;
    clientX = e.clientX;
    clientY = e.clientY;
  }
  const onLeave = () => (visible = false);

  // Keep size synced to the active tool's size AND zoom, even without a pointer move.
  function tick() {
    diameter = activeStroke().size * (getViewport()?.zoom ?? 1);
    dashed = appState.tool === "eraser";
    swatch = appState.tool === "eyedropper" && sampleColor ? sampleColor(clientX, clientY) : null;
    raf = requestAnimationFrame(tick);
  }

  onMount(() => {
    const c = getContainer();
    c?.addEventListener("pointermove", onMove);
    c?.addEventListener("pointerover", onMove);
    c?.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      c?.removeEventListener("pointermove", onMove);
      c?.removeEventListener("pointerover", onMove);
      c?.removeEventListener("pointerleave", onLeave);
    };
  });
</script>

{#if visible && isStrokeTool() && diameter > 0}
  <div
    class="brush-cursor"
    class:dashed
    style="transform: translate({x}px, {y}px) translate(-50%, -50%); width: {diameter}px; height: {diameter}px;"
  ></div>
{/if}
{#if visible && appState.tool === "eyedropper" && swatch}
  <div
    class="eyedropper-swatch"
    style="transform: translate({x}px, {y}px) translate(14px, -32px); background: {swatch};"
  ></div>
{/if}
{#if visible && (isStrokeTool() || appState.tool === "eyedropper")}
  <div
    class="brush-cursor-dot"
    style="transform: translate({x}px, {y}px) translate(-50%, -50%);"
  ></div>
{/if}

<style>
  .brush-cursor {
    position: absolute;
    left: 0;
    top: 0;
    border-radius: 50%;
    border: 1.5px solid rgba(0, 0, 0, 0.7);
    box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.6);
    pointer-events: none;
    z-index: 40;
  }
  .brush-cursor.dashed {
    border-style: dashed;
  }
  .eyedropper-swatch {
    position: absolute;
    left: 0;
    top: 0;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    border: 1.5px solid rgba(0, 0, 0, 0.7);
    box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.7);
    pointer-events: none;
    z-index: 40;
  }
  .brush-cursor-dot {
    position: absolute;
    left: 0;
    top: 0;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.7);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.6);
    pointer-events: none;
    z-index: 40;
  }
</style>
