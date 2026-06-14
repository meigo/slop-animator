<script lang="ts">
  import { onMount } from "svelte";
  import { setupInput, type InputPoint } from "../core/input";
  import { Viewport } from "../core/viewport";
  import { setupTouchGestures } from "../core/touch-gestures";
  import { drawStroke } from "../core/brush";
  import { floodFill, hexToRgba } from "../core/fill";
  import { renderFrame } from "../anim/render";
  import { renderFrameWithOnion } from "../anim/onion";
  import { ensureDrawableKeyframe } from "../anim/timeline";
  import { state, history, DPR, canvasOps, activeLayer, bump, pressureCurve } from "../state/appState.svelte";
  import { selectionRef, selectionActions } from "../state/appState.svelte";
  import { drawStampStrokeIncremental, resetStampState } from "../core/stamp-brush";
  import { drawInkStrokeIncremental, resetInkState } from "../core/ink-brush";
  import { syncReferenceVideos } from "../anim/reference";
  import { Selection } from "../core/selection";
  import SelectionActions from "./SelectionActions.svelte";

  let display: HTMLCanvasElement;
  let displayCtx: CanvasRenderingContext2D;
  let viewport: Viewport;
  let stage: HTMLDivElement;
  // Offscreen scratch surface used to tint onion-skin ghosts before compositing.
  let scratch: HTMLCanvasElement;
  let scratchCtx: CanvasRenderingContext2D;

  // Selection overlay (CSS-pixel sized, shares the viewport transform via the wrapper).
  let wrapper: HTMLDivElement;
  let overlay: HTMLCanvasElement;
  let selection: Selection;
  let selectionMode: "create" | "drag" | null = null;
  // The cell being transformed + its pre-lift snapshot, for commit/cancel undo.
  let selCtx: CanvasRenderingContext2D | null = null;
  let selBefore: ImageData | null = null;

  // The cell canvas being drawn on for the current stroke, and its undo snapshot.
  let strokeCanvas: HTMLCanvasElement | null = null;
  let strokeCtx: CanvasRenderingContext2D | null = null;
  let beforeSnapshot: ImageData | null = null;
  // Coalesce per-event drawing/compositing into one animation frame: the pen fires far
  // above the display refresh, so painting every event re-runs the full stroke wastefully.
  let drawRaf = 0;
  let lastPoints: InputPoint[] = [];

  // True once the current fill gesture has already filled (one fill per pointer press).
  let fillUsed = false;

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

  function doFill(pt: { x: number; y: number }) {
    const layer = activeLayer();
    if (layer.kind !== "draw" || layer.locked) return;
    const canvas = ensureDrawableKeyframe(layer, state.playhead, canvasOps);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const color = hexToRgba(state.brush.color, state.brush.opacity);
    if (selection && selection.state === "selected") {
      // Flood on a temp copy, then composite back through the selection clip.
      const tmp = document.createElement("canvas");
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
      tctx.drawImage(canvas, 0, 0);
      floodFill(tctx, pt.x * DPR, pt.y * DPR, color, { tolerance: state.fill.tolerance, expand: state.fill.expand });
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      selection.applyClip(ctx);
      ctx.drawImage(tmp, 0, 0, tmp.width / DPR, tmp.height / DPR);
      ctx.restore();
    } else {
      floodFill(ctx, pt.x * DPR, pt.y * DPR, color, { tolerance: state.fill.tolerance, expand: state.fill.expand });
    }

    const after = ctx.getImageData(0, 0, canvas.width, canvas.height);
    history.push({
      undo: () => { ctx.putImageData(before, 0, 0); recomposite(); },
      redo: () => { ctx.putImageData(after, 0, 0); recomposite(); },
    });
    bump();
    recomposite();
  }

  // Render the current stroke onto the cell ctx then recomposite. Smooth = full redraw
  // from the pre-stroke snapshot; stamp = incremental. Both clip to the active selection.
  function paintStroke(pts: InputPoint[], done: boolean) {
    if (!strokeCtx) return;
    const curved = pts.map((p) => ({ ...p, pressure: pressureCurve.evaluate(p.pressure) }));
    const settings = { ...state.brush, isEraser: state.tool === "eraser" };
    const kind = state.brushType; // local so TS narrows it across the branches
    if (kind === "smooth") {
      // Smooth (perfect-freehand): full redraw from the pre-stroke snapshot.
      strokeCtx.putImageData(beforeSnapshot!, 0, 0);
      strokeCtx.save();
      strokeCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
      selection?.applyClip(strokeCtx);
      drawStroke(strokeCtx, curved, settings, done, state.sizeRange);
      strokeCtx.restore();
    } else if (kind === "ink") {
      // Ink/marker: incremental quadratic line — no snapshot restore.
      strokeCtx.save();
      strokeCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
      selection?.applyClip(strokeCtx);
      drawInkStrokeIncremental(strokeCtx, curved, settings, state.sizeRange);
      strokeCtx.restore();
    } else {
      // Stamp engine (pencil/charcoal/airbrush): incremental — no snapshot restore.
      strokeCtx.save();
      strokeCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
      selection?.applyClip(strokeCtx);
      drawStampStrokeIncremental(strokeCtx, curved, { ...settings, brushType: kind }, state.sizeRange);
      strokeCtx.restore();
    }
    recomposite();
  }

  function onStroke(points: InputPoint[], done: boolean) {
    if (state.tool === "select" || state.tool === "lasso") {
      const p = points[points.length - 1];
      if (points.length === 1 && !done) {
        const handle = selection.hitTest(p.x, p.y);
        if (selection.state === "selected" && handle === "move") {
          // First grab inside a fresh marquee: lift the pixels and enter transform mode.
          const layer = activeLayer();
          if (layer.kind !== "draw" || layer.locked) return;
          const canvas = ensureDrawableKeyframe(layer, state.playhead, canvasOps);
          selCtx = canvas.getContext("2d", { willReadFrequently: true })!;
          selBefore = selCtx.getImageData(0, 0, canvas.width, canvas.height);
          // liftPixels' rect-clear and the later commit blit operate in CSS coords, so the
          // cell ctx must carry the dpr transform (a cloned cell's ctx is at identity).
          selCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
          const lifted = selection.liftPixels(selCtx, DPR);
          if (lifted) {
            selection.beginTransform(lifted);
            recomposite();
            selectionMode = "drag";
            selection.startDrag("move", p.x, p.y);
          }
        } else if ((selection.state === "transforming" || selection.state === "warping") && handle) {
          selectionMode = "drag";
          selection.startDrag(handle, p.x, p.y);
        } else {
          // Outside any selection (or idle) → commit/cancel the old one, start a new marquee.
          if (selection.hasFloating) selection.commit();
          else if (selection.active) selection.cancel();
          selectionMode = "create";
          selection.startCreate(p.x, p.y);
        }
      } else if (!done) {
        if (selectionMode === "create") selection.updateCreate(p.x, p.y);
        else if (selectionMode === "drag") selection.updateDrag(p.x, p.y);
      } else {
        if (selectionMode === "create") selection.endCreate();
        selection.endDrag();
        selectionMode = null;
      }
      return;
    }
    if (state.tool === "fill") {
      if (!fillUsed && points.length > 0) {
        doFill(points[0]);
        fillUsed = true;
      }
      if (done) fillUsed = false;
      return;
    }
    if (!strokeCanvas) {
      // First event of the stroke: resolve the target layer once and bail if it's
      // locked. Binding the layer here (rather than re-reading activeLayer() every
      // move) keeps the whole stroke on the layer it started on.
      const layer = activeLayer();
      if (layer.kind !== "draw" || layer.locked) return;
      strokeCanvas = ensureDrawableKeyframe(layer, state.playhead, canvasOps);
      strokeCtx = strokeCanvas.getContext("2d", { willReadFrequently: true })!;
      beforeSnapshot = strokeCtx.getImageData(0, 0, strokeCanvas.width, strokeCanvas.height);
      if (state.brushType === "ink") resetInkState();
      else if (state.brushType !== "smooth") resetStampState();
      bump();
    }

    // Throttle drawing + compositing to one animation frame (defer non-final events);
    // finalize synchronously on stroke end so the undo snapshot captures the exact result.
    lastPoints = points;
    if (done) {
      if (drawRaf) { cancelAnimationFrame(drawRaf); drawRaf = 0; }
      paintStroke(points, true);
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
    } else if (!drawRaf) {
      drawRaf = requestAnimationFrame(() => {
        drawRaf = 0;
        if (strokeCtx) paintStroke(lastPoints, false);
      });
    }
  }

  function setupSelection() {
    overlay.width = state.project.width;
    overlay.height = state.project.height;
    overlay.style.width = `${state.project.width}px`;
    overlay.style.height = `${state.project.height}px`;

    selection = new Selection(overlay);
    selection.mode = "rect";
    selection.screenScale = viewport.zoom;
    viewport.onChange = () => { selection.screenScale = viewport.zoom; };

    selection.onChange = () => recomposite();
    selection.onStateChange = () => recomposite();

    selection.onCommit = () => {
      if (!selCtx || !selBefore) return;
      // renderFloatingTo blits the floating pixels via a CSS-coord matrix → needs dpr.
      selCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
      selection.renderFloatingTo(selCtx);
      const ctx = selCtx;
      const before = selBefore;
      const after = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
      history.push({
        undo: () => { ctx.putImageData(before, 0, 0); recomposite(); },
        redo: () => { ctx.putImageData(after, 0, 0); recomposite(); },
      });
      selCtx = null;
      selBefore = null;
      bump();
      recomposite();
    };

    selection.onCancel = () => {
      if (selCtx && selBefore) { selCtx.putImageData(selBefore, 0, 0); recomposite(); }
      selCtx = null;
      selBefore = null;
    };

    selectionRef.current = selection;
  }

  function enterTransform() {
    if (!selection || selection.state !== "selected") return;
    const layer = activeLayer();
    if (layer.kind !== "draw" || layer.locked) return;
    const canvas = ensureDrawableKeyframe(layer, state.playhead, canvasOps);
    selCtx = canvas.getContext("2d", { willReadFrequently: true })!;
    selBefore = selCtx.getImageData(0, 0, canvas.width, canvas.height);
    // See note in onStroke: the cell ctx must carry the dpr transform for lift/commit.
    selCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const lifted = selection.liftPixels(selCtx, DPR);
    if (!lifted) return;
    selection.beginTransform(lifted);
    recomposite();
  }

  function enterWarp(rows: number, cols: number) {
    if (!selection) return;
    if (selection.state === "selected") enterTransform();
    if (selection.state === "transforming") selection.beginWarp(rows, cols);
    else if (selection.state === "warping") selection.densifyWarp(rows, cols);
  }

  onMount(() => {
    displayCtx = display.getContext("2d")!;
    scratch = document.createElement("canvas");
    scratch.width = state.project.width * DPR;
    scratch.height = state.project.height * DPR;
    scratchCtx = scratch.getContext("2d")!;
    sizeDisplay();
    viewport = new Viewport(wrapper);
    recomposite();
    setupSelection();

    // Finger gestures: 1-finger pan, 2-finger pinch zoom+rotate, 2-finger tap undo,
    // 3-finger tap redo. The Apple Pencil (pointerType "pen") bypasses this and draws.
    const cleanupTouch = setupTouchGestures(stage, viewport, {
      onUndo: () => history.undo(),
      onRedo: () => history.redo(),
      onViewportChange: () => { selection.screenScale = viewport.zoom; },
    });

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
        syncReferenceVideos(state.project, state.playhead, state.project.fps);
        recomposite();
      }
      raf = requestAnimationFrame(tick);
    };
    let raf = requestAnimationFrame(tick);

    selectionActions.enterWarp = enterWarp;

    return () => { cleanup(); cleanupTouch(); cancelAnimationFrame(raf); if (drawRaf) cancelAnimationFrame(drawRaf); selectionRef.current = null; selectionActions.enterWarp = null; };
  });

  $effect(() => {
    const t = state.tool;
    if (!selection) return;
    if (t === "select") selection.mode = "rect";
    else if (t === "lasso") selection.mode = "lasso";
    else {
      // Switching to a drawing tool: bank a floating transform, but KEEP a plain
      // marquee so brush/eraser/fill clip to it. (Esc clears it.)
      if (selection.hasFloating) selection.commit();
      selectionMode = null;
    }
  });

  // Wheel zoom, mirroring slop-paint's gesture (minimal subset).
  function onWheel(e: WheelEvent) { e.preventDefault(); viewport?.zoomAt(e.clientX, e.clientY, e.deltaY); }
</script>

<div bind:this={stage} class="relative flex-1 overflow-hidden bg-canvas-bg touch-none" onwheel={onWheel}>
  <div bind:this={wrapper} class="absolute left-0 top-0">
    <canvas bind:this={display} class="absolute left-0 top-0 shadow-lg touch-none"></canvas>
    <canvas bind:this={overlay} class="absolute left-0 top-0 pointer-events-none"></canvas>
  </div>
  <SelectionActions getSelection={() => selection} getViewport={() => viewport} getContainer={() => stage}
    onTransform={enterTransform}
    onDistort={() => enterWarp(2, 2)}
    onMesh={() => enterWarp(3, 3)}
    onCommit={() => selection?.commit()}
    onCancel={() => selection?.cancel()} />

</div>
