# Deform Tool (FFD via the existing warp engine) — Design

**Status:** Approved (design phase)
**Date:** 2026-06-26

## Goal

A per-frame **Deform** tool for quick pose/shape editing — drag a control-lattice over a cell's
drawing to bend a limb or reshape a silhouette without redrawing. Ships by **reusing the app's
existing grid-mesh warp engine** (`src/core/selection.ts`), not by building a new FFD/WebGL pipeline.
Idea origin: `docs/superpowers/specs/2026-06-25-mesh-deform-tool-notes.md`.

## Key realization driving the design

The app **already has** a working free-form grid-mesh warp, bound to the selection tool: an arbitrary
`rows × cols` `warpGrid` of draggable control points (`beginWarp`, `densifyWarp` — lossless
edit-preserving resample), rendered by splitting each grid quad into two affine triangles
(`triangleAffine`), with a lift→warp→bake→undo lifecycle (`liftPixels` / `renderFloatingTo` /
`onCommit` / `onCancel`). Today it's reached via a marquee + the W/M keys.

The Deform tool is therefore mostly **entry orchestration**: auto-target the whole cell's content,
lift it, and drop straight into a denser warp grid — reusing the proven engine, overlay, and bake
path. Approach **A** from brainstorming (generalize the existing warp), destructive bake, kept
deliberately lean.

## Scope (decisions from brainstorming)

- **Target:** the whole cell's content (`contentBounds`), always. Region-specific warps stay available
  via the existing select+warp. Local control comes from grid **density**, not a marquee.
- **Grid:** default **4×4**, with **−/+ density** (reuses `densifyWarp`, edit-preserving).
- **Per-frame, destructive:** bakes into the cell on Apply as one undo step (reuses the selection
  commit path); re-deform = re-enter.
- **Disabled on a transformed layer/cell** (non-identity layer/cell/group transform) with the existing
  "Apply transform first" hint — same guard that already gates select/lasso, because the warp operates
  in cell-pixel space and its handles wouldn't align with a transformed on-screen appearance.

## Reuse map

| Need | Source (existing) | New? |
|---|---|---|
| Control-grid model + density | `selection.ts` `warpGrid`/`beginWarp`/`densifyWarp` | reuse |
| Warp raster render (triangle-affine) | `selection.ts` `renderFloatingTo` + `triangleAffine` | reuse |
| Lift / bake / undo / cancel | Canvas `selection.onCommit`/`onCancel`, `liftPixels` | reuse |
| Handle hit-test + drag | `selection.hitTest("grid")` / `startDrag`/`updateDrag` | reuse |
| **Deform tool + entry orchestration** | — | **new** (small) |
| **Density −/+ UI** | extend the warp action panel | **new** (small) |

## New pieces

### 1. Tool (`appState.svelte.ts`, `Toolbar.svelte`)
Add `"deform"` to `Tool`. Add a Deform toolbar button (lucide e.g. `Spline`/`Move3d` — pick an unused
glyph). Per-frame only → **no scope toggle** (unlike Transform).

### 2. Entry orchestration (`Canvas.svelte`)
Add `enterDeform()`:
```
al = activeLayer(); if al.kind !== "draw" || al.locked → return
if non-identity layer/cell transform → return (guard; hint shown)
canvas = ensureDrawableKeyframe(al, playhead)            // promotes a hold if needed
b = contentBounds(canvas, version); if !b → return       // empty cell → no-op
selCtx = canvas 2d ctx; selBefore = snapshot (for undo)  // mirrors the existing transform-lift setup
selection.rect = { x: b.x/DPR, y: b.y/DPR, w: b.w/DPR, h: b.h/DPR }  // logical content rect
lifted = selection.liftPixels(selCtx, DPR)
selection.beginTransform(lifted); selection.beginWarp(4, 4)
```
Trigger it from the **existing tool-watching `$effect`** in Canvas: when `state.tool` becomes
`"deform"`, call `enterDeform()`; when the tool changes away while a deform is floating, the existing
"bank a floating transform on switch to a drawing tool" path commits it (same as selection). So the
deform also commits when you pick a drawing tool, and cancels via Esc / Cancel.

