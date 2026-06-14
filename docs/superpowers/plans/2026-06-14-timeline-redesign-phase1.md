# Timeline Redesign — Phase 1 (Model + Ops) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the equal-length timeline model with independent per-layer cell tracks, implement the full per-layer + all-layers operation set (unit-tested), extend drawing to grow a layer past its end, and rewire the Timeline UI buttons (including a new Delete-frame tool) to the new current-frame-aware operations.

**Architecture:** Each `DrawingLayer.cells` becomes independently sized. `project.frameCount` is redefined as the document length = the longest drawing layer, recomputed by `refreshLength()` (called from `bump()` and the all-layers ops). `resolveKeyframeIndex` returns `null` past a layer's end (blank-after). Per-layer ops (`addFrame`, `insertKeyframe`, `deleteFrame`, `moveKeyframe`, `setHoldSpan`, …) take a single `DrawingLayer` and mutate only its cells; explicit `insertFrameAllLayers` / `deleteFrameAllLayers` shift every layer. The Timeline grid renders `frameCount` columns per layer with blank cells past each layer's own length.

**Tech Stack:** TypeScript 5.9, Svelte 5 (runes), Vitest, Tailwind 4, `@lucide/svelte`.

**Spec:** `docs/superpowers/specs/2026-06-14-timeline-redesign-design.md`

---

## File Structure

- `src/anim/document.ts` — model. Change `resolveKeyframeIndex` (blank-after). Add `documentLength()` and `refreshLength()`. Update the `DrawingLayer.cells` comment.
- `src/anim/timeline.ts` — operations. Rewrite signatures to per-layer; add `insertBlankKeyframe`, `moveKeyframe`, `setHoldSpan`, `insertFrameAllLayers`, `deleteFrameAllLayers`; extend `ensureDrawableKeyframe` past end.
- `src/state/appState.svelte.ts` — `bump()` recomputes length + clamps playhead.
- `src/persist/project-file.ts` — recompute length on load.
- `src/lib/Timeline.svelte` — rewire buttons to new ops + add Delete-frame tool; render per-layer-length strips.
- Tests: `src/__tests__/document.test.ts`, `src/__tests__/timeline.test.ts`.

**Run all tests with:** `npm test` (Vitest, `vitest run`). Typecheck/build with `npm run build`.

---

### Task 1: `resolveKeyframeIndex` — blank past a layer's end

**Files:**
- Modify: `src/anim/document.ts:44-55` (the function + its doc comment) and `src/anim/document.ts:12` (cells comment)
- Test: `src/__tests__/document.test.ts:25-27`

- [ ] **Step 1: Update the failing test**

In `src/__tests__/document.test.ts`, replace the existing clamp test (lines 25-27):

```ts
  it("returns null past the end of the track (blank after end)", () => {
    expect(resolveKeyframeIndex([key(), hold()], 5)).toBeNull();
    expect(resolveKeyframeIndex([key(), hold()], 2)).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/document.test.ts`
Expected: FAIL — current implementation clamps and returns `0` instead of `null`.

- [ ] **Step 3: Implement blank-after**

In `src/anim/document.ts`, replace `resolveKeyframeIndex` (and its doc comment) with:

```ts
/**
 * Index of the keyframe shown at `frame` on this cell track: the nearest "key" cell at
 * or before `frame`. Returns null when `frame` is past this track's end (blank after end)
 * or no key precedes it.
 */
export function resolveKeyframeIndex(cells: Cell[], frame: number): number | null {
  if (frame < 0 || frame >= cells.length) return null;
  for (let i = frame; i >= 0; i--) {
    if (cells[i].kind === "key") return i;
  }
  return null;
}
```

Also update the comment on `src/anim/document.ts:12` from `cells: Cell[];    // length === project.frameCount` to:

```ts
  cells: Cell[];    // independent per-layer length; document length = the longest layer
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/__tests__/document.test.ts`
Expected: PASS (all `resolveKeyframeIndex` cases).

- [ ] **Step 5: Commit**

```bash
git add src/anim/document.ts src/__tests__/document.test.ts
git commit -m "feat: resolveKeyframeIndex returns null past a layer's end"
```

---

### Task 2: `documentLength` + `refreshLength`

**Files:**
- Modify: `src/anim/document.ts` (add two functions after `buildFrameDrawList`)
- Test: `src/__tests__/document.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/document.test.ts` (inside the file, new `describe`):

