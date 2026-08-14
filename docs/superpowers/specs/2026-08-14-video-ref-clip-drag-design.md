# Video-ref clip drag (audio-clone) — design

**Date:** 2026-08-14
**Status:** Approved (2026-08-14)
**Builds on:** audio P2 drag-offset (`2026-08-09-audio-phase2-design.md`), per-video speed
(`2026-07-12-video-reference-speed-design.md`), timeline iPad pointer rule
(`2026-08-14-timeline-ipad-ux-design.md`).

## Goal

A linked video reference occupies a visible, draggable clip on its timeline row — the same
gesture as the audio waveform — so you can see where it starts and ends and slide it. No
filmstrip. The layer-panel offset number goes away; speed stays.

## Requirements (user-confirmed)

1. **Audio clone, not compositor clone.** Colored clip block, drag to slide. No edge-trim, no
   thumbnails (ffmpeg filmstrips belong in slop-video-compositor, not this browser app).
2. **No numeric offset.** The block is the writer. Speed multiplier stays on the layer row.
3. **Visible clip bounds** on both the video block *and* the audio waveform (a background fill so
   start/end read as a rectangle, not a grey scribble).
4. **Missing / unlinked media** is a call to action, not a type label: show **re-link**, not
   `ref`. No block (no duration). Tap selects the layer; re-link stays the existing Row 2 Link
   button. Image refs are not broken — they stay a type label, no block.

## Non-goals

Filmstrip / WebCodecs thumbs; in/out trim handles; undo for offset (matches audio); changing
`offsetFrames` persistence or the playback formula; image-ref blocks; lock pinning timing (the
number field never did); a second file picker on the timeline row.

## Playback math (unchanged)

`videoTime = (offsetFrames + frame × speed) / fps`, clamped to `[0, duration]`.

Audio offset is a *timeline start*. Video offset is an *in-point*. They are inverted:

| | Audio | Video |
|---|---|---|
| Clip left edge (timeline frames) | `offsetFrames` | `−offsetFrames / speed` |
| Drag right by `Δ` frames | `offset += Δ` | `offset -= Δ × speed` |

Old projects load unchanged. The drag mapping absorbs the inversion so the gesture feels like
audio.

## Layout helper (pure)

`src/anim/clip-layout.ts` (or next to `audioFrameSpan` in `peaks.ts` — prefer a new file so
reference layout does not live in the audio module):

```ts
videoClipLayout(offsetFrames, speed, durationSec, fps) → { startFrame, spanFrames }
```

- `startFrame = Math.round(−offsetFrames / speed)` — snap the **visible** start to a whole frame.
- `spanFrames = Math.max(0, Math.ceil(durationSec * fps / speed))` — same ceil as `audioFrameSpan`,
  divided by speed.
- Inverse for a drag: `offsetFrames = −(startFrame + Δ) * speed`.

`speed <= 0` is treated as `1` (the layer input already mins at 0.1). Non-finite `durationSec` →
caller does not draw a block.

Unit-test start/span/drag for offset 0, positive in-point, start-after-0 (negative offset), and
speed ≠ 1.

## Timeline UI

### Linked video (`media.type === "video"` and finite `duration > 0`)

Replace the `ref` text on that row with a clip block:

- `margin-left: startFrame * cellW`, `width: spanFrames * cellW`.
- Filled background + border (`bg-surface-active` / `border-border`) so both edges read.
- Truncated layer name inside the block.
- `touch-action: none`, pointer capture.
- **Pencil / mouse:** drag → live `offsetFrames` + `bump()`. Not undoable.
- **Finger:** pan the scroller only (same `onTouchDown` / `onTouchMove` path as `AudioLane`).
- Head before frame 0 tucks under the sticky gutter (negative margin). Tail past
  `frameCount` stays drawn and is **dimmed** (audio already does this).

Duration is available once import's `loadedmetadata` resolves. No extra decode.

### Missing media (`media.type === "missing"`)

No block. Label **re-link** in `text-text-muted`. `title=` “Media missing — re-link from the
layer panel.” Pointer on the label selects the layer (existing name-button behavior). Do **not**
open a file picker from the grid (palm / Pencil rule).

### Image ref, or video with unknown duration

No block. Type label (`image` / `video`), not `ref`. Not a call to action.

## Audio waveform

Keep the drag/width/offset behavior. Fill the clip canvas with the same clip background *under*
the peaks so the rectangle is the bound. Dim-past-document-end stays.

## Layer list

Delete the video **offset** number input. Keep **speed** (and audio / embed / re-link).

## Lock

A locked (or group-locked) ref still accepts clip drag. Lock protects canvas transform, not
timing.

## Testing & verification

Pure `videoClipLayout` is unit-tested. Gestures are build + review (DOM, like AudioLane).

**Owed a browser pass:** drag a linked video (incl. negative start and speed ≠ 1); block width
tracks speed; missing row says re-link and selecting it shows the Link button; image row has no
block; audio clip bounds read as a rectangle; finger pans, Pencil slides; save/reload keeps the
offset.