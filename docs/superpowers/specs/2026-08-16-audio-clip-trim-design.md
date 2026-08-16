# Audio clip trim — design

**Date:** 2026-08-16
**Status:** Proposed
**Builds on:** audio P2 drag-offset/mute (`2026-08-09-audio-phase2-design.md`), audio P3 export
muxing (`2026-08-11-audio-phase3-export-muxing-design.md`), reference layer visibility ranges
(`2026-08-15-reference-layer-ranges-design.md` — the trim gesture and its pure math come from there).

## Goal

Trim the head and tail of the project's audio clip by dragging its ends on the audio lane, so a long
take can be cut down to the shot without re-importing. One clip, one buffer — this is trimming, not
editing.

## Why this is small

The primitives already take the parameters:

- **Playback:** `AudioBufferSourceNode.start(when, offset, duration)`. The engine already passes
  `offset` (that is how the drag works); trimming adds `duration` and shifts the in-point.
- **Export:** `AudioExportPlan` already carries `sourceOffset` and `windowS`, and `buildExportAudio`
  renders through an `OfflineAudioContext` where the identical `start()` overload applies.
- **Gesture:** `rangeAfterTrim` (`clip-layout.ts`) is written, unit-tested and already drives the
  reference clip's edge handles.
- **Waveform dimming:** the lane already draws a dimmed region for audio past the last frame.

## Requirements (user-confirmed)

1. **Trim the head and tail of one clip.** No splitting, no second clip.
2. **The trimmed-away audio stays visible, dimmed**, outside the clip's solid body — so you can see
   what was cut and drag the handle back to recover it. Same treatment the lane already uses for
   audio past the last frame.

## Non-goals

Splitting one source into several clips (a `AudioTrack | null` → list change reaching the engine's
single `source`/`track`, export mixing, the lane, scrub, mute and the undo snapshot); fades or gain
envelopes; multiple audio tracks; time-stretch; destructive trimming of the stored `bytes`;
waveform zoom; snapping the handles to anything but whole frames.

## Model

`src/anim/document.ts`:

```ts
export interface AudioTrack {
  // …existing fields…
  /** Frames of the SOURCE skipped at the head. 0 = from the start. */
  trimInFrames?: number;
  /** Frames of the SOURCE kept from `trimInFrames`. Absent = to the end of the buffer. */
  trimLenFrames?: number;
}
```

