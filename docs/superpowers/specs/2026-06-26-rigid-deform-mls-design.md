# Rigid Deform Mode (MLS) — Design

**Status:** Approved (design phase)
**Date:** 2026-06-26

## Goal

Add a **Rigid** deform mode to the Deform tool (alongside the existing **FFD** mode): pin a few grid
handles and drag one, and the rest of the mesh follows as-rigidly-as-possible — natural limb/pose
editing. Implemented with **Moving Least Squares (MLS) rigid deformation** (Schaefer et al. 2006), not
Igarashi ARAP.

## Why MLS, not ARAP (decision from brainstorming)

On the **regular grid** the Deform tool uses (the only mesh in scope), MLS-rigid and ARAP are the same
quality class — both deform by spatial proximity; neither follows the drawing's silhouette (that
requires a triangulation, which is a *future* phase where true ARAP wins). MLS-rigid reaches the same
"pin handles, drag one" posing UX with a **closed-form per-vertex transform** — no linear solver, no
sparse matrix, no prefactorization, trivially real-time on iPad — i.e. far less code and bug surface.
True Igarashi ARAP stays the documented upgrade for the later silhouette-triangulation phase.

## Architecture — what changes vs. reuses

**Unchanged:** the Deform tool, lift, grid topology, `drawWarpedMesh` renderer, density (−/+),
destructive bake/undo, and **all of FFD**. As today, the deform warps the raster through whatever
`warpGrid` positions it's handed.

**The single behavioral change:** in `selection.ts`, the grid-handle `updateDrag` branches on a new
`deformMode`:
- `"ffd"` (current): move only the dragged grid point.
- `"rigid"`: build handle correspondences (pinned points + the dragged point) and call the MLS solver
  to recompute **all** grid positions.

**New isolated pure module** `src/core/mls.ts` holds the solver (`deform.ts` keeps the FFD helpers).

## The solver (`src/core/mls.ts`, pure + unit-tested)

```ts
export interface Pt { x: number; y: number; }

/** Moving-Least-Squares RIGID deformation. Deforms each point in `points` given handle
 *  correspondences from[i] → to[i]. Closed-form per point; no solver. */
export function mlsRigid(points: Pt[], from: Pt[], to: Pt[], alpha = 1): Pt[];
```
Per point `v` (a rest grid vertex), with handles `pᵢ = from[i]`, `qᵢ = to[i]`:
1. **Weights** `wᵢ = 1 / |pᵢ − v|^(2·alpha)`. If `v` coincides with some `pⱼ` (distance ≈ 0) → result is
   `qⱼ` (exact). (Grid handles ARE grid vertices, so each handle lands exactly on its target.)
2. **Weighted centroids** `p★ = Σwᵢpᵢ / Σwᵢ`, `q★ = Σwᵢqᵢ / Σwᵢ`; centered `p̂ᵢ = pᵢ−p★`, `q̂ᵢ = qᵢ−q★`.
3. **Best-fit rotation** (weighted Procrustes, the closed 2-D form):
   `a = Σ wᵢ (p̂ᵢ·q̂ᵢ)`, `b = Σ wᵢ (p̂ᵢ × q̂ᵢ)` where `p̂×q̂ = p̂.x·q̂.y − p̂.y·q̂.x`; `θ = atan2(b, a)`
   (if `a == 0 && b == 0` → identity rotation).
4. **Result** `v' = R(θ)·(v − p★) + q★`.

Properties this gives for free (assert in tests):
- **0 pins + 1 dragged handle** → `p̂ = 0` → rotation identity → pure **translation** of the whole shape.
- **handles at their rest positions** (no displacement) → identity (grid unchanged).
- **2 handles rotated** → the shape rotates/translates rigidly to follow (no shear/scale).
- A handle vertex maps exactly to its target (coincidence rule), so pinned/dragged points stay put.

No edge case needs `alpha ≠ 1`; use `alpha = 1` (`wᵢ = 1/d²`).

## Interaction (`selection.ts`)

State added to `Selection`:
- `deformMode: "ffd" | "rigid"` (default `"ffd"`).
- `warpRest: Pt[][]` — the uniform rest grid, captured in `beginWarp`/`densifyWarp` via
  `sampleGrid(this.rect, identity(), rows, cols)` (same mapping `drawWarpedMesh` sources from).
