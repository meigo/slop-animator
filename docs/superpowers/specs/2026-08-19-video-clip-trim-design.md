# Video clip source trim — design

**Date:** 2026-08-19
**Status:** Implemented (2026-08-19)
**Builds on:** video-ref clip drag (`2026-08-14-video-ref-clip-drag-design.md`), audio clip trim
(`2026-08-16-audio-clip-trim-design.md`), reference layer visibility ranges
(`2026-08-15-reference-layer-ranges-design.md`).

## Goal

Trim the head and tail of a video reference on its timeline clip so a long take can be cut to the
shot without precutting the file outside the app. Same idea as audio trim; the math is not the same
function because video's offset convention is inverted.

Also in this change: **no reference layer can be property-animated**. Image refs already could not;
video refs lose Animate too. They are guides (place + trim), not keyed plates.

## Requirements (user-confirmed)

1. Copy audio's optional `trimInFrames` / `trimLenFrames` (source frames). Absent = untrimmed.
2. Edge handles on the video clip; dimmed pads for the trimmed-away source.
3. Head trim keeps the kept picture on the same project frames (do not re-sync).
4. Tail trim shortens; minimum 1 source frame.
5. Trim-to-playhead when the video row is selected.
6. Undoable (one entry per completed handle gesture). Body slide stays as it was (not undoable).
7. Format version stays 1. Old projects open untrimmed.
8. References still do not render in export.

## Non-goals

Splitting one file into several clips; destructive trim of stored bytes; filmstrip; per-layer
export of the video; property animation on refs.

## Model

`ReferenceLayer` gains the same optional pair as `AudioTrack`. Images ignore them. A video's
visible span stays **derived** (`refVisibleSpan` → `videoClipLayout` with the trim): there is
still one span, now the kept footage rather than the whole file.

## Head-trim math

Audio `startFrame` **is** `offsetFrames`, so `trimHead` moves `offset` and `trimIn` by the same
delta. Video `startFrame = round(-offset / speed)`, so a drag of Δ **project** frames must move
them opposite, scaled by speed:

```
offset  -= Δ · speed
trimIn  += Δ · speed
trimLen -= Δ · speed
```

The source delta is clamped as **one number** so the two fields cannot be clamped apart and
break the sync-preserving invariant (`trimVideoHead` in `clip-layout.ts`).

Seek adds `trimIn` only at the wanted-time calculation (`videoWantedTime`), never by folding it
into `offset` — the same two-clock rule audio documented. `syncReferenceVideos` calls that
helper; `isRefVisibleAtFrame` already skips-and-pauses outside the (now kept) span.

## Undo

Writes are in-place on the shared layer object. `cloneLayers` already spreads primitives, so
the snapshot holds grab-time values. `restoreStructure` assigns `trimInFrames` / `trimLenFrames`
unconditionally (including `undefined`) the same way it restores `offsetFrames`. A first trim
that is then undone must **clear** the fields, not leave an explicit 0/extent.

## Origin of the dimmed pad

Audio's buffer-0 origin is `offset - trimIn` (offset moves **up** on a head trim). Video offset
moves **down**, so the full-file origin is `offset + trimIn` (`videoClipOriginOffset`). Using
the audio subtraction here puts source frame 0 in the wrong place and makes the head handle
travel at the wrong rate.