```ts
describe("documentLength / refreshLength", () => {
  const draw = (len: number): DrawingLayer => ({
    kind: "draw", id: 1, name: "L", visible: true, locked: false, opacity: 100,
    cells: Array.from({ length: len }, () => ({ kind: "hold" }) as Cell),
  });
  const ref = (): ReferenceLayer => ({
    kind: "ref", id: 9, name: "R", visible: true, opacity: 60, offsetFrames: 0,
    media: { type: "image", el: {} as HTMLImageElement },
  });

  it("documentLength is the longest drawing layer, ignoring reference layers", () => {
    const p: Project = { width: 1, height: 1, fps: 12, bgColor: "#fff", frameCount: 0,
      layers: [draw(3), draw(7), ref()] };
    expect(documentLength(p)).toBe(7);
  });

  it("documentLength floors at 1", () => {
    const p: Project = { width: 1, height: 1, fps: 12, bgColor: "#fff", frameCount: 0,
      layers: [ref()] };
    expect(documentLength(p)).toBe(1);
  });

  it("refreshLength writes documentLength into frameCount", () => {
    const p: Project = { width: 1, height: 1, fps: 12, bgColor: "#fff", frameCount: 99,
      layers: [draw(4)] };
    refreshLength(p);
    expect(p.frameCount).toBe(4);
  });
});
```

Add `documentLength, refreshLength` to the import on `src/__tests__/document.test.ts:2`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/document.test.ts`
Expected: FAIL — `documentLength`/`refreshLength` not exported.

- [ ] **Step 3: Implement**

In `src/anim/document.ts`, add after `buildFrameDrawList` (after line 79):

```ts
/** Document length = the longest drawing layer's cell count (reference layers ignored), floor 1. */
export function documentLength(project: Project): number {
  let max = 1;
  for (const layer of project.layers) {
    if (layer.kind === "draw") max = Math.max(max, layer.cells.length);
  }
  return max;
}

/** Recompute and store the document length into `project.frameCount`. */
export function refreshLength(project: Project): void {
  project.frameCount = documentLength(project);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/__tests__/document.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/anim/document.ts src/__tests__/document.test.ts
git commit -m "feat: add documentLength and refreshLength helpers"
```

---

### Task 3: `insertKeyframe` / `insertBlankKeyframe` / `duplicateKeyframe` — clone-after-current

**Files:**
- Modify: `src/anim/timeline.ts:18-38` (replace `insertKeyframe`, `duplicateKeyframe`; add `insertBlankKeyframe`)
- Test: `src/__tests__/timeline.test.ts` (replace the `insertKeyframe` and `duplicateKeyframe` tests)

- [ ] **Step 1: Update the failing tests**

In `src/__tests__/timeline.test.ts`, replace the `insertKeyframe` test (the `it("insertKeyframe puts a blank keyframe at the frame", …)` block) and the `duplicateKeyframe` test with:

```ts
  it("insertKeyframe inserts a clone of the shown drawing AFTER the current frame, shifting later cells", () => {
    const src = fakeOps.create() as unknown as { __id: number };
    const l = layer([{ kind: "key", canvas: src as unknown as HTMLCanvasElement }, { kind: "hold" }, { kind: "hold" }]);
    insertKeyframe(l, 0, fakeOps); // after frame 0
    expect(l.cells.length).toBe(4);
    const inserted = l.cells[1];
    expect(inserted.kind).toBe("key");
    if (inserted.kind === "key") {
      expect((inserted.canvas as unknown as { __cloneOf: number }).__cloneOf).toBe(src.__id);
    }
    expect(l.cells[2]).toEqual({ kind: "hold" });
  });

  it("insertKeyframe on a blank frame inserts a blank keyframe after it", () => {
    const l = layer([{ kind: "hold" }, { kind: "hold" }]);
    insertKeyframe(l, 0, fakeOps);
    expect(l.cells.length).toBe(3);
    const inserted = l.cells[1];
    expect(inserted.kind).toBe("key");
    if (inserted.kind === "key") {
      expect((inserted.canvas as unknown as { __cloneOf?: number }).__cloneOf).toBeUndefined();
    }
  });

  it("insertBlankKeyframe inserts an empty keyframe after the current frame", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
    insertBlankKeyframe(l, 0, fakeOps);
    expect(l.cells.length).toBe(3);
    const inserted = l.cells[1];
    expect(inserted.kind).toBe("key");
    if (inserted.kind === "key") {
      expect((inserted.canvas as unknown as { __cloneOf?: number }).__cloneOf).toBeUndefined();
    }
  });

  it("duplicateKeyframe inserts a clone of the resolved keyframe after the current frame", () => {
    const src = fakeOps.create() as unknown as { __id: number };
    const l = layer([{ kind: "key", canvas: src as unknown as HTMLCanvasElement }, { kind: "hold" }]);
    duplicateKeyframe(l, 1, fakeOps); // current frame 1 holds frame-0's drawing
    expect(l.cells.length).toBe(3);
    const inserted = l.cells[2];
    expect(inserted.kind).toBe("key");
    if (inserted.kind === "key") {
      expect((inserted.canvas as unknown as { __cloneOf: number }).__cloneOf).toBe(src.__id);
    }
  });
