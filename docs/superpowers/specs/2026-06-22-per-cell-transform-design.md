# Per-Cell (Current-Frame) Transform — Design

**Status:** Approved (design phase)
**Date:** 2026-06-22

## Goal

A non-destructive transform whose scope is the **current keyframe's drawing**, edited with a gizmo
whose box **hugs that cell's content** (the natural home for "size the transform box by content" — the
box matches what's on screen, unlike a per-layer box that spans frames you can't see). It composes
**under** the existing per-layer transform (`layer ∘ cell`). The layer transform is unchanged
(full-canvas box, all frames).

This is **Phase A** of the broader transform roadmap (per-cell now; group transform and animated
transforms are later, separate specs).

## Decisions (from brainstorming)

- **Target = the resolved key cell.** On a `hold` frame there is no own cell, so a frame-transform
  edits the *resolved* key (`resolveKeyframeIndex`); the whole hold span moves together. (No
  promote-to-key; that's a future option.)
- **Box frozen on transform-start** to avoid the moving-pivot jump when you draw more on a transformed
  cell.
- **Composition order `layer ∘ cell`** — the cell transform acts in cell-local space; the layer
  transform then places the result.
- **Default scope = Frame** when the Transform tool is active (Layer is the explicit "move all frames"
  choice).
- Persist the per-cell transform.

## Data model (`src/anim/document.ts`)

- Extend the **key** cell:
  ```ts
  export type Cell =
    | { kind: "key"; canvas: HTMLCanvasElement; transform?: RefTransform; transformBox?: Rect | null }
    | { kind: "hold" };
  ```
  `transform` absent/identity ⇒ no cell transform. `transformBox` (logical doc coords) is the **frozen**
  gizmo/pivot box, set when the cell transform becomes non-identity; `null`/absent ⇒ derive live.
  (`Rect = {x,y,w,h}`, the existing shape.)
- Add to `AnimState` (`src/state/appState.svelte.ts`): `transformScope: "frame" | "layer"` (default
  `"frame"`).
- Helpers in `document.ts`:
  - `cellTransform(cell): RefTransform` → `cell.kind === "key" ? cell.transform ?? IDENTITY : IDENTITY`.
  - reuse `IDENTITY_TRANSFORM` / `isIdentityTransform`.

## Content bounds (`src/lib/cell-ink.ts`)

Add a tight-bounds scan next to `isCellEmpty`, cached by the same version key (extend the existing
`WeakMap` or add a parallel one):
```ts
/** Tight non-transparent bounds of `canvas` in DEVICE px, or null if empty. Memoized by version. */
export function contentBounds(canvas: HTMLCanvasElement, version: number): { x: number; y: number; w: number; h: number } | null
```
Implementation: full-resolution single `getImageData` + min/max of non-transparent pixels (acceptable:
runs only when the gizmo needs a *live* box, i.e. before a frame-transform is engaged, and is cached).
Callers convert device→logical by `/dpr`.

**Active-cell box resolver** (Canvas/gizmo, logical coords):
```
cellBox(cell, dpr):
  if cell.transformBox != null: return cell.transformBox          // frozen
  b = contentBounds(cell.canvas, version)                          // live
  return b ? {x:b.x/dpr, y:b.y/dpr, w:b.w/dpr, h:b.h/dpr} : fullDocRect
```

## Render composition (`src/anim/render.ts`)

The draw branch currently blits the cell, or `drawTransformed` for a non-identity **layer** transform.
Generalize to compose **layer ∘ cell**. Add one helper that draws a cell through both:
```ts
// Draws `cell` through cellT (about cellBoxCenter) then layerT (about doc center). All centers DEVICE px.
export function drawCellComposed(ctx, cell, project, dpr, layerT, cellT, cellBoxDev): void {
  ctx.save();
  // layer transform about doc center
  const dcx = (project.width * dpr) / 2, dcy = (project.height * dpr) / 2;
  ctx.translate(dcx + layerT.dx * dpr, dcy + layerT.dy * dpr);
  ctx.rotate(layerT.rotation); ctx.scale(layerT.scale, layerT.scale); ctx.translate(-dcx, -dcy);
  // cell transform about the cell's content-box center
  const ccx = cellBoxDev.x + cellBoxDev.w / 2, ccy = cellBoxDev.y + cellBoxDev.h / 2;
  ctx.translate(ccx + cellT.dx * dpr, ccy + cellT.dy * dpr);
  ctx.rotate(cellT.rotation); ctx.scale(cellT.scale, cellT.scale); ctx.translate(-ccx, -ccy);
  ctx.drawImage(cell, 0, 0); // natural device size
  ctx.restore();
}
```
- **2D draw branch:** if `layerT` and `cellT` are both identity → `drawImage(cell.canvas, 0, 0)`
  (fast path). Else `drawCellComposed(...)` with `cellBoxDev` = the cell's frozen `transformBox`
  (×dpr) — guaranteed set when `cellT` is non-identity; for layer-only it's the full doc rect and
  `cellT` is identity so the cell block is a no-op.
- **Boil:** `transformedCell` scratch renders through `drawCellComposed` instead of `drawTransformed`.
- **Onion** active-layer branch: same compose (layer + cell) with the fast path.
- `drawTransformed` stays for **reference** layers (unchanged).

## Drawing through the transform (`src/lib/Canvas.svelte`)

`paintStroke`/`doFill` already inverse-map input through the layer transform. Compose the cell inverse
**inside** the layer inverse (`cell⁻¹ ∘ layer⁻¹`):
```
local = inverseTransformPoint(cellBoxLogical, cellT, inverseTransformPoint(fullDoc, layerT, p))
```
Applied when the active cell's `cellT` is non-identity (and/or the layer's, as today). Eraser/fill use
the same mapped point.

