# Transform stretch & flip — design

**Status:** draft for review · **Date:** 2026-09-11 · **Branch:** `feat/transform-stretch-flip`

## The ask

> "I'd like to flip reference layer … selection>free transform has only non-uniform scale (dragging
> from corners) available and layer transform has only uniform scale available. I can imagine that
> layer flip could be solved with non-uniform negative scale, and also be animatable that way?"

Preceded (same day) by selection flip (floating bar) and "the Transform tool follows the selected row"
(no Frame/Layer/Group toggle; per-frame transforms no longer creatable). This spec is item 3 of that
conversation: non-uniform scale in the shared transform model, with flip as negative scale.

## Decisions (settled in brainstorming)

| Question | Answer |
|---|---|
| Model | **`scaleX` / `scaleY` replace `scale`** (approach A). Rejected: keeping `scale` plus multipliers (two ways to express one size) and flip-only booleans (no stretch). |
| Handles | **Corners proportional by default, sides stretch one axis** — on the layer/group/reference gizmo AND the selection. A **Keep proportions** toggle lets corners stretch freely. |
| Selection skew | **Dropped.** Sides stretch instead; Distort and Mesh cover slanting and bending. |
| Flip pivot | **In place** — around the centre of what is on screen (drawing, group content, reference image). |
| Flip on an animated target | **Mirrors the whole animation** — the static value and every transform key. An animated turnaround is made with the handles (drag a side past zero at a key). |

## 1. Model

```ts
interface RefTransform {
  dx: number; dy: number;      // translate from the base centre, document logical px
  scaleX: number; scaleY: number; // per-axis, along the target's OWN axes; negative = mirrored
  rotation: number;            // radians, clockwise, about the centre
}
```

- Compose order (unchanged in shape): `T(centre + d) · R(rotation) · S(scaleX, scaleY) · T(−centre)` —
  the canvas's `translate → rotate → scale(sx, sy)`. A stretch rides the target's own axes, so a
  rotated stretched layer keeps its stretch direction (as a selection float already does).
- **Magnitude floor:** `|scaleX|, |scaleY| ≥ 0.05` (today's `MIN_SCALE`), sign kept. No stored OR
  resolved value is below the floor; nothing divides by zero.
- A mirror on BOTH axes equals a 180° rotation — no separate flip flag can disagree with the scale.
- `IDENTITY_TRANSFORM = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 }`; `isIdentityTransform`
  and `isSameTransform` compare both scales.
- **Tracks:** `lerpTransform` blends `scaleX` and `scaleY` independently. A key-to-key flip passes
  through the 0.05 floor (the turnaround squashes to a 5% sliver, not zero) unless that key's easing
  is `hold`. Nothing else about tracks changes.

### One transform maths

`src/core/ref-transform.ts` gets per-axis versions of everything: `transformedCorners`,
`rotateHandlePos`, `hitTestHandle` (plus the new side handles), `inverseTransformPoint`,
`forwardTransformPoint`, `applyScale` (proportional), plus new `applyStretch` (one axis) and
`applyFreeScale` (corners with Keep proportions off). Every consumer already goes through it or through
the render helpers: `render.ts` (`drawTransformed`, `drawCellComposed`, `transformedCell`, the 2D and
boil paths), the gizmo, the canvas drag, selection `composeSteps` mapping, `bakeCell` / layer bake
(Apply, merge down), rasterize reference. Onion skins, video and PSD export render through `render.ts`.
Direct `.scale` field uses today: ~25 across `document.ts`, `render.ts`, `ref-transform.ts`,
`Canvas.svelte`, `project-file.ts`, `selection-map.ts` — each is converted.

### Old projects

One `normalizeTransform(raw): RefTransform | null` accepts either shape — `{ scale }` becomes
`scaleX = scaleY = scale` — and rejects non-finite values (the existing finite-check at
`project-file.ts:457` moves into it). Applied everywhere a transform is stored: a layer's `transform`
and its transform-track keys, a group's `transform` and its track keys, and per-cell
`cellTransforms`. Saving writes `scaleX` / `scaleY` only. Format `version` stays 1; a pre-change
build would mis-read a new file — accepted, the deployed app is always current (same call as loop
keys).

## 2. Handles

### Layer / group / reference gizmo (`RefTransformGizmo.svelte` + `Canvas.svelte`'s on-canvas drag)

- **Corners:** proportional — one factor applied to both axes, signs kept, about the **centre**
  (as today). With Keep proportions **off**, each axis follows the pointer independently, measured
  in the target's local (rotated) frame.
- **Sides (new):** four small squares at the edge midpoints; each stretches ONE axis about the centre.
  Cursor follows the rotated edge (as the corner cursors already do). Hit area = the corners'.
- **Past zero:** dragging a corner or side through the centre crosses zero and flips that axis (as the
  selection already does); magnitude is floored at 0.05 on either side.
- Rotate handle and move-by-body are unchanged. Status hint gains "sides stretch".

### Selection Free transform (`src/core/selection.ts`)

- **Corners:** Keep proportions **on** → one factor for both axes, measured along the diagonal from
  the opposite (anchor) corner; crossing the anchor still flips. **Off** → today's free stretch.
  Pivot stays the opposite corner (the layer gizmo stays centre-pivoted; unifying pivots is out of
  scope).
- **Sides:** the skew branch (`case "l" | "r"`, `case "t" | "b"` in `updateDrag`) becomes a one-axis
  stretch anchored at the opposite side. Skew is removed.

### Keep proportions

One app-wide setting `appState.keepProportions` (default **on**), persisted with preferences (absent
= on). A lock toggle in the Transform bar and in the selection bar while a selection is lifted. It
changes corners only; sides always stretch one axis.

## 3. Flip

- **Flip horizontal / Flip vertical** buttons in the Transform bar, beside Keep proportions. They act
  on the selected row's target (`transformScope()` + the gizmo's `activeTransformLayer`): the layer,
  the reference, or the group. Same refusals as a drag (locked/hidden layer, locked group member,
  reference outside its span). The selection's own flip buttons (floating bar) are unchanged.
