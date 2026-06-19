# Drawing-Layer Free Transform (Approach B) — Design

**Status:** Approved (design phase)
**Date:** 2026-06-19

## Goal

Give **drawing layers** a persistent, non-destructive free transform (move/scale/rotate the whole
layer with the existing gizmo, no selection required) — and let you keep painting on a transformed
layer. This closes the long-standing gap where only *reference* layers could be freely transformed
(drawing layers could only be transformed destructively through a selection). See
`docs/superpowers/specs/2026-06-19-clipboard-paste-and-reference-rasterize-design.md` (Approach A) for
the context this was deferred from.

## Decisions (settled in brainstorming)

1. **One transform per layer**, shared across all frames — a *placement*, not per-frame animation.
2. **Full draw-through-transform** — brush/eraser/fill paint correctly on a transformed layer
   (input inverse-mapped into local cell space). Select/lasso on a transformed layer is **deferred**.
3. **A dedicated `transform` tool** activates the gizmo for drawing layers; **reference layers are
   unchanged** (their gizmo still auto-shows when active, any tool).

## Core model

A drawing cell is a document-sized canvas, so the layer transform pivots around the **document
center** with a `{dx,dy}` offset — i.e. the gizmo/math "base rect" for a draw layer is the **full
document** `{x:0,y:0,w:W,h:H}` (reference layers use their contain-fit rect). The transform type is the
existing `RefTransform {dx,dy,scale,rotation}` (`src/anim/document.ts`); the math engine
(`src/core/ref-transform.ts`) is already layer-agnostic.

Add to `src/anim/document.ts`:
- `transform: RefTransform` on `DrawingLayer` (default identity via `createDrawingLayer`).
- `export const IDENTITY_TRANSFORM: RefTransform = { dx: 0, dy: 0, scale: 1, rotation: 0 };`
- `export function isIdentityTransform(t: RefTransform): boolean` — `dx===0 && dy===0 && scale===1 && rotation===0`.
- `export function transformBaseRect(layer: Layer, docW: number, docH: number): Rect` — full-doc rect
  for a draw layer; `containRect(mediaIntrinsicSize(...), docW, docH)` for a ref. (Logical coords;
  callers scale by dpr for rendering. `Rect` is re-exported from `ref-transform.ts` or duplicated —
  use the existing `Rect` shape `{x,y,w,h}`.)

## Rendering (non-destructive)

Factor the affine draw out of `render.ts` so reference media and drawing cells share it:

```ts
// src/anim/render.ts — assumes ctx at identity, DEVICE pixels. base is the device-space rect.
export function drawTransformed(ctx, img, base: Rect, t: RefTransform, dpr: number): void {
  const cx = base.x + base.w / 2 + t.dx * dpr;
  const cy = base.y + base.h / 2 + t.dy * dpr;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t.rotation);
  ctx.scale(t.scale, t.scale);
  ctx.drawImage(img, -base.w / 2, -base.h / 2, base.w, base.h);
  ctx.restore();
}
```
- `drawReferenceMedia` (Approach A) is rewritten to call `drawTransformed` with `base = containRect(size, docW*dpr, docH*dpr)`.
- `compositeFrameLayers` draw branch: **identity transform → keep the fast `drawImage(cell.canvas, 0, 0)`** (the overwhelmingly common case, avoids per-frame transform cost); else
  `drawTransformed(ctx, cell.canvas, {x:0,y:0,w:project.width*dpr,h:project.height*dpr}, layer.transform, dpr)`.
- **Export** already routes through `compositeFrameLayers`, so transformed layers export correctly
  with no bake.

**Onion (`src/anim/onion.ts`):** the all-layers ghost path uses `compositeFrameLayers` → inherits the
transform automatically. The active-layer-only ghost branch (`scratch.drawImage(cell.canvas, 0, 0)`)
applies the same identity-check + `drawTransformed`.

**Boil (`src/core/boil-gl.ts` path in `compositeFrameLayers`):** `boilLayer` draws a fixed
full-screen quad, so the transform can't be applied in GLSL cheaply. Instead, for a non-identity draw
layer, render its cell through `drawTransformed` into a **reused doc-sized scratch canvas** first, then
pass that scratch canvas to `boilLayer` as `src`. Identity layers pass `cell.canvas` directly
(unchanged). No shader change. (One module-level scratch canvas, sized to the device doc dims.)