## Gizmo + tool (`src/lib/RefTransformGizmo.svelte`, `src/lib/Canvas.svelte`)

`activeTransformLayer()`/`onTransformDrag` choose the **target** by `appState.transformScope`:

- **scope = "layer"** (or active layer is a `ref`): exactly today — edit `layer.transform`, base =
  full doc.
- **scope = "frame"** on a draw layer: edit the **resolved key cell's** `transform`, base =
  `cellBox(cell)`. The gizmo handles + pivot use that box. **Layer-transform compositing:** because the
  cell sits *under* the layer transform, map the gizmo's pointer through the layer inverse first, and
  push displayed corners out through the layer forward transform:
  - handle drag point `p_screen` → `viewport.screenToCanvas` → `inverseTransformPoint(fullDoc, layerT, ·)`
    → feed to `applyMove/Scale/Rotate` (whose center is the cell box center).
  - corner/rotate-handle display: `forwardTransformPoint(fullDoc, layerT, corner)` → `viewport.canvasToScreen`.
  - Add `forwardTransformPoint(base, t, p)` to `ref-transform.ts` (the inverse of `inverseTransformPoint`):
    `center + d + R(rot)·s·(p − center)`.
  When `layerT` is identity (the common case) these reduce to the current behavior.
- On **frame-transform drag start**, if the cell transform is identity, freeze the box: set
  `cell.transformBox = cellBox(cell)` (live content bounds, or full doc if empty) before applying the
  first delta. Like the existing layer-transform gizmo, a drag mutates the transform + `bump()` and is
  **not** pushed to undo (only Apply/Reset are undoable — matching today's layer/reference behavior).

**Toolbar** (`src/lib/Toolbar.svelte`): when `appState.tool === "transform"`, show a **Frame / Layer**
segmented toggle bound to `appState.transformScope`.

## Apply / Reset / merge (`src/state/appState.svelte.ts`)

- `applyCellTransform(layerId, frame)` — bake: render the resolved key cell through its `cellTransform`
  into a fresh doc-sized cell (via `drawCellComposed` with `layerT = identity`), replace the cell's
  canvas, clear `transform`/`transformBox`. One undoable structural step.
- `resetCellTransform(layerId, frame)` — clear `transform`/`transformBox` to identity/null.
- The existing `applyLayerTransform`/`resetLayerTransform` stay; the toolbar's Apply/Reset buttons act
  on the active **scope**.
- **Merge-down** already bakes layer transforms; also bake each key cell's transform first (extend
  `bakeLayerTransform` to fold `cellTransform` into the cell before/together with the layer bake), so a
  merge stays pixel-correct.

## Persistence (`src/persist/project-file.ts`)

Cells currently serialize as `("key" | "hold")[]`. To preserve back-compat with the least churn, keep
that array as-is and add a **parallel sparse map** on `DrawingLayerJson`:
`cellTransforms?: { [frameIndex: number]: { transform?: RefTransform; transformBox?: Rect | null } }`,
populated only for key cells whose transform is non-identity. On load, apply each entry to the matching
key cell; absent ⇒ identity/null. Existing saves (no `cellTransforms`) load unchanged. Pixels (one PNG
per key) are untouched.

## Testing

**Automated (node):**
- `contentBounds`: empty canvas → null; a stub with known opaque rect → that bbox; (uses the same
  mockable getImageData pattern as the fill tests).
- `forwardTransformPoint` / round-trip with `inverseTransformPoint` (identity, translate, scale,
  rotate, and a composed non-trivial transform) — pure, in `ref-transform.test.ts`.
- `render.test.ts` (recordingCtx): a cell with an **identity** layer + **non-identity** cell transform
  emits the composed translate/rotate/scale + `drawImage` (not the plain blit); both-identity emits the
  plain blit; existing layer-only and reference cases stay green.

Render/gizmo/Canvas/persist wiring is DOM — build + manual. Existing **212** stay green; build **0/0**;
lint clean.

**Manual (browser):**
- Transform tool, scope **Frame**: the gizmo hugs the current drawing; move/scale/rotate transforms
  **only this keyframe** (scrub away → other frames unaffected); drawing more on the transformed cell
  doesn't jump existing content (frozen box).
- Scope **Layer**: unchanged — full-canvas box, all frames move.
- Both at once: a layer transform *and* a frame transform compose correctly on screen, and the Frame
  gizmo still tracks the pointer under the active layer transform.
- Apply (Frame) bakes just the cell; Reset clears it; merge-down of a frame-transformed layer is
  pixel-correct; onion/playback-boil/export show the cell transform; save-reload round-trips; old
  projects load with identity.

## Out of scope

- Group ("parent context") transform; animated/interpolated transforms (later phases).
- Promoting a hold to a key on transform; per-cell transform on reference layers.
- A live (non-frozen) content box once a transform is engaged.

## Self-review notes

- Reuses the entire Approach-B machinery (`RefTransform`, gizmo math, `drawTransformed`-style render,
  `inverseTransformPoint`, Apply/Reset/merge-bake, persistence) — the new surface is the *cell* target,
  the content-box resolver, and one extra affine in the compose/inverse chains.
- Freezing the box per cell is the same moving-pivot fix established for layers, applied at cell scope.
- The one genuinely new bit of math is composing the cell gizmo *through* an active layer transform;
  it reduces to today's behavior when the layer transform is identity (the common case), so risk is
  contained.
