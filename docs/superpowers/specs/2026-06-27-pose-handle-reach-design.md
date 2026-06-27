# Pose Tool — Per-Handle Geodesic "Reach" (Influence Radius) — Design

**Status:** Approved (design phase)
**Date:** 2026-06-27

## Context

Pose handles deform via geodesic-weighted MLS with a **fixed, global** falloff (`poseWeights` uses
`1/g^(2α)`, α=1). Every handle reaches as far as the math carries it; you can't say "this handle should
only affect the fingertip" vs "the whole forearm." This adds a **per-handle influence radius ("reach")**:
how far along the mesh a handle's effect — both its move and its rotation — propagates.

Decisions (from brainstorming):
- **Geodesic** reach (distance *along the mesh*, like the existing weighting) — silhouette-aware, so a
  handle on the hand won't grab a spatially-near but mesh-far leg. Visualized by **highlighting the
  affected mesh region**, not a misleading circle.
- Set via a **second "reach" nub** on the active handle (its distance from the handle = the reach); the
  affected region highlights while dragging.
- Reach shapes the handle's **whole influence** (translate + rotate), not rotation only.
- **Default = unlimited** (`reach` undefined) so existing poses are unchanged; the nub snaps back to
  unlimited past the mesh's full extent.

## Architecture

### Math — `src/core/geodesic.ts` (`poseWeights`)
Add an optional per-handle reach; apply a smooth, compactly-supported window so a handle's weight reaches
zero at its `reach` distance:
```ts
export function poseWeights(
  mesh: Mesh,
  handleVertices: number[],
  alpha = 1,
  reaches?: (number | undefined)[], // doc-px geodesic radius per handle; undefined = unlimited
): { from: Pt[]; weights: number[][] } {
  const dist = geodesicDistances(mesh, handleVertices);
  const from = handleVertices.map((v) => mesh.vertices[v]);
  const weights = mesh.vertices.map((_, v) =>
    handleVertices.map((_, h) => {
      const g = dist[h][v];
      if (g === 0) return Infinity;       // handle's own vertex → exact (unchanged)
      if (g === Infinity) return 0;       // unreachable component → no influence
      let w = 1 / Math.pow(g, 2 * alpha);
      const R = reaches?.[h];
      if (R != null && R > 0) {
        if (g >= R) return 0;             // outside the reach
        const t = g / R;                  // smooth window: 1 at g=0, 0 at g=R
        const win = 1 - t * t;
        w *= win * win;
      }
      return w;
    }),
  );
  return { from, weights };
}
```
- Backward compatible: `reaches` omitted ⇒ identical to today (existing callers `deformMeshGeodesic`,
  and existing tests, are unaffected).
- A vertex outside **every** handle's reach gets an all-zero weight row ⇒ `mlsRigidWeighted` leaves it at
  rest (existing behavior) — i.e. "outside the effect area, unaffected."

### State — `src/core/mesh-pose.ts`
- `PoseHandle` gains `reach?: number` (doc-px geodesic; undefined = unlimited). `addHandleAt` leaves it
  unset (unlimited).
- `recompute()` passes the per-handle reaches: `poseWeights(this.restMesh(), verts, 1, this.handles.map((h) => h.reach))`.
- New `setReach(i: number, reach: number | undefined)` — sets `handles[i].reach`, then `recompute()`
  (re-derives weights and re-solves). Reach changes are infrequent and meshes are small (tens–low-hundreds
  of verts), so recomputing geodesic distances here is acceptable; a dist-cache split is a future
  optimization if needed.
- New `reachMask(i: number): boolean[]` — per vertex, `weights[v][i] > 0` (the active handle's affected
  set), for the overlay highlight. (Exposes the private weights through a method.)

### Interaction & overlay — `src/lib/Canvas.svelte`
- The **active handle** (already tracked) shows a second **reach nub**, distinct from the rotate nub: a
  small diamond at a **fixed screen direction** from the handle (so it never collides with the angle-driven
  rotate nub), at a doc-space distance equal to the handle's reach. If `reach` is undefined, the nub sits
  at the mesh's full extent (the "unlimited" position).
- **Press hit priority:** rotate nub → reach nub → handle body → add (extends the existing nub→body→add
  chain). Hitting the reach nub starts a **reach drag**.
- **Reach drag:** `reach = hypot(pointer − handleCenter)` (doc px). If that exceeds the mesh's extent
  (`reachMax`), set `reach = undefined` (snap to unlimited). Call `meshPose.setReach(active, reach)`.
- **Highlight:** while the active handle has a finite reach (and especially during a reach drag), tint the
  triangles whose vertices are in `reachMask(active)` in `posePaint` — the honest geodesic extent.
- New Canvas state `poseReaching: boolean`, reset alongside `poseDrag`/`poseRotating`/`activeHandle` at
  the four teardown sites (`applyPose`/`cancelPose`/reset/`poseDensity`).

## Testing

**Pure (node, vitest):**
- `poseWeights` reach window: with `reaches = [R, undefined]` on a small mesh, a vertex with geodesic
  `g ≥ R` from handle 0 gets weight 0; a vertex with `0 < g < R` gets a **positive weight strictly less
  than** the unwindowed `1/g²`; the handle's own vertex stays `Infinity`; the `undefined` handle's column
  equals today's values.
- `reach=undefined` regression: `poseWeights(mesh, verts, 1)` and `poseWeights(mesh, verts, 1, [undefined,
  undefined])` are identical.
- Localized solve: `solvePoseDeform` with weights from a tightly-reached handle (small `R`) + one anchor
  leaves a far vertex (geodesic `> R` from both) at its rest position.

**DOM/manual (browser):** the reach nub drags in/out; the affected region highlights and matches what
moves; a tight reach bends only the local part (e.g. just the hand) while the rest holds; dragging past the
mesh extent returns to unlimited; rotate + translate still work; Apply/Cancel unchanged.

Build **0/0**, lint clean; baseline tests must not drop (plus the new pure tests).

## Risks / caveats
- A very tight reach on a **lone** handle leaves the rest of the mesh at rest, so the boundary can show a
  **seam** (inherent to compact influence). The smooth window softens it; in practice you pair a reached
  handle with anchors. Acceptable for quick posing; documented, not hidden.
- Reach is a geodesic threshold in doc px while the nub is dragged in Euclidean doc space — the nub is a
  magnitude control, and the highlight (not the nub) shows the true extent, so there's no misleading circle.

## Out of scope
- Per-handle falloff *hardness* (the `α` exponent) — a separate future knob.
- Region/radius **anchors**; Euclidean reach; persistence of reach (pose is per-frame/destructive).
- Reach for the grid Rigid/FFD Deform tool (Pose-tool only).

## Self-review notes
- One small, optional addition to `poseWeights` (backward compatible) carries the whole math; the rest is a
  per-handle field, a `setReach`, a `reachMask` accessor, and a second nub + highlight — all reusing the
  active-handle/nub infrastructure from the rotation feature.
- Default-unlimited keeps every existing pose identical; the feature is purely additive.
- Geodesic + affected-region highlight stays faithful to the tool's silhouette-aware design rather than
  bolting on a spatial circle.