```

Add `insertBlankKeyframe` to the import block at the top of `src/__tests__/timeline.test.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/__tests__/timeline.test.ts`
Expected: FAIL — `insertBlankKeyframe` not exported; `insertKeyframe`/`duplicateKeyframe` still in-place (no shift).

- [ ] **Step 3: Implement**

In `src/anim/timeline.ts`, replace `insertKeyframe` and `duplicateKeyframe` (lines 18-38) with:

```ts
/** Clamp a target index to the last existing cell so "after current" always lands inside the track. */
function clampIndex(layer: DrawingLayer, frame: number): number {
  return Math.max(0, Math.min(frame, layer.cells.length - 1));
}

/**
 * Insert a new keyframe AFTER `after`, cloning the drawing currently shown at `after`
 * (the resolved keyframe, or blank if none). Shifts later cells right. ("Insert keyframe" / F6.)
 */
export function insertKeyframe(layer: DrawingLayer, after: number, ops: CanvasOps): void {
  const at = clampIndex(layer, after);
  const ki = resolveKeyframeIndex(layer.cells, at);
  const src = ki === null ? null : layer.cells[ki];
  const canvas = src && src.kind === "key" ? ops.clone(src.canvas) : ops.create();
  layer.cells.splice(at + 1, 0, { kind: "key", canvas });
}

/** Insert an empty keyframe AFTER `after`, shifting later cells right. ("Insert blank keyframe" / F7.) */
export function insertBlankKeyframe(layer: DrawingLayer, after: number, ops: CanvasOps): void {
  const at = clampIndex(layer, after);
  layer.cells.splice(at + 1, 0, { kind: "key", canvas: ops.create() });
}

/** Duplicate the keyframe shown at `frame` into a new keyframe right after it. */
export function duplicateKeyframe(layer: DrawingLayer, frame: number, ops: CanvasOps): void {
  insertKeyframe(layer, frame, ops);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/__tests__/timeline.test.ts`
Expected: PASS for the insert/blank/duplicate tests. (The `addFrame`/`deleteFrame`/reference tests still use the old project-level signatures and still pass — they're rewritten in Tasks 4–5.)

- [ ] **Step 5: Commit**

```bash
git add src/anim/timeline.ts src/__tests__/timeline.test.ts
git commit -m "feat: insert keyframe clones the shown drawing after the current frame"
```

---

### Task 4: per-layer `addFrame` + `deleteFrame`

**Files:**
- Modify: `src/anim/timeline.ts:9-16` (`addFrame`) and `:40-49` (`deleteFrame`)
- Test: `src/__tests__/timeline.test.ts` (rewrite the `addFrame`/`deleteFrame` tests; delete the `"timeline operations with reference layers"` describe block — it is reborn in Task 5)

- [ ] **Step 1: Update the failing tests**

In `src/__tests__/timeline.test.ts`:

1. Replace the two `addFrame` tests (`"addFrame grows frameCount…"` and `"addFrame appends a hold to EVERY layer…"`) with:

```ts
  it("addFrame inserts a hold after the current frame on the layer, shifting later cells", () => {
    const k = fakeOps.create();
    const l = layer([{ kind: "key", canvas: k }, { kind: "hold" }]);
    addFrame(l, 0); // after frame 0
    expect(l.cells.length).toBe(3);
    expect(l.cells[0]).toEqual({ kind: "key", canvas: k });
    expect(l.cells[1]).toEqual({ kind: "hold" });
    expect(l.cells[2]).toEqual({ kind: "hold" });
  });
```

2. Replace the three existing `deleteFrame` tests (`"deleteFrame is a no-op for an out-of-range frame…"`, `"deleteFrame removes the column from every layer…"`, `"deleteFrame is a no-op when only one frame remains"`) with:

```ts
  it("deleteFrame removes the cell and shifts later cells left", () => {
    const k = fakeOps.create();
    const l = layer([{ kind: "hold" }, { kind: "key", canvas: k }]);
    deleteFrame(l, 0);
    expect(l.cells.length).toBe(1);
    expect(l.cells[0]).toEqual({ kind: "key", canvas: k });
  });

  it("deleteFrame is a no-op when only one cell remains", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }]);
    deleteFrame(l, 0);
    expect(l.cells.length).toBe(1);
  });

  it("deleteFrame is a no-op for an out-of-range frame", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
    deleteFrame(l, 5);
    expect(l.cells.length).toBe(2);
  });
```

3. Delete the entire `describe("timeline operations with reference layers", …)` block and the `refLayerFixture` helper above it (both reappear in Task 5).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/__tests__/timeline.test.ts`
Expected: FAIL — `addFrame`/`deleteFrame` still take a `Project`, so `addFrame(l, 0)` / `deleteFrame(l, 0)` are type/behavior mismatches.

- [ ] **Step 3: Implement**

In `src/anim/timeline.ts`, replace `addFrame` (lines 9-16) with:

