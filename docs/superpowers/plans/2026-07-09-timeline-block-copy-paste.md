# Timeline Block Copy/Paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select a rectangular block of cells in the timeline (frames × layers) and copy / cut / paste (overwrite or insert) / delete it, generalizing the existing adjacent-only "duplicate keyframe".

**Architecture:** Pure, DOM-free block logic lives in new `src/anim/timeline-block.ts` and selection-rect derivation in new `src/anim/timeline-selection.ts` (both node-unit-tested with a fake `CanvasOps`, exactly like `src/anim/timeline.ts`). Transient state (`cellClipboard`, `timelineSelection`) and the copy/cut/paste/delete actions live in `src/state/appState.svelte.ts`. The long-press/Shift-click gesture, selection highlight, and floating action bar live in `src/lib/Timeline.svelte` (+ a small `TimelineSelectionBar.svelte`). Keyboard shortcuts and the `Cmd+V`-vs-image-paste disambiguation live in `src/App.svelte`.

**Tech Stack:** Svelte 5 (runes mode), TypeScript, Vite, Vitest (node env, no DOM), Tailwind 4.

## Global Constraints

- Build bar for every change: `npm run build` (= `svelte-check && tsc --noEmit && vite build`) must be **0 errors, 0 warnings**.
- Test baseline ~**280 passing**; new pure-logic tests add to this. `npm test` (Vitest, node env — no DOM/canvas).
- **Runes-mode import-alias rule** (gotcha #1): any component using the `$state` rune must
  `import { state as appState }` (never `import { state }`) from `appState.svelte`. `Timeline.svelte`
  and `App.svelte` already alias to `appState`. Use `appState.` in those files.
- **Undo-snapshot invariant #8:** structural mutations must **replace** a cell
  (`layer.cells[i] = {...}`), **never mutate in place** (`cell.foo = ...`). Undo snapshots share
  canvas refs, so a pasted cell must be a fresh object with a **cloned** canvas + cloned
  `transform`/`transformBox`.
- **Lift-lifecycle invariant #9:** any op that replaces/removes the active cell's canvas must call
  `liftGuard.discard?.()` first. Paste/cut/delete do this.
- All structural, undoable mutations go through `commitStructural(() => …)` (snapshots before/after,
  refreshes length, clamps playhead, bumps version).
- Reference layers are excluded from all block ops (drawing layers only), matching existing timeline tools.
- Fixed grid geometry in `Timeline.svelte`: `CELL_W = 24`, `LABEL_W = 80`. Rows are `h-6` (24px).

---

## File Structure

- **Create** `src/anim/timeline-block.ts` — `CellBlock` type, `cloneCell`, `copyBlock`,
  `drawingLayerIdsDown`, `pasteBlockOverwrite`, `pasteBlockInsert`, `deleteBlock`.
- **Create** `src/__tests__/timeline-block.test.ts` — unit tests for the above (fake `CanvasOps`).
- **Create** `src/anim/timeline-selection.ts` — `SelectionEndpoint`, `TimelineSelection`,
  `SelectionRect`, `resolveSelectionRect`.
- **Create** `src/__tests__/timeline-selection.test.ts` — unit tests for `resolveSelectionRect`.
- **Modify** `src/state/appState.svelte.ts` — add `timelineSelection` + `cellClipboard` state and the
  actions `setTimelineSelection`, `clearTimelineSelection`, `copyTimelineSelection`,
  `cutTimelineSelection`, `deleteTimelineSelection`, `pasteCells`; clear selection on structural edits.
- **Create** `src/lib/TimelineSelectionBar.svelte` — the floating Copy/Cut/Paste/Insert/Delete bar.
- **Modify** `src/lib/Timeline.svelte` — long-press + Shift-click select gesture, `data-layer-id` on
  rows, selection highlight, render `TimelineSelectionBar`.
- **Modify** `src/App.svelte` — keyboard shortcuts + `onPaste` disambiguation flag.

---

## Task 1: `CellBlock` type, `cloneCell`, and `copyBlock`

**Files:**
- Create: `src/anim/timeline-block.ts`
- Test: `src/__tests__/timeline-block.test.ts`

**Interfaces:**
- Consumes: `Cell`, `Project`, `CanvasOps` (from `timeline.ts`), `resolvedKeyCell` (from `document.ts`).
- Produces:
  - `interface CellBlock { cols: number; rows: number; columns: Cell[][] }`
  - `function cloneCell(cell: Cell, ops: CanvasOps): Cell`
  - `function copyBlock(project: Project, layerIds: number[], startFrame: number, endFrame: number, ops: CanvasOps): CellBlock`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/timeline-block.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Cell, DrawingLayer, Project, ReferenceLayer } from "../anim/document";
import { defaultBoilConfig } from "../anim/document";
import type { CanvasOps } from "../anim/timeline";
import { cloneCell, copyBlock } from "../anim/timeline-block";

// Fake canvases tagged so we can assert identity/cloning without the DOM.
let tag = 0;
const fakeOps: CanvasOps = {
  create: () => ({ __id: ++tag }) as unknown as HTMLCanvasElement,
  clone: (src) =>
    ({ __cloneOf: (src as unknown as { __id: number }).__id, __id: ++tag }) as unknown as HTMLCanvasElement,
};
const cloneOf = (c: HTMLCanvasElement) => (c as unknown as { __cloneOf?: number }).__cloneOf;
const idOf = (c: HTMLCanvasElement) => (c as unknown as { __id: number }).__id;
const key = (canvas = fakeOps.create()): Cell => ({ kind: "key", canvas });
const hold = (): Cell => ({ kind: "hold" });

function drawLayer(id: number, cells: Cell[]): DrawingLayer {
  return {
    kind: "draw", id, name: `L${id}`, visible: true, locked: false, opacity: 100,
    boilStrength: 1, groupId: null, cells, transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  };
}
function proj(layers: (DrawingLayer | ReferenceLayer)[], frameCount: number): Project {
  return {
    width: 100, height: 100, fps: 12, bgColor: "#fff", frameCount,
    boil: defaultBoilConfig(), groups: [], layers, audio: null,
  };
}

