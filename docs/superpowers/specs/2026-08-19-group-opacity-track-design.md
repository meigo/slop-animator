# Group opacity track — design

**Date:** 2026-08-19
**Status:** Draft — awaiting review
**Builds on:** multi-property animation rows
(`2026-08-18-multi-property-animation-rows-design.md`); timeline animation tools
(`2026-08-18-timeline-animation-tools-design.md`); group transform
(`2026-08-18` entries in `CLAUDE.md`).

## Goal

Fade a **group** as one thing, the opacity twin of a group transform: a character rig or a
stack of plates can dip without touching each member’s own opacity.

## Why now

Groups already animate transform. Layers already animate opacity. The bags, resolver, key bar,
and `buildFrameDrawList` exist. The missing piece is a group-level scalar and one multiply at
the only place opacity enters the render.

## Decisions (from brainstorming)

- **Same scalar track as a layer fade.** Not a second interpolation model.
- **Multiply at render.** Member × group / 100. Photoshop-style. Editor, onion, and export all
  go through `buildFrameDrawList`.
- **Static field is optional.** Absent = 100. Old projects and the save format (version still 1)
  are unchanged.
- **Slider on the group header**, labeled **Group**, even when the group is collapsed.
- **Animate from a member layer**, same as Animate group transform. The group header stays a
  collapse toggle, not a selection.
- **Same key tools** as a layer fade (Add / Delete / Copy / Paste / Ease / Step / Stop).

## Model

```ts
interface LayerGroup {
  // …
  opacity?: number; // 0..100; absent = 100
  tracks?: GroupTracks;
}

interface GroupTracks {
  transform?: TransformTrack;
  opacity?: Track<number>;
}
```

`groupOpacityAt(group, frame)`: track when present, else `group.opacity ?? 100`.

Animate writes a one-key track at frame 0 with that current value. Stop bakes
`groupOpacityAt(group, playhead)` into `group.opacity` and drops the track.

`activeRow` group-track case: `prop: "transform" | "opacity"`.

### Two property lists

`TRACK_PROPS` stays the **layer** list (`transform`, `opacity`). Groups get
`GROUP_TRACK_PROPS` (`transform`, `opacity`) in that fixed order. Copy, sanitise, the
document-wide frame shifter, and `timelineRows` loop the list that matches the owner. A
hand-written `tracks?.transform` on a group is the defect this exists to prevent.

Per-layer frame tools still do **not** shift group keys. Only `rippleDocumentFrames` does —
same rule as group transform, for the same reason: a group track is shared by every member.

## Render

In `buildFrameDrawList`, each op’s opacity becomes:

```
opacityAt(layer, frame) * groupOpacityAt(groupOf(layer), frame) / 100
```

Ungrouped layers: the group term is 100. A member at 50 inside a group at 50 draws at 25.

This is the only production consumer of per-op opacity (`render.ts`). Onion and both exporters
are covered. Pin it with draw-list tests (static group, animated group, ungrouped, both
animated).

## Authoring

### Slider

The layer-panel **group header** grows a second row: label **Group**, `w-12` range 0–100,
readout. Visible when the group is collapsed. Not on the timeline bar.

Two sliders can show at once (group header + the selected member’s layer slider). The Group
label is what distinguishes them.

Apply/commit split, same as the layer slider: one undo entry per gesture; a drag keys the
playhead when a group opacity track exists. `aria-disabled` + title when the write is refused.

| State | Slider |
|---|---|
| No track, group unlocked | Writes `group.opacity` (not undoable — matches layer static opacity). |
| No track, locked member / locked group | Still writes static opacity (lock protects content, not this view-prop). |
| Track live, unlocked | Keys the playhead. One undo entry per gesture. |
| Track live, locked member / locked group | Inert. Title says the group is pinned. |

Hidden group: keys are lock-only, matching group transform. Static slider stays live.

### Animate and the timeline

Selecting a **member layer** adds **Animate group opacity** to the start group on the timeline
bar (next to Animate group transform). Title names the group.

After Animate: an **Opacity** row under the group header, below Transform if that track exists;
`activeRow` focuses it; the bar shows the same key tools as a layer fade. The group unfolds
(`collapsed = false`) so the row is visible.

Stop bakes, removes the row, falls back to `{ kind: "layer"; id: activeLayerId }`.

Copy/paste uses the existing tagged clipboard (`prop: "opacity"`). A group opacity key pastes
onto a layer opacity track and the other way around — same scalar.

## Undo

`snapshotStructure` already spreads each group, so `snap.opacity` is a primitive captured at
that moment — a later static-slider write cannot alias it. `restoreStructure` already keeps
name / collapsed / visible live. Restore static group opacity **only when the opacity track's
presence flips** (`!!snap.tracks?.opacity !== !!live.tracks?.opacity`), the same rule as layer
opacity: undoing Stop must put the baked number back; an unrelated undo must not revert a
static nudge.

Every writer of `tracks.opacity` pushes a command. The static slider does not.

## Persistence

`opacity` and `tracks.opacity` are optional on the group JSON. Absent = 100 / no track. Format
version stays 1. An older build opening a new file ignores both; re-saving there drops the
group fade. Same one-way shape as the `tracks` bag.

Sanitise the opacity track with `isOpacityValue` (finite, 0–100). A bad static `opacity` falls
back to 100.

## Non-goals

- Selecting the group header as an `activeRow`.
- A group opacity slider on the timeline bar.
- Changing how layer opacity works.
- Animating group visibility (boolean).
- Per-member “ignore group opacity” flags.

## Testing

Pure and required:

- `groupOpacityAt`: absent → 100; static; track; hold / ease.
- `buildFrameDrawList`: ungrouped unchanged; static 50 × layer 100 = 50; both 50 → 25; animated
  group varies by frame.
- `GROUP_TRACK_PROPS` / copy / sanitise / ripple: an opacity track on a group is copied, survives
  load, and shifts on document ripple — not on a per-layer insert.
- `animationBar`: member of an unanimated group offers Animate group opacity; omitted once the
  track exists; focused group-opacity row → `kind: "keys"`.

DOM / review-only: the header slider (collapsed group, two sliders labeled), Animate from a
member, Stop, iPad wrap of a fourth start button.

## Migration

None that the artist sees. New optional fields. Old files open fully opaque, unanimated, at
the group.
