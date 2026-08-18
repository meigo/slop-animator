# Multi-property animation rows — design

**Date:** 2026-08-18
**Status:** Draft — awaiting review
**Builds on:** the layer transform track (`2026-08-18-layer-transform-track-design.md` plus the
dated 2026-08-18 entries in `CLAUDE.md`, which supersede it where they disagree), and the shared
row ordering in `src/anim/row-layout.ts`.

## Goal

Animate more than one property, and give each its own timeline row under a collapsible parent.
Two properties are in scope, chosen because between them they force every generalisation the rest
would need:

- **Layer opacity** (0–100) — a SCALAR, where the existing track is `RefTransform`-valued.
- **Group transform** — the same value type as today's track, but owned by a `LayerGroup` rather
  than a `Layer`.

Nothing else is added. The point of doing exactly these two is that a mechanism justified by one
example is a guess; these two pin both axes (value type, owner) with real cases behind them.

## Why now, and why not sooner

The single-property design was right to ship first: it settled interpolation, keying, undo, and the
row model against one concrete case. Generalising before the second case existed would have been
inventing requirements. This spec exists because the second case is now specified rather than
imagined.

## Requirements (user-confirmed)

1. **A property per row**, each under its owning layer.
2. **Collapsible.** Collapsed, the parent shows an expand arrow and an icon after its name saying
   it has animation; expanded, the property rows appear beneath it.
3. Layer opacity and group transform are the two properties.

## Non-goals

Any further property (boil strength, reference speed, reference opacity — all trivially addable
afterwards, and deliberately not added on spec); per-key bezier curves; copying a whole track
between layers; keyframing booleans (`visible`, `locked`); a curve editor; animating cell
transforms.

## Model

### One resolver, parameterised by how its values blend

The resolution skeleton — bracket search, `sampleEvery` quantisation, per-key easing, hold-at-the-
ends — is the part that took the most care to get right and is fully unit-tested. It must not be
duplicated per property; that is precisely how two implementations drift.

```ts
export interface Keyframe<V> {
  frame: number;
  v: V;
  interp?: KeyInterp;
}

export interface Track<V> {
  keys: Keyframe<V>[];      // sorted, never empty
  sampleEvery?: number;
}

/** The skeleton. `lerp` is the ONLY thing that differs between properties. */
export function resolveTrack<V>(track: Track<V>, frame: number, lerp: (a: V, b: V, u: number) => V): V;
```

`transformAt` and `opacityAt` become thin wrappers over `resolveTrack` with `lerpTransform` and a
numeric lerp. Every existing `transformAt` test keeps passing unchanged — that is the check that
the extraction was behaviour-preserving.

**Renaming `t` to `v`** is deliberate churn: the field holds "the value at this key", and calling it
`t` in a scalar track would be actively misleading (and `t` already means "transform" in one place
and "time" in another across this codebase).

### Tracks hang off a typed bag, not a string-keyed map

```ts
export interface LayerTracks {
  transform?: TransformTrack;   // Track<RefTransform> + box
  opacity?: Track<number>;
}
export interface GroupTracks {
  transform?: TransformTrack;
}
```

A `Record<string, Track<unknown>>` would lose the value type at every call site and push casts into
the render path. The property set is small and closed; a typed bag keeps `tracks.opacity` known to be
number-valued.

`DrawingLayer`/`ReferenceLayer` gain `tracks?: LayerTracks`; `LayerGroup` gains `tracks?: GroupTracks`.
Absent means static, as before.

### `box` finally earns its place

`TransformTrack.box` is currently always `null`, kept only because a future group track would need
it. That future is this spec, and the reasoning holds: a **group's** base rect is the union of its
members' content bounds at a frame, so it genuinely moves as the drawings change — freezing it at
track creation is what stops the pivot interpolating and warping the motion path between keys. A
**layer's** base is the document rect or a media contain-fit, so it stays `null` and is recomputed
live.

That asymmetry must be commented at the capture site, or it reads as an inconsistency.

## Rendering

**Opacity is a ONE-LINE change, and this is the pleasant surprise of the design.** Layer opacity
enters the render exactly once, in `buildFrameDrawList` (`document.ts`), which already takes `frame`
and stamps `opacity` onto each draw op. `render.ts` is its only production consumer, so editor and
export are both covered by that single site — the same property the reference-range gate relies on.
It becomes `opacity: opacityAt(layer, frame)`.

That also makes opacity **node-testable end to end**: `buildFrameDrawList` is pure and already has a
dozen unit tests, so an animated fade can be asserted directly, with no canvas. The transform track
had no such vantage point and had to be verified by review instead. Write those tests; they are the
cheapest confidence in this spec.

`groupTransform(g)` becomes `groupTransformAt(g, frame)` at its render call sites, exactly as
`layer.transform` became `transformAt(layer, frame)`. The compose order `group ∘ layer ∘ cell` is
unchanged; only the group step's value becomes frame-resolved, and everything downstream already
consumes compose steps rebuilt per frame.

