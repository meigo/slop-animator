<script lang="ts">
  import { Plus, Diamond, Copy, Minus, Eraser, Trash2, Layers, Waves } from "@lucide/svelte";
  import { state, canvasOps, activeLayer, bump, history, commitStructural,
           beginStructuralEdit, commitStructuralEdit, type StructSnapshot } from "../state/appState.svelte";
  import { addFrame, insertKeyframe, duplicateKeyframe, setHold, deleteFrame, ensureDrawableKeyframe,
           moveKeyframe, setHoldSpan } from "../anim/timeline";
  import { resolveKeyframeIndex, type Cell, type DrawingLayer } from "../anim/document";
  import { columnAtX, planCellPointer } from "./timeline-grid";
  import { isCellEmpty } from "./cell-ink";

  const CELL_W = 24;   // px, fixed column width (box-border cells, no gap → contiguous columns)
  const LABEL_W = 80;  // px, layer-name gutter

  // What a cell shows: ◆ keyframe with ink, — hold over an inked key, and a blank cell for
  // anything empty (no key / empty key / hold over an empty key / past the layer's end).
  // `_v` (state.version) is passed from the template so the label re-evaluates when a
  // draw/clear changes a canvas's ink.
  function cellLabel(cells: Cell[], f: number, _v: number): string {
    if (f >= cells.length) return "";
    const ki = resolveKeyframeIndex(cells, f);
    if (ki === null) return ""; // no keyframe at or before this frame → empty
    const key = cells[ki];
    if (key.kind === "key" && isCellEmpty(key.canvas)) return ""; // resolves to a blank keyframe → empty
    return cells[f].kind === "key" ? "◆" : "—";
  }

  // Ruler shows frame 1, then every 5th frame (1, 5, 10, 15, …); other columns are bare ticks.
  function rulerLabel(f: number): string {
    return f === 0 || (f + 1) % 5 === 0 ? String(f + 1) : "";
  }

  function go(f: number) {
    state.playhead = Math.max(0, Math.min(state.project.frameCount - 1, f));
  }

  // Draggable playhead: pointer-drag anywhere on the ruler scrubs the current frame.
  // Pointer capture keeps the drag alive outside the element; touch-action:none stops
  // the browser from panning/zooming the page while scrubbing (needed on iPad).
  let scrubbing = false;
  function scrubTo(e: PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    go(columnAtX(e.clientX - rect.left, CELL_W, state.project.frameCount));
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
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }
  function rulerKey(e: KeyboardEvent) {
    if (e.key === "ArrowLeft") go(state.playhead - 1);
    else if (e.key === "ArrowRight") go(state.playhead + 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(state.project.frameCount - 1);
    else return;
    e.preventDefault();
  }

  // Cell-strip pointer interaction: drag a ◆ to move it, drag a span's right edge to resize
  // its hold span, click/drag elsewhere to scrub the playhead. Pointer capture + touch-action
  // keep drags alive and stop the page from panning on iPad.
  type DragMode = "none" | "seek" | "move" | "resize";
  let dragMode: DragMode = "none";
  let dragLayerId = -1;
  let dragKey = -1;      // keyIndex being moved or resized
  let dragTarget = -1;   // current target column (move ghost)
  let dragUndo: StructSnapshot | null = null;
  let dragStartBoundary = -1; // span edge boundary at the start of a resize (to detect a real change)
  let dragLastBoundary = -1;  // last boundary applied during a resize (used on up/cancel, not the event)
  let rowCursor = "default";

  function rowOffset(e: PointerEvent): number {
    return e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left;
  }
  function rowColumn(e: PointerEvent): number {
    return columnAtX(rowOffset(e), CELL_W, state.project.frameCount);
  }
  // Resize tracks the column BOUNDARY under the pointer, unclamped at the top end so a span can
  // grow past the current document length (extending it). round() keeps the span unchanged when
  // you first grab the edge.
  function rowBoundary(e: PointerEvent): number {
    return Math.max(0, Math.round(rowOffset(e) / CELL_W));
  }

  function rowDown(e: PointerEvent, layer: DrawingLayer) {
    state.activeLayerId = layer.id;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragLayerId = layer.id;
    const plan = planCellPointer(layer.cells, rowOffset(e), CELL_W, state.project.frameCount);
    if (plan.kind === "resize") {
      dragMode = "resize";
      dragKey = plan.keyIndex;
      dragStartBoundary = rowBoundary(e);
      dragLastBoundary = dragStartBoundary;
      dragUndo = beginStructuralEdit();
    } else if (plan.kind === "move") {
      dragMode = "move";
      dragKey = plan.keyIndex;
      dragTarget = plan.keyIndex;
    } else {
      dragMode = "seek";
      go(plan.frame);
    }
  }
  function rowMove(e: PointerEvent, layer: DrawingLayer) {
    if (dragMode === "none") {
      const plan = planCellPointer(layer.cells, rowOffset(e), CELL_W, state.project.frameCount);
      rowCursor = plan.kind === "resize" ? "ew-resize" : plan.kind === "move" ? "grab" : "default";
      return;
    }
    if (dragLayerId !== layer.id) return;
    if (dragMode === "seek") go(rowColumn(e));
    else if (dragMode === "move") dragTarget = rowColumn(e);
    else if (dragMode === "resize") {
      dragLastBoundary = rowBoundary(e);
      setHoldSpan(layer, dragKey, Math.max(1, dragLastBoundary - dragKey)); // live; boundary − key index
      bump();
    }
  }
  function rowUp(e: PointerEvent, layer: DrawingLayer) {
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (dragMode === "move" && dragLayerId === layer.id) {
      if (dragTarget >= 0 && dragTarget !== dragKey) commitStructural(() => moveKeyframe(layer, dragKey, dragTarget));
      else go(dragKey); // a click on a keyframe with no drag → seek to it
    } else if (dragMode === "resize" && dragLayerId === layer.id && dragUndo) {
      if (dragLastBoundary !== dragStartBoundary) commitStructuralEdit(dragUndo); // skip a no-op resize
    }
    dragMode = "none";
    dragLayerId = -1;
    dragKey = -1;
    dragTarget = -1;
    dragUndo = null;
    dragStartBoundary = -1;
    dragLastBoundary = -1;
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
    commitStructural(() => { addFrame(l, state.playhead); state.playhead += 1; });
  }
  function keyTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    commitStructural(() => { insertKeyframe(l, state.playhead, canvasOps); state.playhead += 1; });
  }
  function dupTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    commitStructural(() => { duplicateKeyframe(l, state.playhead, canvasOps); state.playhead += 1; });
  }
  function holdTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    if (l.cells[state.playhead]?.kind !== "key") return; // already a hold → nothing to clear
    commitStructural(() => setHold(l, state.playhead));
  }
  function deleteTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    if (l.cells.length <= 1) return; // can't delete the last frame → no empty undo entry
    commitStructural(() => deleteFrame(l, state.playhead));
  }
  // Blank the active layer's keyframe at the current frame (keep it as an empty keyframe),
  // undoable. If the frame is a hold, it first becomes an editable keyframe, then is cleared.
  function clearFrame() {
    const l = activeLayer();
    if (l.kind !== "draw" || l.locked) return;
    const canvas = ensureDrawableKeyframe(l, state.playhead, canvasOps);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    const after = ctx.getImageData(0, 0, canvas.width, canvas.height);
    history.push({
      undo: () => { ctx.putImageData(before, 0, 0); bump(); },
      redo: () => { ctx.putImageData(after, 0, 0); bump(); },
    });
    bump();
  }

  const toolBtn =
    "w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover border border-border";
