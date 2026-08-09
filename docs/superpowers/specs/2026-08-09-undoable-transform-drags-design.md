# Undoable Transform Drags — Design

**Status:** Approved direction (investigated + user-confirmed 2026-08-09)
**Date:** 2026-08-09
**Supersedes:** CLAUDE.md gotcha #6 ("gizmo drags don't push undo — intentional"). That decision
matched the original reference-layer gizmo; the user has reversed it after testing the Transform
tool. Update the gotcha when this ships.

## Problem (from the 2026-08-09 investigation)

Transform-tool drags (move/scale/rotate) and reference-layer gizmo drags write transforms with no
history interaction (`Canvas.svelte:423-426`, `RefTransformGizmo.svelte:179-181`). Three defects:

1. **Not undoable** — the reported issue.
2. **Destroyed by unrelated undos (layer & group scope):** structural snapshots capture layer and
   group transforms and `restoreStructure` restores them (`appState.svelte.ts:235`), so undoing any
   structural op made *before* a drag reverts the drag too — unrecoverably (redo restores the same
   pre-drag transform).
3. **Scope-inconsistent:** frame-scope drags mutate the shared cell object in place
   (`rk.cell.transform = t`), which writes through into snapshots, so *cell* transforms survive
   structural undo while *layer/group* transforms are reverted. Also, the gizmo overlay's "Reset to
   fit" is not undoable while the LayerList/ToolOptions resets are.

## Requirements (user-confirmed)

1. One undo step per completed drag gesture — move, scale, or rotate.
2. Covers all three draw-layer scopes (frame / layer / group) **and reference layers** (any tool).
3. Both drag surfaces: the Canvas body/handle path and the RefTransformGizmo handle path.
4. The gizmo's "Reset to fit" becomes undoable (routes through the existing reset actions).
5. A click that doesn't move anything pushes nothing.

## Design

### Drag lifecycle → history

Use the existing exported machinery — no new history concepts:

- **At grab** (before anything mutates): `const before = beginStructuralEdit()`.
- **Then, frame scope only:** replace the live cell with a fresh clone —
  `layer.cells[rk.index] = { ...rk.cell }` — so the drag's in-place writes land on an object the
  before-snapshot does NOT share (gotcha #8; same pattern as `resetCellTransform`). Order matters:
  snapshot first (it must capture the old shared cell), replace second.
- **Then** the existing transformBox freeze (frame/group at identity), so undo also unfreezes.
- **During the drag:** unchanged (setT writes + `bump()`).
- **At release** (`pointerup` and `pointercancel` both): if the transform changed
  (`!isSameTransform(startT, getT())`), `commitStructuralEdit(before)`. If not, revert the
  grab-time mutations directly (restore the pre-freeze `transformBox` captured at grab; the cell
  clone is harmless to leave) and push nothing.
- **Unmount/interruption mid-drag:** the gizmo's existing cleanup commits an in-flight changed drag
  before dropping listeners (an applied-but-unrecorded transform is exactly defect #2).

`isSameTransform(a, b)`: exact field equality on `{dx, dy, scale, rotation}` — drags recompute from
`startT`, so an untouched drag ends bit-identical; no epsilon needed. Pure → unit-testable.

### Reference layers become part of structural undo

`restoreStructure` currently restores `transform` for draw layers only; ref layers keep all live
props. Change: restore `live.transform = { ...snap.transform }` for refs too. Ref
visibility/opacity/name stay live-kept (they remain view-props; the transform no longer is).
`cloneLayers`' shallow `{ ...l }` already snapshots the transform object reference safely — every
drag write *replaces* `l.transform` (applyMove/Scale/Rotate return new objects), never mutates it.

### Reset paths unified

The gizmo's "Reset to fit" calls the existing undoable actions: `resetCellTransform` (frame),
`resetGroupTransform` (group), `resetLayerTransform` (layer). `resetLayerTransform` is generalized
to accept reference layers (drop its `kind !== "draw"` guard in favor of "has a transform";
identity-guard stays). Its own in-place body is already snapshot-safe (replaces the transform
object).

### What this deliberately does not change

Gizmo drags during an active selection/deform/pose lift (separate systems, own banking); the
Apply/bake actions (already undoable); anything about the `transformBox` semantics beyond making
the freeze part of the drag's undo unit.

## Testing & verification

- **Unit:** `isSameTransform` (or reuse `isIdentityTransform`-style helper placement in
  `document.ts`/`ref-transform.ts`).
- **Build + review** for the lifecycle wiring (Canvas/gizmo/appState are not node-testable).
- **Browser pass owed:** move → undo → back; scale/rotate → undo; frame-scope drag → undo (cell
  transform restored — the gotcha-#8 case); drag then undo an *earlier* structural op (transform no
  longer reverts with it); click-without-move pushes nothing (undo hits the previous action);
  Reset-to-fit → undo; ref-layer drag → undo; redo for all of the above; iPad.

## Out of scope

Undo for gizmo drags *mid-lift*; merging consecutive drags into one step; transform keyframing.
