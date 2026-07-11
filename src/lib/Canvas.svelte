<script lang="ts">
  import { onMount } from "svelte";
  import { setupInput, type InputPoint } from "../core/input";
  import { Viewport } from "../core/viewport";
  import { setupTouchGestures } from "../core/touch-gestures";
  import { drawStroke } from "../core/brush";
  import { floodFill, hexToRgba, rgbToHex } from "../core/fill";
  import { renderFrame } from "../anim/render";
  import { renderFrameWithOnion } from "../anim/onion";
  import { ensureDrawableKeyframe } from "../anim/timeline";
  import {
    state as appState,
    history,
    undo,
    redo,
    DPR,
    canvasOps,
    activeLayer,
    activeStroke,
    bump,
    pressureCurve,
    toggleEraser,
    applyEyedropper,
  } from "../state/appState.svelte";
  import { selectionRef, selectionActions, poseActions, liftGuard } from "../state/appState.svelte";
  import { drawStampStrokeIncremental, resetStampState } from "../core/stamp-brush";
  import { drawInkStrokeIncremental, resetInkState } from "../core/ink-brush";
  import { syncReferenceVideos } from "../anim/reference";
  import { Selection, type SelectionRect } from "../core/selection";
  import SelectionActions from "./SelectionActions.svelte";
  import RefTransformGizmo from "./RefTransformGizmo.svelte";
  import BrushCursor from "./BrushCursor.svelte";
  import {
    transformBaseRect,
    isIdentityTransform,
    cellTransform,
    resolvedKeyCell,
    cloneCanvas,
    groupOf,
    groupTransform,
    type Layer,
  } from "../anim/document";
  import { contentBoxLogical, groupBoxLogical, contentBounds } from "./cell-ink";
  import { contentRectLogical, clampDensity } from "../core/deform";
  import { MeshPose } from "../core/mesh-pose";
  import type { Tool } from "../state/appState.svelte";
  import {
    hitTestHandle,
    transformCenter,
    applyMove,
    applyScale,
    applyRotate,
    inverseChain,
    type Handle,
    type Pt,
    type ComposeStep,
  } from "../core/ref-transform";

  const REF_ROTATE_GAP_PX = 28; // screen px from the top edge to the rotate handle
  const IDENTITY = { dx: 0, dy: 0, scale: 1, rotation: 0 };

  /** Return the compose steps [layer-step, group-step] (inner-to-outer) above a draw layer. */
  function layerComposeSteps(layer: Layer): ComposeStep[] {
    const W = appState.project.width,
      H = appState.project.height;
    const steps: ComposeStep[] = [];
    steps.push({ base: { x: 0, y: 0, w: W, h: H }, t: layer.transform });
    const g = groupOf(layer, appState.project.groups);
    if (g) {
      const gt = groupTransform(g);
      steps.push({
        base: groupBoxLogical(g, appState.project, appState.playhead, DPR, appState.version),
        t: gt,
      });
    }
    return steps;
  }

  let display: HTMLCanvasElement;
  let displayCtx: CanvasRenderingContext2D;
  let viewport: Viewport;
  let stage: HTMLDivElement;
  let spaceHeld = $state(false);
  let panning = $state(false);

  // Desktop pan: middle-mouse drag, or space + left-drag. Capture-phase on `stage` so it preempts the
  // bubble-phase drawing handler on `display` — a pan never starts a stroke.
  function stagePanDown(e: PointerEvent) {
    if (!viewport) return;
    const wantPan = e.button === 1 || (spaceHeld && e.button === 0);
    if (!wantPan) return;
    e.preventDefault();
    e.stopPropagation();
    viewport.startPan(e.clientX, e.clientY);
    panning = true;
    stage.setPointerCapture(e.pointerId);
  }
  function stagePanMove(e: PointerEvent) {
    if (!panning || !viewport) return;
    e.stopPropagation();
    viewport.updatePan(e.clientX, e.clientY);
  }
  function stagePanUp(e: PointerEvent) {
    if (!panning) return;
    viewport?.endPan();
    panning = false;
    try {
      stage.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  // Space holds a grab-to-pan mode; `0` fits the canvas to the view. Skipped while typing in a field;
  // space is left alone when a BUTTON is focused so it can still activate it.
  function onViewKeyDown(e: KeyboardEvent) {
    const tag = (document.activeElement as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return; // don't hijack typing
    if (e.key === " ") {
      // Space always holds grab-to-pan (Photoshop-style), even when a toolbar button is focused —
      // preventDefault stops both page scroll and the focused button's space-activation. Reliable
      // panning matters more here than space-clicking a button (Enter still activates buttons).
      spaceHeld = true;
      e.preventDefault();
    } else if (e.key === "0") {
      e.preventDefault();
      viewport?.fitView(appState.project.width, appState.project.height);
    }
  }
  function onViewKeyUp(e: KeyboardEvent) {
    if (e.key === " ") spaceHeld = false;
  }
  // Space/pan can get stuck if focus leaves the window mid-press (no keyup fires) — reset on blur.
  function onViewBlur() {
    spaceHeld = false;
    if (panning) {
      viewport?.endPan();
      panning = false;
    }
  }
  // Offscreen scratch surface used to tint onion-skin ghosts before compositing.
  let scratch: HTMLCanvasElement;
  let scratchCtx: CanvasRenderingContext2D;

  // Selection overlay (CSS-pixel sized, shares the viewport transform via the wrapper).
  let wrapper: HTMLDivElement;
  let overlay: HTMLCanvasElement;
  let selection: Selection;
  let selectionMode: "create" | "drag" | null = null;
  let prevTool: Tool = "brush";
  // Track the active layer/frame so a switch can discard any in-progress lift (see the cleanup $effect).
  let prevLayer = appState.activeLayerId;
  let prevPlayhead = appState.playhead;
  // The cell being transformed + its pre-lift snapshot, for commit/cancel undo.
  let selCtx: CanvasRenderingContext2D | null = null;
  let selBefore: ImageData | null = null;
  const PASTE_OFFSET = 8; // logical px — so a paste-in-place reads as a new copy
  // $state so the floating Paste button reacts to copy/cut filling the clipboard.
  let selectionClipboard = $state<{ canvas: HTMLCanvasElement; rect: SelectionRect } | null>(null);
  // Pose tool: lifted mesh + the handle index currently being dragged.
  let meshPose: MeshPose | null = null;
  let poseDrag: number | null = null;
  let activeHandle: number | null = null;
  let poseAdjusting = false;
  const POSE_SPACING = 16; // device px; dev-viz-tuned mesh density
  let poseSpacing = POSE_SPACING;

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

  // A successful eyedropper pick fires on pointer-down and switches the tool back mid-gesture;
  // this latch swallows the rest of that same gesture so it can't fall through and draw a stray dab.
  let pickingGesture = false;

  function sizeDisplay() {
    display.width = appState.project.width * DPR;
    display.height = appState.project.height * DPR;
    display.style.width = `${appState.project.width}px`;
    display.style.height = `${appState.project.height}px`;
  }

  function recomposite() {
    // Onion ghosts are hidden during playback (you want a clean preview while it runs).
    if (appState.onion.enabled && !appState.playback.isPlaying) {
      renderFrameWithOnion(
        displayCtx,
        scratchCtx,
        appState.project,
        appState.playhead,
        DPR,
        appState.onion,
        appState.activeLayerId,
        appState.version,
      );
    } else {
      // Line boil is a playback-only effect (so you never see your drawing warped while editing).
      const boil =
        appState.project.boil.enabled && appState.playback.isPlaying
          ? appState.project.boil
          : undefined;
      renderFrame(displayCtx, appState.project, appState.playhead, DPR, {
        drawBg: !appState.project.transparentBg,
        boil,
        version: appState.version,
      });
    }
  }

  function doFill(pt: { x: number; y: number }) {
    const layer = activeLayer();
    if (layer.kind !== "draw" || layer.locked) return;
    const W = appState.project.width,
      H = appState.project.height;
    const rk = resolvedKeyCell(layer, appState.playhead);
    const cellT = rk ? cellTransform(rk.cell) : IDENTITY;
    const cellBox = rk
      ? contentBoxLogical(rk.cell.canvas, rk.cell.transformBox, W, H, DPR, appState.version)
      : { x: 0, y: 0, w: W, h: H };
    const steps: ComposeStep[] = [{ base: cellBox, t: cellT }, ...layerComposeSteps(layer)];
    pt = inverseChain(steps, pt);
    const canvas = ensureDrawableKeyframe(layer, appState.playhead, canvasOps);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const color = hexToRgba(appState.brush.color, appState.brush.opacity);
    if (selection && selection.state === "selected") {
      // Flood on a temp copy, then composite back through the selection clip.
      const tmp = document.createElement("canvas");
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
      tctx.drawImage(canvas, 0, 0);
      floodFill(tctx, pt.x * DPR, pt.y * DPR, color, {
        tolerance: appState.fill.tolerance,
        expand: appState.fill.expand,
      });
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      selection.applyClip(ctx);
      ctx.drawImage(tmp, 0, 0, tmp.width / DPR, tmp.height / DPR);
      ctx.restore();
    } else {
      floodFill(ctx, pt.x * DPR, pt.y * DPR, color, {
        tolerance: appState.fill.tolerance,
        expand: appState.fill.expand,
      });
    }

    const after = ctx.getImageData(0, 0, canvas.width, canvas.height);
    history.push({
      undo: () => {
        ctx.putImageData(before, 0, 0);
        recomposite();
      },
      redo: () => {
        ctx.putImageData(after, 0, 0);
        recomposite();
      },
    });
    bump();
    recomposite();
  }

  // Render the current stroke onto the cell ctx then recomposite. Smooth = full redraw
  // from the pre-stroke snapshot; stamp = incremental. Both clip to the active selection.
  function paintStroke(pts: InputPoint[], done: boolean) {
    if (!strokeCtx) return;
    const al = activeLayer();
    let inPts = pts;
    if (al.kind === "draw") {
      const W = appState.project.width,
        H = appState.project.height;
      const rk = resolvedKeyCell(al, appState.playhead);
      const cellT = rk ? cellTransform(rk.cell) : IDENTITY;
      const cellBox = rk
        ? contentBoxLogical(rk.cell.canvas, rk.cell.transformBox, W, H, DPR, appState.version)
        : { x: 0, y: 0, w: W, h: H };
      const steps: ComposeStep[] = [{ base: cellBox, t: cellT }, ...layerComposeSteps(al)];
      // Skip the map when nothing maps (all identity).
      const anyNonId = steps.some((s) => !isIdentityTransform(s.t));
      if (anyNonId) {
        inPts = pts.map((p) => {
          const q = inverseChain(steps, { x: p.x, y: p.y });
          return { ...p, x: q.x, y: q.y };
        });
      }
    }
    const curved = inPts.map((p) => ({ ...p, pressure: pressureCurve.evaluate(p.pressure) }));
    // No-pressure strokes (mouse) draw at constant nominal width: range = 1.
    const stroke = activeStroke();
    const sr = (curved[0]?.hasPressure ?? true) ? stroke.sizeRange : 1;
    const settings = {
      size: stroke.size,
      color: stroke.color,
      opacity: stroke.opacity,
      smoothing: stroke.smoothing,
      drawBehind: stroke.drawBehind,
      alphaLock: stroke.alphaLock,
      taper: stroke.taper,
      isEraser: appState.tool === "eraser",
    };
    const kind = stroke.brushType; // local so TS narrows it across the branches
    if (kind === "smooth") {
      // Smooth (perfect-freehand): full redraw from the pre-stroke snapshot.
      strokeCtx.putImageData(beforeSnapshot!, 0, 0);
      strokeCtx.save();
      strokeCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
      selection?.applyClip(strokeCtx);
      drawStroke(strokeCtx, curved, settings, done, sr);
      strokeCtx.restore();
    } else if (kind === "ink") {
      // Ink/marker: incremental quadratic line — no snapshot restore.
      strokeCtx.save();
      strokeCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
      selection?.applyClip(strokeCtx);
      drawInkStrokeIncremental(strokeCtx, curved, settings, sr);
      strokeCtx.restore();
    } else {
      // Stamp engine (pencil/charcoal/airbrush): incremental — no snapshot restore.
      strokeCtx.save();
      strokeCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
      selection?.applyClip(strokeCtx);
      drawStampStrokeIncremental(strokeCtx, curved, { ...settings, brushType: kind }, sr);
      strokeCtx.restore();
    }
    recomposite();
  }

  function sampleAt(p: { x: number; y: number }): string | null {
    const px = Math.round(p.x * DPR),
      py = Math.round(p.y * DPR);
    if (px < 0 || py < 0 || px >= display.width || py >= display.height) return null;
    const [r, g, b] = displayCtx.getImageData(px, py, 1, 1).data;
    return rgbToHex(r, g, b);
  }

  let refDrag: { handle: Handle; start: Pt; startT: Layer["transform"]; center: Pt } | null = null;

  function onTransformDrag(layer: Layer, points: { x: number; y: number }[], done: boolean) {
    const W = appState.project.width,
      H = appState.project.height;
    const p = points[points.length - 1];

    const scope = appState.transformScope;
    const isDraw = layer.kind === "draw";
    const g = groupOf(layer, appState.project.groups);

    // Resolve target + base + compose-steps (outer transforms above the target, inner-to-outer).
    let getT: () => typeof layer.transform, setT: (t: typeof layer.transform) => void;
    let base: { x: number; y: number; w: number; h: number } | null;
    const outerSteps: ComposeStep[] = [];
    let frameRk: ReturnType<typeof resolvedKeyCell> = null;

    if (isDraw && scope === "group" && g) {
      getT = () => groupTransform(g);
      setT = (nt) => (g.transform = nt);
      base = groupBoxLogical(g, appState.project, appState.playhead, DPR, appState.version);
    } else if (isDraw && scope === "frame") {
      frameRk = resolvedKeyCell(layer as Extract<Layer, { kind: "draw" }>, appState.playhead);
      if (!frameRk) {
        if (done) refDrag = null;
        return;
      }
      base = contentBoxLogical(
        frameRk.cell.canvas,
        frameRk.cell.transformBox,
        W,
        H,
        DPR,
        appState.version,
      );
      getT = () => cellTransform(frameRk!.cell);
      setT = (nt) => (frameRk!.cell.transform = nt);
      // Outer = layer, then group (inner-to-outer).
      outerSteps.push({ base: { x: 0, y: 0, w: W, h: H }, t: layer.transform });
      if (g)
        outerSteps.push({
          base: groupBoxLogical(g, appState.project, appState.playhead, DPR, appState.version),
          t: groupTransform(g),
        });
    } else {
      // scope = "layer" (or ref layer)
      base = transformBaseRect(layer, W, H);
      getT = () => layer.transform;
      setT = (nt) => (layer.transform = nt);
      // Outer = group (if any).
      if (g)
        outerSteps.push({
          base: groupBoxLogical(g, appState.project, appState.playhead, DPR, appState.version),
          t: groupTransform(g),
        });
    }
    if (!base) {
      if (done) refDrag = null;
      return;
    }

    // Pointer in target's local space: inverse-map through outer (outermost first → use inverseChain).
    const pc = inverseChain(outerSteps, p);

    if (!refDrag) {
      const tol = 10 / viewport.zoom;
      const gap = REF_ROTATE_GAP_PX / viewport.zoom;
      const handle = hitTestHandle(base, getT(), pc, tol, gap);
      // Freeze the box on grab for a frame/group transform currently at identity.
      if (handle && isIdentityTransform(getT())) {
        if (isDraw && scope === "frame" && frameRk) frameRk.cell.transformBox = base;
        else if (isDraw && scope === "group" && g) g.transformBox = base;
      }
      refDrag = { handle, start: pc, startT: { ...getT() }, center: transformCenter(base, getT()) };
    }
    const d = refDrag;
    if (d.handle) {
      if (d.handle === "body") setT(applyMove(d.startT, pc.x - d.start.x, pc.y - d.start.y));
      else if (d.handle === "rotate") setT(applyRotate(d.startT, d.center, d.start, pc));
      else setT(applyScale(d.startT, d.center, d.start, pc));
      bump();
    }
    if (done) refDrag = null;
  }

  function onStroke(points: InputPoint[], done: boolean) {
    if (pickingGesture) {
      // A pick already consumed this gesture (the tool has since switched); ignore its move/up.
      if (done) pickingGesture = false;
      return;
    }
    if (appState.tool === "eyedropper") {
      if (points.length === 1) {
        const hex = sampleAt(points[0]);
        if (hex) {
          applyEyedropper(hex); // sets color + switches the tool back
          if (!done) pickingGesture = true; // swallow the rest of this gesture
        }
      }
      return;
    }
    const al = activeLayer();
    if (al.kind === "ref" || (al.kind === "draw" && appState.tool === "transform")) {
      onTransformDrag(al, points, done);
      return;
    }
    // Selection is disabled while the active draw layer is transformed (Apply first).
    if (
      (appState.tool === "select" ||
        appState.tool === "lasso" ||
        appState.tool === "deform" ||
        appState.tool === "pose") &&
      al.kind === "draw" &&
      !isIdentityTransform(al.transform)
    )
      return;
    if (appState.tool === "pose") {
      const p = points[points.length - 1];
      if (!meshPose) {
        if (points.length === 1 && !done) enterPose();
        return;
      }
      if (points.length === 1 && !done) {
        // Press: gizmo nub first, then handle body, then add a handle.
        const nub = poseNubPos();
        if (nub && Math.hypot(nub.x - p.x, nub.y - p.y) <= 12 / viewport.zoom) {
          poseAdjusting = true;
        } else {
          const hit = meshPose.handleAt(p, 10 / viewport.zoom);
          activeHandle = hit !== null ? hit : meshPose.addHandleAt(p);
          poseDrag = activeHandle;
        }
        posePaint();
      } else if (!done) {
        if (poseAdjusting && activeHandle !== null) {
          // Coupled: direction sets rotation, distance sets reach (snap to unlimited past the extent).
          const c = meshPose.deformed[meshPose.handles[activeHandle].vertex];
          const d = Math.hypot(p.x - c.x, p.y - c.y);
          meshPose.rotateHandle(activeHandle, Math.atan2(p.y - c.y, p.x - c.x));
          meshPose.setReach(activeHandle, d >= poseReachMax() ? undefined : d);
          posePaint();
        } else if (poseDrag !== null) {
          meshPose.dragHandle(poseDrag, p);
          posePaint();
        }
      } else {
        poseDrag = null;
        poseAdjusting = false;
      }
      return;
    }
    if (appState.tool === "deform") {
      const p = points[points.length - 1];
      if (selection.state !== "warping") {
        if (points.length === 1 && !done) enterDeform(); // first press lifts + enters the grid
        return;
      }
      if (points.length === 1 && !done) {
        const handle = selection.hitTest(p.x, p.y);
        if (handle === "grid") {
          selectionMode = "drag";
          selection.startDrag(handle, p.x, p.y);
        }
      } else if (!done) {
        if (selectionMode === "drag") selection.updateDrag(p.x, p.y);
      } else {
        if (selectionMode === "drag") selection.endDrag();
        selectionMode = null;
      }
      return;
    }
    if (appState.tool === "select" || appState.tool === "lasso") {
      const p = points[points.length - 1];
      if (points.length === 1 && !done) {
        const handle = selection.hitTest(p.x, p.y);
        if (selection.state === "selected" && handle === "move") {
          // First grab inside a fresh marquee: lift the pixels and enter transform mode.
          const layer = activeLayer();
          if (layer.kind !== "draw" || layer.locked) return;
          const canvas = ensureDrawableKeyframe(layer, appState.playhead, canvasOps);
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
        } else if (
          (selection.state === "transforming" || selection.state === "warping") &&
          handle
        ) {
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
    if (appState.tool === "fill") {
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
      strokeCanvas = ensureDrawableKeyframe(layer, appState.playhead, canvasOps);
      strokeCtx = strokeCanvas.getContext("2d", { willReadFrequently: true })!;
      beforeSnapshot = strokeCtx.getImageData(0, 0, strokeCanvas.width, strokeCanvas.height);
      if (activeStroke().brushType === "ink") resetInkState();
      else if (activeStroke().brushType !== "smooth") resetStampState();
      bump();
    }

    // Throttle drawing + compositing to one animation frame (defer non-final events);
    // finalize synchronously on stroke end so the undo snapshot captures the exact result.
    lastPoints = points;
    if (done) {
      if (drawRaf) {
        cancelAnimationFrame(drawRaf);
        drawRaf = 0;
      }
      paintStroke(points, true);
      const after = strokeCtx!.getImageData(0, 0, strokeCanvas!.width, strokeCanvas!.height);
      const target = strokeCtx!;
      const before = beforeSnapshot!;
      history.push({
        undo: () => {
          target.putImageData(before, 0, 0);
          recomposite();
        },
        redo: () => {
          target.putImageData(after, 0, 0);
          recomposite();
        },
      });
      strokeCanvas = null;
      strokeCtx = null;
      beforeSnapshot = null;
      bump(); // refresh the timeline (e.g. an empty cell that just gained ink flips ·→◆)
    } else if (!drawRaf) {
      drawRaf = requestAnimationFrame(() => {
        drawRaf = 0;
        if (strokeCtx) paintStroke(lastPoints, false);
      });
    }
  }

  function setupSelection() {
    overlay.width = appState.project.width;
    overlay.height = appState.project.height;
    overlay.style.width = `${appState.project.width}px`;
    overlay.style.height = `${appState.project.height}px`;

    selection = new Selection(overlay);
    selection.mode = "rect";
    selection.screenScale = viewport.zoom;
    viewport.onChange = () => {
      selection.screenScale = viewport.zoom;
    };

    selection.onChange = () => recomposite();
    selection.onStateChange = () => {
      recomposite();
      appState.selectionActive = !!selection && selection.active && !selection.hasFloating;
    };

    selection.onCommit = () => {
      if (!selCtx || !selBefore) return;
      // renderFloatingTo blits the floating pixels via a CSS-coord matrix → needs dpr.
      selCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
      selection.renderFloatingTo(selCtx);
      const ctx = selCtx;
      const before = selBefore;
      const after = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
      history.push({
        undo: () => {
          ctx.putImageData(before, 0, 0);
          recomposite();
        },
        redo: () => {
          ctx.putImageData(after, 0, 0);
          recomposite();
        },
      });
      selCtx = null;
      selBefore = null;
      bump();
      recomposite();
    };

    selection.onCancel = () => {
      if (selCtx && selBefore) {
        selCtx.putImageData(selBefore, 0, 0);
        recomposite();
      }
      selCtx = null;
      selBefore = null;
    };

    selectionRef.current = selection;
    liftGuard.discard = discardActiveEdits;
    poseActions.active = () => meshPose !== null;
    poseActions.apply = () => applyPose();
    poseActions.cancel = () => cancelPose();
  }

  // Read-only ctx of the resolved key shown at the current frame (for copy — never materializes a key).
  function activeResolvedCtx(): CanvasRenderingContext2D | null {
    const layer = activeLayer();
    if (layer.kind !== "draw") return null;
    const rk = resolvedKeyCell(layer, appState.playhead);
    if (!rk) return null;
    const ctx = rk.cell.canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return ctx;
  }
  // Drawable ctx for the current frame (for delete/paste — materializes a key on a hold). Null if the
  // active layer isn't an unlocked drawing layer.
  function activeDrawableCtx(): CanvasRenderingContext2D | null {
    const layer = activeLayer();
    if (layer.kind !== "draw" || layer.locked) return null;
    const canvas = ensureDrawableKeyframe(layer, appState.playhead, canvasOps);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return ctx;
  }

  function copySelection() {
    if (!selection || selection.state !== "selected" || !selection.rect) return;
    const ctx = activeResolvedCtx();
    if (!ctx) return;
    const float = selection.copyPixels(ctx, DPR);
    if (float) {
      selectionClipboard = { canvas: float, rect: { ...selection.rect } };
      appState.hasPixelClipboard = true;
    }
  }

  function deleteSelection() {
    if (!selection || selection.state !== "selected") return;
    const ctx = activeDrawableCtx();
    if (!ctx) return;
    const before = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    selection.clearRegion(ctx, DPR);
    const after = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    history.push({
      undo: () => {
        ctx.putImageData(before, 0, 0);
        bump();
      },
      redo: () => {
        ctx.putImageData(after, 0, 0);
        bump();
      },
    });
    selection.cancel(); // clear the marquee (no float → onCancel no-ops)
    bump();
  }

  function cutSelection() {
    copySelection();
    deleteSelection();
  }

  function pasteSelection(): boolean {
    if (!selectionClipboard) return false;
    liftGuard.discard?.(); // drop any in-progress lift before setting up the new float
    const ctx = activeDrawableCtx();
    if (!ctx) return false;
    selCtx = ctx;
    selBefore = selCtx.getImageData(0, 0, selCtx.canvas.width, selCtx.canvas.height); // for the commit undo
    const r = selectionClipboard.rect;
    selection?.pasteFloat(cloneCanvas(selectionClipboard.canvas), {
      x: r.x + PASTE_OFFSET,
      y: r.y + PASTE_OFFSET,
      w: r.w,
      h: r.h,
    });
    appState.tool = "select"; // show the transform gizmo; Enter commits / Esc cancels
    bump();
    return true;
  }

  function enterTransform() {
    if (!selection || selection.state !== "selected") return;
    const layer = activeLayer();
    if (layer.kind !== "draw" || layer.locked) return;
    const canvas = ensureDrawableKeyframe(layer, appState.playhead, canvasOps);
    selCtx = canvas.getContext("2d", { willReadFrequently: true })!;
    selBefore = selCtx.getImageData(0, 0, canvas.width, canvas.height);
    // See note in onStroke: the cell ctx must carry the dpr transform for lift/commit.
    selCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const lifted = selection.liftPixels(selCtx, DPR);
    if (!lifted) return;
    selection.beginTransform(lifted);
    recomposite();
  }

  function enterDeform() {
    const al = activeLayer();
    if (al.kind !== "draw" || al.locked || !isIdentityTransform(al.transform)) return;
    const canvas = ensureDrawableKeyframe(al, appState.playhead, canvasOps);
    const rect = contentRectLogical(contentBounds(canvas, appState.version), DPR);
    if (!rect) return; // empty cell → nothing to deform
    // Clear any leftover selection (esp. a lasso path) so liftPixels uses our content rect, not a
    // stale lasso clip. cancel() reverts an in-progress lift (onCancel no-ops when nothing's lifted).
    selection.cancel();
    selCtx = canvas.getContext("2d", { willReadFrequently: true })!;
    selBefore = selCtx.getImageData(0, 0, canvas.width, canvas.height);
    selCtx.setTransform(DPR, 0, 0, DPR, 0, 0); // liftPixels operates in CSS/logical coords
    selection.rect = rect;
    const lifted = selection.liftPixels(selCtx, DPR);
    if (!lifted) {
      selCtx = null;
      selBefore = null;
      return;
    }
    selection.beginTransform(lifted);
    selection.beginWarp(4, 4);
  }

  // Reactive gate for the pose bar: read the proxy's version (reactive) so the bar
  // re-evaluates whenever bump() runs on enter/apply/cancel. meshPose itself is kept as a
  // plain local rather than migrated to `$state` (this file now aliases the store import as
  // `appState` — see CLAUDE.md gotcha #1 — so a rune would no longer conflict, but that's out
  // of scope for this change).
  function poseBarVisible(): boolean {
    return appState.version >= 0 && meshPose !== null;
  }

  // Rotate-nub: a dot at a fixed screen radius around the active handle; dragging it sets the angle.
  function poseReachMax(): number {
    return meshPose ? Math.hypot(meshPose.rect.w, meshPose.rect.h) : 0; // beyond full extent = unlimited
  }
  // Single gizmo nub: direction from the handle = rotation angle, distance = reach (mesh extent if unlimited).
  function poseNubPos(): { x: number; y: number } | null {
    if (!meshPose || activeHandle === null) return null;
    const h = meshPose.handles[activeHandle];
    const c = meshPose.deformed[h.vertex];
    const r = h.reach ?? poseReachMax();
    return { x: c.x + r * Math.cos(h.angle), y: c.y + r * Math.sin(h.angle) };
  }

  function posePaint() {
    const octx = overlay.getContext("2d")!;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (meshPose && activeLayer().visible) {
      meshPose.render(octx);
      meshPose.drawWireframe(octx);
      if (activeHandle !== null) {
        const h = meshPose.handles[activeHandle];
        const c = meshPose.deformed[h.vertex];
        const r = h.reach ?? poseReachMax();
        const nub = poseNubPos()!;
        // affected-region tint (only when reach is finite — the true geodesic extent)
        if (h.reach != null) {
          const mask = meshPose.reachMask(activeHandle);
          octx.fillStyle = "rgba(0,200,120,0.18)";
          for (const [ta, tb, tc] of meshPose.triangles) {
            if (mask[ta] && mask[tb] && mask[tc]) {
              const va = meshPose.deformed[ta],
                vb = meshPose.deformed[tb],
                vc = meshPose.deformed[tc];
              octx.beginPath();
              octx.moveTo(va.x, va.y);
              octx.lineTo(vb.x, vb.y);
              octx.lineTo(vc.x, vc.y);
              octx.closePath();
              octx.fill();
            }
          }
        }
        // reach dial circle (faint/dashed when unlimited)
        octx.strokeStyle = h.reach == null ? "rgba(0,128,255,0.25)" : "rgba(0,128,255,0.6)";
        octx.lineWidth = 1 / viewport.zoom;
        octx.setLineDash(h.reach == null ? [6 / viewport.zoom, 4 / viewport.zoom] : []);
        octx.beginPath();
        octx.arc(c.x, c.y, r, 0, Math.PI * 2);
        octx.stroke();
        octx.setLineDash([]);
        // hand line + nub (direction = rotation, distance = reach)
        octx.strokeStyle = "rgba(0,128,255,0.7)";
        octx.lineWidth = 1.5 / viewport.zoom;
        octx.beginPath();
        octx.moveTo(c.x, c.y);
        octx.lineTo(nub.x, nub.y);
        octx.stroke();
        octx.fillStyle = "#0080ff";
        octx.beginPath();
        octx.arc(nub.x, nub.y, 5 / viewport.zoom, 0, Math.PI * 2);
        octx.fill();
        octx.strokeStyle = "#fff";
        octx.lineWidth = 1.5 / viewport.zoom;
        octx.stroke();
      }
    }
  }

  function enterPose() {
    const al = activeLayer();
    if (al.kind !== "draw" || al.locked || !isIdentityTransform(al.transform)) return;
    const canvas = ensureDrawableKeyframe(al, appState.playhead, canvasOps);
    const rect = contentRectLogical(contentBounds(canvas, appState.version), DPR);
    if (!rect) return;
    selection.cancel(); // clear any stale selection/lasso so liftPixels uses our content rect
    selCtx = canvas.getContext("2d", { willReadFrequently: true })!;
    selBefore = selCtx.getImageData(0, 0, canvas.width, canvas.height);
    selCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    selection.rect = rect;
    const lifted = selection.liftPixels(selCtx, DPR); // clears the content region from the cell
    if (!lifted) {
      selCtx = null;
      selBefore = null;
      return;
    }
    meshPose = MeshPose.fromLift(lifted, rect, DPR, poseSpacing);
    if (!meshPose) {
      if (selBefore) selCtx.putImageData(selBefore, 0, 0); // no mesh → undo the lift
      selCtx = null;
      selBefore = null;
      recomposite();
      return;
    }
    recomposite(); // show the hole where the content lifted out
    posePaint(); // draw the deformed raster + wireframe on the overlay
    bump(); // bump version so the reactive pose bar mounts
  }

  function applyPose() {
    if (!meshPose || !selCtx || !selBefore) return;
    selCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    meshPose.render(selCtx); // bake the deformed raster into the cell
    const ctx = selCtx;
    const before = selBefore;
    const after = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    history.push({
      undo: () => {
        ctx.putImageData(before, 0, 0);
        recomposite();
      },
      redo: () => {
        ctx.putImageData(after, 0, 0);
        recomposite();
      },
    });
    meshPose = null;
    poseDrag = null;
    activeHandle = null;
    poseAdjusting = false;
    selCtx = null;
    selBefore = null;
    posePaint(); // meshPose null → clears overlay
    bump();
    recomposite();
  }

  function cancelPose() {
    if (meshPose && selCtx && selBefore) selCtx.putImageData(selBefore, 0, 0);
    meshPose = null;
    poseDrag = null;
    activeHandle = null;
    poseAdjusting = false;
    selCtx = null;
    selBefore = null;
    posePaint();
    recomposite();
    bump(); // bump version so the reactive pose bar unmounts
  }

  function poseDensity(delta: number) {
    if (!meshPose) return;
    poseSpacing = Math.max(4, poseSpacing + delta * 4);
    // rebuild from the SAME lifted img (resets handles — vertex indices change)
    meshPose = MeshPose.fromLift(meshPose.img, meshPose.rect, DPR, poseSpacing) ?? meshPose;
    poseDrag = null;
    activeHandle = null;
    poseAdjusting = false;
    posePaint();
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
    scratch.width = appState.project.width * DPR;
    scratch.height = appState.project.height * DPR;
    scratchCtx = scratch.getContext("2d")!;
    sizeDisplay();
    viewport = new Viewport(wrapper);
    stage.addEventListener("pointerdown", stagePanDown, { capture: true });
    stage.addEventListener("pointermove", stagePanMove, { capture: true });
    stage.addEventListener("pointerup", stagePanUp, { capture: true });
    stage.addEventListener("pointercancel", stagePanUp, { capture: true });
    window.addEventListener("keydown", onViewKeyDown);
    window.addEventListener("keyup", onViewKeyUp);
    window.addEventListener("blur", onViewBlur);
    recomposite();
    setupSelection();

    // Finger gestures: 1-finger pan, 1-finger double-tap toggle eraser, 2-finger pinch zoom+rotate,
    // 2-finger tap undo, 3-finger tap redo. The Apple Pencil (pointerType "pen") bypasses this and draws.
    const cleanupTouch = setupTouchGestures(stage, viewport, {
      onUndo: () => undo(),
      onRedo: () => redo(),
      onToggleEraser: () => toggleEraser(),
      onViewportChange: () => {
        selection.screenScale = viewport.zoom;
      },
    });

    const cleanup = setupInput(display, onStroke, (sx, sy) => viewport.screenToCanvas(sx, sy), {
      streamline: () => activeStroke().streamline / 100,
    });

    // Recomposite when the document changes elsewhere (frame step, layer toggle…).
    let lastVersion = appState.version;
    let lastPlayhead = appState.playhead;
    let lastW = appState.project.width;
    let lastH = appState.project.height;
    const tick = () => {
      const dimsChanged = appState.project.width !== lastW || appState.project.height !== lastH;
      if (dimsChanged) {
        lastW = appState.project.width;
        lastH = appState.project.height;
        sizeDisplay();
        scratch.width = appState.project.width * DPR;
        scratch.height = appState.project.height * DPR;
        overlay.width = appState.project.width;
        overlay.height = appState.project.height;
        overlay.style.width = `${appState.project.width}px`;
        overlay.style.height = `${appState.project.height}px`;
      }
      if (dimsChanged || appState.version !== lastVersion || appState.playhead !== lastPlayhead) {
        lastVersion = appState.version;
        lastPlayhead = appState.playhead;
        syncReferenceVideos(appState.project, appState.playhead, appState.project.fps);
        recomposite();
      }
      raf = requestAnimationFrame(tick);
    };
    let raf = requestAnimationFrame(tick);

    selectionActions.enterWarp = enterWarp;
    selectionActions.copy = copySelection;
    selectionActions.cut = cutSelection;
    selectionActions.del = deleteSelection;
    selectionActions.paste = pasteSelection;

    return () => {
      cleanup();
      cleanupTouch();
      stage.removeEventListener("pointerdown", stagePanDown, { capture: true });
      stage.removeEventListener("pointermove", stagePanMove, { capture: true });
      stage.removeEventListener("pointerup", stagePanUp, { capture: true });
      stage.removeEventListener("pointercancel", stagePanUp, { capture: true });
      window.removeEventListener("keydown", onViewKeyDown);
      window.removeEventListener("keyup", onViewKeyUp);
      window.removeEventListener("blur", onViewBlur);
      cancelAnimationFrame(raf);
      if (drawRaf) cancelAnimationFrame(drawRaf);
      selection?.cancel(); // stop the marching-ants rAF loop (and revert any live lift) on teardown
      selectionRef.current = null;
      liftGuard.discard = null;
      poseActions.active = () => false;
      selectionActions.enterWarp = null;
      selectionActions.copy = null;
      selectionActions.cut = null;
      selectionActions.del = null;
      selectionActions.paste = null;
      appState.selectionActive = false;
    };
  });

  $effect(() => {
    const t = appState.tool;
    if (!selection) return;
    // Leaving the deform tool banks the floating warp (one undo step via onCommit).
    if (prevTool === "deform" && t !== "deform" && selection.hasFloating) selection.commit();
    if (prevTool === "pose" && t !== "pose" && meshPose) applyPose();
    prevTool = t;
    if (t === "select") selection.mode = "rect";
    else if (t === "lasso") selection.mode = "lasso";
    else {
      // Any other tool (incl. deform): bank a floating transform so it isn't discarded. (Switching to
      // deform used to skip this, then enterDeform's cancel() reverted the in-progress move/scale.)
      if (selection.hasFloating) selection.commit();
      if (t !== "deform") selectionMode = null; // deform manages its own selectionMode on entry
    }
    // t === "deform": lift entry happens on the first canvas press (onStroke).
  });

  // Bank any in-progress lift (pose / selection transform / deform warp) into the layer/frame it was
  // started on, so switching the active layer or frame leaves a clean slate — mirrors the tool-switch
  // banker. A plain marquee is document-level and kept; the gizmo-based layer transform self-retargets.
  function bankActiveEdits() {
    if (meshPose) applyPose();
    if (selection?.hasFloating) selection.commit();
  }
  // Discard (don't bank) an in-progress lift — for ops that destroy/replace the target canvas or replay
  // history (resize / replaceProject / undo / redo), where banking has no valid target. Restores the
  // original pixels via the captured context, so the destructive op then sees the un-lifted cell.
  function discardActiveEdits() {
    if (meshPose) cancelPose();
    if (selection?.hasFloating) selection.cancel(); // only an actual lift (not a plain marquee)
  }
  $effect(() => {
    const layer = appState.activeLayerId;
    const ph = appState.playhead;
    if (layer !== prevLayer || ph !== prevPlayhead) {
      prevLayer = layer;
      prevPlayhead = ph;
      bankActiveEdits();
    }
  });

  // The edited layer's content is lifted into the overlay (pose mesh / floating / warp), which would
  // otherwise ignore `visible`. Mirror the active layer's visibility onto the overlays so hiding it
  // hides the in-progress edit too (non-destructively — the lift stays alive).
  $effect(() => {
    const al = activeLayer();
    if (selection) selection.hidden = !al.visible;
    if (meshPose) posePaint();
    // Can't keep editing a layer that just got locked → discard the in-progress lift.
    if (al.kind === "draw" && al.locked && (meshPose || selection?.hasFloating))
      discardActiveEdits();
  });

  // Wheel/trackpad: plain scroll pans; ⌘/Ctrl + scroll (and trackpad pinch, which arrives as
  // ctrl+wheel) zooms at the cursor.
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) viewport?.zoomAt(e.clientX, e.clientY, e.deltaY);
    else viewport?.panBy(-e.deltaX, -e.deltaY); // content follows the scroll
  }
</script>

<div
  bind:this={stage}
  class="relative flex-1 overflow-hidden bg-canvas-bg touch-none"
  class:cursor-none={appState.tool === "brush" || appState.tool === "eraser"}
  class:cursor-crosshair={appState.tool === "eyedropper"}
  style:cursor={panning ? "grabbing" : spaceHeld ? "grab" : null}
  onwheel={onWheel}
>
  <div bind:this={wrapper} class="absolute left-0 top-0">
    {#if appState.project.transparentBg}
      <div
        class="absolute left-0 top-0 pointer-events-none"
        style="width:{appState.project.width}px; height:{appState.project.height}px;
               background-color:#fff;
               background-image:
                 linear-gradient(45deg,#ccc 25%,transparent 25%),
                 linear-gradient(-45deg,#ccc 25%,transparent 25%),
                 linear-gradient(45deg,transparent 75%,#ccc 75%),
                 linear-gradient(-45deg,transparent 75%,#ccc 75%);
               background-size:16px 16px;
               background-position:0 0,0 8px,8px -8px,-8px 0;"
      ></div>
    {/if}
    <canvas bind:this={display} class="absolute left-0 top-0 shadow-lg touch-none"></canvas>
    <canvas bind:this={overlay} class="absolute left-0 top-0 pointer-events-none"></canvas>
  </div>
  <SelectionActions
    getSelection={() => selection}
    getViewport={() => viewport}
    getContainer={() => stage}
    onTransform={enterTransform}
    onDistort={() => enterWarp(2, 2)}
    onMesh={() => enterWarp(3, 3)}
    onCommit={() => selection?.commit()}
    onCancel={() => selection?.cancel()}
    onDensify={(d) => {
      if (!selection) return;
      const n = clampDensity(selection.warpRows + d);
      selection.densifyWarp(n, n);
    }}
    onSetDeformMode={(m) => selection?.setDeformMode(m)}
    onResetPins={() => selection?.resetPins()}
  />

  <RefTransformGizmo getViewport={() => viewport} getContainer={() => stage} />
  <BrushCursor
    getViewport={() => viewport}
    getContainer={() => stage}
    sampleColor={(cx, cy) => {
      if (!viewport) return null;
      return sampleAt(viewport.screenToCanvas(cx, cy));
    }}
  />
  {#if poseBarVisible()}
    <div
      class="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1 rounded bg-surface border border-border shadow-lg z-10"
    >
      <button
        class="px-2 py-1 text-xs border border-border rounded bg-surface hover:bg-surface-hover"
        title="Coarser mesh"
        onpointerdown={(e) => {
          e.preventDefault();
          poseDensity(-1);
        }}>−</button
      >
      <button
        class="px-2 py-1 text-xs border border-border rounded bg-surface hover:bg-surface-hover"
        title="Denser mesh"
        onpointerdown={(e) => {
          e.preventDefault();
          poseDensity(1);
        }}>+</button
      >
      <button
        class="px-2 py-1 text-xs border border-border rounded bg-surface hover:bg-surface-hover"
        title="Reset handles"
        onpointerdown={(e) => {
          e.preventDefault();
          meshPose?.resetHandles();
          poseDrag = null;
          activeHandle = null;
          poseAdjusting = false;
          posePaint();
        }}>Reset</button
      >
      <button
        class="px-2 py-1 text-xs border border-border rounded bg-accent text-accent-text"
        title="Apply pose"
        onpointerdown={(e) => {
          e.preventDefault();
          applyPose();
        }}>Apply</button
      >
      <button
        class="px-2 py-1 text-xs border border-border rounded bg-surface hover:bg-surface-hover"
        title="Cancel pose"
        onpointerdown={(e) => {
          e.preventDefault();
          cancelPose();
        }}>Cancel</button
      >
    </div>
  {/if}
</div>
