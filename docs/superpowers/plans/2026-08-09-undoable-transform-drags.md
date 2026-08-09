# Undoable Transform Drags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every completed transform drag (move/scale/rotate, all three draw scopes + reference layers, both drag surfaces) becomes one undo step; the gizmo's "Reset to fit" becomes undoable.

**Architecture:** Reuse the exported `beginStructuralEdit`/`commitStructuralEdit` pair exactly as `Timeline.svelte:279/378` already does for cell drags: snapshot at grab, commit at release only when the transform changed, revert the transformBox freeze directly on a no-op. Frame scope replaces the live cell with a clone *after* the snapshot so in-flight in-place writes can't corrupt the shared snapshot cell (gotcha #8, same pattern as `resetCellTransform`). `restoreStructure` learns to restore reference-layer transforms.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest (pure logic only).

**Spec:** `docs/superpowers/specs/2026-08-09-undoable-transform-drags-design.md`

## Global Constraints

- `npm run build` = 0 errors, 0 warnings after every task; `npm test` green (baseline **351**).
- **Gotcha #8 ordering is load-bearing:** `beginStructuralEdit()` FIRST (the snapshot must capture the old shared cell object), cell replacement SECOND, transformBox freeze THIRD. Never mutate a cell the snapshot shares.
- Transform writes during drags stay as-is (`setT` + `bump()`); this plan only brackets them.
- Undo/redo of these commands flows through the existing `commitStructuralEdit` → `restoreStructure` path — no new history concepts.
- One commit per task, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `isSameTransform`, ref-transform restore, generalized layer reset

**Files:**
- Modify: `src/anim/document.ts` (next to `isIdentityTransform`, ~line 75)
- Modify: `src/state/appState.svelte.ts` (`restoreStructure` ~229-242; `resetLayerTransform` ~455-461)
- Test: `src/__tests__/ref-transform.test.ts`

**Interfaces:**
- Consumes: existing `RefTransform`, `restoreStructure`, `resetLayerTransform`.
- Produces: `export function isSameTransform(a: RefTransform, b: RefTransform): boolean` in `document.ts` — Tasks 2 and 3 import it; `restoreStructure` restores `transform` for ref layers; `resetLayerTransform` works on reference layers.

- [ ] **Step 1: Write the failing test** (append to `src/__tests__/ref-transform.test.ts`; import `isSameTransform` from `"../anim/document"`):

```ts
describe("isSameTransform", () => {
  const t = { dx: 3, dy: -1, scale: 1.5, rotation: 0.2 };
  it("exact field equality", () => {
    expect(isSameTransform(t, { ...t })).toBe(true);
    expect(isSameTransform(t, { ...t, dx: 3.0000001 })).toBe(false);
    expect(isSameTransform(t, { ...t, rotation: 0 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it** — `npm test -- ref-transform` — FAIL (not exported).
- [ ] **Step 3: Implement.**

`src/anim/document.ts` (after `isIdentityTransform`):

```ts
/** Exact equality — drag deltas recompute from the grab-time transform, so an untouched drag
 *  ends bit-identical; no epsilon. Used to skip history pushes for no-op drags. */
export function isSameTransform(a: RefTransform, b: RefTransform): boolean {
  return a.dx === b.dx && a.dy === b.dy && a.scale === b.scale && a.rotation === b.rotation;
}
```

`src/state/appState.svelte.ts`, `restoreStructure` — move the transform restore out of the draw-only branch so refs get it too:

```ts
    if (live && live.kind === snap.kind) {
      live.groupId = snap.groupId; // group membership is structural (reorder/regroup), undoable — not a view-prop
      if (live.kind === "draw" && snap.kind === "draw") {
        live.cells = snap.cells.slice();
      }
      live.transform = { ...snap.transform }; // undoable for draw AND ref layers (drag undo); visibility/opacity/name stay live
      return live;
    }
