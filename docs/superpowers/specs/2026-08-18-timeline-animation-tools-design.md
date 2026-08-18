# Timeline animation tools — design

**Date:** 2026-08-18
**Status:** Draft — awaiting review
**Builds on:** multi-property animation rows
(`2026-08-18-multi-property-animation-rows-design.md` plus the dated 2026-08-18 entries in
`CLAUDE.md`, which supersede it where they disagree); the timeline tool bar
(`src/lib/Timeline.svelte`); `activeRow` (`2026-08-16` trim-to-playhead / audio-lane selection).

## Goal

Put every **animation tool** in the same strip as the drawing key tools (Add frame / Insert
keyframe / Hold / …), and take them off the two places they landed by accident:

- Transform Animate / Ease / Step / Delete / Stop, hidden under the Transform tool in ToolOptions.
- Opacity Animate / Ease / Step / Delete / Stop, wrapping the layer-list detail row.

The timeline **property rows stay**. This is not a second timeline and not a dedicated inspector.

## Why the current split failed

One rule — “key controls live with the property’s authoring control” — was applied twice and
failed in opposite ways.

- Transform’s authoring control is a **tool**, so the tools vanish the moment you go back to the
  brush.
- Opacity’s authoring control is a **slider** in a dense 224 px panel, so the same tools crowd a
  row that already has boil, video offset, and embed.

The timeline already has the tracks (keys, retime, collapse). What was scattered is everything
*around* the track. Value authors (gizmo drag, opacity slider) were never the problem.

## Decisions (from brainstorming)

- **One timeline.** Property rows stay the place you see and retime keys. No second track view, no
  inspector panel.
- **Share the existing bar.** The group after the drawing key tools is the only new chrome, and it
  **context-swaps** on what is selected.
- **Animate cannot live only on “property row selected.”** Animate creates that row. The start
  buttons belong on the owner (layer) selection.
- **Value authors stay.** A gizmo drag still writes a transform key; the opacity slider still
  writes an opacity key. Only the tools move.
- **Do not switch the tool** when starting or focusing a track. A brush user who starts a fade
  stays on the brush. Same rule as clicking a property row today.

## Selection

Today a property row has no selection of its own. Clicking it calls `setActiveLayer` and, for a
transform row, sets the gizmo scope. The layer and every one of its tracks light up together.
`activeRow` is `{ kind: "layer"; id } | { kind: "audio" }`. The bar cannot tell “you clicked the
layer” from “you clicked Opacity.”

### Extend `activeRow`, do not add a parallel field

Combining `activeRow` with a second flag is how this file has already shipped a forgotten term
twice (the audio-lane highlight, then the layer-panel disagreement). One union, one writer pair
(`setActiveLayer` / `selectAudioLane` / a new `selectTrack`), every view asks through accessors.

```ts
type ActiveRow =
  | { kind: "layer"; id: number }
  | { kind: "audio" }
  | { kind: "track"; owner: "layer"; id: number; prop: "transform" | "opacity" }
  | { kind: "track"; owner: "group"; id: number; prop: "transform" };
```

| Click | `activeRow` | Also |
|---|---|---|
| Layer name | `{ kind: "layer"; id }` | `activeLayerId = id`. Track focus clears. |
| Layer transform / opacity row, or a key on it | `{ kind: "track"; owner: "layer"; id; prop }` | `activeLayerId = id`. Transform row still sets `transformScope = "layer"`. |
| Group transform row, or a key on it | `{ kind: "track"; owner: "group"; id; prop: "transform" }` | Scope = `"group"`. If the group has a draw member, that member becomes `activeLayerId` (same as today’s `groupTrackSpec.select`). An all-ref group leaves `activeLayerId` alone. |
| Audio lane | `{ kind: "audio" }` | `activeLayerId` survives. |

The **group header stays a collapse toggle**, not a new `activeRow` case. Animate group is offered
from a member layer (see Bar).

`activeLayerId` remains the draw target. It survives selecting audio, a group track, or a
sibling’s track. No view may combine `activeRow` with `activeLayerId` to decide highlight or
enablement — ask `isRowSelected` / `isTrackSelected` / `isAudioRowSelected`.

### Highlight

The owner layer stays lit whenever it or one of its tracks is selected. Only the **focused**
property row lights with it. Sibling tracks of the same layer stay quiet, so the bar’s tools and
the lit row agree.

When the layer itself is selected (no track focus), the layer row is lit and its property rows
are not — they are available to click, not claimed as the current tool target.

## Bar

Drawing tools stay put in every state. The group after them (a divider, then the animation
controls) is the only thing that swaps.

| Selection | Animation group |
|---|---|
| Layer, some properties not yet animated | `Animate transform` · `Animate opacity` · `Animate group` if the layer is in a group. Omit any property that already has a track. |
| Layer, every applicable property already animated | Empty. The rows are there to click. |
| Layer transform / opacity / group-transform row | Ease · Step · Delete key · Stop · Copy/Paste **only** on a **layer** transform track |
| Audio lane | Empty. Trim stays where it is. |

`TrackKeyControls` is rendered only from this bar. Same actions, restyled to the bar’s `toolBtn`
icons so they sit with Add-frame / Insert-key instead of as a row of text labels. The bar already
`flex-wrap`s; icon buttons wrap the way the drawing tools do.