- **In place:** the mirror line passes through the centre of what is on screen **at the playhead**,
  in the target's parent space:
  - reference → its transform centre, `base centre + d(playhead)`;
  - group → the group box centre + `d(playhead)`;
  - drawing layer → the centre of the displayed key's `contentBounds`, mapped through the cell
    transform and the layer transform at the playhead; an empty frame falls back to the transform
    centre.
- **Closed form** (`mirrorTransform(t, baseCentre, axis, line)`, pure): for a vertical mirror line
  `x = c` with base centre `C`:
  `scaleX' = −scaleX`, `rotation' = −rotation`, `dx' = 2c − 2·C.x − dx`, `scaleY', dy'` unchanged.
  Horizontal line `y = c` is the same on the other axis (`scaleY' = −scaleY`, `rotation' = −rotation`,
  `dy' = 2c − 2·C.y − dy`). Derivation: reflecting `T(p) = C + d + R(θ)S(p − C)` by `F = diag(−1, 1)`
  gives `F R(θ) S = R(−θ) S(−sx, sy)`, so the reflected map is again a transform on the same base.
- **Animated target:** the same mirror (same line, computed at the playhead) is applied to the static
  value AND every key of the target's transform track. Because the mirror is affine in
  `(dx, dy, rotation, scaleX, scaleY)`, interpolated frames are mirrored exactly too. Timing,
  easing and key frames are untouched.
- One undoable structural edit per press (replace the layer/group/track objects — gotcha #8).

## 4. Everything else

- **Apply / merge down / rasterize:** bake through the per-axis maths, so a flipped or stretched
  transform bakes exactly as displayed.
- **Preferences:** `keepProportions` added to gather/apply.
- **Docs:** README (transform bullet: stretch, flip, keep proportions), CHANGELOG entry, CLAUDE.md
  current state.

## Testing

Pure logic, Vitest:

- `ref-transform`: corners / forward / inverse round-trip with rotation + non-uniform + negative
  scale; `hitTestHandle` finds the four side handles; `applyScale` proportional keeps signs and crosses
  zero with the 0.05 floor; `applyFreeScale` per axis; `applyStretch` one axis per side.
- `mirrorTransform`: the mirrored transform maps every probe point to the reflection of the original's
  image — H and V, with rotation and stretch; mirroring twice is the identity.
- Track mirroring: every key mirrored; an interpolated frame of the mirrored track equals the mirror
  of the original's interpolated frame.
- `normalizeTransform`: legacy `{ scale }`, new shape, non-finite rejection; applied to layer, group,
  per-cell and track-key transforms on load (persist round-trip).
- `lerpTransform` per axis; `isIdentityTransform` / `isSameTransform` with both scales.
- Selection: side-stretch matrix (replacing skew); proportional corner factor keeps sign across the
  anchor; free corner unchanged.
- Preferences round-trip of `keepProportions` (absent → true).

Owed a browser + iPad pass: side handles and proportional corners on a layer, a group and a
reference; the toggle; flip on each (static and animated); Apply with a flip; an export containing a
flip.

## Out of scope

Numeric scale fields; unifying the selection (anchor-corner) and layer (centre) pivots; per-frame
transforms (removed from the UI); skew (removed).
