<script lang="ts">
  import { onMount } from "svelte";
  import { setupInput, type InputPoint } from "../core/input";
  import { Viewport } from "../core/viewport";
  import { drawStroke } from "../core/brush";
  import { renderFrame } from "../anim/render";
  import { renderFrameWithOnion } from "../anim/onion";
  import { ensureDrawableKeyframe } from "../anim/timeline";
  import { state, history, DPR, canvasOps, activeLayer, bump } from "../state/appState.svelte";

  let display: HTMLCanvasElement;
  let displayCtx: CanvasRenderingContext2D;
  let viewport: Viewport;
  // Offscreen scratch surface used to tint onion-skin ghosts before compositing.
  let scratch: HTMLCanvasElement;
  let scratchCtx: CanvasRenderingContext2D;

  // The cell canvas being drawn on for the current stroke, and its undo snapshot.
  let strokeCanvas: HTMLCanvasElement | null = null;
  let strokeCtx: CanvasRenderingContext2D | null = null;
  let beforeSnapshot: ImageData | null = null;

  function sizeDisplay() {
    display.width = state.project.width * DPR;
    display.height = state.project.height * DPR;
    display.style.width = `${state.project.width}px`;
    display.style.height = `${state.project.height}px`;
  }

  function recomposite() {
    // Onion ghosts are hidden during playback (you want a clean preview while it runs).
    if (state.onion.enabled && !state.playback.isPlaying) {
      renderFrameWithOnion(
        displayCtx, scratchCtx, state.project, state.playhead, DPR,
        state.onion, state.activeLayerId
      );
    } else {
      renderFrame(displayCtx, state.project, state.playhead, DPR);
    }
  }

  function onStroke(points: InputPoint[], done: boolean) {
    if (!strokeCanvas) {
      // First event of the stroke: resolve the target layer once and bail if it's
      // locked. Binding the layer here (rather than re-reading activeLayer() every
      // move) keeps the whole stroke on the layer it started on.
      const layer = activeLayer();
      if (layer.locked) return;
      strokeCanvas = ensureDrawableKeyframe(layer, state.playhead, canvasOps);
      strokeCtx = strokeCanvas.getContext("2d", { willReadFrequently: true })!;
      beforeSnapshot = strokeCtx.getImageData(0, 0, strokeCanvas.width, strokeCanvas.height);
      bump();
    }

    // Re-render the in-progress stroke from the pre-stroke snapshot each move.
    strokeCtx!.putImageData(beforeSnapshot!, 0, 0);
    strokeCtx!.setTransform(DPR, 0, 0, DPR, 0, 0);
    const settings = { ...state.brush, isEraser: state.tool === "eraser" };
    drawStroke(strokeCtx!, points, settings, done, state.sizeRange);
    recomposite();

    if (done) {
      const after = strokeCtx!.getImageData(0, 0, strokeCanvas!.width, strokeCanvas!.height);
      const target = strokeCtx!;
      const before = beforeSnapshot!;
      history.push({
        undo: () => { target.putImageData(before, 0, 0); recomposite(); },
        redo: () => { target.putImageData(after, 0, 0); recomposite(); },
      });
      strokeCanvas = null;
      strokeCtx = null;
      beforeSnapshot = null;
    }
  }

  onMount(() => {
    displayCtx = display.getContext("2d")!;
    scratch = document.createElement("canvas");
    scratch.width = state.project.width * DPR;
    scratch.height = state.project.height * DPR;
    scratchCtx = scratch.getContext("2d")!;
    sizeDisplay();
    viewport = new Viewport(display);
    recomposite();

    const cleanup = setupInput(
      display,
      onStroke,
      (sx, sy) => viewport.screenToCanvas(sx, sy),
      { streamline: () => state.streamline / 100 }
    );

    // Recomposite when the document changes elsewhere (frame step, layer toggle…).
    let lastVersion = state.version;
    let lastPlayhead = state.playhead;
    const tick = () => {
      if (state.version !== lastVersion || state.playhead !== lastPlayhead) {
        lastVersion = state.version;
        lastPlayhead = state.playhead;
        recomposite();
      }
      raf = requestAnimationFrame(tick);
    };
    let raf = requestAnimationFrame(tick);

    return () => { cleanup(); cancelAnimationFrame(raf); };
  });

  // Wheel zoom, mirroring slop-paint's gesture (minimal subset).
  function onWheel(e: WheelEvent) { e.preventDefault(); viewport?.zoomAt(e.clientX, e.clientY, e.deltaY); }
</script>

<div class="relative flex-1 overflow-hidden bg-neutral-300" onwheel={onWheel}>
  <canvas bind:this={display} class="absolute left-0 top-0 shadow-lg touch-none"></canvas>
</div>
