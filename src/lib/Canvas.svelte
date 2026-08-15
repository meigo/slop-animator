<script lang="ts">
  import { onMount } from "svelte";
  import { setupInput, type InputPoint } from "../core/input";
  import { Viewport } from "../core/viewport";
  import { setupTouchGestures } from "../core/touch-gestures";
  import { drawStroke } from "../core/brush";
  import { floodFill, hexToRgba, rgbToHex } from "../core/fill";
  import { drawCellComposed, renderFrame } from "../anim/render";
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
    beginStructuralEdit,
    commitStructuralEdit,
  } from "../state/appState.svelte";
  import { pixelCommand } from "../anim/history";
  import {
    selectionRef,
    selectionActions,
    viewActions,
    poseActions,
    liftGuard,
    transformDragGuard,
    playbackController,
  } from "../state/appState.svelte";
  import { drawStampStrokeIncremental, resetStampState } from "../core/stamp-brush";
  import { drawInkStrokeIncremental, resetInkState } from "../core/ink-brush";
  import { syncReferenceVideos } from "../anim/reference";
  import { Selection, type SelectionRect } from "../core/selection";
  import { inverseComposeMatrix, needsMap } from "../core/selection-map";
  import SelectionActions from "./SelectionActions.svelte";
  import RefTransformGizmo from "./RefTransformGizmo.svelte";
  import BrushCursor from "./BrushCursor.svelte";
  import LayerBoundsHint from "./LayerBoundsHint.svelte";
  import {
    transformBaseRect,
    isIdentityTransform,
    isSameTransform,
    cellTransform,
    resolvedKeyCell,
    cloneCanvas,
    groupOf,
    groupHasLockedLayer,
    isLayerEditable,
    isLayerLocked,
    isLayerVisible,
    groupTransform,
    type Layer,
    type Cell,
    type LayerGroup,
  } from "../anim/document";
  import { contentBoxLogical, groupBoxLogical, contentBounds } from "./cell-ink";
  import { contentRectLogical, clampDensity } from "../core/deform";
  import { MeshPose } from "../core/mesh-pose";
  import { outlineFillFailed, clampGap, MAX_GAP } from "../core/fill-holes";
  import type { Tool } from "../state/appState.svelte";
  import {
    hitTestHandle,
    transformCenter,
    applyMove,
    applyScale,
    applyRotate,
    inverseChain,
    forwardChain,
    type Handle,
    type Pt,
    type ComposeStep,
    type Rect,
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

  /** Full paint compose [cell, layer, group] — same chain paintStroke / doFill invert. */
  function cellComposeSteps(layer: Layer): ComposeStep[] {
    if (layer.kind !== "draw") return layerComposeSteps(layer);
    const W = appState.project.width,
      H = appState.project.height;
    const rk = resolvedKeyCell(layer, appState.playhead);
    const cellT = rk ? cellTransform(rk.cell) : IDENTITY;
    const cellBox = rk
      ? contentBoxLogical(rk.cell.canvas, rk.cell.transformBox, W, H, DPR, appState.version)
      : { x: 0, y: 0, w: W, h: H };
    return [{ base: cellBox, t: cellT }, ...layerComposeSteps(layer)];
  }

  function composeScaleOf(steps: ComposeStep[]): number {
    return steps.reduce((s, step) => s * step.t.scale, 1);
  }

  /** Document-space point → cell-local (inverse of group ∘ layer ∘ cell). */
  function toCellSpace(p: { x: number; y: number }): { x: number; y: number } {
    const al = activeLayer();
    if (al.kind !== "draw") return p;
    const steps = cellComposeSteps(al);
    if (!steps.some((s) => !isIdentityTransform(s.t))) return p;
    return inverseChain(steps, p);
  }

  /** Cell-local point → document space: the point-wise twin of applyOverlayCompose (used to anchor
   *  the on-canvas action bar to a cell-space lift, which lives under the same compose). */
  function composeToDoc(p: { x: number; y: number }): { x: number; y: number } {
    const al = activeLayer();
    if (al.kind !== "draw") return p;
    return forwardChain(cellComposeSteps(al), p);
  }

  /** Apply group ∘ layer ∘ cell to an overlay ctx (logical px, dpr = 1). Outer first. */
  function applyOverlayCompose(ctx: CanvasRenderingContext2D) {
    const al = activeLayer();
    if (al.kind !== "draw") return;
    const steps = cellComposeSteps(al);
    if (!steps.some((s) => !isIdentityTransform(s.t))) return;
    for (const s of [...steps].reverse()) {
      const cx = s.base.x + s.base.w / 2;
      const cy = s.base.y + s.base.h / 2;
      ctx.translate(cx + s.t.dx, cy + s.t.dy);
      ctx.rotate(s.t.rotation);
      ctx.scale(s.t.scale, s.t.scale);
      ctx.translate(-cx, -cy);
    }
  }

  /** Invert applyOverlayCompose: inner-to-outer, each step inverted. Logical px. The math lives in
   *  `inverseComposeMatrix` (pure + unit-tested against inverseChain) — this only installs it. */
  function applyInverseCompose(ctx: CanvasRenderingContext2D, steps: ComposeStep[]) {
    if (!needsMap(steps)) return;
    const m = inverseComposeMatrix(steps);
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  }

  function syncOverlayScale() {
    if (!selection || !viewport) return;
    // A cell-space lift (deform) draws through applyCompose, so one screen px is 1/(zoom × compose
    // scale) there; document-space geometry only sees the viewport zoom.
    const al = activeLayer();
    const composeScale =
      selection.cellSpaceLift && al.kind === "draw" ? composeScaleOf(cellComposeSteps(al)) : 1;
    selection.screenScale = viewport.zoom * composeScale;
  }

  /** Keep `selection.composeSteps` on the active layer — EXCEPT while a lift owns them. Deform and
   *  pose deliberately clear them (their lift is cell-space, gotcha #13); re-asserting the layer's
   *  chain from the rAF tick silently undid that. A paper-crop float keeps its lift-time chain. */
  function syncComposeSteps() {
    if (!selection || selection.hasFloating || meshPose) return;
    const al = activeLayer();
    selection.composeSteps = al.kind === "draw" ? cellComposeSteps(al) : [];
  }

  /** Map document space onto the stage-sized overlay (same pan/rotate/zoom as the CSS wrapper). */
  function applyViewTransform(ctx: CanvasRenderingContext2D) {
    if (!viewport) return;
    ctx.translate(viewport.panX, viewport.panY);
    ctx.rotate(viewport.rotation);
    ctx.scale(viewport.zoom, viewport.zoom);
  }

  function sizeOverlay() {
    if (!overlay || !stage) return;
    const w = Math.max(1, stage.clientWidth);
    const h = Math.max(1, stage.clientHeight);
    if (overlay.width !== w || overlay.height !== h) {
      overlay.width = w;
      overlay.height = h;
      // Setting width/height clears the bitmap — put the marquee/float back.
      selection?.drawOverlay();
      repaintPoseOverlay();
    }
  }

  /** The overlay is stage-sized and bakes the view transform in at paint time, so every pan / zoom /
   *  resize has to repaint it. The marquee self-heals from its own marching-ants rAF; the pose mesh
   *  has no such loop, so without this it sits still while the artwork slides out from under it.
   *  Coalesced to one frame like `drawRaf`: a pinch fires the viewport hooks per raw pointermove. */
  function repaintPoseOverlay() {
    if (!meshPose || poseRaf) return;
    poseRaf = requestAnimationFrame(() => {
      poseRaf = 0;
      if (meshPose) posePaint();
    });
  }

  let display: HTMLCanvasElement;
  let displayCtx: CanvasRenderingContext2D;
  let viewport: Viewport;
  let stage: HTMLDivElement;
  let spaceHeld = $state(false);
  let panning = $state(false);
  // Space is shared: HOLD pans (Photoshop habit), a quick TAP toggles playback (animation habit).
  // A tap counts only if the key was down briefly AND no pan drag happened, so abandoning a pan
  // (hold, don't drag, release) doesn't start playback.
  const SPACE_TAP_MS = 300;
  let spaceDownAt = 0;
  let spacePanned = false;

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
    if (spaceHeld) spacePanned = true; // this Space press became a pan → its release isn't a tap
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
      if (!spaceHeld) {
        spaceDownAt = e.timeStamp;
        spacePanned = false;
      }
      spaceHeld = true;
      e.preventDefault();
    } else if (e.key === "0") {
      e.preventDefault();
      viewport?.fitView(appState.project.width, appState.project.height);
    }
  }
  function onViewKeyUp(e: KeyboardEvent) {
    if (e.key !== " ") return;
    spaceHeld = false;
    if (!spacePanned && e.timeStamp - spaceDownAt < SPACE_TAP_MS) playbackController.toggle();
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
  // Compose at lift/paste time. Commit inverts *this*, not live activeLayer() —
  // bankActiveEdits runs after the layer/playhead has already changed.
  let liftComposeSteps: ComposeStep[] = [];
  const PASTE_OFFSET = 8; // logical px — so a paste-in-place reads as a new copy
  // $state so the floating Paste button reacts to copy/cut filling the clipboard.
  let selectionClipboard = $state<{ canvas: HTMLCanvasElement; rect: SelectionRect } | null>(null);
  // Pose tool: lifted mesh + the handle index currently being dragged.
  let meshPose: MeshPose | null = null;
  let poseDrag: number | null = null;
  let activeHandle: number | null = null;
  let poseAdjusting = false;
  // Coalesces view-driven pose repaints (see repaintPoseOverlay); pose gestures still paint directly.
  let poseRaf = 0;
  const POSE_SPACING = 16; // device px; dev-viz-tuned mesh density
  let poseSpacing = POSE_SPACING;

  // The cell canvas being drawn on for the current stroke, and its undo snapshot.
  let strokeCanvas: HTMLCanvasElement | null = null;
  let strokeCtx: CanvasRenderingContext2D | null = null;
  let beforeSnapshot: ImageData | null = null;
  // Compose captured at stroke start — paintStroke must not re-read activeLayer/playhead.
  let strokeSteps: ComposeStep[] | null = null;
  // After a mid-stroke layer/frame switch we commit and ignore the rest of this pointer.
  let dropStrokeUntilUp = false;
  // Coalesce per-event drawing/compositing into one animation frame: the pen fires far
  // above the display refresh, so painting every event re-runs the full stroke wastefully.
  let drawRaf = 0;
  let lastPoints: InputPoint[] = [];

  // True once the current fill gesture has already filled (one fill per pointer press).
  let fillUsed = false;

  /** Backing-store scale so a CSS-zoomed view still has pixels for a scaled-down layer.
   *  Capped at 2× — cells stay DPR=1; only the one display canvas grows.
   *  QUANTISED to genuine steps: the viewport hooks fire per raw pointermove/wheel event, so a
   *  continuous scale meant a pinch reallocated the display + scratch backing stores and
   *  re-composited every layer on every touch sample. Stepping caps that at one realloc per crossing
   *  (and at worst renders a mid-step zoom from 1.5× pixels instead of, say, 1.7×). */
  const OUTPUT_SCALE_STEPS = [2, 1.5, 1];
  function displayOutputScale(): number {
    const z = viewport?.zoom ?? 1;
    return OUTPUT_SCALE_STEPS.find((s) => z >= s) ?? 1;
  }

  function sizeDisplay() {
    const ss = displayOutputScale();
    const w = Math.round(appState.project.width * DPR * ss);
    const h = Math.round(appState.project.height * DPR * ss);
    if (display.width !== w || display.height !== h) {
      display.width = w;
      display.height = h;
    }
    display.style.width = `${appState.project.width}px`;
    display.style.height = `${appState.project.height}px`;
    if (scratch && (scratch.width !== w || scratch.height !== h)) {
      scratch.width = w;
      scratch.height = h;
    }
  }

  function recomposite() {
    sizeDisplay();
    const ss = displayOutputScale();
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
        ss,
      );
    } else {
      // Line boil is a playback-only effect (so you never see your drawing warped while editing).
      const boil =
        appState.project.boil.enabled && appState.playback.isPlaying
          ? appState.project.boil
          : undefined;
      renderFrame(displayCtx, appState.project, appState.playhead, DPR, {
        drawBg: !appState.project.transparentBg,
        outputScale: ss,
        boil,
        version: appState.version,
      });
    }
  }

  function doFill(pt: { x: number; y: number }) {
    const layer = activeLayer();
    if (!isLayerEditable(layer, appState.project.groups)) return;
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
    history.push(
      pixelCommand(
        () => {
          ctx.putImageData(before, 0, 0);
          recomposite();
        },
        () => {
          ctx.putImageData(after, 0, 0);
          recomposite();
        },
        before,
        after,
      ),
    );
    bump();
    recomposite();
  }

  // Render the current stroke onto the cell ctx then recomposite. Smooth = full redraw
  // from the pre-stroke snapshot; stamp = incremental. Both clip to the active selection.
  function paintStroke(pts: InputPoint[], done: boolean) {
    if (!strokeCtx) return;
    let inPts = pts;
    const steps = strokeSteps;
    if (steps?.some((s) => !isIdentityTransform(s.t))) {
      inPts = pts.map((p) => {
        const q = inverseChain(steps, { x: p.x, y: p.y });
        return { ...p, x: q.x, y: q.y };
      });
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
    const ss = display.width / Math.max(1, appState.project.width * DPR);
    const px = Math.round(p.x * DPR * ss),
      py = Math.round(p.y * DPR * ss);
    if (px < 0 || py < 0 || px >= display.width || py >= display.height) return null;
    const [r, g, b] = displayCtx.getImageData(px, py, 1, 1).data;
    return rgbToHex(r, g, b);
  }

  let refDrag: {
    handle: Handle;
    start: Pt;
    startT: Layer["transform"];
    center: Pt;
    // Frame-scope grab-time clone target, so a mid-drag playhead move can be detected (else null).
    cell: Extract<Cell, { kind: "key" }> | null;
    // Grab-time target identity: a mid-gesture active-layer/group switch must not retarget the drag.
    layerId: number;
    groupId: number | null;
    // Did this gesture actually write a transform? Drives commit-vs-drop when we settle without a
    // readable end transform (undo/tool-switch), instead of committing an empty entry.
    dirty: boolean;
  } | null = null;
  // One undo step per completed transform drag: snapshot at grab, commit at release iff the
  // transform changed; on a no-op, revert the grab-time transformBox freeze instead (spec 2026-08-09).
  let refDragUndo: ReturnType<typeof beginStructuralEdit> | null = null;
  // Direct object refs captured at grab (not re-resolved via activeLayerId/playhead at release —
  // those can change mid-gesture, e.g. arrow-key frame nav while a mouse-drag is still captured).
  let refDragFreeze: {
    cell: Extract<Cell, { kind: "key" }> | null;
    group: LayerGroup | null;
    prevBox: Rect | null;
  } | null = null;

  // endT is a thunk: at the early-return sites the target is gone and there is no getT — pass null
  // there and commit unconditionally (the drag DID change state; an unrecorded change is the bug
  // this feature removes).
  function finishTransformDragUndo(endT: (() => Layer["transform"]) | null) {
    if (refDragUndo) {
      // Nothing was written (grab missed a handle, or settled from undo()/a tool switch before the
      // pointer moved) → drop the snapshot. Committing here pushed a before==after entry that the
      // caller's own undo then popped, so the user's undo silently did nothing.
      const wrote = !!refDrag?.handle && refDrag.dirty;
      const unchanged = wrote && endT && isSameTransform(refDrag!.startT, endT());
      if (wrote && !unchanged) {
        commitStructuralEdit(refDragUndo);
      } else if (wrote || refDrag?.handle) {
        // No-op drag: push nothing, revert the freeze we did at grab.
        if (refDragFreeze?.cell) refDragFreeze.cell.transformBox = refDragFreeze.prevBox;
        else if (refDragFreeze?.group) refDragFreeze.group.transformBox = refDragFreeze.prevBox;
      }
    }
    refDragUndo = null;
    refDragFreeze = null;
    transformDragGuard.settle = null;
  }

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
      if (groupHasLockedLayer(g, appState.project.layers)) {
        if (done) {
          finishTransformDragUndo(null);
          refDrag = null;
        }
        return;
      }
      getT = () => groupTransform(g);
      setT = (nt) => (g.transform = nt);
      base = groupBoxLogical(g, appState.project, appState.playhead, DPR, appState.version);
    } else if (isDraw && scope === "frame") {
      frameRk = resolvedKeyCell(layer as Extract<Layer, { kind: "draw" }>, appState.playhead);
      if (!frameRk) {
        if (done) {
          finishTransformDragUndo(null);
          refDrag = null;
        }
        return;
      }
      // Playhead moved mid-drag onto a different (un-cloned) cell: settle the in-flight drag on
      // the grab-time clone instead of writing to a snapshot-shared cell (gotcha #8 corruption).
      if (refDrag !== null && refDrag.cell && refDrag.cell !== frameRk.cell) {
        finishTransformDragUndo(null);
        refDrag = null;
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
      if (done) {
        finishTransformDragUndo(null);
        refDrag = null;
      }
      return;
    }

    // Pointer in target's local space: inverse-map through outer (outermost first → use inverseChain).
    const pc = inverseChain(outerSteps, p);

    // Mid-gesture retarget guard for ALL scopes: the active layer (or its group) can change while
    // the pointer is still down — the new global ↑/↓ layer keys make this easy. Frame scope had its
    // own cell-identity bail; layer/group scope had none and would apply the grab-time transform to
    // whatever layer became active. Settle the bracket and end the gesture instead.
    if (refDrag && (refDrag.layerId !== layer.id || refDrag.groupId !== (g?.id ?? null))) {
      finishTransformDragUndo(null);
      refDrag = null;
      return;
    }
    if (!refDrag) {
      const tol = 10 / viewport.zoom;
      const gap = REF_ROTATE_GAP_PX / viewport.zoom;
      const handle = hitTestHandle(base, getT(), pc, tol, gap);
      if (handle) {
        refDragUndo = beginStructuralEdit(); // FIRST: snapshot must capture the old shared cell (gotcha #8)
        transformDragGuard.settle = () => {
          finishTransformDragUndo(null);
          refDrag = null;
        };
        if (isDraw && scope === "frame" && frameRk) {
          const dl = layer as Extract<Layer, { kind: "draw" }>;
          dl.cells[frameRk.index] = { ...frameRk.cell }; // fresh object; in-drag writes can't corrupt the snapshot
          frameRk = { index: frameRk.index, cell: dl.cells[frameRk.index] as typeof frameRk.cell };
        }
        // Freeze the box on grab for a frame/group transform currently at identity.
        if (isIdentityTransform(getT())) {
          if (isDraw && scope === "frame" && frameRk) {
            refDragFreeze = {
              cell: frameRk.cell,
              group: null,
              prevBox: frameRk.cell.transformBox ?? null,
            };
            frameRk.cell.transformBox = base;
          } else if (isDraw && scope === "group" && g) {
            refDragFreeze = { cell: null, group: g, prevBox: g.transformBox ?? null };
            g.transformBox = base;
          }
        }
      }
      refDrag = {
        handle,
        start: pc,
        startT: { ...getT() },
        center: transformCenter(base, getT()),
        cell: isDraw && scope === "frame" ? (frameRk?.cell ?? null) : null,
        layerId: layer.id,
        groupId: g?.id ?? null,
        dirty: false,
      };
    }
    const d = refDrag;
    if (d.handle) {
      if (d.handle === "body") setT(applyMove(d.startT, pc.x - d.start.x, pc.y - d.start.y));
      else if (d.handle === "rotate") setT(applyRotate(d.startT, d.center, d.start, pc));
      else setT(applyScale(d.startT, d.center, d.start, pc));
      d.dirty = !isSameTransform(d.startT, getT());
      bump();
    }
    if (done) {
      finishTransformDragUndo(() => getT());
      refDrag = null;
    }
  }

  function commitOpenStroke(pts: InputPoint[]) {
    if (!strokeCanvas || !strokeCtx || !beforeSnapshot) {
      strokeCanvas = null;
      strokeCtx = null;
      beforeSnapshot = null;
      strokeSteps = null;
      return;
    }
    if (drawRaf) {
      cancelAnimationFrame(drawRaf);
      drawRaf = 0;
    }
    paintStroke(pts, true);
    const after = strokeCtx.getImageData(0, 0, strokeCanvas.width, strokeCanvas.height);
    const target = strokeCtx;
    const before = beforeSnapshot;
    history.push(
      pixelCommand(
        () => {
          target.putImageData(before, 0, 0);
          recomposite();
        },
        () => {
          target.putImageData(after, 0, 0);
          recomposite();
        },
        before,
        after,
      ),
    );
    strokeCanvas = null;
    strokeCtx = null;
    beforeSnapshot = null;
    strokeSteps = null;
    bump(); // refresh the timeline (e.g. an empty cell that just gained ink flips ·→◆)
  }

  function onStroke(points: InputPoint[], done: boolean) {
    if (dropStrokeUntilUp) {
      if (done) dropStrokeUntilUp = false;
      return;
    }
    if (appState.tool === "eyedropper") {
      // Commit on RELEASE, not on press: you cannot see the pixel under your own fingertip, so the
      // pick has to be adjustable — drag to slide the sample point, lift to take it. (The pointer-down
      // version took whatever you happened to land on.) The BrushCursor swatch previews the colour
      // under the pointer throughout, for mouse and Pencil.
      if (done) {
        const hex = sampleAt(points[points.length - 1]);
        if (hex) applyEyedropper(hex); // sets colour + switches the tool back
      }
      return;
    }
    const al = activeLayer();
    if (al.kind === "ref") {
      // A pinned reference: its gizmo is live under EVERY tool, so this is the one guard that stops
      // a stray canvas drag from nudging an aligned reference. Derived, so a locked/hidden GROUP
      // pins its refs too (the gizmo already used the derived form — these must agree).
      const refPinned =
        isLayerLocked(al, appState.project.groups) || !isLayerVisible(al, appState.project.groups);
      if (!refPinned) onTransformDrag(al, points, done);
      return;
    }
    if (al.kind === "draw" && appState.tool === "transform") {
      // GROUP scope moves the whole group: a hidden/locked anchor must not veto it (onTransformDrag's
      // groupHasLockedLayer gates that scope). Frame/layer scope edits this layer → editable only.
      // The group must really exist: with scope stuck on "group" after the layer was dragged OUT of
      // its group, onTransformDrag falls through to the LAYER branch, which has no editable check —
      // so a bare scope check would let a hidden/locked layer be dragged by the whole canvas.
      const groupScope =
        appState.transformScope === "group" && groupOf(al, appState.project.groups) != null;
      if (!groupScope && !isLayerEditable(al, appState.project.groups)) {
        // Locked or hidden = content is immovable. Also settle any drag that was in flight when the
        // lock/hide landed (mid-gesture), so its undo bracket can't leak into the next gesture.
        finishTransformDragUndo(null);
        refDrag = null;
        return;
      }
      onTransformDrag(al, points, done);
      return;
    }
    if (appState.tool === "pose") {
      const p = toCellSpace(points[points.length - 1]);
      if (!meshPose) {
        if (points.length === 1 && !done) enterPose();
        return;
      }
      if (points.length === 1 && !done) {
        // Press: gizmo nub first, then handle body, then add a handle.
        const nub = poseNubPos();
        const hitPx =
          1 /
          (viewport.zoom *
            (activeLayer().kind === "draw" ? composeScaleOf(cellComposeSteps(activeLayer())) : 1));
        if (nub && Math.hypot(nub.x - p.x, nub.y - p.y) <= 12 * hitPx) {
          poseAdjusting = true;
        } else {
          const hit = meshPose.handleAt(p, 10 * hitPx);
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
      const p = toCellSpace(points[points.length - 1]);
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
        syncComposeSteps(); // gesture start: match the layer we are about to clip / lift on
        const handle = selection.hitTest(p.x, p.y);
        if (selection.state === "selected" && handle === "move") {
          // First grab inside a fresh marquee: paper-crop lift, then drag.
          if (!liftPaperCrop()) return;
          recomposite();
          selectionMode = "drag";
          selection.startDrag("move", p.x, p.y);
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
      // locked or hidden. Binding the layer here (rather than re-reading activeLayer() every
      // move) keeps the whole stroke on the layer it started on.
      const layer = activeLayer();
      if (!isLayerEditable(layer, appState.project.groups)) return;
      strokeCanvas = ensureDrawableKeyframe(layer, appState.playhead, canvasOps);
      strokeCtx = strokeCanvas.getContext("2d", { willReadFrequently: true })!;
      beforeSnapshot = strokeCtx.getImageData(0, 0, strokeCanvas.width, strokeCanvas.height);
      strokeSteps = cellComposeSteps(layer);
      if (activeStroke().brushType === "ink") resetInkState();
      else if (activeStroke().brushType !== "smooth") resetStampState();
      bump();
    }

    // Throttle drawing + compositing to one animation frame (defer non-final events);
    // finalize synchronously on stroke end so the undo snapshot captures the exact result.
    lastPoints = points;
    if (done) {
      commitOpenStroke(points);
    } else if (!drawRaf) {
      drawRaf = requestAnimationFrame(() => {
        drawRaf = 0;
        if (strokeCtx) paintStroke(lastPoints, false);
      });
    }
  }

  function setupSelection() {
    sizeOverlay();

    selection = new Selection(overlay);
    selection.mode = "rect";
    selection.applyView = applyViewTransform;
    // Only consulted for a cellSpaceLift (deform) — see Selection.applyCompose.
    selection.applyCompose = applyOverlayCompose;
    selection.boundsToDoc = composeToDoc;
    syncComposeSteps();
    syncOverlayScale();
    let lastOutputScale = displayOutputScale();
    viewport.onChange = () => {
      sizeOverlay();
      syncOverlayScale();
      repaintPoseOverlay();
      const ss = displayOutputScale();
      if (ss !== lastOutputScale) {
        lastOutputScale = ss;
        recomposite(); // zoom crossed a backing-store step
      }
    };

    selection.onChange = () => recomposite();
    selection.onStateChange = () => {
      recomposite();
      appState.selectionActive = !!selection && selection.active && !selection.hasFloating;
      appState.selectionFloating = !!selection && selection.hasFloating;
    };

    selection.onCommit = () => {
      if (!selCtx || !selBefore) return;
      // renderFloatingTo draws the paper crop in document space; inverse compose + dpr
      // map it into the cell. Identity compose is a no-op → today's blit. save/restore because the
      // cell ctx is SHARED and carries the plain dpr transform by convention.
      selCtx.save();
      selCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
      applyInverseCompose(selCtx, liftComposeSteps);
      selection.renderFloatingTo(selCtx);
      selCtx.restore();
      const ctx = selCtx;
      const before = selBefore;
      const after = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
      history.push(
        pixelCommand(
          () => {
            ctx.putImageData(before, 0, 0);
            recomposite();
          },
          () => {
            ctx.putImageData(after, 0, 0);
            recomposite();
          },
          before,
          after,
        ),
      );
      selCtx = null;
      selBefore = null;
      liftComposeSteps = [];
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
      liftComposeSteps = [];
    };

    selectionRef.current = selection;
    liftGuard.discard = discardActiveEdits;
    poseActions.active = () => meshPose !== null;
    poseActions.apply = () => applyPose();
    poseActions.cancel = () => cancelPose();
  }

  /**
   * Crop the document-space selection from what the active layer looks like on the paper.
   * Identity compose is a straight cell blit (bit-identical to the old copyPixels path).
   */
  function cropComposedSelection(): HTMLCanvasElement | null {
    if (!selection?.rect) return null;
    const al = activeLayer();
    if (al.kind !== "draw") return null;
    const rk = resolvedKeyCell(al, appState.playhead);
    if (!rk) return null;
    const W = appState.project.width;
    const H = appState.project.height;
    const cellT = cellTransform(rk.cell);
    const g = groupOf(al, appState.project.groups);
    const groupT = groupTransform(g);
    if (
      isIdentityTransform(al.transform) &&
      isIdentityTransform(cellT) &&
      isIdentityTransform(groupT)
    ) {
      // Document space == cell space: crop the cell bitmap at this.rect (same blit as today).
      const ctx = rk.cell.canvas.getContext("2d", { willReadFrequently: true })!;
      return selection.copyPixelsFromDoc(ctx, DPR);
    }
    const tmp = document.createElement("canvas");
    tmp.width = W * DPR;
    tmp.height = H * DPR;
    const tctx = tmp.getContext("2d")!;
    const boxDev = isIdentityTransform(cellT)
      ? { x: 0, y: 0, w: W * DPR, h: H * DPR }
      : {
          x: rk.cell.transformBox!.x * DPR,
          y: rk.cell.transformBox!.y * DPR,
          w: rk.cell.transformBox!.w * DPR,
          h: rk.cell.transformBox!.h * DPR,
        };
    const groupBoxDev = isIdentityTransform(groupT)
      ? { x: 0, y: 0, w: W * DPR, h: H * DPR }
      : (() => {
          const lb = groupBoxLogical(
            g!,
            appState.project,
            appState.playhead,
            DPR,
            appState.version,
          );
          return { x: lb.x * DPR, y: lb.y * DPR, w: lb.w * DPR, h: lb.h * DPR };
        })();
    drawCellComposed(
      tctx,
      rk.cell.canvas,
      W * DPR,
      H * DPR,
      al.transform,
      cellT,
      boxDev,
      DPR,
      groupT,
      groupBoxDev,
    );
    return selection.copyPixelsFromDoc(tctx, DPR);
  }

  /** Snapshot → paper crop → punch the cell → beginTransform. False if nothing to lift. */
  function liftPaperCrop(): boolean {
    if (!selection?.rect) return false;
    const layer = activeLayer();
    if (!isLayerEditable(layer, appState.project.groups)) return false;
    const canvas = ensureDrawableKeyframe(layer, appState.playhead, canvasOps);
    selCtx = canvas.getContext("2d", { willReadFrequently: true })!;
    selBefore = selCtx.getImageData(0, 0, canvas.width, canvas.height);
    const crop = cropComposedSelection();
    if (!crop) {
      selCtx = null;
      selBefore = null;
      liftComposeSteps = [];
      return false;
    }
    // Refresh before the hole punch so we don't clip with a previous layer's steps.
    const steps = cellComposeSteps(layer);
    selection.composeSteps = steps;
    liftComposeSteps = steps;
    selection.cellSpaceLift = false; // a paper crop: overlay stays uncomposed
    selCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    selection.clearRegion(selCtx, DPR);
    selection.beginTransform(crop);
    syncOverlayScale();
    return true;
  }

  // Drawable ctx for the current frame (for delete/paste — materializes a key on a hold). Null if the
  // active layer isn't an editable (unlocked, visible) drawing layer.
  function activeDrawableCtx(): CanvasRenderingContext2D | null {
    const layer = activeLayer();
    if (!isLayerEditable(layer, appState.project.groups)) return null;
    const canvas = ensureDrawableKeyframe(layer, appState.playhead, canvasOps);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return ctx;
  }

  function copySelection() {
    if (!selection || selection.state !== "selected" || !selection.rect) return;
    const float = cropComposedSelection();
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
    history.push(
      pixelCommand(
        () => {
          ctx.putImageData(before, 0, 0);
          bump();
        },
        () => {
          ctx.putImageData(after, 0, 0);
          bump();
        },
        before,
        after,
      ),
    );
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
    const dest = activeLayer();
    liftComposeSteps = dest.kind === "draw" ? cellComposeSteps(dest) : [];
    if (selection) {
      selection.composeSteps = liftComposeSteps;
      selection.cellSpaceLift = false; // pasted pixels are document-space
    }
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
    if (!liftPaperCrop()) return;
    recomposite();
    selection.drawOverlay();
  }

  function enterDeform() {
    const al = activeLayer();
    if (!isLayerEditable(al, appState.project.groups)) return;
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
    selection.composeSteps = [];
    liftComposeSteps = [];
    // The lift, the warp grid and the deform pointer path (toCellSpace, above) are all CELL-space,
    // so this overlay — unlike the marquee — must carry `group ∘ layer ∘ cell`.
    selection.cellSpaceLift = true;
    const lifted = selection.liftPixels(selCtx, DPR);
    if (!lifted) {
      selection.cellSpaceLift = false;
      selCtx = null;
      selBefore = null;
      return;
    }
    syncOverlayScale(); // handles/grid stay screen-constant against zoom × compose scale
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
    applyViewTransform(octx);
    applyOverlayCompose(octx);
    const al = activeLayer();
    const px =
      1 / (viewport.zoom * (al.kind === "draw" ? composeScaleOf(cellComposeSteps(al)) : 1));
    if (meshPose && isLayerVisible(al, appState.project.groups)) {
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
        octx.lineWidth = px;
        octx.setLineDash(h.reach == null ? [6 * px, 4 * px] : []);
        octx.beginPath();
        octx.arc(c.x, c.y, r, 0, Math.PI * 2);
        octx.stroke();
        octx.setLineDash([]);
        // hand line + nub (direction = rotation, distance = reach)
        octx.strokeStyle = "rgba(0,128,255,0.7)";
        octx.lineWidth = 1.5 * px;
        octx.beginPath();
        octx.moveTo(c.x, c.y);
        octx.lineTo(nub.x, nub.y);
        octx.stroke();
        octx.fillStyle = "#0080ff";
        octx.beginPath();
        octx.arc(nub.x, nub.y, 5 * px, 0, Math.PI * 2);
        octx.fill();
        octx.strokeStyle = "#fff";
        octx.lineWidth = 1.5 * px;
        octx.stroke();
      }
    }
  }

  /** The fill-outlines report. Set (or cleared) on EVERY mesh build, so raising Gap until it works,
   *  switching Fill outlines off, or applying the pose all clear it — there is no hover on iPad to
   *  clear it for us, and a stale warning would sit next to a mesh it no longer describes. */
  function reportPoseFill() {
    const f = meshPose?.fill;
    appState.poseFillWarning =
      f && outlineFillFailed(f) ? "Outline isn't closed — raise Gap, or fill the shape" : "";
  }

  function enterPose() {
    const al = activeLayer();
    if (!isLayerEditable(al, appState.project.groups)) return;
    const canvas = ensureDrawableKeyframe(al, appState.playhead, canvasOps);
    const rect = contentRectLogical(contentBounds(canvas, appState.version), DPR);
    if (!rect) return;
    selection.cancel(); // clear any stale selection/lasso so liftPixels uses our content rect
    selCtx = canvas.getContext("2d", { willReadFrequently: true })!;
    selBefore = selCtx.getImageData(0, 0, canvas.width, canvas.height);
    selCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    selection.rect = rect;
    selection.composeSteps = [];
    liftComposeSteps = [];
    const lifted = selection.liftPixels(selCtx, DPR); // clears the content region from the cell
    if (!lifted) {
      selCtx = null;
      selBefore = null;
      return;
    }
    meshPose = MeshPose.fromLift(lifted, rect, DPR, poseSpacing, {
      fillHoles: appState.pose.fillHoles,
      gap: appState.pose.gap,
    });
    appState.poseActive = meshPose !== null;
    if (!meshPose) {
      if (selBefore) selCtx.putImageData(selBefore, 0, 0); // no mesh → undo the lift
      selCtx = null;
      selBefore = null;
      appState.poseFillWarning = "";
      recomposite();
      return;
    }
    // A gapped outline lets the flood escape, silently producing the old thin web. Say so, and name
    // the remedy.
    reportPoseFill();
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
    history.push(
      pixelCommand(
        () => {
          ctx.putImageData(before, 0, 0);
          recomposite();
        },
        () => {
          ctx.putImageData(after, 0, 0);
          recomposite();
        },
        before,
        after,
      ),
    );
    meshPose = null;
    appState.poseActive = false;
    appState.poseFillWarning = "";
    poseDrag = null;
    activeHandle = null;
    poseAdjusting = false;
    selCtx = null;
    selBefore = null;
    liftComposeSteps = [];
    posePaint(); // meshPose null → clears overlay
    bump();
    recomposite();
  }

  function cancelPose() {
    if (meshPose && selCtx && selBefore) selCtx.putImageData(selBefore, 0, 0);
    meshPose = null;
    appState.poseActive = false;
    appState.poseFillWarning = "";
    poseDrag = null;
    activeHandle = null;
    poseAdjusting = false;
    selCtx = null;
    selBefore = null;
    liftComposeSteps = [];
    posePaint();
    recomposite();
    bump(); // bump version so the reactive pose bar unmounts
  }

  // Shared by the density buttons and the fill-outlines controls: any setting that changes the
  // mesh has to rebuild from the SAME lifted bitmap and reset handles — vertex indices change.
  function rebuildPoseMesh() {
    if (!meshPose) return;
    meshPose =
      MeshPose.fromLift(meshPose.img, meshPose.rect, DPR, poseSpacing, {
        fillHoles: appState.pose.fillHoles,
        gap: appState.pose.gap,
      }) ?? meshPose;
    appState.poseActive = meshPose !== null;
    poseDrag = null;
    activeHandle = null;
    poseAdjusting = false;
    posePaint();
    reportPoseFill();
  }

  function poseDensity(delta: number) {
    if (!meshPose) return;
    poseSpacing = Math.max(4, poseSpacing + delta * 4);
    rebuildPoseMesh();
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
    const overlayRo = new ResizeObserver(() => sizeOverlay());
    overlayRo.observe(stage);

    // Finger gestures: 1-finger pan, 1-finger double-tap toggle eraser, 2-finger pinch zoom+rotate,
    // 2-finger tap undo, 3-finger tap redo. The Apple Pencil (pointerType "pen") bypasses this and draws.
    const cleanupTouch = setupTouchGestures(stage, viewport, {
      onUndo: () => undo(),
      onRedo: () => redo(),
      onToggleEraser: () => toggleEraser(),
      onViewportChange: () => {
        sizeOverlay();
        syncOverlayScale();
        repaintPoseOverlay();
      },
    });

    const cleanup = setupInput(stage, onStroke, (sx, sy) => viewport.screenToCanvas(sx, sy), {
      streamline: () => activeStroke().streamline / 100,
    });

    // Recomposite when the document changes elsewhere (frame step, layer toggle…).
    let lastVersion = appState.version;
    let lastPlayhead = appState.playhead;
    let lastLayerId = appState.activeLayerId;
    let lastW = appState.project.width;
    let lastH = appState.project.height;
    const tick = () => {
      const dimsChanged = appState.project.width !== lastW || appState.project.height !== lastH;
      const changed =
        dimsChanged || appState.version !== lastVersion || appState.playhead !== lastPlayhead;
      // setActiveLayer only bumps the version in single-layer onion mode, so a layer switch needs
      // its own check — a stale chain would clip/clear the wrong region on the new layer.
      const layerChanged = appState.activeLayerId !== lastLayerId;
      if (dimsChanged) {
        lastW = appState.project.width;
        lastH = appState.project.height;
        sizeDisplay();
        sizeOverlay();
      }
      // Gated: cellComposeSteps walks the keyframe list, hits two WeakMaps and allocates, and on a
      // cache miss runs a full-resolution contentBounds scan — not something to do every idle frame.
      if (changed || layerChanged) {
        lastLayerId = appState.activeLayerId;
        syncComposeSteps();
      }
      if (changed) {
        lastVersion = appState.version;
        lastPlayhead = appState.playhead;
        syncReferenceVideos(
          appState.project,
          appState.playhead,
          appState.project.fps,
          appState.playback.isPlaying,
        );
        syncOverlayScale();
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
    // Escape's behavior exactly: cancel (revert a move), never commit. Tap-outside still commits.
    selectionActions.deselect = () => {
      if (selection?.active) selection.cancel();
    };
    // Same as the `0` key. Exposed because iPad has no keyboard: without a UI route, a canvas
    // flung off-screen by a stray two-finger drag can only be recovered by reloading the page.
    viewActions.fitView = () => viewport?.fitView(appState.project.width, appState.project.height);

    return () => {
      overlayRo.disconnect();
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
      if (poseRaf) cancelAnimationFrame(poseRaf);
      selection?.cancel(); // stop the marching-ants rAF loop (and revert any live lift) on teardown
      selectionRef.current = null;
      liftGuard.discard = null;
      poseActions.active = () => false;
      selectionActions.enterWarp = null;
      selectionActions.copy = null;
      selectionActions.cut = null;
      selectionActions.del = null;
      selectionActions.paste = null;
      selectionActions.deselect = null;
      viewActions.fitView = null;
      appState.selectionActive = false;
      appState.selectionFloating = false;
      appState.poseActive = false;
      appState.poseFillWarning = "";
    };
  });

  $effect(() => {
    const t = appState.tool;
    // Reading the scope makes it a dependency: switching either mid-drag must settle the open
    // transform bracket, or it leaks into the next gesture and one undo reverts both (gotcha #6).
    void appState.transformScope;
    transformDragGuard.settle?.();
    if (!selection) return;
    // Only bank when the TOOL actually changes. This effect also re-runs when hasFloating
    // flips (the reads below), and committing then would bake+clear a lift the user just started
    // from the on-canvas bar (Select → Free transform).
    const toolChanged = t !== prevTool;
    if (toolChanged) {
      if (prevTool === "pose" && t !== "pose" && meshPose) applyPose();
      if (prevTool === "deform" && t !== "deform" && selection.hasFloating) selection.commit();
      else if (t !== "select" && t !== "lasso" && selection.hasFloating) selection.commit();
    }
    prevTool = t;
    if (t === "select") selection.mode = "rect";
    else if (t === "lasso") selection.mode = "lasso";
    else if (t !== "deform") selectionMode = null; // deform manages its own selectionMode on entry
    // t === "deform": lift entry happens on the first canvas press (onStroke).
  });

  // Bank any in-progress lift (pose / selection transform / deform warp) into the layer/frame it was
  // started on, so switching the active layer or frame leaves a clean slate — mirrors the tool-switch
  // banker. A plain marquee is document-level and kept; the gizmo-based layer transform self-retargets.
  function bankActiveEdits() {
    if (meshPose) applyPose();
    if (selection?.hasFloating) selection.commit();
    // Mid-stroke ↑/↓ or ←/→ would keep writing the old cell while inverse-mapping the new
    // compose. Commit what we have and drop the rest of this pointer stream.
    if (strokeCanvas) {
      commitOpenStroke(lastPoints);
      dropStrokeUntilUp = true;
    }
  }
  // Discard (don't bank) an in-progress lift — for ops that destroy/replace the target canvas or replay
  // history (resize / replaceProject / undo / redo), where banking has no valid target. Restores the
  // original pixels via the captured context, so the destructive op then sees the un-lifted cell.
  function discardActiveEdits() {
    if (meshPose) cancelPose();
    if (selection?.hasFloating) selection.cancel(); // only an actual lift (not a plain marquee)
    // An open stroke holds the key cell's canvas + ctx, which the caller is about to replace or
    // replay history over — the Pencil can be mid-stroke while fingers undo (touch-gestures.ts lets
    // pen and touch run independently). Roll back to the pre-stroke snapshot instead of committing:
    // pushing undo here would land a pixel entry on top of the op that asked for the discard.
    if (strokeCanvas && strokeCtx && beforeSnapshot) {
      if (drawRaf) {
        cancelAnimationFrame(drawRaf); // a queued paint would repaint the stroke we just reverted
        drawRaf = 0;
      }
      strokeCtx.putImageData(beforeSnapshot, 0, 0);
      strokeCanvas = null;
      strokeCtx = null;
      beforeSnapshot = null;
      strokeSteps = null;
      dropStrokeUntilUp = true; // swallow the rest of this pointer stream
      recomposite();
    }
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
    if (selection) selection.hidden = !isLayerVisible(al, appState.project.groups);
    if (meshPose) posePaint();
    // Can't keep editing a layer that just became read-only → discard the in-progress lift.
    // DERIVED (isLayerLocked), so locking the layer's GROUP discards too — reading it here also makes
    // the group's flag a tracked dependency, which a raw `al.locked` read never was.
    if (isLayerLocked(al, appState.project.groups) && (meshPose || selection?.hasFloating))
      discardActiveEdits();
  });

  // Wheel/trackpad: plain scroll pans; ⌘/Ctrl + scroll (and trackpad pinch, which arrives as
  // ctrl+wheel) zooms at the cursor.
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) viewport?.zoomAt(e.clientX, e.clientY, e.deltaY);
    else viewport?.panBy(-e.deltaX, -e.deltaY); // content follows the scroll
  }

  // Tools that WRITE to the active layer. The eyedropper samples the composite and select/lasso can
  // still copy from a locked layer, so they are deliberately excluded — showing "not allowed" for a
  // gesture that does work would be a worse lie than showing nothing.
  const WRITING_TOOLS = ["brush", "eraser", "fill", "deform", "pose", "transform"];
  // A locked/hidden active layer refuses every writing tool; say so in the cursor instead of just
  // silently swallowing the stroke.
  const toolBlocked = $derived(
    WRITING_TOOLS.includes(appState.tool) &&
      !isLayerEditable(activeLayer(), appState.project.groups),
  );
