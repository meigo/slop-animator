<script lang="ts">
  import {
    Plus,
    Diamond,
    DiamondPlus,
    Copy,
    Minus,
    Trash2,
    Layers,
    Waves,
    Settings,
  } from "@lucide/svelte";
  import {
    state as appState,
    canvasOps,
    activeLayer,
    bump,
    history,
    commitStructural,
    beginStructuralEdit,
    commitStructuralEdit,
    setActiveLayer,
    liftGuard,
    setTimelineSelection,
    moveTimelineSelection,
    clearTimelineSelection,
    type StructSnapshot,
  } from "../state/appState.svelte";
  import {
    addFrame,
    insertKeyframe,
    duplicateKeyframe,
    setHold,
    deleteFrame,
    ensureDrawableKeyframe,
    setHoldSpan,
  } from "../anim/timeline";
  import { resolveSelectionRect } from "../anim/timeline-selection";
  import { clampTimelineHeight } from "../anim/timeline-layout";
  import { groupOf, type DrawingLayer } from "../anim/document";
  import { effectiveRange } from "../anim/playback";
  import { columnAtX, planCellPointer } from "./timeline-grid";
  import { isCellEmpty } from "./cell-ink";
  import { computeTimelineGlyphs } from "./timeline-glyphs";
  import { clickOutside } from "./click-outside";
  import AudioLane from "./AudioLane.svelte";
  import TimelineSelectionBar from "./TimelineSelectionBar.svelte";

  const CELL_W = 24; // px, fixed column width (box-border cells, no gap → contiguous columns)
  const LABEL_W = 80; // px, layer-name gutter

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

  function go(f: number) {
    appState.playhead = Math.max(0, Math.min(appState.project.frameCount - 1, f));
  }

  // Draggable playhead: pointer-drag anywhere on the ruler scrubs the current frame.
  // Pointer capture keeps the drag alive outside the element; touch-action:none stops
  // the browser from panning/zooming the page while scrubbing (needed on iPad).
  let scrubbing = $state(false);
  let boilSettingsOpen = $state(false);
  function scrubTo(e: PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    go(columnAtX(e.clientX - rect.left, CELL_W, appState.project.frameCount));
  }
  function rulerDown(e: PointerEvent) {
    scrubbing = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrubTo(e);
  }
  function rulerMove(e: PointerEvent) {
    if (scrubbing) scrubTo(e);
  }
  function rulerUp(e: PointerEvent) {
    scrubbing = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }
  function rulerKey(e: KeyboardEvent) {
    if (e.key === "ArrowLeft") go(appState.playhead - 1);
    else if (e.key === "ArrowRight") go(appState.playhead + 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(appState.project.frameCount - 1);
    else return;
    e.preventDefault();
  }

  // Draggable playhead line: grab the line in the track body to scrub (body no longer scrubs on
  // empty cells). Maps clientX to a column against the scrolling grid wrapper.
  let lineScrubbing = false;
  function lineScrubTo(e: PointerEvent) {
    const wrap = gridWrapper;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left + wrap.scrollLeft - LABEL_W;
    go(columnAtX(x, CELL_W, appState.project.frameCount));
  }
  function lineDown(e: PointerEvent) {
    lineScrubbing = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    lineScrubTo(e);
  }
  function lineMove(e: PointerEvent) {
    if (lineScrubbing) lineScrubTo(e);
  }
  function lineUp(e: PointerEvent) {
    lineScrubbing = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
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
  // Keep the panel within 60% of the viewport if the window shrinks.
  function onWindowResize() {
    appState.timelineHeight = clampTimelineHeight(appState.timelineHeight, window.innerHeight);
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

  // moveblock: the grabbed key's frame and the live (clamped) frame offset for the ghost.
  let moveGrabFrame = -1;
  let moveDelta = $state(0);
  // empty-press arming: might become a marquee (on drag) or a deselect (on tap).
  let armedEmpty = false;
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
        )
      : null,
  );

  function inSelection(layerId: number, f: number): boolean {
    if (!selRect) return false;
    const shift = dragMode === "moveblock" ? moveDelta : 0; // slide the highlight to the drop target
    return (
      selRect.layerIds.includes(layerId) &&
      f >= selRect.startFrame + shift &&
      f <= selRect.endFrame + shift
    );
  }

  /** Which drawing-layer row the pointer is physically over (pointer capture routes all moves to the
   *  origin row, so hit-test by client coords to allow vertical cross-layer selection). */
  function layerIdAtPoint(clientX: number, clientY: number, fallback: number): number {
    const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-layer-id]");
    return el ? Number(el.dataset.layerId) : fallback;
  }

  function rowOffset(e: PointerEvent): number {
    return e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left;
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

  function rowDown(e: PointerEvent, layer: DrawingLayer) {
    setActiveLayer(layer.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragLayerId = layer.id;
    const frame = rowColumn(e);
    pressStartX = e.clientX;
    pressStartY = e.clientY;

    // Shift/Ctrl-click extends an existing selection immediately (desktop).
    if ((e.shiftKey || e.ctrlKey || e.metaKey) && appState.timelineSelection) {
      setTimelineSelection(appState.timelineSelection.anchor, { layerId: layer.id, frame });
      dragMode = "marquee";
      return;
    }

    // Long-press anywhere → marquee (touch / packed rows).
    cancelLongPress();
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      dragMode = "marquee";
      setTimelineSelection({ layerId: layer.id, frame }, { layerId: layer.id, frame });
    }, LONG_PRESS_MS);

    const plan = planCellPointer(layer.cells, rowOffset(e), CELL_W, appState.project.frameCount);
    if (plan.kind === "resize") {
      dragMode = "resize";
      dragKey = plan.keyIndex;
      dragStartBoundary = rowBoundary(e);
      dragLastBoundary = dragStartBoundary;
      dragUndo = beginStructuralEdit();
      return;
    }

    if (plan.kind === "move") {
      // On a key: select it (unless already selected) + seek; prepare to move the selection.
      if (!inSelection(layer.id, frame)) {
        setTimelineSelection({ layerId: layer.id, frame }, { layerId: layer.id, frame });
        go(frame); // tap-a-key also seeks to it
      }
      dragMode = "moveblock";
      moveGrabFrame = frame;
      moveDelta = 0;
    } else {
      // Empty/hold cell: tap → deselect; drag → marquee. Decided on move/up.
      armedEmpty = true;
      pressFrame = frame;
    }
  }
  function rowMove(e: PointerEvent, layer: DrawingLayer) {
    // A real drag cancels a pending long-press.
    if (
      longPressTimer !== null &&
      (Math.abs(e.clientX - pressStartX) > MOVE_CANCEL_PX ||
        Math.abs(e.clientY - pressStartY) > MOVE_CANCEL_PX)
    )
      cancelLongPress();

    if (dragMode === "marquee" && appState.timelineSelection) {
      const overLayer = layerIdAtPoint(e.clientX, e.clientY, dragLayerId);
      setTimelineSelection(appState.timelineSelection.anchor, {
        layerId: overLayer,
        frame: rowColumn(e),
      });
      return;
    }
    if (dragMode === "moveblock") {
      const raw = rowColumn(e) - moveGrabFrame;
      moveDelta = selRect ? Math.max(raw, -selRect.startFrame) : raw; // clamp so nothing goes < 0
      return;
    }
    if (dragMode === "resize") {
      dragLastBoundary = rowBoundary(e);
      setHoldSpan(layer, dragKey, Math.max(1, dragLastBoundary - dragKey));
      bump();
      return;
    }
    // Empty-armed: once the pointer really moves, start a marquee from the press cell.
    if (
      armedEmpty &&
      (Math.abs(e.clientX - pressStartX) > MOVE_CANCEL_PX ||
        Math.abs(e.clientY - pressStartY) > MOVE_CANCEL_PX)
    ) {
      armedEmpty = false;
      cancelLongPress();
      dragMode = "marquee";
      setTimelineSelection(
        { layerId: dragLayerId, frame: pressFrame },
        { layerId: layer.id, frame: rowColumn(e) },
      );
      return;
    }
    // Idle hover cursor.
    if (dragMode === "none") {
      const plan = planCellPointer(layer.cells, rowOffset(e), CELL_W, appState.project.frameCount);
      rowCursor = plan.kind === "resize" ? "ew-resize" : plan.kind === "move" ? "grab" : "default";
    }
  }
  function rowUp(e: PointerEvent, layer: DrawingLayer) {
    cancelLongPress();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }

    if (dragMode === "moveblock") {
      if (moveDelta !== 0) moveTimelineSelection(moveDelta);
      else {
        // Tap with no drag → collapse to the grabbed key (1×1) + seek. (On down we kept an existing
        // block intact so a drag could move it; a plain tap resolves to just this key, per D6.)
        setTimelineSelection(
          { layerId: dragLayerId, frame: moveGrabFrame },
          { layerId: dragLayerId, frame: moveGrabFrame },
        );
        go(moveGrabFrame);
      }
    } else if (dragMode === "resize" && dragLayerId === layer.id && dragUndo) {
      if (dragLastBoundary !== dragStartBoundary) commitStructuralEdit(dragUndo);
    } else if (dragMode === "none" && armedEmpty) {
      clearTimelineSelection(); // tap on empty with no drag → deselect
    }

    dragMode = "none";
    dragLayerId = -1;
    dragKey = -1;
    dragUndo = null;
    dragStartBoundary = -1;
    dragLastBoundary = -1;
    moveGrabFrame = -1;
    moveDelta = 0;
    armedEmpty = false;
    pressFrame = -1;
  }
  function rowLeave() {
    if (dragMode === "none") rowCursor = "default";
  }

  // All tools act on the active drawing layer at the current frame, current-frame-aware
  // (inserts land AFTER the playhead, then the playhead follows to the new frame).
  // Frame tools are undoable structural edits. Advancing the playhead happens inside the
  // mutation so commitStructural's trailing bump() refreshes the length and clamps it.
  function frameTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    commitStructural(() => {
      addFrame(l, appState.playhead);
      appState.playhead += 1;
    });
  }
  function keyTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    commitStructural(() => {
      insertKeyframe(l, appState.playhead, canvasOps);
      appState.playhead += 1;
    });
  }
  function dupTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    commitStructural(() => {
      duplicateKeyframe(l, appState.playhead, canvasOps);
      appState.playhead += 1;
    });
  }
  function holdTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    if (l.cells[appState.playhead]?.kind !== "key") return; // already a hold → nothing to do
    liftGuard.discard?.(); // this replaces the active cell's canvas — discard any live lift first
    commitStructural(() => setHold(l, appState.playhead));
  }
  function deleteTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    if (l.cells.length <= 1) return; // can't delete the last frame → no empty undo entry
    liftGuard.discard?.(); // this removes the active cell's canvas — discard any live lift first
    commitStructural(() => deleteFrame(l, appState.playhead));
  }
  // Blank the active layer's keyframe at the current frame (keep it as an empty keyframe),
  // undoable. If the frame is a hold, it first becomes an editable keyframe, then is cleared.
  function clearFrame() {
    const l = activeLayer();
    if (l.kind !== "draw" || l.locked) return;
    const canvas = ensureDrawableKeyframe(l, appState.playhead, canvasOps);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    const after = ctx.getImageData(0, 0, canvas.width, canvas.height);
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
  <!-- resize grip: overlays the top padding strip, full width; drag to resize the panel -->
  <div
    class="absolute top-0 left-0 right-0 h-2 z-30 flex items-center justify-center cursor-row-resize text-text-muted hover:text-text"
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

    <!-- onion skin (a frame-drawing aid, lives with the frame tools) -->
    <button
      class={toolBtn}
      class:bg-surface-active={appState.onion.enabled}
      title="Onion skin"
      onclick={() => {
        appState.onion.enabled = !appState.onion.enabled;
        bump();
      }}><Layers size={16} /></button
    >
    <label
      class="flex items-center gap-1 text-xs text-text-secondary"
      title="Onion: previous frames"
      >prev
      <input
        class="w-9 bg-surface border border-border text-text px-1"
        type="number"
        min="0"
        max="3"
        bind:value={appState.onion.prev}
        onchange={bump}
      />
    </label>
    <label class="flex items-center gap-1 text-xs text-text-secondary" title="Onion: next frames"
      >next
      <input
        class="w-9 bg-surface border border-border text-text px-1"
        type="number"
        min="0"
        max="3"
        bind:value={appState.onion.next}
        onchange={bump}
      />
    </label>
    <label
      class="flex items-center gap-1 text-xs text-text-secondary"
      title="Onion: ghost all layers"
    >
      <input type="checkbox" bind:checked={appState.onion.allLayers} onchange={bump} /> all layers
    </label>

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
              step="0.5"
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
    <!-- current-frame column highlight: an absolute overlay so scrubbing is O(1) — NOT a per-cell
         `f === appState.playhead` class (that re-evaluated frameCount×layers bindings on every scrub). -->
    <div
      class="absolute top-0 bottom-0 pointer-events-none z-0"
      style="left: {LABEL_W +
        appState.playhead *
          CELL_W}px; width: {CELL_W}px; background: var(--color-selection); opacity: 0.25"
    ></div>
    <!-- playhead line — draggable to scrub the body -->
    <div
      class="absolute top-0 bottom-0 z-[15] flex justify-center"
      style="left: {LABEL_W +
        appState.playhead * CELL_W +
        CELL_W / 2 -
        4}px; width: 8px; touch-action: none; cursor: col-resize"
      role="slider"
      tabindex="0"
      aria-label="Scrub frames"
      aria-valuemin={1}
      aria-valuemax={appState.project.frameCount}
      aria-valuenow={appState.playhead + 1}
      onpointerdown={lineDown}
      onpointermove={lineMove}
      onpointerup={lineUp}
      onpointercancel={lineUp}
      onkeydown={rulerKey}
    >
      <div class="w-0.5 h-full bg-accent"></div>
    </div>

    <!-- ruler (contiguous with the rows so the sticky gutter fully hides the playhead line) -->
    <div class="flex items-stretch sticky top-0 z-20 bg-surface">
      <span class="shrink-0 sticky left-0 z-20 bg-surface" style="width: {LABEL_W}px"></span>
      <div
        class="flex cursor-ew-resize select-none"
        style="touch-action: none"
        role="slider"
        tabindex="0"
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
        {#each Array(appState.project.frameCount) as _, f (f)}
          {@const r = appState.playback.range
            ? effectiveRange(appState.playback.range, appState.project.frameCount)
            : null}
          <div
            class="box-border h-4 border-r border-border text-[10px] leading-4 text-center text-text-muted"
            class:bg-selection={r && f >= r.start && f <= r.end}
            style="width: {CELL_W}px"
          >
            {rulerLabel(f)}
          </div>
        {/each}
      </div>
    </div>

    <!-- audio waveform lane (scrolls with the ruler + rows; only when an audio track is set) -->
    <AudioLane cellW={CELL_W} labelW={LABEL_W} />

    <!-- layer rows (top layer first) -->
    {#each [...appState.project.layers].reverse() as layer (layer.id)}
      {#if !groupOf(layer, appState.project.groups)?.collapsed}
        <div class="flex items-center">
          <button
            class="shrink-0 sticky left-0 z-20 h-6 leading-6 truncate text-left pr-1 hover:bg-surface-hover"
            class:bg-surface={layer.id !== appState.activeLayerId}
            class:bg-surface-active={layer.id === appState.activeLayerId}
            class:text-text={layer.id === appState.activeLayerId}
            class:text-text-secondary={layer.id !== appState.activeLayerId}
            style="width: {LABEL_W}px"
            title="Select layer"
            onclick={() => setActiveLayer(layer.id)}>{layer.name}</button
          >
          {#if layer.kind === "draw"}
            {@const glyphs = glyphsFor(layer, appState.version)}
            <div
              class="flex select-none"
              style="touch-action: none; cursor: {rowCursor}"
              class:opacity-100={layer.id === appState.activeLayerId}
              class:opacity-70={layer.id !== appState.activeLayerId}
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
                  {glyphs[f]}
                </div>
              {/each}
            </div>
          {:else}
            <span
              class="text-xs text-text-muted ml-1"
              class:opacity-70={layer.id !== appState.activeLayerId}>ref</span
            >
          {/if}
        </div>
      {/if}
    {/each}

    <TimelineSelectionBar
      container={gridWrapper}
      rect={dragMode === "moveblock" ? null : selRect}
      cellW={CELL_W}
      labelW={LABEL_W}
    />
  </div>
</div>
