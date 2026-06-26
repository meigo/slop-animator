# Geodesic-Weighted MLS (ARAP/Pose tool — part 2/3) — Design

**Status:** Approved (design phase)
**Date:** 2026-06-26

## Context

Second of three sub-projects for the silhouette-mesh **Pose** tool. Part 1 (shipped) produces a
silhouette-conforming triangle `Mesh` (`src/core/triangulate.ts`). This part is the **deformation
math**: given the mesh and a few pinned/dragged handles, compute new vertex positions that follow the
*shape* — a handle on one limb shouldn't drag a spatially-nearby-but-disconnected limb. We achieve that
by reusing our closed-form MLS-rigid kernel but weighting handles by **geodesic distance along the mesh
edges** instead of Euclidean distance — silhouette-aware posing with **no linear solver** (chosen over
true Igarashi ARAP to avoid the sparse-solver risk; see part-1 spec's lineage note).

Part 3 (the tool) is out of scope here: this sub-project is **pure functions + unit tests only**.

## Components (all pure, in `src/core/`)

### 1. `geodesic.ts` — distances along the mesh
```ts
import type { Mesh } from "./triangulate";
/** Geodesic distance from each source vertex to every vertex, via Dijkstra over the mesh's edge
 *  graph (edge weight = Euclidean length). dist[s][v]; Infinity if unreachable. */
export function geodesicDistances(mesh: Mesh, sources: number[]): number[][];
```
Build undirected adjacency from `mesh.triangles` (each triangle → 3 edges, deduped); edge weight =
Euclidean distance between its endpoints. Run Dijkstra from each source. Mesh sizes are small
(tens–low-hundreds of vertices) so a simple binary-heap (or O(V²)) Dijkstra is ample.

### 2. `mls.ts` refactor — a weighted rigid kernel
Extract the per-point rigid fit (weighted centroids → best-fit rotation → `v' = R(v−p★)+q★`) into a
shared helper, then expose:
```ts
/** Rigid MLS with PRECOMPUTED weights. weights[i][h] = weight of handle h for point i.
 *  weights[i][h] === Infinity ⇒ point i maps exactly to to[h] (coincidence). All-zero row ⇒ point
 *  unchanged (no influence). */
export function mlsRigidWeighted(points: Pt[], from: Pt[], to: Pt[], weights: number[][]): Pt[];
```
`mlsRigid` (the grid Deform path) **stays behavior-identical** — it now just computes Euclidean weights
and calls the same shared kernel. Its existing 5 tests are the regression guard.

### 3. `deformMeshGeodesic` (in `geodesic.ts` or a small `mesh-deform.ts`)
```ts
export interface MeshHandle { vertex: number; to: { x: number; y: number }; }
/** Deform a mesh's vertices from handles, weighting by geodesic distance. Pure. */
export function deformMeshGeodesic(mesh: Mesh, handles: MeshHandle[], alpha?: number): Pt[];
```
- `handles[].vertex` is a **mesh-vertex index** (handles snap to vertices — confirmed; makes geodesic
  a plain vertex-source Dijkstra and lets a handle land exactly on its target).
- Compute `dist = geodesicDistances(mesh, handles.map(h => h.vertex))`.
- Weight per (vertex v, handle h): `g = dist[h][v]` → `g===0 ? Infinity : g===Infinity ? 0 : 1/g^(2α)`
  (α default 1).
- `mlsRigidWeighted(mesh.vertices, from=handle rest verts, to=handle targets, weights)`.

**Falls out for free:** a handle vertex (g=0) → Infinity weight → exact target; a vertex with no finite
geodesic to *any* handle (disconnected component, no handle) → all-zero weights → **stays at rest**
(confirmed fallback). No special-casing needed.

## Prefactor structure (for part 3)

Geodesic distances depend only on the **mesh + which vertices are handles**, not on the handle
*targets*. Keeping `geodesicDistances` and `mlsRigidWeighted` separate lets part 3 compute the
distance matrix **once per handle-set change** and re-run only the cheap closed-form kernel per drag
frame. `deformMeshGeodesic` is the all-in-one convenience (recomputes distances each call) — fine for
tests; part 3 may inline the two steps for the per-frame fast path.

## Testing (pure, node)

- **`geodesicDistances`**: a hand-built path/strip mesh → distances equal the summed edge lengths
  along the path; unreachable vertex (disjoint component) → `Infinity`; distance to self → 0.
- **The validating test (geodesic > Euclidean):** a hand-built **U/two-prong mesh** whose two prong
  *tips* are Euclidean-close but mesh-far (connected only around the far end). A handle dragging tip A
  moves tip A to its target but leaves tip B **nearly at rest** (assert tip B's displacement ≪ tip A's)
  — the whole reason for geodesic weighting; plain Euclidean MLS would drag both.
- **`mlsRigidWeighted`**: Infinity-weight row → exact target; all-zero row → unchanged; a uniform-weight
  case matches a hand-computed rigid fit.
- **`deformMeshGeodesic`**: handle vertex lands exactly on its target; a single handle → rigid
  translation of the connected component; an unhandled disjoint component stays put.
- **Regression:** the existing 5 `mlsRigid` tests still pass after the refactor (behavior identical).

All DOM/tool/render/bake is out of scope, so everything here is node-testable; build 0/0; lint clean.

## Out of scope

- The Pose tool itself: lift, handle placement/snap UX, mesh overlay render, per-triangle bake (part 3).
- Arbitrary (non-vertex) handles; true Igarashi ARAP; weighting/stiffness controls; caching policy
  (part 3 decides when to recompute distances).

## Self-review notes

- One shared rigid kernel serves both the Euclidean grid path and the geodesic mesh path — no duplicated
  math, and `mlsRigid`'s tests pin the kernel against regression.
- The two confirmed behaviors (handle→exact target, disconnected→rest) emerge from the Infinity/zero
  weight handling rather than special cases — fewer branches, fewer bugs.
- Pure + unit-tested, including the geodesic-beats-Euclidean validating test, so part 3 builds on a
  proven deformation core.
