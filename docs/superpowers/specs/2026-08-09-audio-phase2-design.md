# Audio Phase 2 — Scrub, Drag-Offset, Mute — Design

**Status:** Approved (2026-08-09)
**Date:** 2026-08-09
**Builds on:** `2026-06-15-audio-track-phase1-design.md` (P1 shipped import/waveform/synced playback
and deliberately pre-landed `offsetFrames`/`muted` in the model + save format, so P2 is UI/engine
only — zero migration).

## Requirements (user-confirmed)

1. **Scrub audio:** a ~100 ms snippet at the playhead position on every paused playhead move —
   ruler drag AND single-frame stepping (keyboard arrows, prev/next buttons, ruler keys).
2. **Drag-to-offset:** drag the waveform along its lane to set `offsetFrames`; snaps to whole
   frames; **negative offsets allowed** (clip starts before frame 0).
3. **Mute toggle:** in the audio lane label, beside Remove.

## Design

### Engine (`src/audio/engine.ts`)

- `scrub(frame, fps)`: no-op if no track, muted, or a playback source is live. Otherwise stop any
  previous scrub source, start a new one at `bufferOffsetForFrame(frame, offsetFrames, fps)`, and
  schedule `src.stop(ctx.currentTime + 0.1)`. Restart-per-call self-coalesces fast drags.
- `play()` refuses when `track.muted` (defense; the action layer also stops/starts explicitly).
- Distinguish the playback source from a scrub source so `syncTo` (which re-plays only "if
  currently playing") is not fooled by a live scrub window.

### Seek routing (`appState`)

- New action `seekPlayhead(f)`: clamps + sets `state.playhead`, and when NOT playing calls
  `audioEngine.scrub(f, fps)`. All paused playhead-move call sites route through it (ruler
  drag/keys in Timeline, prev/next buttons, keyboard frame stepping). The playback tick is
  untouched.

### Offset drag (`AudioLane.svelte`)

- The waveform canvas gets `touch-action: none` (gotcha #10), pointer capture, and drag handlers:
  `Δframes = Math.round(dx / cellW)` applied live as `audio.offsetFrames = startOffset + Δframes`
  + `bump()`. The lane renders `margin-left: offsetFrames * cellW` on the canvas so the clip
  slides under the ruler. Negative margin = clip head hidden under the sticky label — accepted.
- On release while playing: one `audioEngine.syncTo(playhead, fps)` re-aligns.

### Mute (`AudioLane.svelte` + `appState`)

- `toggleAudioMute()`: flip `track.muted`, `bump()`; if playing → muted ? `engine.stop()` :
  `engine.play(playhead, fps)`. Lane button uses `Volume2`/`VolumeX`, `title=` feeds the status
  bar.

## Out of scope

Undo for offset/mute (audio is not in `StructSnapshot`; P1's set/remove-track are likewise not
undoable); per-track volume; scrub-window visualization; export muxing (Phase 3); persistence work
(P1 already round-trips both fields).

## Testing & verification

Frame↔buffer-offset math is P1-unit-tested; new pure logic ≈ nil → build + review gates.
**Browser pass owed:** scrub audible on ruler drag and on frame stepping; silent while playing and
when muted; offset drag snaps to frames, goes negative, survives save/reload; drag on iPad
(touch-action); mute toggle mid-playback both directions; unmute while playing resumes in sync.
