<script lang="ts">
  import {
    Plus,
    Diamond,
    Trash2,
    Image,
    Film,
    ArrowRightToLine,
    ArrowLeftToLine,
    Layers,
    Waves,
    Settings,
    Lock,
    ChevronRight,
    ChevronDown,
    EyeOff,
    Spline,
    Blend,
    Group,
    CircleStop,
  } from "@lucide/svelte";
  import {
    buildSegments,
    timelineRows,
    type GroupTrackProp,
    type TrackProp,
  } from "../anim/row-layout";
  import { animationBar } from "../anim/animation-bar";
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
    selectGroup,
    selectTrack,
    toggleGroupCollapsed,
    toggleTracksCollapsed,
    toggleGroupTracksCollapsed,
    liftGuard,
    transformDragGuard,
    setTimelineSelection,
    moveTimelineSelection,
    clearTimelineSelection,
    relinkReference,
    isRowSelected,
    isTrackSelected,
    drawingRowLayerId,
    applyAnimationLength,
    revertStructural,
    trimToPlayhead,
    trimToPlayheadInfo,
    setVideoTrim,
    animateLayer,
    animateLayerOpacity,
    animateGroup,
    animateGroupOpacity,
    removeLayerAnimation,
    removeLayerOpacityAnimation,
    removeGroupAnimation,
    removeGroupOpacityAnimation,
    type StructSnapshot,
  } from "../state/appState.svelte";
  import {
    insertFrameAllLayers,
    deleteFrameAllLayers,
    ensureDrawableKeyframe,
    restoreCellTrack,
    setHoldSpan,
    holdSpanEnd,
    shiftLayerTrackKeys,
  } from "../anim/timeline";
  import {
    flingVelocity,
    decayVelocity,
    flingSpent,
    stepFlingAxis,
    type PanSample,
  } from "../anim/kinetic-scroll";
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
    isLayerEditable,
    isLayerLocked,
    isLayerAnimated,
    isGroupAnimated,
    isLayerVisible,
    countKeyframesPastLengthIn,
    groupHasLockedLayer,
    refVisibleSpan,
    withMovedKey,
    withMovedTransformKey,
    type KeyInterp,
    type DrawingLayer,
    type Layer,
    type LayerGroup,
    type GroupTracks,
    type LayerTracks,
    type Track,
    type TransformTrack,
    type ReferenceLayer,
    type Cell,
  } from "../anim/document";
  import { groupHeaderSelected } from "../anim/active-row";
  import {
    videoClipLayout,
    offsetAfterClipDrag,
    rangeAfterSlide,
    rangeAfterTrim,
    trimVideoHead,
    trimVideoTail,
    videoClipOriginOffset,
  } from "../anim/clip-layout";
  import { effectiveRange } from "../anim/playback";
  import { columnAtX, lengthAtX, planCellPointer } from "./timeline-grid";
  import { isCellEmpty } from "./cell-ink";
  import { computeTimelineGlyphs } from "./timeline-glyphs";
  import { clickOutside } from "./click-outside";
  import AudioLane from "./AudioLane.svelte";
  import TimelineSelectionBar from "./TimelineSelectionBar.svelte";
  import TrackKeyControls from "./TrackKeyControls.svelte";
  import Playbar from "./Playbar.svelte";

  const CELL_W = 24; // px, fixed column width (box-border cells, no gap → contiguous columns)
  // Layer-name column, now user-resizable (drag the divider at the gutter's right edge). REACTIVE:
  // every consumer below — the ruler spacer, both playhead offsets, the sticky plate, the strip
  // width, AudioLane's labelW and TimelineSelectionBar's labelW — reads these, so they must be
  // $derived rather than the consts they used to be, or the gutter and the cells drift apart.
  const LABEL_W = $derived(appState.timelineLabelWidth);
  // px, the animated-layer disclosure (Spline glyph + chevron) that folds its property rows away.
  // Taken OUT of the name column rather than added to the gutter, so nothing else on any row moves;
  // only an animated layer's name gets shorter, and only while it has a track.
  const DISCLOSE_W = 28;
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
      // Full file, including dimmed trimmed-away pads — so a head-trimmed clip's left pad
      // still keeps the strip wide enough for the sticky gutters.
      const origin = videoClipOriginOffset(l.offsetFrames, l.trimInFrames);
      const { startFrame, spanFrames } = videoClipLayout(origin, l.speed, dur, fps);
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
  // Through the accessor, never a hand-rolled `.kind` branch: this used to say "not a drawing row"
  // for a layer's own TRACK row while `isRowSelected` had that layer's row visibly lit.
  const drawingRowSelected = $derived(drawingRowLayerId() !== null);
  // Onion "step by keyframes" reads the ACTIVE layer's keys — empty on a ref, so the ghosts
  // vanish with no explanation. Dim the control rather than silently doing nothing.
  const onionKeysOk = $derived(activeLayer().kind === "draw");

  // Cell glyphs: ◆ keyframe with ink, ◇ a blank keyframe (cleared — a real keyframe boundary with
  // no content), — hold over an inked key. A hold stops only after a ◇, including past the layer's
  // last cell (those frames keep showing —). Blank for no key yet, or a hold after a blank key.
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

  // A fling started by `touchPanUp`, coasting in rAF. Native touch scrolling (with its inertia) is
  // unavailable here: the rows set `touch-action: none` so a Pencil drag edits instead of scrolling,
  // which switches it off for fingers too. Without this a drag from a ROW stopped dead while one
  // from empty space still glided — the same surface behaving two different ways.
  // `left`/`top` are the glide's OWN float position, never a readback: WebKit snaps `scrollLeft` to
  // whole device pixels, so re-reading it each frame drops the fraction and a slow glide stalls.
  let fling: { vx: number; vy: number; left: number; top: number; t: number; raf: number } | null =
    null;
  function stopFling() {
    if (fling) cancelAnimationFrame(fling.raf);
    fling = null;
  }
  function stepFling() {
    if (!fling || !gridWrapper) return;
    const el = gridWrapper;
    const now = performance.now();
    const dt = now - fling.t;
    fling.t = now;
    const x = stepFlingAxis(fling.left, fling.vx, dt, el.scrollWidth - el.clientWidth);
    const y = stepFlingAxis(fling.top, fling.vy, dt, el.scrollHeight - el.clientHeight);
    fling.left = x.pos;
    fling.top = y.pos;
    fling.vx = decayVelocity(x.v, dt);
    fling.vy = decayVelocity(y.v, dt);
    el.scrollLeft = fling.left;
    el.scrollTop = fling.top;
    if (flingSpent(fling.vx, fling.vy)) return stopFling();
    fling.raf = requestAnimationFrame(stepFling);
  }

  function touchPanDown(e: PointerEvent) {
    if (!gridWrapper) return;
    stopFling(); // a finger down catches the glide, as native scrolling does
    touchPan = {
      x: e.clientX,
      y: e.clientY,
      left: gridWrapper.scrollLeft,
      top: gridWrapper.scrollTop,
      panning: false,
      samples: [{ t: performance.now(), x: e.clientX, y: e.clientY }],
    };
  }
  function touchPanMove(e: PointerEvent): boolean {
    if (!touchPan || !gridWrapper) return false;
    const dx = e.clientX - touchPan.x;
    const dy = e.clientY - touchPan.y;
    if (!touchPan.panning && Math.hypot(dx, dy) > MOVE_CANCEL_PX) touchPan.panning = true;
    if (!touchPan.panning) return false;
    touchPan.samples.push({ t: performance.now(), x: e.clientX, y: e.clientY });
    // Only the last window's worth is ever read; trimming keeps a long drag from growing unbounded.
    if (touchPan.samples.length > 16) touchPan.samples.shift();
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
   *  a new column — which for `clipMoveAt` slid a video's in-point for a press that never moved. */
  let edgeOriginX = 0;
  let edgeOriginY = 0;

  function startEdgeScroll(apply: (clientX: number, clientY: number) => void, owner: string) {
    stopFling(); // a drag's edge scroll owns the scroller; a leftover glide would fight it
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

  /** `e` is passed straight through from the `pointerup` / `pointercancel` bindings, so the type is
   *  what tells a real lift from an aborted stream (an OS edge swipe, palm rejection). A cancelled
   *  gesture must not fling: the artist never released, so there is no throw to honour. Zero-arg
   *  callers are settle paths, i.e. an ordinary lift. */
  function touchPanUp(e?: PointerEvent) {
    // Remember whether the gesture actually PANNED, for controls that must not fire on a scroll that
    // happens to end on them. A click still fires when a drag ends on its element, and while
    // selecting a layer that way is harmless, opening a file picker mid-scroll is not.
    panEndedWithMovement = touchPan?.panning ?? false;
    if (touchPan?.panning && gridWrapper && e?.type !== "pointercancel") {
      const { vx, vy } = flingVelocity(touchPan.samples, performance.now());
      if (!flingSpent(vx, vy)) {
        stopFling();
        fling = {
          vx,
          vy,
          left: gridWrapper.scrollLeft,
          top: gridWrapper.scrollTop,
          t: performance.now(),
          raf: requestAnimationFrame(stepFling),
        };
      }
    }
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
    setActiveLayer(id);
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

  // Video-ref clip drag: writes offsetFrames live, and brackets ONE undo entry per completed
  // gesture. `offsetFrames` is a snapshot-restored field (`restoreStructure` writes it back
  // unconditionally), and the invariant there is that every writer of a captured field must push a
  // command — otherwise an unrelated undo silently reverts the writes that never did. The trim
  // handle on this very clip is bracketed and writes the same field, so an unbracketed slide after
  // a trim was discarded by the next ⌘Z with no redo able to recover it.
  let clipDrag: {
    layer: ReferenceLayer;
    x: number;
    sx: number;
    startFrame: number;
    from: number;
    undo: ReturnType<typeof beginStructuralEdit>;
  } | null = null;

  function clipDown(e: PointerEvent, layer: ReferenceLayer) {
    // A trim handle is a sibling, not a child, so this usually does not see handle presses.
    // Guard anyway: if a handle already owns the gesture, do not also start a body slide.
    if (videoTrimDrag) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (!isFinePointer(e)) {
      touchPanDown(e);
      return;
    }
    setActiveLayer(layer.id);
    if (layer.media.type !== "video") return;
    const dur = layer.media.el.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const { startFrame } = videoClipLayout(
      layer.offsetFrames,
      layer.speed,
      dur,
      appState.project.fps,
    );
    clipDrag = {
      layer,
      x: e.clientX,
      sx: scrollX(),
      startFrame,
      from: layer.offsetFrames,
      undo: beginStructuralEdit(),
    };
    edgePointerX = e.clientX;
    startEdgeScroll(clipMoveAt, "clip");
    transformDragGuard.settle = settleClipDrag;
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

  /** Release the slide: commit only when the offset actually moved (a click without a drag must
   *  push nothing, or the next ⌘Z looks dead). Also the `transformDragGuard` hook, so an undo or an
   *  Open mid-drag cannot leave the bracket open. */
  function settleClipDrag() {
    stopEdgeScroll("clip");
    if (!clipDrag) return;
    if (clipDrag.layer.offsetFrames !== clipDrag.from) commitStructuralEdit(clipDrag.undo);
    clipDrag = null;
    if (transformDragGuard.settle === settleClipDrag) transformDragGuard.settle = null;
  }

  function clipUp() {
    settleClipDrag();
    touchPanUp();
  }

  // Video source trim. Separate from the body slide, which only moves offsetFrames — both bracket
  // one undo entry per completed gesture (see settleClipDrag above; the slide stopped being
  // non-undoable when the audio offset did). A trim changes WHAT renders rather than where the clip
  // sits, matching the image-range and audio-trim handles. Head trim uses trimVideoHead (offset and
  // trimIn move opposite, scaled by speed).
  let videoTrimDrag: {
    layer: ReferenceLayer;
    edge: "head" | "tail";
    x: number;
    sx: number;
    from: { offsetFrames: number; trimInFrames: number; trimLenFrames: number };
    extent: number;
    undo: ReturnType<typeof beginStructuralEdit>;
  } | null = null;

  function videoTrimDown(e: PointerEvent, layer: ReferenceLayer, edge: "head" | "tail") {
    if (videoTrimDrag) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (!isFinePointer(e)) {
      touchPanDown(e);
      return;
    }
    setActiveLayer(layer.id);
    if (layer.media.type !== "video") return;
    const dur = layer.media.el.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const extent = Math.max(0, Math.ceil(dur * appState.project.fps));
    const tin = Math.max(0, layer.trimInFrames ?? 0);
    const len = layer.trimLenFrames ?? extent - tin;
    videoTrimDrag = {
      layer,
      edge,
      x: e.clientX,
      sx: scrollX(),
      from: { offsetFrames: layer.offsetFrames, trimInFrames: tin, trimLenFrames: len },
      extent,
      undo: beginStructuralEdit(),
    };
    edgePointerX = e.clientX;
    startEdgeScroll(videoTrimMoveAt, "video-trim");
    transformDragGuard.settle = settleVideoTrimDrag;
  }

  function videoTrimMove(e: PointerEvent) {
    if (e.pointerType === "touch") {
      touchPanMove(e);
      return;
    }
    edgePointerX = e.clientX;
    videoTrimMoveAt(e.clientX);
  }
  function videoTrimMoveAt(clientX: number) {
    if (!videoTrimDrag) return;
    const delta = Math.round((clientX - videoTrimDrag.x + (scrollX() - videoTrimDrag.sx)) / CELL_W);
    const f = videoTrimDrag.from;
    const next =
      videoTrimDrag.edge === "head"
        ? trimVideoHead(
            f.offsetFrames,
            f.trimInFrames,
            f.trimLenFrames,
            delta,
            videoTrimDrag.layer.speed,
            videoTrimDrag.extent,
          )
        : {
            offsetFrames: f.offsetFrames,
            ...trimVideoTail(
              f.trimInFrames,
              f.trimLenFrames,
              delta,
              videoTrimDrag.layer.speed,
              videoTrimDrag.extent,
            ),
          };
    const layer = videoTrimDrag.layer;
    const curIn = Math.max(0, layer.trimInFrames ?? 0);
    const curLen = layer.trimLenFrames ?? videoTrimDrag.extent - curIn;
    if (
      layer.offsetFrames === next.offsetFrames &&
      curIn === next.trimInFrames &&
      curLen === next.trimLenFrames
    )
      return;
    setVideoTrim(layer, next.trimInFrames, next.trimLenFrames, next.offsetFrames);
  }

  function settleVideoTrimDrag() {
    stopEdgeScroll("video-trim");
    if (!videoTrimDrag) return;
    const layer = videoTrimDrag.layer;
    const f = videoTrimDrag.from;
    const curIn = Math.max(0, layer.trimInFrames ?? 0);
    const curLen = layer.trimLenFrames ?? videoTrimDrag.extent - curIn;
    const changed =
      layer.offsetFrames !== f.offsetFrames ||
      curIn !== f.trimInFrames ||
      curLen !== f.trimLenFrames;
    if (changed) commitStructuralEdit(videoTrimDrag.undo);
    videoTrimDrag = null;
    if (transformDragGuard.settle === settleVideoTrimDrag) transformDragGuard.settle = null;
  }

  function videoTrimUp(e: PointerEvent) {
    if (e.pointerType === "touch") {
      touchPanUp();
      return;
    }
    settleVideoTrimDrag();
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
    setActiveLayer(layer.id);
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
    // Named reference, not an arrow: the settle hook is SHARED, so releasing it has to be
    // conditional on this drag still owning it (see settleRangeDrag) and a fresh closure per grab
    // could never be compared.
    transformDragGuard.settle = settleRangeDrag;
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
    // Only release the shared hook if this drag still owns it: clearing another gesture's settle
    // would leave that one unable to close its bracket (the idiom every registrant now uses).
    if (transformDragGuard.settle === settleRangeDrag) transformDragGuard.settle = null;
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
    // Only release the shared hook if this drag still owns it — see settleRangeDrag.
    if (transformDragGuard.settle === settleLenDrag) transformDragGuard.settle = null;
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
    if (next !== null) {
      stopFling(); // playback is paging the view; a glide would drag it straight back
      el.scrollLeft = next;
    }
  });

  // A press anywhere in the timeline catches a glide, exactly as native scrolling does — and a
  // Pencil press must too, or you would start editing while the view slides under you. Capture
  // phase and one listener, rather than a stopFling() in every gesture entry point (there are six).
  $effect(() => {
    const el = gridWrapper;
    if (!el) return;
    const onDown = () => stopFling();
    el.addEventListener("pointerdown", onDown, { capture: true });
    return () => {
      el.removeEventListener("pointerdown", onDown, { capture: true });
      stopFling(); // teardown: never leave a rAF running against a detached element
    };
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
  let touchPan: {
    x: number;
    y: number;
    left: number;
    top: number;
    panning: boolean;
    samples: PanSample[]; // recent positions, for the release velocity
  } | null = null;
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
    // SCOPED to the grid, the same containment the nearest-row fallback below already has. The
    // layer PANEL puts `data-layer-id` on every one of its rows, so an unscoped hit-test let a
    // marquee dragged up out of the timeline retarget onto a panel row — the single place the
    // "property and group rows carry no layer identity" invariant leaked out of the timeline.
    const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-layer-id]");
    if (el && gridWrapper?.contains(el)) return Number(el.dataset.layerId);
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
  // The same wording the Ease control uses, so a key's tooltip and the control that sets it agree —
  // a tooltip reading the raw enum ("ease-in-out") names something the UI never calls that.
  const INTERP_LABEL: Record<KeyInterp, string> = {
    linear: "Linear",
    "ease-in": "Ease in",
    "ease-out": "Ease out",
    "ease-in-out": "Ease in-out",
    hold: "Hold",
  };
  /**
   * Everything a property row needs to draw itself and to be edited, resolved from its owner ONCE
   * per render. One spec for a layer's transform, a layer's opacity and a group's transform means
   * the row markup and the key drag below are written once rather than once per property — which is
   * exactly how two rows come to answer the same question differently.
   */
  type TrackRowSpec = {
    /** The track being drawn. Generic in its value: the row only ever reads key FRAMES and
     *  `interp`, never the value itself. */
    track: Track<unknown>;
    label: string;
    /** Which property this row animates. The row's title has to name the control that KEYS it, and
     *  the two properties are keyed from opposite ends of the app — a single tail promising the
     *  Transform tool sent an opacity row's reader to a tool that cannot touch it. On iPad this
     *  title IS the status-bar hint, so it is read rather than skimmed. */
    prop: TrackProp;
    /** The owner's name, for the row's and the marker's titles — the status bar reads them, and on
     *  iPad a tap on the row is the only route to that text. */
    owner: string;
    /** Indented to sit under its owner, the way a group member's own row is. */
    indent: boolean;
    /** Highlighted with its OWNER — a layer and its tracks are one thing, so there is no separate
     *  selection state to keep. */
    selected: boolean;
    /** Locked or hidden (group-DERIVED, never the raw flags). A key can still be TAPPED — that
     *  seeks and selects, and reading a locked owner is allowed everywhere else — but not retimed. */
    readOnly: boolean;
    /** Which of the two, for the marker column's glyph and title. Lock wins, as everywhere. */
    block: "locked" | "hidden" | null;
    /** Select the owner and aim the Transform tool at it — the two things you always want next. */
    select: () => void;
    /** Replace the owner's track for this property. Replaces the BAG too (gotcha #8 reaches both
     *  levels), and the spread keeps any sibling track. */
    setTrack: (t: Track<unknown> | undefined) => void;
    /** Move a key, copying at the depth THIS track kind needs — a transform track carries `box`. */
    moved: (t: Track<unknown>, from: number, to: number) => Track<unknown>;
  };

  const TRACK_LABEL: Record<TrackProp, string> = { transform: "Transform", opacity: "Opacity" };

  function layerTrackSpec(layer: Layer, prop: TrackProp): TrackRowSpec | null {
    const track = layer.tracks?.[prop];
    if (!track) return null;
    // Group-aware, never the raw `.locked`/`.visible` flags. NOT `isLayerEditable`: that is a
    // `layer is DrawingLayer` predicate and a REFERENCE layer can be animated too.
    const locked = isLayerLocked(layer, appState.project.groups);
    const hidden = !isLayerVisible(layer, appState.project.groups);
    return {
      track,
      label: TRACK_LABEL[prop],
      prop,
      owner: layer.name,
      indent: layer.groupId != null,
      selected: isTrackSelected("layer", layer.id, prop),
      readOnly: locked || hidden,
      block: locked ? "locked" : hidden ? "hidden" : null,
      select: () => selectTrack({ owner: "layer", id: layer.id, prop }),
      setTrack: (t) => {
        // The only track ever handed back here is one this spec's own `moved` produced, so the
        // property's value type is preserved — TS just cannot see that through the generic
        // `Track<unknown>` hop the shared drag needs.
        layer.tracks = { ...layer.tracks, [prop]: t } as LayerTracks;
      },
      moved: (t, from, to) =>
        prop === "transform"
          ? withMovedTransformKey(t as TransformTrack, from, to)
          : // Identity copy, because the only non-transform property is a NUMBER. A future
            // OBJECT-valued property must pass its own copier here or a snapshot would share it.
            withMovedKey(t as Track<number>, from, to, (n) => n),
    };
  }

  function groupTrackSpec(group: LayerGroup, prop: GroupTrackProp): TrackRowSpec | null {
    const track = group.tracks?.[prop];
    if (!track) return null;
    // `selectTrack` aims the draw target at a DRAW member of this group (or leaves it alone when
    // there is none) — never a ref. See that function for why a wrong member is worse than none.
    // A locked MEMBER pins the group, exactly as it does for the gizmo drag, Reset and
    // Stop-animating (`groupHasLockedLayer` — which already returns true for a locked group itself,
    // so it subsumes the group's own flag rather than needing to be ORed with it). Without this,
    // retiming a key here moved a locked member's rendered content at those frames — the one group
    // transform writer that did not refuse.
    // LOCK ONLY, matching `trackTarget` and `animateTargetGroup`, which are deliberately lock-only
    // too, and `activeTransformLayer`, which keeps a hidden group draggable. Hiding a group used to
    // put an EyeOff here claiming its keys could not be retimed while ToolOptions still deleted and
    // re-eased those same keys and the gizmo still dragged them — a refusal nothing else honoured.
    const locked = groupHasLockedLayer(group, appState.project.layers);
    return {
      track,
      label: TRACK_LABEL[prop],
      prop,
      owner: group.name,
      indent: false,
      // Through the accessor, never a hand-rolled `activeRow` conjunction: a view that combines
      // `activeRow` with `activeLayerId`-derived state has shipped a forgotten term twice here.
      selected: isTrackSelected("group", group.id, prop),
      readOnly: locked,
      // Reports the LOCK whenever the lock is what refuses — a row that refuses without stating why
      // is the actual defect, and this row's marker/title is the only place the reason appears.
      block: locked ? "locked" : null,
      select: () => selectTrack({ owner: "group", id: group.id, prop }),
      setTrack: (t) => {
        group.tracks = { ...group.tracks, [prop]: t } as GroupTracks;
      },
      moved: (t, from, to) =>
        prop === "transform"
          ? withMovedTransformKey(t as TransformTrack, from, to)
          : withMovedKey(t as Track<number>, from, to, (n) => n),
    };
  }

  // Dragging a property key to another frame. Same bracket shape as every other undoable drag
  // here: snapshot at grab, write live, commit at release only if something actually moved, and
  // register the settle hook so an undo or a tool switch mid-drag cannot leave the bracket open.
  // `prevTrack` is a valid snapshot by itself because tracks are always REPLACED, never mutated.
  let keyDrag: {
    spec: TrackRowSpec;
    /** The pointer that owns this gesture. The move/up/cancel listeners are on WINDOW (see
     *  addKeyDragListeners), where pointer capture cannot isolate them, so every one of them has to
     *  check this: on iPad a Pencil holding a key plus a finger touching to scroll would otherwise
     *  let the FINGER drive the key and its release commit the drag, leaving the Pencil inert. */
    pointerId: number;
    /** The owner is locked or hidden (its own flag or its group's): the key can still be TAPPED —
     *  that seeks and selects, and reading a locked layer is allowed everywhere else — but it
     *  cannot be retimed, so no snapshot is taken and no write is ever made. */
    readOnly: boolean;
    /** Grab point, for the movement threshold in keyMoveAt. */
    startX: number;
    startY: number;
    /** Has the pointer travelled far enough to count as a drag rather than a tap? */
    moved: boolean;
    prevTrack: Track<unknown>;
    from: number;
    cur: number;
    undo: ReturnType<typeof beginStructuralEdit> | null;
  } | null = null;

  // Bound to WINDOW for the duration of a key drag, not to the marker. The markers live in an
  // `{#each keys as k (k.frame)}` keyed BY FRAME, so the moment the key moves Svelte destroys the
  // element under the pointer and builds a new one — taking its pointer capture with it, which
  // stopped the drag dead after exactly one frame. The gizmo's handle drag has always used window
  // listeners for the same reason.
  function addKeyDragListeners() {
    window.addEventListener("pointermove", keyMove);
    window.addEventListener("pointerup", settleKeyDrag);
    window.addEventListener("pointercancel", settleKeyDrag);
  }
  function removeKeyDragListeners() {
    window.removeEventListener("pointermove", keyMove);
    window.removeEventListener("pointerup", settleKeyDrag);
    window.removeEventListener("pointercancel", settleKeyDrag);
  }

  function keyDown(e: PointerEvent, spec: TrackRowSpec, frame: number) {
    // Finger navigates, Pencil edits — the app-wide rule. A touch falls through to the row's own
    // pan handling instead of retiming a key by accident.
    if (!isFinePointer(e)) {
      // Finger navigates: hand it to the row pan, or this row would be a dead zone for scrolling
      // while every other row scrolls.
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      touchPanDown(e);
      return;
    }
    // A second grab must never overwrite a drag in flight: the first snapshot would be dropped
    // uncommitted and the second taken against an already-mutated document, making the first move
    // permanently un-undoable. A right-click during a left drag is enough, hence the button filter
    // too (mouse `button` is 0 for the primary button and for every pen/touch contact).
    if (keyDrag || !e.isPrimary || e.button !== 0) return;
    // A read-only owner keeps the tap-to-seek path (see settleKeyDrag) and loses only the retime —
    // which is what every other track writer already refuses. Resolved by the spec, group-aware.
    const readOnly = spec.readOnly;
    // No stopPropagation: it would suppress App.svelte's window-level status-hint listener, so this
    // marker's title would never reach the status bar. Nothing above needs blocking — the strip's
    // own pointerdown bails while `keyDrag` is set (the parent-bails-on-child-state shape), and
    // gridWrapper's fling-catcher runs in the capture phase, which stopPropagation cannot reach.
    // No setPointerCapture either: this element is about to be destroyed and rebuilt (see
    // addKeyDragListeners), so capturing on it would be pointless.
    addKeyDragListeners();
    edgePointerX = e.clientX;
    edgePointerY = e.clientY;
    if (!readOnly) startEdgeScroll(keyMoveAt, "key");
    keyDrag = {
      spec,
      pointerId: e.pointerId,
      readOnly,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      prevTrack: spec.track,
      from: frame,
      cur: frame,
      undo: readOnly ? null : beginStructuralEdit(),
    };
    if (!readOnly) transformDragGuard.settle = settleKeyDrag;
  }

  function keyMove(e: PointerEvent) {
    if (!keyDrag || e.pointerId !== keyDrag.pointerId) return;
    edgePointerX = e.clientX;
    edgePointerY = e.clientY;
    keyMoveAt(e.clientX);
  }
  /** Positional, so the edge-scroll tick can RE-APPLY the drag while the pointer sits still past an
   *  edge — without that the view scrolls but the key stays where it was. Measured absolutely from
   *  the scroller's rect plus its scrollLeft, so it needs no grab-time scroll correction: the
   *  measurement already moves with the content. */
  function keyMoveAt(clientX: number) {
    if (!keyDrag || keyDrag.readOnly) return;
    // A tap must stay a tap. The marker's hit box straddles the cell boundary, so a few px of
    // Pencil wobble used to cross into the next column and push a real undo entry — defeating the
    // documented tap-to-seek (and therefore tap-then-delete) workflow. Same threshold, and the
    // same latch-once shape, the row drag already uses.
    if (
      !keyDrag.moved &&
      Math.abs(clientX - keyDrag.startX) <= MOVE_CANCEL_PX &&
      Math.abs(edgePointerY - keyDrag.startY) <= MOVE_CANCEL_PX
    )
      return;
    keyDrag.moved = true;
    const to = columnAtX(
      clientX -
        (gridWrapper?.getBoundingClientRect().left ?? 0) +
        (gridWrapper?.scrollLeft ?? 0) -
        GUTTER_W,
      CELL_W,
      appState.project.frameCount,
    );
    if (to === keyDrag.cur) return;
    // Retiming a key re-resolves the segment, so a lifted selection/pose would bake back through
    // its GRAB-TIME compose and land at the old placement. Discarded here, at the first write that
    // actually moves the key, rather than at grab: a press that only taps to seek must not throw
    // away a float, and setActiveLayer/seekPlayhead on that path already bank it (gotcha #9).
    if (keyDrag.cur === keyDrag.from) {
      liftGuard.discard?.();
      // and RE-TAKE the snapshot, because the discard can itself mutate the document:
      // `discardActiveEdits` reverts a keyframe an open stroke materialised, so a bracket opened at
      // grab would contain a cell the discard has since removed — undoing this retime would then
      // resurrect a blank ◆ on a frame that was a hold. Re-snapshotting here (rather than simply
      // discarding at grab) is what lets both rules hold at once: a tap keeps its float, and the
      // snapshot still post-dates every mutation it is supposed to describe.
      keyDrag.undo = beginStructuralEdit();
    }
    // Always move from the ORIGINAL frame against the grab-time track, so a drag that passes over
    // another key does not eat it on the way through — only where it is released.
    keyDrag.spec.setTrack(keyDrag.spec.moved(keyDrag.prevTrack, keyDrag.from, to));
    keyDrag.cur = to;
    bump();
  }

  /** Also the `transformDragGuard.settle` hook, which calls it with NO event — hence the optional
   *  parameter. When there IS one it must belong to the pointer that started the drag, or a second
   *  contact (a finger landing while the Pencil holds a key) would settle someone else's gesture. */
  function settleKeyDrag(e?: PointerEvent) {
    if (e && keyDrag && e.pointerId !== keyDrag.pointerId) return;
    const d = keyDrag;
    keyDrag = null;
    removeKeyDragListeners();
    stopEdgeScroll("key");
    // Only release the shared hook if this drag still owns it, matching resetRowDrag's idiom —
    // clearing another gesture's settle would leave that one unable to close its bracket.
    if (transformDragGuard.settle === settleKeyDrag) transformDragGuard.settle = null;
    if (!d) return;
    if (d.cur === d.from) {
      // Nothing moved: put the grab-time track back and push nothing, so a tap on a key is not an
      // undo entry that does nothing. A tap SEEKS to the key instead — which is also how a key is
      // deleted, since ToolOptions' "Delete key" acts on the key under the playhead. Two taps, no
      // new gesture, and it works with a Pencil where a hover-only ✕ would not.
      // Into a FRESH bag, so putting the frozen track back cannot clobber a sibling track.
      d.spec.setTrack(d.prevTrack);
      // Select the key's OWNER as well as seeking. "Delete key" acts on the ACTIVE target's key at
      // the playhead, so tapping a key on some other row would otherwise arm the button against a
      // different owner's key at the same frame — deleting the one you did not tap.
      d.spec.select();
      seekPlayhead(d.from);
      return; // no bump(): nothing changed, and bumping re-arms a full autosave re-encode
    }
    if (d.undo) commitStructuralEdit(d.undo); // null only on the read-only path, which never writes
  }

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
      // Measured around the write rather than from the pointer: setHoldSpan clamps the span and
      // no-ops when nothing changes, so the actual splice is the difference between these two.
      const spanBefore = holdSpanEnd(layer, dragKey);
      setHoldSpan(layer, dragKey, Math.max(1, dragLastBoundary - dragKey));
      shiftKeysForSplice(layer, spanBefore, holdSpanEnd(layer, dragKey));
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
    if (dragMode === "resize" && dragUndo) {
      // Same reasoning as rowUp's resize branch: a net-zero resize can still have destroyed a
      // transform key by collision, so restore rather than drop.
      if (dragLastBoundary !== dragStartBoundary) commitStructuralEdit(dragUndo);
      else revertStructural(dragUndo);
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
      // Out-and-back is NOT lossless any more. While this drag only spliced holds, dropping the
      // snapshot on an equal boundary was safe — a hold removed and re-added is the same hold. Now
      // it also shifts the layer's TRANSFORM KEYS, and a shrink that collides two keys keeps only
      // the later one: dragging left then back destroys the earlier key permanently, with nothing
      // pushed for ⌘Z to pop. So abandon by RESTORING the grab-time snapshot, never by re-applying
      // or by walking away — the same rule the ruler's length drag had to learn.
      if (dragLastBoundary !== dragStartBoundary) commitStructuralEdit(dragUndo);
      else revertStructural(dragUndo);
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
  /** Shift the layer's own transform keys for a splice that turned boundary `before` into `after`.
   *  `shiftLayerTrackKeys` moves by ONE frame, so a multi-frame hold-span resize repeats it:
   *  growing inserts `after - before` frames at `before`, shrinking removes them from `after`. */
  function shiftKeysForSplice(l: DrawingLayer, before: number, after: number) {
    for (let i = 0; i < after - before; i++) shiftLayerTrackKeys(l, before, 1);
    for (let i = 0; i < before - after; i++) shiftLayerTrackKeys(l, after, -1);
  }
  function frameTool() {
    // Document-wide, same as growing the global length: a hold on every drawing layer so every
    // row keeps a dash, plus refs/audio so clips stay lined up. Not gated on the active layer —
    // skipping a locked row would break the alignment. Insert AFTER the playhead (the current
    // drawing stays put). Short layers are padded up to that column first.
    liftGuard.discard?.();
    const at = appState.playhead + 1;
    commitStructural(() => {
      insertFrameAllLayers(appState.project, at);
      appState.playhead += 1;
    });
  }
  function deleteTool() {
    if (appState.project.frameCount <= 1) return; // never leave a project with no frames
    liftGuard.discard?.();
    commitStructural(() => deleteFrameAllLayers(appState.project, appState.playhead));
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

  // Follows `activeRow` (+ the layer/group arrays) so the animation tool group re-renders with
  // focus. Deliberately NOT the playhead: nothing the bar OFFERS depends on the frame — the one
  // reason that did (a reference outside its visible range) went with references becoming
  // unanimatable — and a per-frame dependency would re-derive it on every scrub tick.
  const animBar = $derived(
    animationBar({
      activeRow: appState.activeRow,
      layers: appState.project.layers,
      groups: appState.project.groups,
    }),
  );
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
  <!-- 8px hit strip with a VISIBLE BAR and no background tint — deliberately the opposite of the
       two vertical grips, which are bare edges with a tint. Two reasons, both recorded in CLAUDE.md
       and neither retracted since. (1) This is an INTERIOR divider between the canvas and the
       timeline: nothing about its position says "drag me", where a panel's outer edge is a learned
       convention that needs no badge. (2) Hover does not exist on iPad, so a tint-only grip has NO
       affordance on the device this app is for — the bar is the one that survives. The tint is also
       area-sensitive: the same `bg-text/10` that is a subtle sliver on an 8px vertical edge is a
       loud full-width band here. The hit area is 8px either way; the bar is what made this one look
       bigger. -->
  <!-- BARE top edge, matching the layer-panel grip: 8px hit, 4px hover tint on the divider, no
       badge. This supersedes the older "interior dividers keep a visual bar" rule — see the
       2026-08-20 note in CLAUDE.md. The timeline reads as a PANEL now, not as a divider inside one,
       and the app should not carry two different resize affordances. -->
  <div
    class="group absolute inset-x-0 top-0 z-30 h-2 cursor-row-resize"
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
    <div class="absolute inset-x-0 top-0 h-1 group-hover:bg-text/10"></div>
  </div>
  <!-- WRAPS, never scrolls. `overflow-x-auto` here is silently fatal: per CSS Overflow 3 a computed
       `overflow-x: auto` forces `overflow-y` from `visible` to `auto`, so the bar becomes a ~28px
       scroll box — and its three settings popovers are `absolute bottom-full`, i.e. entirely ABOVE
       that box. Overflow past a scroller's START edge is neither painted nor scrollable to, so the
       onion, boil and playback gears open panels nobody can see, on every device. Onion and boil
       params have no other route. This is the same trap `.curve-popup` was made `position: fixed`
       for (2026-07-12). Wrapping to a second line costs nothing and keeps every control reachable
       in portrait, where the merged bar overruns the viewport by ~200px. -->
  <div class="mb-2 flex shrink-0 flex-wrap items-center gap-1 *:shrink-0">
    <Playbar />
    <span class="mx-3 h-5 w-px bg-border"></span>
    <!-- Add/Delete are document-wide (every drawing layer + clips), so they stay up on a
         property row. Clear blanks THIS layer's key, so it only ACTS on a drawing row — but it
         dims there rather than disappearing. Hiding it slid the destructive
         "Delete frame (all layers)" ~32px left into the slot the finger had just learned, so the
         next tap aimed at Clear removed a frame column from every drawing layer; positions must
         not shift. It is also the only thing that says clearing needs a drawing layer, and a title
         can only be read (hover, or an iPad tap via the status bar) from a control that still
         dispatches pointer events — hence `aria-disabled`, never `disabled` and never absent. -->
    <button class={toolBtn} title="Add frame (after current, all layers)" onclick={frameTool}
      ><Plus size={16} /></button
    >
    <button
      class={`${toolBtn} aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent`}
      aria-disabled={!drawingRowSelected}
      title={drawingRowSelected
        ? "Clear frame (blank this keyframe)"
        : "Clear frame — select a drawing layer"}
      onclick={() => {
        if (!drawingRowSelected) return;
        clearFrame();
      }}><Diamond size={16} /></button
    >
    {#if !selRect}
      <button class={toolBtn} title="Delete frame (all layers)" onclick={deleteTool}
        ><Trash2 size={16} /></button
      >
    {/if}

    <!-- Animation tools: follow the selected row (layer → Animate icons; track → key tools + Stop).
         Sit with the other per-row tools. Does not switch the tool. -->
    {#if animBar.kind !== "empty"}
      <span class="mx-3 h-5 w-px bg-border"></span>
    {/if}
    {#if animBar.kind === "start"}
      {#each animBar.items as item (item.action)}
        {@const groupName =
          item.action === "animate-group" || item.action === "animate-group-opacity"
            ? (appState.project.groups.find((x) => x.id === item.groupId)?.name ?? "group")
            : ""}
        <button
          class={`${toolBtn} aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent`}
          aria-disabled={item.blocked !== null}
          title={item.action === "animate-transform"
            ? item.blocked
              ? `Animate transform — ${item.blocked}`
              : "Animate this layer's transform — its current position becomes a key at frame 0"
            : item.action === "animate-opacity"
              ? item.blocked
                ? `Animate opacity — ${item.blocked}`
                : "Animate opacity — the current value becomes a key at frame 0"
              : item.action === "animate-group-opacity"
                ? item.blocked
                  ? `Animate group opacity — ${item.blocked}`
                  : `Animate group opacity — ${groupName}`
                : item.blocked
                  ? `Animate group — ${item.blocked}`
                  : "Animate this group's transform — its current position becomes a key at frame 0"}
          onclick={() => {
            if (item.blocked) return;
            if (item.action === "animate-transform") animateLayer(item.layerId);
            else if (item.action === "animate-opacity") animateLayerOpacity(item.layerId);
            else if (item.action === "animate-group-opacity") animateGroupOpacity(item.groupId);
            else animateGroup(item.groupId);
          }}
        >
          {#if item.action === "animate-transform"}<Spline size={16} />
          {:else if item.action === "animate-opacity" || item.action === "animate-group-opacity"}
            <Blend size={16} />
          {:else}<Group size={16} />{/if}
        </button>
      {/each}
    {:else if animBar.kind === "keys"}
      <TrackKeyControls trackRef={animBar.track} blocked={animBar.blocked} />
      <button
        class={`${toolBtn} aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent`}
        aria-disabled={animBar.blocked !== null}
        title={animBar.blocked
          ? `Stop animating — ${animBar.blocked}`
          : "Stop animating — keeps the value you can see now"}
        onclick={() => {
          if (animBar.blocked) return;
          const t = animBar.track;
          if (t.owner === "group" && t.prop === "opacity") removeGroupOpacityAnimation(t.id);
          else if (t.owner === "group") removeGroupAnimation(t.id);
          else if (t.prop === "opacity") removeLayerOpacityAnimation(t.id);
          else removeLayerAnimation(t.id);
        }}><CircleStop size={16} /></button
      >
    {/if}

    <!-- Dimmed, not hidden. The disabled title is the ONLY thing in the app that names this
         capability or says how to reach it, and on iPad a tap on the button is the only way to
         read it — hiding the pair made the feature undiscoverable to anyone who had never happened
         to select the audio lane, a reference row, or a video clip. -->
    <span class="mx-3 h-5 w-px bg-border"></span>
    <button
      class={`${toolBtn} aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent`}
      aria-disabled={!trimTarget}
      title={trimTarget
        ? `Trim ${trimTarget.label} start to the playhead`
        : "Trim start to the playhead — select the audio lane, an image reference layer, or a video reference layer first"}
      onclick={() => {
        if (!trimTarget) return;
        trimToPlayhead("start");
      }}><ArrowRightToLine size={16} /></button
    >
    <button
      class={`${toolBtn} aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent`}
      aria-disabled={!trimTarget}
      title={trimTarget
        ? `Trim ${trimTarget.label} end to the playhead`
        : "Trim end to the playhead — select the audio lane, an image reference layer, or a video reference layer first"}
      onclick={() => {
        if (!trimTarget) return;
        trimToPlayhead("end");
      }}><ArrowLeftToLine size={16} /></button
    >

    <span class="ml-auto"></span>

    <!-- onion skin (how you SEE the sheet — sits with boil and fps, not with Add/Delete) -->
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
          class="absolute right-0 bottom-full mb-2 z-30 w-56 p-3 rounded-lg bg-surface border border-border shadow-md flex flex-col gap-2 text-xs"
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
            class:opacity-40={!onionKeysOk}
            title={onionKeysOk
              ? "Onion: step to neighbouring keyframes instead of frames — holds don't use up a ghost"
              : "Step by keyframes — the active layer has no keyframes (pick a drawing layer)"}
          >
            <input
              type="checkbox"
              checked={appState.onion.byKeyframes}
              aria-disabled={!onionKeysOk}
              onchange={(e) => {
                if (!onionKeysOk) {
                  e.currentTarget.checked = !!appState.onion.byKeyframes;
                  return;
                }
                appState.onion.byKeyframes = e.currentTarget.checked;
                repaint();
              }}
            />
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

    <span class="mx-3 h-5 w-px bg-border"></span>

    <!-- line boil -->
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
          class="absolute right-0 bottom-full mb-2 z-30 w-56 p-3 rounded-lg bg-surface border border-border shadow-md flex flex-col gap-2 text-xs"
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

    <span class="mx-3 h-5 w-px bg-border"></span>
    <Playbar variant="settings" />
  </div>

  <!-- aligned grid: ruler + layer rows share one column geometry; a single playhead line spans them -->
  <!-- `overscroll-contain`: reaching either end must not hand the scroll to an ancestor. Chaining is
       what lets iOS decide the gesture belongs to the page and fire `pointercancel` at us mid-pan,
       which both aborts the custom pan and (correctly) suppresses its fling. -->
  <div class="relative flex-1 min-h-0 overflow-auto overscroll-contain" bind:this={gridWrapper}>
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
             the frames it measures; absolutely positioned so it adds no column.
             z-10 like the playhead badge beside it: the ruler's own sticky gutter spacer is z-20 and
             comes EARLIER in the DOM, so at equal z this handle would win and paint over the spacer
             once the animation's end is scrolled behind it. -->
        <div
          class="absolute inset-y-0 z-10 w-2 cursor-ew-resize hover:bg-text/10"
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
      didPan={() => panEndedWithMovement}
    />

    <!-- layer rows (top layer first) -->
    {#each timelineRows(buildSegments(appState.project.layers, appState.project.groups)) as row (row.kind === "layer" ? `l${row.layer.id}` : row.kind === "track" ? `t${row.layer.id}:${row.prop}` : row.kind === "grouptrack" ? `gt${row.group.id}:${row.prop}` : `g${row.group.id}`)}
      {#if row.kind === "group"}
        {@const g = row.group}
        {@const groupAnimated = isGroupAnimated(g)}
        {@const showTrackFold = groupAnimated && !g.collapsed}
        {@const groupLit = groupHeaderSelected(appState.activeRow, g, appState.project.layers)}
        <!-- A group row. It carries NO `data-layer-id`, which is what keeps it out of the selection
             axis for free: `layerIdAtPoint`, the marquee and every block op resolve rows through
             that attribute, and a group holds no cells to select. The frame strip is empty for now
             and is where a transform track would live. -->
        <div class="flex w-max items-center" style="min-width: {stripMinW}px">
          <div
            class="shrink-0 sticky left-0 z-20 flex h-6 items-center gap-1 px-1 hover:bg-surface-hover"
            class:bg-surface={!groupLit}
            class:bg-surface-active={groupLit}
            class:text-text={groupLit}
            class:text-text-secondary={!groupLit}
            style="width: {showTrackFold ? LABEL_W - DISCLOSE_W : LABEL_W}px; touch-action: none"
            role="presentation"
            onpointerdown={(e) => {
              if (isFinePointer(e)) return;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              touchPanDown(e);
            }}
            onpointermove={(e) => {
              if (!isFinePointer(e) && touchPan) touchPanMove(e);
            }}
            onpointerup={(e) => {
              if (!isFinePointer(e)) touchPanUp(e);
            }}
            onpointercancel={(e) => {
              if (!isFinePointer(e)) touchPanUp(e);
            }}
          >
            <button
              class="flex w-3.5 shrink-0 justify-center"
              title={g.collapsed ? "Expand group" : "Collapse group"}
              onclick={() => {
                if (!panEndedWithMovement) toggleGroupCollapsed(g.id);
              }}
            >
              {#if g.collapsed}<ChevronRight size={13} />{:else}<ChevronDown size={13} />{/if}
            </button>
            <button
              class="min-w-0 flex-1 truncate text-left font-semibold"
              title="Select group"
              onclick={() => {
                if (!panEndedWithMovement) selectGroup(g.id);
              }}>{g.name}</button
            >
            {#if groupAnimated && !showTrackFold}
              <!-- Group is folded: property rows are gone with the members, so the Spline lives
                   on the header the same way a collapsed group's animation used to. -->
              <span class="shrink-0 text-text-secondary" title="Group is animated"
                ><Spline size={11} /></span
              >
            {/if}
            {#if row.hiddenCount > 0}
              <!-- Says the content is still there. Collapsing used to remove it from the timeline
                   with nothing left to indicate it existed. -->
              <span class="shrink-0 text-text-muted">{row.hiddenCount}</span>
            {/if}
          </div>
          {#if showTrackFold}
            <button
              class="shrink-0 sticky z-20 flex h-6 items-center justify-center gap-0.5 bg-surface text-text-secondary hover:text-text hover:bg-surface-hover"
              style="left: {LABEL_W - DISCLOSE_W}px; width: {DISCLOSE_W}px; touch-action: none"
              title={g.tracksCollapsed
                ? "Show this group's animation rows"
                : "Hide this group's animation rows"}
              onpointerdown={(e) => {
                if (isFinePointer(e)) return;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                touchPanDown(e);
              }}
              onpointermove={(e) => {
                if (!isFinePointer(e) && touchPan) touchPanMove(e);
              }}
              onpointerup={(e) => {
                if (!isFinePointer(e)) touchPanUp(e);
              }}
              onpointercancel={(e) => {
                if (!isFinePointer(e)) touchPanUp(e);
              }}
              onclick={() => {
                if (!panEndedWithMovement) toggleGroupTracksCollapsed(g.id);
              }}
            >
              <Spline size={11} />
              {#if g.tracksCollapsed}<ChevronRight size={13} />{:else}<ChevronDown size={13} />{/if}
            </button>
          {/if}
          <span
            class="sticky z-20 shrink-0 flex items-center justify-center h-6 text-amber-500 bg-surface border-r border-text-muted"
            role="presentation"
            style="left: {LABEL_W}px; width: {MARKER_W}px"
            title={g.locked ? "Group locked — edits refused" : !g.visible ? "Group hidden" : ""}
          >
            {#if g.locked}<Lock size={11} />{:else if !g.visible}<EyeOff size={11} />{/if}
          </span>
        </div>
      {:else if row.kind === "track" || row.kind === "grouptrack"}
        <!-- One row per ANIMATED PROPERTY — layer transform/opacity or group transform/opacity.
             All four share this markup through a `TrackRowSpec`, because a per-property copy is
             how two rows come to answer the same question differently. Like the group row it
             carries NO `data-layer-id`: `layerIdAtPoint`, the marquee and every block op resolve
             rows through that attribute, and a track holds no cells, so there is nothing on it to
             select. A marquee dragged ACROSS one still spans the layers either side, through the
             existing nearest-row fallback. -->
        {@const spec =
          row.kind === "track"
            ? layerTrackSpec(row.layer, row.prop)
            : groupTrackSpec(row.group, row.prop)}
        {#if spec}
          <!-- Clamped to the strip: shortening the animation does not move keys, and an
               absolutely-positioned dot past the last frame would draw over the ruler's end and add
               scrollWidth. They are hidden, not deleted — lengthen the animation and they return. -->
          {@const trackKeys = spec.track.keys}
          {@const keys = trackKeys.filter((k) => k.frame < appState.project.frameCount)}
          {@const stripW = appState.project.frameCount * CELL_W}
          <!-- Segments are built from the UNFILTERED keys and CLIPPED at the strip's edge. A key past
               the animation's end is hidden but still DRIVES the motion — it remains the track's last
               key, so every earlier frame interpolates toward it — and drawing only between visible
               keys left a lone marker with no line while the canvas was visibly moving. -->
          {@const segments = trackKeys.slice(0, -1).flatMap((k, i) => {
            const x = k.frame * CELL_W + CELL_W / 2;
            if (x >= stripW) return [];
            const end = Math.min(trackKeys[i + 1].frame * CELL_W + CELL_W / 2, stripW);
            return [{ frame: k.frame, x, w: end - x, held: (k.interp ?? "linear") === "hold" }];
          })}
          {@const readOnly = spec.readOnly}
          <div class="flex w-max items-center" style="min-width: {stripMinW}px">
            <!-- Selecting the track focuses that track row (`activeRow.kind === "track"`) and aims
                 Transform scope at it — without switching the TOOL, so glancing at a track mid-
                 brush does not yank you out of drawing. A layer-owned track also lights its
                 owner via `isRowSelected`; a group track does not light a member. -->
            <button
              class="shrink-0 sticky left-0 z-20 flex h-6 items-center gap-1 px-1 text-left hover:bg-surface-hover"
              class:pl-4={spec.indent}
              class:bg-surface={!spec.selected}
              class:bg-surface-active={spec.selected}
              class:text-text-secondary={spec.selected}
              class:text-text-muted={!spec.selected}
              style="width: {LABEL_W}px; touch-action: none"
              title="{spec.label} keys for {spec.owner} — select it and {spec.prop === 'transform'
                ? 'aim the Transform tool at it'
                : 'move its opacity slider to key a change'}"
              onpointerdown={(e) => {
                if (isFinePointer(e)) return;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                touchPanDown(e);
              }}
              onpointermove={(e) => {
                if (!isFinePointer(e) && touchPan) touchPanMove(e);
              }}
              onpointerup={(e) => {
                if (!isFinePointer(e)) touchPanUp(e);
              }}
              onpointercancel={(e) => {
                if (!isFinePointer(e)) touchPanUp(e);
              }}
              onclick={() => {
                if (panEndedWithMovement) return; // a finger scroll that happened to end here
                spec.select();
              }}
            >
              <!-- Empty type slot, exactly as the layer rows reserve one. Without it this row's name
                   starts 18px left of its owner's (the glyph's width plus the gap) and reads as a
                   sibling rather than as something belonging to the row above. The indent itself
                   also mirrors the owner, so a grouped layer's track sits with it. -->
              <span class="flex w-3.5 shrink-0" role="presentation"></span>
              <span class="min-w-0 flex-1 truncate">{spec.label}</span></button
            >
            <!-- The same read-only marker its owner's row carries. Without it a locked owner's track
                 row was the one place that refused an edit while showing no reason, directly under a
                 row displaying the amber padlock. -->
            <span
              class="sticky z-20 shrink-0 flex items-center justify-center h-6 bg-surface text-amber-500 border-r border-text-muted"
              role="presentation"
              style="left: {LABEL_W}px; width: {MARKER_W}px; touch-action: none"
              onpointerdown={(e) => {
                if (isFinePointer(e)) return;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                touchPanDown(e);
              }}
              onpointermove={(e) => {
                if (!isFinePointer(e) && touchPan) touchPanMove(e);
              }}
              onpointerup={(e) => {
                if (!isFinePointer(e)) touchPanUp(e);
              }}
              onpointercancel={(e) => {
                if (!isFinePointer(e)) touchPanUp(e);
              }}
              title={spec.block === "locked"
                ? `${spec.owner} is locked — keys cannot be retimed`
                : spec.block === "hidden"
                  ? `${spec.owner} is hidden — keys cannot be retimed`
                  : ""}
            >
              {#if spec.block === "locked"}<Lock
                  size={11}
                />{:else if spec.block === "hidden"}<EyeOff size={11} />{/if}
            </span>
            <!-- The keys and the line between them are ABSOLUTE, over an empty cell grid. Drawing a
                 per-cell glyph the way the layer rows do cannot produce an unbroken line: every cell
                 carries its own 1px border, so adjacent segments never meet. Absolute positioning
                 also makes a key a real hit target for dragging it to another frame. -->
            <div
              class="relative flex select-none"
              style="touch-action: none"
              role="presentation"
              onpointerdown={(e) => {
                if (!isFinePointer(e)) {
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  touchPanDown(e);
                  return;
                }
                // A key marker is a DOM CHILD of this strip and deliberately does not
                // stopPropagation, so its own keyDown runs first and this bubbled call must bail —
                // the parent-bails-on-child-state shape (see rangeDown), never stopPropagation,
                // which would suppress the window-level status-hint listener.
                if (keyDrag) return;
                // Otherwise a pen/mouse press on the empty part of the row does what the row's own
                // label does. It used to return here and be a dead zone.
                spec.select();
              }}
              onpointermove={(e) => {
                // Route on the POINTER TYPE, not on "is a pan in flight": a Pencil dragging a key
                // bubbles here, and panning against a resting finger's origin flung the timeline.
                if (!isFinePointer(e) && touchPan) touchPanMove(e);
              }}
              onpointerup={(e) => {
                if (!isFinePointer(e)) touchPanUp(e);
              }}
              onpointercancel={(e) => {
                if (!isFinePointer(e)) touchPanUp(e);
              }}
            >
              {#each Array(appState.project.frameCount) as _, f (f)}
                <div class="box-border h-6 border border-border" style="width: {CELL_W}px"></div>
              {/each}
              <!-- One line PER SEGMENT: SOLID where the value interpolates, DASHED where it holds —
                   the same distinction the layer rows already draw, because it is the same fact. A
                   drawing hold repeats one drawing across those frames; a property hold repeats one
                   value. So the timeline has two marks meaning two things, not three. -->
              {#each segments as s (s.frame)}
                <div
                  class="pointer-events-none absolute top-1/2 -translate-y-1/2"
                  class:h-px={!s.held}
                  class:bg-selection={!s.held}
                  class:border-t={s.held}
                  class:border-dashed={s.held}
                  class:border-selection={s.held}
                  style="left: {s.x}px; width: {s.w}px"
                ></div>
              {/each}
              {#each keys as k (k.frame)}
                <!-- Selection-coloured, against the layer rows' white ◆ — distinct in both shape and
                     colour, because a property key and a drawing key are only ever confusable at a
                     glance. The SHAPE then says how the segment leaving this key behaves, so the
                     timing is readable without selecting anything: square = hold (blocky, stepped),
                     circle = eased (round, curved), diamond = linear. Ease-in and ease-out share the
                     circle — at 8px a half-filled disc is a smudge, and the Ease control names which.
                     The hit area is deliberately larger than the mark: 8px is a fine target with a
                     Pencil and an impossible one with anything else. -->
                {@const ki = k.interp ?? "linear"}
                <div
                  class="absolute top-0 flex h-6 w-4 items-center justify-center"
                  style="left: {k.frame * CELL_W +
                    CELL_W / 2 -
                    8}px; touch-action: none; cursor: {readOnly ? 'default' : 'ew-resize'}"
                  role="presentation"
                  title="{spec.label} key for {spec.owner} at frame {k.frame + 1} ({INTERP_LABEL[
                    ki
                  ]}){readOnly ? '' : ' — drag to retime'}"
                  onpointerdown={(e) => keyDown(e, spec, k.frame)}
                  onpointermove={(e) => {
                    if (!isFinePointer(e) && touchPan) touchPanMove(e);
                  }}
                  onpointerup={(e) => {
                    if (!isFinePointer(e)) touchPanUp(e);
                  }}
                  onpointercancel={(e) => {
                    if (!isFinePointer(e)) touchPanUp(e);
                  }}
                >
                  <div
                    class="size-2 bg-selection"
                    class:rounded-full={ki !== "hold" && ki !== "linear"}
                    class:rotate-45={ki === "linear"}
                  ></div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {:else}
        {@const layer = row.layer}
        {@const animated = isLayerAnimated(layer)}
        <div class="flex w-max items-center" style="min-width: {stripMinW}px">
          <button
            class="shrink-0 sticky left-0 z-20 flex h-6 items-center gap-1 px-1 text-left hover:bg-surface-hover"
            class:pl-4={layer.groupId != null}
            class:bg-surface={!isRowSelected(layer.id)}
            class:bg-surface-active={isRowSelected(layer.id)}
            class:text-text={isRowSelected(layer.id)}
            class:text-text-secondary={!isRowSelected(layer.id)}
            style="width: {animated ? LABEL_W - DISCLOSE_W : LABEL_W}px; touch-action: none"
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
                 — and the audio lane, which uses the same px-1/gap-1 — starts its name at one x.
                 A GROUP MEMBER is the one deliberate exception: `pl-4` above lands it at the same
                 POSITION the panel uses, 16px, because with group rows now present an un-indented
                 member reads as the group's SIBLING. The two surfaces get there with different
                 classes — the panel's `.group-members pl-3` (12px) sits on top of the list's own
                 `pl-1` (4px), where this row has no list padding under it — so compare the resulting
                 offset, never the class value. The marker column is a separate sticky element pinned
                 at LABEL_W, so it stays aligned regardless. -->
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
          {#if animated}
            <!-- Disclosure for this layer's property rows. The SAME chevron the group header draws,
                 for the same job, so the timeline has one collapse idiom rather than two — but a
                 separate button, because the name button already selects the layer and a button
                 cannot nest inside a button. It eats into the NAME column rather than adding to the
                 gutter, so the marker column, the frame cells and every other row stay aligned; only
                 an animated layer pays for it. The Spline glyph is what still says "animated" when
                 the rows are folded away. -->
            <button
              class="shrink-0 sticky z-20 flex h-6 items-center justify-center gap-0.5 text-text-secondary hover:text-text hover:bg-surface-hover"
              class:bg-surface={!isRowSelected(layer.id)}
              class:bg-surface-active={isRowSelected(layer.id)}
              style="left: {LABEL_W - DISCLOSE_W}px; width: {DISCLOSE_W}px; touch-action: none"
              title={layer.tracksCollapsed
                ? "Show this layer's animation rows"
                : "Hide this layer's animation rows"}
              onpointerdown={(e) => {
                if (isFinePointer(e)) return;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                touchPanDown(e);
              }}
              onpointermove={(e) => {
                if (!isFinePointer(e) && touchPan) touchPanMove(e);
              }}
              onpointerup={(e) => {
                if (!isFinePointer(e)) touchPanUp(e);
              }}
              onpointercancel={(e) => {
                if (!isFinePointer(e)) touchPanUp(e);
              }}
              onclick={() => {
                if (!panEndedWithMovement) toggleTracksCollapsed(layer.id);
              }}
            >
              <Spline size={11} />
              {#if layer.tracksCollapsed}<ChevronRight size={13} />{:else}<ChevronDown
                  size={13}
                />{/if}
            </button>
          {/if}
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
              {@const dur = ref.media.el.duration}
              {@const trim = {
                trimInFrames: ref.trimInFrames,
                trimLenFrames: ref.trimLenFrames,
              }}
              {@const full = videoClipLayout(
                videoClipOriginOffset(ref.offsetFrames, ref.trimInFrames),
                ref.speed,
                dur,
                appState.project.fps,
              )}
              {@const kept = videoClipLayout(
                ref.offsetFrames,
                ref.speed,
                dur,
                appState.project.fps,
                trim,
              )}
              {@const keptLeft = (kept.startFrame - full.startFrame) * CELL_W}
              {@const tailFrames = Math.max(
                0,
                full.startFrame + full.spanFrames - appState.project.frameCount,
              )}
              <div
                class="relative box-border h-6 overflow-hidden text-xs/6 text-text"
                class:opacity-70={!isRowSelected(ref.id)}
                style="touch-action: none; margin-left: {full.startFrame *
                  CELL_W}px; width: {full.spanFrames * CELL_W}px"
                role="presentation"
              >
                <!-- Trimmed-away source, dimmed so you can drag a handle back to recover it. -->
                <div class="pointer-events-none absolute inset-0 bg-media-clip-dim"></div>
                <div
                  class="absolute inset-y-0 box-border cursor-grab overflow-hidden border border-media-clip-border bg-media-clip"
                  style="left: {keptLeft}px; width: {kept.spanFrames *
                    CELL_W}px; touch-action: none"
                  role="presentation"
                  title="Drag to offset the video"
                  onpointerdown={(e) => clipDown(e, ref)}
                  onpointermove={clipMove}
                  onpointerup={clipUp}
                  onpointercancel={clipUp}
                >
                  <!-- px-2.5 clears the 8px trim handles so a long name cannot slide under a grip. -->
                  <span class="relative z-10 block truncate px-2.5">{ref.name}</span>
                </div>
                {#if tailFrames > 0}
                  <div
                    class="pointer-events-none absolute inset-y-0 right-0 bg-media-clip-dim"
                    style="width: {tailFrames * CELL_W}px"
                  ></div>
                {/if}
                <!-- Grips are the ONLY marking: cursor-ew-resize does nothing on iPad. z-10 so
                     they slide UNDER the sticky gutter (z-20), same as the image-range handles. -->
                <div
                  class="absolute inset-y-0 z-10 flex w-2 cursor-ew-resize items-center justify-center gap-px"
                  style="left: {keptLeft}px; touch-action: none"
                  role="presentation"
                  title="Trim the start of the video"
                  onpointerdown={(e) => videoTrimDown(e, ref, "head")}
                  onpointermove={videoTrimMove}
                  onpointerup={videoTrimUp}
                  onpointercancel={videoTrimUp}
                >
                  <span class="pointer-events-none h-3 w-px bg-text-muted"></span>
                  <span class="pointer-events-none h-3 w-px bg-text-muted"></span>
                </div>
                <div
                  class="absolute inset-y-0 z-10 flex w-2 cursor-ew-resize items-center justify-center gap-px"
                  style="left: {keptLeft + kept.spanFrames * CELL_W - 8}px; touch-action: none"
                  role="presentation"
                  title="Trim the end of the video"
                  onpointerdown={(e) => videoTrimDown(e, ref, "tail")}
                  onpointermove={videoTrimMove}
                  onpointerup={videoTrimUp}
                  onpointercancel={videoTrimUp}
                >
                  <span class="pointer-events-none h-3 w-px bg-text-muted"></span>
                  <span class="pointer-events-none h-3 w-px bg-text-muted"></span>
                </div>
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
                     bars are pointer-events-none so the handle div stays the event target.
                     z-10, NOT z-20: at z-20 they tied with the sticky gutter label, and equal z plus
                     later DOM order wins — so a handle scrolled behind the gutter painted OVER the
                     layer names instead of sliding under them. z-10 still beats the clip's own label
                     (also z-10, but earlier in the DOM), so a long name cannot cover a grip. Same
                     mistake the audio trim handles made; see AudioLane. -->
                <div
                  class="absolute inset-y-0 left-0 z-10 flex w-2 cursor-ew-resize items-center justify-center gap-px"
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
                  class="absolute inset-y-0 right-0 z-10 flex w-2 cursor-ew-resize items-center justify-center gap-px"
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
