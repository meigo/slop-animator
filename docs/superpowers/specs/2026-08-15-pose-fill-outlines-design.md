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
): {
  mask: Uint8Array;
  inkArea: number;
  grownArea: number;
  insideArea: number;
  inkBBoxArea: number; // added 2026-08-15 with the corrected report — see Report
  enclosedArea: number; // ditto
};
```

`gap` is clamped to `0..MAX_GAP` (8) **inside** `fillEnclosed`, not at the caller: the `max="8"` on
the UI's number input is advisory (a browser accepts a typed `50`), the morphology is
O(pixels × r²) and unseparated, and the pose lift has already cleared the cell's pixels and bumped
`persistTick` by the time it runs — so a multi-minute freeze there is not just a hang, it is a
force-quit away from losing the artwork.

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

The area counters come back because they are free at this point and drive the report below.

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

**This section was wrong in the version that shipped, and was corrected on 2026-08-15 after
review.** It originally read: *"report failure when `insideArea < grownArea * 1.1`"*. That criterion
tests the wrong thing twice, because the prototype behind it only ever measured outline rings and so
never had to tell "**failed** to fill" apart from "**nothing** to fill":

1. `mask == ink` is the normal, correct outcome for **filled art, a single stroke, or any drawing
   with no enclosed space at all** — measured: a solid blob reports `ink=900 grown=900 inside=900`,
   which trips it. Posing a filled silhouette therefore said "Outline isn't closed — raise Gap, or
   fill the shape", which is both wrong and unactionable.
2. `grownArea` counts **dilation bloat that step 6 then erodes away**, so on a small shape it
   exceeds even a *successful* fill: a **closed** 15×15 ring at `gap: 2` fills perfectly (121 px,
   identical to `gap: 0`) yet measures `121 < 188 × 1.1`. The criterion fired on the very remedy
   its own message asks for.

The corrected criterion is `outlineFillFailed(r)` in `fill-holes.ts`, pure and unit-tested, with two
conditions that must BOTH hold:

1. **The art looks like an outline** — `inkArea < 0.4 * inkBBoxArea`, i.e. the ink is sparse within
   its own bounding box. A solid blob measures ~1.0, a single stroke 1.0 along its own axis, the
   15×15 test ring 0.33. This is what separates "failed" from "nothing to fill", and it is free:
   the bounding box comes out of the pass that already reads the alpha.
2. **The flood enclosed nothing at all** — `enclosedArea === 0`, where `enclosedArea` is
   `mask \ grown`, the area gained beyond ink *and* bridging. A leak drives it to exactly 0 (the
   flood reaches the interior, so `filled == grown`), while any real enclosure is > 0 regardless of
   gap. This replaces the `grownArea` comparison, which no longer participates in the decision;
   `grownArea` is kept in the result as a diagnostic only.

Deliberately **conservative**: a partial fill (one pocket closes, the body still leaks) does not
warn. A false alarm is the worse failure mode here — see the delivery note below.

Measured across the criterion's whole domain (`old` = the shipped criterion, `new` = corrected):

| case | ink | grown | inside | enclosed | density | old | new |
| --- | --- | --- | --- | --- | --- | --- | --- |
| solid blob, gap 0 | 400 | 400 | 400 | 0 | 1.000 | ⚠️ warns | ✅ silent |
| solid blob, gap 2 | 400 | 564 | 400 | 0 | 1.000 | ⚠️ warns | ✅ silent |
| single stroke, gap 0 | 20 | 20 | 20 | 0 | 1.000 | ⚠️ warns | ✅ silent |
| closed ring, gap 0 | 40 | 40 | 121 | 81 | 0.331 | ✅ silent | ✅ silent |
| closed ring, gap 2 | 40 | 188 | 121 | 25 | 0.331 | ⚠️ warns | ✅ silent |
| ring, 5 px break, gap 0 | 35 | 35 | 35 | 0 | 0.289 | ⚠️ warns | ⚠️ warns |
| ring, 5 px break, gap 2 | 35 | 174 | 44 | 0 | 0.289 | ⚠️ warns | ⚠️ warns |
| open "C", gap 0 | 31 | 31 | 31 | 0 | 0.256 | ⚠️ warns | ⚠️ warns |

The open "C" still warns, and that is intended — it *is* an unclosed outline, and both remedies
apply. One known residual: a lone **diagonal** stroke is sparse in its own bounding box (0.05) and
encloses nothing, so it warns. It needs a lift whose entire content is a single diagonal line to
reach, and the message costs nothing but a glance.

**Delivery.** On failure, name the remedy — the outline is not closed; raise the gap value or fill
the shape. It must NOT go through `statusHint`: that field means "the hovered/pressed control's
`title=`" and has a window-level writer in `App.svelte`, so the very `pointerdown` that builds the
mesh overwrites it microseconds later (and each density button overwrites it with its own title).
The message lives in `appState.poseFillWarning`, is rendered **in the pose bar next to the Gap
control** that remedies it, and is set *or cleared* on every mesh build and on apply/cancel. Clearing
it is not optional: on iPad there is no hover to replace a stale message, and `StatusBar` renders
`statusHint || idleHint`, so a stuck warning would also suppress the pose context hint — including
"leaving the tool bakes it", the only commit path without a keyboard.

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
edge; an empty bitmap; and a donut with `fillHoles: false` keeps its hole. `outlineFillFailed` and
`clampGap` are unit-tested too (the corrected report's table above is the test matrix — a solid
blob and a single stroke must stay silent, a gapped ring must warn, a closed ring at `gap: 2` must
stay silent, and `gap: 50` must behave exactly as `gap: 8`). The `fromLift` wiring and the bar
controls are canvas/DOM and get build + review gates per project convention.

**Browser pass owed:** pose an outline-only drawing and confirm the mesh is a body, not a web; that
a handle drag now falls off through the shape rather than along the lines; a **donut** with the
checkbox off keeps its hole; a deliberately gapped outline reports the failure **in the pose bar**
and raising the gap until it fills CLEARS that message (as do the checkbox, Apply and Cancel); a
filled drawing reports nothing at any gap; a filled drawing is unchanged by any of this; and that a
very thin appendage (thinner than the gap radius) is not eaten by the erode — the reason gap
defaults to 0. Also: type `50` into Gap and confirm it snaps to 8 without a freeze, and empty the
field and confirm it reads back 0.