- `pinned: Map<number, Pt>` — flat grid index (`row*cols + col`) → its pinned CSS position.

`updateDrag` `"grid"` branch, `deformMode === "rigid"`:
- `idx = flat(dragGridIdx)`; `target = warpGridStart[idx] + (dx, dy)` (dragged handle's current pos).
- `from/to`: for each `pinned (i → pos)` with `i ≠ idx`, push `(warpRest_flat[i], pos)`; then push
  `(warpRest_flat[idx], target)`.
- `warpGrid = unflatten( mlsRigid(warpRest_flat, from, to) )`.

On **drag end** (rigid): `pinned.set(idx, warpGrid[idx])` — the just-dragged point becomes pinned.
**Reset pins:** `pinned.clear()` (and redraw). **densify** in rigid resets `pinned` (indices change) and
recaptures `warpRest`. FFD mode ignores `warpRest`/`pinned` entirely. Toggling FFD↔Rigid keeps the
current `warpGrid` (pose preserved); entering Rigid starts with `pinned` empty (per brainstorming).

New public methods for the UI/Canvas: `setDeformMode(m)`, `resetPins()`.

## Rendering (`drawOverlay`)

The warp overlay already draws each grid control point. For `deformMode === "rigid"`, render points
whose flat index is in `pinned` as **filled** markers (vs the existing hollow handle) so anchors are
visible. No change in FFD mode.

## UI (`SelectionActions.svelte` + `Canvas.svelte`)

In the warp panel (warping state), next to the −/+ density controls:
- **FFD / Rigid** segmented toggle → `onSetDeformMode("ffd" | "rigid")` → `selection.setDeformMode(...)`.
- **Reset pins** button, shown only in Rigid mode → `onResetPins()` → `selection.resetPins()`.
Canvas wires both, mirroring the existing `onDensify` wiring. `deformMode` is read from the selection
(synced into the panel's `$state` each tick, like `warp`).

## Scope / persistence

No new persistence — the bake is the same destructive cell-pixel write (one undo step). `deformMode` is
a transient UI setting (defaults to FFD each entry; a future global-pref is out of scope). Density works
in both modes.

## Testing

**Automated (node, pure):** `mls.ts` unit tests — translation (1 handle), identity (handles at rest),
rigid rotation (2 handles rotated → output rotated, edge lengths preserved within tolerance), exact
handle placement (a vertex equal to a handle's rest maps to its target). These pin the math.

The `selection.ts` integration (mode branch, pin set, `warpRest`), overlay, and panel are DOM/stateful
→ build + manual. Existing baseline stays green; build 0/0; lint clean.

**Manual (browser):**
- Deform a layer, switch the panel to **Rigid**. Drag a point → the whole shape moves rigidly (no
  pins yet). Release → that point shows **filled** (pinned). Drag another → the shape bends
  as-rigidly-as-possible between the pins (limb-posing feel). **Reset pins** clears anchors.
- **FFD** mode is unchanged (drag = move one point). Toggling FFD↔Rigid preserves the current pose.
- −/+ density still works (resets pins in Rigid); Apply bakes; Cancel/Esc restores. On iPad the drag
  stays smooth (closed-form, no solver).

## Out of scope

- Silhouette/Delaunay triangulation + **true Igarashi ARAP** (the future phase MLS defers the
  silhouette advantage to).
- Per-handle unpin (only **Reset pins** — confirmed); weighting/stiffness controls; non-rigid
  similarity MLS; non-destructive deform storage; animated deform; persisting `deformMode`.

## Self-review notes

- The change is surgically small: one new pure module (`mls.ts`), one `deformMode` branch in
  `updateDrag`, a pin set + rest-grid snapshot, an overlay tweak, and two panel controls. FFD and the
  whole warp/lift/bake pipeline are untouched.
- The only real logic (`mlsRigid`) is pure and unit-tested with property-style assertions, so the
  math is pinned independent of the DOM wiring.
- MLS keeps true ARAP a clean future addition (it becomes another `deformMode`/solver on a
  silhouette mesh), so this doesn't foreclose the original roadmap.