```ts
/** Insert a hold AFTER `after` on this layer, extending the current held span by one frame. */
export function addFrame(layer: DrawingLayer, after: number): void {
  const at = clampIndex(layer, after);
  layer.cells.splice(at + 1, 0, { kind: "hold" });
}
```

And replace `deleteFrame` (lines 40-49) with:

```ts
/** Remove the cell at `frame` on this layer, shifting later cells left. Keeps at least one cell. */
export function deleteFrame(layer: DrawingLayer, frame: number): void {
  if (layer.cells.length <= 1) return;
  if (frame < 0 || frame >= layer.cells.length) return;
  layer.cells.splice(frame, 1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/__tests__/timeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/anim/timeline.ts src/__tests__/timeline.test.ts
git commit -m "feat: per-layer addFrame and deleteFrame operations"
```

---

### Task 5: `insertFrameAllLayers` + `deleteFrameAllLayers`

**Files:**
- Modify: `src/anim/timeline.ts` (add both functions; import `refreshLength`)
- Test: `src/__tests__/timeline.test.ts` (add a new describe block)

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/timeline.test.ts`, add the import of `insertFrameAllLayers, deleteFrameAllLayers` to the timeline import block, and append:

```ts
function refLayerFixture(id: number): ReferenceLayer {
  return {
    kind: "ref", id, name: `R${id}`, visible: true, opacity: 60, offsetFrames: 0,
    media: { type: "image", el: {} as HTMLImageElement },
  };
}

