# Pose: fill outlines — Design

**Status:** Approved (2026-08-15)
**Date:** 2026-08-15
**Builds on:** `2026-06-26-arap-1-triangulation-design.md` (silhouette → Delaunay mesh),
`2026-06-26-arap-2-geodesic-mls-design.md` (geodesic weighting) and
`2026-06-26-arap-3-pose-tool-design.md` (the tool). Closes the roadmap item recorded in `CLAUDE.md`
as "outline-only drawings pose as a thin web".

## The problem

`MeshPose.fromLift` (`src/core/mesh-pose.ts`) defines the character with one predicate:

```ts
const inside = (x, y) => data[(y * img.width + x) * 4 + 3] > 10; // alpha > 10
```

`triangulateSilhouette` samples boundary points along that region's edges, scatters interior points
inside it, runs Delaunay, and **keeps only triangles whose centroid is inside**
(`src/core/triangulate.ts:98`).

On a filled drawing that region is a solid body and the mesh is a body. On **outline-only art**,
alpha clears the threshold only ON the strokes, so the boundary trace follows each 2–3 px line, the
interior sampling finds almost nothing, and every triangle spanning the enclosed white space is
discarded as outside. The result is a thin ribbon following the ink — the "web".

Two things then go wrong, and only the second is obvious:

1. There is no body to carry, so the enclosed area is not part of the deformation at all.
2. **Geodesic weighting travels ALONG the ribbon.** Moving a hand propagates down the arm outline,
   around the shoulder and can drag the far side of the head, because that is the shortest path
   through the mesh. "Far away" stops meaning what the artist expects.

## Requirements (user-confirmed)

1. **Change no pixels.** The artwork, the lifted bitmap and the saved file are untouched; only the
   mesh's idea of what the body is changes. Including a hole in the mesh paints nothing — transparent
   stays transparent — so the gain is entirely in deformation quality.
2. **On by default**, with a way to turn it off. Filled art has no holes to find, so the default only
   changes behaviour for the case that is broken today.
3. **Strict by default, with a tunable gap.** A `gap` of 0 does no bridging at all; raising it closes
   breaks in a hand-drawn outline.
4. **Say so when it fails.** A gapped outline lets the flood escape and silently produces the old
   web; the app must report that rather than leave the user guessing.

## Design

### Core (`src/core/fill-holes.ts`) — pure, node-testable

```ts
export function fillEnclosed(
  alpha: Uint8ClampedArray, // RGBA of the lifted bitmap
  w: number,
  h: number,
  opts?: { alphaThreshold?: number; gap?: number },
): { mask: Uint8Array; inkArea: number; grownArea: number; insideArea: number };
```

1. **Pad** the bitmap with `gap + 1` transparent pixels on every side. The pose lift is a TIGHT
   content bbox, so ink routinely touches all four edges; without a guaranteed clear ring the flood
   below has nowhere to start and the whole bitmap reads as "inside".
2. `ink` = `alpha > (alphaThreshold ?? 10)` — the same threshold `fromLift` uses today.
3. `grown` = **dilate** `ink` by `gap` (at `gap: 0`, `ink` unchanged — the strict path costs nothing).
4. Flood-fill from the padded **border** through non-`grown` pixels. Everything reached is
   genuinely outside the character.
5. `filled` = the complement of that flood.
6. If `gap > 0`, **erode `filled` by `gap`** — undoing the dilation's bloat. Erosion is applied to
   the SOLID filled mask, never to the thin ink.
7. `mask` = `filled ∪ ink`, cropped back to the original size. The union guarantees the strokes
   themselves are never eroded away.

**The order is load-bearing, and an earlier draft of this spec had it wrong.** Closing the *ink*
(dilate → erode) does NOT bridge a break in a 1-px line at any radius: the dilation joins the ends,
then the erosion eats the join straight back out, because the joint is never thicker than the
structuring element. Prototyped and measured — a 15×15 ring with a 1 px break stayed unfilled at
radii 1, 2 and 3. Dilating, filling, then eroding the *solid result* is what actually works, because
by then the mask is thick enough to survive erosion.

Measured behaviour of the prototype (ratio = `insideArea / inkArea`; a filled centre is the pass
condition):

