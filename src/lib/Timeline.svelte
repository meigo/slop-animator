<script lang="ts">
  import {
    Plus,
    Diamond,
    DiamondPlus,
    Copy,
    Minus,
    Trash2,
    Image,
    Film,
    BetweenHorizonalStart,
    BetweenHorizonalEnd,
    ArrowRightToLine,
    ArrowLeftToLine,
    Layers,
    Waves,
    Settings,
    Lock,
    EyeOff,
  } from "@lucide/svelte";
  import {
    state as appState,
    canvasOps,
    activeLayer,
    bump,
    repaint,
    history,
    commitStructural,
    seekPlayhead,
    beginStructuralEdit,
    commitStructuralEdit,
    setActiveLayer,
    liftGuard,
    transformDragGuard,
    setTimelineSelection,
    moveTimelineSelection,
    clearTimelineSelection,
    relinkReference,
    isRowSelected,
    applyAnimationLength,
    revertStructural,
    trimToPlayhead,
    trimToPlayheadInfo,
    type StructSnapshot,
  } from "../state/appState.svelte";
  import {
    addFrame,
    insertKeyframe,
    duplicateKeyframe,
    setHold,
    deleteFrame,
    insertFrameAllLayers,
    deleteFrameAllLayers,
    ensureDrawableKeyframe,
    restoreCellTrack,
    setHoldSpan,
  } from "../anim/timeline";
  import { resolveSelectionRect } from "../anim/timeline-selection";
  import { loadReferenceMedia } from "../anim/reference";
  import {
    clampTimelineHeight,
    playheadFollowScroll,
    timelineStripFrames,
  } from "../anim/timeline-layout";
  import { clampGutterLabelWidth } from "../anim/panel-layout";
  import { audioFrameSpan } from "../audio/peaks";
  import { edgeScrollDelta } from "../anim/edge-scroll";
  import { pixelCommand } from "../anim/history";
  import {
    groupOf,
    isLayerEditable,
    isLayerLocked,
    isLayerVisible,
    countKeyframesPastLengthIn,
    refVisibleSpan,
    type DrawingLayer,
    type ReferenceLayer,
    type Cell,
  } from "../anim/document";
  import {
    videoClipLayout,
    offsetAfterClipDrag,
    rangeAfterSlide,
    rangeAfterTrim,
  } from "../anim/clip-layout";
  import { effectiveRange } from "../anim/playback";
  import { columnAtX, lengthAtX, planCellPointer } from "./timeline-grid";
  import { isCellEmpty } from "./cell-ink";
  import { computeTimelineGlyphs } from "./timeline-glyphs";
  import { clickOutside } from "./click-outside";
  import AudioLane from "./AudioLane.svelte";
  import TimelineSelectionBar from "./TimelineSelectionBar.svelte";

  const CELL_W = 24; // px, fixed column width (box-border cells, no gap → contiguous columns)
  // Layer-name column, now user-resizable (drag the divider at the gutter's right edge). REACTIVE:
  // every consumer below — the ruler spacer, both playhead offsets, the sticky plate, the strip
  // width, AudioLane's labelW and TimelineSelectionBar's labelW — reads these, so they must be
  // $derived rather than the consts they used to be, or the gutter and the cells drift apart.
  const LABEL_W = $derived(appState.timelineLabelWidth);
  const MARKER_W = 28; // px, read-only/hidden marker column — ALWAYS reserved so rows align and the
  //                      frame cells don't butt against the name. Fixed: it holds one 11px glyph.
  const GUTTER_W = $derived(LABEL_W + MARKER_W); // total sticky width before the first frame cell

  // Sticky gutters live inside each row's box. A video/audio clip past the last frame
  // widens THAT row only; shorter rows unstick when you scroll to the tail. Share one
  // strip length so every gutter stays pinned for the full scroll.
  const stripFrames = $derived.by(() => {
    const ends: number[] = [];
    const fps = appState.project.fps;
    const audio = appState.project.audio;
    // The lane draws from BUFFER frame 0, which sits at `offsetFrames - trimInFrames` (the trim
    // model anchors the first KEPT sample at offsetFrames) — see AudioLane's wrapper margin-left.
    if (audio)
      ends.push(
        audio.offsetFrames -
          Math.max(0, audio.trimInFrames ?? 0) +
          audioFrameSpan(audio.buffer.duration, fps),
      );
    for (const l of appState.project.layers) {
      if (l.kind !== "ref") continue;
      if (l.media.type === "image") {
        if (l.range) ends.push(l.range.end + 1); // +1: `end` is inclusive, `ends` are exclusive
        continue;
      }
      if (l.media.type !== "video") continue;
      const dur = l.media.el.duration;
      if (!Number.isFinite(dur) || dur <= 0) continue;
      const { startFrame, spanFrames } = videoClipLayout(l.offsetFrames, l.speed, dur, fps);
      ends.push(startFrame + spanFrames);
    }
    // Hold the strip at its grab-time width for the whole length drag — see `lenDragFloor`.
    if (lenDragFloor > 0) ends.push(lenDragFloor);
    return timelineStripFrames(appState.project.frameCount, ends);
  });
  const stripMinW = $derived(GUTTER_W + stripFrames * CELL_W);

  // `trimToPlayheadInfo` reads `activeLayerId`, `project.layers` and `project.audio` — all $state
  // proxies — and runes track reads wherever they happen during a derived's evaluation, so no
  // dependency needs listing here. Staying reactive matters: the button's title NAMES its target,
  // and a stale name is the one thing that would make the precedence rule unsafe.
  const trimTarget = $derived(trimToPlayheadInfo());

  // Cell glyphs: ◆ keyframe with ink, ◇ a blank keyframe (cleared/inserted-blank — a real keyframe
  // boundary with no content), — hold over an inked key, blank for anything else (no key / hold over
  // a blank key / past the layer's end). ◇ makes a blank keyframe visible as "the next keyframe" a
  // hold stops at, rather than an invisible gap.
  //
  // Computed for the WHOLE track in one O(frames) forward pass and memoized by `appState.version` (any
  // edit bumps it; isCellEmpty shares the same key). Scrubbing changes only the playhead — version is
  // unchanged — so this is a cache hit and does zero work. Previously each cell ran a per-cell
  // resolveKeyframeIndex backward scan over the reactive cells proxy: O(frames²) of expensive proxy
  // reads, re-run on every scrub step (the scrub-jitter root cause).
  const glyphCache = new Map<number, { version: number; frameCount: number; glyphs: string[] }>();
  function glyphsFor(layer: DrawingLayer, version: number): string[] {
    const frameCount = appState.project.frameCount;
    const hit = glyphCache.get(layer.id);
    if (hit && hit.version === version && hit.frameCount === frameCount) return hit.glyphs;
    const glyphs = computeTimelineGlyphs(layer.cells, frameCount, (c) => isCellEmpty(c, version));
    glyphCache.set(layer.id, { version, frameCount, glyphs });
    return glyphs;
  }

  // Ruler shows frame 1, then every 5th frame (1, 5, 10, 15, …); other columns are bare ticks.
  function rulerLabel(f: number): string {
    return f === 0 || (f + 1) % 5 === 0 ? String(f + 1) : "";
  }

  // Effective play range (null when unset). Used by the ruler wash AND the edge markers below.
  const playRange = $derived(
    appState.playback.range
      ? effectiveRange(appState.playback.range, appState.project.frameCount)
      : null,
  );

  function go(f: number) {
    seekPlayhead(f);
  }

  // Draggable playhead: pointer-drag anywhere on the ruler scrubs the current frame.
  // Pointer capture keeps the drag alive outside the element; touch-action:none stops
  // the browser from panning/zooming the page while scrubbing (needed on iPad).
  let rulerEl: HTMLDivElement | undefined = $state();
  let scrubbing = $state(false);
  let boilSettingsOpen = $state(false);
  let onionSettingsOpen = $state(false);
  function scrubTo(e: PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    go(columnAtX(e.clientX - rect.left, CELL_W, appState.project.frameCount));
  }
  function isFinePointer(e: PointerEvent): boolean {
    return e.pointerType !== "touch"; // finger/palm navigate; Pencil/mouse edit
  }

  function touchPanDown(e: PointerEvent) {
    if (!gridWrapper) return;
    touchPan = {
      x: e.clientX,
      y: e.clientY,
      left: gridWrapper.scrollLeft,
      top: gridWrapper.scrollTop,
      panning: false,
    };
  }
  function touchPanMove(e: PointerEvent): boolean {
    if (!touchPan || !gridWrapper) return false;
    const dx = e.clientX - touchPan.x;
    const dy = e.clientY - touchPan.y;
    if (!touchPan.panning && Math.hypot(dx, dy) > MOVE_CANCEL_PX) touchPan.panning = true;
    if (!touchPan.panning) return false;
    gridWrapper.scrollLeft = touchPan.left - dx;
    gridWrapper.scrollTop = touchPan.top - dy;
    return true;
  }
  // Edge auto-scroll for horizontal drags. The tick RE-APPLIES the active drag at the last pointer
  // position, which is the whole point: while the pointer sits still past the edge there are no
  // pointermove events, so a helper that only scrolled would slide the content out from under a
  // trim edge that never followed. Each drag registers how to re-apply itself.
  let edgeRaf = 0;
  let edgeApply: ((clientX: number, clientY: number) => void) | null = null;
  let edgePointerX = 0;
  let edgePointerY = 0; // only the row drag needs Y (it hit-tests which track it is over)
  /** Which drag armed the tick. It is ONE shared resource, so a settle may only stop it when its own
   *  drag owns it — otherwise a settle for a drag that is not live (a second pointer finishing an
   *  unrelated gesture) kills the tick out from under the drag that is. */
  let edgeOwner: string | null = null;
  /** Pointer position when the tick was armed. The tick re-applies the drag whenever the scroller
   *  moved, so without this a press that NEVER moved still dragged: hold inside the left trigger
   *  zone and the content scrolls under a stationary pointer, and each frame re-applies the drag at
   *  a new column. `clipMoveAt` writes `offsetFrames` with no undo bracket at all, so that alone
   *  slid a video's in-point unrecoverably. */
  let edgeOriginX = 0;
  let edgeOriginY = 0;

  function startEdgeScroll(apply: (clientX: number, clientY: number) => void, owner: string) {
    edgeApply = apply;
    edgeOwner = owner;
    edgeOriginX = edgePointerX;
    edgeOriginY = edgePointerY;
    if (edgeRaf) return;
    const tick = () => {
      edgeRaf = 0;
      if (!edgeApply || !gridWrapper) return;
      // Only a gesture that has actually TRAVELLED may auto-scroll — see `edgeOriginX`.
      if (Math.hypot(edgePointerX - edgeOriginX, edgePointerY - edgeOriginY) > MOVE_CANCEL_PX) {
        const r = gridWrapper.getBoundingClientRect();
        // The LEFT trigger is the gutter's inner edge, not the scroller's. The name column and
        // marker are sticky, so they cover the scroller's left edge — measuring from there would put
        // the whole zone UNDERNEATH them, and you would have to drag the pointer behind the gutter
        // before scrolling began. `GUTTER_W` is where the frame strip actually becomes visible. The
        // right side needs no such inset: nothing overlays it.
        const d = edgeScrollDelta(edgePointerX, r.left + GUTTER_W, r.right);
        if (d !== 0) {
          const before = gridWrapper.scrollLeft;
          gridWrapper.scrollLeft = before + d;
          // Only re-apply when the scroll actually moved: at either end this would otherwise keep
          // recomputing the same value every frame for no reason.
          if (gridWrapper.scrollLeft !== before) edgeApply(edgePointerX, edgePointerY);
        }
      }
      edgeRaf = requestAnimationFrame(tick);
    };
    edgeRaf = requestAnimationFrame(tick);
  }

  /** The scroller's horizontal offset. A drag that stores a SCREEN-space origin must add the change
   *  in this since grab, or auto-scroll moves the content while the dragged edge stays put — it then
   *  resumes following the pointer carrying that offset permanently. Drags that measure from an
   *  element INSIDE the scroller (the ruler scrub, the row drag, the LENGTH drag) self-correct and do
   *  not need it: that element's rect shifts with the scroll. A drag whose own value sizes the
   *  content MUST be in that second group — see `lenDrag`. */
  function scrollX(): number {
    return gridWrapper?.scrollLeft ?? 0;
  }

  function stopEdgeScroll(owner: string) {
    if (edgeOwner !== owner) return; // not ours — see `edgeOwner`
    if (edgeRaf) cancelAnimationFrame(edgeRaf);
    edgeRaf = 0;
    edgeApply = null;
    edgeOwner = null;
  }

  function touchPanUp() {
    // Remember whether the gesture actually PANNED, for controls that must not fire on a scroll that
    // happens to end on them. A click still fires when a drag ends on its element, and while
    // selecting a layer that way is harmless, opening a file picker mid-scroll is not.
    panEndedWithMovement = touchPan?.panning ?? false;
    touchPan = null;
  }
  let panEndedWithMovement = false;

  // Re-link a missing reference straight from its timeline row. Mirrors LayerList's picker (the two
  // are ~12 lines each; not worth a shared component for two call sites). NOTE this deliberately
  // reverses the 2026-08-14 clip spec's "no second file picker on the row" non-goal.
  let relinkInput: HTMLInputElement;
  let relinkTargetId: number | null = null;
  function startRelink(id: number) {
    if (panEndedWithMovement) return; // a finger scroll that ended on the button, not a tap
    relinkTargetId = id;
    relinkInput.value = "";
    relinkInput.click();
  }
  async function onRelinkFile() {
    const file = relinkInput.files?.[0];
    const id = relinkTargetId;
    if (!file || id == null) return;
    relinkReference(id, await loadReferenceMedia(file, () => repaint()), file);
  }

  // Video-ref clip drag: live offsetFrames write (not undoable), same pattern as AudioLane.
  let clipDrag: { layer: ReferenceLayer; x: number; sx: number; startFrame: number } | null = null;

  function clipDown(e: PointerEvent, layer: ReferenceLayer) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (!isFinePointer(e)) {
      touchPanDown(e);
      return;
    }
    if (layer.media.type !== "video") return;
    const dur = layer.media.el.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const { startFrame } = videoClipLayout(
      layer.offsetFrames,
      layer.speed,
      dur,
      appState.project.fps,
    );
    clipDrag = { layer, x: e.clientX, sx: scrollX(), startFrame };
    edgePointerX = e.clientX;
    startEdgeScroll(clipMoveAt, "clip");
  }

  function clipMove(e: PointerEvent) {
    if (e.pointerType === "touch") {
      touchPanMove(e);
      return;
    }
    edgePointerX = e.clientX;
    clipMoveAt(e.clientX);
  }
  function clipMoveAt(clientX: number) {
    if (!clipDrag) return;
    const delta = Math.round((clientX - clipDrag.x + (scrollX() - clipDrag.sx)) / CELL_W);
    // Zero-delta no-op: startFrame = round(-offset/speed) is lossy when offset is
    // not a multiple of speed (e.g. placed at 1× then speed set to 1.5). Recomputing
    // next would rewrite the in-point on a click or sub-cell twitch without moving.
    if (delta === 0) return;
    const next = offsetAfterClipDrag(clipDrag.startFrame, delta, clipDrag.layer.speed);
    if (next !== clipDrag.layer.offsetFrames) {
      clipDrag.layer.offsetFrames = next;
      bump();
    }
  }

  function clipUp() {
    stopEdgeScroll("clip");
    clipDrag = null;
    touchPanUp();
  }

  // Image-ref range drag. Mirrors clipDown/Move/Up, but writes layer.range and IS undoable:
  // a range change alters what renders, so a mis-drag silently blanks frames.
  let rangeDrag: {
    layer: ReferenceLayer;
    mode: "slide" | "start" | "end";
    x: number;
    /** Scroller offset at grab — the delta adds the change since, or auto-scroll leaves the edge
     *  behind while the content moves (see `scrollX`). */
    sx: number;
    from: { start: number; end: number };
    /** The layer had NO explicit range at grab (an edge drag materialises the implicit one). */
    wasAbsent: boolean;
    undo: ReturnType<typeof beginStructuralEdit>;
  } | null = null;

  function rangeDown(e: PointerEvent, layer: ReferenceLayer, mode: "slide" | "start" | "end") {
    // An edge handle's own rangeDown runs first (delegated child handler fires before the
    // parent's — see Timeline gotcha), setting rangeDrag; this guard then stops the bubbled
    // call on the body from ALSO starting a slide.
    if (rangeDrag) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (!isFinePointer(e)) {
      touchPanDown(e); // finger navigates, pen edits (the app-wide rule)
      return;
    }
    const span = refVisibleSpan(layer, appState.project.fps);
    // An untrimmed block has no body to slide; an edge drag materialises the implicit whole-project
    // range and trims from there.
    if (span === null && mode === "slide") return;
    // Fresh object, never the live layer.range itself: refVisibleSpan returns a trimmed image's
    // range BY REFERENCE, so an in-place write anywhere would make this baseline track the live
    // value and silently disable both the commit gate and the wasAbsent revert below.
    const from = span
      ? { ...span }
      : { start: 0, end: Math.max(0, appState.project.frameCount - 1) };
    rangeDrag = {
      layer,
      mode,
      x: e.clientX,
      sx: scrollX(),
      from,
      wasAbsent: !layer.range,
      undo: beginStructuralEdit(),
    };
    edgePointerX = e.clientX;
    startEdgeScroll(rangeMoveAt, "range");
    transformDragGuard.settle = () => settleRangeDrag();
  }

  function rangeMove(e: PointerEvent) {
    if (e.pointerType === "touch") {
      touchPanMove(e);
      return;
    }
    edgePointerX = e.clientX;
    rangeMoveAt(e.clientX);
  }
  function rangeMoveAt(clientX: number) {
    if (!rangeDrag) return;
    const delta = Math.round((clientX - rangeDrag.x + (scrollX() - rangeDrag.sx)) / CELL_W);
    if (delta === 0) return;
    // During a handle drag this fires TWICE per pointermove: pointer capture retargets the event
    // to the handle, but it still bubbles to the body, which carries the same handlers. Harmless
    // only because both calls derive `next` from the frozen rangeDrag.from, so the second call
    // recomputes the same value and the `cur.start !== next.start || ...` check below finds no
    // change. Switching this to accumulate deltas incrementally (rather than always recomputing
    // from `from`) would silently double-apply every move.
    const next =
      rangeDrag.mode === "slide"
        ? rangeAfterSlide(rangeDrag.from, delta)
        : rangeAfterTrim(rangeDrag.from, rangeDrag.mode, delta);
    const cur = rangeDrag.layer.range;
    if (!cur || cur.start !== next.start || cur.end !== next.end) {
      rangeDrag.layer.range = next; // REPLACE, never mutate in place (shared snapshot refs)
      bump();
    }
  }

  /** Commit iff the gesture actually changed the range; an empty entry makes undo look dead. */
  function settleRangeDrag() {
    stopEdgeScroll("range");
    if (!rangeDrag) return;
    const cur = rangeDrag.layer.range;
    if (cur && (cur.start !== rangeDrag.from.start || cur.end !== rangeDrag.from.end)) {
      commitStructuralEdit(rangeDrag.undo);
    } else if (rangeDrag.wasAbsent && cur) {
      // A no-op edge drag on an untrimmed block still WROTE the implicit range (rangeMove writes
      // whenever the layer had none). Pushing nothing is right, but leaving it written is not: an
      // explicit range stops following the project's length, and undo could not take it back.
      rangeDrag.layer.range = undefined;
      bump();
    }
    rangeDrag = null;
    transformDragGuard.settle = null;
  }

  function rangeUp(e: PointerEvent) {
    if (e.pointerType === "touch") {
      touchPanUp();
      return;
    }
    settleRangeDrag();
  }

  function nameDown(e: PointerEvent, layerId: number) {
    if (!isFinePointer(e)) {
      e.preventDefault(); // block the click so a palm does not switch layers
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      touchPanDown(e);
      return;
    }
    setActiveLayer(layerId);
  }

  function rulerDown(e: PointerEvent) {
    // The length handle is a CHILD of the ruler, and Svelte's delegated dispatch runs the target's
    // handler before this one — so by now `lenDrag` is set if the press landed on it. Bail, or the
    // ruler also scrubs and the playhead jumps in front of the handle you just grabbed. Deliberately
    // not `stopPropagation` in the handle: that would suppress the window-level status-hint
    // listener for the very pointer performing the drag.
    if (lenDrag) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (!isFinePointer(e)) {
      touchPanDown(e);
      return;
    }
    scrubbing = true;
    edgePointerX = e.clientX;
    scrubTo(e);
    startEdgeScroll(scrubToX, "scrub");
  }
  function rulerMove(e: PointerEvent) {
    if (lenDrag) return; // the length handle owns this gesture
    if (touchPan) {
      touchPanMove(e);
      return;
    }
    if (!scrubbing) return;
    edgePointerX = e.clientX;
    scrubToX(e.clientX);
  }
  function scrubToX(clientX: number) {
    if (!rulerEl) return;
    const rect = rulerEl.getBoundingClientRect();
    go(columnAtX(clientX - rect.left, CELL_W, appState.project.frameCount));
  }
  function rulerUp(e: PointerEvent) {
    stopEdgeScroll("scrub");
    scrubbing = false;
    touchPanUp();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }
  function rulerKey(e: KeyboardEvent) {
    // Same keys are handled globally in App.svelte; this element-level handler stays for the
    // role="slider" keyboard contract, so it must STOP PROPAGATION or both fire and the playhead
    // jumps two frames per press.
    if (e.key === "ArrowLeft") go(appState.playhead - 1);
    else if (e.key === "ArrowRight") go(appState.playhead + 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(appState.project.frameCount - 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  // Resize the panel by dragging the top grip. Drag UP → taller (shrinks the canvas above);
  // DOWN → shorter. Clamped to [MIN, 60% viewport]. The prefs $effect persists the change.
  let gripStartY = 0;
  let gripStartH = 0;
  function gripDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gripStartY = e.clientY;
    gripStartH = appState.timelineHeight;
  }
  function gripMove(e: PointerEvent) {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    appState.timelineHeight = clampTimelineHeight(
      gripStartH + (gripStartY - e.clientY),
      window.innerHeight,
    );
  }
  function gripUp(e: PointerEvent) {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }
  // Ruler right-edge drag: set the animation's LENGTH where you can see it, the same direct
  // manipulation the clip trim handles use. The numeric field lives in the playbar's settings
  // popover for typing an exact value.
  //
  // Shortening past a keyframe normally asks for confirmation. A drag CANNOT ask per-frame — that is
  // a modal per pointermove — so the drag writes the length live and defers the question to RELEASE,
  // warning in the status bar throughout so it is never a surprise at the end.
  //
  // NOTE this drag stores NO screen-space origin and uses no `scrollX()` correction, unlike the five
  // others. Its value CHANGES THE CONTENT WIDTH (every row is `min-width: GUTTER_W +
  // stripFrames*CELL_W`), so shrinking shrinks `scrollWidth` and the browser clamps `scrollLeft`
  // down — and the handle lives at the far right, where `scrollLeft` is pinned at max whenever it is
  // visible. `startLen + round((dx + Δscroll)/CELL_W)` therefore fed its own output back in
  // (n_new = n_cur + round(dx/CELL_W) per move) and collapsed the length toward 1 under a stationary
  // pointer. It is measured instead against `rulerEl`'s rect — an element INSIDE the scroller, whose
  // left edge moves with the scroll — which is absolute rather than cumulative, plus `lenDragFloor`
  // to stop the width changing under it at all. Both halves are needed; see `lenDragFloor`.
  let lenDrag: {
    startLen: number;
    /** Did any move actually WRITE a length? A grab-and-release must not revert (and re-dirty
     *  autosave) a document it never touched. */
    dirty: boolean;
    undo: ReturnType<typeof beginStructuralEdit>;
  } | null = null;
  /** Grab-time length, held as a floor under `stripFrames` for the whole gesture (0 = no drag).
   *  Measuring against `rulerEl` is only stable while the SCROLL is: at the far right `scrollLeft`
   *  sits at its maximum, so a shrink that narrows `scrollWidth` makes the browser clamp it, the
   *  content slides right under a stationary pointer, and the measurement walks down a frame per
   *  event — the same feedback in a slower form. Pinning the row width means `scrollWidth` never
   *  DECREASES during the drag, so `scrollLeft` is never clamped and the handle tracks the pointer
   *  1:1. Growing past the floor is fine (widening never clamps), which is what lets edge
   *  auto-scroll extend the length past the viewport. Must be `$state`: `stripFrames` reads it. */
  let lenDragFloor = $state(0);

  function lenGripDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (!isFinePointer(e)) {
      touchPanDown(e); // finger navigates, pen/mouse edits
      return;
    }
    lenDrag = {
      startLen: appState.project.frameCount,
      dirty: false,
      undo: beginStructuralEdit(),
    };
    lenDragFloor = lenDrag.startLen;
    edgePointerX = e.clientX;
    startEdgeScroll(lenGripMoveAt, "len");
    transformDragGuard.settle = settleLenDrag;
  }

  function lenGripMove(e: PointerEvent) {
    if (e.pointerType === "touch") {
      touchPanMove(e);
      return;
    }
    edgePointerX = e.clientX;
    lenGripMoveAt(e.clientX);
  }
  function lenGripMoveAt(clientX: number) {
    if (!lenDrag || !rulerEl) return;
    // Measured from the frame strip's own left edge, which scrolls with the content — see `lenDrag`.
    const next = lengthAtX(clientX - rulerEl.getBoundingClientRect().left, CELL_W);
    if (next === appState.project.frameCount) return;
    // Count against the grab-time snapshot, NOT the live project: the live cells have already been
    // truncated by earlier moves, so counting there always returns 0 and the warning never fires.
    const dropped = countKeyframesPastLengthIn(lenDrag.undo.layers, next);
    applyAnimationLength(next); // no undo entry — the gesture's own bracket is the single entry
    lenDrag.dirty = true;
    appState.statusHint =
      dropped > 0
        ? `Length ${next} — releasing here removes ${dropped} keyframe(s)`
        : `Length ${next}`;
  }

  /** Settle the gesture: ALWAYS revert to the grab-time document first, then re-apply the released
   *  length as a single undo entry (asking about dropped keyframes ONCE, here).
   *
   *  Revert-then-reapply, never "compare the endpoints and commit if they differ". The live drag is
   *  DESTRUCTIVE — `resizeCells` slices, so every intermediate shrink permanently drops the cells
   *  past it and dragging back only pads `{kind:"hold"}` — and the snapshot is the only thing still
   *  holding them. Returning early on `end === startLen` therefore threw away the cells an
   *  overshoot-left-then-correct had already destroyed, silently and with no undo entry to get them
   *  back. Reverting first also makes the confirm honest: the count is taken against UNMUTATED
   *  state, so it reflects the released length rather than whatever the deepest dip left behind. */
  function settleLenDrag() {
    stopEdgeScroll("len");
    if (!lenDrag) return;
    const { startLen, dirty, undo } = lenDrag;
    lenDrag = null;
    lenDragFloor = 0; // release the pinned strip width
    transformDragGuard.settle = null;
    appState.statusHint = "";
    const end = appState.project.frameCount;
    if (!dirty) return; // grab-and-release: nothing was written, so nothing to revert or commit
    revertStructural(undo); // the document is now exactly as it was at grab
    if (end === startLen) return; // out-and-back: a true no-op, cells intact, no undo entry
    // Counted against the restored (== grab-time) document, so it is the real cost of `end`.
    const dropped = countKeyframesPastLengthIn(appState.project.layers, end);
    if (
      end < startLen &&
      dropped > 0 &&
      !confirm(`Shorten to ${end} frames? This removes ${dropped} keyframe(s).`)
    )
      return; // declined — already reverted, nothing to undo
    applyAnimationLength(end);
    commitStructuralEdit(undo); // `undo` is still the correct before-state: we restored it
  }

  function lenGripUp(e: PointerEvent) {
    if (e.pointerType === "touch") {
      touchPanUp();
      return;
    }
    settleLenDrag();
  }

  // Gutter name-column resize. Unlike the panel's grip this one is NOT inverted: the gutter is on
  // the left, so dragging right widens it.
  let gutterStartX = 0;
  let gutterStartW = 0;
  function gutterGripDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gutterStartX = e.clientX;
    gutterStartW = appState.timelineLabelWidth;
  }
  function gutterGripMove(e: PointerEvent) {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    appState.timelineLabelWidth = clampGutterLabelWidth(
      gutterStartW + (e.clientX - gutterStartX),
      window.innerWidth,
    );
  }
  function gutterGripUp(e: PointerEvent) {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  // Keep both resizable dimensions within their share of the viewport if the window shrinks.
  function onWindowResize() {
    appState.timelineHeight = clampTimelineHeight(appState.timelineHeight, window.innerHeight);
    appState.timelineLabelWidth = clampGutterLabelWidth(
      appState.timelineLabelWidth,
      window.innerWidth,
    );
  }

  // Cell-strip pointer interaction: drag a ◆ to move it, drag a span's right edge to resize
  // its hold span, click/drag elsewhere to scrub the playhead. Pointer capture + touch-action
  // keep drags alive and stop the page from panning on iPad.
  // Selection-first gestures: press classifies via planCellPointer + selection membership.
  type DragMode = "none" | "resize" | "marquee" | "moveblock";
  let dragMode = $state<DragMode>("none");
  let dragLayerId = -1;
  let dragKey = -1; // key index being resized
  let dragUndo: StructSnapshot | null = null;
  let dragStartBoundary = -1;
  let dragLastBoundary = -1;
  let rowCursor = $state("default");
  let gridWrapper = $state<HTMLElement | null>(null);
  // Visible height of the scroller — the gutter plate must cover empty space below the last row.
  let gridH = $state(0);
  $effect(() => {
    const el = gridWrapper;
    if (!el) return;
    const sync = () => {
      gridH = el.clientHeight;
    };
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    sync();
    return () => ro.disconnect();
  });

  // Page-step the timeline during play when the playhead walks off the right edge.
  // Does not follow while paused/scrubbing, and does not yank back if the user scrolled ahead.
  let followPrevX: number | null = null;
  $effect(() => {
    const playing = appState.playback.isPlaying;
    const ph = appState.playhead;
    const el = gridWrapper;
    if (!playing || !el || scrubbing) {
      if (!playing) followPrevX = null;
      return;
    }
    const x = GUTTER_W + ph * CELL_W + CELL_W / 2;
    const next = playheadFollowScroll(x, el.scrollLeft, el.clientWidth, GUTTER_W, 8, followPrevX);
    followPrevX = x;
    if (next !== null) el.scrollLeft = next;
  });

  // moveblock: the grabbed key's frame and the live (clamped) frame offset for the ghost.
  let moveGrabFrame = -1;
  let moveDelta = $state(0);
  let moved = false; // did a moveblock drag actually change frame? (a net-zero drag ≠ a tap)
  // empty-press arming: might become a marquee (on drag) or a deselect (on tap).
  // Finger drag OUTSIDE the selection pans the timeline instead of marqueeing — the rows set
  // `touch-action: none` for their gestures, which also kills the browser's own scrolling, so only
  // ref rows and empty space could scroll. Matches the canvas convention (Canvas.svelte: finger
  // navigates, Pencil edits). Pen/mouse are untouched; tap, long-press-marquee, resize and
  // move-block still work with a finger.
  let touchPan: { x: number; y: number; left: number; top: number; panning: boolean } | null = null;
  let armedOutside = false; // pressed OUTSIDE the selection: tap selects/deselects, drag → marquee
  let armedOnKey = false; // …and the pressed cell was a key (tap selects it) vs empty (tap deselects)
  let pressFrame = -1;

  const LONG_PRESS_MS = 400;
  // INVARIANT: EDGE_PX (resize hotspot, timeline-grid.ts) + MOVE_CANCEL_PX must stay < CELL_W/2,
  // so a pending long-press can't let a resize cross a column boundary before it's cancelled.
  const MOVE_CANCEL_PX = 6;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressStartX = 0;
  let pressStartY = 0;

  function cancelLongPress() {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  const selRect = $derived(
    appState.timelineSelection
      ? resolveSelectionRect(
          appState.project.layers,
          appState.timelineSelection.anchor,
          appState.timelineSelection.focus,
          appState.project.groups,
        )
      : null,
  );

  function rowMovesWithBlock(layerId: number): boolean {
    if (dragMode !== "moveblock" || !selRect || !selRect.layerIds.includes(layerId)) return false;
    const layer = appState.project.layers.find((l) => l.id === layerId);
    return !!layer && isLayerEditable(layer, appState.project.groups);
  }

  function inSelection(layerId: number, f: number): boolean {
    if (!selRect) return false;
    const shift = rowMovesWithBlock(layerId) ? moveDelta : 0; // inert rows stay put (skip-and-consume)
    return (
      selRect.layerIds.includes(layerId) &&
      f >= selRect.startFrame + shift &&
      f <= selRect.endFrame + shift
    );
  }

  // During a moveblock drag, preview the keyframe glyphs sliding to the drop target: a cell in the
  // shifted range shows the glyph moving into it (from `f - moveDelta`); a vacated source cell
  // clears. Locked/hidden rows do not write, so they keep their real glyphs.
  function displayGlyph(layerId: number, glyphs: string[], f: number): string {
    if (!rowMovesWithBlock(layerId) || !selRect) return glyphs[f];
    if (f >= selRect.startFrame + moveDelta && f <= selRect.endFrame + moveDelta)
      return glyphs[f - moveDelta] ?? ""; // key sliding into the target
    if (f >= selRect.startFrame && f <= selRect.endFrame) return ""; // vacated source
    return glyphs[f];
  }

  /** Which drawing-layer row the pointer is physically over (pointer capture routes all moves to the
   *  origin row, so hit-test by client coords to allow vertical cross-layer selection). */
  function layerIdAtPoint(clientX: number, clientY: number, fallback: number): number {
    const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-layer-id]");
    if (el) return Number(el.dataset.layerId);
    // Pointer is off the track rows (e.g. dragging below the last track or above the first, or over
    // the label gutter): clamp the selection to the vertically-nearest row instead of snapping back
    // to the origin, so the marquee keeps extending to the top/bottom track.
    const rows = gridWrapper?.querySelectorAll<HTMLElement>("[data-layer-id]");
    if (!rows || rows.length === 0) return fallback;
    let best = fallback;
    let bestDist = Infinity;
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      const dy = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
      if (dy < bestDist) {
        bestDist = dy;
        best = Number(row.dataset.layerId);
      }
    }
    return best;
  }

  function rowOffset(e: PointerEvent): number {
    return e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left;
  }
  /** The row element under the active row drag, captured at grab. Re-applying a drag during edge
   *  auto-scroll has no event, so there is no `currentTarget` to measure — and every row shares the
   *  same horizontal geometry, so any one of them gives the right left edge. */
  let dragRowEl: HTMLElement | null = null;
  function rowColumnAt(clientX: number): number {
    const left = dragRowEl?.getBoundingClientRect().left ?? 0;
    return columnAtX(clientX - left, CELL_W, appState.project.frameCount);
  }
  function rowBoundaryAt(clientX: number): number {
    const left = dragRowEl?.getBoundingClientRect().left ?? 0;
    return Math.max(0, Math.round((clientX - left) / CELL_W));
  }
  function rowColumn(e: PointerEvent): number {
    return columnAtX(rowOffset(e), CELL_W, appState.project.frameCount);
  }
  // Resize tracks the column BOUNDARY under the pointer, unclamped at the top end so a span can
  // grow past the current document length (extending it). round() keeps the span unchanged when
  // you first grab the edge.
  function rowBoundary(e: PointerEvent): number {
    return Math.max(0, Math.round(rowOffset(e) / CELL_W));
  }

  /** Arm edge auto-scroll for the row drag. Called only once `dragMode` is actually a drag — arming
   *  on plain press meant a press that never became one (a tap, or a hover-press near the gutter)
   *  still auto-scrolled the timeline. */
  function armRowEdgeScroll(layer: DrawingLayer) {
    startEdgeScroll((x, y) => rowMoveAt(x, y, layer), "row");
  }

  function rowDown(e: PointerEvent, layer: DrawingLayer) {
    dragRowEl = e.currentTarget as HTMLElement;
    edgePointerX = e.clientX;
    edgePointerY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (!isFinePointer(e)) {
      touchPanDown(e); // finger/palm: pan only — do not change layer or frame
      return;
    }
    setActiveLayer(layer.id);
    dragLayerId = layer.id;
    const frame = rowColumn(e);
    pressStartX = e.clientX;
    pressStartY = e.clientY;

    // Shift/Ctrl-click extends an existing selection immediately (desktop).
    if ((e.shiftKey || e.ctrlKey || e.metaKey) && appState.timelineSelection) {
      setTimelineSelection(appState.timelineSelection.anchor, { layerId: layer.id, frame });
      dragMode = "marquee";
      armRowEdgeScroll(layer);
      return;
    }

    // Long-press anywhere → marquee (touch / packed rows).
    cancelLongPress();
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      dragMode = "marquee";
      setTimelineSelection({ layerId: layer.id, frame }, { layerId: layer.id, frame });
      armRowEdgeScroll(layer);
    }, LONG_PRESS_MS);

    // Locked/hidden rows accept SELECTION (copy is a read) but no mutating gesture: without this
    // the drag ran and the write was refused downstream, so keys visibly moved and snapped back.
    const editable = isLayerEditable(layer, appState.project.groups);
    const plan = planCellPointer(layer.cells, rowOffset(e), CELL_W, appState.project.frameCount);
    if (plan.kind === "resize" && editable) {
      // `setHoldSpan` splices the cell track, which a live lift/stroke holds a whole-track undo rider
      // against — undoing that lift would then also revert this resize. Must run BEFORE
      // `beginStructuralEdit`, since the discard reverts any keyframe the lift materialised and that
      // has to be part of the before-state. (Reachable without a layer/frame change: pressing this
      // row re-selects the SAME layer, so nothing banks the lift for us.)
      liftGuard.discard?.();
      dragMode = "resize";
      dragKey = plan.keyIndex;
      dragStartBoundary = rowBoundary(e);
      dragLastBoundary = dragStartBoundary;
      dragUndo = beginStructuralEdit();
      transformDragGuard.settle = settleRowDrag;
      armRowEdgeScroll(layer);
      return;
    }

    // Press anywhere INSIDE the current selection (key or empty) → move the whole block; a plain tap
    // collapses to that cell (handled in rowUp). The whole selection rect is the drag handle, not
    // just its ◆ cells. (A new marquee from within the bounds is still available via long-press.)
    if (inSelection(layer.id, frame) && editable) {
      dragMode = "moveblock";
      moveGrabFrame = frame;
      moveDelta = 0;
      transformDragGuard.settle = settleRowDrag;
      armRowEdgeScroll(layer);
      return;
    }

    // OUTSIDE the selection: arm a tap-vs-drag (resolved in rowMove/rowUp). A tap selects the key (or
    // deselects on empty); a drag starts a marquee from here — so you can rubber-band from anywhere,
    // including on a key. Moving lives INSIDE the selection: tap a key to select it, then drag it.
    armedOutside = true;
    armedOnKey = plan.kind === "move";
    pressFrame = frame;
  }
  function rowMove(e: PointerEvent, layer: DrawingLayer) {
    if (!isFinePointer(e)) {
      touchPanMove(e);
      return;
    }
    edgePointerX = e.clientX;
    edgePointerY = e.clientY;
    rowMoveAt(e.clientX, e.clientY, layer);
    if (dragMode === "none" && !armedOutside) rowHover(e, layer);
  }
  function rowMoveAt(clientX: number, clientY: number, layer: DrawingLayer) {
    // A real drag cancels a pending long-press.
    if (
      longPressTimer !== null &&
      (Math.abs(clientX - pressStartX) > MOVE_CANCEL_PX ||
        Math.abs(clientY - pressStartY) > MOVE_CANCEL_PX)
    )
      cancelLongPress();

    if (dragMode === "marquee" && appState.timelineSelection) {
      const overLayer = layerIdAtPoint(clientX, clientY, dragLayerId);
      setTimelineSelection(appState.timelineSelection.anchor, {
        layerId: overLayer,
        frame: rowColumnAt(clientX),
      });
      return;
    }
    if (dragMode === "moveblock") {
      const raw = rowColumnAt(clientX) - moveGrabFrame;
      moveDelta = selRect ? Math.max(raw, -selRect.startFrame) : raw; // clamp so nothing goes < 0
      // Mark a real drag by pointer TRAVEL, not by moveDelta — a drag that stays clamped at 0 (e.g. a
      // frame-0 selection dragged left) is still a drag, and must not be misread as a tap-to-collapse.
      if (
        Math.abs(clientX - pressStartX) > MOVE_CANCEL_PX ||
        Math.abs(clientY - pressStartY) > MOVE_CANCEL_PX
      )
        moved = true;
      return;
    }
    if (dragMode === "resize") {
      if (!isLayerEditable(layer, appState.project.groups)) return; // locked/hidden row: hold-span is content, not selection
      dragLastBoundary = rowBoundaryAt(clientX);
      setHoldSpan(layer, dragKey, Math.max(1, dragLastBoundary - dragKey));
      bump();
      return;
    }
    // Armed outside the selection: once the pointer really moves, start a marquee from the press cell.
    if (
      armedOutside &&
      (Math.abs(clientX - pressStartX) > MOVE_CANCEL_PX ||
        Math.abs(clientY - pressStartY) > MOVE_CANCEL_PX)
    ) {
      armedOutside = false;
      cancelLongPress();
      dragMode = "marquee";
      setTimelineSelection(
        { layerId: dragLayerId, frame: pressFrame },
        { layerId: layer.id, frame: rowColumnAt(clientX) },
      );
      armRowEdgeScroll(layer);
      return;
    }
  }

  /** Idle hover only — stays on the EVENT path because it measures `currentTarget`, and because
   *  there is no drag to re-apply when nothing is being dragged. */
  function rowHover(e: PointerEvent, layer: DrawingLayer) {
    // Idle hover cursor. Don't advertise resize/move on a row that rowDown will refuse.
    if (dragMode === "none") {
      if (!isLayerEditable(layer, appState.project.groups)) {
        rowCursor = "default";
      } else {
        const plan = planCellPointer(
          layer.cells,
          rowOffset(e),
          CELL_W,
          appState.project.frameCount,
        );
        rowCursor =
          plan.kind === "resize" ? "ew-resize" : plan.kind === "move" ? "grab" : "default";
      }
    }
  }
  /** undo()/tool-switch mid-gesture: commit a dirty hold-span so the following undo pops it;
   *  drop an in-flight move-block (it has not written yet). rowUp applies then calls resetRowDrag. */
  function settleRowDrag() {
    if (dragMode === "resize" && dragUndo && dragLastBoundary !== dragStartBoundary) {
      commitStructuralEdit(dragUndo);
    }
    resetRowDrag();
  }

  function resetRowDrag() {
    // Both shared hooks are released only if THIS drag still owns them: a settle for a row drag that
    // is not live must not kill another gesture's edge-scroll tick or clear its settle hook.
    stopEdgeScroll("row");
    if (transformDragGuard.settle === settleRowDrag) transformDragGuard.settle = null;
    dragRowEl = null;
    dragMode = "none";
    dragLayerId = -1;
    dragKey = -1;
    dragUndo = null;
    dragStartBoundary = -1;
    dragLastBoundary = -1;
    moveGrabFrame = -1;
    moveDelta = 0;
    moved = false;
    armedOutside = false;
    armedOnKey = false;
    pressFrame = -1;
    touchPanUp();
  }

  function rowUp(e: PointerEvent, layer: DrawingLayer) {
    cancelLongPress();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }

    if (dragMode === "moveblock") {
      if (!moved) {
        // A true tap (no frame change) → collapse to the grabbed key (1×1) + seek. (On down we kept
        // an existing block intact so a drag could move it; a plain tap resolves to just this key.)
        setTimelineSelection(
          { layerId: dragLayerId, frame: moveGrabFrame },
          { layerId: dragLayerId, frame: moveGrabFrame },
        );
        go(moveGrabFrame);
      } else if (moveDelta !== 0) {
        moveTimelineSelection(moveDelta);
      }
      // else: dragged out and back to net-zero → no-op, keep the selection intact.
    } else if (dragMode === "resize" && dragLayerId === layer.id && dragUndo) {
      if (dragLastBoundary !== dragStartBoundary) commitStructuralEdit(dragUndo);
    } else if (dragMode === "none" && armedOutside) {
      if (armedOnKey) {
        // tap on a key outside the selection → select it (1×1) + seek to its frame
        setTimelineSelection(
          { layerId: dragLayerId, frame: pressFrame },
          { layerId: dragLayerId, frame: pressFrame },
        );
        go(pressFrame);
      } else {
        clearTimelineSelection(); // tap on empty with no drag → deselect
      }
    }

    resetRowDrag();
  }
  function rowLeave() {
    if (dragMode === "none") rowCursor = "default";
  }

  // All tools act on the active drawing layer at the current frame, current-frame-aware
  // (inserts land AFTER the playhead, then the playhead follows to the new frame).
  // Frame tools are undoable structural edits. Advancing the playhead happens inside the
  // mutation so commitStructural's trailing bump() refreshes the length and clamps it.
  /** Put a cell track back, resolving the layer by ID at restore time — `restoreStructure` installs
   *  a FRESH layer object when the layer was removed or changed kind, so a captured object goes
   *  stale and the restore would silently write outside the document. */
  function restoreTrackById(layerId: number, cells: Cell[]) {
    const l = appState.project.layers.find((x) => x.id === layerId);
    if (l?.kind === "draw") restoreCellTrack(l, cells);
  }
  function frameTool() {
    const l = activeLayer();
    if (!isLayerEditable(l, appState.project.groups)) return;
    // Splices the cell track, which a live stroke/lift holds a whole-track undo rider against — on
    // iPad a finger can tap this while the Pencil is mid-stroke, and the rider (captured before the
    // splice) would then revert the inserted frame when that stroke is undone. The only frame tool
    // that lacked this; its siblings discard for the canvas-clone reason instead.
    liftGuard.discard?.();
    commitStructural(() => {
      addFrame(l, appState.playhead);
      appState.playhead += 1;
    });
  }
  function keyTool() {
    const l = activeLayer();
    if (!isLayerEditable(l, appState.project.groups)) return;
    // The new key CLONES the resolved key canvas, which a live lift has a hole punched in; the
    // playhead move then banks the lift back into the ORIGINAL, so the clone keeps the hole forever.
    liftGuard.discard?.();
    commitStructural(() => {
      insertKeyframe(l, appState.playhead, canvasOps);
      appState.playhead += 1;
    });
  }
  function dupTool() {
    const l = activeLayer();
    if (!isLayerEditable(l, appState.project.groups)) return;
    liftGuard.discard?.(); // clones the resolved key — same lift-hole hazard as keyTool above
    commitStructural(() => {
      duplicateKeyframe(l, appState.playhead, canvasOps);
      appState.playhead += 1;
    });
  }
  function holdTool() {
    const l = activeLayer();
    if (!isLayerEditable(l, appState.project.groups)) return;
    if (l.cells[appState.playhead]?.kind !== "key") return; // already a hold → nothing to do
    liftGuard.discard?.(); // this replaces the active cell's canvas — discard any live lift first
    commitStructural(() => setHold(l, appState.playhead));
  }
  // Document-wide ripple: shifts EVERY drawing layer plus everything in document-frame space, so a
  // reference aligned to a shot stays aligned. Deliberately not gated on the active layer being
  // editable (the per-layer tools are) — it is a document op, and skipping locked rows would break
  // the alignment it exists to preserve. Individual locked layers are still shifted, matching how
  // a document resize treats them.
  function rippleInsert() {
    liftGuard.discard?.(); // every layer's cell array is respliced under any live lift
    commitStructural(() => insertFrameAllLayers(appState.project, appState.playhead));
  }
  function rippleDelete() {
    if (appState.project.frameCount <= 1) return; // never leave a project with no frames
    liftGuard.discard?.();
    commitStructural(() => deleteFrameAllLayers(appState.project, appState.playhead));
  }
  function deleteTool() {
    const l = activeLayer();
    if (!isLayerEditable(l, appState.project.groups)) return;
    if (l.cells.length <= 1) return; // can't delete the last frame → no empty undo entry
    liftGuard.discard?.(); // this removes the active cell's canvas — discard any live lift first
    commitStructural(() => deleteFrame(l, appState.playhead));
  }
  // Blank the active layer's keyframe at the current frame (keep it as an empty keyframe),
  // undoable. If the frame is a hold, it first becomes an editable keyframe, then is cleared.
  function clearFrame() {
    const l = activeLayer();
    if (!isLayerEditable(l, appState.project.groups)) return;
    liftGuard.discard?.(); // may replace a hold with a new canvas; a live lift would target the old one
    const { canvas, materialized } = ensureDrawableKeyframe(l, appState.playhead, canvasOps);
    const layerId = l.id; // resolved at restore time: `restoreStructure` can replace the layer object
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    const after = ctx.getImageData(0, 0, canvas.width, canvas.height);
    history.push(
      pixelCommand(
        () => {
          ctx.putImageData(before, 0, 0);
          // Clearing a HOLD materialises a keyframe first; undo removes that too, so the frame goes
          // back to being a hold rather than staying an empty ◆.
          if (materialized) restoreTrackById(layerId, materialized.before);
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
    bump();
  }

  const toolBtn =
    "w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover border border-border";
</script>

<svelte:window onresize={onWindowResize} />

<div
  class="border-t border-border bg-surface text-text p-2 text-sm flex flex-col min-h-0 relative"
  style="height: {appState.timelineHeight}px"
>
  <!-- accept mirrors LayerList's: image/* and video/* both resolve correctly on iOS (unlike
       audio/*, which needs explicit extensions there — see the 2026-08-11 picker note). -->
  <input
    bind:this={relinkInput}
    type="file"
    accept="image/*,video/*"
    class="hidden"
    onchange={onRelinkFile}
  />
  <!-- resize grip: overlays the top padding strip, full width; drag to resize the panel -->
  <div
    class="absolute top-0 inset-x-0 h-2 z-30 flex items-center justify-center cursor-row-resize text-text-muted hover:text-text"
    style="touch-action: none"
    role="separator"
    aria-orientation="horizontal"
    aria-label="Resize timeline"
    title="Drag to resize the timeline"
    onpointerdown={gripDown}
    onpointermove={gripMove}
    onpointerup={gripUp}
    onpointercancel={gripUp}
  >
    <!-- This one KEEPS a visual hint, unlike the two vertical grips. Those sit on a panel EDGE,
         where drag-to-resize is a learned convention that needs no badge; this is an INTERIOR
         divider between the canvas and the timeline, so nothing about its position suggests it can
         be dragged. It also takes NO background tint, unlike them: this grip spans the full width,
         so the same bg-text/10 covers a hundred times the area and reads far louder. The bar
         brightening on hover is the whole feedback it needs. -->
    <div class="h-0.5 w-8 rounded bg-current opacity-60"></div>
  </div>
  <div class="flex items-center gap-1 mb-2 flex-wrap shrink-0">
    <button class={toolBtn} title="Add frame (after current)" onclick={frameTool}
      ><Plus size={16} /></button
    >
    <button class={toolBtn} title="Insert keyframe (after current)" onclick={keyTool}
      ><DiamondPlus size={16} /></button
    >
    <button class={toolBtn} title="Duplicate keyframe (after current)" onclick={dupTool}
      ><Copy size={16} class="rotate-45" /></button
    >
    <button class={toolBtn} title="Hold (repeat previous frame)" onclick={holdTool}
      ><Minus size={16} /></button
    >
    <button class={toolBtn} title="Clear frame (blank this keyframe)" onclick={clearFrame}
      ><Diamond size={16} /></button
    >
    <button class={toolBtn} title="Delete frame" onclick={deleteTool}><Trash2 size={16} /></button>

    <span class="w-px h-5 bg-border mx-1"></span>

    <!-- Ripple ops: separated from the five per-layer tools above because they act on the WHOLE
         document — every layer, plus anything living in document-frame space (reference ranges,
         video clip offsets, the audio track). The titles carry that distinction to the status bar. -->
    <button
      class={toolBtn}
      title="Insert frame in all layers (ripples clips and audio)"
      onclick={rippleInsert}><BetweenHorizonalStart size={16} /></button
    >
    <button
      class={toolBtn}
      title="Remove frame from all layers (ripples clips and audio)"
      onclick={rippleDelete}><BetweenHorizonalEnd size={16} /></button
    >

    <span class="w-px h-5 bg-border mx-1"></span>

    <!-- Trim to playhead. Reaches a clip edge that is pages away horizontally, which is otherwise a
         long scroll-and-drag. Acts on the SELECTED row and nothing else — the audio lane or an
         active image reference — so one control never means two things. Dimmed with the reason
         otherwise. aria-disabled, not disabled: a disabled button dispatches no pointer events, so
         the status bar could never read that reason. -->
    <button
      class={`${toolBtn} aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent`}
      title={trimTarget
        ? `Trim ${trimTarget.label} start to the playhead`
        : "Trim start to the playhead — select the audio lane or an image reference layer first"}
      aria-disabled={!trimTarget}
      onclick={() => {
        if (trimTarget) trimToPlayhead("start");
      }}><ArrowRightToLine size={16} /></button
    >
    <button
      class={`${toolBtn} aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent`}
      title={trimTarget
        ? `Trim ${trimTarget.label} end to the playhead`
        : "Trim end to the playhead — select the audio lane or an image reference layer first"}
      aria-disabled={!trimTarget}
      onclick={() => {
        if (trimTarget) trimToPlayhead("end");
      }}><ArrowLeftToLine size={16} /></button
    >

    <span class="w-px h-5 bg-border mx-1"></span>

    <!-- onion skin (a frame-drawing aid, lives with the frame tools) -->
    <button
      class={toolBtn}
      class:bg-surface-active={appState.onion.enabled}
      title="Onion skin"
      onclick={() => {
        appState.onion.enabled = !appState.onion.enabled;
        repaint();
      }}><Layers size={16} /></button
    >
    <!-- Onion params live in a popover, mirroring line boil next door: three inline labels made
         the bar wide and were the only text-xs labels in a text-sm bar. -->
    <div class="relative" use:clickOutside={() => (onionSettingsOpen = false)}>
      <button
        class={toolBtn}
        class:bg-surface-active={onionSettingsOpen}
        title="Onion skin settings"
        onclick={() => (onionSettingsOpen = !onionSettingsOpen)}><Settings size={16} /></button
      >
      {#if onionSettingsOpen}
        <div
          class="absolute left-0 bottom-full mb-2 z-30 w-56 p-3 rounded-lg bg-surface border border-border shadow-md flex flex-col gap-2 text-xs"
        >
          <label class="flex items-center gap-2" title="Onion: previous ghosts"
            ><span class="w-10 text-text-secondary">prev</span>
            <input
              type="range"
              class="flex-1"
              min="0"
              max="3"
              bind:value={appState.onion.prev}
              onchange={repaint}
            />
            <span class="w-8 text-right text-text-muted tabular-nums">{appState.onion.prev}</span
            ></label
          >
          <label class="flex items-center gap-2" title="Onion: next ghosts"
            ><span class="w-10 text-text-secondary">next</span>
            <input
              type="range"
              class="flex-1"
              min="0"
              max="3"
              bind:value={appState.onion.next}
              onchange={repaint}
            />
            <span class="w-8 text-right text-text-muted tabular-nums">{appState.onion.next}</span
            ></label
          >
          <label class="flex items-center gap-2" title="Onion: ghost all layers, not just this one">
            <input type="checkbox" bind:checked={appState.onion.allLayers} onchange={repaint} />
            all layers
          </label>
          <label
            class="flex items-center gap-2"
            title="Onion: step to neighbouring keyframes instead of frames — holds don't use up a ghost"
          >
            <input type="checkbox" bind:checked={appState.onion.byKeyframes} onchange={repaint} />
            step by keyframes
          </label>
          <span class="text-text-muted"
            >Keyframes come from the active layer{appState.onion.allLayers
              ? "; all layers are drawn at those frames"
              : ""}.</span
          >
        </div>
      {/if}
    </div>

    <span class="w-px h-5 bg-border mx-1"></span>

    <!-- line boil: quick toggle + a settings popover for the params -->
    <button
      class={toolBtn}
      class:bg-surface-active={appState.project.boil.enabled}
      title="Line boil (playback)"
      onclick={() => {
        appState.project.boil.enabled = !appState.project.boil.enabled;
        bump();
      }}><Waves size={16} /></button
    >
    <div class="relative" use:clickOutside={() => (boilSettingsOpen = false)}>
      <button
        class={toolBtn}
        class:bg-surface-active={boilSettingsOpen}
        title="Boil settings"
        onclick={() => (boilSettingsOpen = !boilSettingsOpen)}><Settings size={16} /></button
      >
      {#if boilSettingsOpen}
        <div
          class="absolute left-0 bottom-full mb-2 z-30 w-56 p-3 rounded-lg bg-surface border border-border shadow-md flex flex-col gap-2 text-xs"
        >
          <label class="flex items-center gap-2" title="Boil amount (px)"
            ><span class="w-10 text-text-secondary">amt</span>
            <input
              type="range"
              class="flex-1"
              min="0"
              max="8"
              step="0.1"
              bind:value={appState.project.boil.amount}
            />
            <span class="w-8 text-right text-text-muted tabular-nums"
              >{appState.project.boil.amount}</span
            ></label
          >
          <label class="flex items-center gap-2" title="Boil detail (grid columns)"
            ><span class="w-10 text-text-secondary">detail</span>
            <input
              type="range"
              class="flex-1"
              min="4"
              max="40"
              step="1"
              bind:value={appState.project.boil.cols}
            />
            <span class="w-8 text-right text-text-muted tabular-nums"
              >{appState.project.boil.cols}</span
            ></label
          >
          <label class="flex items-center gap-2" title="Boil rate (cycle N warps — on twos/threes)"
            ><span class="w-10 text-text-secondary">rate</span>
            <input
              type="range"
              class="flex-1"
              min="1"
              max="8"
              step="1"
              bind:value={appState.project.boil.rate}
            />
            <span class="w-8 text-right text-text-muted tabular-nums"
              >{appState.project.boil.rate}</span
            ></label
          >
          <label class="flex items-center gap-2" title="Boil line-weight breathing"
            ><span class="w-10 text-text-secondary">weight</span>
            <input
              type="range"
              class="flex-1"
              min="0"
              max="1"
              step="0.05"
              bind:value={appState.project.boil.weight}
            />
            <span class="w-8 text-right text-text-muted tabular-nums"
              >{appState.project.boil.weight}</span
            ></label
          >
          <label class="flex items-center gap-2"
            ><input type="checkbox" bind:checked={appState.project.boil.holdsOnly} />
            <span class="text-text-secondary">Holds only (keep keyframes crisp)</span></label
          >
        </div>
      {/if}
    </div>
  </div>

  <!-- aligned grid: ruler + layer rows share one column geometry; a single playhead line spans them -->
  <div class="relative flex-1 min-h-0 overflow-auto" bind:this={gridWrapper}>
    <!-- playhead line (visual, non-interactive); centered on the current column. Scrubbing lives on
         the ruler only — an interactive line here would sit over the ◆ at the current frame and block
         grabbing/moving it. -->
    <div
      class="absolute inset-y-0 z-10 w-0.5 bg-accent pointer-events-none"
      style="left: {GUTTER_W + appState.playhead * CELL_W + CELL_W / 2 - 1}px"
    ></div>
    <!-- Full-height gutter plate. Sticky labels only cover their own row, so the playhead
         (absolute, inset-y-0, z-10) leaked through empty space below the last track. This
         plate sits between the line and the names (z-15), stays in the visible left strip,
         and is pulled out of flow so it does not push the rows down. -->
    <div
      class="pointer-events-none sticky top-0 left-0 z-15 bg-surface border-r border-text-muted"
      style="width: {GUTTER_W}px; height: {gridH}px; margin-bottom: {-gridH}px"
    ></div>
    <!-- Gutter resize grip: straddles the divider at the gutter's right edge, full height, sticky so
         it stays on that edge through horizontal scroll. z-40 — above the per-row sticky labels
         (z-20), which would otherwise swallow the press, AND above the ruler row (z-35), which the
         grip crosses and must stay grabbable through. Pulled out of flow the same way the plate is,
         so it adds no height. -->
    <div
      class="group sticky top-0 z-40 cursor-col-resize"
      style="left: {GUTTER_W -
        6}px; width: 8px; height: {gridH}px; margin-bottom: {-gridH}px; touch-action: none"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the timeline name column"
      title="Drag to resize the name column"
      onpointerdown={gutterGripDown}
      onpointermove={gutterGripMove}
      onpointerup={gutterGripUp}
      onpointercancel={gutterGripUp}
    >
      <!-- Same split as the layer panel's grip: 8px HIT area, 4px visible tint. Offset 2px from the
           grip's left so the tint lands just INSIDE the divider and never over a frame cell — the
           grip itself is biased 6-in/2-out for the same reason. -->
      <div class="absolute inset-y-0 w-1 group-hover:bg-text/10" style="left: 2px"></div>
    </div>

    <!-- ruler (contiguous with the rows so the sticky gutter fully hides the playhead line). A
         distinct shade + a divider set the time band apart from the content tracks below. -->
    <!-- The band bg lives on the label + tick strip (not this full-width sticky wrapper), so the
         time band visibly ENDS at the last frame instead of stretching over the whole scroll width. -->
    <!-- z-35: the per-row gutter labels are sticky at z-20 and come LATER in DOM order, so at equal
         z they painted OVER this row — layer names leaked across the ruler as you scrolled the tracks
         vertically. The ruler is the thing rows scroll UNDER, so it has to outrank them. The playhead
         badge is a child of this row and rides along; the gutter resize grip sits above it again
         (z-40) so it stays grabbable at the ruler's level. -->
    <div
      class="sticky top-0 z-35 flex w-max items-stretch bg-surface"
      style="min-width: {stripMinW}px"
    >
      <span
        class="shrink-0 sticky left-0 z-20 bg-surface-active border-r border-text-muted"
        style="width: {GUTTER_W}px"
      >
        <!-- The playhead badge's tip protrudes 6px BELOW this row, so the spacer above (which is
             only as tall as the ruler) cannot hide it and the tip leaked over the gutter names when
             scrolled right. This masks that band. It must be a child of the STICKY spacer: an
             absolute box in the row itself would be positioned from the row's left edge, which
             scrolls away, and a taller spacer would push every track down by 6px. `top-full` puts it
             exactly under the ruler; the border continues the gutter divider through the strip. -->
        <span
          class="pointer-events-none absolute left-0 top-full bg-surface border-r border-text-muted"
          style="width: {GUTTER_W}px; height: 6px"
        ></span>
      </span>
      {#if playRange}
        <!-- Play-range edges: accent line + a triangle pointing INTO the range (slop-compositor /
             iClone refs). Decoration only — pointer-events-none so ruler scrubbing is unaffected. -->
        <div
          class="absolute top-0 z-10 h-6 w-0.5 pointer-events-none"
          style="left: {GUTTER_W + playRange.start * CELL_W}px; background: var(--color-selection)"
        >
          <div
            class="absolute top-0 left-0.5"
            style="width: 0; height: 0; border-top: 5px solid var(--color-selection); border-right: 5px solid transparent"
          ></div>
        </div>
        <div
          class="absolute top-0 z-10 h-6 w-0.5 pointer-events-none"
          style="left: {GUTTER_W +
            (playRange.end + 1) * CELL_W -
            2}px; background: var(--color-selection)"
        >
          <div
            class="absolute top-0 right-0.5"
            style="width: 0; height: 0; border-top: 5px solid var(--color-selection); border-left: 5px solid transparent"
          ></div>
        </div>
      {/if}
      <!-- Current-frame badge riding the playhead (Blender/compositor-style). z-10 keeps it UNDER
           the sticky gutter (z-20) so it slides out of sight instead of floating over the names. -->
      <div
        class="absolute top-0 z-10 h-6 px-1 flex items-center justify-center rounded bg-accent text-accent-text text-xs tabular-nums pointer-events-none"
        style="left: {GUTTER_W +
          appState.playhead * CELL_W +
          CELL_W / 2}px; min-width: {CELL_W}px; transform: translateX(-50%)"
      >
        {appState.playhead + 1}
      </div>
      <!-- …and its downward tip, continuing into the playhead line below. -->
      <div
        class="absolute z-10 pointer-events-none"
        style="left: {GUTTER_W +
          appState.playhead * CELL_W +
          CELL_W /
            2}px; top: 24px; transform: translateX(-50%); width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 6px solid var(--color-accent)"
      ></div>
      <!-- tabindex=-1, NOT 0: ←/→/Home/End work globally (App.svelte), so a tab stop here granted
           no capability — it only added a stray stop and a click focus ring. role/aria stay so
           assistive tech can still read the ruler in browse mode. -->
      <div
        bind:this={rulerEl}
        class="flex cursor-ew-resize select-none bg-surface-active"
        style="touch-action: none"
        role="slider"
        tabindex="-1"
        aria-label="Scrub frames"
        aria-valuemin={1}
        aria-valuemax={appState.project.frameCount}
        aria-valuenow={appState.playhead + 1}
        onpointerdown={rulerDown}
        onpointermove={rulerMove}
        onpointerup={rulerUp}
        onpointercancel={rulerUp}
        onkeydown={rulerKey}
      >
        <!-- Length handle at the ruler's right edge. Sits INSIDE the ruler row so it scrolls with
             the frames it measures; absolutely positioned so it adds no column. -->
        <div
          class="absolute inset-y-0 z-20 w-2 cursor-ew-resize hover:bg-text/10"
          style="left: {GUTTER_W + appState.project.frameCount * CELL_W - 4}px; touch-action: none"
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag to set the animation length"
          title="Drag to set the animation length"
          onpointerdown={lenGripDown}
          onpointermove={lenGripMove}
          onpointerup={lenGripUp}
          onpointercancel={lenGripUp}
        ></div>
        {#each Array(appState.project.frameCount) as _, f (f)}
          {@const r = playRange}
          <!-- Ruler ticks: border/surface-active are near-identical in both themes, so ticks use
               text-muted — minors dimmed, every 5th (the label cadence) at full strength. -->
          <div
            class="box-border h-6 border-r text-xs/6 text-center text-text-secondary {(f + 1) %
              5 ===
            0
              ? 'border-text-muted'
              : 'border-text-muted/35'}"
            style="width: {CELL_W}px; {r && f >= r.start && f <= r.end
              ? 'background: color-mix(in srgb, var(--color-selection) 28%, transparent);'
              : ''}"
          >
            {rulerLabel(f)}
          </div>
        {/each}
      </div>
    </div>

    <!-- audio waveform lane (scrolls with the ruler + rows; only when an audio track is set) -->
    <AudioLane
      cellW={CELL_W}
      labelW={LABEL_W}
      markerW={MARKER_W}
      minWidth={stripMinW}
      onTouchDown={touchPanDown}
      onTouchMove={touchPanMove}
      onTouchUp={touchPanUp}
      onEdgeScrollStart={startEdgeScroll}
      onEdgeScrollStop={stopEdgeScroll}
      onEdgePointerX={(x) => (edgePointerX = x)}
      getScrollLeft={scrollX}
    />

    <!-- layer rows (top layer first) -->
    {#each [...appState.project.layers].reverse() as layer (layer.id)}
      {#if !groupOf(layer, appState.project.groups)?.collapsed}
        <div class="flex w-max items-center" style="min-width: {stripMinW}px">
          <button
            class="shrink-0 sticky left-0 z-20 flex h-6 items-center gap-1 px-1 text-left hover:bg-surface-hover"
            class:bg-surface={!isRowSelected(layer.id)}
            class:bg-surface-active={isRowSelected(layer.id)}
            class:text-text={isRowSelected(layer.id)}
            class:text-text-secondary={!isRowSelected(layer.id)}
            style="width: {LABEL_W}px; touch-action: none"
            title="Select layer"
            onpointerdown={(e) => nameDown(e, layer.id)}
            onpointermove={(e) => {
              if (touchPan) touchPanMove(e);
            }}
            onpointerup={touchPanUp}
            onpointercancel={touchPanUp}
            onclick={() => setActiveLayer(layer.id)}
          >
            <!-- Type slot, matching the audio lane's Music icon. ALWAYS rendered (blank for drawing
                 layers) for the same reason the marker column is: it reserves the width so every row
                 — and the audio lane, which uses the same px-1/gap-1 — starts its name at one x. -->
            <span
              class="flex w-3.5 shrink-0 justify-center"
              role="presentation"
              title={layer.kind === "ref"
                ? "Reference layer — a guide only, not included in exports"
                : ""}
            >
              {#if layer.kind === "ref"}
                {#if layer.media.type === "video" || (layer.media.type === "missing" && layer.media.was === "video")}
                  <Film size={13} />
                {:else}
                  <Image size={13} />
                {/if}
              {/if}
            </span>
            <!-- min-w-0: a flex child will not shrink below its content without it, so `truncate`
                 would silently do nothing and push the name past the sticky label's edge. -->
            <span class="min-w-0 flex-1 truncate">{layer.name}</span></button
          >
          <!-- Read-only/hidden marker. ALWAYS rendered (blank when editable): it reserves the
               column so every row aligns and the frame cells get a gap after the name. -->
          <span
            class="sticky z-20 shrink-0 flex items-center justify-center h-6 text-amber-500 border-r border-text-muted"
            class:bg-surface={!isRowSelected(layer.id)}
            class:bg-surface-active={isRowSelected(layer.id)}
            role="presentation"
            style="left: {LABEL_W}px; width: {MARKER_W}px; touch-action: none"
            onpointerdown={(e) => {
              if (isFinePointer(e)) return;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              touchPanDown(e);
            }}
            onpointermove={(e) => {
              if (touchPan) touchPanMove(e);
            }}
            onpointerup={touchPanUp}
            onpointercancel={touchPanUp}
            title={isLayerLocked(layer, appState.project.groups)
              ? "Layer locked — edits refused"
              : !isLayerVisible(layer, appState.project.groups)
                ? "Layer hidden — edits refused"
                : ""}
          >
            {#if isLayerLocked(layer, appState.project.groups)}<Lock
                size={11}
              />{:else if !isLayerVisible(layer, appState.project.groups)}<EyeOff size={11} />{/if}
          </span>
          {#if layer.kind === "draw"}
            {@const glyphs = glyphsFor(layer, appState.version)}
            <div
              class="flex select-none"
              style="touch-action: none; cursor: {rowCursor}"
              class:opacity-100={isRowSelected(layer.id)}
              class:opacity-70={!isRowSelected(layer.id)}
              data-layer-id={layer.id}
              role="application"
              aria-label="{layer.name} frames"
              onpointerdown={(e) => rowDown(e, layer)}
              onpointermove={(e) => rowMove(e, layer)}
              onpointerup={(e) => rowUp(e, layer)}
              onpointercancel={(e) => rowUp(e, layer)}
              onpointerleave={rowLeave}
            >
              {#each Array(appState.project.frameCount) as _, f (f)}
                <div
                  class="box-border h-6 border border-border leading-none text-xs flex items-center justify-center"
                  class:bg-selection={inSelection(layer.id, f)}
                  style="width: {CELL_W}px"
                >
                  {displayGlyph(layer.id, glyphs, f)}
                </div>
              {/each}
            </div>
          {:else}
            {@const ref = layer}
            {#if ref.media.type === "video" && Number.isFinite(ref.media.el.duration) && ref.media.el.duration > 0}
              {@const lay = videoClipLayout(
                ref.offsetFrames,
                ref.speed,
                ref.media.el.duration,
                appState.project.fps,
              )}
              {@const tailFrames = Math.max(
                0,
                lay.startFrame + lay.spanFrames - appState.project.frameCount,
              )}
              <div
                class="relative box-border h-6 cursor-grab overflow-hidden border border-media-clip-border bg-media-clip text-xs/6 text-text"
                class:opacity-70={!isRowSelected(ref.id)}
                style="touch-action: none; margin-left: {lay.startFrame *
                  CELL_W}px; width: {lay.spanFrames * CELL_W}px"
                role="presentation"
                title="Drag to offset the video"
                onpointerdown={(e) => clipDown(e, ref)}
                onpointermove={clipMove}
                onpointerup={clipUp}
                onpointercancel={clipUp}
              >
                <span class="relative z-10 block truncate px-1">{ref.name}</span>
                {#if tailFrames > 0}
                  <div
                    class="pointer-events-none absolute inset-y-0 right-0 bg-media-clip-dim"
                    style="width: {tailFrames * CELL_W}px"
                  ></div>
                {/if}
              </div>
            {:else if ref.media.type === "missing"}
              <!-- A call to action, not a label. Plain onclick, NOT onpointerdown + stopPropagation:
                   the window-level status-hint listener reads this title on press, and stopping
                   propagation would kill the hint for the very pointer performing the gesture. -->
              <button
                class="ml-1 rounded px-1 text-xs text-text-muted underline decoration-dotted underline-offset-2 hover:bg-surface-hover hover:text-text"
                class:opacity-70={!isRowSelected(ref.id)}
                title="Media missing — click to re-link the file"
                onclick={() => startRelink(ref.id)}>re-link</button
              >
            {:else if ref.media.type === "image"}
              {@const span = refVisibleSpan(ref, appState.project.fps)}
              <!-- Untrimmed: span the project's REAL frames, the same implicit range an edge drag
                   materialises (rangeDown). Not stripFrames — that only runs wider when some OTHER
                   row's clip hangs past the end, which says nothing about this image. -->
              {@const s = span ?? { start: 0, end: Math.max(0, appState.project.frameCount - 1) }}
              <div
                class="relative box-border h-6 overflow-hidden border bg-media-clip text-xs/6 text-text"
                class:border-media-clip-border={span !== null}
                class:cursor-grab={span !== null}
                class:border-dashed={span === null}
                class:border-text-muted={span === null}
                class:opacity-70={!isRowSelected(ref.id)}
                style="touch-action: none; margin-left: {s.start * CELL_W}px; width: {(s.end -
                  s.start +
                  1) *
                  CELL_W}px"
                role="presentation"
                title={span === null
                  ? "Visible on every frame — drag an edge to trim"
                  : "Drag to move, drag an edge to trim"}
                onpointerdown={(e) => rangeDown(e, ref, "slide")}
                onpointermove={rangeMove}
                onpointerup={rangeUp}
                onpointercancel={rangeUp}
              >
                <!-- px-2.5 clears the 8px trim handles so a long name cannot slide under a grip. -->
                <span class="relative z-10 block truncate px-2.5">{ref.name}</span>
                <!-- The grips are the ONLY marking these handles have: cursor-ew-resize does nothing
                     on iPad (no cursor, no hover), which is the platform this app is used on most. The
                     bars are pointer-events-none so the handle div stays the event target. -->
                <div
                  class="absolute inset-y-0 left-0 z-20 flex w-2 cursor-ew-resize items-center justify-center gap-px"
                  style="touch-action: none"
                  role="presentation"
                  title="Trim the start"
                  onpointerdown={(e) => rangeDown(e, ref, "start")}
                  onpointermove={rangeMove}
                  onpointerup={rangeUp}
                  onpointercancel={rangeUp}
                >
                  <span class="pointer-events-none h-3 w-px bg-text-muted"></span>
                  <span class="pointer-events-none h-3 w-px bg-text-muted"></span>
                </div>
                <div
                  class="absolute inset-y-0 right-0 z-20 flex w-2 cursor-ew-resize items-center justify-center gap-px"
                  style="touch-action: none"
                  role="presentation"
                  title="Trim the end"
                  onpointerdown={(e) => rangeDown(e, ref, "end")}
                  onpointermove={rangeMove}
                  onpointerup={rangeUp}
                  onpointercancel={rangeUp}
                >
                  <span class="pointer-events-none h-3 w-px bg-text-muted"></span>
                  <span class="pointer-events-none h-3 w-px bg-text-muted"></span>
                </div>
              </div>
            {:else}
              <span class="ml-1 text-xs text-text-muted" class:opacity-70={!isRowSelected(ref.id)}
                >{ref.media.type === "video" ? "video" : "image"}</span
              >
            {/if}
          {/if}
        </div>
      {/if}
    {/each}

    <TimelineSelectionBar
      container={gridWrapper}
      rect={dragMode === "moveblock" ? null : selRect}
      cellW={CELL_W}
      labelW={GUTTER_W}
    />
  </div>
</div>