describe("all-layers timeline operations", () => {
  it("insertFrameAllLayers inserts a hold at `at` in every drawing layer and refreshes length", () => {
    const a = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
    const b = layer([{ kind: "hold" }, { kind: "hold" }]);
    const r = refLayerFixture(3);
    const p: Project = { width: 10, height: 10, fps: 12, bgColor: "#fff", frameCount: 2, layers: [a, b, r] };
    insertFrameAllLayers(p, 1);
    expect(a.cells.length).toBe(3);
    expect(b.cells.length).toBe(3);
    expect(a.cells[1]).toEqual({ kind: "hold" });
    expect(p.frameCount).toBe(3);
    expect((r as unknown as { cells?: unknown }).cells).toBeUndefined();
  });

  it("deleteFrameAllLayers removes `at` from every drawing layer and refreshes length", () => {
    const a = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
    const b = layer([{ kind: "hold" }, { kind: "hold" }]);
    const p: Project = { width: 10, height: 10, fps: 12, bgColor: "#fff", frameCount: 2, layers: [a, b] };
    deleteFrameAllLayers(p, 0);
    expect(a.cells.length).toBe(1);
    expect(b.cells.length).toBe(1);
    expect(p.frameCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/__tests__/timeline.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

In `src/anim/timeline.ts`, update the import on line 1 to include `refreshLength`:

```ts
import { resolveKeyframeIndex, refreshLength, type DrawingLayer, type Project } from "./document";
```

Add at the end of the file:

```ts
/** Insert a hold at index `at` in EVERY drawing layer (global shift), then refresh document length. */
export function insertFrameAllLayers(project: Project, at: number): void {
  for (const layer of project.layers) {
    if (layer.kind !== "draw") continue;
    const idx = Math.max(0, Math.min(at, layer.cells.length));
    layer.cells.splice(idx, 0, { kind: "hold" });
  }
  refreshLength(project);
}

/** Remove index `at` from every drawing layer that has it (global shift), keeping ≥1 cell each. */
export function deleteFrameAllLayers(project: Project, at: number): void {
  for (const layer of project.layers) {
    if (layer.kind !== "draw") continue;
    if (layer.cells.length <= 1) continue;
    if (at < 0 || at >= layer.cells.length) continue;
    layer.cells.splice(at, 1);
  }
  refreshLength(project);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/__tests__/timeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/anim/timeline.ts src/__tests__/timeline.test.ts
git commit -m "feat: all-layers insert/delete frame operations"
```

---

### Task 6: `moveKeyframe`

**Files:**
- Modify: `src/anim/timeline.ts` (add function)
- Test: `src/__tests__/timeline.test.ts` (add describe block)

- [ ] **Step 1: Write the failing tests**

Add `moveKeyframe` to the timeline import block in `src/__tests__/timeline.test.ts`, and append:

```ts
describe("moveKeyframe", () => {
  it("moves a key onto a hold cell, leaving a hold behind", () => {
    const k = fakeOps.create();
    const l = layer([{ kind: "key", canvas: k }, { kind: "hold" }, { kind: "hold" }]);
    moveKeyframe(l, 0, 2);
    expect(l.cells[0]).toEqual({ kind: "hold" });
    expect(l.cells[2]).toEqual({ kind: "key", canvas: k });
  });

  it("swaps when the target is also a key", () => {
    const a = fakeOps.create();
    const b = fakeOps.create();
    const l = layer([{ kind: "key", canvas: a }, { kind: "hold" }, { kind: "key", canvas: b }]);
    moveKeyframe(l, 0, 2);
    expect(l.cells[0]).toEqual({ kind: "key", canvas: b });
    expect(l.cells[2]).toEqual({ kind: "key", canvas: a });
  });

  it("appends past the end, padding holds, and leaves a hold behind", () => {
    const k = fakeOps.create();
    const l = layer([{ kind: "key", canvas: k }, { kind: "hold" }]);
    moveKeyframe(l, 0, 3);
    expect(l.cells.length).toBe(4);
    expect(l.cells[0]).toEqual({ kind: "hold" });
    expect(l.cells[1]).toEqual({ kind: "hold" });
    expect(l.cells[2]).toEqual({ kind: "hold" });
    expect(l.cells[3]).toEqual({ kind: "key", canvas: k });
  });

  it("is a no-op when the source is not a key or target equals source", () => {
    const k = fakeOps.create();
    const l = layer([{ kind: "hold" }, { kind: "key", canvas: k }]);
    moveKeyframe(l, 0, 1); // source is a hold
    expect(l.cells[1]).toEqual({ kind: "key", canvas: k });
    moveKeyframe(l, 1, 1); // same index
    expect(l.cells[1]).toEqual({ kind: "key", canvas: k });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/__tests__/timeline.test.ts`
Expected: FAIL — `moveKeyframe` not exported.

- [ ] **Step 3: Implement**

In `src/anim/timeline.ts`, add:

```ts
/**
 * Move the keyframe at `from` to `to` on the same layer.
 * - Source cell becomes a hold.
 * - If `to` is a hold cell → the key lands there.
 * - If `to` is itself a key → the two keyframes swap.
 * - If `to` is past the end → the layer extends (padding holds) and the key is appended.
 * No-op if `from` is not a key or `to === from`.
 */
export function moveKeyframe(layer: DrawingLayer, from: number, to: number): void {
  if (to === from) return;
  if (from < 0 || from >= layer.cells.length) return;
  const moving = layer.cells[from];
  if (moving.kind !== "key") return;

  if (to >= layer.cells.length) {
    layer.cells[from] = { kind: "hold" };
    while (layer.cells.length < to) layer.cells.push({ kind: "hold" });
    layer.cells.push(moving);
    return;
  }
  if (to < 0) return;

  const target = layer.cells[to];
  if (target.kind === "key") {
    layer.cells[to] = moving;
    layer.cells[from] = target; // swap
  } else {
    layer.cells[to] = moving;
    layer.cells[from] = { kind: "hold" };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/__tests__/timeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/anim/timeline.ts src/__tests__/timeline.test.ts
git commit -m "feat: moveKeyframe (move/swap/append) operation"
```

---

### Task 7: `setHoldSpan`

**Files:**
- Modify: `src/anim/timeline.ts` (add function; import `Cell`)
- Test: `src/__tests__/timeline.test.ts` (add describe block)

- [ ] **Step 1: Write the failing tests**

Add `setHoldSpan` to the timeline import block, and append:

```ts
describe("setHoldSpan", () => {
  it("grows a key's span by inserting holds, pushing following keys right", () => {
    const a = fakeOps.create();
    const b = fakeOps.create();
    // key A occupies frames 0-1 (span 2), key B at 2
    const l = layer([{ kind: "key", canvas: a }, { kind: "hold" }, { kind: "key", canvas: b }]);
    setHoldSpan(l, 0, 4); // A should occupy 0-3
    expect(l.cells.length).toBe(5);
    expect(l.cells[0]).toEqual({ kind: "key", canvas: a });
    expect(l.cells[1]).toEqual({ kind: "hold" });
    expect(l.cells[2]).toEqual({ kind: "hold" });
    expect(l.cells[3]).toEqual({ kind: "hold" });
    expect(l.cells[4]).toEqual({ kind: "key", canvas: b });
  });

  it("shrinks a key's span by removing trailing holds, pulling following keys left", () => {
    const a = fakeOps.create();
    const b = fakeOps.create();
    const l = layer([{ kind: "key", canvas: a }, { kind: "hold" }, { kind: "hold" }, { kind: "key", canvas: b }]);
    setHoldSpan(l, 0, 1); // A occupies only frame 0
    expect(l.cells.length).toBe(2);
    expect(l.cells[0]).toEqual({ kind: "key", canvas: a });
    expect(l.cells[1]).toEqual({ kind: "key", canvas: b });
  });

  it("never deletes the following key (clamps removal to this span's holds) and floors span at 1", () => {
    const a = fakeOps.create();
    const b = fakeOps.create();
    const l = layer([{ kind: "key", canvas: a }, { kind: "hold" }, { kind: "key", canvas: b }]);
    setHoldSpan(l, 0, 0); // floored to 1
    expect(l.cells.length).toBe(2);
    expect(l.cells[0]).toEqual({ kind: "key", canvas: a });
    expect(l.cells[1]).toEqual({ kind: "key", canvas: b });
  });

  it("is a no-op when the frame is not a key", () => {
    const l = layer([{ kind: "hold" }, { kind: "hold" }]);
    setHoldSpan(l, 0, 5);
    expect(l.cells.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/__tests__/timeline.test.ts`
Expected: FAIL — `setHoldSpan` not exported.

- [ ] **Step 3: Implement**

In `src/anim/timeline.ts`, update the import on line 1 to also import `Cell`:

```ts
import { resolveKeyframeIndex, refreshLength, type Cell, type DrawingLayer, type Project } from "./document";
```

Add:

```ts
/**
 * Set how many frames the keyframe at `keyFrame` occupies before the next key (its hold span).
 * `span` is the total cell count owned by this key (key + trailing holds), floored at 1.
 * Growing inserts holds at the span boundary (pushing following keys right); shrinking removes
 * trailing holds of this span only (pulling following keys left) — it never deletes another key.
 * No-op if `keyFrame` is not a key.
 */
export function setHoldSpan(layer: DrawingLayer, keyFrame: number, span: number): void {
  if (keyFrame < 0 || keyFrame >= layer.cells.length) return;
  if (layer.cells[keyFrame].kind !== "key") return;

  const desired = Math.max(1, Math.floor(span));
  let next = keyFrame + 1;
  while (next < layer.cells.length && layer.cells[next].kind === "hold") next++;
  const current = next - keyFrame; // cells owned: the key plus its trailing holds
  if (desired === current) return;

  if (desired > current) {
    const holds: Cell[] = Array.from({ length: desired - current }, () => ({ kind: "hold" }) as Cell);
    layer.cells.splice(keyFrame + current, 0, ...holds);
  } else {
    layer.cells.splice(keyFrame + desired, current - desired);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/__tests__/timeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/anim/timeline.ts src/__tests__/timeline.test.ts
git commit -m "feat: setHoldSpan resizes a keyframe's hold duration"
```

---

### Task 8: `ensureDrawableKeyframe` extends a layer past its end

**Files:**
- Modify: `src/anim/timeline.ts:51-66` (`ensureDrawableKeyframe`)
- Test: `src/__tests__/timeline.test.ts` (add one test; existing ensure tests stay)

- [ ] **Step 1: Write the failing test**

Append to the `describe("timeline operations", …)` block (or anywhere in the file) in `src/__tests__/timeline.test.ts`:

```ts
  it("ensureDrawableKeyframe extends the layer with holds when drawing past its end", () => {
    const l = layer([{ kind: "hold" }]); // length 1
    const canvas = ensureDrawableKeyframe(l, 3, fakeOps);
    expect(l.cells.length).toBe(4);
    expect(l.cells[1]).toEqual({ kind: "hold" });
    expect(l.cells[2]).toEqual({ kind: "hold" });
    expect(l.cells[3].kind).toBe("key");
    expect((canvas as unknown as { __cloneOf?: number }).__cloneOf).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/timeline.test.ts`
Expected: FAIL — current code reads `layer.cells[3]` (undefined) and throws on `.kind`.

- [ ] **Step 3: Implement**

In `src/anim/timeline.ts`, replace `ensureDrawableKeyframe` (lines 51-66) with:

```ts
/**
 * Guarantee the cell at `frame` is a keyframe and return its canvas, so a tool can draw on it.
 * - Past the layer's end → extend with holds up to `frame`, then a fresh blank keyframe.
 * - Already a keyframe → returns its canvas unchanged.
 * - A hold over an earlier keyframe → clones that drawing (draw-on-hold = clone & edit on top).
 * - A hold with nothing held → a fresh blank keyframe.
 */
export function ensureDrawableKeyframe(layer: DrawingLayer, frame: number, ops: CanvasOps): HTMLCanvasElement {
  if (frame >= layer.cells.length) {
    while (layer.cells.length < frame) layer.cells.push({ kind: "hold" });
    const canvas = ops.create();
    layer.cells.push({ kind: "key", canvas });
    return canvas;
  }

  const current = layer.cells[frame];
  if (current.kind === "key") return current.canvas;

  const ki = resolveKeyframeIndex(layer.cells, frame);
  const held = ki === null ? null : layer.cells[ki];
  const canvas = held && held.kind === "key" ? ops.clone(held.canvas) : ops.create();
  layer.cells[frame] = { kind: "key", canvas };
  return canvas;
}
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `npm test`
Expected: PASS (timeline + document suites green).

- [ ] **Step 5: Commit**

```bash
git add src/anim/timeline.ts src/__tests__/timeline.test.ts
git commit -m "feat: ensureDrawableKeyframe extends a layer when drawing past its end"
```

---

### Task 9: `bump()` recomputes length and clamps the playhead

**Files:**
- Modify: `src/state/appState.svelte.ts:1` (import) and `:168-170` (`bump`)

- [ ] **Step 1: Implement**

In `src/state/appState.svelte.ts`, add `refreshLength` to the document import on line 1:

```ts
import { createProject, createCellCanvas, cloneCanvas, isDrawingLayer, createDrawingLayer, resolveKeyframeIndex, refreshLength, type Project, type Layer, type Cell, type DrawingLayer } from "../anim/document";
```

Replace `bump` (lines 168-170) with:

```ts
export function bump() {
  refreshLength(state.project);
  const last = state.project.frameCount - 1;
  if (state.playhead > last) state.playhead = last;
  if (state.playhead < 0) state.playhead = 0;
  state.version++;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: PASS — `svelte-check` and `tsc --noEmit` report no errors. (No unit test: `bump` mutates the Svelte runes `state` proxy; the length/clamp logic it calls is already covered by Task 2's `refreshLength` tests.)

- [ ] **Step 3: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat: bump recomputes document length and clamps the playhead"
```

---

### Task 10: recompute document length on project load

**Files:**
- Modify: `src/persist/project-file.ts` (import `refreshLength`; call it before returning the loaded project)

- [ ] **Step 1: Implement**

In `src/persist/project-file.ts`, add `refreshLength` to the import from `../anim/document` (the file already imports several symbols from there — add `refreshLength` to that import list).

Then change the load return (around `src/persist/project-file.ts:111-114`) from:

```ts
  setMinLayerId(maxId + 1);
  return {
    width: json.width, height: json.height, fps: json.fps,
    bgColor: json.bgColor, frameCount: json.frameCount, layers,
  };
```

to:

```ts
  setMinLayerId(maxId + 1);
  const project: Project = {
    width: json.width, height: json.height, fps: json.fps,
    bgColor: json.bgColor, frameCount: json.frameCount, layers,
  };
  refreshLength(project); // independent per-layer lengths → derive document length from the layers
  return project;
```

If `Project` is not already imported in this file, add it to the type import from `../anim/document`.

- [ ] **Step 2: Run persistence tests + typecheck**

Run: `npm test -- src/__tests__/persist.test.ts`
Expected: PASS (round-tripped projects keep the same length, since saved `frameCount` already equals the longest layer).

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/persist/project-file.ts
git commit -m "feat: derive document length from layers on project load"
```

---

### Task 11: rewire the Timeline UI to the new ops + Delete-frame tool

**Files:**
- Modify: `src/lib/Timeline.svelte` (full rewrite of the script + grid)

This task is verified by build + manual in-browser check (no unit test — it's pointer/DOM UI, consistent with prior phases). Phase 1 keeps the existing flat-grid look; the numbered ruler and draggable playhead come in Phase 2.

- [ ] **Step 1: Replace `src/lib/Timeline.svelte` with:**

```svelte
<script lang="ts">
  import { Plus, Diamond, Copy, Minus, Trash2 } from "@lucide/svelte";
  import { state, canvasOps, activeLayer, bump } from "../state/appState.svelte";
  import { addFrame, insertKeyframe, duplicateKeyframe, setHold, deleteFrame } from "../anim/timeline";
  import { resolveKeyframeIndex, type Cell } from "../anim/document";

  // ◆ keyframe · blank (past end or before first key) — hold over a key
  function cellLabel(cells: Cell[], f: number): string {
    if (f >= cells.length) return "";
    if (cells[f].kind === "key") return "◆";
    return resolveKeyframeIndex(cells, f) === null ? "·" : "—";
  }

  function go(f: number) {
    state.playhead = Math.max(0, Math.min(state.project.frameCount - 1, f));
  }

  // All tools act on the active drawing layer at the current frame, current-frame-aware
  // (inserts land AFTER the playhead, then the playhead follows to the new frame).
  function frameTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    addFrame(l, state.playhead);
    bump();
    go(state.playhead + 1);
  }
  function keyTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    insertKeyframe(l, state.playhead, canvasOps);
    bump();
    go(state.playhead + 1);
  }
  function dupTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    duplicateKeyframe(l, state.playhead, canvasOps);
    bump();
    go(state.playhead + 1);
  }
  function holdTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    setHold(l, state.playhead);
    bump();
  }
  function deleteTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    deleteFrame(l, state.playhead);
    bump();
  }

  const toolBtn =
    "w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover border border-border";
</script>

<div class="border-t border-border bg-surface text-text p-2 text-sm">
  <div class="flex gap-1 mb-2">
    <button class={toolBtn} title="Add frame (after current)" onclick={frameTool}><Plus size={16} /></button>
    <button class={toolBtn} title="Insert keyframe (after current)" onclick={keyTool}><Diamond size={16} /></button>
    <button class={toolBtn} title="Duplicate keyframe (after current)" onclick={dupTool}><Copy size={16} /></button>
    <button class={toolBtn} title="Hold (clear keyframe)" onclick={holdTool}><Minus size={16} /></button>
    <button class={toolBtn} title="Delete frame" onclick={deleteTool}><Trash2 size={16} /></button>
  </div>

  <!-- frame-number header -->
  <div class="flex items-center gap-1 mb-1">
    <span class="w-20"></span>
    {#each Array(state.project.frameCount) as _, f}
      <span class="w-6 text-center text-[10px] leading-none"
            class:text-accent={f === state.playhead}
            class:text-text-muted={f !== state.playhead}>{f + 1}</span>
    {/each}
  </div>

  {#each [...state.project.layers].reverse() as layer (layer.id)}
    <div class="flex items-center gap-1"
         class:opacity-100={layer.id === state.activeLayerId}
         class:opacity-70={layer.id !== state.activeLayerId}>
      <span class="w-20 truncate text-text-secondary">{layer.name}</span>
      {#if layer.kind === "draw"}
        {#each Array(state.project.frameCount) as _, f}
          <button
            class="w-6 h-6 border border-border leading-none text-xs"
            class:bg-selection={f === state.playhead}
            class:text-accent-text={f === state.playhead}
            onclick={() => go(f)}>{cellLabel(layer.cells, f)}</button>
        {/each}
      {:else}
        <span class="text-xs text-text-muted ml-1">ref</span>
      {/if}
    </div>
  {/each}
</div>
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run build`
Expected: PASS (no `svelte-check`/`tsc` errors; `Trash2` is a valid `@lucide/svelte` icon).

- [ ] **Step 3: Manual verification**

Run: `npm run dev` and in the browser:
1. Draw on frame 1, press **Insert keyframe** → a new `◆` appears at frame 2 and the playhead moves there; later cells shifted right.
2. Press **Add frame** → a `—`/blank hold is inserted after the current frame on the active layer only; other layers keep their lengths (blank trailing cells under the longer layer).
3. Press **Delete frame** → the current cell is removed on the active layer; the playhead clamps if it was last.
4. Add a second layer, give it more frames than the first → the shorter layer shows blank (`·`/empty) cells under the longer layer's trailing frames, confirming blank-after-end.
5. Press **Hold** on a keyframe → it becomes `—` and the previous keyframe shows through.

- [ ] **Step 4: Commit**

```bash
git add src/lib/Timeline.svelte
git commit -m "feat: rewire timeline tools to per-layer ops + add delete-frame tool"
```

---

## Final verification

- [ ] Run the full suite: `npm test` → all green.
- [ ] Build: `npm run build` → `svelte-check` + `tsc --noEmit` + Vite build pass.
- [ ] Confirm no remaining references to the old project-level `addFrame(project)` / `deleteFrame(project, frame)` signatures:
  Run: `grep -rn "addFrame(\|deleteFrame(" src --include=*.svelte --include=*.ts | grep -v "__tests__"`
  Expected: only `addFrame(l, …)` / `deleteFrame(l, …)` (layer-first) call sites in `Timeline.svelte`.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Independent per-layer lengths + derived document length → Tasks 1, 2, 9, 10. ✓
- Blank past a layer's end → Task 1. ✓
- Drawing past a layer's end extends it → Task 8. ✓
- Operations (add/insert-after/insert-blank/duplicate/hold/delete/move/setHoldSpan/all-layers) → Tasks 3–7. ✓
- Current-frame-aware insertion + Delete-frame tool + per-layer strips → Task 11. ✓
- Consumer updates (`bump`, persistence) → Tasks 9, 10. (`onion.ts`, `mergeDown`, `duplicateLayer`, export need no change — they consume `resolveKeyframeIndex`/`frameCount`, both preserved; verified in spec "Consumers to update".)

**Out of Phase 1 (later phases):** numbered ruler + draggable playhead (Phase 2); keyframe-drag + hold-edge-drag UI wiring to `moveKeyframe`/`setHoldSpan` (Phase 3).

**Type consistency:** `addFrame(layer, after)`, `insertKeyframe(layer, after, ops)`, `insertBlankKeyframe(layer, after, ops)`, `duplicateKeyframe(layer, frame, ops)`, `setHold(layer, frame)`, `deleteFrame(layer, frame)`, `moveKeyframe(layer, from, to)`, `setHoldSpan(layer, keyFrame, span)`, `insertFrameAllLayers(project, at)`, `deleteFrameAllLayers(project, at)`, `documentLength(project)`, `refreshLength(project)` — names/signatures consistent across all tasks and the Timeline rewrite imports exactly the per-layer functions it calls (`addFrame, insertKeyframe, duplicateKeyframe, setHold, deleteFrame`).