**The group sweep is still part of the work, not an afterthought.** There are ~14 `groupTransform(`
call sites, and the transform track shipped with three sites reading a static value on an animated
layer — each found by a review rather than by the compiler. Every one must be classified as resolved
or correct-as-is (a write, a UI indicator, a genuinely frame-less context), and the classification
recorded.

## Authoring

**The property's existing control IS its gizmo.** Transform keys come from dragging the gizmo; by
the same rule, opacity keys come from dragging the **opacity slider** in the layer panel, and group
transform keys from the gizmo at group scope. No new authoring surface, and auto-key stays the one
model: with a track present, changing the value writes a key at the playhead.

Each property needs an **Animate** entry point beside its own control — for opacity that is the
layer panel's detail row, not ToolOptions, because opacity is not a tool. Group transform reuses the
existing Transform-tool controls at Group scope.

Interpolation for a scalar is the same five `KeyInterp` values. `hold` on an opacity track is how you
get a hard cut rather than a fade.

## Timeline rows

`timelineRows` gains one row per present track, in a fixed property order (transform, then opacity)
so rows never reorder under the artist as tracks are added.

**Collapsing.** The parent layer row gains a disclosure arrow when it owns any track, and an icon
after its name. Collapsed, its property rows are omitted; the icon is what says animation exists.
This mirrors the group header exactly — same affordance, same place — so there is one collapse idiom
in the timeline rather than two.

State lives on the layer (`tracksCollapsed?: boolean`, persisted, absent = expanded). Persisted
rather than session-only because a collapsed row is a statement about how you want to work on that
layer, and losing it on reload would be a small daily annoyance; `LayerGroup.collapsed` already sets
this precedent.

Group tracks get their row under the **group header row**, which already exists.

**Every property row carries no `data-layer-id`**, per the established rule: the timeline's selection
axis resolves rows through that attribute, so a row without one is invisible to the marquee and to
block operations for free — and a track holds no cells to select.

## Migration — the part that needs care

`transformTrack` has **shipped and is in real projects**, including autosaves. The loader therefore
reads BOTH shapes: `tracks.transform` when present, else a legacy `transformTrack`, promoting it.
Writing emits only `tracks`.

**The one-way consequence, stated plainly:** a build older than this release opens such a file with
its animation missing, and re-saving there would drop it. That is the same shape as the 1× document
scale migration already recorded in `CLAUDE.md`, and it is acceptable for the same reason — one
deployed build, one user — but it must be written down rather than discovered.

Format version stays 1: the loader is tolerant of both shapes, so a bump would buy a louder failure
only if the loader validated the version, which it does not.

## Undo and persistence

`tracks` is structural, so `StructSnapshot` carries it and every writer pushes exactly one command —
the invariant that a field in the snapshot must have no non-committing writers. `cloneLayers` and
`restoreStructure` deep-copy it.

**The copy helpers must be generic over the bag**, not per property. The transform track's worst bug
was two copy sites rebuilding a key as an explicit literal and silently dropping a field added later;
with three tracks and two owners there are more such sites, so there must be exactly one
`copyTrack`/`copyKeyframe` pair and one `copyTracks(bag)`, used everywhere. A test per writer asserts
a non-default field survives — the type system cannot catch a dropped optional.

## Testing

Pure and node-testable, so unit-tested: `resolveTrack` against both value types (the existing
transform cases must pass unchanged after the extraction — that is the regression net); scalar
interpolation including `hold` as a hard cut; the copy helpers preserving every field for every
track type; the legacy `transformTrack` → `tracks.transform` promotion, including a file carrying
both; row emission and ordering, collapsed and expanded, for layers and groups.

The gizmo, the slider, the row markup and the collapse control are DOM-coupled and stay
build + review verified, per project convention.

## Risks, honestly

- **This is a refactor of code that shipped hours ago**, and its review found defects in exactly the
  places this touches — copy helpers, snapshot restore, the render sweep. The extraction must be
  behaviour-preserving and provably so; the existing tests passing unchanged is the evidence.
- **Row density.** A layer with two tracks is three rows. Collapsing is the answer, and it defaults
  to expanded, so the first thing an artist sees after animating two properties is a taller timeline.
  Worth watching on the iPad before adding any further property.
- **Opacity keys have no on-canvas gizmo**, so the timeline row and the slider are the only places
  they are visible. If that feels thin in use, a value ramp drawn in the row is the natural next step
  and is purely additive.

## Owed a browser pass

Animate opacity and scrub a fade; a `hold` opacity segment as a hard cut; export matching the editor;
a group transform animated with a member layer also animated, composing correctly; collapse and
expand with the icon indicating animation; the collapse state surviving a reload; an old project with
a `transformTrack` opening with its animation intact and re-saving in the new shape; undo/redo across
every new writer; and iPad for the collapse affordance and the opacity slider as a keying control.