```

`resetLayerTransform` — drop the draw-only guard (identity guard stays); works for refs because the body replaces the transform object (snapshot-safe) and restore now covers refs:

```ts
export function resetLayerTransform(layerId: number): void {
  const layer = state.project.layers.find((l) => l.id === layerId);
  if (!layer || isIdentityTransform(layer.transform)) return;
  commitStructural(() => {
    layer.transform = { ...IDENTITY_TRANSFORM };
  });
}
```

- [ ] **Step 4: Run** — `npm test` (351 + 1 green), `npm run build` 0/0.
- [ ] **Step 5: Commit** — `feat: isSameTransform + undo-restorable ref transforms + ref-capable layer reset`

---

### Task 2: Canvas transform-drag lifecycle pushes undo

**Files:**
- Modify: `src/lib/Canvas.svelte` (`refDrag` ~346, `onTransformDrag` ~348-429)

**Interfaces:**
- Consumes: `isSameTransform` (Task 1), exported `beginStructuralEdit`/`commitStructuralEdit` (existing — extend the state-module import list), `StructSnapshot` type is NOT exported — hold it as `ReturnType<typeof beginStructuralEdit>`.
- Produces: no new exports; behavior only. (`input.ts` ends every gesture with `done: true` via `pointerup`/`pointerleave`, so the release hook always runs.)

- [ ] **Step 1: Add drag-undo state beside `refDrag` (~line 346):**

```ts
  // One undo step per completed transform drag: snapshot at grab, commit at release iff the
  // transform changed; on a no-op, revert the grab-time transformBox freeze instead (spec 2026-08-09).
  let refDragUndo: ReturnType<typeof beginStructuralEdit> | null = null;
  let refDragFreeze: { kind: "cell" | "group"; prevBox: Rect | null } | null = null;
```

(If `Rect` isn't already a local type alias, use `{ x: number; y: number; w: number; h: number }`.)

- [ ] **Step 2: Rework the grab block** (currently `if (!refDrag) { ... }` ~410-420). Order: hit-test → snapshot → frame-scope cell replacement → freeze (recording the pre-freeze box):

```ts
    if (!refDrag) {
      const tol = 10 / viewport.zoom;
      const gap = REF_ROTATE_GAP_PX / viewport.zoom;
      const handle = hitTestHandle(base, getT(), pc, tol, gap);
      if (handle) {
        refDragUndo = beginStructuralEdit(); // FIRST: snapshot must capture the old shared cell (gotcha #8)
        if (isDraw && scope === "frame" && frameRk) {
          const dl = layer as Extract<Layer, { kind: "draw" }>;
          dl.cells[frameRk.index] = { ...frameRk.cell }; // fresh object; in-drag writes can't corrupt the snapshot
          frameRk = { index: frameRk.index, cell: dl.cells[frameRk.index] as typeof frameRk.cell };
        }
        // Freeze the box on grab for a frame/group transform currently at identity.
        if (isIdentityTransform(getT())) {
          if (isDraw && scope === "frame" && frameRk) {
            refDragFreeze = { kind: "cell", prevBox: frameRk.cell.transformBox ?? null };
            frameRk.cell.transformBox = base;
          } else if (isDraw && scope === "group" && g) {
            refDragFreeze = { kind: "group", prevBox: g.transformBox ?? null };
            g.transformBox = base;
          }
        }
      }
      refDrag = { handle, start: pc, startT: { ...getT() }, center: transformCenter(base, getT()) };
    }
```

Note: `getT`/`setT` for frame scope close over the local `frameRk` variable (`frameRk!.cell`), so rebinding it re-targets them within this call; later batches re-resolve `frameRk` fresh, finding the clone. The pre-existing freeze block this replaces (~414-418) is removed.

- [ ] **Step 3: Rework the release block** (`if (done) refDrag = null;` at the end ~428, and the two early-return sites ~370 and ~402-404):

End of function:

```ts
    if (done) {
      finishTransformDragUndo(() => getT());
      refDrag = null;
    }
```

Add the shared finisher (component scope, near `refDrag`):

```ts
  // endT is a thunk: at the early-return sites the target is gone and there is no getT — pass null
  // there and commit unconditionally (the drag DID change state; an unrecorded change is the bug
  // this feature removes).
  function finishTransformDragUndo(endT: (() => Layer["transform"]) | null) {
    if (refDragUndo) {
      if (refDrag?.handle && endT && isSameTransform(refDrag.startT, endT())) {
        // No-op drag: push nothing, revert the freeze we did at grab.
        if (refDragFreeze?.kind === "cell") {
          // frameRk isn't in scope here; the frozen cell is the active layer's resolved key cell.
          const l = appState.project.layers.find((x) => x.id === appState.activeLayerId);
          if (l?.kind === "draw") {
            const rk = resolvedKeyCell(l, appState.playhead);
            if (rk) rk.cell.transformBox = refDragFreeze.prevBox;
          }
        } else if (refDragFreeze?.kind === "group") {
          const l = appState.project.layers.find((x) => x.id === appState.activeLayerId);
          const grp = l ? groupOf(l, appState.project.groups) : null;
          if (grp) grp.transformBox = refDragFreeze.prevBox;
        }
      } else if (refDrag?.handle) {
        commitStructuralEdit(refDragUndo);
      }
      // handle === null (grab missed every handle): nothing mutated, drop the snapshot silently.
    }
    refDragUndo = null;
    refDragFreeze = null;
  }
