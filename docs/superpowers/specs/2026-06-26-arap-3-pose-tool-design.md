# Pose Tool (ARAP/Pose tool — part 3/3) — Design

**Status:** Approved (design phase)
**Date:** 2026-06-26

## Context

Final sub-project of the silhouette-mesh deform feature. Parts 1–2 (shipped, pure + tested) provide
`triangulateSilhouette` (alpha → mesh) and the deformation core (`geodesicDistances`,
`mlsRigidWeighted`, `deformMeshGeodesic`). **This part is the tool** — the DOM/interaction glue that
lets you lift a drawing, pin handles, pose it, and bake. Per-frame and destructive, like the grid
Deform tool, reusing its lift/bake/undo pipeline (`liftPixels` + `selCtx`/`selBefore` + history).

## Architecture

### `src/core/mesh-pose.ts` (new) — the pose state
A `MeshPose` holds the lifted raster + its silhouette mesh and applies geodesic-MLS as you drag pinned
handles. Coordinate space is **doc/logical** throughout (so it composes with `drawTriangle`, whose
src/dst are doc coords and whose `img` is blitted at `rect`).
```ts
import type { Pt } from "./mls";
export interface PoseHandle { vertex: number; to: Pt; }

export class MeshPose {
  rest: Pt[];        // rest vertex positions, DOC coords
  deformed: Pt[];    // current deformed positions, DOC coords
  triangles: [number, number, number][];
  handles: PoseHandle[] = [];
  readonly img: HTMLCanvasElement;  // the lifted floating canvas (device px of `rect`)
  readonly rect: { x: number; y: number; w: number; h: number }; // DOC coords
  // cached per handle-set (recomputed on add/reset, NOT per drag frame):
  private weights: number[][] = []; // [vertex][handle]
  private from: Pt[] = [];          // handle rest verts

  /** Lift → triangulate the floating alpha → map vertices to doc coords. null if < 1 triangle. */
  static fromLift(img, rect, dpr, spacing): MeshPose | null;

  addHandleAt(docPt: Pt): void;     // snap to nearest vertex, pin at its deformed pos, recompute geodist+weights
  handleAt(docPt: Pt, tolDoc: number): number | null; // hit-test an existing handle dot
  dragHandle(i: number, docPt: Pt): void;  // set handles[i].to, re-run mlsRigidWeighted (cached weights) → deformed
  resetHandles(): void;
  render(ctx): void;        // drawTriangle per triangle: warp `img` rest-tri → deformed-tri (the deformed raster)
  drawWireframe(ctx): void; // deformed mesh edges (faint) + handle dots (filled)
}
```
- **Coordinate mapping (fromLift):** triangulate the floating canvas's alpha in **floating-px**
  (device); map each vertex to doc: `x = rect.x + vx/dpr`, `y = rect.y + vy/dpr`. `rest = deformed =`
  these doc coords initially.
- **Prefactor:** `geodesicDistances` + the weight matrix depend only on the mesh + which vertices are
  handles — computed in `addHandleAt`/`resetHandles`. `dragHandle` only updates a target and re-runs
  the closed-form `mlsRigidWeighted` (V×H, tiny) → real-time.
- **render** reuses the exact `drawTriangle(ctx, img, rect, srcTri, dstTri)` contract from
  `selection.ts` (export it or copy the small helper): `src` = the triangle's **rest** verts (doc),
  `dst` = its **deformed** verts (doc), `img` = the lifted canvas at `rect`.

### Tool + Canvas integration
- Add `"pose"` to `Tool`; a toolbar button (lucide e.g. `PersonStanding`/`Bone` — pick an unused icon).
  Per-frame; **disabled on a transformed layer** (extend the existing select/lasso/deform guard).
- `enterPose()` mirrors `enterDeform`: resolve the active draw cell, snapshot `selBefore`,
  `liftPixels` the content rect (clears it from the cell → display shows the hole), then
  `meshPose = MeshPose.fromLift(lifted, rect, DPR, spacing)` (null/empty content → abort, restore).