## Transform tool + gizmo

- Add `"transform"` to `Tool` (`src/state/appState.svelte.ts`: `"brush" | "eraser" | "fill" |
  "select" | "lasso" | "transform"`). Toolbar gets a Transform tool button (lucide `Move`).
- **Gizmo visibility** (`src/lib/RefTransformGizmo.svelte`): show for the active layer when it is a
  `ref` (today, any tool) **or** a `draw` layer **and** `state.tool === "transform"`. The gizmo edits
  `layer.transform` for either kind; the only difference is the base rect (`transformBaseRect`).
- **Input routing** (`src/lib/Canvas.svelte` `onStroke`): if the active layer is a `ref`, or it is a
  `draw` layer with `tool === "transform"`, route the pointer to the transform-drag handler
  (generalize the current `onRefTransform` to take any layer + its `transformBaseRect`); otherwise
  draw/select as today.

## Drawing through the transform

Add to `src/core/ref-transform.ts`:
```ts
/** Map a document-space point into the layer's local (untransformed) cell space — inverse of the
 *  affine used to render the layer. Identity transform ⇒ returns the point unchanged. */
export function inverseTransformPoint(base: Rect, t: RefTransform, p: Pt): Pt {
  const cx = base.x + base.w / 2, cy = base.y + base.h / 2;
  const ox = p.x - (cx + t.dx), oy = p.y - (cy + t.dy);
  const cos = Math.cos(-t.rotation), sin = Math.sin(-t.rotation);
  return { x: cx + (ox * cos - oy * sin) / t.scale, y: cy + (ox * sin + oy * cos) / t.scale };
}
```
- In `Canvas.svelte`, when painting on a draw layer whose transform is non-identity, map each input
  point with `inverseTransformPoint(base, layer.transform, p)` (base = `transformBaseRect`, logical
  coords — input points are already logical doc coords) **before** the pressure-curve/draw step in
  `paintStroke`, and map the seed point in `doFill`. Eraser uses the same `paintStroke` path.
- The **live preview is automatically correct**: `recomposite` draws the active cell through the
  transform, so a stroke drawn into local space appears under the cursor.
- **Brush size** is in local space — a scaled layer shows proportionally scaled strokes (expected).
  The on-canvas brush cursor may not exactly match width/orientation at non-1 scale/rotation in v1
  (acceptable; noted, not fixed here).
- **Select/lasso deferral:** when the active draw layer has a non-identity transform, `onStroke`
  treats the select/lasso tools as inert (early return) — paired with a small inline hint in the
  toolbar/selection area: "Apply transform to edit a selection." They work normally once the
  transform is identity (e.g. after Apply).

## Apply / Reset / Merge

In `src/state/appState.svelte.ts`:
- **`applyLayerTransform(layerId)`** — bake: for each `key` cell, render it through the transform into
  a fresh doc-sized cell (`createCellCanvas` + `drawTransformed` at identity ctx), replace the cell,
  then set `layer.transform = { ...IDENTITY_TRANSFORM }`. `hold` cells stay holds. Wrapped in
  `commitStructural` (single undo). Reuses the same affine render as compositing, so baked pixels
  match the live view. Off-doc pixels are clipped (inherent to a doc-sized cell).
- **`resetLayerTransform(layerId)`** — set `layer.transform = { ...IDENTITY_TRANSFORM }`; `bump()`;
  one undo step (`commitStructural`).
- **Merge-down**: before compositing two draw layers, if either has a non-identity transform, bake it
  via `applyLayerTransform` first (so the existing merge stays pixel-correct). (Touches `mergeDown`'s
  path in `appState`/`src/anim/timeline.ts`.)

**UI** (`src/lib/LayerList.svelte`): in the active draw layer's row-2, show **Apply** (lucide
`Stamp`/`ImageDown`) and **Reset** (lucide `RotateCcw`) buttons **only when** the layer's transform is
non-identity (`!isIdentityTransform(layer.transform)`), each `e.stopPropagation()` → the new actions.

## Persistence (`src/persist/project-file.ts`)

- Add `transform: RefTransform` to `DrawingLayerJson`.
- Serialize `transform: l.transform` for draw layers (mirroring the existing reference-layer field).
- Deserialize `transform: lj.transform ?? { ...IDENTITY_TRANSFORM }` — back-compat: existing saved
  projects / autosaves without the field load as identity.

