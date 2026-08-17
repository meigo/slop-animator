# Layer transform track (tweening) — design

**Date:** 2026-08-18
**Status:** Draft — awaiting review
**Builds on:** per-layer transform (`2026-06-22-per-cell-transform-design.md`,
`2026-06-23-group-transform-design.md`), undoable transform drags
(`2026-08-09-undoable-transform-drags-design.md`), shared row ordering (`src/anim/row-layout.ts`,
2026-08-18 — the group/timeline row model this track's row plugs into).

## Goal

Animate a **layer's** transform over time: keys at frames, interpolated between, so a drawing can be
moved, scaled or rotated across the timeline without redrawing it. Two motivating cases:

- **Parallax / camera-ish moves** — several background plates panning at different rates.
- **Walk cycle** — the legs animate frame by frame inside the cell track while the whole character
  translates across frame via the transform track.

## Why this level

Cell transforms stay static: a cell **is** the frame-level keyframe, so animating it would be two
timing systems on one object. Group transforms stay static in this phase (see Non-goals) — the layer
is where both motivating cases live, and `group ∘ layer ∘ cell` already gives two stages of motion
for a character moving within a group-level move later.

The existing **Frame / Layer / Group scope toggle** already answers "which level do you mean?", so
this feature adds no new mental model: it animates whatever Layer scope already points at.

## Requirements (user-confirmed)

1. **Opt-in.** A layer is static until the artist presses Animate. Existing projects and every
   current gizmo drag behave exactly as they do today.
2. **Auto-key.** Once a track exists, dragging the gizmo writes a key at the playhead. No arming
   step, no separate commit — but the app must SAY that a drag will key, because otherwise a nudge
   made while scrubbed elsewhere silently bends the motion.
3. **Interpolation that can match the drawing rhythm.** Linear, plus a way to make a move update on
   2s/3s rather than every frame, and a hold (stepped) mode for pose-to-pose blocking.
4. **Reference layers animate too** — a panning background photo is the same feature.

## Non-goals

Easing curves or a curve editor; motion-path display on canvas; retiming keys by dragging them on
the track (see Deferred); group-level tracks; a camera object with per-layer parallax depth;
cell-level tweening; shortest-path rotation normalisation; copying a track between layers.

## Model

`src/anim/document.ts`:

```ts
export interface TransformKey {
  /** Project frame, >= 0. Unique within a track. */
  frame: number;
  t: RefTransform;
}

export interface TransformTrack {
  /** Sorted by `frame`, never empty. */
  keys: TransformKey[];
  /** "linear" interpolates between keys; "hold" keeps each key's value until the next. */
  interp: "linear" | "hold";
  /**
   * Linear only: quantise the sampled frame to a multiple of this, so a smooth move updates on 2s
   * or 3s like the drawings do. 1 = every frame. Ignored when `interp` is "hold".
   */
  sampleEvery?: number;
  /**
   * The pivot box, captured ONCE when the track is created and shared by every key.
   *
   * This is the load-bearing difference from the static case. `transformBox` is frozen per gesture
   * today (gotcha #5) to stop the pivot moving under a drag; with a track, a per-key box would make
   * the pivot *interpolate*, so the motion path would warp between keys for reasons invisible in the
   * UI. One box per track keeps the path predictable.
   */
  box: { x: number; y: number; w: number; h: number } | null;
}
```

Added to both layer kinds as `transformTrack?: TransformTrack`.

While a track exists, `track.box` **supersedes** the layer's own `transformBox` everywhere the pivot
is read. The layer's box is left untouched rather than cleared, so Remove animation restores the
static behaviour intact.

**Absent means static** — the same convention as `ReferenceLayer.range` and the audio trim fields, so
old projects load unchanged and the save-format version does not move. When a track is present it
drives the transform and the layer's static `transform` is ignored but **retained**, so removing the
track can restore a sensible value.

## Resolution

```ts
export function transformAt(layer: Layer, frame: number): RefTransform;
```

- No track → `layer.transform` (today's behaviour, unchanged).
- Before the first key or after the last → that key's value, held. A track never extrapolates.
- `interp: "hold"` → the value of the latest key at or before `frame`.
- `interp: "linear"` → **quantise the time, then evaluate**: `q = first.frame + floor((frame -
  first.frame) / sampleEvery) * sampleEvery`, and interpolate between whichever keys bracket `q`.
  The grid is global to the track, not per-bracket, so `q` can land in an earlier bracket than
  `frame` does — that is the intent (sample-and-hold the whole animation on a grid), not an edge
  case to correct.

Field-by-field interpolation:

- `dx`, `dy`, `scale` — linear. Scale is linear rather than geometric: it is what 2D tools do for a
  fit-multiplier, and a geometric ramp is not what a artist dragging a handle expects.
- `rotation` — linear in radians with **no shortest-path normalisation**. The gizmo stores absolute
  accumulated rotation, so a deliberate 720° spin is `4π` and must render as two turns, not as zero.
  This is the one place where the "obvious" implementation is wrong.

## Authoring

**Animate** — a button in ToolOptions, shown whenever the active layer's own transform is directly
editable: for a **drawing layer** that means the Transform tool at Layer scope; for a **reference
layer** it means any tool, because a ref's gizmo is live under all of them (the same reason
Reset-to-fit is rendered outside the per-tool branches). A locked or hidden layer never shows it. It creates a track with **one key at
frame 0** carrying the layer's current static transform, and captures `box` from the layer's current
`transformBox` (or its base rect when absent). Frame 0 because that value has been true for every
frame; anchoring it there makes the first drag at frame N produce a clean 0→N tween.

**Keying** — with a track present, both transform drag paths (the gizmo's handle drag and the
Canvas on-canvas drag) commit a key at the current playhead on release. They already bracket one
undo entry per completed gesture via `beginStructuralEdit`/`commitStructuralEdit` and settle through
`transformDragGuard`; keying rides inside that bracket, so a drag remains one undo step. A drag that
does not change the transform (`isSameTransform`) still writes nothing.

**Saying so.** An animated layer under the Transform tool sets a status hint naming the frame that a
drag will key. This is the mitigation for auto-key's one real hazard and is not optional: without it,
a nudge made while scrubbed between keys changes the motion silently. It uses the existing
`contextHint` precedence, ranking below the locked/hidden refusals.

**Delete key** — a ToolOptions button, enabled when a key exists exactly at the playhead. Deleting
the last remaining key is refused (a track is never empty); use Remove animation.

**Remove animation** — bakes the resolved transform at the current playhead into `layer.transform`,
then deletes the track. WYSIWYG: what is on screen is what the layer keeps. Undoable.

## Timeline

A track gets its own row, emitted by `timelineRows` directly under its layer's row and only when
`transformTrack` is present:

```ts
| { kind: "transform"; layer: Layer }
```

The row shows a ◆ at each key frame. It carries **no `data-layer-id`**, which — per the rule
established with group rows — keeps it out of the selection axis for free: the marquee, block
copy/paste/move and `resolveSelectionRect` all resolve rows through that attribute, and a transform
track holds no cells to select.

Its gutter label is indented like a group member and reads "Transform", so it is visibly subordinate
to the layer above it.

## Rendering

`layer.transform` is read at six sites in `render.ts`, plus `layerComposeSteps` (four call sites). Those
become frame-aware: `layerComposeSteps(layer, frame)` and `transformAt(layer, frame)` at the render
sites. The signature change surfaces every call site through the compiler — the same technique that
found all 27 sites when `isLayerEditable` gained its `groups` parameter.

Everything downstream follows without further change, because it already consumes compose steps
rebuilt per frame: the draw-through inverse, `LayerBoundsHint`, `Canvas.syncComposeSteps` (already
re-run on playhead change), export, and onion ghosts — which will correctly show each ghost frame at
its own transform.

## Undo and persistence

`transformTrack` is structural. `cloneLayers` must **deep-copy** it (keys array and each key's
transform), because snapshots share layer objects and a drag must replace rather than mutate
(gotcha #8). `restoreStructure` restores it alongside `transform` and `range`. Every writer —
Animate, key-write, Delete key, Remove animation — pushes exactly one command, per the invariant that
a field in the snapshot must have no non-committing writers.

Persistence: an optional `transformTrack` on the layer JSON. Format version stays 1; absent on every
existing save.

## Interaction with existing features

- **Apply layer transform** is refused on an animated layer — baking pixels only makes sense for a
  transform that does not vary. Silent no-op plus a status hint, matching the locked-layer
  convention.
- **Reset to fit** is likewise refused; Remove animation is the way back.
- **Drawing is allowed.** The inverse compose already maps per frame, so strokes land correctly. The
  paintable rect moves as you scrub, which `LayerBoundsHint` already draws — the status hint says so.
- **Group transforms** still compose above, unchanged and static.
- **Locked / hidden layers** refuse Animate and keying, through the existing guards.

## Testing

Unusually testable for this codebase — the resolution logic is pure:

- `transformAt`: no track; single key; before-first and after-last hold; exact-key hit; linear
  midpoint; `interp: "hold"`; `sampleEvery` quantisation, including a `q` that falls in an earlier
  bracket than `frame`; a 720° rotation interpolating through two turns rather than normalising to
  zero.
- Key writing: insert in frame order, replace an existing key at the same frame, refuse to delete the
  last key.
- `cloneLayers` deep-copies a track (mutating the live track must not reach the snapshot).
- Persistence round-trip, and an old save loading with no track.

The gizmo wiring, the ToolOptions controls and the timeline row are DOM-coupled and stay
build + review verified, per project convention.

## Deferred, with reasons

- **Retiming keys by dragging them on the track row.** Genuinely wanted, but the timeline's gesture
  surface is where this project's bugs concentrate, and this feature is already touching the render
  chain and the undo snapshot. Re-key at the new frame and delete the old one meanwhile.
- **The armed toggle** (un-armed drag shifts the whole track instead of keying). Useful once a move
  exists and wants sliding bodily; additive, and auto-key does not block it.
- **Group tracks.** Same optional field one level up, once layer tracks prove the model.
- **A camera** with per-layer parallax depth. The honest answer to the multi-plate pan, and this
  track is the substrate it would be built on.

## Owed a browser pass

Animate on a static layer leaves it looking identical; drag at frame 24 and scrub to see the tween;
the status hint names the frame a drag will key; `sampleEvery` 2 visibly steps the motion on 2s;
hold mode does not interpolate at all; a rotation past 180° goes the way it was dragged; Delete key
and Remove animation, each undone and redone; drawing on an animated layer lands correctly at two
different frames; onion ghosts appear at their own frames' positions; export matches the editor;
save → reload preserves the track; an old project opens unchanged; a locked or hidden layer refuses
Animate; iPad for the ToolOptions controls and the track row.
