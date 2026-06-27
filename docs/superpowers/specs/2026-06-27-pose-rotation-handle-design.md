# Pose Tool — Per-Handle Rotation ("twist") — Design

**Status:** Approved (design phase)
**Date:** 2026-06-27

## Context

The Pose tool deforms via geodesic-weighted MLS: each handle is a pinned mesh vertex with a target
position, and dragging it translates that target while the mesh least-squares-follows. Bending a limb by
**dragging** an end point (e.g. moving the hand to bend the elbow) shears the limb — the dominant motion
is translation, so the forearm stretches instead of swinging.

This adds a **rotation ("twist") to each handle**: instead of only dragging a handle, you can **rotate**
it, and the geodesically-attached region swings around it. Rotating the elbow handle swings the
forearm/hand; the dominant motion becomes rotational, not stretching → far less distortion for limb
posing. This is **quick, per-frame posing** — explicitly **not** a skeleton, bones, IK, joint hierarchy,
or anything reusable. It's one extra degree of freedom on the handles the tool already has.

## Approach (decided)

**Inject the rotation into the existing geodesic-MLS via a "satellite" point — no kernel rewrite, no new
deformation model.** `mlsRigidWeighted` / `poseWeights` are reused unchanged.

A handle gains an `angle` (radians, default 0). When solving, a handle with `angle ≠ 0` contributes **two**
point-correspondences instead of one:
- **Pivot:** `rest[vertex] → to` (the handle's position, as today).
- **Satellite:** `rest[vertex] + e → to + R(angle)·e`, where `e` is a fixed rest-space offset and
  `R(angle)` is a 2D rotation.

Two nearby correspondences with a relative rotation are exactly what MLS-rigid needs to reproduce a local
rotation about `to`. **The recovered rotation is independent of `|e|`** — in `rigidFit`, `cos = a/r`,
`sin = b/r` normalize away the offset magnitude, so any reasonable `e` (e.g. on the order of the mesh
spacing) yields the same angle; only numerical conditioning cares. The satellite borrows the **pivot's
geodesic weight column** (it sits at the same vertex geodesically), so **no new geodesic computation** is
needed — `poseWeights` is unchanged, and rotating only updates the satellite's `to`, making a rotation
drag as cheap as the existing `dragHandle`.

**Why this is the right level of simple:** it reuses `mlsRigidWeighted`, the cached `poseWeights`, and the
`rotate()` gizmo math already in `ref-transform.ts`. The only genuinely new code is the satellite
construction in the solve, a per-handle `angle`, and a rotation-ring interaction.

## Components

### Model — `src/core/mesh-pose.ts`
- `PoseHandle` gains `angle: number` (radians; default 0). `addHandleAt` sets `angle: 0`.
- A new `rotateHandle(i: number, angle: number)` sets `handles[i].angle` and re-solves (cheap; weights
  unchanged).
- The solve (`solve()`) builds `from[]`/`to[]`/`weights[][]` by walking handles: always push the pivot
  column; for any handle with `angle !== 0`, also push a satellite column whose `from = rest[vertex] + e`,
  `to = to + rotate(e, {0,0}, angle)`, and whose weight column is a copy of that handle's column. `e` is a
  fixed offset (default: `(SAT_OFFSET, 0)` with `SAT_OFFSET` ≈ the mesh `spacing`, a module constant).
  Because the satellite augments the matrices the same way every solve, `dragHandle`/`rotateHandle` both
  just rebuild `to` and call `mlsRigidWeighted`.
- `from`/`weights` caching still keys on the **handle vertex set** only (geodesic) — adding/removing a
  handle recomputes (as today); rotating/dragging does not.

### Interaction — `src/lib/Canvas.svelte` (pose branch) + overlay
- **Active handle:** the last added/touched handle (track an `activeHandle: number | null` beside
  `poseDrag`) shows a **rotation ring** — a circle at a fixed *screen* radius around the handle, drawn in
  `drawWireframe`/the overlay (reuse the `rotate()` math and the rotate-nub styling pattern from
  `ref-transform.ts`/`RefTransformGizmo`).
- **Hit priority on press** (mirrors the transform gizmo: rotate first, then body):
  1. If the press hits the active handle's **rotation ring** → start a **rotate** drag: track the start
     angle from the handle center; on move, `rotateHandle(active, startAngle + Δ)`.
  2. Else if it hits a **handle body** (`handleAt`) → select it (set active) and **translate** it
     (existing `dragHandle`).
  3. Else → `addHandleAt` (existing), which becomes the active handle.
- Tap on empty space away from any handle/ring still adds a handle. No new tool, no mode toggle.

### Overlay
`drawWireframe` additionally draws the active handle's rotation ring (and a small angle readout/grip dot
on the ring is optional polish). Existing handle dots + mesh edges unchanged.

## Testing

The satellite construction is **pure and deterministic** (the angle is offset-independent), so the core is
unit-testable in node:
- **Rotation reproduces near the pivot:** a small mesh, one handle at vertex `k` with `angle = π/2` and one
  anchor handle elsewhere; assert a vertex geodesically close to `k` is rotated ≈90° about `to_k` (within
  tolerance), and the anchor vertex stays put.
- **Zero angle == today:** a handle with `angle = 0` produces the same `deformed` as the current
  single-column solve (regression: rotation path doesn't change translate-only behavior).
- **Offset independence:** the same `angle` with two different `SAT_OFFSET` values yields the same deformed
  result within tolerance (validates the `|e|`-cancels claim).

The ring gizmo, hit-testing, and overlay are DOM → **build + manual**.

**Manual (browser):** pin an anchor on the upper arm, select the elbow handle, drag its ring → the
forearm/hand swing around the elbow with far less distortion than dragging the hand. Translating a handle
still works; baking/Apply/Cancel/leave-commit unchanged.

## Risks / honest caveats

- It's still a **soft** deformer: the rotation falls off with geodesic distance, so a limb **curves**
  toward the far end rather than swinging perfectly rigidly, and bone length isn't a hard constraint. It
  *reduces* distortion for posing; it does not make a rigid bone. Body-side **anchors** are needed so the
  rotation bends against something.
- The satellite borrows the pivot's geodesic weights (an approximation of falloff, not the angle). If the
  curving looks wrong in practice, the documented **fallback** is a small explicit rotation term in
  `rigidFit` (blend each vertex toward the handle's frame by weight) — a localized kernel change, not a
  redesign. **Validation gate:** confirm the satellite approach looks good on a real outline drawing
  before finalizing; if not, switch to the fallback.

## Out of scope
- Skeletons, bones, joint hierarchy, IK/FK, bone-length preservation, reusable rigs.
- Animated/keyframed handles; multi-frame propagation; per-handle stiffness/weight controls.
- Rotation for the grid Rigid/FFD Deform tool (this is Pose-tool only).

## Self-review notes
- Reuses `mlsRigidWeighted` + cached `poseWeights` + `ref-transform`'s `rotate()` — the new surface is a
  per-handle `angle`, the satellite columns in `solve()`, `rotateHandle`, and a ring gizmo.
- The math is sound where it counts (angle is offset-independent and unit-testable); the only
  approximation is falloff weight, with a clear fallback and a validation gate.
- Stays within the established "per-frame, destructive, no rigging" scope of the Pose/Deform tools.