```

Early-return sites (~370, ~402-404) become:

```ts
      if (done) {
        finishTransformDragUndo(null);
        refDrag = null;
      }
      return;
```

- [ ] **Step 4: Verify** — `npm run build` 0/0, `npm test` green. Browser spot-check if a dev server is practical (move → undo, click-without-move → undo skips it); otherwise state it as owed.
- [ ] **Step 5: Commit** — `feat: transform drags on canvas push one undo step per gesture`

---

### Task 3: Gizmo handle drags push undo; Reset-to-fit becomes undoable

**Files:**
- Modify: `src/lib/RefTransformGizmo.svelte` (drag state ~47-54, `startHandleDrag` ~138-171, `endHandleDrag` ~184-196, `resetTransform` ~220-233, `onMount` cleanup ~235-244)

**Interfaces:**
- Consumes: `isSameTransform` (Task 1), `beginStructuralEdit`/`commitStructuralEdit`, `resetLayerTransform`/`resetCellTransform`/`resetGroupTransform` (all existing exports from the state module — extend the import at line 4).
- Produces: no new exports.

- [ ] **Step 1: `startHandleDrag`** — after the guards and pointer capture, in this order: snapshot → frame-scope cell replacement (then REBUILD the target so the closures point at the clone) → freeze with prevBox recording → build `drag`:

```ts
  function startHandleDrag(handle: DragHandle, e: PointerEvent) {
    const vp = getViewport();
    let tgt = transformTarget();
    if (!vp || !tgt || !tgt.base) return;
    e.stopPropagation();
    e.preventDefault();
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    dragUndo = beginStructuralEdit(); // FIRST (gotcha #8: snapshot the old shared cell)
    if (tgt.scope === "frame" && tgt.cell) {
      const l = activeTransformLayer();
      if (l?.kind === "draw") {
        const idx = l.cells.indexOf(tgt.cell);
        if (idx >= 0) {
          l.cells[idx] = { ...tgt.cell };
          tgt = transformTarget(); // re-resolve: closures must write the clone, not the snapshot's cell
          if (!tgt || !tgt.base) {
            dragUndo = null;
            return;
          }
        }
      }
    }
    const base = tgt.base;
    const t = tgt.getT();
    // Freeze the content box on grab for a frame or group transform that's currently identity,
    // so the gizmo's box stays put as content moves under the new transform.
    if (isIdentityTransform(t)) {
      if (tgt.scope === "frame" && tgt.cell) {
        dragFreeze = { cell: tgt.cell, group: null, prevBox: tgt.cell.transformBox ?? null };
        tgt.cell.transformBox = base;
      } else if (tgt.scope === "group" && tgt.group) {
        dragFreeze = { cell: null, group: tgt.group, prevBox: tgt.group.transformBox ?? null };
        tgt.group.transformBox = base;
      }
    }
    const start = inverseChain(tgt.outer, vp.screenToCanvas(e.clientX, e.clientY));
    drag = {
      handle,
      startT: { ...t },
      start,
      center: transformCenter(base, t),
      outer: tgt.outer,
      setT: tgt.setT,
      getT: tgt.getT,
    };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", endHandleDrag);
    window.addEventListener("pointercancel", endHandleDrag);
  }
```

State additions beside `drag` (~54): `getT` added to the drag record type, plus:

```ts
  let dragUndo: ReturnType<typeof beginStructuralEdit> | null = null;
  let dragFreeze: {
    cell: Extract<Cell, { kind: "key" }> | null;
    group: LayerGroup | null;
    prevBox: Rect | null;
  } | null = null;