describe("copyBlock", () => {
  it("materializes a leading hold into a cloned KEY of the resolved drawing", () => {
    const k = fakeOps.create();
    const l = drawLayer(1, [key(k), hold(), hold()]);
    const block = copyBlock(proj([l], 3), [1], 1, 2, fakeOps); // rows starting on a hold
    expect(block.cols).toBe(1);
    expect(block.rows).toBe(2);
    const c0 = block.columns[0][0];
    expect(c0.kind).toBe("key");
    if (c0.kind === "key") expect(cloneOf(c0.canvas)).toBe(idOf(k)); // leading hold → cloned key
    expect(block.columns[0][1]).toEqual({ kind: "hold" }); // interior hold preserved
  });

  it("clones an interior KEY and preserves per-cell transform/transformBox", () => {
    const k = fakeOps.create();
    const tf = { dx: 5, dy: 6, scale: 2, rotation: 1 };
    const box = { x: 1, y: 2, w: 3, h: 4 };
    const l = drawLayer(1, [{ kind: "key", canvas: k, transform: tf, transformBox: box }]);
    const block = copyBlock(proj([l], 1), [1], 0, 0, fakeOps);
    const c = block.columns[0][0];
    expect(c.kind).toBe("key");
    if (c.kind === "key") {
      expect(cloneOf(c.canvas)).toBe(idOf(k));
      expect(c.transform).toEqual(tf);
      expect(c.transform).not.toBe(tf); // deep-cloned, not shared
      expect(c.transformBox).toEqual(box);
      expect(c.transformBox).not.toBe(box);
    }
  });

  it("materializes a blank leading cell (no resolved key) into a fresh blank KEY", () => {
    const l = drawLayer(1, [hold(), hold()]);
    const block = copyBlock(proj([l], 2), [1], 0, 1, fakeOps);
    const c = block.columns[0][0];
    expect(c.kind).toBe("key");
    if (c.kind === "key") expect(cloneOf(c.canvas)).toBeUndefined(); // fresh create, not a clone
  });

  it("produces one column per layer id, in the given order", () => {
    const a = drawLayer(1, [key()]);
    const b = drawLayer(2, [key()]);
    const block = copyBlock(proj([a, b], 1), [2, 1], 0, 0, fakeOps);
    expect(block.cols).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/timeline-block.test.ts`
Expected: FAIL — `Cannot find module '../anim/timeline-block'` / exports not defined.

- [ ] **Step 3: Write minimal implementation**

Create `src/anim/timeline-block.ts`:

```ts
import { resolvedKeyCell, type Cell, type Project } from "./document";
import type { CanvasOps } from "./timeline";

/** A rectangular block of cells copied from the timeline. cols = layers (top-first),
 *  rows = frames (earliest-first). Every KEY canvas/transform is deep-cloned, and each column
 *  starts with a KEY (leading holds are materialized on copy) so the block is self-contained. */
export interface CellBlock {
  cols: number;
  rows: number;
  columns: Cell[][]; // columns[c][r]; length cols, each length rows
}

/** Deep-clone a cell: fresh canvas + cloned transform/transformBox (never share refs). */
export function cloneCell(cell: Cell, ops: CanvasOps): Cell {
  if (cell.kind === "hold") return { kind: "hold" };
  const out: Cell = { kind: "key", canvas: ops.clone(cell.canvas) };
  if (cell.transform) out.transform = { ...cell.transform };
  if (cell.transformBox !== undefined)
    out.transformBox = cell.transformBox ? { ...cell.transformBox } : cell.transformBox;
  return out;
}

/** Extract a self-contained block. `layerIds` top-first; frames inclusive [startFrame, endFrame]. */
export function copyBlock(
  project: Project,
  layerIds: number[],
  startFrame: number,
  endFrame: number,
  ops: CanvasOps,
): CellBlock {
  const rows = endFrame - startFrame + 1;
  const columns: Cell[][] = [];
  for (const id of layerIds) {
    const layer = project.layers.find((l) => l.id === id);
    if (!layer || layer.kind !== "draw") continue;
    const col: Cell[] = [];
    for (let r = 0; r < rows; r++) {
      const f = startFrame + r;
      if (r === 0) {
        // Materialize the leading cell into a self-contained KEY (resolve holds to their key).
        const rk = resolvedKeyCell(layer, f);
        col.push(rk ? cloneCell(rk.cell, ops) : { kind: "key", canvas: ops.create() });
      } else {
        const cell = layer.cells[f];
        col.push(!cell || cell.kind === "hold" ? { kind: "hold" } : cloneCell(cell, ops));
      }
    }
    columns.push(col);
  }
  return { cols: columns.length, rows, columns };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/timeline-block.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/anim/timeline-block.ts src/__tests__/timeline-block.test.ts
git commit -m "feat: copyBlock + cloneCell (self-contained cell block extraction)"
```

---

## Task 2: `drawingLayerIdsDown` + `pasteBlockOverwrite`

**Files:**
- Modify: `src/anim/timeline-block.ts`
- Test: `src/__tests__/timeline-block.test.ts`

**Interfaces:**
- Consumes: `CellBlock`, `cloneCell`, `Project`, `CanvasOps`.
- Produces:
  - `function drawingLayerIdsDown(project: Project, topLayerId: number): number[]`
  - `function pasteBlockOverwrite(project: Project, block: CellBlock, targetTopLayerId: number, startFrame: number, ops: CanvasOps): void`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/timeline-block.test.ts`:

```ts
import { drawingLayerIdsDown, pasteBlockOverwrite } from "../anim/timeline-block";

describe("drawingLayerIdsDown", () => {
  it("lists drawing layers from the active layer downward (toward bottom of stack), skipping refs", () => {
    // layers[0] = bottom of stack. Display top-first = reversed. "Down" from a layer = toward bottom.
    const bottom = drawLayer(1, [key()]);
    const mid = drawLayer(2, [key()]);
    const top = drawLayer(3, [key()]);
    const p = proj([bottom, mid, top], 1); // stack bottom→top: 1,2,3
    expect(drawingLayerIdsDown(p, 3)).toEqual([3, 2, 1]); // from top downward
    expect(drawingLayerIdsDown(p, 2)).toEqual([2, 1]);
    expect(drawingLayerIdsDown(p, 99)).toEqual([]); // unknown layer
  });
});

describe("pasteBlockOverwrite", () => {
  it("stamps cells in place without changing track length; trailing hold now resolves to new key", () => {
    const orig = fakeOps.create();
    const l = drawLayer(1, [key(orig), hold(), hold()]); // [A][A·][A·]
    const src = fakeOps.create();
    const block = copyBlock(proj([drawLayer(9, [key(src)])], 1), [9], 0, 0, fakeOps); // 1x1 X
    pasteBlockOverwrite(proj([l], 3), block, 1, 1, fakeOps); // overwrite frame 1
    expect(l.cells.length).toBe(3); // length unchanged
    const c1 = l.cells[1];
    expect(c1.kind).toBe("key");
    if (c1.kind === "key") expect(cloneOf(c1.canvas)).toBe(idOf(src));
    expect(l.cells[2]).toEqual({ kind: "hold" }); // trailing hold now holds the pasted key
  });

  it("pads with holds when the paste lands past the layer's end", () => {
    const l = drawLayer(1, [key()]); // length 1
    const block = copyBlock(proj([drawLayer(9, [key()])], 1), [9], 0, 0, fakeOps);
    pasteBlockOverwrite(proj([l], 1), block, 1, 3, fakeOps); // land at frame 3
    expect(l.cells.length).toBe(4);
    expect(l.cells[1]).toEqual({ kind: "hold" });
    expect(l.cells[2]).toEqual({ kind: "hold" });
    expect(l.cells[3].kind).toBe("key");
  });

  it("ignores overflow columns past the bottom layer", () => {
    const only = drawLayer(1, [key()]);
    const block = copyBlock(
      proj([drawLayer(8, [key()]), drawLayer(9, [key()])], 1), [9, 8], 0, 0, fakeOps,
    ); // 2 columns
    pasteBlockOverwrite(proj([only], 1), block, 1, 0, fakeOps); // only 1 target layer
    expect(only.cells.length).toBe(1); // second column silently ignored, no crash
  });

  it("clones out of the clipboard so two pastes never share a canvas ref", () => {
    const a = drawLayer(1, [key()]);
    const b = drawLayer(2, [key()]);
    const block = copyBlock(proj([drawLayer(9, [key()])], 1), [9], 0, 0, fakeOps);
    pasteBlockOverwrite(proj([a], 1), block, 1, 0, fakeOps);
    pasteBlockOverwrite(proj([b], 1), block, 2, 0, fakeOps);
    const ca = a.cells[0], cb = b.cells[0];
    if (ca.kind === "key" && cb.kind === "key") expect(ca.canvas).not.toBe(cb.canvas);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/timeline-block.test.ts`
Expected: FAIL — `drawingLayerIdsDown`/`pasteBlockOverwrite` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/anim/timeline-block.ts`:

```ts
/** Drawing-layer ids from `topLayerId` downward through the stack (toward the bottom = display-down),
 *  skipping reference layers. Empty if the id is unknown. Column 0 = the top layer. */
export function drawingLayerIdsDown(project: Project, topLayerId: number): number[] {
  const idx = project.layers.findIndex((l) => l.id === topLayerId);
  if (idx < 0) return [];
  const ids: number[] = [];
  for (let i = idx; i >= 0; i--) if (project.layers[i].kind === "draw") ids.push(project.layers[i].id);
  return ids;
}

/** Overwrite-paste: stamp `block` in place with column 0 at `targetTopLayerId`, filling downward.
 *  Lands past a layer's end → pad with holds then append. Overflow columns ignored. */
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
    for (let r = 0; r < block.rows; r++) {
      const f = startFrame + r;
      const cell = cloneCell(block.columns[c][r], ops);
      if (f >= layer.cells.length) {
        while (layer.cells.length < f) layer.cells.push({ kind: "hold" });
        layer.cells.push(cell);
      } else {
        layer.cells[f] = cell; // replace, never mutate in place
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/timeline-block.test.ts`
Expected: PASS (all prior + new tests).

- [ ] **Step 5: Commit**

```bash
git add src/anim/timeline-block.ts src/__tests__/timeline-block.test.ts
git commit -m "feat: pasteBlockOverwrite + drawingLayerIdsDown (in-place stamp, downward fill)"
```

---

## Task 3: `pasteBlockInsert`

**Files:**
- Modify: `src/anim/timeline-block.ts`
- Test: `src/__tests__/timeline-block.test.ts`

**Interfaces:**
- Consumes: `CellBlock`, `cloneCell`, `drawingLayerIdsDown`.
- Produces: `function pasteBlockInsert(project: Project, block: CellBlock, targetTopLayerId: number, startFrame: number, ops: CanvasOps): void`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/timeline-block.test.ts`:

```ts
import { pasteBlockInsert } from "../anim/timeline-block";

describe("pasteBlockInsert", () => {
  it("splices cells in on the pasted layer, shifting later cells right (length grows)", () => {
    const a = fakeOps.create();
    const b = fakeOps.create();
    const l = drawLayer(1, [key(a), key(b)]); // [A][B]
    const src = fakeOps.create();
    const block = copyBlock(proj([drawLayer(9, [key(src)])], 1), [9], 0, 0, fakeOps); // X
    pasteBlockInsert(proj([l], 2), block, 1, 1, fakeOps); // insert at frame 1
    expect(l.cells.length).toBe(3); // [A][X][B]
    const c1 = l.cells[1];
    expect(c1.kind).toBe("key");
    if (c1.kind === "key") expect(cloneOf(c1.canvas)).toBe(idOf(src));
    const c2 = l.cells[2];
    if (c2.kind === "key") expect(idOf(c2.canvas)).toBe(idOf(b)); // B shifted right, ref preserved
  });

  it("does not touch a non-pasted layer (pasted-layers-only ripple)", () => {
    const target = drawLayer(1, [key()]);
    const other = drawLayer(2, [key(), key()]);
    const block = copyBlock(proj([drawLayer(9, [key()])], 1), [9], 0, 0, fakeOps);
    pasteBlockInsert(proj([target, other], 2), block, 1, 0, fakeOps); // paste only into layer 1
    expect(other.cells.length).toBe(2); // untouched
  });

  it("pads with holds when inserting past the layer's end", () => {
    const l = drawLayer(1, [key()]); // length 1
    const block = copyBlock(proj([drawLayer(9, [key()])], 1), [9], 0, 0, fakeOps);
    pasteBlockInsert(proj([l], 1), block, 1, 3, fakeOps);
    expect(l.cells.length).toBe(4); // [A][hold][hold][X]
    expect(l.cells[1]).toEqual({ kind: "hold" });
    expect(l.cells[3].kind).toBe("key");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/timeline-block.test.ts`
Expected: FAIL — `pasteBlockInsert` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/anim/timeline-block.ts`:

```ts
/** Insert-paste: for each pasted layer, splice its column at `startFrame`, shifting later cells
 *  right (pasted layers only). Pads with holds if `startFrame` is past the layer's end. */
export function pasteBlockInsert(
  project: Project,
  block: CellBlock,
  targetTopLayerId: number,
  startFrame: number,
  ops: CanvasOps,
): void {
  const targetIds = drawingLayerIdsDown(project, targetTopLayerId);
  for (let c = 0; c < block.cols; c++) {
    if (c >= targetIds.length) break;
    const layer = project.layers.find((l) => l.id === targetIds[c]);
    if (!layer || layer.kind !== "draw") continue;
    const at = Math.min(startFrame, layer.cells.length);
    while (layer.cells.length < at) layer.cells.push({ kind: "hold" });
    const clones = block.columns[c].map((cell) => cloneCell(cell, ops));
    layer.cells.splice(at, 0, ...clones);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/timeline-block.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/anim/timeline-block.ts src/__tests__/timeline-block.test.ts
git commit -m "feat: pasteBlockInsert (ripple pasted layers only)"
```

---

## Task 4: `deleteBlock`

**Files:**
- Modify: `src/anim/timeline-block.ts`
- Test: `src/__tests__/timeline-block.test.ts`

**Interfaces:**
- Consumes: `Project`.
- Produces: `function deleteBlock(project: Project, layerIds: number[], startFrame: number, endFrame: number): void`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/timeline-block.test.ts`:

```ts
import { deleteBlock } from "../anim/timeline-block";

describe("deleteBlock", () => {
  it("replaces the region with holds, keeping track length", () => {
    const l = drawLayer(1, [key(), key(), key()]);
    deleteBlock(proj([l], 3), [1], 0, 1);
    expect(l.cells.length).toBe(3);
    expect(l.cells[0]).toEqual({ kind: "hold" });
    expect(l.cells[1]).toEqual({ kind: "hold" });
    expect(l.cells[2].kind).toBe("key"); // outside the region, untouched
  });

  it("clamps to the track end and skips reference/missing layers", () => {
    const l = drawLayer(1, [key(), key()]);
    deleteBlock(proj([l], 2), [1, 99], 0, 10); // endFrame past end; id 99 missing
    expect(l.cells.length).toBe(2);
    expect(l.cells[0]).toEqual({ kind: "hold" });
    expect(l.cells[1]).toEqual({ kind: "hold" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/timeline-block.test.ts`
Expected: FAIL — `deleteBlock` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/anim/timeline-block.ts`:

```ts
/** Replace every cell in the block region with a hold (Delete). Track length is unchanged
 *  (so ≥1 cell per layer is preserved). Skips missing/reference layers. */
export function deleteBlock(
  project: Project,
  layerIds: number[],
  startFrame: number,
  endFrame: number,
): void {
  for (const id of layerIds) {
    const layer = project.layers.find((l) => l.id === id);
    if (!layer || layer.kind !== "draw") continue;
    for (let f = startFrame; f <= endFrame && f < layer.cells.length; f++) {
      layer.cells[f] = { kind: "hold" };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/timeline-block.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/anim/timeline-block.ts src/__tests__/timeline-block.test.ts
git commit -m "feat: deleteBlock (region → holds)"
```

---

## Task 5: `resolveSelectionRect` (selection-rect derivation)

**Files:**
- Create: `src/anim/timeline-selection.ts`
- Test: `src/__tests__/timeline-selection.test.ts`

**Interfaces:**
- Consumes: `Layer`, `isDrawingLayer` (from `document.ts`).
- Produces:
  - `interface SelectionEndpoint { layerId: number; frame: number }`
  - `interface TimelineSelection { anchor: SelectionEndpoint; focus: SelectionEndpoint }`
  - `interface SelectionRect { layerIds: number[]; startFrame: number; endFrame: number }`
  - `function resolveSelectionRect(layers: Layer[], anchor: SelectionEndpoint, focus: SelectionEndpoint): SelectionRect | null`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/timeline-selection.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Cell, DrawingLayer, Layer, ReferenceLayer } from "../anim/document";
import { resolveSelectionRect } from "../anim/timeline-selection";

const key = (): Cell => ({ kind: "key", canvas: {} as unknown as HTMLCanvasElement });
function drawLayer(id: number): DrawingLayer {
  return {
    kind: "draw", id, name: `L${id}`, visible: true, locked: false, opacity: 100,
    boilStrength: 1, groupId: null, cells: [key()], transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  };
}
function refLayer(id: number): ReferenceLayer {
  return {
    kind: "ref", id, name: `R${id}`, visible: true, opacity: 100, offsetFrames: 0, groupId: null,
    media: { type: "missing", was: "image", name: "x" }, transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  };
}

describe("resolveSelectionRect", () => {
  it("orders frames and layers regardless of anchor/focus order (top-first display order)", () => {
    // stack bottom→top: 1,2,3 ; display top-first: 3,2,1
    const layers: Layer[] = [drawLayer(1), drawLayer(2), drawLayer(3)];
    const rect = resolveSelectionRect(layers, { layerId: 1, frame: 5 }, { layerId: 3, frame: 2 });
    expect(rect).toEqual({ layerIds: [3, 2, 1], startFrame: 2, endFrame: 5 });
  });

  it("includes only drawing layers within the span (skips a ref in the middle)", () => {
    const layers: Layer[] = [drawLayer(1), refLayer(2), drawLayer(3)];
    const rect = resolveSelectionRect(layers, { layerId: 3, frame: 0 }, { layerId: 1, frame: 0 });
    expect(rect?.layerIds).toEqual([3, 1]);
  });

  it("returns null when an endpoint layer is missing", () => {
    expect(resolveSelectionRect([drawLayer(1)], { layerId: 1, frame: 0 }, { layerId: 9, frame: 0 })).toBeNull();
  });

  it("returns null when the span contains no drawing layers", () => {
    const layers: Layer[] = [refLayer(1), refLayer(2)];
    expect(resolveSelectionRect(layers, { layerId: 1, frame: 0 }, { layerId: 2, frame: 0 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/timeline-selection.test.ts`
Expected: FAIL — `Cannot find module '../anim/timeline-selection'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/anim/timeline-selection.ts`:

```ts
import { isDrawingLayer, type Layer } from "./document";

export interface SelectionEndpoint {
  layerId: number;
  frame: number;
}
export interface TimelineSelection {
  anchor: SelectionEndpoint;
  focus: SelectionEndpoint;
}
export interface SelectionRect {
  layerIds: number[]; // drawing layers only, top-first display order
  startFrame: number;
  endFrame: number;
}

/** Derive the selection rectangle from two endpoints. Layer axis spans the two endpoint layers
 *  inclusive in display order (top-first = layers reversed), drawing layers only. Returns null if
 *  either endpoint is missing or the span holds no drawing layer. */
export function resolveSelectionRect(
  layers: Layer[],
  anchor: SelectionEndpoint,
  focus: SelectionEndpoint,
): SelectionRect | null {
  const display = [...layers].reverse(); // top-first
  const ai = display.findIndex((l) => l.id === anchor.layerId);
  const fi = display.findIndex((l) => l.id === focus.layerId);
  if (ai < 0 || fi < 0) return null;
  const lo = Math.min(ai, fi);
  const hi = Math.max(ai, fi);
  const layerIds: number[] = [];
  for (let i = lo; i <= hi; i++) if (isDrawingLayer(display[i])) layerIds.push(display[i].id);
  if (layerIds.length === 0) return null;
  return {
    layerIds,
    startFrame: Math.min(anchor.frame, focus.frame),
    endFrame: Math.max(anchor.frame, focus.frame),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/timeline-selection.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/anim/timeline-selection.ts src/__tests__/timeline-selection.test.ts
git commit -m "feat: resolveSelectionRect (endpoint pair → drawing-layer rect)"
```

---

## Task 6: appState — selection + clipboard state and actions

**Files:**
- Modify: `src/state/appState.svelte.ts` (AnimState interface ~L62-80; state literal ~L85-116; add
  actions near the other frame/structural actions; add a clear inside `commitStructural` ~L249-254).

**Interfaces:**
- Consumes: `copyBlock`, `pasteBlockOverwrite`, `pasteBlockInsert`, `deleteBlock`, `CellBlock` (from
  `timeline-block.ts`); `resolveSelectionRect`, `SelectionEndpoint`, `TimelineSelection` (from
  `timeline-selection.ts`); existing `canvasOps`, `commitStructural`, `liftGuard`.
- Produces (all exported):
  - `setTimelineSelection(anchor: SelectionEndpoint, focus: SelectionEndpoint): void`
  - `clearTimelineSelection(): void`
  - `copyTimelineSelection(): void`
  - `cutTimelineSelection(): void`
  - `deleteTimelineSelection(): void`
  - `pasteCells(insert?: boolean): void`
  - State fields `state.timelineSelection: TimelineSelection | null`, `state.cellClipboard: CellBlock | null`.

Note: `appState.svelte.ts` is not node-importable (window/audio at module load) — this task is
**build-verified** (`npm run build`) and reasoning-verified, per the project's verification-debt note.

- [ ] **Step 1: Add imports**

At the top of `src/state/appState.svelte.ts`, alongside the existing `./anim/*` imports, add:

```ts
import {
  copyBlock,
  pasteBlockOverwrite,
  pasteBlockInsert,
  deleteBlock,
  type CellBlock,
} from "../anim/timeline-block";
import { resolveSelectionRect, type SelectionEndpoint, type TimelineSelection } from "../anim/timeline-selection";
```

- [ ] **Step 2: Extend the AnimState interface**

In `interface AnimState { … }` add two fields (after `playback`):

```ts
  timelineSelection: TimelineSelection | null;
  cellClipboard: CellBlock | null;
```

- [ ] **Step 3: Initialize the new state fields**

In the `export const state: AnimState = $state({ … })` literal, after `playback: { … },` add:

```ts
  timelineSelection: null,
  cellClipboard: null,
```

- [ ] **Step 4: Clear the selection on structural edits**

In `commitStructural`, after `bump();` and before `commitStructuralEdit(before);`, add:

```ts
  state.timelineSelection = null; // any structural edit can invalidate stored endpoints
```

(So `pasteCells`/`cutTimelineSelection`/`deleteTimelineSelection`, which read the rect before
mutating, consume-and-clear the selection; other structural edits clear it too.)

- [ ] **Step 5: Add the actions**

Add near the other frame/structural actions (e.g. just after `setActiveLayer`):

```ts
export function setTimelineSelection(anchor: SelectionEndpoint, focus: SelectionEndpoint): void {
  state.timelineSelection = { anchor, focus };
}

export function clearTimelineSelection(): void {
  state.timelineSelection = null;
}

function currentSelectionRect() {
  const sel = state.timelineSelection;
  return sel ? resolveSelectionRect(state.project.layers, sel.anchor, sel.focus) : null;
}

/** Copy the current timeline selection into the internal cell clipboard (non-undoable). */
export function copyTimelineSelection(): void {
  const rect = currentSelectionRect();
  if (!rect) return;
  state.cellClipboard = copyBlock(state.project, rect.layerIds, rect.startFrame, rect.endFrame, canvasOps);
}

/** Replace the selected region with holds (undoable). */
export function deleteTimelineSelection(): void {
  const rect = currentSelectionRect();
  if (!rect) return;
  liftGuard.discard?.(); // may replace the active cell's canvas → discard any live lift first
  commitStructural(() => deleteBlock(state.project, rect.layerIds, rect.startFrame, rect.endFrame));
}

/** Cut = copy then delete. */
export function cutTimelineSelection(): void {
  copyTimelineSelection();
  deleteTimelineSelection();
}

/** Paste the clipboard block with its top-left at (active layer, playhead). Overwrite by default;
 *  `insert = true` ripples the pasted layers right. Undoable. */
export function pasteCells(insert = false): void {
  const block = state.cellClipboard;
  if (!block) return;
  liftGuard.discard?.(); // may replace the active cell's canvas → discard any live lift first
  commitStructural(() => {
    if (insert) pasteBlockInsert(state.project, block, state.activeLayerId, state.playhead, canvasOps);
    else pasteBlockOverwrite(state.project, block, state.activeLayerId, state.playhead, canvasOps);
  });
}
```

- [ ] **Step 6: Clear the selection on project replace / resize**

Find `replaceProject` and the resize action (the function that rebuilds cell canvases on
resize — search for `createCellCanvas(w, h, DPR)` near L614). At the start of each, add:

```ts
  state.timelineSelection = null;
  state.cellClipboard = null; // clipboard canvases belong to the old document size
```

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: 0 errors, 0 warnings.

- [ ] **Step 8: Verify existing tests still pass**

Run: `npm test`
Expected: baseline (~280) + the new block/selection tests all pass.

- [ ] **Step 9: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat: timeline selection + cell clipboard state and copy/cut/paste/delete actions"
```

---

## Task 7: Timeline.svelte — long-press + Shift-click select gesture and highlight

**Files:**
- Modify: `src/lib/Timeline.svelte` (imports ~L14-42; pointer handlers `rowDown`/`rowMove`/`rowUp`
  ~L136-191; row markup ~L484-514).

**Interfaces:**
- Consumes: `setTimelineSelection`, `clearTimelineSelection` (from appState); `resolveSelectionRect`
  (from `timeline-selection.ts`).
- Produces: a `select` `DragMode`; `data-layer-id` on each row grid; a `$derived` `selRect` used for
  highlight + (Task 8) the action bar.

DOM/gesture code — **not** node-testable; build- + browser-verified.

- [ ] **Step 1: Add imports**

In the `appState.svelte` import block add `setTimelineSelection` and `clearTimelineSelection`.
Add a new import line:

```ts
  import { resolveSelectionRect } from "../anim/timeline-selection";
```

- [ ] **Step 2: Add select-mode state + long-press machinery**

Near the other drag state (`let dragMode … `), add:

```ts
  const LONG_PRESS_MS = 400;
  const MOVE_CANCEL_PX = 6; // pointer travel that cancels a pending long-press (= a real drag)
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
    return !!selRect && selRect.layerIds.includes(layerId) && f >= selRect.startFrame && f <= selRect.endFrame;
  }

  /** Which drawing-layer row the pointer is physically over (pointer capture routes all moves to the
   *  origin row, so hit-test by client coords to allow vertical cross-layer selection). */
  function layerIdAtPoint(clientX: number, clientY: number, fallback: number): number {
    const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-layer-id]");
    return el ? Number(el.dataset.layerId) : fallback;
  }
```

Extend the `DragMode` union to include `"select"`:

```ts
  type DragMode = "none" | "seek" | "move" | "resize" | "select";
```

- [ ] **Step 3: Start selection from `rowDown`**

Replace the body of `rowDown` (currently starts with `setActiveLayer(layer.id); …`) so it handles
Shift-click and arms a long-press before the existing seek/move/resize logic:

```ts
  function rowDown(e: PointerEvent, layer: DrawingLayer) {
    setActiveLayer(layer.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragLayerId = layer.id;
    const frame = rowColumn(e);

    // Shift-click extends an existing selection immediately (desktop).
    if (e.shiftKey && appState.timelineSelection) {
      setTimelineSelection(appState.timelineSelection.anchor, { layerId: layer.id, frame });
      dragMode = "select";
      return;
    }

    // Arm a long-press: staying still ~400ms starts a block selection at this cell.
    pressStartX = e.clientX;
    pressStartY = e.clientY;
    cancelLongPress();
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      dragMode = "select";
      setTimelineSelection({ layerId: layer.id, frame }, { layerId: layer.id, frame });
    }, LONG_PRESS_MS);

    const plan = planCellPointer(layer.cells, rowOffset(e), CELL_W, appState.project.frameCount);
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
```

- [ ] **Step 4: Extend selection in `rowMove`; cancel long-press on real movement**

At the very top of `rowMove` (before the existing `if (dragMode === "none")` block), add:

```ts
    // A real drag before the long-press fires = normal seek/move/resize, not a selection.
    if (longPressTimer !== null) {
      if (Math.abs(e.clientX - pressStartX) > MOVE_CANCEL_PX || Math.abs(e.clientY - pressStartY) > MOVE_CANCEL_PX)
        cancelLongPress();
    }
    if (dragMode === "select" && appState.timelineSelection) {
      const overLayer = layerIdAtPoint(e.clientX, e.clientY, dragLayerId);
      setTimelineSelection(appState.timelineSelection.anchor, { layerId: overLayer, frame: rowColumn(e) });
      return;
    }
```

- [ ] **Step 5: Finalize in `rowUp`; clear the long-press**

At the top of `rowUp` add `cancelLongPress();`. Then add a branch so a finished select drag simply
ends without seeking, fully resetting the shared drag vars (a long-press may have upgraded an
in-progress resize/move, leaving `dragUndo`/`dragKey` set — drop them uncommitted). Insert before
the existing `if (dragMode === "move" …)`:

```ts
    if (dragMode === "select") {
      dragMode = "none";
      dragLayerId = -1;
      dragKey = -1;
      dragTarget = -1;
      dragUndo = null; // any resize/move snapshot armed before the long-press is discarded (no commit)
      dragStartBoundary = -1;
      dragLastBoundary = -1;
      return;
    }
```

- [ ] **Step 6: Add `data-layer-id` to each row grid and the highlight class**

In the row markup, on the `<div class="flex select-none" …>` that wraps the cell `{#each}`, add:

```svelte
              data-layer-id={layer.id}
```

On the per-cell `<div class="box-border h-6 …">` inside the `{#each}`, add the highlight class:

```svelte
              class:bg-selection={inSelection(layer.id, f)}
```

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: 0 errors, 0 warnings.

- [ ] **Step 8: Browser verification (record result in the commit message body)**

Run `npm run dev`, then in the timeline:
- Long-press a cell → it highlights (1×1). Drag horizontally → the frame range highlights. Drag
  vertically across layers → the block highlights across drawing layers (a ref layer in the span is skipped).
- A quick tap still seeks; dragging a ◆ still moves it; dragging a span edge still resizes — long-press
  did not break them.
- Shift-click another cell extends the selection from the existing anchor.

- [ ] **Step 9: Commit**

```bash
git add src/lib/Timeline.svelte
git commit -m "feat: timeline block-selection gesture (long-press + shift-click) and highlight"
```

---

## Task 8: TimelineSelectionBar.svelte — floating action bar

**Files:**
- Create: `src/lib/TimelineSelectionBar.svelte`
- Modify: `src/lib/Timeline.svelte` (import + render the bar; pass the scroll-container element + `selRect`).

**Interfaces:**
- Consumes: `copyTimelineSelection`, `cutTimelineSelection`, `pasteCells`, `deleteTimelineSelection`,
  `clearTimelineSelection` (appState); `selRect` and the grid container element from `Timeline.svelte`;
  `CELL_W`, `LABEL_W`.
- Produces: a positioned toolbar; buttons enable/disable off `appState.cellClipboard`.

DOM code — build- + browser-verified.

- [ ] **Step 1: Create the component**

Create `src/lib/TimelineSelectionBar.svelte`:

```svelte
<script lang="ts">
  import { Copy, Scissors, ClipboardPaste, Rows3, Trash2, X } from "@lucide/svelte";
  import {
    state as appState,
    copyTimelineSelection,
    cutTimelineSelection,
    pasteCells,
    deleteTimelineSelection,
    clearTimelineSelection,
  } from "../state/appState.svelte";
  import type { SelectionRect } from "../anim/timeline-selection";

  // The bar anchors to the top-left selected cell. `container` is the timeline's positioned
  // (relative) scroll wrapper; `rect` is the derived selection. `cellW`/`labelW` size the grid.
  let {
    container,
    rect,
    cellW,
    labelW,
  }: {
    container: HTMLElement | null;
    rect: SelectionRect | null;
    cellW: number;
    labelW: number;
  } = $props();

  let x = $state(0);
  let y = $state(0);

  // Recompute the anchor whenever the selection or the document changes (rows can move/scroll).
  $effect(() => {
    if (!container || !rect) return;
    // read appState.version so the effect re-runs on structural changes
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    appState.version;
    const topId = rect.layerIds[0];
    const rowEl = container.querySelector<HTMLElement>(`[data-layer-id="${topId}"]`);
    if (!rowEl) return;
    const cRect = container.getBoundingClientRect();
    const rRect = rowEl.getBoundingClientRect();
    // rowEl starts at the grid's left edge (after the sticky label), so its left already includes labelW.
    x = rRect.left - cRect.left + container.scrollLeft + rect.startFrame * cellW;
    y = rRect.top - cRect.top + container.scrollTop;
    void labelW; // labelW reserved for future absolute layouts; keep the prop stable
  });

  const btn =
    "w-6 h-6 rounded flex items-center justify-center text-text hover:bg-surface-hover disabled:opacity-40 disabled:cursor-default";
</script>

{#if rect}
  <div
    class="absolute z-30 flex items-center gap-0.5 rounded border border-border bg-surface px-1 py-0.5 shadow"
    style="left: {x}px; top: {y}px; transform: translateY(-100%);"
    role="toolbar"
    aria-label="Selection actions"
  >
    <button class={btn} title="Copy" onclick={copyTimelineSelection}><Copy size={14} /></button>
    <button class={btn} title="Cut" onclick={cutTimelineSelection}><Scissors size={14} /></button>
    <button class={btn} title="Paste (overwrite)" disabled={!appState.cellClipboard} onclick={() => pasteCells(false)}
      ><ClipboardPaste size={14} /></button
    >
    <button class={btn} title="Paste insert" disabled={!appState.cellClipboard} onclick={() => pasteCells(true)}
      ><Rows3 size={14} /></button
    >
    <button class={btn} title="Delete" onclick={deleteTimelineSelection}><Trash2 size={14} /></button>
    <button class={btn} title="Clear selection" onclick={clearTimelineSelection}><X size={14} /></button>
  </div>
{/if}
```

- [ ] **Step 2: Render the bar from Timeline.svelte**

In `Timeline.svelte`, import it and bind the scroll container. First add the import near the other
component imports:

```ts
  import TimelineSelectionBar from "./TimelineSelectionBar.svelte";
```

The rows + ruler live inside a horizontally-scrolling wrapper. Give that wrapper `position: relative`
and a `bind:this`. Find the scroll wrapper `<div>` that contains the ruler and the layer-row `{#each}`
(the element whose child is the `role="slider"` ruler and the `{#each …layers}`). Add:

```svelte
    bind:this={gridWrapper}
    class="… relative"
```

and declare near the other `let` state:

```ts
  let gridWrapper = $state<HTMLElement | null>(null);
```

Then render the bar as the wrapper's last child (inside it, so `absolute` positions against it):

```svelte
    <TimelineSelectionBar container={gridWrapper} rect={selRect} cellW={CELL_W} labelW={LABEL_W} />
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: 0 errors, 0 warnings. (If `svelte-check` flags an unused `labelW`, the `void labelW;`
line and prop keep it referenced; remove the prop instead if you prefer — it is not required by the anchor math.)

- [ ] **Step 4: Browser verification**

Run `npm run dev`:
- Make a selection → the action bar appears just above the top-left selected cell.
- Copy, move the playhead / active layer, Paste → the block stamps at the new location (overwrite:
  length unchanged; the pasted drawing appears). Paste-insert shifts later frames right.
- Cut removes the region (→ holds) and Paste restores it elsewhere. Delete clears the region. Undo
  (Cmd+Z) reverses each paste/cut/delete. Clear (X) hides the bar.
- Bar buttons Paste/Paste-insert are disabled until something is copied.

- [ ] **Step 5: Commit**

```bash
git add src/lib/TimelineSelectionBar.svelte src/lib/Timeline.svelte
git commit -m "feat: timeline selection action bar (copy/cut/paste/insert/delete)"
```

---

## Task 9: App.svelte — keyboard shortcuts + onPaste disambiguation

**Files:**
- Modify: `src/App.svelte` (`onKey` ~L29-77; `onPaste` ~L79-92; imports ~L14-25).

**Interfaces:**
- Consumes: `copyTimelineSelection`, `cutTimelineSelection`, `pasteCells`, `deleteTimelineSelection`
  (appState); existing `state as … ` alias (App.svelte imports `{ state }` — confirm current alias).
- Produces: `Cmd/Ctrl+C/X/V`, `Cmd/Ctrl+Shift+V`, `Delete/Backspace` bound to the block actions when a
  selection/clipboard exists; a `cellPasteHandled` flag so `Cmd+V` never both cell-pastes and image-pastes.

DOM/keyboard code — build- + browser-verified.

- [ ] **Step 1: Add imports**

In the `./state/appState.svelte` import block in `App.svelte`, add:

```ts
    copyTimelineSelection,
    cutTimelineSelection,
    pasteCells,
    deleteTimelineSelection,
```

- [ ] **Step 2: Add the disambiguation flag**

Above `function onKey`, add:

```ts
  // Set when a Cmd+V is consumed as a cell paste, so the window `paste` event (onPaste) skips
  // its image-file handling for the same keystroke. keydown fires before paste.
  let cellPasteHandled = false;
```

- [ ] **Step 3: Add the shortcuts to `onKey`**

Insert, immediately after the `if (tag === "INPUT" || tag === "TEXTAREA") return;` guard (so they
respect text-field focus) and before the single-key tool shortcuts:

```ts
    if (meta && e.key.toLowerCase() === "c" && state.timelineSelection) {
      e.preventDefault();
      copyTimelineSelection();
      return;
    }
    if (meta && e.key.toLowerCase() === "x" && state.timelineSelection) {
      e.preventDefault();
      cutTimelineSelection();
      return;
    }
    if (meta && e.key.toLowerCase() === "v" && state.cellClipboard) {
      e.preventDefault();
      cellPasteHandled = true; // tell onPaste to skip this keystroke
      pasteCells(e.shiftKey);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && state.timelineSelection) {
      e.preventDefault();
      deleteTimelineSelection();
      return;
    }
```

- [ ] **Step 4: Guard `onPaste`**

At the very top of `onPaste`, add:

```ts
    if (cellPasteHandled) {
      cellPasteHandled = false;
      return; // this Cmd+V was a cell paste; don't also handle it as an image paste
    }
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Browser verification (desktop)**

Run `npm run dev`:
- Select a block → `Cmd/Ctrl+C`, move playhead, `Cmd/Ctrl+V` overwrites; `Cmd/Ctrl+Shift+V` inserts.
- `Cmd/Ctrl+X` cuts; `Delete`/`Backspace` clears the selected region.
- With NO cell clipboard, copy an image to the OS clipboard and `Cmd+V` → still creates an image
  reference layer (image paste path unbroken).
- After a cell copy, `Cmd+V` pastes cells and does NOT also spawn an image layer.
- Shortcuts do nothing while typing in the fps input (INPUT guard holds).

- [ ] **Step 7: Commit**

```bash
git add src/App.svelte
git commit -m "feat: timeline clipboard keyboard shortcuts + Cmd+V image-paste disambiguation"
```

---

## Final verification

- [ ] **Full build:** `npm run build` → 0 errors, 0 warnings.
- [ ] **Full tests:** `npm test` → baseline (~280) + new block/selection tests pass.
- [ ] **Interactive pass (flag as verification debt if not done):** long-press block selection on
  iPad (Apple Pencil + touch) and desktop; overwrite vs insert paste; cross-layer paste with overflow;
  undo/redo across paste/cut/delete; the hold-meaning edge (overwrite a key that a trailing hold
  depended on → the hold now shows the new drawing).

---

## Spec coverage self-check

- Block clipboard model + materialize-leading-key → Task 1 (`copyBlock`).
- Overwrite paste (default), insert paste, cross-layer downward fill, overflow-ignored, pad-past-end →
  Tasks 2–3 (`pasteBlockOverwrite`/`pasteBlockInsert`, `drawingLayerIdsDown`).
- Delete = region→holds; Cut = copy+delete → Task 4 + Task 6 actions.
- Selection state + derived rect (drawing layers only, top-first) → Task 5 + Task 6.
- Long-press + Shift-click gesture, highlight → Task 7. Action bar → Task 8.
- Keyboard shortcuts + `Cmd+V`/image-paste disambiguation → Task 9.
- Undo via `commitStructural`; lift discard; replace-not-mutate; deep-clone → enforced in Tasks 2–4, 6.
- Phasing: Phase 0 = Tasks 5–7 (selection foundation); Phase 1 = the engine exercised at 1×1 (Tasks
  1–4, 6, 8, 9); Phases 2–3 (range, block) need no extra code — the same engine + gesture cover N×1
  and N×M. Phase 4 (cross-document) intentionally out of scope.