### 3. Input routing (`Canvas.svelte` `onStroke`)
Extend the select/lasso branch to also run for `state.tool === "deform"`, but for deform only the
**grid-handle drag** sub-path is active (`hitTest` → `startDrag("grid")` → `updateDrag` → `endDrag`).
Deform never starts a marquee; a press outside any handle is ignored (no create). The
transformed-layer guard (the existing early-return) extends to include `"deform"`.

### 4. Density + Apply/Cancel panel (`SelectionActions.svelte`)
The action panel already renders in the `warping` state with Distort/Mesh/Commit/Cancel. Add, shown
when the active tool is `deform` (or generally in warping): **−/+ density** buttons calling a new
`onDensify(delta)` → `selection.densifyWarp(rows±1, cols±1)` (clamped ≥2), plus the existing
**Apply** (`onCommit`) / **Cancel** (`onCancel`). Reuse the existing wiring; no new bake/undo code.

## Bake / undo / cancel

Entirely the existing path: **Apply** → `selection.commit()` → Canvas `onCommit` blits the warped
floating pixels into the cell, pushes **one** undo step (before/after `ImageData`), bumps,
recomposites. **Cancel/Esc** → `onCancel` restores `selBefore`. Destructive, single undo, no new code.

## ARAP-readiness (why FFD-first, and how it stays cheap to upgrade)

ARAP's output is new vertex positions for a triangle mesh, and **rendering a deformed triangle mesh is
exactly the `triangleAffine` raster warp this design already uses**. So the entire scaffolding here —
lift→render→bake, tool, panel, undo, handle interaction — is reused by ARAP. The future ARAP upgrade
**replaces only the "given handle positions, produce mesh vertices" block**: today FFD's handles *are*
the vertices (direct, no solver); ARAP drags a few pinned handles and a sparse least-squares solver
fills the rest rigidly. Upgrade ladder: FFD grid → ARAP-on-the-same-grid (add solver) →
ARAP-on-silhouette-triangulation (add Delaunay). **Implementation note for the plan:** keep the
grid/handle/warp data behind the existing `Selection` surface and avoid baking FFD-specific assumptions
into the tool/panel, so the deformation-computation stays a swappable unit.

## Out of scope

- Non-destructive per-cell deform storage (this is destructive, like select+warp).
- Smoother interpolation (bicubic/FFD) or WebGL warp — the existing triangle-affine render is used, so
  a **faint diagonal crease** can show under strong deformation (accepted v1 limitation).
- ARAP itself (the solver / silhouette triangulation) — a deliberate later upgrade.
- Animated/keyframed deform; deform on reference layers; deforming a sub-region (use select+warp).

## Testing

Mostly reuse — the warp math (`sampleGrid`/`densifyWarp`/`bilinearSample`/`triangleAffine`) already
exists. New logic is thin:
- **Automated (node):** a small pure helper that converts a device-px `contentBounds` rect to the
  logical selection rect (and clamps density ≥2) — unit-tested. If `densifyWarp` clamping isn't
  already covered, add a case.
- Tool/entry/overlay/panel are DOM → **build + manual**. Existing test baseline stays green; build
  0/0; lint clean.

**Manual (browser):**
- Select Deform on a draw layer with content → a 4×4 grid appears over the drawing; drag handles to
  bend/reshape; −/+ changes density while preserving the pose; Apply bakes (one undo); Cancel/Esc
  restores; switching to a brush commits.
- Empty cell → nothing happens. Transformed layer/cell → disabled with the "Apply transform first"
  hint (consistent with select/lasso). Hold frame → promotes/targets the resolved key (via
  `ensureDrawableKeyframe`).
- The deformed bake composites correctly with onion/boil/export and round-trips through save (it's
  just cell pixels).

## Self-review notes

- The feature is ~all orchestration of proven primitives; the only genuinely new surface is the tool
  button, `enterDeform()`, the onStroke routing extension, and two density buttons — risk is contained.
- The destructive/crease limitations are inherited from the existing warp and explicitly accepted for
  v1; the ARAP path is real and additive, and this design is structured not to block it.
- Guard consistency (disabled on transformed layer/cell) reuses the exact rule already enforced for
  selection, so behavior is predictable.
