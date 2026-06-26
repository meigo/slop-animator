# Silhouette Triangulation (ARAP tool — part 1/3) — Design

**Status:** Approved (design phase)
**Date:** 2026-06-26

## Context

First of three sub-projects for a **separate mesh-deform "Pose" tool** that deforms a cell's drawing on
a silhouette-conforming triangle mesh (the deferred quality phase beyond the grid Deform tool). The
three parts, each its own spec→plan→build:

1. **This spec — silhouette → triangle mesh** (pure, foundational).
2. Geodesic-weighted MLS deformation (mesh + handles → posed vertices; reuses `mlsRigid`, weights by
   geodesic distance along mesh edges — silhouette-aware, **no linear solver**; chosen over true
   Igarashi ARAP to avoid the sparse-solver risk while keeping the silhouette advantage).
3. The Pose tool (lift, handle UX, mesh render via the existing `drawTriangle`, bake).

This sub-project produces **only** the pure triangulation + a throwaway dev visualization. No tool, no
deformation, no app wiring yet.

## Deliverable

A pure module `src/core/triangulate.ts`:
```ts
export interface Pt { x: number; y: number; }
export interface Mesh { vertices: Pt[]; triangles: [number, number, number][]; }

/** Triangulate the silhouette of a binary alpha mask. `inside(x,y)` is the per-pixel test (pixel
 *  space, 0..w-1 / 0..h-1). Returns a mesh in that pixel space. */
export function triangulateSilhouette(
  inside: (x: number, y: number) => boolean,
  width: number,
  height: number,
  opts?: { spacing?: number; simplifyTol?: number },
): Mesh;
```
Output is in **mask pixel space**; the Pose tool (part 3) maps it to logical/rect coords. `spacing`
(interior point spacing, default e.g. 16px) sets mesh density; `simplifyTol` (default ~2.5px) sets
boundary smoothness.

## Pipeline

1. **Contour** — marching squares over `inside` → closed boundary loop(s), one per connected
   component (a helper `marchingSquaresContours(inside, w, h): Pt[][]`). Each loop is an ordered ring
   of points along the silhouette edge.
2. **Simplify** — Douglas–Peucker (`simplifyPath(pts, tol)`) per loop → boundary vertices on the true
   outline, not a per-pixel wall.
3. **Interior samples** — a grid at `spacing`, keep points where `inside` is true and which aren't
   within ~`spacing/2` of a boundary vertex (avoid degenerate slivers).
4. **Delaunay** — `delaunator` (new dep) over (boundary ∪ interior) points:
   `Delaunator.from(points, p => p.x, p => p.y).triangles` (flat `Uint32Array`, consecutive triples).
5. **Centroid filter** — drop any triangle whose centroid fails `inside` → the convex-hull Delaunay
   becomes silhouette-conforming (handles concavities and holes without constrained Delaunay).
6. **Reindex** — drop vertices referenced by no surviving triangle; compact to a clean
   `{ vertices, triangles }`.

Degenerate guards: empty/near-empty mask → `{ vertices: [], triangles: [] }`; a mask too small to
sample → empty (callers treat empty mesh as "can't pose"). Multiple components are fine (each meshes;
disjoint triangles).

## New dependency

`delaunator` (single-file, MIT, ~tiny, battle-tested) — robust Delaunay; hand-rolling it invites
numerical edge cases. Add to `dependencies`.

## Dev visualization (throwaway)

A standalone Vite page (Vite serves any root `*.html`), **not** linked into the app and removed/kept as
a dev tool later:
- `triangulate-viz.html` + `src/triangulate-viz.ts`.
- Draws a few built-in test shapes (filled rect, L-shape, disc, a sample doodle) onto a canvas, builds
  `inside` from its alpha, runs `triangulateSilhouette`, and overlays the mesh (triangle edges +
  vertices, boundary highlighted) on the shape.
- Sliders for `spacing` and `simplifyTol` to tune density/smoothness live.
This is how we **see and tune** the mesh before parts 2–3 depend on it.

## Testing

**Automated (node, pure)** — synthetic masks via an `inside` predicate:
- Filled rectangle → non-empty mesh; every triangle centroid inside; boundary vertices lie on the
  rect's edges (within tolerance); triangles roughly cover the area.
- **L-shape** → no triangle centroid lands in the notch (concavity conformance).
- Disc → boundary vertices approximately on the circle; reasonable triangle count for the `spacing`.
- Empty mask → `{ vertices: [], triangles: [] }`.
- `marchingSquaresContours` on a rectangle → one closed loop tracing its perimeter; `simplifyPath` on a
  straight run of collinear points → just the endpoints.
- Reindex: triangles reference only existing vertices; no unused vertices remain.

**Visual:** the dev viz (above) — the real quality check; tune defaults there.

## Out of scope (this sub-project)

- Constrained Delaunay / exact boundary-edge preservation; explicit hole topology (holes are just
  filtered out); dynamic re-meshing during a drag.
- Geodesic distances / deformation / solver (part 2); coordinate mapping, handle UX, render, bake,
  tool wiring (part 3); any app-facing UI.

## Self-review notes

- Pure module + a throwaway viz only — zero app surface, so risk is contained to getting the geometry
  right, which the viz + unit tests cover directly.
- `delaunator` + centroid-filter is the well-trodden robust path to a concave-conforming mesh without
  the fragility of constrained-Delaunay libs.
- The output (`{vertices, triangles}` in pixel space) is the clean interface parts 2 (geodesic graph +
  deform) and 3 (render/bake) consume; nothing here assumes how it's used.
