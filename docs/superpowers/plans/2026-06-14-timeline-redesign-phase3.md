# Timeline Redesign — Phase 3 (Drag Interactions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the timeline cell strips, let the artist drag a keyframe (◆) to move it and drag a keyframe's right edge to resize its hold span — with one undo entry per drag — while a plain click/drag still scrubs the playhead.

**Architecture:** Each drawing-layer row becomes a single pointer-interaction track (sharing the existing `CELL_W`/`LABEL_W` geometry). A pure `planCellPointer()` classifies a pointer-down into seek / move / resize from the cell model + x-offset. Moves apply on drop (`moveKeyframe`, wrapped in `commitStructural`); resizes apply live (`setHoldSpan` on each move) and push **one** undo via new `beginStructuralEdit()`/`commitStructuralEdit()` tokens. The ops (`moveKeyframe`, `setHoldSpan`) already exist and are unit-tested from Phase 1.

**Tech Stack:** Svelte 5 (no-runes component — imports the `state` proxy), TypeScript 5.9, Tailwind 4, Vitest. Pointer Events with capture + `touch-action: none` (iPad).

**Spec:** `docs/superpowers/specs/2026-06-14-timeline-redesign-design.md` (Phase 3 row + "Drag interactions").

---

## Context the implementer needs

- `Cell = { kind: "key"; canvas } | { kind: "hold" }`. `resolveKeyframeIndex(cells, f)` → nearest key index at/before `f`, or null (null past the layer's end). A keyframe's **span** = the key cell plus its trailing holds up to the next key (or end).
- `moveKeyframe(layer, from, to)` — move a key (source→hold; swap if `to` is a key; extend if `to` past end). `setHoldSpan(layer, keyFrame, span)` — set how many cells a key occupies (key + trailing holds, floored at 1); grows by inserting holds (pushing later keys right), shrinks by removing trailing holds; never deletes the next key. Both are pure, already in `src/anim/timeline.ts`, already tested.
- `columnAtX(offsetX, cellW, count)` exists in `src/lib/timeline-grid.ts` (clamps to `[0,count-1]`).
- `commitStructural(mutate)` (appState) wraps a synchronous structural edit in one undo. `bump()` recomputes document length + clamps the playhead and re-renders.
- The current `src/lib/Timeline.svelte` renders each drawing-layer row as per-frame `<button onclick={() => go(f)}>` cells. This plan replaces those buttons with one pointer track per row (display cells inside).
- **Svelte 5 footgun:** this file imports a binding named `state`, so `$state` runes misparse — use plain `let`/functions only (the file already does).

**Run tests:** `npm test` (Vitest). **Build:** `npm run build` (svelte-check + tsc + vite). Both must be green after each task.

---

### Task 1: `planCellPointer` — classify a cell-strip pointer-down

**Files:**
- Modify: `src/lib/timeline-grid.ts` (add `CellPointer` type + `planCellPointer`)
- Test: `src/__tests__/timeline-grid.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/timeline-grid.test.ts` (and update its import line to `import { columnAtX, planCellPointer } from "../lib/timeline-grid";` and add `import type { Cell } from "../anim/document";` if not present):

```ts
describe("planCellPointer", () => {
  const W = 24;
  const k = (): Cell => ({ kind: "key", canvas: {} as HTMLCanvasElement });
  const h = (): Cell => ({ kind: "hold" });

  it("seeks on an empty cell (no keyframe at or before it)", () => {
    expect(planCellPointer([h(), h()], 5, W, 2)).toEqual({ kind: "seek", frame: 0 });
  });

  it("seeks when the pointer is on a hold cell's body", () => {
    expect(planCellPointer([k(), h(), h(), k()], 30, W, 4)).toEqual({ kind: "seek", frame: 1 });
  });

  it("moves when the pointer grabs a keyframe cell's body", () => {
    expect(planCellPointer([k(), h(), h(), k()], 5, W, 4)).toEqual({ kind: "move", keyIndex: 0 });
  });

  it("resizes when the pointer is near the right edge of a key's span", () => {
    // span [0..2] (key 0 + holds 1,2), next key at 3 → span end column = 3 → right edge x = 72
    expect(planCellPointer([k(), h(), h(), k()], 71, W, 4)).toEqual({ kind: "resize", keyIndex: 0 });
  });

  it("resizes at the right edge of a single-cell keyframe", () => {
    expect(planCellPointer([k()], 22, W, 1)).toEqual({ kind: "resize", keyIndex: 0 });
  });

  it("seeks past the layer's own end", () => {
    expect(planCellPointer([k()], 90, W, 4)).toEqual({ kind: "seek", frame: 3 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/__tests__/timeline-grid.test.ts`
Expected: FAIL — `planCellPointer` not exported.

- [ ] **Step 3: Implement**

In `src/lib/timeline-grid.ts`, add (the file already imports nothing from document — add the import):

```ts
import { resolveKeyframeIndex, type Cell } from "../anim/document";

/** What a pointer-down on a cell strip means. */
export type CellPointer =
  | { kind: "seek"; frame: number }
  | { kind: "move"; keyIndex: number }
  | { kind: "resize"; keyIndex: number };

const EDGE_PX = 5; // hotspot width at a span's right edge

/**
 * Classify a pointer-down at horizontal `offsetX` (px from the track's left edge):
 * - near a keyframe span's right edge → resize that key's hold span
 * - on the keyframe cell itself → move that key
 * - otherwise → seek to the column.
 */
export function planCellPointer(cells: Cell[], offsetX: number, cellW: number, count: number): CellPointer {
  const frame = columnAtX(offsetX, cellW, count);
  const ki = resolveKeyframeIndex(cells, frame);
  if (ki !== null) {
    let end = ki + 1; // exclusive end of this key's span
    while (end < cells.length && cells[end].kind !== "key") end++;
    if (Math.abs(offsetX - end * cellW) <= EDGE_PX) return { kind: "resize", keyIndex: ki };
    if (frame === ki) return { kind: "move", keyIndex: ki };
  }
  return { kind: "seek", frame };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/__tests__/timeline-grid.test.ts`
Expected: PASS (6 new + existing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeline-grid.ts src/__tests__/timeline-grid.test.ts
git commit -m "feat: planCellPointer classifies cell-strip pointer-down (seek/move/resize)"
```

---

### Task 2: single-undo edit tokens for live drags

**Files:**
- Modify: `src/state/appState.svelte.ts` (export `StructSnapshot` type; add `beginStructuralEdit`/`commitStructuralEdit`; refactor `commitStructural` to use them)

A live resize mutates on every pointermove but must produce **one** undo entry. These two functions bracket a multi-event drag: snapshot at drag start, push the swap command at drag end.

- [ ] **Step 1: Implement**

In `src/state/appState.svelte.ts`, change the `StructSnapshot` interface declaration to be exported:

```ts
export interface StructSnapshot {
  layers: Layer[];
  frameCount: number;
  activeLayerId: number;
  playhead: number;
}
```

Then replace the existing `commitStructural` function with these three:

```ts
/** Begin a multi-event structural edit (e.g. a drag): capture the before-state. */
export function beginStructuralEdit(): StructSnapshot {
  return snapshotStructure();
}

/** Finish a structural edit started with beginStructuralEdit: push one undo command. */
export function commitStructuralEdit(before: StructSnapshot): void {
  const after = snapshotStructure();
  history.push({
    undo: () => restoreStructure(before),
    redo: () => restoreStructure(after),
  });
}

/**
 * Run a synchronous structural mutation and make it undoable by snapshotting the document
 * structure before and after. Use for layer- and frame-level edits; pixel edits keep their
 * own getImageData/putImageData commands. Structural and pixel commands share the same undo
 * stack and interleave correctly because snapshots keep the same canvas references.
 */
export function commitStructural(mutate: () => void): void {
  const before = beginStructuralEdit();
  mutate();
  bump(); // refresh document length + clamp playhead, then bump version
  commitStructuralEdit(before);
}
```

(The existing `snapshotStructure`/`restoreStructure` helpers and the `StructSnapshot` shape are unchanged except for the `export` keyword.)

- [ ] **Step 2: Typecheck + tests**

Run: `npm run build`
Expected: GREEN (svelte-check + tsc + vite). No behavior change for existing callers of `commitStructural`.

Run: `npm test`
Expected: all green (unchanged count — this is state glue, not unit-tested in this repo, consistent with the existing undo code).

- [ ] **Step 3: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat: beginStructuralEdit/commitStructuralEdit for single-undo drags"
```

---

### Task 3: cell-strip drag interactions (move keyframe, resize hold span, scrub)

**Files:**
- Modify: `src/lib/Timeline.svelte` (imports, drag state + handlers, replace the layer-row cell buttons with a pointer track)

Verified by build + manual in-browser check (pointer UI; the underlying ops are already unit-tested).

- [ ] **Step 1: Update the imports**

In `src/lib/Timeline.svelte`, change these import lines:

```ts
  import { state, canvasOps, activeLayer, bump, history, commitStructural } from "../state/appState.svelte";
  import { addFrame, insertKeyframe, duplicateKeyframe, setHold, deleteFrame, ensureDrawableKeyframe } from "../anim/timeline";
  import { resolveKeyframeIndex, type Cell } from "../anim/document";
  import { columnAtX } from "./timeline-grid";
```

to:

```ts
  import { state, canvasOps, activeLayer, bump, history, commitStructural,
           beginStructuralEdit, commitStructuralEdit, type StructSnapshot } from "../state/appState.svelte";
  import { addFrame, insertKeyframe, duplicateKeyframe, setHold, deleteFrame, ensureDrawableKeyframe,
           moveKeyframe, setHoldSpan } from "../anim/timeline";
  import { resolveKeyframeIndex, type Cell, type DrawingLayer } from "../anim/document";
  import { columnAtX, planCellPointer } from "./timeline-grid";
```

- [ ] **Step 2: Add the drag state + handlers**

In the `<script>`, immediately AFTER the `rulerKey` function (around line 61), add:

```ts
  // Cell-strip pointer interaction: drag a ◆ to move it, drag a span's right edge to resize
  // its hold span, click/drag elsewhere to scrub the playhead. Pointer capture + touch-action
  // keep drags alive and stop the page from panning on iPad.
  type DragMode = "none" | "seek" | "move" | "resize";
  let dragMode: DragMode = "none";
  let dragLayerId = -1;
  let dragKey = -1;      // keyIndex being moved or resized
  let dragTarget = -1;   // current target column (move ghost)
  let dragUndo: StructSnapshot | null = null;
  let rowCursor = "default";

  function rowOffset(e: PointerEvent): number {
    return e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left;
  }
  function rowColumn(e: PointerEvent): number {
    return columnAtX(rowOffset(e), CELL_W, state.project.frameCount);
  }

  function rowDown(e: PointerEvent, layer: DrawingLayer) {
    state.activeLayerId = layer.id;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragLayerId = layer.id;
    const plan = planCellPointer(layer.cells, rowOffset(e), CELL_W, state.project.frameCount);
    if (plan.kind === "resize") {
      dragMode = "resize";
      dragKey = plan.keyIndex;
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
      // Hover affordance: show the resize/move cursor under the pointer.
      const plan = planCellPointer(layer.cells, rowOffset(e), CELL_W, state.project.frameCount);
      rowCursor = plan.kind === "resize" ? "ew-resize" : plan.kind === "move" ? "grab" : "default";
      return;
    }
    if (dragLayerId !== layer.id) return;
    if (dragMode === "seek") go(rowColumn(e));
    else if (dragMode === "move") dragTarget = rowColumn(e);
    else if (dragMode === "resize") {
      setHoldSpan(layer, dragKey, Math.max(1, rowColumn(e) - dragKey + 1)); // live
      bump();
    }
  }
  function rowUp(e: PointerEvent, layer: DrawingLayer) {
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (dragMode === "move" && dragLayerId === layer.id) {
      if (dragTarget >= 0 && dragTarget !== dragKey) commitStructural(() => moveKeyframe(layer, dragKey, dragTarget));
      else go(dragKey); // a click on a keyframe with no drag → seek to it
    } else if (dragMode === "resize" && dragLayerId === layer.id && dragUndo) {
      commitStructuralEdit(dragUndo); // one undo entry for the whole resize drag
    }
    dragMode = "none";
    dragLayerId = -1;
    dragKey = -1;
    dragTarget = -1;
    dragUndo = null;
  }
  function rowLeave() {
    if (dragMode === "none") rowCursor = "default";
  }
```

- [ ] **Step 3: Replace the layer-row cell markup**

In the template, replace this block:

```svelte
        {#if layer.kind === "draw"}
          <div class="flex">
            {#each Array(state.project.frameCount) as _, f}
              <button
                class="box-border h-6 border border-border leading-none text-xs"
                class:bg-selection={f === state.playhead}
                class:text-accent-text={f === state.playhead}
                style="width: {CELL_W}px"
                onclick={() => go(f)}>{cellLabel(layer.cells, f, state.version)}</button>
            {/each}
          </div>
        {:else}
```

with:

```svelte
        {#if layer.kind === "draw"}
          <div class="flex select-none" style="touch-action: none; cursor: {rowCursor}"
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
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run build`
Expected: GREEN with **0 errors and 0 warnings**. Note: `role="application"` on the track satisfies svelte-check's `a11y_no_static_element_interactions` (a div with pointer handlers needs an interactive role); scrubbing is still accessible via the ruler slider + global frame-step keys. If a different valid role builds cleaner, use it — but the build must be warning-free.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: all green (Task 1's 6 new tests included; no Timeline unit tests).

- [ ] **Step 6: Manual verification** (`npm run dev`, and on iPad via `npm run dev:lan`)

1. **Move a keyframe:** press a `◆` and drag sideways → a ring outlines the target column; release → the keyframe moves there (`moveKeyframe`); dropping on another `◆` swaps them; dropping past the end extends the layer. **Ctrl+Z** restores the original position (one undo).
2. **Resize a hold span:** hover the right edge of a keyframe's span → cursor becomes `↔`; drag right → the span grows (holds inserted, later keyframes pushed right) live; drag left → it shrinks; it never eats the next keyframe. **Ctrl+Z** reverts the whole resize in one step.
3. **Scrub:** press-drag on an empty/hold cell → the playhead follows (like the ruler); a plain click on any cell jumps the playhead; clicking a `◆` jumps to it.
4. **Active layer:** pressing any row's cells makes that layer active (its row brightens).
5. **iPad:** dragging a keyframe / edge / scrub works with touch and doesn't scroll the page.

- [ ] **Step 7: Commit**

```bash
git add src/lib/Timeline.svelte
git commit -m "feat: drag keyframes to move + drag span edge to resize hold (single undo)"
```

---

## Final verification

- [ ] `npm test` → all green (6 new from Task 1).
- [ ] `npm run build` → svelte-check + tsc + vite green, 0 warnings.
- [ ] Manual: move, resize (live, single undo), scrub, click-seek, active-layer select, iPad touch.

---

## Self-Review (completed by plan author)

**Spec coverage (Phase 3 = "drag keyframes (`moveKeyframe`) and drag hold-span edges (`setHoldSpan`), with throttled live updates and drop affordances"):**
- Drag keyframe to move → Task 1 (classify) + Task 3 (move on drop + ghost ring). ✓
- Drag right edge to resize hold span → Task 1 (resize classify) + Task 3 (live `setHoldSpan`). ✓
- Drop affordances → ring ghost (move) + `↔` cursor (resize edge). ✓
- Single undo per drag → Task 2 tokens (resize) + `commitStructural` (move). ✓
- Existing scrub / click-seek preserved → Task 3 seek branch. ✓

**Type/name consistency:** `planCellPointer(cells, offsetX, cellW, count): CellPointer{seek|move|resize}`; `beginStructuralEdit(): StructSnapshot` / `commitStructuralEdit(before)`; `moveKeyframe(layer, from, to)` / `setHoldSpan(layer, keyFrame, span)` (Phase-1 signatures); `rowDown/rowMove/rowUp/rowLeave` consistent across script + template; `CELL_W`/`columnAtX` reused for geometry.

**Risks / notes:**
- Live `setHoldSpan` keeps the key at `dragKey` (it only inserts/removes trailing holds), so the index stays valid through the drag.
- Move applies on drop (not live) to avoid mid-drag swap/extend churn; the ring shows the target.
- `role="application"` is the chosen a11y resolution for the interactive track; flagged for warning-free build.
- `columnAtX` clamps to `[0, count-1]`, so a keyframe can't be dropped/resized beyond the current document length in one gesture (extend with Add-frame first) — acceptable for Phase 3.