**Frames, not seconds**, matching `offsetFrames`: the handles snap to frames, the lane is a frame
grid, and the existing offset is already denominated this way. It inherits the same fps-change
behaviour `offsetFrames` has (a clip's position and length in *seconds* shift if fps changes) — not a
new problem, and not one this feature should solve unilaterally.

**Both optional, absent = untrimmed**, exactly like `ReferenceLayer.range`: an old project loads
playing the whole buffer, and format version stays 1.

### Trim semantics

Dragging an edge changes what the clip *reveals*, never where the kept audio sits in project time.
Clip at `offsetFrames` 10 playing source 0…90:

| gesture | result |
|---|---|
| drag left edge right to frame 20 | clip occupies 20…100, source 10…90. **The audio that was at frame 20 is still at frame 20.** |
| drag right edge left to frame 80 | clip occupies 10…80, source 0…70. Head untouched. |

That is the standard editor behaviour and the only one that does not silently re-sync the audio
against the animation — the reason to trim is usually that the sync is already right.

Implementation consequence: a head trim must move `offsetFrames` and `trimInFrames` **together, by
the same delta**, so the two changes cancel in project time. A tail trim touches only
`trimLenFrames`.

### Clamps

`trimInFrames >= 0`; `trimInFrames + trimLenFrames <= ceil(buffer.duration * fps)`; minimum length 1
frame. Dragging an edge back out past the source's extent stops at the extent rather than extending
into silence.

## Playback

**Keep two coordinate systems apart, or the silence boundary goes wrong.** `audioPlayPlan` reasons in
**kept-span time** (0 = the first kept sample); `start()` needs **buffer time** (0 = the first sample
of the file). The in-point is the conversion between them and must be added *only* at the `start()`
call — folding it into `at` while leaving `duration` as the trimmed length compares the two systems
against each other and cuts the clip short by the in-point.

So `bufferOffsetForFrame(frame, offsetFrames, fps)` is unchanged and already yields kept-span time,
because a head trim moves `offsetFrames` with `trimInFrames`:

```ts
const inS  = trimInFrames / fps;                                  // buffer time of the first kept sample
const lenS = trimLenFrames != null ? trimLenFrames / fps          // kept length
                                   : buffer.duration - inS;
const at   = bufferOffsetForFrame(frame, offsetFrames, fps);      // kept-span time, signed
const plan = audioPlayPlan(at, lenS);                             // existing at >= duration → silence
```

`audioPlayPlan` needs **no change at all**: passing `lenS` instead of `buffer.duration` makes its
existing guard cover the trimmed tail. Only the engine changes, adding `inS` and a duration:

```ts
// kind "offset": already inside the kept span — start there, play what is left of it.
src.start(0, plan.offsetS + inS, lenS - plan.offsetS);
// kind "delay": clip begins in the future — start at the in-point, play the whole kept span.
src.start(ctx.currentTime + plan.delayS, inS, lenS);
```

Neither pure helper gains a parameter; both keep their existing tests, and new cases only assert that
a smaller `duration` argument moves the silence boundary as expected.

`scrub()` gets the same in-point shift and must refuse a scrub outside the trimmed span — it already
refuses outside the buffer, so this is the same check against different bounds.

## Export

`AudioExportPlan` gains one field:

```ts
/** Seconds of source to play from `sourceOffset`, so the trimmed tail is not rendered. */
sourceDuration: number;
```

`audioExportPlan` computes it from the trim and the window; `buildExportAudio` passes it as
`start()`'s third argument inside the `OfflineAudioContext`. **No new render pass** — placement,
truncation, resampling and now trimming remain one render. The existing null cases are unchanged, and
one is extended: a clip whose *trimmed* span falls entirely outside the export window returns null,
so the file carries no audio track rather than a silent one.

## Persistence

Two optional numbers on the audio JSON, alongside `offsetFrames`/`muted`. Version stays 1. The
encoded `bytes` are **never** modified — trimming is non-destructive, so re-widening a handle after a
save-and-reload recovers the audio.

## Undo

Trim is undoable, one entry per completed gesture, via `beginStructuralEdit`/`commitStructuralEdit`
with `transformDragGuard.settle` registered — the shape the lane's offset drag already uses.

**This is not optional.** `StructSnapshot` captures the audio track by reference plus `offsetFrames`
and `muted` as separate scalars, precisely because those are written in place on the shared object.
`trimInFrames`/`trimLenFrames` are written in place too, so they must join as scalars
(`audioTrimInFrames`, `audioTrimLenFrames`) and their writer must push a command. Adding the fields
without bracketing the writer reproduces the exact bug fixed on 2026-08-15, where an unrelated
structural undo silently reverted a non-undoable audio write.

A head trim writes `offsetFrames` **and** `trimInFrames`; both are already captured, so one bracket
covers the pair.

## Lane UI

The waveform canvas keeps drawing the **whole** buffer at its current position. Trimming changes
which part is solid:

- **Kept span** — the current plate, border and full-contrast peaks.
- **Trimmed head/tail** — `--color-media-clip-dim` plate with peaks at the same `0.25` alpha the
  past-the-last-frame tail already uses. Reuses that code path rather than adding a second dimming
  rule.
- **Edge handles** — two 8px hit strips at the kept span's ends, `touch-action: none` and a bound
  `pointercancel`, matching the reference clip's handles. Finger pans, pen/mouse trims, per the
  app-wide rule.

The clip's draggable body still slides `offsetFrames` and is unchanged. Where a body drag and a
handle drag could both claim a press, the handle wins — the reference clip resolves this by checking
its drag state first rather than `stopPropagation`, which would suppress the status-hint listener.

## Testing

Pure and node-testable, so unit-tested: `audioPlayPlan` against a trimmed `duration` (silence exactly
at the trimmed tail, audible one frame before it, the delay branch unaffected by a head trim);
`audioExportPlan` (`sourceDuration` with and without trim, a trimmed span outside the window,
existing cases unchanged); and the clamp helper (in ≥ 0, out ≤ extent, 1-frame minimum,
drag-back-out stops at the extent).

One test earns its place beyond the obvious: **a head trim must not shorten the clip**. Assert that
after moving `offsetFrames` and `trimInFrames` by the same delta, the audible span in project frames
starts where the handle was dropped and still ends where it did before. That is the property the
two-coordinate-system bug above would have broken, and it is invisible in any single-value check.

The engine's `start()` arity, the lane rendering and the drag lifecycle are DOM-coupled and are
build + review verified, per project convention.

## Owed a browser pass

Trim head and tail and hear the result match the waveform; a head trim leaves the kept audio at the
same project frame (the sync-preserving property — the one worth checking first); drag a handle back
out and recover the audio; trim → undo → redo; ⌘Z mid-drag; trimmed clip exports with exactly the
kept span; a trim that puts the clip entirely outside the window exports with no audio track and
still succeeds; scrub inside and outside the trimmed span; mute interaction unchanged; save → reload
preserves the trim and the bytes; an old project opens untrimmed; iPad for the handles.
