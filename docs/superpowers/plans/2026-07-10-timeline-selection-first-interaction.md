# Selection-First Timeline Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the timeline track-body into a selection-first model (click selects, drag moves the selection) and add drag-to-move for a single key or a frames×layers block.

**Architecture:** A new pure `moveBlockFrames` (+ an extracted `overwriteColumn` shared with paste) in `src/anim/timeline-block.ts`, node-unit-tested. A `moveTimelineSelection` action in `appState.svelte.ts`. A rewrite of `Timeline.svelte`'s gesture state machine (`rowDown/rowMove/rowUp`) plus a draggable playhead line. Reuses the existing selection state and clone discipline.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vite, Vitest (node env), Tailwind 4.

## Global Constraints

- Build bar: `npm run build` (`svelte-check && tsc --noEmit && vite build`) must be **0 errors, 0 warnings**.
- Test baseline **308 passing**; new `moveBlockFrames` tests add to it. DOM/gesture code is NOT node-testable — those tasks are build + reasoning + browser verified (no fabricated DOM tests).
- **Undo-snapshot invariant:** structural mutations must **replace** a cell object, never mutate in place; moved cells must be **cloned** (fresh canvas + cloned transform) so no source/clipboard ref is shared.
- **Lift-lifecycle invariant:** `moveTimelineSelection` calls `liftGuard.discard?.()` before mutating.
- `commitStructural` clears `state.timelineSelection` after the mutation — the move action must **re-set** the selection to the moved range afterward.
- **Runes alias:** `Timeline.svelte` uses `import { state as appState }`; keep `appState.`.
- Fixed geometry: `CELL_W = 24`, `LABEL_W = 80`.
- Surgical edits; match existing style. Pre-commit hook reformats staged files (expected).

---

## File Structure

- **Modify** `src/anim/timeline-block.ts` — extract `overwriteColumn`; add `moveBlockFrames`.
- **Modify** `src/__tests__/timeline-block.test.ts` — tests for `moveBlockFrames` (+ paste stays green).
- **Modify** `src/state/appState.svelte.ts` — add `moveTimelineSelection(delta)`.
- **Modify** `src/lib/Timeline.svelte` — gesture rewrite + moveblock ghost + draggable playhead line.

---

## Task 1: `moveBlockFrames` engine (+ `overwriteColumn` refactor)

**Files:**
- Modify: `src/anim/timeline-block.ts`
- Test: `src/__tests__/timeline-block.test.ts`

**Interfaces:**
- Consumes: `CellBlock`, `cloneCell`, `copyBlock`, `deleteBlock`, `drawingLayerIdsDown`, `CanvasOps`, `Cell`, `DrawingLayer`, `Project`.
- Produces:
  - `function moveBlockFrames(project: Project, layerIds: number[], startFrame: number, endFrame: number, delta: number, ops: CanvasOps): number` (returns the applied, clamped delta)
  - (internal) `function overwriteColumn(layer: DrawingLayer, cells: Cell[], startFrame: number, ops: CanvasOps): void`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/timeline-block.test.ts`:

```ts
import { moveBlockFrames } from "../anim/timeline-block";