```

(Reuse the file's existing `Rect` type, ~line 68. Note: unlike Canvas, the gizmo holds direct object refs in `dragFreeze` — valid because the drag record's closures hold the same objects for the same duration.)

- [ ] **Step 2: `endHandleDrag`** — commit-or-revert before dropping state; note `resolvedKeyCell` in `transformTarget` re-resolves per call, but `drag.getT` still closes over the grab-time target, which is what we compare:

```ts
  function endHandleDrag(e: PointerEvent) {
    if (drag) {
      try {
        (e.target as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        /* may already be released */
      }
    }
    settleDragUndo();
    drag = null;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", endHandleDrag);
    window.removeEventListener("pointercancel", endHandleDrag);
  }

  function settleDragUndo() {
    if (dragUndo && drag) {
      if (isSameTransform(drag.startT, drag.getT())) {
        if (dragFreeze?.cell) dragFreeze.cell.transformBox = dragFreeze.prevBox;
        else if (dragFreeze?.group) dragFreeze.group.transformBox = dragFreeze.prevBox;
      } else {
        commitStructuralEdit(dragUndo);
      }
    }
    dragUndo = null;
    dragFreeze = null;
  }
```

- [ ] **Step 3: unmount cleanup** (~onMount return) — an interrupted-but-changed drag must not become an unrecorded transform: call `settleDragUndo()` before removing the listeners.

- [ ] **Step 4: Route `resetTransform`** through the undoable actions (replaces the whole in-place body; keep the function, the overlay button stays wired to it):

```ts
  function resetTransform() {
    const l = activeTransformLayer();
    const tgt = transformTarget();
    if (!l || !tgt) return;
    if (tgt.scope === "frame") resetCellTransform(l.id, appState.playhead);
    else if (tgt.scope === "group" && tgt.group) resetGroupTransform(tgt.group.id);
    else resetLayerTransform(l.id); // draw layer-scope AND reference layers (Task 1 generalized it)
  }
```

Remove the now-unused `IDENTITY` const and `bump` import if nothing else in the file uses them (check before deleting — `bump` is used by `onDragMove`).

- [ ] **Step 5: Verify** — `npm run build` 0/0, `npm test` green.
- [ ] **Step 6: Commit** — `feat: gizmo handle drags + Reset-to-fit push undo`

---

### Task 4: Docs + verification sweep

**Files:**
- Modify: `CLAUDE.md` (gotcha #6; a dated entry with the owed browser pass)

- [ ] **Step 1: Rewrite gotcha #6:** transform drags now push one undo step per completed gesture (grab-snapshot → commit-on-release, no-op drags push nothing and revert the box freeze); frame scope replaces the cell at grab per gotcha #8; ref-layer transforms are restored by `restoreStructure` since 2026-08-09. The old "drags don't push undo" note is superseded.
- [ ] **Step 2: Add a dated entry** ("**Undoable transform drags (2026-08-09, on branch):**") in the verification-debt area with the owed browser pass: move → undo → back; scale/rotate → undo; frame-scope drag → undo restores the cell transform; drag then undo an *earlier* structural op (drag no longer reverts with it); click-without-move pushes nothing; Reset-to-fit → undo; ref-layer drag → undo; redo for all; mid-drag pointercancel (iPad palm rejection) commits; iPad overall.
- [ ] **Step 3: Full verification** — `npm run build` 0/0, `npm test` (351 + Task 1's new test), `npm run lint`.
- [ ] **Step 4: Commit** — `docs: undoable transform drags — gotcha #6 update + verification debt`

---

## Self-review notes

- **Spec coverage:** lifecycle → T2 (canvas) + T3 (gizmo); ref restore + reset generalization + no-op predicate → T1; Reset-to-fit routing → T3 Step 4; unmount/cancel handling → T2 finisher on early-returns + T3 Step 3; docs → T4.
- **Known accepted gaps:** the early-return commit in T2 can push a no-op undo step when the target vanishes mid-drag (rare; conservative direction); Canvas's no-op freeze revert re-resolves the cell by active layer + playhead, which can differ from the grab-time cell only if layer/frame changed mid-gesture — in that case the revert is skipped by the null guards and the frozen box survives as a stale-but-harmless `transformBox` (it re-freezes on next grab).
- **Type consistency check:** `drag.getT` added in T3 Step 1 and consumed in Step 2; `refDragFreeze`/`dragFreeze` shapes differ between files by design (Canvas re-resolves, gizmo holds refs) — each is self-contained.
