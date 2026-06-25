# 2D Mesh-Deform Tool — Notes (idea stage)

**Status:** Idea — no spec, no plan. Captured for future brainstorming.
**Date:** 2026-06-25

## What

A per-frame "Deform" tool for quick pose editing of characters and other objects. Drag handles on
the cell's drawing to bend/stretch arms, twist a torso, reshape an organic blob — without redrawing.

Reference: Kun Zhou et al., "2D Shape Deformation Using Nonlinear Least Squares Optimization"
(`kunzhou.net`); Igarashi et al. 2005, "As-Rigid-As-Possible Shape Manipulation."

## Scope

**Per-frame only. No animation.** Same scope philosophy as the per-cell transform shipped
2026-06-22 (see `2026-06-22-per-cell-transform-design.md`). The deform lives on one cell, bakes
into that cell's pixels on Apply, and does not propagate across frames.

The animation-free scope is deliberate: animated mesh deformation requires either handle
correspondence (rigging) or interpolating mesh states across keyframes, both of which add a lot
of structural weight to an app that's bitmap-first.

## Why this approach

Selection + warp (existing W key, `src/lib/SelectionActions.svelte` + `src/core/selection.ts`) is
rectangular and coarse. Mesh deformation gives smooth, organic shape changes that match what an
animator wants for posing a limb or reshaping a silhouette in a single frame.

## Implementation read (from the 2026-06-24 conversation)

**The math is the easy part.** A sparse Laplacian solve is ~50 lines with the right library. The
hard part is the *pipeline*:

1. Triangulate the cell's content region (we already have `contentBounds` and the device-px
   raster).
2. Place + drag handles (new UI tool, scope-aware like Transform).
3. Texture-mapped warp: render the original raster through the deformed mesh. WebGL is the natural
   fit — already used for the line-boil path (`src/core/boil-gl.ts`).
4. Bake to a new cell (mirrors `applyCellTransform` from Phase A).

## Recommendation (when this becomes a real spec)

**Prototype Free-Form Deformation (FFD) first.** A 6×6 control lattice over the content bbox,
drag lattice points, bicubic warp the underlying raster. ~5× less code than mesh deform, no
linear solver. Validates the pipeline (triangulation, handle UI, WebGL warp, bake to cell). Looks
less natural for limbs than mesh deform but proves the four pieces.

**Then upgrade to ARAP** (As-Rigid-As-Possible — Igarashi 2005 is the canonical reference)
rather than pure Laplacian. ARAP gives similar quality for character poses, is more
rotation-invariant, and has a simpler single-pass formulation. The pipeline stays the same; only
the solver block changes.

## Related shipped work

- `2026-06-22-per-cell-transform-design.md` — per-frame scope precedent and the frozen-bbox-on-grab
  pattern any deform tool should mirror.
- `2026-06-23-group-transform-design.md` — `group ∘ layer ∘ cell` compose model and Apply/Reset
  semantics; a deform tool would slot in as another per-cell operation alongside the cell
  transform.
- `src/lib/SelectionActions.svelte` + `src/core/selection.ts` — the existing selection+warp
  affordance that a mesh-deform tool would coexist with (and eventually supersede for organic
  edits).

## Open questions for the future brainstorming pass

- Auto-triangulate, or expose mesh density as a setting?
- Handle placement: user-clicks, or auto-seed at content extremes / skeleton midline?
- Coexist with cell transform (compose) or replace it for that cell?
- Undo granularity: per-handle-drag, or only Apply/Reset?
- Performance budget: WebGL warp + sparse solve at 60 Hz during drag, on iPad Safari?
