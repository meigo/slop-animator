<script lang="ts">
  import { onMount } from "svelte";
  import { Check, X, Dices } from "@lucide/svelte";
  import { computeAnchor } from "../core/selection-anchor";
  import { setupInput, type InputPoint } from "../core/input";
  import { Viewport } from "../core/viewport";
  import { setupTouchGestures } from "../core/touch-gestures";
  import { drawStroke } from "../core/brush";
  import {
    floodFill,
    enclosedFillRegion,
    fillRegionBehind,
    hexToRgba,
    rgbToHex,
  } from "../core/fill";
  import { drawCellComposed, renderFrame } from "../anim/render";
  import { renderFrameWithOnion } from "../anim/onion";
  import { effectiveRange } from "../anim/playback";
  import { ensureDrawableKeyframe, restoreCellTrack, type CellTrackChange } from "../anim/timeline";
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
    repaint,
    pressureCurves,
    toggleEraser,
    applyEyedropper,
    beginStructuralEdit,
    commitStructuralEdit,
    transformScope,
    selectToolsBlock,
  } from "../state/appState.svelte";
  import { rowAdmitsTransform, workingTarget } from "../anim/active-row";
  import { pixelCommand } from "../anim/history";
  import {
    selectionRef,
    selectionActions,
    viewActions,
    fillActions,
    poseActions,
    outlineActions,
    liftGuard,
    leaveOutline,
    transformDragGuard,
    playbackController,
  } from "../state/appState.svelte";
  import { drawStampStrokeIncremental, resetStampState } from "../core/stamp-brush";
  import { drawInkStroke } from "../core/ink-brush";
  import { drawCalligraphyStroke } from "../core/calligraphy-brush";
  import { syncReferenceVideos } from "../anim/reference";
  import { Selection, type SelectionRect } from "../core/selection";
  import { inverseComposeMatrix, needsMap } from "../core/selection-map";
  import SelectionActions from "./SelectionActions.svelte";
  import RefTransformGizmo from "./RefTransformGizmo.svelte";
  import BrushCursor from "./BrushCursor.svelte";
  import LayerBoundsHint from "./LayerBoundsHint.svelte";
  import NumberField from "./NumberField.svelte";
  import { editBlockLabel, loopEditLabel } from "./status-hint";
  import {
    transformBaseRect,
    isIdentityTransform,
    isSameTransform,
    cellTransform,
    resolvedKeyCell,
    resolvedDisplayKeyCell,
    isLoopFrame,
    displayFrame,
    cloneCanvas,
    groupOf,
    layerContentAlpha,
    groupHasLockedLayer,
    isLayerEditable,
    isLayerLocked,
    isLayerVisible,
    whyNotEditable,
    isRefVisibleAtFrame,
    groupTransformAt,
    transformAt,
    layerTransformTrack,
    withTransformKey,
    type Layer,
    type Cell,
    type LayerGroup,
    type DrawingLayer,
    type TransformTrack,
  } from "../anim/document";
  import {
    contentBoxLogical,
    groupBoxLogical,
    contentBounds,
    markInkChanged,
    cellPivotBoxDev,
  } from "./cell-ink";
  import { contentRectLogical, clampDensity } from "../core/deform";
  import { MeshPose } from "../core/mesh-pose";
  import { outlineFillFailed, MAX_GAP } from "../core/fill-holes";
  import {
    outlineMask,
    signedDistanceField,
    buildNoisePlanes,
    localDepth,
    bleedColor,
    OUTLINE_MARGIN,
    MAX_THICKNESS,
  } from "../core/outline";
  import type { OutlineNoisePlanes } from "../core/outline";
  import type { Tool } from "../state/appState.svelte";
  import {
    hitTestHandle,
    transformCenter,
    dragTransform,
    inverseChain,
    forwardChain,
    type Handle,
    type Pt,
    type ComposeStep,
    type Rect,
  } from "../core/ref-transform";

  const REF_ROTATE_GAP_PX = 28; // screen px from the top edge to the rotate handle
  const IDENTITY = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 };

  /** Return the compose steps [layer-step, group-step] (inner-to-outer) above a draw layer. */
  function layerComposeSteps(layer: Layer): ComposeStep[] {
    const W = appState.project.width,
      H = appState.project.height;
    const steps: ComposeStep[] = [];
    // Resolved at the playhead, exactly as the group step below already is — an animated layer's
    // paint inverse, bounds hint and selection mapping must all follow the frame you are on.
    steps.push({ base: { x: 0, y: 0, w: W, h: H }, t: transformAt(layer, appState.playhead) });
    const g = groupOf(layer, appState.project.groups);
    if (g) {
      // At the playhead, exactly as the layer step above — an animated group's paint inverse,
      // bounds hint and selection mapping must follow the frame you are on.
      const gt = groupTransformAt(g, appState.playhead);
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
    const rk = resolvedDisplayKeyCell(layer, appState.playhead);
    const cellT = rk ? cellTransform(rk.cell) : IDENTITY;
    const cellBox = rk
      ? contentBoxLogical(rk.cell.canvas, rk.cell.transformBox, W, H, DPR, appState.version)
      : { x: 0, y: 0, w: W, h: H };
    return [{ base: cellBox, t: cellT }, ...layerComposeSteps(layer)];
  }

  function composeScaleOf(steps: ComposeStep[]): number {
    // One number cannot describe a stretch; the geometric mean keeps handles screen-constant on average.
    return steps.reduce((s, step) => s * Math.sqrt(Math.abs(step.t.scaleX * step.t.scaleY)), 1);
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
      ctx.scale(s.t.scaleX, s.t.scaleY);
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
   *  Coalesced to one frame like `drawRaf`: a pinch fires the viewport hooks per raw pointermove.
   *
   *  EVERY repaint of a live mesh goes through here, including the handle drag itself. A pose paint
   *  is ~600 `drawImage` calls (one per mesh triangle) plus the wireframe and, with a reach dial up,
   *  a second pass over the triangles for the tint — and the drag path used to call `posePaint()`
   *  DIRECTLY, once per pointermove, which an Apple Pencil delivers 120-240 times a second (measured
   *  2026-09-18: two paints per move, 36,120 overlay `drawImage` for a 60-move drag). The browser
   *  paints once per frame, so everything above 60/s was invisible work. Call `posePaint()` directly
   *  only where the mesh is GONE and the overlay must be cleared — this early-returns on `!meshPose`
   *  — or for a one-off that must land in the same tick. */
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

  // Space holds a grab-to-pan mode; `0` fits the canvas to the view and `1` restores 100%. Skipped
  // while typing in a field (or `1` would zoom whenever a size or fps field is being typed into);
  // space is left alone when a BUTTON is focused so it can still activate it.
  function onViewKeyDown(e: KeyboardEvent) {
    // These are the app's OTHER window-level key handlers, so they need the export gate `App.svelte`
    // has: a space tap restarts playback onto the boil GL surface the export shares, and the render
    // loop re-reads the live project every frame. The dialog's backdrop blocks pointers, not keys.
    if (appState.exportBusy) return;
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
    } else if (e.key === "1") {
      e.preventDefault();
      viewport?.setZoom(1);
    }
  }
  function onViewKeyUp(e: KeyboardEvent) {
    if (e.key !== " ") return;
    // Clear the pan latch BEFORE the export gate: a space held when the export started already set
    // it via a keydown that wasn't gated, and returning first would leave pan stuck on forever.
    spaceHeld = false;
    if (appState.exportBusy) return;
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
  // False until the tool $effect has run once, so a restored preference doesn't read as a user pick.
  let toolEntryPrimed = false;
  // Track the active layer/frame so a switch can discard any in-progress lift (see the cleanup $effect).
  let prevLayer = appState.activeLayerId;
  let prevPlayhead = appState.playhead;
  // The cell being transformed + its pre-lift snapshot, for commit/cancel undo.
  let selCtx: CanvasRenderingContext2D | null = null;
  let selBefore: ImageData | null = null;
  // Compose at lift/paste time. Commit inverts *this*, not live activeLayer() —
  // bankActiveEdits runs after the layer/playhead has already changed.
  let liftComposeSteps: ComposeStep[] = [];
  // A lift on a HOLD materialises a keyframe to lift out of. Carried beside `selBefore` and for the
  // same span, so the commit's undo also removes that ◆ and a cancel leaves the hold a hold. Set
  // wherever selCtx/selBefore are set (paper crop, paste, deform, pose); cleared with them.
  let selLayer: DrawingLayer | null = null;
  let selMaterialized: CellTrackChange | null = null;
  /** Put a cell track back, resolving the layer by ID **at restore time**. A captured layer OBJECT
   *  goes stale: `restoreStructure` mutates the live layer in place only when it still exists with
   *  the same kind — otherwise it installs a fresh object, so an undo/redo closure holding the old
   *  one would write to something no longer in the document. Reachable via rasterize (ref→draw keeps
   *  the id) and via delete-then-undo. */
  function restoreTrackById(layerId: number, cells: Cell[]) {
    const l = appState.project.layers.find((x) => x.id === layerId);
    if (l?.kind === "draw") restoreCellTrack(l, cells);
  }
  /** Drop the lift's whole target binding at once — the four fields have one lifetime, and clearing
   *  three of them was how a stale materialisation could outlive the lift that made it. */
  function clearLiftTarget() {
    selCtx = null;
    selBefore = null;
    liftComposeSteps = [];
    selLayer = null;
    selMaterialized = null;
  }
  const PASTE_OFFSET = 8; // logical px — so a paste-in-place reads as a new copy
  // $state so the floating Paste button reacts to copy/cut filling the clipboard.
  let selectionClipboard = $state<{ canvas: HTMLCanvasElement; rect: SelectionRect } | null>(null);
  // Did the artist actually MOVE anything since the lift? Now that selecting the tool lifts on its
  // own, an untouched lift is the common case — baking it would push an undo entry that changes
  // nothing (and a lift→re-render round trip is a resample, so "nothing" isn't even guaranteed to be
  // pixel-identical). Untouched lifts cancel instead. Adding a pose handle doesn't count: it changes
  // the mesh, not the picture.
  let deformDirty = false;
  // Where the current Deform handle drag was grabbed. A release on the same spot is a tap, not an edit.
  let deformGrab: { x: number; y: number } | null = null;
  let poseDirty = false;
  // Pose tool: lifted mesh + the handle index currently being dragged.
  let meshPose: MeshPose | null = null;
  // Same gap the selection bar keeps from its selection and from the screen edge.
  const POSE_BAR_MARGIN = 12;
  let poseBarEl: HTMLDivElement | undefined = $state();
  let poseBarPos = $state({ x: 0, y: 0 });
  /** `poseDrag` is a plain local (the comment on `poseBarVisible` says why), so the template never
   *  re-evaluates when it changes — the bar has to be gated on a rune instead. Assigned ONCE per
   *  gesture at grab and release, never per pointermove, so this costs no per-move reactivity. */
  let poseBarDragging = $state(false);
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
  // The layer the stroke started on, and the keyframe it had to materialise (drawing on a hold, or
  // past the layer's end) — both captured at stroke start so the commit binds the same cell track
  // the stroke began on, whatever the active layer is by the time the pointer lifts.
  let strokeLayer: DrawingLayer | null = null;
  let strokeMaterialized: CellTrackChange | null = null;
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

  /** At most ONE display recomposite per animation frame.
   *
   *  `selection.onChange` used to call `recomposite()` synchronously, and `Selection.updateDrag`
   *  fires it on every pointermove — 120-240/s from an Apple Pencil. Each call re-renders every
   *  layer, every onion ghost and every reference video frame (a hardware decode + texture copy on
   *  iOS), which is the 2026-09-18 report: "deform / distort / mesh warp are very slow with onion
   *  skin or a reference video, fine without". Measured on the device: `recomposite` 230-240/s with
   *  the rAF tick collapsing to ~1/s. The browser paints once per frame, so one recomposite per
   *  frame is the most that could ever be SEEN — the rest was pure waste. Same treatment, and the
   *  same reason, as `drawRaf` for stroke painting. */
  let recompositeRaf = 0;
  function scheduleRecomposite() {
    if (recompositeRaf) return;
    recompositeRaf = requestAnimationFrame(() => {
      recompositeRaf = 0;
      recomposite();
    });
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
        // The play range confines the ghosts to it, and wraps them across the seam when looping —
        // so a cycle's last drawing shows while you draw its first. See `computeOnionFrames`.
        appState.playback.range
          ? {
              ...effectiveRange(appState.playback.range, appState.project.frameCount),
              wrap: appState.playback.loop,
            }
          : undefined,
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

  /** Composite a fully-painted copy of the cell (`tmp`) back through an ALREADY-APPLIED selection
   *  clip. Must be "copy", never the default source-over: inside the clip the destination is
   *  pixel-identical to the source, so source-over blends every semi-transparent pixel with itself
   *  (a' = 2a − a²; alpha 128 → 192 after one fill, 239 after two). Opaque and fully transparent
   *  pixels are fixed points of that, which is why the bug hides on solid ink.
   *  Possible cost at an anti-aliased LASSO edge, UNVERIFIED and engine-dependent: whether "copy"
   *  hard-cuts partial clip coverage or blends against it is not pinned down by the spec, and both
   *  Skia and WebKit are reported to apply coverage as lerp(dst, src, coverage) even for kSrc —
   *  which would make it a correct blend and no seam at all. Worth an eyeball on a soft lasso edge;
   *  either way it beats self-blending every fill, and rect marquees are pixel-exact regardless.
   *  What makes "copy" SAFE here is containment: the draw rect covers the destination exactly, so
   *  a clip that was ever missing or ignored degrades this to an unclipped fill — never a wipe.
   *  Caller owns the save()/restore() pair (see the try/finally at each call site): "copy" strands
   *  far worse than a clip does, since a leaked one makes later draws ERASE what they overlap. */
  /** Did a paint pass actually change anything? Fills can now legitimately write NOTHING — a click
   *  whose region misses the marquee, or an enclosed area the clip removes entirely — where before
   *  the self-blend bug guaranteed every semi-transparent pixel inside the marquee moved, so the
   *  question never arose. Pushing regardless costs a dead ⌘Z plus a `persistTick` bump that arms a
   *  full PNG re-encode for a gesture that painted nothing. Early-exits on the first differing
   *  byte, and is small beside the two getImageData calls this sits between. */
  function sameImageData(a: ImageData, b: ImageData): boolean {
    const x = a.data,
      y = b.data;
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }

  function compositeClippedCopy(ctx: CanvasRenderingContext2D, tmp: HTMLCanvasElement) {
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(tmp, 0, 0, tmp.width / DPR, tmp.height / DPR);
  }

  /** The active drawing layer's current frame is played by a loop key: read-only (spec §3). */
  function onLoopFrame(layer: Layer): boolean {
    return layer.kind === "draw" && isLoopFrame(layer.cells, appState.playhead);
  }

  function doFill(pt: { x: number; y: number }) {
    const layer = activeLayer();
    if (!isLayerEditable(layer, appState.project.groups) || onLoopFrame(layer)) return;
    const W = appState.project.width,
      H = appState.project.height;
    const rk = resolvedKeyCell(layer, appState.playhead);
    const cellT = rk ? cellTransform(rk.cell) : IDENTITY;
    const cellBox = rk
      ? contentBoxLogical(rk.cell.canvas, rk.cell.transformBox, W, H, DPR, appState.version)
      : { x: 0, y: 0, w: W, h: H };
    const steps: ComposeStep[] = [{ base: cellBox, t: cellT }, ...layerComposeSteps(layer)];
    pt = inverseChain(steps, pt);
    const { canvas, materialized } = ensureDrawableKeyframe(layer, appState.playhead, canvasOps);
    const layerId = layer.id; // resolve at restore time, never through a captured object
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const color = hexToRgba(appState.fill.color, appState.fill.opacity);
    const alphaLock = layer.kind === "draw" && layer.alphaLock === true;
    const clipSel = selection?.state === "selected" ? selection : null;
    if (clipSel || alphaLock) {
      // Flood on a temp copy, then composite back — through the selection clip, and with alpha lock
      // `source-atop`, so only pixels that already exist take the fill (their alpha is kept).
      const tmp = document.createElement("canvas");
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
      tctx.drawImage(canvas, 0, 0);
      floodFill(tctx, pt.x * DPR, pt.y * DPR, color, {
        tolerance: appState.fill.tolerance,
        // `expand` > 0 switches floodFill to painting BEHIND existing content (it exists to tuck a
        // fill under anti-aliased line edges), which could never recolour a pixel — and alpha lock
        // refuses every empty one — so under the lock it would be a guaranteed no-op. 0 = write
        // the colour into the region, which the `source-atop` composite below then keeps inside the
        // existing alpha: a recolour of what is there.
        expand: alphaLock ? 0 : appState.fill.expand,
      });
      ctx.save();
      try {
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        clipSel?.applyClip(ctx);
        if (alphaLock) {
          ctx.globalCompositeOperation = "source-atop";
          ctx.drawImage(tmp, 0, 0, tmp.width / DPR, tmp.height / DPR);
        } else compositeClippedCopy(ctx, tmp);
      } finally {
        // strokeCtx/ctx outlive this call, so a throw between save() and restore() would strand
        // both the clip AND the "copy" composite on the cell — every later draw would then be
        // confined to an invisible region and ERASE whatever it overlapped.
        ctx.restore();
      }
    } else {
      floodFill(ctx, pt.x * DPR, pt.y * DPR, color, {
        tolerance: appState.fill.tolerance,
        expand: appState.fill.expand,
      });
    }

    const after = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (sameImageData(before, after)) {
      // Nothing landed: the region is already this color, or a marquee clipped all of it away.
      // Undo the keyframe this materialised too — a ·→◆ left behind by a gesture that pushes no
      // undo entry can never be taken back. Immediate revert, so the layer object is provably live
      // (only the DEFERRED closures above have to resolve by id).
      if (materialized) restoreTrackById(layerId, materialized.before);
      // Must not no-op in silence: this is pixel-identical to a fill that worked.
      // Name what actually refused it. Alpha lock used to win this ternary outright, so a marquee that
      // clipped the whole region was reported as a lock problem — a different thing to go and undo.
      const clipped = selection?.state === "selected";
      appState.statusHint =
        alphaLock && clipped
          ? "Nothing filled — the selection clipped it, or alpha lock found no pixels there to recolour"
          : alphaLock
            ? "Nothing filled — alpha lock only recolours existing pixels, or they are already this color"
            : clipped
              ? "Nothing filled — that area is outside the selection, or already this color"
              : "Nothing filled — that area is already this color";
      return;
    }
    history.push(
      pixelCommand(
        ctx.canvas,
        () => {
          ctx.putImageData(before, 0, 0);
          if (materialized) restoreTrackById(layerId, materialized.before); // a fill on a hold made this ◆
          recomposite();
        },
        () => {
          if (materialized) restoreTrackById(layerId, materialized.after);
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

  /** Fill every ink-enclosed region on the current cell, behind the strokes. Unlike the click fill
   *  this needs no pointer, so no compose inverse — it works on the cell's own pixels. */
  function fillAllEnclosedOnCell() {
    const layer = activeLayer();
    if (
      workingTarget(appState.activeRow).kind !== "layer" ||
      !isLayerEditable(layer, appState.project.groups) ||
      onLoopFrame(layer)
    )
      return;
    // Fill enclosed paints only EMPTY interiors, behind the lines — alpha lock refuses exactly those
    // pixels, so it could never land anything. Say so rather than run a fill that cannot show.
    if (layer.kind === "draw" && layer.alphaLock) {
      appState.statusHint = "Alpha lock is on — Fill enclosed only paints empty areas";
      return;
    }
    // Read the RESOLVED key first: same pixels the user is looking at, and nothing is mutated yet.
    // `ensureDrawableKeyframe` is not just the ·→◆ marker on a hold — past the layer's end it
    // APPENDS holds and a keyframe — so running it before the region is known would leave the
    // model changed (and `project.frameCount` stale) on the nothing-to-fill path, which returns
    // without a `bump()`. Null = nothing at or before the playhead, i.e. a blank cell to come.
    const rk = resolvedKeyCell(layer, appState.playhead);
    const nothing = () => {
      // Must not silently no-op: this looks identical to filling an already-white interior.
      appState.statusHint = "Nothing enclosed — the outline isn't closed, or is already filled";
    };
    if (!rk) return nothing();
    const { region, area } = enclosedFillRegion(rk.cell.canvas, {
      gap: appState.fill.gap,
      expand: appState.fill.expand,
    });
    if (area === 0) return nothing();

    // Only now materialise the keyframe — on a hold (including one running past the layer's end)
    // it clones the very canvas just measured.
    const { canvas, materialized } = ensureDrawableKeyframe(layer, appState.playhead, canvasOps);
    const layerId = layer.id;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const color = hexToRgba(appState.fill.color, appState.fill.opacity);
    if (selection && selection.state === "selected") {
      // Same shape as the click fill: paint a temp copy, composite back through the clip.
      const tmp = document.createElement("canvas");
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
      tctx.drawImage(canvas, 0, 0);
      fillRegionBehind(tctx, region, color);
      ctx.save();
      try {
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        selection.applyClip(ctx);
        compositeClippedCopy(ctx, tmp);
      } finally {
        ctx.restore();
      }
    } else {
      fillRegionBehind(ctx, region, color);
    }

    const after = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (sameImageData(before, after)) {
      // `area > 0` was measured on the UNCLIPPED cell, so the selection can still remove all of it
      // after the fact — which is why the earlier `nothing()` cannot cover this and the message
      // names the real cause. Revert the materialised ◆ for the same reason as the click fill.
      if (materialized) restoreTrackById(layerId, materialized.before);
      appState.statusHint = "Nothing filled — the enclosed area is outside the selection";
      return;
    }
    history.push(
      pixelCommand(
        ctx.canvas,
        () => {
          ctx.putImageData(before, 0, 0);
          if (materialized) restoreTrackById(layerId, materialized.before); // a fill on a hold made this ◆
          recomposite();
        },
        () => {
          if (materialized) restoreTrackById(layerId, materialized.after);
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

  // Render the current stroke onto the cell ctx then recomposite. Smooth/calligraphy/ink =
  // full redraw from the pre-stroke snapshot; stamp = incremental. All clip to the selection.
  function paintStroke(pts: InputPoint[], done: boolean, asEraser = appState.tool === "eraser") {
    if (!strokeCtx) return;
    let inPts = pts;
    const steps = strokeSteps;
    if (steps?.some((s) => !isIdentityTransform(s.t))) {
      inPts = pts.map((p) => {
        const q = inverseChain(steps, { x: p.x, y: p.y });
        return { ...p, x: q.x, y: q.y };
      });
    }
    // The tool can change under an open Pencil stroke (a finger on the toolbar, a double-tap).
    // Commit must redraw with the tool that STARTED the stroke, or the ink is erased or dropped.
    const curve = asEraser ? pressureCurves.eraser : pressureCurves.brush;
    const curved = inPts.map((p) => ({ ...p, pressure: curve.evaluate(p.pressure) }));
    // No-pressure strokes (mouse) draw at constant nominal width: range = 1.
    const stroke = asEraser ? appState.eraser : appState.brush;
    const sr = (curved[0]?.hasPressure ?? true) ? stroke.sizeRange : 1;
    // SPREAD, never field by field. This was a hand-written list of every BrushSettings key, and
    // when `dwellPool` was added it was not added here — so the ink pooling feature shipped, was
    // tuned twice against user reports, and had never once run: the engine read `undefined` on
    // every stroke. A list that has to be extended in a second file every time a brush parameter
    // is added will eventually not be, and nothing in the type system or the tests catches it,
    // because ToolSettings is a superset of BrushSettings and the extra keys are ignored.
    // alphaLock is a LAYER property, so it overrides the tool setting's (always-false) field. The
    // engines' ladder is eraser > alphaLock > drawBehind, so the eraser is untouched by it.
    const settings = {
      ...stroke,
      isEraser: asEraser,
      alphaLock: strokeLayer?.alphaLock === true,
    };
    const kind = stroke.brushType; // local so TS narrows it across the branches
    if (kind === "smooth") {
      // Smooth (perfect-freehand): full redraw from the pre-stroke snapshot.
      strokeCtx.putImageData(beforeSnapshot!, 0, 0);
      // try/finally at all three: strokeCtx is LONG-LIVED (it is the cell's own context), so a
      // throw between save() and restore() strands the clip and silently confines every later
      // stroke to a region the artist cannot see.
      strokeCtx.save();
      try {
        strokeCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
        selection?.applyClip(strokeCtx);
        drawStroke(strokeCtx, curved, settings, done, sr);
      } finally {
        strokeCtx.restore();
      }
    } else if (kind === "calligraphy") {
      // Calligraphy: full redraw like smooth, NOT incremental — the whole swept ribbon has to
      // be one path filled once, or every overlap between segments double-composites and a
      // translucent stroke comes out blotchy at the joins.
      strokeCtx.putImageData(beforeSnapshot!, 0, 0);
      strokeCtx.save();
      try {
        strokeCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
        selection?.applyClip(strokeCtx);
        drawCalligraphyStroke(strokeCtx, curved, settings, sr);
      } finally {
        strokeCtx.restore();
      }
    } else if (kind === "ink") {
      // Ink/marker: full redraw like smooth, NOT incremental — a per-segment stroke
      // re-composites the antialiased fringe at every overlap and hardens the edge into
      // jaggies (see the header of ink-brush.ts for the measurements).
      strokeCtx.putImageData(beforeSnapshot!, 0, 0);
      strokeCtx.save();
      try {
        strokeCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
        selection?.applyClip(strokeCtx);
        drawInkStroke(strokeCtx, curved, settings, sr);
      } finally {
        strokeCtx.restore();
      }
    } else {
      // Stamp engine (pencil/charcoal/airbrush): incremental — no snapshot restore.
      strokeCtx.save();
      try {
        strokeCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
        selection?.applyClip(strokeCtx);
        drawStampStrokeIncremental(strokeCtx, curved, { ...settings, brushType: kind }, sr);
      } finally {
        strokeCtx.restore();
      }
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
    // Grab-time playhead, and the ONLY frame this gesture reads or keys an animated layer at.
    // Deliberately NOT frame scope's settle-on-playhead-change bail: frame scope settles because its
    // target CELL changes identity mid-gesture, which cannot happen here (the layer is the same
    // object), and settling would make it impossible to nudge a layer while playback loops — which
    // is a natural way to work. Reading the live playhead instead scattered a key at every frame
    // playback passed, each derived from the grab-frame's startT, all inside one undo entry.
    keyFrame: number;
    // Did this gesture actually write a transform? Drives commit-vs-drop when we settle without a
    // readable end transform (undo/tool-switch), instead of committing an empty entry.
    dirty: boolean;
    /** Latched at grab, like every other drag input here: toggling Keep proportions mid-gesture must
     *  not change what the drag in flight is doing (the selection latches it the same way). */
    keepProportions: boolean;
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
  // Same direct-object-ref shape as refDragFreeze, for the layer-scope transform track: captured at
  // grab so a no-op drag can put the track back exactly as it was. withTransformKey always REPLACES
  // the track (never mutates in place), so the reference captured here is already a valid
  // before-snapshot — nothing needs deep-copying, unlike the box freeze above.
  let refTrackFreeze: {
    layer: Layer | null;
    group: LayerGroup | null;
    prevTrack: TransformTrack;
  } | null = null;

  // there and commit unconditionally (the drag DID change state; an unrecorded change is the bug
  // this feature removes).
  function finishTransformDragUndo() {
    // Every `refDrag = null` in this file is paired with a call to this function, so this is the one
    // place the published drag frame has to be retired — pointerup, pointercancel, the retarget
    // bail, and transformDragGuard.settle (undo/redo, tool switch, replaceProject) all route here.
    appState.transformDragFrame = null;
    if (refDragUndo) {
      // Nothing was written (grab missed a handle, or settled from undo()/a tool switch before the
      // pointer moved) → drop the snapshot. Committing here pushed a before==after entry that the
      // caller's own undo then popped, so the user's undo silently did nothing.
      // `dirty` is already computed from the value WRITTEN (see onTransformDrag), so a second
      // read-back here would undo that care: with `sampleEvery > 1` a track resolves a frame off its
      // sample grid to a lerp, so a genuine key could read back as "unchanged" and be reverted with
      // no undo entry — a real edit silently discarded. `dirty` alone decides.
      const wrote = !!refDrag?.handle && refDrag.dirty;
      if (wrote) {
        commitStructuralEdit(refDragUndo);
      } else if (wrote || refDrag?.handle) {
        // No-op drag: push nothing, revert the freeze we did at grab.
        if (refDragFreeze?.cell) refDragFreeze.cell.transformBox = refDragFreeze.prevBox;
        else if (refDragFreeze?.group) refDragFreeze.group.transformBox = refDragFreeze.prevBox;
        // Also revert any key withTransformKey inserted along the way: the resulting VALUE
        // matches startT (that's why we're here), but the TRACK OBJECT may not — a fresh key can
        // exist where none did — and no undo command is being pushed to fix that via
        // restoreStructure, since committing was just decided against above.
        // Put the frozen track back into a FRESH bag, so the revert cannot clobber a sibling
        // track the same layer may have gained — and never mutate the bag in place (gotcha #8).
        if (refTrackFreeze?.layer)
          refTrackFreeze.layer.tracks = {
            ...refTrackFreeze.layer.tracks,
            transform: refTrackFreeze.prevTrack,
          };
        else if (refTrackFreeze?.group)
          refTrackFreeze.group.tracks = {
            ...refTrackFreeze.group.tracks,
            transform: refTrackFreeze.prevTrack,
          };
        // The drag bumped persistTick on every move, so the ~3s autosave debounce may already have
        // written the TRANSIENT state (press and hold past it without moving). Reverting the live
        // document is not enough — the saved slot has to be re-dirtied so the restore lands too.
        // Covers the prevBox revert above as well, which is not value-neutral either.
        bump();
      }
    }
    refDragUndo = null;
    refDragFreeze = null;
    refTrackFreeze = null;
    // Only release the shared hook if this drag still owns it. It is one slot shared by six
    // registrants, so clearing it unconditionally could null a hook belonging to another gesture
    // and leave that one's bracket unsettleable by undo.
    if (transformDragGuard.settle === settleRefDrag) transformDragGuard.settle = null;
  }

  /** Named (rather than a fresh closure per grab) so the ownership check above can compare it. */
  function settleRefDrag() {
    finishTransformDragUndo();
    refDrag = null;
  }

  function onTransformDrag(layer: Layer, points: { x: number; y: number }[], done: boolean) {
    const W = appState.project.width,
      H = appState.project.height;
    const p = points[points.length - 1];

    const scope = transformScope();
    const isDraw = layer.kind === "draw";
    const g = groupOf(layer, appState.project.groups);
    // The frame this gesture reads and keys at. Before the grab (the hit test and the startT capture
    // below) refDrag is null and this IS the live playhead, i.e. the grab frame; from the grab on it
    // is frozen, so a playhead that moves mid-gesture (playback, or the global ←/→ keys) cannot
    // scatter keys across the track. `finishTransformDragUndo`'s `endT` thunk runs while refDrag is
    // still set, so its isSameTransform check compares the same frame startT was taken at.
    const dragFrame = () => refDrag?.keyFrame ?? appState.playhead;

    // Resolve target + base + compose-steps (outer transforms above the target, inner-to-outer).
    let getT: () => typeof layer.transform, setT: (t: typeof layer.transform) => void;
    let base: { x: number; y: number; w: number; h: number } | null;
    const outerSteps: ComposeStep[] = [];
    // Set only by the layer-scope branch below (draw layer at layer scope, or a ref layer under
    // any scope) — the grab site below uses it to know whether to freeze a transform track
    // reference for a no-op-drag revert (frame/group scope have no track at their own level).
    let trackScopeLayer: Layer | null = null;
    // The group-scope twin of `trackScopeLayer` above.
    let trackScopeGroup: LayerGroup | null = null;

    if (isDraw && scope === "group" && g) {
      if (groupHasLockedLayer(g, appState.project.layers)) {
        if (done) {
          finishTransformDragUndo();
          refDrag = null;
        }
        return;
      }
      // An animated GROUP reads and writes THROUGH its track, exactly as the layer-scope branch
      // below does — same auto-key, same undo bracket, same no-op revert, because the whole drag
      // lifecycle already runs through this getT/setT pair.
      trackScopeGroup = g;
      getT = () => groupTransformAt(g, dragFrame());
      setT = (nt) => {
        const track = g.tracks?.transform;
        if (!track) {
          g.transform = nt;
          return;
        }
        // Replace the BAG and the track: undo snapshots share the GROUP object too (gotcha #8 at
        // two levels), and the spread keeps any sibling track a group may gain later.
        g.tracks = { ...g.tracks, transform: withTransformKey(track, dragFrame(), nt) };
      };
      // The DRAG frame, not the live playhead, for the same reason the transform beside it uses it:
      // the box and the transform it is paired with must be read at ONE frame or an animated group's
      // pivot would slide out from under a startT captured at the grab frame. (Group boxes are
      // frame-independent today, so this is coherence rather than a visible bug — but
      // `RefTransformGizmo.transformTarget` already pairs them, so the two must not disagree.)
      base = groupBoxLogical(g, appState.project, dragFrame(), DPR, appState.version);
    } else {
      // scope = "layer" (or ref layer). An animated layer reads and writes THROUGH the track;
      // `base` stays live (never frozen to `track.box`, which Task 5 fixed at null for layer
      // tracks) since a layer's base rect is the document rect / a media contain-fit — neither
      // drifts the way a content-derived transformBox does, and resizeProject never touches
      // transform/tracks.
      base = transformBaseRect(layer, W, H);
      trackScopeLayer = layer;
      getT = () => transformAt(layer, dragFrame());
      setT = (nt) => {
        const track = layerTransformTrack(layer);
        if (!track) {
          layer.transform = nt;
          return;
        }
        // Replace the BAG and the track: undo snapshots share the layer (gotcha #8), and the
        // no-mutation rule now reaches both levels. The spread keeps any sibling track.
        layer.tracks = { ...layer.tracks, transform: withTransformKey(track, dragFrame(), nt) };
      };
      // Outer = group (if any).
      if (g)
        outerSteps.push({
          base: groupBoxLogical(g, appState.project, dragFrame(), DPR, appState.version),
          t: groupTransformAt(g, dragFrame()), // frozen drag frame — see the frame-scope note above
        });
    }
    if (!base) {
      if (done) {
        finishTransformDragUndo();
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
      finishTransformDragUndo();
      refDrag = null;
      return;
    }
    if (!refDrag) {
      const tol = 10 / viewport.zoom;
      const gap = REF_ROTATE_GAP_PX / viewport.zoom;
      const handle = hitTestHandle(base, getT(), pc, tol, gap);
      if (handle) {
        refDragUndo = beginStructuralEdit(); // FIRST: snapshot must capture the old shared cell (gotcha #8)
        transformDragGuard.settle = settleRefDrag;
        // Freeze the box on grab for a group transform currently at identity.
        if (isIdentityTransform(getT())) {
          if (isDraw && scope === "group" && g) {
            refDragFreeze = { cell: null, group: g, prevBox: g.transformBox ?? null };
            g.transformBox = base;
          }
        }
        // An animated layer's (or group's) track is mutable state a no-op drag must be able to
        // revert (see finishTransformDragUndo) — capture it here, before any write.
        // ONLY when a track actually exists: with none, the revert would write
        // `tracks = { transform: undefined }` where the field had been ABSENT, leaving an empty bag
        // behind after the single most common gesture in the app — and a revert of nothing is a
        // no-op anyway, since `setT` writes the static field on an unanimated target.
        const scopeTrack = trackScopeLayer
          ? layerTransformTrack(trackScopeLayer)
          : trackScopeGroup?.tracks?.transform;
        if (scopeTrack) {
          refTrackFreeze = {
            layer: trackScopeLayer,
            group: trackScopeLayer ? null : trackScopeGroup,
            prevTrack: scopeTrack,
          };
        }
      }
      refDrag = {
        handle,
        start: pc,
        startT: { ...getT() },
        center: transformCenter(base, getT()),
        cell: null, // per-frame (cell) transforms are no longer dragged — Frame scope left the UI
        layerId: layer.id,
        groupId: g?.id ?? null,
        keyFrame: appState.playhead,
        dirty: false,
        keepProportions: appState.keepProportions,
      };
      // The status hint promises "a drag keys frame N"; publish the frozen frame so it names the
      // one that will actually be written rather than a playhead that may move under a held drag.
      // Only once a HANDLE is engaged: a press that missed every handle writes nothing, so
      // publishing there froze the hint's frame for a gesture that will never key.
      if (refDrag.handle) appState.transformDragFrame = refDrag.keyFrame;
    }
    const d = refDrag;
    if (d.handle) {
      // Unconditional, every event — including a pure click, which falls through to this same
      // call right after the grab above with pc === d.start. For an animated layer this DOES
      // transiently insert/replace a key via withTransformKey even when the value is unchanged,
      // but that is fine: the key exists only between pointerdown and pointerup. On a no-op
      // gesture the settle branch in finishTransformDragUndo restores refTrackFreeze.prevTrack
      // before anything can persist it (commitStructuralEdit is not called on that branch, and
      // autosave is debounced well past a click) — see the round-2 fix note in the task-6 report.
      // An earlier round gated this write on the value actually changing, but the gate also
      // skipped bump() (the repaint trigger): returning to the grab point mid-drag then left the
      // canvas visibly stuck at its last-drawn position. Reverted; gate removed on purpose.
      const nt = dragTransform(d.handle, d.startT, d.center, d.start, pc, d.keepProportions);
      setT(nt);
      // Compare what was WRITTEN, not a read-back. With `sampleEvery > 1` a track quantises the
      // sampled frame, so reading at a frame off the grid returns a lerp toward the key rather than
      // the key itself: algebraically the same value, but `isSameTransform` is exact field equality,
      // so float rounding could make a click-without-move look like a change and push an undo entry.
      d.dirty = !isSameTransform(d.startT, nt);
      bump();
    }
    if (done) {
      finishTransformDragUndo();
      refDrag = null;
    }
  }

  function commitOpenStroke(pts: InputPoint[], asEraser = appState.tool === "eraser") {
    if (!strokeCanvas || !strokeCtx || !beforeSnapshot) {
      strokeCanvas = null;
      strokeCtx = null;
      beforeSnapshot = null;
      strokeSteps = null;
      strokeLayer = null;
      strokeMaterialized = null;
      return;
    }
    if (drawRaf) {
      cancelAnimationFrame(drawRaf);
      drawRaf = 0;
    }
    paintStroke(pts, true, asEraser);
    const after = strokeCtx.getImageData(0, 0, strokeCanvas.width, strokeCanvas.height);
    const target = strokeCtx;
    const before = beforeSnapshot;
    // Drawing on a hold (or past the layer's end) MATERIALIZED a keyframe. That is a structural
    // change, and it rides in this same command so one stroke stays one ⌘Z: undo takes the pixels
    // AND the ◆ it created, redo puts both back. Leaving it out is what let a later structural undo
    // delete the cell this command's `target` points into.
    const layerId = strokeLayer?.id ?? null;
    const mat = strokeMaterialized;
    history.push(
      pixelCommand(
        target.canvas,
        () => {
          target.putImageData(before, 0, 0);
          if (layerId !== null && mat) restoreTrackById(layerId, mat.before);
          recomposite();
        },
        () => {
          // Cell track FIRST: the canvas `target` writes into only belongs to the document once its
          // cell is back in the track.
          if (layerId !== null && mat) restoreTrackById(layerId, mat.after);
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
    strokeLayer = null;
    strokeMaterialized = null;
    bump(); // refresh the timeline (e.g. an empty cell that just gained ink flips ·→◆)
  }

  function onStroke(points: InputPoint[], done: boolean) {
    if (dropStrokeUntilUp) {
      if (done) dropStrokeUntilUp = false;
      return;
    }
    const wt = workingTarget(appState.activeRow);
    if (wt.kind === "audio") {
      const t = appState.tool;
      if (t !== "eyedropper" && t !== "select" && t !== "lasso") return;
    }
    if (wt.kind === "group") {
      // Transform still aims at the group (scope set on select, including a group track).
      // Other pixel tools dim — leftover member is not the target.
      const t = appState.tool;
      if (t !== "eyedropper" && t !== "select" && t !== "lasso" && t !== "transform") return;
      // ...but only while the gesture really is that group's: the anchor `activeLayerId` under a
      // group row is memory, so layer scope, an anchor left in ANOTHER group, or a ref anchor would
      // each move something the lit row does not name. Same predicate as
      // RefTransformGizmo.activeTransformLayer, and these two MUST agree for the same reason the
      // gizmo and refPinned below do — a hidden handle set does not disable this drag.
      if (t === "transform" && !rowAdmitsTransform(appState.activeRow, activeLayer())) return;
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
    if (al.kind === "ref" && wt.kind === "layer") {
      // A pinned reference: its gizmo is live under EVERY tool, so this is the one guard that stops
      // a stray canvas drag from nudging an aligned reference. Derived, so a locked/hidden GROUP
      // pins its refs too (the gizmo already used the derived form — these must agree).
      // Outside its frame span the ref draws nothing, so a drag would move something invisible —
      // and the gizmo hides there, which would otherwise leave the drag reachable with no handles.
      const refPinned =
        isLayerLocked(al, appState.project.groups) ||
        !isLayerVisible(al, appState.project.groups) ||
        !isRefVisibleAtFrame(al, appState.playhead, appState.project.fps);
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
        transformScope() === "group" && groupOf(al, appState.project.groups) != null;
      if (!groupScope && !isLayerEditable(al, appState.project.groups)) {
        // Locked or hidden = content is immovable. Also settle any drag that was in flight when the
        // lock/hide landed (mid-gesture), so its undo bracket can't leak into the next gesture.
        finishTransformDragUndo();
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
          // The nub reshapes the mesh too (rotation moves its bbox), so the bar hides exactly as
          // for a handle drag — and stops re-anchoring (two layout reads) on every Pencil move.
          poseBarDragging = true;
        } else {
          const hit = meshPose.handleAt(p, 10 * hitPx);
          activeHandle = hit !== null ? hit : meshPose.addHandleAt(p);
          poseDrag = activeHandle;
          poseBarDragging = true;
        }
        repaintPoseOverlay();
      } else {
        // Move and release share this. The pointerup sample is not a move event; skipping it left
        // the handle where the last move landed, short of the Pencil.
        if (poseAdjusting && activeHandle !== null) {
          // Coupled: direction sets rotation, distance sets reach (snap to unlimited past the extent).
          const c = meshPose.deformed[meshPose.handles[activeHandle].vertex];
          const d = Math.hypot(p.x - c.x, p.y - c.y);
          meshPose.rotateHandle(activeHandle, Math.atan2(p.y - c.y, p.x - c.x));
          meshPose.setReach(activeHandle, d >= poseReachMax() ? undefined : d);
          poseDirty = true;
          repaintPoseOverlay();
        } else if (poseDrag !== null) {
          meshPose.dragHandle(poseDrag, p);
          poseDirty = true;
          repaintPoseOverlay();
        }
        if (done) {
          poseDrag = null;
          poseBarDragging = false;
          poseAdjusting = false;
        }
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
          deformGrab = { x: p.x, y: p.y };
          selection.startDrag(handle, p.x, p.y);
        }
      } else if (!done) {
        if (selectionMode === "drag") {
          selection.updateDrag(p.x, p.y);
          deformDirty = true;
        }
      } else {
        if (selectionMode === "drag") {
          selection.updateDrag(p.x, p.y);
          if (!deformGrab || p.x !== deformGrab.x || p.y !== deformGrab.y) deformDirty = true;
          selection.endDrag();
        }
        deformGrab = null;
        selectionMode = null;
        recomposite(); // settle, direct: one per gesture, and it must land even if rAF is starved
      }
      return;
    }
    if (appState.tool === "select" || appState.tool === "lasso") {
      if (selectToolsBlock()) return; // a reference row: nothing to lift or copy
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
          selection.keepProportions = appState.keepProportions; // read at grab, like every drag input
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
        if (selectionMode === "create") selection.updateCreate(p.x, p.y);
        else if (selectionMode === "drag") selection.updateDrag(p.x, p.y);
        if (selectionMode === "create") selection.endCreate();
        selection.endDrag();
        selectionMode = null;
        recomposite(); // settle, direct: one per gesture, and it must land even if rAF is starved
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
    // The tool is driven entirely by the on-canvas bar (ToolOptions carries only a hint string,
    // no knobs) — a canvas gesture must not fall through to the default paint path below. A press
    // with no live session enters it, the same fallback Pose and Deform have: otherwise any way of
    // being on Outline without a session (a restored preference, "Nothing to outline" and then a
    // frame step) left a lit button, no bar and a canvas that ignored every tap.
    if (appState.tool === "outline") {
      if (!outlineActive() && points.length === 1 && !done) enterOutline();
      return;
    }
    if (!strokeCanvas) {
      // First event of the stroke: resolve the target layer once and bail if it's
      // locked or hidden. Binding the layer here (rather than re-reading activeLayer() every
      // move) keeps the whole stroke on the layer it started on.
      const layer = activeLayer();
      if (!isLayerEditable(layer, appState.project.groups) || onLoopFrame(layer)) return;
      const mk = ensureDrawableKeyframe(layer, appState.playhead, canvasOps);
      strokeCanvas = mk.canvas;
      strokeLayer = layer;
      strokeMaterialized = mk.materialized;
      strokeCtx = strokeCanvas.getContext("2d", { willReadFrequently: true })!;
      beforeSnapshot = strokeCtx.getImageData(0, 0, strokeCanvas.width, strokeCanvas.height);
      strokeSteps = cellComposeSteps(layer);
      const bt = activeStroke().brushType;
      // smooth, calligraphy and ink are stateless full-redraw engines; the rest are stamps.
      if (bt !== "smooth" && bt !== "calligraphy" && bt !== "ink") resetStampState();
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
      if (outlineBarEl && outlineActive()) positionOutlineBar();
      const ss = displayOutputScale();
      if (ss !== lastOutputScale) {
        lastOutputScale = ss;
        recomposite(); // zoom crossed a backing-store step
      }
    };

    selection.onChange = () => {
      // Nothing on the DISPLAY canvas changes while a selection drag is in flight: the dragged
      // pixels were lifted onto the overlay, and the hole they left in the cell was composited when
      // the lift happened. The drag's own painting is the overlay's (`drawOverlay`). One settle on
      // release covers the case where a drag DID change something the display owns — see the
      // `endDrag()` call sites. Every non-drag change (deform mode switch, reset pins) still lands,
      // coalesced to a frame.
      if (selectionMode === "drag") return;
      // The Outline preview is clipped by the marquee at WRITE time, so a changed marquee must
      // re-derive it — otherwise the cell keeps the old clip until the next knob change.
      if (outlineActive()) scheduleOutlinePreview();
      scheduleRecomposite();
    };
    selection.onStateChange = () => {
      if (outlineActive()) scheduleOutlinePreview(); // a marquee made or cleared re-clips it
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
      try {
        selCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
        applyInverseCompose(selCtx, liftComposeSteps);
        selection.renderFloatingTo(selCtx);
      } finally {
        // Same class as the fill/stroke pairs: selCtx is the CELL's context and outlives this call,
        // so a throw in between (drawWarpedMesh on a degenerate warp grid is the candidate) would
        // strand the composed transform on it. Milder than a stranded clip — later writers mostly
        // setTransform or getImageData first — but "we hardened all of them" has to be true.
        selCtx.restore();
      }
      const ctx = selCtx;
      const before = selBefore;
      const layerId = selLayer?.id ?? null;
      const mat = selMaterialized;
      const after = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
      history.push(
        pixelCommand(
          ctx.canvas,
          () => {
            ctx.putImageData(before, 0, 0);
            if (layerId !== null && mat) restoreTrackById(layerId, mat.before); // lifting on a hold made this ◆
            recomposite();
          },
          () => {
            if (layerId !== null && mat) restoreTrackById(layerId, mat.after);
            ctx.putImageData(after, 0, 0);
            recomposite();
          },
          before,
          after,
        ),
      );
      clearLiftTarget();
      bump();
      recomposite();
    };

    selection.onCancel = () => {
      if (selCtx && selBefore) {
        selCtx.putImageData(selBefore, 0, 0);
        markInkChanged(selCtx.canvas);
        // A cancelled lift leaves nothing behind — including the keyframe it materialised.
        // Reverting the TRACK needs a bump, not just a repaint: the lift's entry already bumped
        // (pasteSelection does so explicitly), so without this `persistTick` describes a document
        // state that has since been undone. The sibling revert sites all bump for the same reason.
        if (selLayer && selMaterialized) {
          restoreCellTrack(selLayer, selMaterialized.before);
          bump();
        }
        recomposite();
      }
      clearLiftTarget();
    };

    selectionRef.current = selection;
    liftGuard.discard = discardActiveEdits;
    poseActions.active = () => meshPose !== null;
    poseActions.apply = () => applyPose();
    poseActions.cancel = () => cancelPose();
    outlineActions.active = outlineActive;
    outlineActions.apply = applyOutline;
    outlineActions.cancel = cancelOutline;
    outlineActions.reenter = enterOutline;
  }

  /**
   * Crop the document-space selection from what the active layer looks like on the paper.
   * Identity compose is a straight cell blit (bit-identical to the old copyPixels path).
   */
  function cropComposedSelection(): HTMLCanvasElement | null {
    if (!selection?.rect) return null;
    const al = activeLayer();
    if (al.kind !== "draw") return null;
    const rk = resolvedDisplayKeyCell(al, appState.playhead);
    if (!rk) return null;
    const W = appState.project.width;
    const H = appState.project.height;
    const cellT = cellTransform(rk.cell);
    const g = groupOf(al, appState.project.groups);
    // At the playhead, and frame-aware for a reason worth stating: this feeds the IDENTITY
    // FAST-PATH below. A static read on an animated group would report identity on the frames its
    // track happens to pass through zero and take the lossless cell blit where the composed crop
    // was needed — a silent, pixel-level wrong answer rather than a visible one.
    const groupT = groupTransformAt(g, appState.playhead);
    const layerT = transformAt(al, appState.playhead);
    if (isIdentityTransform(layerT) && isIdentityTransform(cellT) && isIdentityTransform(groupT)) {
      // Document space == cell space: crop the cell bitmap at this.rect (same blit as today).
      const ctx = rk.cell.canvas.getContext("2d", { willReadFrequently: true })!;
      return selection.copyPixelsFromDoc(ctx, DPR);
    }
    const tmp = document.createElement("canvas");
    tmp.width = W * DPR;
    tmp.height = H * DPR;
    const tctx = tmp.getContext("2d")!;
    const boxDev = cellPivotBoxDev(
      rk.cell.canvas,
      rk.cell.transformBox,
      isIdentityTransform(cellT),
      W,
      H,
      DPR,
      appState.version,
    );
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
      layerT,
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
    // The working ROW must be a layer, not only the leftover `activeLayerId`. `onStroke` admits
    // select/lasso on an audio or group row on a "copy is a read" rationale — sound for
    // `copySelection`, but the PRIMARY select gesture is a WRITE: with the audio lane selected a
    // marquee drag lifted and moved pixels out of a layer no row named, undoably, materialising a
    // ◆ on a hold, while ToolOptions had Cut/Paste/Delete dimmed one bar away.
    if (workingTarget(appState.activeRow).kind !== "layer") return false;
    const layer = activeLayer();
    if (!isLayerEditable(layer, appState.project.groups) || onLoopFrame(layer)) return false;
    const mk = ensureDrawableKeyframe(layer, appState.playhead, canvasOps);
    const canvas = mk.canvas;
    selLayer = layer;
    selMaterialized = mk.materialized;
    selCtx = canvas.getContext("2d", { willReadFrequently: true })!;
    selBefore = selCtx.getImageData(0, 0, canvas.width, canvas.height);
    const crop = cropComposedSelection();
    if (!crop) {
      // Nothing to lift — put back the keyframe this just materialised rather than stranding a ◆
      // for a gesture that did nothing.
      if (mk.materialized) restoreCellTrack(layer, mk.materialized.before);
      clearLiftTarget();
      return false;
    }
    // Refresh before the hole punch so we don't clip with a previous layer's steps.
    const steps = cellComposeSteps(layer);
    selection.composeSteps = steps;
    liftComposeSteps = steps;
    selection.cellSpaceLift = false; // a paper crop: overlay stays uncomposed
    selCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    selection.clearRegion(selCtx, DPR);
    markInkChanged(selCtx.canvas); // the lift punched a hole in the cell
    selection.beginTransform(crop);
    syncOverlayScale();
    return true;
  }

  // Drawable ctx for the current frame (for delete/paste — materializes a key on a hold). Null
  // unless the working ROW is a layer AND that layer is an editable (unlocked, visible) drawing
  // layer. The row check is not redundant: `activeLayerId` is memory that survives selecting the
  // audio lane or a group row, so without it these writes land in a layer nothing on screen names.
  /** The active layer, but only when it is a writable drawing target: a layer working row (not
   *  audio / group / group track) carrying an unlocked, visible drawing layer. Split out of
   *  `activeDrawableCtx` so the SAME question can be asked without the side effect below —
   *  `ensureDrawableKeyframe` materialises a keyframe on a hold, so it must never run for a query. */
  function drawableTarget(): DrawingLayer | null {
    if (workingTarget(appState.activeRow).kind !== "layer") return null;
    const layer = activeLayer();
    return isLayerEditable(layer, appState.project.groups) && !onLoopFrame(layer) ? layer : null;
  }

  function activeDrawableCtx(): {
    ctx: CanvasRenderingContext2D;
    layer: DrawingLayer;
    materialized: CellTrackChange | null;
  } | null {
    const layer = drawableTarget();
    if (!layer) return null;
    const { canvas, materialized } = ensureDrawableKeyframe(layer, appState.playhead, canvasOps);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return { ctx, layer, materialized };
  }

  /**
   * Also put the selection on the SYSTEM clipboard as a PNG, so pixels flow both ways between the
   * slop-* apps (this one already receives an image paste). Best-effort by design: the internal
   * copy above has already succeeded, so nothing here may throw, and a browser that cannot do it is
   * not a failure worth interrupting a working action for.
   *
   * `ClipboardItem` MUST be constructed synchronously inside the gesture, with the blob's PROMISE
   * rather than an awaited blob — Safari rejects a write whose item was built after an await, so
   * the obvious `const blob = await …` first line is exactly what breaks it.
   */
  function copyToSystemClipboard(canvas: HTMLCanvasElement) {
    // Undefined outside a secure context — e.g. the LAN dev server over plain http on iPad. Silent:
    // the copy worked, and only the bonus is unavailable.
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return;
    const png = new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
    );
    void navigator.clipboard.write([new ClipboardItem({ "image/png": png })]).catch(() => {
      // A real rejection (permission denied, or a browser that advertises write but refuses PNG).
      // A hint rather than an alert: a modal would interrupt a copy that DID work to report that an
      // extra did not.
      appState.statusHint = "Copied — but this browser would not put it on the system clipboard";
    });
  }

  function copySelection() {
    if (!selection || selection.state !== "selected" || !selection.rect) return;
    const float = cropComposedSelection();
    if (float) {
      selectionClipboard = { canvas: float, rect: { ...selection.rect } };
      appState.hasPixelClipboard = true;
      copyToSystemClipboard(float);
    }
  }

  function deleteSelection() {
    if (!selection || selection.state !== "selected") return;
    const target = activeDrawableCtx();
    if (!target) return;
    const { ctx, layer, materialized } = target;
    const layerId = layer.id;
    const before = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    selection.clearRegion(ctx, DPR);
    const after = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    history.push(
      pixelCommand(
        ctx.canvas,
        () => {
          ctx.putImageData(before, 0, 0);
          if (materialized) restoreTrackById(layerId, materialized.before); // deleting on a hold made this ◆
          bump();
        },
        () => {
          if (materialized) restoreTrackById(layerId, materialized.after);
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
    const target = activeDrawableCtx();
    if (!target) return false;
    selCtx = target.ctx;
    selLayer = target.layer;
    selMaterialized = target.materialized; // pasting onto a hold materialises the ◆ this float lands in
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

  /** Flip the selection horizontally or vertically. A plain selection is lifted first — the same
   *  lift (and the same refusals) as Free transform — so the flip shows up as a float with handles;
   *  the lift and its commit stay one undo step. */
  function flipSelection(axis: "h" | "v") {
    if (!selection) return;
    if (selection.state === "selected") enterTransform();
    if (selection.state !== "transforming") return;
    selection.flip(axis);
    recomposite();
  }

  function enterDeform() {
    const al = activeLayer();
    if (
      workingTarget(appState.activeRow).kind !== "layer" ||
      !isLayerEditable(al, appState.project.groups) ||
      onLoopFrame(al)
    )
      return;
    // TEAR DOWN THE PREVIOUS LIFT FIRST — this ordering is load-bearing. `cancel()` reverts an
    // in-progress lift, and that revert now includes the cell track (a lift on a hold materialised
    // a ◆). Materialising before cancelling meant cancel could remove the very cell whose canvas we
    // had just taken, so the deform would lift from, and bake into, a detached canvas: silent loss.
    // (It also means the content bounds below are measured on a canvas without the old lift's hole.)
    selection.cancel();
    const mk = ensureDrawableKeyframe(al, appState.playhead, canvasOps);
    const canvas = mk.canvas;
    const rect = contentRectLogical(contentBounds(canvas, appState.version), DPR);
    if (!rect) {
      if (mk.materialized) restoreCellTrack(al, mk.materialized.before); // nothing to deform → leave the hold alone
      return; // empty cell
    }
    selLayer = al;
    selMaterialized = mk.materialized;
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
    markInkChanged(selCtx.canvas);
    if (!lifted) {
      selection.cellSpaceLift = false;
      if (selMaterialized) restoreCellTrack(al, selMaterialized.before); // abandoned → leave the hold alone
      clearLiftTarget();
      return;
    }
    syncOverlayScale(); // handles/grid stay screen-constant against zoom × compose scale
    selection.beginTransform(lifted);
    selection.beginWarp(4, 4);
    deformDirty = false; // fresh lift — nothing moved yet
  }

  // Reactive gate for the pose bar: read the proxy's version (reactive) so the bar
  // re-evaluates whenever bump() runs on enter/apply/cancel. meshPose itself is kept as a
  // plain local rather than migrated to `$state` (this file now aliases the store import as
  // `appState` — see CLAUDE.md gotcha #1 — so a rune would no longer conflict, but that's out
  // of scope for this change).
  function poseBarVisible(): boolean {
    // Hidden while a handle is under the pen: the bar is anchored to the mesh bbox, which the drag
    // is reshaping, so it would slide around mid-gesture. The selection bar hides for the same
    // reason (`selection.isDragging`).
    return appState.version >= 0 && meshPose !== null && !poseBarDragging;
  }

  // The bar is rendered by the block below, so on the first paint after entering Pose (and after a
  // drag that hid it) the element does not exist yet and `positionPoseBar` has nothing to measure —
  // it would flash at 0,0 for a frame. Re-anchor as soon as the element does exist.
  $effect(() => {
    if (poseBarEl && meshPose) positionPoseBar();
  });

  /** Anchor a bar over (or under) a CELL-space bbox, the way the selection bar anchors to a
   *  selection. Returns the workspace-relative position, or null when it cannot measure yet. */
  function anchorBarToBox(
    box: { x: number; y: number; w: number; h: number },
    el: HTMLElement | undefined,
  ): { x: number; y: number } | null {
    if (!el || !stage || !viewport) return null;
    const wsRect = stage.getBoundingClientRect();
    const panelRect = el.getBoundingClientRect();
    const a = computeAnchor({
      bboxDoc: [
        { x: box.x, y: box.y },
        { x: box.x + box.w, y: box.y },
        { x: box.x + box.w, y: box.y + box.h },
        { x: box.x, y: box.y + box.h },
      ].map(composeToDoc),
      docToScreen: (p) => {
        const sp = viewport.canvasToScreen(p.x, p.y);
        return { x: sp.x - wsRect.left, y: sp.y - wsRect.top };
      },
      panelSize: { w: panelRect.width || 320, h: panelRect.height || 50 },
      viewport: { w: stage.clientWidth, h: stage.clientHeight },
      margin: POSE_BAR_MARGIN,
    });
    return { x: a.x, y: a.y };
  }

  /** Anchor the pose bar over (or under) the mesh, the way the selection bar anchors to a selection:
   *  same `computeAnchor`, so the above/below flip, the margin and the viewport clamp are one
   *  implementation. The mesh lives in CELL space, so its bbox goes out through `composeToDoc`
   *  first — the same mapping the selection bar's cell-space lift uses. */
  function positionPoseBar() {
    if (!meshPose || !poseBarEl) return;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const v of meshPose.deformed) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }
    if (!Number.isFinite(minX)) return;
    const p = anchorBarToBox({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, poseBarEl);
    if (p) poseBarPos = p;
  }

  let outlineBarEl: HTMLDivElement | undefined = $state();
  let outlineBarPos = $state({ x: 0, y: 0 });

  function positionOutlineBar() {
    const b = outlineInk;
    if (!b) return;
    // The ink as it was on ENTRY, in device px. Re-measuring the preview each tick cost a
    // full-canvas `getImageData` + scan per scrub frame (the preview voids the bounds cache), and
    // bought nothing: the band never strays more than `WOBBLE_MAX` from the original edge.
    const p = anchorBarToBox(
      { x: b.x / DPR, y: b.y / DPR, w: b.w / DPR, h: b.h / DPR },
      outlineBarEl,
    );
    if (p) outlineBarPos = p;
  }

  // Same reason as the pose bar's effect: the element is created by the block this positions, so
  // the first pass has nothing to measure and would flash at 0,0.
  $effect(() => {
    if (outlineBarEl && outlineActive()) positionOutlineBar();
  });

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
    positionPoseBar(); // the paint cadence is also the right cadence for the bar's anchor
    const octx = overlay.getContext("2d")!;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, overlay.width, overlay.height);
    applyViewTransform(octx);
    applyOverlayCompose(octx);
    const al = activeLayer();
    const px =
      1 / (viewport.zoom * (al.kind === "draw" ? composeScaleOf(cellComposeSteps(al)) : 1));
    if (meshPose && isLayerVisible(al, appState.project.groups)) {
      // The deformed raster is the LAYER'S content, so it fades with the layer exactly as the
      // compositor fades the cell — same rule as the floating selection's `contentAlpha`. The
      // wireframe, handles and reach tint below are UI, and stay at full strength.
      octx.save();
      octx.globalAlpha = layerContentAlpha(
        al,
        groupOf(al, appState.project.groups),
        appState.playhead,
      );
      meshPose.render(octx);
      octx.restore();
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
    if (
      workingTarget(appState.activeRow).kind !== "layer" ||
      !isLayerEditable(al, appState.project.groups) ||
      onLoopFrame(al)
    )
      return;
    // Tear down the previous lift BEFORE materialising — same load-bearing ordering as enterDeform:
    // cancel() now reverts the cell track too, and could otherwise delete the cell whose canvas this
    // pose is about to lift from and bake into.
    selection.cancel(); // also clears any stale selection/lasso so liftPixels uses our content rect
    const mk = ensureDrawableKeyframe(al, appState.playhead, canvasOps);
    const canvas = mk.canvas;
    const rect = contentRectLogical(contentBounds(canvas, appState.version), DPR);
    if (!rect) {
      if (mk.materialized) restoreCellTrack(al, mk.materialized.before); // nothing to pose → leave the hold alone
      return;
    }
    selLayer = al;
    selMaterialized = mk.materialized;
    selCtx = canvas.getContext("2d", { willReadFrequently: true })!;
    selBefore = selCtx.getImageData(0, 0, canvas.width, canvas.height);
    selCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    selection.rect = rect;
    selection.composeSteps = [];
    liftComposeSteps = [];
    const lifted = selection.liftPixels(selCtx, DPR); // clears the content region from the cell
    markInkChanged(selCtx.canvas);
    if (!lifted) {
      if (selMaterialized) restoreCellTrack(al, selMaterialized.before); // abandoned → leave the hold alone
      clearLiftTarget();
      return;
    }
    meshPose = MeshPose.fromLift(lifted, rect, DPR, poseSpacing, {
      fillHoles: appState.pose.fillHoles,
      gap: appState.pose.gap,
    });
    appState.poseActive = meshPose !== null;
    poseDirty = false; // fresh lift — nothing moved yet
    if (!meshPose) {
      if (selBefore) {
        selCtx.putImageData(selBefore, 0, 0); // no mesh → undo the lift
        markInkChanged(selCtx.canvas);
      }
      if (selMaterialized) restoreCellTrack(al, selMaterialized.before); // …including the ◆ it made
      clearLiftTarget();
      appState.poseFillWarning = "";
      recomposite();
      return;
    }
    // A gapped outline lets the flood escape, silently producing the old thin web. Say so, and name
    // the remedy.
    reportPoseFill();
    recomposite(); // show the hole where the content lifted out
    posePaint(); // draw the deformed raster + wireframe on the overlay
    // `repaint`, NOT `bump`: a LIFT is not a document edit. `liftPixels` punches the content out of
    // the cell canvas and holds it on the overlay, which autosave never sees — so bumping
    // `persistTick` here armed the 3s debounce to persist a HOLED cell (plus any ◆ the entry
    // materialised). Merely selecting the tool did that, once entry moved to the tool switch. The
    // pose bar only needs `version`, which is what `repaint` increments.
    repaint();
  }

  function applyPose() {
    if (!meshPose || !selCtx || !selBefore) return;
    selCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    meshPose.render(selCtx); // bake the deformed raster into the cell
    const ctx = selCtx;
    const before = selBefore;
    const layerId = selLayer?.id ?? null;
    const mat = selMaterialized;
    const after = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    history.push(
      pixelCommand(
        ctx.canvas,
        () => {
          ctx.putImageData(before, 0, 0);
          if (layerId !== null && mat) restoreTrackById(layerId, mat.before); // posing on a hold made this ◆
          recomposite();
        },
        () => {
          if (layerId !== null && mat) restoreTrackById(layerId, mat.after);
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
    poseBarDragging = false;
    activeHandle = null;
    poseAdjusting = false;
    clearLiftTarget();
    posePaint(); // meshPose null → clears overlay
    bump();
    recomposite();
  }

  function cancelPose() {
    if (meshPose && selCtx && selBefore) {
      selCtx.putImageData(selBefore, 0, 0);
      markInkChanged(selCtx.canvas);
      // …and the keyframe the lift materialised, so a cancelled pose leaves a hold a hold.
      if (selLayer && selMaterialized) restoreCellTrack(selLayer, selMaterialized.before);
    }
    meshPose = null;
    appState.poseActive = false;
    appState.poseFillWarning = "";
    poseDrag = null;
    poseBarDragging = false;
    activeHandle = null;
    poseAdjusting = false;
    clearLiftTarget();
    posePaint();
    recomposite();
    repaint(); // version only — the cancel restored the cell, so there is nothing new to persist
  }

  // Outline tool. Unlike Pose, the preview writes into the CELL and is re-derived from the snapshot
  // on every change — so what you see is the real compositor's output (layer opacity, the layer and
  // group transform, boil, onion), and an app killed mid-tune leaves an outline rather than the
  // empty cell an overlay lift would.
  let outlineCtx: CanvasRenderingContext2D | null = null;
  let outlineBefore: ImageData | null = null; // the WHOLE cell, for Cancel and the undo entry
  // Everything below works on `outlineRect` only: the ink's bounds grown by `OUTLINE_MARGIN`, the
  // furthest the band can reach. Nothing outside it can change, so a small drawing on a big cell
  // no longer pays for the cell's full size on every scrub tick.
  let outlineInk: { x: number; y: number; w: number; h: number } | null = null; // device px, at entry
  let outlineRect: { x: number; y: number; w: number; h: number } | null = null;
  let outlineSrc: ImageData | null = null; // outlineBefore cut to outlineRect
  let outlineField: Float32Array | null = null; // depends on the ART only — computed once per entry
  let outlineDepth: Float32Array | null = null; // localDepth of the field — once per entry
  let outlineAlpha: Uint8Array | null = null; // alpha plane extracted from outlineSrc — once per entry
  let outlineCov: Uint8ClampedArray | null = null; // coverage buffer, reused across previews
  // RGBA copy of outlineSrc with its colour bled outward (`bleedColor`), mutated in place each
  // preview (only the alpha channel changes).
  let outlinePreviewImg: ImageData | null = null;
  let outlineNoise: OutlineNoisePlanes | null = null; // depends on the seed only
  let outlineNoiseSeed: number | null = null; // seed outlineNoise was built for — rebuilt on mismatch
  /** Scratch canvas holding the FULL outline, used only when a marquee clips the write: the clipped
   *  path cannot use `putImageData` (it ignores clip paths), so the outline has to arrive by
   *  `drawImage`. Built on first clipped preview and reused, like the other per-entry buffers. */
  let outlineScratch: HTMLCanvasElement | null = null;
  let outlineLayer: DrawingLayer | null = null;
  let outlineMaterialized: CellTrackChange | null = null;
  let outlineRaf = 0;

  function outlineActive(): boolean {
    return outlineBefore !== null;
  }

  function enterOutline() {
    // Re-arming the already-lit toolbar button (or any other re-entry while a preview is live)
    // must no-op: snapshotting now would capture the PREVIEW as `outlineBefore`, and Cancel would
    // then restore an outline instead of the original art.
    if (outlineActive()) return;
    const al = activeLayer();
    if (
      workingTarget(appState.activeRow).kind !== "layer" ||
      al.kind !== "draw" ||
      !isLayerEditable(al, appState.project.groups) ||
      onLoopFrame(al)
    )
      return;
    const mk = ensureDrawableKeyframe(al, appState.playhead, canvasOps);
    // Nothing drawn → nothing to outline. Leave the hold a hold. (Memoized per ink revision, and
    // the bounds are needed anyway for the working region.)
    const ink = contentBounds(mk.canvas, appState.version);
    if (!ink) {
      if (mk.materialized) restoreCellTrack(al, mk.materialized.before);
      appState.statusHint = "Nothing to outline — this frame is empty";
      return;
    }
    const ctx = mk.canvas.getContext("2d", { willReadFrequently: true })!;
    const cw = mk.canvas.width,
      ch = mk.canvas.height;
    const x0 = Math.max(0, ink.x - OUTLINE_MARGIN),
      y0 = Math.max(0, ink.y - OUTLINE_MARGIN);
    const x1 = Math.min(cw, ink.x + ink.w + OUTLINE_MARGIN),
      y1 = Math.min(ch, ink.y + ink.h + OUTLINE_MARGIN);
    outlineLayer = al;
    outlineMaterialized = mk.materialized;
    outlineCtx = ctx;
    outlineBefore = ctx.getImageData(0, 0, cw, ch);
    outlineInk = ink;
    outlineRect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    outlineSrc = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    outlineField = null;
    outlineDepth = null;
    outlineCov = null;
    outlineAlpha = null;
    outlinePreviewImg = null;
    outlineNoise = null;
    outlineNoiseSeed = null;
    outlineScratch = null;
    // Selection geometry is DOCUMENT space (gotcha #13) — `applyClip` maps it through
    // `composeSteps` for a transformed layer, so they must describe the layer we are about to
    // clip on, exactly as a select/lasso gesture syncs them at its start.
    syncComposeSteps();
    refreshOutlinePreview();
    // `repaint`, NOT `bump`: entering the tool isn't a document edit, but `outlineActive()` is a
    // plain local — the on-canvas bar's `{#if}` gate reads `appState.version` only so it re-evaluates
    // on entry (same reasoning as `enterPose`'s `repaint()`, gotcha class documented on the pose bar).
    repaint();
  }

  /** Re-derive the preview from the snapshot. Coalesced to one animation frame (gotcha #17): a
   *  thickness scrub fires a pointermove per pen event and each preview is a full-canvas pass. */
  function scheduleOutlinePreview() {
    if (outlineRaf) return;
    outlineRaf = requestAnimationFrame(() => {
      outlineRaf = 0;
      refreshOutlinePreview();
    });
  }

  function refreshOutlinePreview() {
    const ctx = outlineCtx,
      src = outlineSrc,
      r = outlineRect;
    if (!ctx || !src || !r) return;
    const w = r.w,
      h = r.h;
    // All extracted from the immutable snapshot, so built once per entry and reused across every
    // knob change — a preview used to redo this work on every scrub tick.
    if (!outlineAlpha) {
      outlineAlpha = new Uint8Array(w * h);
      for (let i = 0, p = 3; i < outlineAlpha.length; i++, p += 4) outlineAlpha[i] = src.data[p];
    }
    const alpha = outlineAlpha;
    outlineField ??= signedDistanceField(alpha, w, h);
    outlineDepth ??= localDepth(outlineField, w, h);
    // The noise planes are a function of the seed only — rebuilt on a fresh entry (both nulled by
    // enterOutline) and on a re-roll (the seed no longer matches what was cached). Sampled at
    // CANVAS coordinates, so the region's cut does not move the wobble.
    if (outlineNoise === null || outlineNoiseSeed !== appState.outline.seed) {
      outlineNoise = buildNoisePlanes(w, h, appState.outline.seed, r.x, r.y);
      outlineNoiseSeed = appState.outline.seed;
    }
    outlineCov ??= new Uint8ClampedArray(w * h);
    const cov = outlineMask(
      alpha,
      w,
      h,
      { ...appState.outline },
      outlineField,
      outlineNoise,
      outlineDepth,
      outlineCov,
    );
    // Only alpha changes, so coloured art keeps its colour — with the colour first BLED outward,
    // because outward Wobble lands on transparent pixels whose stored RGB is black (`bleedColor`).
    outlinePreviewImg ??= new ImageData(bleedColor(src.data, w, h), w, h);
    const next = outlinePreviewImg;
    // Alpha lock keeps the layer's alpha where it is — the brushes and fill honour it, so the outline
    // may hollow the art but never lay ink where the lock says there is none.
    const lock = outlineLayer?.alphaLock === true;
    for (let i = 0, p = 3; i < cov.length; i++, p += 4)
      next.data[p] = lock ? Math.min(cov[i], alpha[i]) : cov[i];
    // A marquee clips the WRITE, not the maths: the field above is built from the whole drawing, so
    // the line's geometry where it meets the cut is the drawing's real outline, simply truncated —
    // no line is drawn along the marquee itself. Same rule the brush, eraser and fill follow.
    if (selection?.state === "selected") {
      ctx.putImageData(src, r.x, r.y); // original first — outside the marquee nothing changes
      if (!outlineScratch) {
        outlineScratch = document.createElement("canvas");
        outlineScratch.width = w;
        outlineScratch.height = h;
      }
      outlineScratch.getContext("2d")!.putImageData(next, 0, 0);
      ctx.save();
      // `applyClip` takes CSS px, so the ctx must carry the dpr transform it expects.
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      selection.applyClip(ctx);
      // Inside the marquee the outline REPLACES the art, so the region is cleared before the draw —
      // drawing over it would leave the solid fill showing through the hollowed middle.
      ctx.clearRect(r.x / DPR, r.y / DPR, w / DPR, h / DPR);
      ctx.drawImage(outlineScratch, r.x / DPR, r.y / DPR, w / DPR, h / DPR);
      ctx.restore();
    } else {
      ctx.putImageData(next, r.x, r.y);
    }
    markInkChanged(ctx.canvas);
    recomposite();
    positionOutlineBar();
  }

  function applyOutline() {
    const ctx = outlineCtx,
      before = outlineBefore;
    if (!ctx || !before) return;
    if (outlineRaf) {
      cancelAnimationFrame(outlineRaf);
      outlineRaf = 0;
      refreshOutlinePreview(); // the pending frame's settings are the ones being applied
    }
    const after = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    const layerId = outlineLayer?.id ?? null;
    const mat = outlineMaterialized;
    // Nothing changed → nothing to record. Pushing a no-op undo entry (and keeping a hold
    // materialised into a key for it) would be pure noise in the undo stack. This is the "shape
    // thinner than the thickness stays solid" case (spec decision 3).
    if (sameImageData(before, after)) {
      if (layerId !== null && mat) restoreTrackById(layerId, mat.before);
      clearOutline();
      recomposite();
      repaint(); // version only — nothing new to persist
      leaveOutline(); // the tool hands back here too, exactly as on a real Apply
      return;
    }
    history.push(
      pixelCommand(
        ctx.canvas,
        () => {
          ctx.putImageData(before, 0, 0);
          if (layerId !== null && mat) restoreTrackById(layerId, mat.before); // outlining a hold made this ◆
          recomposite();
        },
        () => {
          if (layerId !== null && mat) restoreTrackById(layerId, mat.after);
          ctx.putImageData(after, 0, 0);
          recomposite();
        },
        before,
        after,
      ),
    );
    clearOutline();
    bump();
    leaveOutline(); // one-shot: the job is done, so the lit button goes back to the real tool
  }

  function cancelOutline() {
    if (outlineCtx && outlineBefore) {
      outlineCtx.putImageData(outlineBefore, 0, 0);
      markInkChanged(outlineCtx.canvas);
      // …and the keyframe entry materialised, so a cancelled outline leaves a hold a hold.
      if (outlineLayer && outlineMaterialized)
        restoreCellTrack(outlineLayer, outlineMaterialized.before);
    }
    clearOutline();
    recomposite();
    repaint(); // version only — the cancel restored the cell, so there is nothing new to persist
    leaveOutline(); // same rule as Apply, including the implicit cancels (frame/layer switch, lock)
  }

  function clearOutline() {
    if (outlineRaf) {
      cancelAnimationFrame(outlineRaf);
      outlineRaf = 0;
    }
    outlineCtx = null;
    outlineBefore = null;
    outlineInk = null;
    outlineRect = null;
    outlineSrc = null;
    outlineField = null;
    outlineDepth = null;
    outlineCov = null;
    outlineAlpha = null;
    outlinePreviewImg = null;
    outlineNoise = null;
    outlineNoiseSeed = null;
    outlineScratch = null;
    outlineLayer = null;
    outlineMaterialized = null;
  }

  // A knob change (from the on-canvas bar) re-derives the preview from the untouched snapshot —
  // coalesced via scheduleOutlinePreview (gotcha #17), not applied straight from here.
  $effect(() => {
    void appState.outline.thickness;
    void appState.outline.wobble;
    void appState.outline.variation;
    void appState.outline.seed;
    if (outlineActive()) scheduleOutlinePreview();
  });

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
    poseBarDragging = false;
    activeHandle = null;
    poseAdjusting = false;
    poseDirty = false; // a rebuild drops every handle: the picture is back at rest, nothing to bake
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
      // Streamline is a brush preference. On select, pose, deform, and transform it made handles
      // trail the Pencil and stop short of the lift.
      streamline: () =>
        appState.tool === "brush" || appState.tool === "eraser"
          ? activeStroke().streamline / 100
          : 0,
    });

    // Recomposite when the document changes elsewhere (frame step, layer toggle…).
    let lastVersion = appState.version;
    let lastPlayhead = appState.playhead;
    let lastLayerId = appState.activeLayerId;
    let lastW = appState.project.width;
    let lastH = appState.project.height;
    // The play range and the loop flag shape the onion ghosts (confined to the range, wrapped across
    // its seam when looping — `computeOnionFrames`) but bump neither `version` nor the playhead, so
    // this loop never noticed them: after an In/Out press, a handle drag, Clear, or the loop toggle,
    // the ghosts stayed stale until something else redrew. Proven 2026-09-10 by hashing the canvas —
    // identical before and after a real loop-button click, different after a forced repaint.
    // IDENTITY on the range: every writer replaces the object (`withRangeIn/Out`, `withRangeEdgeAt`,
    // clear → null), so this is exact and allocation-free on an idle frame. Only while onion is on —
    // otherwise the range changes nothing on the canvas, and a handle drag would recomposite per step.
    let lastRange = appState.playback.range;
    let lastLoop = appState.playback.loop;
    const tick = () => {
      const dimsChanged = appState.project.width !== lastW || appState.project.height !== lastH;
      const changed =
        dimsChanged ||
        appState.version !== lastVersion ||
        appState.playhead !== lastPlayhead ||
        (appState.onion.enabled &&
          (appState.playback.range !== lastRange || appState.playback.loop !== lastLoop));
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
        lastRange = appState.playback.range;
        lastLoop = appState.playback.loop;
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
    // The single owner of "would a pixel paste land?", so App's Cmd+V routing and ToolOptions'
    // Paste enable-state cannot drift from `pasteSelection`'s own preconditions (three independent
    // copies of this predicate was a review finding). It is exactly `pasteSelection` minus the
    // `ensureDrawableKeyframe` step, which cannot fail for a `drawableTarget()`.
    // `hasPixelClipboard` is the REACTIVE mirror of `selectionClipboard` (a plain Canvas local that
    // a Svelte read cannot track), so both are read: the mirror to register the dependency for
    // template/derived callers, the local for the truth — the two only disagree if Canvas remounts,
    // and answering `true` there is precisely the "keystroke silently does nothing" case.
    selectionActions.canPaste = () =>
      appState.hasPixelClipboard && !!selectionClipboard && drawableTarget() !== null;
    // Escape's behavior exactly: cancel (revert a move), never commit. Tap-outside still commits.
    selectionActions.deselect = () => {
      if (selection?.active) selection.cancel();
    };
    // Same as the `0` key. Exposed because iPad has no keyboard: without a UI route, a canvas
    // flung off-screen by a stray two-finger drag can only be recovered by reloading the page.
    viewActions.fitView = () => viewport?.fitView(appState.project.width, appState.project.height);
    // `setZoom` rather than the Viewport's own `resetView`: this restores 100% while keeping the
    // view centred on whatever you were looking at, where resetView would also zero the pan and
    // rotation and throw the canvas to the top-left corner.
    viewActions.actualSize = () => viewport?.setZoom(1);
    fillActions.allEnclosed = fillAllEnclosedOnCell;

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
      if (recompositeRaf) cancelAnimationFrame(recompositeRaf);
      selection?.cancel(); // stop the marching-ants rAF loop (and revert any live lift) on teardown
      selectionRef.current = null;
      liftGuard.discard = null;
      poseActions.active = () => false;
      selectionActions.enterWarp = null;
      selectionActions.copy = null;
      selectionActions.cut = null;
      selectionActions.del = null;
      selectionActions.paste = null;
      selectionActions.canPaste = null;
      selectionActions.deselect = null;
      viewActions.fitView = null;
      viewActions.actualSize = null;
      fillActions.allEnclosed = null;
      appState.selectionActive = false;
      appState.selectionFloating = false;
      appState.poseActive = false;
      appState.poseFillWarning = "";
    };
  });

  // The tool and transform scope this effect last settled for. Plain (not $state): only the effect
  // reads them, to tell a real switch from a re-run.
  let settledTool: typeof appState.tool | null = null;
  let settledScope: ReturnType<typeof transformScope> | null = null;
  $effect(() => {
    const t = appState.tool;
    // Reading the scope makes it a dependency: switching either mid-drag must settle the open
    // transform bracket, or it leaks into the next gesture and one undo reverts both (gotcha #6).
    const scope = transformScope();
    // …but settle only when one of them actually CHANGED. The scope is read through `activeRow`,
    // and `setActiveLayer` assigns a fresh row object even when the layer is already selected — which
    // every timeline row press does. Settling on each re-run therefore ended the timeline's own row
    // drag a microtask after it began: pressing a selected key armed `moveblock`, this effect ran,
    // `settleRowDrag` reset it, and the drag moved nothing (regression from d0685f1, 2026-09-11).
    if (t !== settledTool || scope !== settledScope) transformDragGuard.settle?.();
    settledTool = t;
    settledScope = scope;
    if (!selection) {
      // Prime here too: leaving the flag false on an early first run would cost the artist TWO tool
      // switches before the first lift, for a guard that only exists to skip the restored preference.
      toolEntryPrimed = true;
      prevTool = appState.tool;
      return;
    }
    // Only bank when the TOOL actually changes. This effect also re-runs when hasFloating
    // flips (the reads below), and committing then would bake+clear a lift the user just started
    // from the on-canvas bar (Select → Free transform).
    const toolChanged = t !== prevTool;
    if (toolChanged && strokeCanvas) {
      commitOpenStroke(lastPoints, prevTool === "eraser");
      dropStrokeUntilUp = true;
    }
    if (toolChanged) {
      // An untouched lift cancels rather than bakes — see `deformDirty`/`poseDirty`.
      if (prevTool === "pose" && t !== "pose" && meshPose) {
        if (poseDirty) applyPose();
        else cancelPose();
      }
      if (prevTool === "deform" && t !== "deform" && selection.hasFloating) {
        if (deformDirty) selection.commit();
        else selection.cancel();
      } else if (t !== "select" && t !== "lasso" && selection.hasFloating) selection.commit();
      if (prevTool === "outline" && t !== "outline") cancelOutline();
    }
    prevTool = t;
    if (t === "select") selection.mode = "rect";
    else if (t === "lasso") selection.mode = "lasso";
    else if (t !== "deform") selectionMode = null; // deform manages its own selectionMode on entry
    // Lift on ARRIVAL, not on the first press. Waiting for a press made the tool look inert until
    // you guessed a tap would do something, and — worse — that press was consumed entirely by the
    // lift, so summoning the grid and grabbing a handle could never be one gesture. Entering here
    // means the first press already lands on a handle. Both entries no-op on an empty cell or a
    // locked/hidden layer, and re-entering is guarded below, so a re-run of this effect is free.
    // …but only for a tool the ARTIST picked. The tool is persisted, so this effect's first run
    // reports a "change" from the hardcoded initial value to whatever was restored — entering there
    // would lift (and, on a hold, materialise a keyframe) merely because the app was launched, with
    // no gesture behind it and possibly before the project has finished restoring. Arriving with
    // Deform already selected therefore still waits for the first press, which is what the fallback
    // in `onStroke` is for.
    // `!strokeCanvas`: on iPad a finger can tap the tool button while the Pencil is mid-stroke.
    // Entering would capture `selBefore` mid-stroke and punch the hole while `paintStroke` keeps
    // writing the same ctx — the smooth brush redraws from its own snapshot, so the lifted content
    // gets painted back into the cell while the float still holds it. The press-time fallback then
    // enters normally once the stroke ends.
    if (toolChanged && toolEntryPrimed && !strokeCanvas) {
      if (t === "deform" && selection.state !== "warping") enterDeform();
      else if (t === "pose" && !meshPose) enterPose();
      else if (t === "outline" && !outlineActive()) enterOutline();
    }
    toolEntryPrimed = true;
  });

  // Bank any in-progress lift (pose / selection transform / deform warp) into the layer/frame it was
  // started on, so switching the active layer or frame leaves a clean slate — mirrors the tool-switch
  // banker. A plain marquee is document-level and kept; the gizmo-based layer transform self-retargets.
  function bankActiveEdits() {
    // Same rule as the tool switch: an untouched lift is discarded, not banked. Stepping a frame
    // with Deform selected must not stamp an undo entry per frame.
    if (meshPose) {
      if (poseDirty) applyPose();
      else cancelPose();
    }
    if (selection?.hasFloating) {
      if (appState.tool === "deform" && !deformDirty) selection.cancel();
      else selection.commit();
    }
    // Outline CANCELS where pose and deform bank. Entering the tool already rewrites every pixel,
    // so banking would mean a stray tap on the tool button plus a frame step silently outlines a
    // drawing. Re-entering costs nothing — the knob values persist.
    if (outlineActive()) cancelOutline();
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
    if (outlineActive()) cancelOutline();
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
      markInkChanged(strokeCtx.canvas);
      // A discarded stroke leaves NOTHING behind, including the keyframe it materialised — reverting
      // only the pixels used to strand a blank ◆ on a frame that was a hold before the discard.
      const revertedTrack = !!(strokeLayer && strokeMaterialized);
      if (strokeLayer && strokeMaterialized)
        restoreCellTrack(strokeLayer, strokeMaterialized.before);
      strokeCanvas = null;
      strokeCtx = null;
      beforeSnapshot = null;
      strokeSteps = null;
      strokeLayer = null;
      strokeMaterialized = null;
      dropStrokeUntilUp = true; // swallow the rest of this pointer stream
      // Undoing the track needs a bump, not just a repaint: the stroke's start already bumped, and
      // past the layer's end the revert SHRINKS the track, so frameCount has to be recomputed.
      if (revertedTrack) bump();
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
  // otherwise ignore `visible` and `opacity`. Mirror both onto the overlays: hiding the layer hides
  // the in-progress edit too (non-destructively — the lift stays alive), and a faded layer's lift
  // stays faded instead of jumping to full strength for the length of the gesture.
  $effect(() => {
    const al = activeLayer();
    if (selection) {
      selection.hidden = !isLayerVisible(al, appState.project.groups);
      selection.contentAlpha = layerContentAlpha(
        al,
        groupOf(al, appState.project.groups),
        appState.playhead,
      );
    }
    repaintPoseOverlay(); // was a direct posePaint(): the second of the two paints per pointermove
    // Can't keep editing a layer that just became read-only → discard the in-progress lift.
    // DERIVED (isLayerLocked), so locking the layer's GROUP discards too — reading it here also makes
    // the group's flag a tracked dependency, which a raw `al.locked` read never was.
    if (
      isLayerLocked(al, appState.project.groups) &&
      (meshPose || selection?.hasFloating || outlineActive())
    )
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
  // Eyedropper samples the composite, so it is never blocked. Select/lasso are gated separately
  // (`selectToolsBlock`): a locked drawing layer can still be copied from, a reference cannot.
  const PIXEL_TOOLS = ["brush", "eraser", "fill", "deform", "pose", "outline"];
  // Pixel tools need a drawable layer. Transform on a DRAWING layer does too; on a REF the gizmo
  // is live (lock/span gate it separately) — treating that as blocked showed a not-allowed cursor
  // and a "switch to a drawing layer" caption over something you can actually move.
  const toolBlocked = $derived.by(() => {
    const l = activeLayer();
    const groups = appState.project.groups;
    const wt = workingTarget(appState.activeRow);
    if (PIXEL_TOOLS.includes(appState.tool))
      return wt.kind !== "layer" || !isLayerEditable(l, groups) || onLoopFrame(l);
    if (appState.tool === "transform")
      return (
        wt.kind === "audio" ||
        (wt.kind === "layer" && l.kind === "draw" && !isLayerEditable(l, groups))
      );
    if (appState.tool === "select" || appState.tool === "lasso") return selectToolsBlock() !== null;
    return false;
  });
  // Same caption the status bar's idle hint uses. Lives on the STAGE (not the paper) so pan/zoom
  // don't move it, and not in ToolOptions — an inline span there shoved Size/Press sideways.
  // Hidden while a marquee is up: the selection bar already carries the reason. Hidden during
  // PLAYBACK too — it answers "why won't this gesture write?", and nobody is gesturing while
  // watching the animation; an amber box parked over the stage for the whole take is just chrome
  // in front of the work.
  // `not-draw` is omitted: a reference is a different kind of layer, not a broken drawing layer,
  // and the toolbar already dims the pixel tools.
  const editBlockCaption = $derived.by(() => {
    if (appState.playback.isPlaying) return null;
    if (!toolBlocked || appState.selectionActive || appState.selectionFloating) return null;
    const block = whyNotEditable(activeLayer(), appState.project.groups);
    if (block && block !== "not-draw") return editBlockLabel(block);
    const l = activeLayer();
    if (l.kind === "draw" && onLoopFrame(l))
      return loopEditLabel(appState.playhead, displayFrame(l.cells, appState.playhead));
    return null;
  });
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
  <!-- The blocked-edit caption. OPAQUE ground, not `bg-surface/70` as it was until 2026-09-09.
       Reported as "pale yellow on grey is a bit weak", and it measured that way: `warn` (#d5b75d) on
       70% surface over this project's paper is **3.43:1**, under AA for text this size — and the
       ground was not even fixed, since 70% composites against whatever is BEHIND it. On white paper
       it fell to 3.14:1, and over the transparent-background checkerboard it changes square by
       square. A caption that says "you cannot edit this" must not get harder to read as the artwork
       under it gets lighter. Solid `surface` puts it at **8.51:1** and makes it independent of the
       paper entirely. The `warn/40` hairline and `font-medium` are what make it read as a warning
       CHIP rather than a floating label.
       The token itself is unchanged and should stay: `warn` was deliberately moved off amber-500 to
       this muted gold on 2026-09-09 to match slop-video-compositor, and the contrast problem here was
       the ground, not the hue — saturating the token would have diverged the whole family to fix one
       badge's background. -->
  {#if editBlockCaption}
    <div
      class="pointer-events-none absolute top-2 left-2 z-10 rounded border border-warn/40 bg-surface px-1.5 py-0.5 text-xs font-medium text-warn shadow-sm shadow-black/40"
    >
      {editBlockCaption}
    </div>
  {/if}
  <SelectionActions
    getSelection={() => selection}
    getViewport={() => viewport}
    getContainer={() => stage}
    onTransform={enterTransform}
    onDistort={() => enterWarp(2, 2)}
    onMesh={() => enterWarp(3, 3)}
    onFlip={flipSelection}
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
      bind:this={poseBarEl}
      class="selection-actions-panel ui-bar absolute max-w-[min(92vw,34rem)] flex-col z-30"
      style="left: {poseBarPos.x}px; top: {poseBarPos.y}px"
    >
      <div class="flex flex-wrap items-center gap-1">
        <button
          class="ui-bar-btn bg-surface text-text-secondary hover:bg-surface-hover"
          title="Coarser mesh"
          onpointerdown={(e) => {
            e.preventDefault();
            poseDensity(-1);
          }}>−</button
        >
        <button
          class="ui-bar-btn bg-surface text-text-secondary hover:bg-surface-hover"
          title="Denser mesh"
          onpointerdown={(e) => {
            e.preventDefault();
            poseDensity(1);
          }}>+</button
        >
        <button
          class="ui-bar-btn text-xs bg-surface text-text-secondary hover:bg-surface-hover"
          title="Reset handles"
          onpointerdown={(e) => {
            e.preventDefault();
            meshPose?.resetHandles();
            poseDrag = null;
            poseBarDragging = false;
            activeHandle = null;
            poseAdjusting = false;
            posePaint();
          }}>Reset</button
        >
        <!-- Group separator — the same one the selection/deform bar draws (`.ui-bar` siblings). -->
        <span class="w-px h-6 bg-border mx-0.5"></span>
        <label
          class="flex min-h-10 items-center gap-1 px-1 text-xs"
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
            class="flex min-h-10 items-center gap-1 px-1 text-xs"
            title="Bridge breaks in the outline, up to about twice this many pixels"
          >
            Gap
            <NumberField
              class="w-10 text-xs bg-surface border border-border rounded px-1 text-text"
              value={appState.pose.gap}
              min={0}
              max={MAX_GAP}
              step={1}
              title="Bridge breaks in the outline, up to about twice this many pixels"
              ariaLabel="Fill gap"
              onInput={(v) => {
                appState.pose.gap = v;
                rebuildPoseMesh();
              }}
              onCommit={(v) => {
                appState.pose.gap = v;
                rebuildPoseMesh();
              }}
            />
          </label>
        {/if}
        <span class="w-px h-6 bg-border mx-0.5"></span>
        <!-- ✓ / ✗, the commit-and-cancel pair the selection bar already teaches, rather than the
             words this bar used to carry on its own. -->
        <button
          class="ui-bar-btn ui-on border-accent"
          title="Apply pose"
          aria-label="Apply pose"
          onpointerdown={(e) => {
            e.preventDefault();
            applyPose();
          }}><Check size={18} /></button
        >
        <button
          class="ui-bar-btn bg-surface text-text-secondary hover:bg-surface-hover"
          title="Cancel pose"
          aria-label="Cancel pose"
          onpointerdown={(e) => {
            e.preventDefault();
            cancelPose();
          }}><X size={18} /></button
        >
      </div>
      {#if appState.pose.fillHoles && appState.poseFillWarning}
        <!-- Row 2. Kept in THIS panel rather than the status bar: statusHint carries the hovered
             control's title= and is overwritten by the very pointerdown that builds the mesh, and
             the remedy (Gap) is one row above. -->
        <span class="text-xs/snug text-warn">{appState.poseFillWarning}</span>
      {/if}
    </div>
  {/if}
  {#if appState.version >= 0 && outlineActive()}
    <div
      bind:this={outlineBarEl}
      class="selection-actions-panel ui-bar absolute max-w-[min(92vw,34rem)] flex-col z-30"
      style="left: {outlineBarPos.x}px; top: {outlineBarPos.y}px"
    >
      <div class="flex flex-wrap items-center gap-1">
        <label
          class="flex min-h-10 items-center gap-1 px-1 text-xs"
          title="Line thickness in pixels"
        >
          Thickness
          <NumberField
            class="w-12 text-xs bg-surface border border-border rounded px-1 text-text"
            value={appState.outline.thickness}
            min={0.5}
            max={MAX_THICKNESS}
            step={0.5}
            title="Line thickness in pixels"
            ariaLabel="Outline thickness"
            onInput={(v) => {
              appState.outline.thickness = v;
            }}
            onCommit={(v) => {
              appState.outline.thickness = v;
            }}
          />
        </label>
        <label
          class="flex min-h-10 items-center gap-1 px-1 text-xs"
          title="How far the line wanders across the edge"
        >
          Wobble
          <NumberField
            class="w-12 text-xs bg-surface border border-border rounded px-1 text-text"
            value={Math.round(appState.outline.wobble * 100)}
            min={0}
            max={100}
            step={5}
            title="How far the line wanders across the edge"
            ariaLabel="Outline wobble"
            onInput={(v) => {
              appState.outline.wobble = v / 100;
            }}
            onCommit={(v) => {
              appState.outline.wobble = v / 100;
            }}
          />
        </label>
        <label
          class="flex min-h-10 items-center gap-1 px-1 text-xs"
          title="How much the line swells and thins"
        >
          Variation
          <NumberField
            class="w-12 text-xs bg-surface border border-border rounded px-1 text-text"
            value={Math.round(appState.outline.variation * 100)}
            min={0}
            max={100}
            step={5}
            title="How much the line swells and thins"
            ariaLabel="Outline variation"
            onInput={(v) => {
              appState.outline.variation = v / 100;
            }}
            onCommit={(v) => {
              appState.outline.variation = v / 100;
            }}
          />
        </label>
        <span class="w-px h-6 bg-border mx-0.5"></span>
        <button
          class="ui-bar-btn bg-surface text-text-secondary hover:bg-surface-hover"
          title="Shuffle the randomness"
          aria-label="Shuffle the randomness"
          onpointerdown={(e) => {
            e.preventDefault();
            appState.outline.seed = (appState.outline.seed + 1) | 0;
          }}><Dices size={18} /></button
        >
        <span class="w-px h-6 bg-border mx-0.5"></span>
        <button
          class="ui-bar-btn ui-on border-accent"
          title="Apply outline"
          aria-label="Apply outline"
          onpointerdown={(e) => {
            e.preventDefault();
            applyOutline();
          }}><Check size={18} /></button
        >
        <button
          class="ui-bar-btn bg-surface text-text-secondary hover:bg-surface-hover"
          title="Cancel outline"
          aria-label="Cancel outline"
          onpointerdown={(e) => {
            e.preventDefault();
            cancelOutline();
          }}><X size={18} /></button
        >
      </div>
    </div>
  {/if}
</div>