## Files touched

- `src/anim/document.ts` — `transform` on `DrawingLayer`; `IDENTITY_TRANSFORM`, `isIdentityTransform`,
  `transformBaseRect`; `createDrawingLayer` default.
- `src/core/ref-transform.ts` — `inverseTransformPoint`.
- `src/anim/render.ts` — `drawTransformed`; `drawReferenceMedia` uses it; `compositeFrameLayers` draw
  branch (2D + boil scratch path) applies it for non-identity draw layers.
- `src/anim/onion.ts` — active-layer ghost branch applies the transform.
- `src/state/appState.svelte.ts` — `Tool` adds `"transform"`; `applyLayerTransform`,
  `resetLayerTransform`; merge-down bakes transforms.
- `src/lib/Canvas.svelte` — gizmo/transform input routing for draw layers; inverse-map brush/eraser/
  fill; select/lasso deferral on transformed layers.
- `src/lib/RefTransformGizmo.svelte` — show + edit for draw layers under the Transform tool; base rect
  via `transformBaseRect`.
- `src/lib/Toolbar.svelte` — Transform tool button.
- `src/lib/LayerList.svelte` — Apply/Reset buttons in the active draw layer's row-2.
- `src/persist/project-file.ts` — serialize/deserialize `transform` on draw layers.
- `src/__tests__/ref-transform.test.ts` (existing) — `inverseTransformPoint` tests.

## Testing

**Test environment:** Vitest runs in **node** (canvas mocked via `recordingCtx`; `appState` not
importable). So pure math is unit-tested; render/onion/boil/gizmo/input/persistence wiring is build- +
manually-verified, consistent with the rest of the canvas code.

**Automated:**
- `inverseTransformPoint` (add to the existing `ref-transform.test.ts`): identity ⇒ returns the point
  unchanged; pure translate `{dx,dy}` ⇒ subtracts the offset; pure uniform scale about doc center ⇒
  inverse divides by scale; pure rotation ⇒ inverse rotates by `-θ`; and a **round-trip**: composing
  the forward render transform (translate/rotate/scale about base center) with `inverseTransformPoint`
  returns the original point (within float tolerance) for a non-trivial `{dx,dy,scale,rotation}`.
- `isIdentityTransform` / `transformBaseRect` (in `document.test.ts`): identity detection; base rect is
  the full doc for a draw layer and the contain-fit rect for a ref.
- Existing `compositeFrameLayers` reference tests stay green (the `drawReferenceMedia` →
  `drawTransformed` refactor must not change output); a new case: an **identity** draw layer still
  emits the plain `drawImage:<id>@<alpha>` (fast path, no translate/scale), and a **non-identity**
  draw layer emits translate/rotate/scale + a sized drawImage.

**Manual (browser):**
- Transform tool + draw layer: gizmo appears; move/scale/rotate repositions the whole layer across all
  frames; references still auto-transform with the gizmo (unchanged).
- Paint on a transformed layer (brush/eraser/fill) — strokes land under the cursor; scaled/rotated as
  expected; the live preview matches the committed result.
- Onion ghosts, playback **boil**, and **export** all show the layer transformed.
- Apply bakes (transform → identity, pixels unchanged on screen) and re-enables select/lasso; Reset
  discards the placement; merge-down of a transformed layer is pixel-correct.
- Save/reload (autosave + project file) preserves the transform; an older project without the field
  loads at identity.

## Out of scope

- Per-frame / animated (keyframed) transforms.
- Editing a **selection/lasso** on a transformed layer (Apply first).
- Lossless re-scale (cells stay raster — scaling blurs; expected for a bitmap app).
- A dedicated transformed/scaled brush **cursor** overlay.

## Self-review notes

- The transform engine and the affine render are *shared* (`ref-transform.ts`, `drawTransformed`), so
  draw and ref layers can't drift; the identity fast-path keeps the common case free.
- The one genuinely new interaction (painting through the transform) is isolated to a single
  inverse-map at the input boundary, with the preview falling out of the existing recomposite.
- Boil is handled without GLSL changes (scratch pre-render), the riskiest integration de-risked.
- Apply/Reset + merge-bake keep destructive operations (merge, selection) correct without forcing the
  transform to be destructive.
