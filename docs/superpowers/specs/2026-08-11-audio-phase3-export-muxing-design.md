# Audio Phase 3 — Export Muxing — Design

**Status:** Approved (2026-08-11)
**Date:** 2026-08-11
**Builds on:** `2026-06-15-audio-track-phase1-design.md` (import/waveform/synced playback; pre-landed
`offsetFrames`/`muted` in the model + save format) and `2026-08-09-audio-phase2-design.md` (scrub,
drag-offset, mute). Both deferred export muxing to this phase. No model or save-format change here —
Phase 3 is export-only.

## Requirements (user-confirmed)

1. The project audio track is muxed into the **MP4 and WebM** video exports, aligned to the same
   `offsetFrames` position it plays at in the app.
2. **Project track only.** Video-reference soundtracks (`ReferenceLayer.audioEnabled`) stay
   preview-only, as the 2026-07-14 spec's non-goals already state.
3. **Muted means silent.** A muted track produces a file with no audio track at all — what you hear
   is what you get.
4. **Degrade, don't fail.** If the browser cannot encode the container's audio codec, the export
   still produces the video, without audio, and says so.

## Design

### Alignment core (`src/export/audio-mix.ts`)

Export duration is `frameCount / fps`. The clip must sit at its `offsetFrames` position within that
window, so the export reuses the playback rule rather than restating it:
`bufferOffsetForFrame(0, offsetFrames, fps)` (`src/audio/peaks.ts`) gives the signed buffer time at
frame 0 — positive = start that far into the buffer, negative = the clip begins that many seconds
after the video does. This is exactly the branch `AudioEngine.play` takes, which is the point:
export alignment and playback alignment cannot drift apart.

`audioExportPlan({ offsetFrames, fps, frameCount, bufferDuration })` is the **pure** part and returns:

- `durationS` — the export window, `frameCount / fps`
- `startAt` — seconds into the window where the clip begins (0 when the clip starts at or before
  frame 0)
- `sourceOffset` — seconds into the source buffer to start from (0 when the clip starts after frame 0)
- `overlaps` — false when the clip lies entirely outside the window in either direction

At most one of `startAt` / `sourceOffset` is non-zero (both are 0 at `offsetFrames === 0`), mirroring
the engine's two branches.

`buildExportAudio(track, fps, frameCount): Promise<AudioBuffer | null>` applies the plan with an
`OfflineAudioContext(channels, Math.ceil(durationS * 48000), 48000)`: a single `AudioBufferSourceNode` started
per the plan, rendered once. That one call does placement, truncation at the window end, and
**resampling to 48 kHz** (accepted by both AAC and Opus, so a 44.1 kHz import needs no special
case). Channels = `min(buffer.numberOfChannels, 2)`. Returns `null` when there is no track, the
track is muted, or `overlaps` is false — an audio track is omitted, never written as silence.

### Muxing (`src/export/video.ts`)

Before `output.start()`: if `buildExportAudio` returns a buffer, pick the codec for the container
(`aac` for MP4, `opus` for WebM) and confirm the browser can encode it with mediabunny's
`getFirstEncodableAudioCodec`. On success, `output.addAudioTrack(new AudioBufferSource({ codec,
bitrate: QUALITY_HIGH }))` and `await source.add(buffer)` — mediabunny places the first buffer at
timestamp 0, which is why the buffer is pre-padded to the full window rather than offset at add-time.
The per-frame video loop is unchanged.

`exportVideo` returns `{ blob, warning?: string }` instead of a bare `Blob` (one call site). The
warning carries the degrade case: codec unsupported, or the audio encode threw. **Audio never aborts
a video export** — a multi-minute render must not be lost to a missing encoder.

**No `@mediabunny/aac-encoder` dependency.** Every browser that has the WebCodecs `VideoEncoder` this
export already requires also encodes AAC natively, so the polyfill would be dead weight; the warning
path covers the theoretical gap.

### UI (`src/lib/ExportDialog.svelte`)

**No new control.** A track that exists and is not muted is included; mute is already the control for
excluding it, and a checkbox would be a second, silently-conflicting one. The only change is that
`run()` surfaces the returned warning: `status = "Done."` becomes `"Done — exported without audio
(no AAC encoder)."` when one comes back. PNG-sequence export is untouched.

## Out of scope

Reference-video soundtracks in the export (per requirement 2); per-track volume; multiple audio
tracks; exporting only the In/Out range (video export already always covers frame 0 → `frameCount`,
unchanged here); audio in the PNG-sequence export.

## Testing & verification

`audioExportPlan` is unit-tested (node): no track, muted, zero offset, positive offset (silence
head), negative offset (starts inside the buffer), clip shorter than the animation, clip longer than
the animation (truncated), clip entirely past the end, clip entirely before frame 0.
`buildExportAudio` and the mux itself use `AudioBuffer`/`OfflineAudioContext`/WebCodecs, none of
which exist in the node test env — build + review gates, per project convention.

**Browser pass owed:** MP4 and WebM both carry audio and stay in sync; a non-zero positive offset
lands the clip late by the right amount; a negative offset starts mid-clip; a muted track exports
silent; an audio clip longer than the animation is cut at the end; a clip dragged entirely past the
end exports with no audio track; PNG export still works; iPad (Safari WebCodecs) for at least the
MP4 path.