- `onStroke` (pose branch): on **press** → if `meshPose.handleAt(p)` hits an existing handle, drag it;
  else `meshPose.addHandleAt(p)` (snap to nearest vertex) and drag the new one. On **move** →
  `meshPose.dragHandle(active, p)`. Handles accumulate; first handle just translates, the rest pose
  (the part-2 reality). No marquee.
- **Live preview:** while posing, the overlay is redrawn on each change — `meshPose.render(overlayCtx)`
  (deformed raster) + `meshPose.drawWireframe(overlayCtx)`. The lifted region is a hole in the display,
  so the overlay shows the deformed drawing.
- **Apply** → render the deformed mesh into the cell (`selCtx`), capture before/after, push **one**
  undo step (the `onCommit` pattern), clear pose state. **Cancel/Esc** → restore `selBefore`, clear.
  Switching to a drawing tool banks (applies) the pose (mirror the deform `$effect`).

### Panel (`SelectionActions` or a small pose panel)
Shown while posing: **Apply**, **Cancel**, **Reset handles** (`meshPose.resetHandles()`), and **−/+
density** (rebuild the mesh at a new `spacing` via `MeshPose.fromLift` on the same lifted img — **resets
handles**, since vertex indices change). Density default = the value tuned in the part-1 dev viz.

## Performance

Per drag frame: `mlsRigidWeighted` (V×H, negligible) + `render` (one clipped `drawImage` per triangle,
~tens–low-hundreds). That triangle render is the main cost; fine for a moderate mesh on desktop and
acceptable on iPad. **Watch item:** if dense meshes stutter on iPad, fall back to wireframe-only during
the drag and render the raster on release (a localized change, not a redesign).

## Testing

Deformation is already proven (parts 1–2). New **pure-ish** surface gets unit tests:
- The pixel→doc vertex mapping and **nearest-vertex snap** (`addHandleAt` picks the closest mesh
  vertex to a doc point) — extract these as pure helpers and test them.
- `MeshPose.fromLift` returns null for an empty/near-empty lifted canvas.

The Canvas wiring, overlay render, lift/bake, panel, and tool routing are DOM → **build + manual**.
Existing baseline (262) must not drop; build 0/0; lint clean. The part-1 dev viz remains available to
sanity-check the mesh.

**Manual (browser):**
- Pick **Pose** on a drawing → press to drop an anchor handle (snaps to a mesh vertex, shown filled);
  press-drag elsewhere → that part follows while the geodesically-far parts (held by the anchor) stay —
  e.g. bend an arm without dragging the other limb. **Reset handles** clears; **−/+ density** rebuilds
  the mesh. **Apply** bakes (one undo); **Cancel/Esc** restores; switching to a brush banks the pose.
- Empty cell → nothing happens; transformed layer → disabled (Apply transform first); a hold frame
  poses its resolved key (via `ensureDrawableKeyframe`). The baked result composites with
  onion/boil/export and survives save-reload (it's cell pixels).

## Out of scope

- Non-destructive pose storage; animated/keyframed pose; true Igarashi ARAP; per-handle
  weight/stiffness; arbitrary (non-vertex) handles; multi-frame propagation.

## Self-review notes

- Reuses the proven deformation cores (parts 1–2) and the grid Deform tool's lift/bake/undo +
  `drawTriangle` render contract; the only genuinely new code is the `MeshPose` state, the doc-coord
  mapping, the handle interaction, and the overlay wiring.
- Geodesic distances + weights are cached per handle-set so the per-drag path is the closed-form
  kernel + a triangle blit — real-time, with a clear wireframe-fallback if iPad raster cost bites.
- Per-frame + destructive + the same transformed-layer guard keeps it consistent with the existing
  Deform/select tools; nothing about the model is novel beyond the mesh.