| break in the outline | gap 0 | gap 1 | gap 2 | gap 3 |
| --- | --- | --- | --- | --- |
| closed | ✅ 3.02 | ✅ 3.02 | ✅ 3.02 | ✅ 3.02 |
| 1 px | ❌ 1.00 | ✅ 3.08 | ✅ 3.08 | ✅ 3.08 |
| 3 px | ❌ 1.00 | ❌ 1.11 | ✅ 3.16 | ✅ 3.19 |
| 5 px | ❌ 1.00 | ❌ 1.09 | ❌ 1.26 | ✅ 3.14 |

So **`gap: r` bridges a break of roughly `2r` pixels** (the dilated discs have to meet), and a closed
outline shows **no bloat at any radius** — 121 px of interior at every setting.

`inkArea`, `grownArea` and `insideArea` come back because they are free at this point and drive the
report below.

This module is the reason the feature is worth building properly: unlike almost all of this app's
canvas code it is pure logic over an alpha array, so it can carry real unit tests rather than being
another build-and-review-only change.

`dilateMask` already exists at `src/core/fill.ts:181` (module-local, used by the Fill tool's
`expand`). Move it to a shared home and reuse it rather than writing a second dilation.

### Wiring (`src/core/mesh-pose.ts`)

`MeshPose.fromLift(img, rect, dpr, spacing, opts?: { fillHoles?: boolean; gap?: number })` builds
its `inside` predicate from `fillEnclosed`'s mask when `fillHoles` is on, and from raw alpha when it
is off. Nothing else in the pose path changes — same triangulation, same geodesic solve, same bake.

Both call sites are in `Canvas.svelte` (`:1303` initial lift, `:1370` density rebuild).

### State

`state.pose = { fillHoles: true, gap: 0 }` in `appState`. **Session-only, not persisted** — matching
`onion`, which is likewise a working preference rather than document data. (Both are candidates for
the deferred "settings as global preferences" roadmap item; neither should be persisted piecemeal.)

### UI

The existing **pose bar** (`Canvas.svelte`, `poseBarVisible()` — on-canvas, top-centre) already
carries the mesh-density buttons, and `poseDensity` rebuilds the mesh from the same lifted bitmap.
Fill-outlines is the same class of setting and rebuilds by the same mechanism, so it belongs there:

- a **"Fill outlines"** checkbox (default on)
- a small **gap** number, revealed only when the checkbox is on (default 0)

Both rebuild the mesh exactly as the density buttons do — including the existing reset of
`poseDrag`/`activeHandle`, since vertex indices change.

Note the bar exists only after a lift. That is acceptable: default-on means the first lift is
usually already correct, and when it is not, the control is on screen.

### Report

With `fillHoles` on, report failure when `insideArea < grownArea * 1.1` — i.e. the flood found
essentially nothing that the dilation had not already produced. **Compare against `grownArea`, not
`inkArea`:** at `gap: 2` a failed fill still measured 1.26× the ink purely from dilation bloat, so an
ink-based threshold would have called that a success. Measuring against the grown mask isolates
*enclosure* from *bloat*, and the prototype separates cleanly on it — failures sit at ~1.0, successes
at ~3.0.

On failure, set a status hint naming the remedy: the outline is not closed; raise the gap value or
fill the shape. Anything is better than leaving a web on screen with no explanation.

## Out of scope

- **Altering the artwork.** No auto fill-holes into pixels, in line with the standing preference
  against silently changing art. Filling with the Fill tool before posing remains a valid manual
  route and is unaffected.
- Persisting `pose` settings (see State).
- Animated/keyframed poses, and true Igarashi ARAP — both remain deferred for their own reasons.
- Any change to triangulation, geodesic weighting or baking.

## Testing & verification

`fillEnclosed` is unit-tested (node): a closed square fills; a square with a 1 px break leaks and
returns `insideArea ≈ inkArea`; `gap: 1` bridges that break; nested holes; ink touching the crop
edge; an empty bitmap; and a donut with `fillHoles: false` keeps its hole. The `fromLift` wiring and
the bar controls are canvas/DOM and get build + review gates per project convention.

**Browser pass owed:** pose an outline-only drawing and confirm the mesh is a body, not a web; that
a handle drag now falls off through the shape rather than along the lines; a **donut** with the
checkbox off keeps its hole; a deliberately gapped outline reports the failure; raising the gap
closes it; a filled drawing is unchanged by any of this; and that a very thin appendage (thinner
than the gap radius) is not eaten by the erode — the reason gap defaults to 0.