Copy/Paste stay **layer-transform only**. The clipboard holds a layer-relative `TransformKey`.
Pasting one onto a group is still a separate design, not opened here.

## After Animate

The button creates the track the same way it does now: current value becomes the key at frame 0,
the property row appears, the owner unfolds (`tracksCollapsed = false` on a layer; `collapsed =
false` on a group) so the row is visible. Then:

1. **Focus the new track.** `activeRow` becomes the matching `{ kind: "track", … }`, so the bar
   swaps immediately to Ease / Step / Delete / Stop. The artist does not have to click the new row.
2. **Do not switch the tool.**
3. **Do aim the gizmo for next time.** Animate layer transform sets `transformScope = "layer"`.
   Animate group sets `transformScope = "group"` and, if there is a draw member, selects it as
   the draw target — same as clicking the group-transform row today. Animate opacity does not
   touch scope.

Stop still bakes the on-screen value into the static field and drops the track. After Stop,
`activeRow` becomes `{ kind: "layer"; id: activeLayerId }` — the current draw target, which for
a layer-owned track *is* the owner, and for a group-owned track is the draw member Animate/select
already pointed at (or whoever it was, for an all-ref group). The Animate button for that
property then comes back.

### Stale track focus

A track-focused `activeRow` is session state. If the focused track disappears (Stop, undo of
Animate, delete the layer, ungroup the only member), fall back to
`{ kind: "layer"; id: activeLayerId }` rather than leave a ref to a missing track. Unrelated
undos must **not** clear track focus — same rule as audio-lane selection, which
`restoreStructure` already leaves alone when a layer row is not what is selected.

## What leaves the other surfaces

### ToolOptions

Comes off: both Animate / Stop pairs (layer and group) and the `TrackKeyControls` strip.

Stays: Frame / Layer / Group (what a **canvas drag** writes) and Reset to fit (still with the
gizmo, still available for a reference under any tool).

The Transform tool is a manipulator again. Starting and editing a track is not gated on it.

`animateTargetLayer` / `animateTargetGroup` stay. The status bar still uses them so the idle line
can say “a drag keys frame N” when the gizmo will auto-key. That hint is about the drag, not about
the buttons that moved.

### Layer list

Comes off the active row’s detail strip: opacity Animate / Stop and `TrackKeyControls`.

Stays: the opacity slider and readout. On an animated layer it still keys the playhead frame; the
title still says so. A locked or hidden layer still makes an animated slider inert.

Row 2 returns to slider + boil + the video controls, without a wrapping second line of key
chrome.

No leftover “tools are on the timeline” caption in either host. The property row is the signal.

## Refusals

Same policy as the rest of the timeline bar: **`aria-disabled` + a title**, never a silent no-op
and never a vanishing button that was the only explanation. A `disabled` button dispatches no
pointer events, so the status-bar hint cannot read it.

| Control | Dimmed when |
|---|---|
| Animate transform / opacity | Layer locked or hidden (group-derived). Title says which. |
| Animate group | Group has a locked member. If the layer is not in a group the button is **omitted**, not dimmed. |
| Delete key / Ease / Step / Stop / Copy / Paste | Track’s owner is locked. Hidden groups stay allowed (today’s lock-only group rule: a hidden group is still draggable). Delete key also dims on “no key on this frame” and “this is the only key — use Stop.” |
| Paste | Also dims when the clipboard is empty, or the destination has no transform track (paste still must not silently start an animation). |

Reference layers get Animate transform and Animate opacity without switching to the Transform
tool — their gizmo is already live. A ref outside its visible span still cannot be
transform-animated (nothing on screen to key), matching the gizmo and `animateTargetLayer`.

## Non-goals

- A dedicated inspector / third column / second timeline view.
- Selecting the group header. Animate group hangs off a member layer.
- Copy/paste of a key across property types, or onto a group.
- Changing how keys are drawn or retimed on the property rows.
- Changing auto-key on a gizmo drag or on the opacity slider.
- Switching the current tool as a side effect of Animate or of focusing a track.
- Numeric transform fields, a curve editor, motion-path display.

## Testing

Pure and required:

- `activeRow` accessors: `isRowSelected` / `isTrackSelected` / `isAudioRowSelected` do not
  consult `activeLayerId`. A layer selected via its track still reports the layer as selected
  for highlight of the **owner** row; sibling tracks do not.
- `setActiveLayer` clears track focus. `selectTrack` sets it and updates `activeLayerId` only
  for a layer-owned track (group-owned follows the draw-member rule above).
- The bar’s visible set is a pure function of `activeRow` + which tracks exist + whether the
  layer is grouped. Unit-test that function: layer with nothing animated, layer with one of two
  tracks, layer with both, grouped layer, track-focused each property, audio, locked, hidden,
  ref outside its span.

DOM / review-only, per project convention: the ToolOptions and LayerList removals, the icon
restyle, Animate-then-bar-swaps, Stop-returns-to-layer, iPad wrap, status-hint titles on
`aria-disabled` buttons.

## Migration

None. `activeRow` is session state, not persisted. Existing projects and the save format are
untouched. The only behaviour change is where the tools are and which row counts as selected
when you click a property track.