</script>

<div class="border-t border-border bg-surface text-text p-2 text-sm">
  <div class="flex items-center gap-1 mb-2 flex-wrap">
    <button class={toolBtn} title="Add frame (after current)" onclick={frameTool}><Plus size={16} /></button>
    <button class={toolBtn} title="Insert keyframe (after current)" onclick={keyTool}><Diamond size={16} /></button>
    <button class={toolBtn} title="Duplicate keyframe (after current)" onclick={dupTool}><Copy size={16} /></button>
    <button class={toolBtn} title="Hold (repeat previous frame)" onclick={holdTool}><Minus size={16} /></button>
    <button class={toolBtn} title="Clear frame (blank this keyframe)" onclick={clearFrame}><Eraser size={16} /></button>
    <button class={toolBtn} title="Delete frame" onclick={deleteTool}><Trash2 size={16} /></button>

    <span class="w-px h-5 bg-border mx-1"></span>

    <!-- onion skin (a frame-drawing aid, lives with the frame tools) -->
    <button class={toolBtn} class:bg-surface-active={state.onion.enabled} title="Onion skin"
            onclick={() => { state.onion.enabled = !state.onion.enabled; bump(); }}><Layers size={16} /></button>
    <label class="flex items-center gap-1 text-xs text-text-secondary" title="Onion: previous frames">prev
      <input class="w-9 bg-surface border border-border text-text px-1" type="number" min="0" max="3"
             bind:value={state.onion.prev} onchange={bump} />
    </label>
    <label class="flex items-center gap-1 text-xs text-text-secondary" title="Onion: next frames">next
      <input class="w-9 bg-surface border border-border text-text px-1" type="number" min="0" max="3"
             bind:value={state.onion.next} onchange={bump} />
    </label>
    <label class="flex items-center gap-1 text-xs text-text-secondary" title="Onion: ghost all layers">
      <input type="checkbox" bind:checked={state.onion.allLayers} onchange={bump} /> all layers
    </label>

    <span class="w-px h-5 bg-border mx-1"></span>

    <!-- line boil (prototype) — applied during playback; each layer boils on its own phase -->
    <button class={toolBtn} class:bg-surface-active={state.boil.enabled} title="Line boil (playback)"
            onclick={() => { state.boil.enabled = !state.boil.enabled; bump(); }}><Waves size={16} /></button>
    <label class="flex items-center gap-1 text-xs text-text-secondary" title="Boil amount (px)">amt
      <input type="range" class="w-16" min="0" max="8" step="0.5" bind:value={state.boil.amount} />
      <span class="w-6 text-text-muted tabular-nums">{state.boil.amount}</span></label>
    <label class="flex items-center gap-1 text-xs text-text-secondary" title="Boil detail (grid columns)">grid
      <input type="range" class="w-16" min="4" max="40" step="1" bind:value={state.boil.cols} />
      <span class="w-5 text-text-muted tabular-nums">{state.boil.cols}</span></label>
    <label class="flex items-center gap-1 text-xs text-text-secondary" title="Boil rate (cycle N warps — on twos/threes)">rate
      <input type="range" class="w-12" min="1" max="8" step="1" bind:value={state.boil.rate} />
      <span class="w-4 text-text-muted tabular-nums">{state.boil.rate}</span></label>
    <label class="flex items-center gap-1 text-xs text-text-secondary" title="Boil line-weight jitter (uniform scale ±%)">wt
      <input type="range" class="w-16" min="0" max="0.05" step="0.005" bind:value={state.boil.scale} />
      <span class="w-8 text-text-muted tabular-nums">{(state.boil.scale * 100).toFixed(1)}%</span></label>
  </div>

  <!-- aligned grid: ruler + layer rows share one column geometry; a single playhead line spans them -->
  <div class="relative overflow-x-auto">
    <!-- playhead line (visual, non-interactive); centered on the current column -->
    <div class="absolute top-0 bottom-0 w-0.5 bg-accent pointer-events-none z-10"
         style="left: {LABEL_W + state.playhead * CELL_W + CELL_W / 2 - 1}px"></div>

    <!-- ruler (contiguous with the rows so the sticky gutter fully hides the playhead line) -->
    <div class="flex items-stretch">
      <span class="shrink-0 sticky left-0 z-20 bg-surface" style="width: {LABEL_W}px"></span>
      <div class="flex cursor-ew-resize select-none" style="touch-action: none"
           role="slider" tabindex="0" aria-label="Scrub frames"
           aria-valuemin={1} aria-valuemax={state.project.frameCount} aria-valuenow={state.playhead + 1}
           onpointerdown={rulerDown} onpointermove={rulerMove}
           onpointerup={rulerUp} onpointercancel={rulerUp} onkeydown={rulerKey}>
        {#each Array(state.project.frameCount) as _, f}
          <div class="box-border h-4 border-r border-border text-[10px] leading-4 text-center text-text-muted"
               class:text-accent={f === state.playhead}
               style="width: {CELL_W}px">{rulerLabel(f)}</div>
        {/each}
      </div>
    </div>

    <!-- layer rows (top layer first) -->
    {#each [...state.project.layers].reverse() as layer (layer.id)}
      <div class="flex items-center">
        <button class="shrink-0 sticky left-0 z-20 h-6 leading-6 truncate text-left pr-1 hover:bg-surface-hover"
                class:bg-surface={layer.id !== state.activeLayerId}
                class:bg-surface-active={layer.id === state.activeLayerId}
                class:text-text={layer.id === state.activeLayerId}
                class:text-text-secondary={layer.id !== state.activeLayerId}
                style="width: {LABEL_W}px" title="Select layer"
                onclick={() => (state.activeLayerId = layer.id)}>{layer.name}</button>
        {#if layer.kind === "draw"}
          <div class="flex select-none" style="touch-action: none; cursor: {rowCursor}"
               class:opacity-100={layer.id === state.activeLayerId}
               class:opacity-70={layer.id !== state.activeLayerId}
               role="application" aria-label="{layer.name} frames"
               onpointerdown={(e) => rowDown(e, layer)} onpointermove={(e) => rowMove(e, layer)}
               onpointerup={(e) => rowUp(e, layer)} onpointercancel={(e) => rowUp(e, layer)}
               onpointerleave={rowLeave}>
            {#each Array(state.project.frameCount) as _, f}
              <div class="box-border h-6 border border-border leading-none text-xs flex items-center justify-center"
                   class:bg-selection={f === state.playhead}
                   class:text-accent-text={f === state.playhead}
                   class:ring-2={dragMode === "move" && dragLayerId === layer.id && f === dragTarget}
                   class:ring-accent={dragMode === "move" && dragLayerId === layer.id && f === dragTarget}
                   class:ring-inset={dragMode === "move" && dragLayerId === layer.id && f === dragTarget}
                   style="width: {CELL_W}px">{cellLabel(layer.cells, f, state.version)}</div>
            {/each}
          </div>
        {:else}
          <span class="text-xs text-text-muted ml-1" class:opacity-70={layer.id !== state.activeLayerId}>ref</span>
        {/if}
      </div>
    {/each}
  </div>
</div>