describe("moveBlockFrames", () => {
  it("shifts keys later and blanks the vacated cells", () => {
    const a = fakeOps.create();
    const l = drawLayer(1, [key(a), hold(), hold(), hold()]); // [A][·][·][·]
    const applied = moveBlockFrames(proj([l], 4), [1], 0, 0, 2, fakeOps); // move frame 0 → 2
    expect(applied).toBe(2);
    expect(l.cells[0]).toEqual({ kind: "hold" }); // vacated
    const c2 = l.cells[2];
    expect(c2.kind).toBe("key");
    if (c2.kind === "key") expect(cloneOf(c2.canvas)).toBe(idOf(a));
  });

  it("overwrites an existing key at the destination", () => {
    const a = fakeOps.create();
    const b = fakeOps.create();
    const l = drawLayer(1, [key(a), key(b)]); // [A][B]
    moveBlockFrames(proj([l], 2), [1], 0, 0, 1, fakeOps); // move A onto B
    expect(l.cells[0]).toEqual({ kind: "hold" });
    const c1 = l.cells[1];
    if (c1.kind === "key") expect(cloneOf(c1.canvas)).toBe(idOf(a)); // A won
  });

  it("handles source/destination overlap (delta 1 on a 2-wide block)", () => {
    const a = fakeOps.create();
    const b = fakeOps.create();
    const l = drawLayer(1, [key(a), key(b), hold()]); // [A][B][·]
    moveBlockFrames(proj([l], 3), [1], 0, 1, 1, fakeOps); // move [A,B] → frames 1,2
    expect(l.cells[0]).toEqual({ kind: "hold" });
    const c1 = l.cells[1];
    const c2 = l.cells[2];
    if (c1.kind === "key") expect(cloneOf(c1.canvas)).toBe(idOf(a));
    if (c2.kind === "key") expect(cloneOf(c2.canvas)).toBe(idOf(b));
  });

  it("clamps so the earliest frame never goes below 0 (returns the applied delta)", () => {
    const a = fakeOps.create();
    const l = drawLayer(1, [hold(), key(a)]); // [·][A]
    const applied = moveBlockFrames(proj([l], 2), [1], 1, 1, -5, fakeOps); // want -5, start=1 → clamp -1
    expect(applied).toBe(-1);
    const c0 = l.cells[0];
    if (c0.kind === "key") expect(cloneOf(c0.canvas)).toBe(idOf(a));
    expect(l.cells[1]).toEqual({ kind: "hold" });
  });

  it("pads with holds when moving past the layer's end", () => {
    const a = fakeOps.create();
    const l = drawLayer(1, [key(a)]); // length 1
    moveBlockFrames(proj([l], 1), [1], 0, 0, 3, fakeOps);
    expect(l.cells.length).toBe(4); // [·][·][·][A]
    expect(l.cells[3].kind).toBe("key");
  });

  it("moves each column on its OWN layer (no cross-layer remap)", () => {
    const a = fakeOps.create();
    const b = fakeOps.create();
    const top = drawLayer(3, [key(a), hold()]);
    const bottom = drawLayer(1, [key(b), hold()]);
    // layerIds top-first: [3,1]
    moveBlockFrames(proj([bottom, drawLayer(2, [hold(), hold()]), top], 2), [3, 1], 0, 0, 1, fakeOps);
    const t1 = top.cells[1];
    const b1 = bottom.cells[1];
    if (t1.kind === "key") expect(cloneOf(t1.canvas)).toBe(idOf(a)); // layer 3's A stayed on layer 3
    if (b1.kind === "key") expect(cloneOf(b1.canvas)).toBe(idOf(b)); // layer 1's B stayed on layer 1
  });

  it("no-ops (returns 0) when applied delta is 0", () => {
    const l = drawLayer(1, [key()]);
    expect(moveBlockFrames(proj([l], 1), [1], 0, 0, 0, fakeOps)).toBe(0);
    expect(l.cells.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/timeline-block.test.ts`
Expected: FAIL — `moveBlockFrames` not exported.

- [ ] **Step 3: Refactor + implement**

In `src/anim/timeline-block.ts`, first extract the per-column write loop from `pasteBlockOverwrite`. Add this helper (near `cloneCell`):

```ts
/** Overwrite-write a column of cells onto `layer` starting at `startFrame`: clone each cell, replace
 *  in place, and pad with holds if it lands past the layer's end. Shared by paste and move. */
function overwriteColumn(
  layer: DrawingLayer,
  cells: Cell[],
  startFrame: number,
  ops: CanvasOps,
): void {
  for (let r = 0; r < cells.length; r++) {
    const f = startFrame + r;
    const cell = cloneCell(cells[r], ops);
    if (f >= layer.cells.length) {
      while (layer.cells.length < f) layer.cells.push({ kind: "hold" });
      layer.cells.push(cell);
    } else {
      layer.cells[f] = cell; // replace, never mutate in place
    }
  }
}
```

Then rewrite `pasteBlockOverwrite`'s inner loop to use it (behavior identical):

```ts
export function pasteBlockOverwrite(
  project: Project,
  block: CellBlock,
  targetTopLayerId: number,
  startFrame: number,
  ops: CanvasOps,
): void {
  const targetIds = drawingLayerIdsDown(project, targetTopLayerId);
  for (let c = 0; c < block.cols; c++) {
    if (c >= targetIds.length) break; // overflow past bottom layer
    const layer = project.layers.find((l) => l.id === targetIds[c]);
    if (!layer || layer.kind !== "draw") continue;
    overwriteColumn(layer, block.columns[c], startFrame, ops);
  }
}
```

Now add `moveBlockFrames` (import nothing new — `copyBlock`/`deleteBlock`/`cloneCell` are in this file):

```ts
/** Move the selected block by `delta` frames on its OWN layers (frames-only), overwriting the
 *  destination. Returns the applied delta after clamping so the earliest moved frame stays >= 0.
 *  Self-contained: leading holds are materialized (via copyBlock), the range is blanked, then the
 *  cloned block is re-stamped at +applied. copyBlock clones first, so source/destination overlap
 *  is safe. `layerIds` must be drawing layers (as resolveSelectionRect guarantees). */
export function moveBlockFrames(
  project: Project,
  layerIds: number[],
  startFrame: number,
  endFrame: number,
  delta: number,
  ops: CanvasOps,
): number {
  const applied = Math.max(delta, -startFrame);
  if (applied === 0) return 0;
  const block = copyBlock(project, layerIds, startFrame, endFrame, ops); // columns for draw layers, in order
  deleteBlock(project, layerIds, startFrame, endFrame); // vacate the source → holds
  let c = 0;
  for (const id of layerIds) {
    const layer = project.layers.find((l) => l.id === id);
    if (!layer || layer.kind !== "draw") continue; // mirrors copyBlock's column filter → alignment
    overwriteColumn(layer, block.columns[c], startFrame + applied, ops);
    c++;
  }
  return applied;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/timeline-block.test.ts`
Expected: PASS — the new `moveBlockFrames` tests AND all existing `pasteBlockOverwrite` tests (the refactor is behavior-preserving).

- [ ] **Step 5: Commit**

```bash
git add src/anim/timeline-block.ts src/__tests__/timeline-block.test.ts
git commit -m "feat: moveBlockFrames (frames-only overwrite move) + shared overwriteColumn"
```

---

## Task 2: `moveTimelineSelection` action

**Files:**
- Modify: `src/state/appState.svelte.ts` (imports; add the action near `deleteTimelineSelection`/`pasteCells`)

**Interfaces:**
- Consumes: `moveBlockFrames` (Task 1); existing `currentSelectionRect`, `liftGuard`, `commitStructural`, `canvasOps`, `state.timelineSelection`.
- Produces: `function moveTimelineSelection(delta: number): void`.

Build-verified (store file not node-importable).

- [ ] **Step 1: Import `moveBlockFrames`**

Add it to the existing `../anim/timeline-block` import in `appState.svelte.ts`:

```ts
import {
  copyBlock,
  pasteBlockOverwrite,
  pasteBlockInsert,
  deleteBlock,
  moveBlockFrames,
  type CellBlock,
} from "../anim/timeline-block";
```

- [ ] **Step 2: Add the action**

Add near `deleteTimelineSelection`:

```ts
/** Move the current timeline selection by `delta` frames (frames-only, overwrite). Undoable; the
 *  selection follows to the moved range. No-op if there's no selection or the clamped delta is 0. */
export function moveTimelineSelection(delta: number): void {
  const rect = currentSelectionRect();
  if (!rect) return;
  const applied = Math.max(delta, -rect.startFrame); // clamp before committing so a no-op doesn't push undo
  if (applied === 0) return;
  liftGuard.discard?.(); // may replace the active cell's canvas → discard any live lift first
  commitStructural(() =>
    moveBlockFrames(state.project, rect.layerIds, rect.startFrame, rect.endFrame, applied, canvasOps),
  );
  // commitStructural cleared the selection — re-set it to the moved range (same layers).
  state.timelineSelection = {
    anchor: { layerId: rect.layerIds[0], frame: rect.startFrame + applied },
    focus: { layerId: rect.layerIds[rect.layerIds.length - 1], frame: rect.endFrame + applied },
  };
}
```

- [ ] **Step 3: Verify build + tests**

Run: `npm run build` → 0/0.
Run: `npm test` → baseline + Task-1 tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat: moveTimelineSelection action (frames-only, selection follows)"
```

---

## Task 3: Timeline gesture rewrite (selection-first)

**Files:**
- Modify: `src/lib/Timeline.svelte` (imports; `DragMode` + drag state ~L145-161; `rowDown/rowMove/rowUp` ~L200-300; `inSelection` ~L182; the move-ghost `ring` markup on cells; the `<TimelineSelectionBar>` render)

**Interfaces:**
- Consumes: `moveTimelineSelection`, `clearTimelineSelection` (add to imports); existing `setTimelineSelection`, `go`, `selRect`, `layerIdAtPoint`, `planCellPointer`, `setHoldSpan`, `beginStructuralEdit`, `commitStructuralEdit`.
- Produces: the selection-first gesture machine.

DOM/gesture code — build + browser verified.

- [ ] **Step 1: Imports**

Add `moveTimelineSelection` and `clearTimelineSelection` to the `../state/appState.svelte` import. **Remove** the now-unused `moveKeyframe` import from the `../anim/timeline` import (it stays exported for its own tests, just no longer used here — leaving it trips `noUnusedLocals`).

- [ ] **Step 2: Replace the DragMode + drag state block**

Replace the drag-state declarations (the `type DragMode` line through the move-ghost state) with:

```ts
  // Selection-first gestures: press classifies via planCellPointer + selection membership.
  type DragMode = "none" | "resize" | "marquee" | "moveblock";
  let dragMode = $state<DragMode>("none");
  let dragLayerId = -1;
  let dragKey = -1; // key index being resized
  let dragUndo: StructSnapshot | null = null;
  let dragStartBoundary = -1;
  let dragLastBoundary = -1;
  let rowCursor = $state("default");

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
```

(Delete the old `dragTarget` state entirely — it is removed below from the markup too.)

- [ ] **Step 3: Rewrite `inSelection` to ghost during a move**

```ts
  function inSelection(layerId: number, f: number): boolean {
    if (!selRect) return false;
    const shift = dragMode === "moveblock" ? moveDelta : 0; // slide the highlight to the drop target
    return (
      selRect.layerIds.includes(layerId) &&
      f >= selRect.startFrame + shift &&
      f <= selRect.endFrame + shift
    );
  }
```

- [ ] **Step 4: Replace `rowDown`**

```ts
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
```

- [ ] **Step 5: Replace `rowMove`**

```ts
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
```

- [ ] **Step 6: Replace `rowUp`**

```ts
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
```

- [ ] **Step 7: Remove the dead move-ghost ring on cells**

In the layer-row cell `{#each}`, delete the `class:ring-2` / `class:ring-accent` / `class:ring-inset` bindings that referenced `dragMode === "move"` and `dragTarget` (that mode no longer exists). Keep the `class:bg-selection={inSelection(layer.id, f)}` binding (it now shows the move ghost).

- [ ] **Step 8: Hide the action bar during a move**

In the `<TimelineSelectionBar … />` render, pass `null` for `rect` while a move is in progress so the bar doesn't jump with the ghost:

```svelte
    <TimelineSelectionBar
      container={gridWrapper}
      rect={dragMode === "moveblock" ? null : selRect}
      cellW={CELL_W}
      labelW={LABEL_W}
    />
```

- [ ] **Step 9: Verify build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → still passing (no new unit tests here).

- [ ] **Step 10: Browser verification (user-deferred checklist — do NOT run a browser)**

Record for the user via `npm run dev`:
- Tap a key → it selects (1×1) and the playhead jumps to it.
- Drag a selected key/block left/right → the highlight ghosts to the drop; on release the keys move (overwrite), clamped at frame 0, padding past the end; undo restores in one step; the selection follows.
- Drag an unselected key → it becomes the selection and moves.
- Drag from an empty cell → marquee; long-press-then-drag → marquee (touch); shift/ctrl-click → extend.
- Tap an empty cell → clears the selection; the body no longer scrubs.
- Span-edge resize still works; the action bar hides during a move and returns after.

- [ ] **Step 11: Commit**

```bash
git add src/lib/Timeline.svelte
git commit -m "feat: selection-first timeline gestures (tap-select, drag-move block, marquee)"
```

---

## Task 4: Draggable playhead line (body scrub)

**Files:**
- Modify: `src/lib/Timeline.svelte` (script: add line-scrub handlers; markup: the playhead-line div ~L570)

**Interfaces:**
- Consumes: `gridWrapper`, `go`, `columnAtX`, `CELL_W`, `LABEL_W`.
- Produces: a draggable playhead line that scrubs.

DOM code — build + browser verified.

- [ ] **Step 1: Add line-scrub handlers**

In the script:

```ts
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
```

- [ ] **Step 2: Make the playhead line a draggable hit-strip**

Change the playhead-line div (currently `class="absolute top-0 bottom-0 w-0.5 bg-accent pointer-events-none z-10"`) into a slightly wider, interactive strip centered on the same x. Replace it with:

```svelte
    <!-- playhead line — draggable to scrub the body -->
    <div
      class="absolute top-0 bottom-0 z-[15] flex justify-center"
      style="left: {LABEL_W + appState.playhead * CELL_W + CELL_W / 2 - 4}px; width: 8px; touch-action: none; cursor: col-resize"
      onpointerdown={lineDown}
      onpointermove={lineMove}
      onpointerup={lineUp}
      onpointercancel={lineUp}
    >
      <div class="w-0.5 h-full bg-accent"></div>
    </div>
```

- [ ] **Step 3: Verify build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → still passing.

- [ ] **Step 4: Browser verification (user-deferred checklist — do NOT run a browser)**

Record for the user via `npm run dev`:
- Grabbing the playhead line in the track body and dragging scrubs the playhead; the ruler still scrubs.
- **Known tradeoff to eyeball:** the 8px hit-strip sits on the current-frame column, so a tap that lands exactly on the playhead column scrubs rather than selecting a key there. Confirm this reads acceptably; if not, the fallback is ruler-only scrub (remove the strip's pointer handlers). Note it to the user.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Timeline.svelte
git commit -m "feat: draggable playhead line scrubs the timeline body"
```

---

## Final verification

- [ ] **Full build:** `npm run build` → 0 errors, 0 warnings.
- [ ] **Full tests:** `npm test` → baseline 308 + the new `moveBlockFrames` tests passing.
- [ ] **Interactive pass (flag as verification debt):** the whole gesture model — tap-select+seek, drag-move (overwrite, clamp, past-end, selection-follows, undo), drag-unselected reselect, marquee (drag-empty + long-press + shift/ctrl), empty-tap deselect, span resize, playhead-line + ruler scrub, action-bar-hide during move, iPad/Pencil parity.

---

## Spec coverage self-check

- Selection-first gesture model (D1, D4–D8) → Task 3 (+ Task 4 playhead scrub).
- Frames-only overwrite move + clamp + pad + selection-follows (D2, D3, D9) → Task 1 (`moveBlockFrames`) + Task 2 (`moveTimelineSelection`).
- Drag-unselected-key reselects (D7) → Task 3 `rowDown` (`!inSelection` → set 1×1 + move).
- Live ghost + hide action bar (D9) → Task 3 `inSelection` shift + bar `rect` prop.
- Seek relocation to ruler + playhead line (D4) → Task 3 removes body seek; Task 4 adds line scrub (ruler unchanged).
- Shared `overwriteColumn` (spec's refactor note) → Task 1.
- Deferred (cross-layer move, ripple move, non-contiguous) → not implemented, per spec Non-goals.