</script>

<div
  bind:this={stage}
  class="relative flex-1 overflow-hidden bg-canvas-bg touch-none"
  class:cursor-not-allowed={toolBlocked && !panning && !spaceHeld}
  class:cursor-none={!toolBlocked && (appState.tool === "brush" || appState.tool === "eraser")}
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
  </div>
  <!-- z-10: a CSS-transformed wrapper (the display) can composite above a later sibling
       on WebKit. The overlay must sit above the paper so a lifted selection stays visible. -->
  <canvas bind:this={overlay} class="pointer-events-none absolute inset-0 z-10"></canvas>
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
  <LayerBoundsHint getViewport={() => viewport} getContainer={() => stage} />
  <BrushCursor
    getViewport={() => viewport}
    getContainer={() => stage}
    sampleColor={(cx, cy) => {
      if (!viewport) return null;
      return sampleAt(viewport.screenToCanvas(cx, cy));
    }}
  />
  {#if poseBarVisible()}
    <!-- Two rows on purpose: the controls stay a compact, stable-width strip, and the warning gets
         its own line below. Inline, it stretched the panel most of the canvas width and shifted
         every button whenever it appeared. `max-w` + `flex-wrap` mean it wraps instead of pushing
         the panel past the canvas edge on a narrow (iPad portrait) viewport. -->
    <div
      class="selection-actions-panel absolute top-2 left-1/2 -translate-x-1/2 flex max-w-[min(92vw,34rem)] flex-col gap-1 rounded border border-border bg-surface px-2 py-1 shadow-lg z-10"
    >
      <div class="flex flex-wrap items-center gap-1">
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
        <!-- Group separator — the bar language the playbar and timeline tool bar already use. -->
        <span class="w-px h-5 bg-border mx-1"></span>
        <label
          class="flex items-center gap-1 text-xs"
          title="Treat space enclosed by the outline as part of the shape"
        >
          <input
            type="checkbox"
            bind:checked={appState.pose.fillHoles}
            onchange={rebuildPoseMesh}
          /> Fill outlines
        </label>
        {#if appState.pose.fillHoles}
          <label
            class="flex items-center gap-1 text-xs"
            title="Bridge breaks in the outline, up to about twice this many pixels"
          >
            Gap
            <input
              class="w-10 text-xs bg-surface border border-border rounded px-1 text-text"
              type="number"
              min="0"
              max={MAX_GAP}
              value={appState.pose.gap}
              onchange={(e) => {
                // Read + clamp rather than `bind:value`, which writes `null` into a `number` field
                // when emptied and takes a typed 50 straight through (`max` is advisory). Writing the
                // clamped value back to the DOM makes the snap visible.
                appState.pose.gap = clampGap(e.currentTarget.value);
                e.currentTarget.value = String(appState.pose.gap);
                rebuildPoseMesh();
              }}
            />
          </label>
        {/if}
        <span class="w-px h-5 bg-border mx-1"></span>
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
      {#if appState.pose.fillHoles && appState.poseFillWarning}
        <!-- Row 2. Kept in THIS panel rather than the status bar: statusHint carries the hovered
             control's title= and is overwritten by the very pointerdown that builds the mesh, and
             the remedy (Gap) is one row above. -->
        <span class="text-xs/snug text-amber-500">{appState.poseFillWarning}</span>
      {/if}
    </div>
  {/if}
</div>
