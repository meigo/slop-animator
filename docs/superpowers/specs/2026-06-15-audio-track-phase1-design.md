# Audio Track — Phase 1 Design

**Status:** Approved (design phase)
**Date:** 2026-06-15
**Feature:** Audio track (synced soundtrack). This is **Phase 1 of 3**; Phase 2 (scrub, drag-to-offset,
mute) and Phase 3 (export muxing) are specced separately after Phase 1 lands.

## Goal

Import a single audio file, see its waveform in the timeline (anchored at frame 0), hear it play in
sync during playback, and have it save/load with the project.

## Overall vision (context for Phase 1)

The full feature: a single synced soundtrack — positionable offset, audio scrubbing, waveform,
mute, persisted in the project, and muxed into the MP4/WebM export. It is built on one decoded Web
Audio `AudioBuffer` that drives the waveform, scrubbing, preview, and export. The full design was
agreed; this document specs only the Phase 1 cut below.

## Phase 1 scope

In scope:
- Data model: `AudioTrack` + `Project.audio: AudioTrack | null` (fields include `offsetFrames` and
  `muted`, so later phases add only UI, no persistence migration).
- Decode: `loadAudioTrack(file)` and `decodeAudioBytes(bytes)` in `src/audio/decode.ts`.
- Import (replace) + remove via the Toolbar and store actions.
- Persistence: audio bytes in the zip + metadata in `project.json`; re-decode on load.
- Waveform: a pure `computePeaks` helper + a frame-aligned timeline lane that renders it.
- Synced play/pause via an `AudioEngine`, including loop re-sync.

Out of scope (later phases):
- **Offset is fixed at 0** (the field exists and persists; drag-to-reposition is Phase 2).
- **Mute** (field exists, default false; the toggle UI is Phase 2).
- **Scrub audio** while dragging the playhead (Phase 2).
- **Export muxing** (Phase 3).
- Multiple tracks, volume/fades, audio trimming, negative offset, waveform zoom (not planned).

## Decisions

1. **One decoded `AudioBuffer` is the substrate** (Web Audio). Phase 1 uses it for the waveform and
   preview playback; later phases reuse it for scrub and export.
2. **Frames stay master.** The existing `Playback` drives `state.playhead`; the `AudioEngine` follows
   — it (re)starts the audio in sync when playback **starts** and on each **loop wrap**, and stops on
   pause. Within a single linear pass the audio free-runs on the audio clock (sub-frame drift over
   short low-fps clips).
3. **Offset anchored at 0 in Phase 1.** `offsetFrames` is modelled and persisted but always 0 until
   Phase 2 adds the drag UI.
4. **Import/remove is not undoable.** Audio sits outside the structural-undo snapshot (which covers
   layers/cells/frameCount/size/playhead). Setting/clearing `project.audio` is a direct mutation +
   `bump()` (a deliberate Phase 1 simplification; revisit only if needed).
5. **Persistence stores the original encoded bytes**, not PCM — small files, and `decodeAudioData`
   rebuilds the buffer on load. No codec/format conversion at save time.

## Data model

```ts
// src/anim/document.ts
export interface AudioTrack {
  name: string;          // file name (display)
  bytes: Uint8Array;     // original encoded file → persisted
  buffer: AudioBuffer;   // decoded PCM → session-only, rebuilt on load
  offsetFrames: number;  // start frame (Phase 1: always 0)
  muted: boolean;        // Phase 1: always false
}
// Project gains:  audio: AudioTrack | null
```
`createProject` sets `audio: null`.

## Components & data flow

### `src/audio/decode.ts` (new)

```ts
/** Decode raw encoded audio bytes to an AudioBuffer via a shared (lazy) AudioContext. */
export function decodeAudioBytes(bytes: Uint8Array): Promise<AudioBuffer>;

/** Read a File, decode it, and build an AudioTrack (offsetFrames 0, muted false). */
export function loadAudioTrack(file: File): Promise<AudioTrack>;
```
`decodeAudioBytes` uses a module-singleton `AudioContext` (created lazily) and
`ctx.decodeAudioData(bytes.buffer.slice(...))`. `loadAudioTrack` reads the File's `ArrayBuffer`, keeps
the bytes for persistence, decodes, and returns the track.

### `src/audio/peaks.ts` (new, pure — Node-testable)

```ts
/** Downsample one channel to `columns` peak amplitudes in [0,1] (max |sample| per bucket). */
export function computePeaks(channel: Float32Array, columns: number): number[];

/** Number of frame columns the audio occupies at `fps`. */
export function audioFrameSpan(durationSec: number, fps: number): number; // ceil(durationSec * fps)

/** Buffer time (seconds) the audio should be at for animation `frame`; clamped ≥ 0. */
export function bufferOffsetForFrame(frame: number, offsetFrames: number, fps: number): number;
// Math.max(0, (frame - offsetFrames) / fps)
```

### `src/audio/engine.ts` (new)

A module-singleton `AudioEngine` over the shared `AudioContext`:
- `play(frame, fps)` — `ctx.resume()`, create an `AudioBufferSourceNode` from `project.audio.buffer`,
  connect to destination, and `start(0, bufferOffsetForFrame(frame, offsetFrames, fps))`. Tracks the
  current source so it can be stopped/replaced.
- `pause()` / `stop()` — stop and discard the current source.
- `syncTo(frame, fps)` — stop + restart at the new position (used on loop wrap).
- `setTrack(track | null)` — drop any playing source when the track changes/clears.

(Mute/scrub methods are added in Phase 2.)

### `src/state/appState.svelte.ts`

- `state.project.audio` holds the track. Store actions:
  ```ts
  export function setAudioTrack(track: AudioTrack) { state.project.audio = track; audioEngine.setTrack(track); bump(); }
  export function removeAudioTrack() { state.project.audio = null; audioEngine.setTrack(null); bump(); }
  ```
- Wire the engine into playback through the existing `Playback` callbacks:
  - `onPlayingChange(p)`: also `p ? audioEngine.play(state.playhead, state.project.fps) : audioEngine.pause()`.
  - `setFrame(f)`: detect a loop wrap during playback (`state.playback.isPlaying && f < state.playhead`)
    and call `audioEngine.syncTo(f, state.project.fps)` after updating the playhead.

### Import — `src/lib/Toolbar.svelte` + `src/anim/reference.ts` pattern

- Extend the Toolbar file input: add `"audio"` to `pendingKind`, set `accept="audio/*"`, and in
  `onFile` call `setAudioTrack(await loadAudioTrack(file))`. Add an "Import audio" button.

### Timeline lane — `src/lib/Timeline.svelte` (or a small `AudioLane.svelte`)

- When `state.project.audio` is set, render a frame-aligned lane (sticky label gutter like the layer
  rows) just below the ruler. Draw the waveform on a `<canvas>` sized `frameCount*CELL_W` wide,
  starting at column `offsetFrames` (0 in Phase 1), spanning `audioFrameSpan(buffer.duration, fps)`
  columns, using `computePeaks`. Include the file name and a remove (✕) button calling
  `removeAudioTrack()`.

## Persistence

- `projectToJson`: add `audio: project.audio ? { name: project.audio.name, offsetFrames, muted } : null`.
- `saveProjectBlob`: if `project.audio`, add `files["audio/track"] = project.audio.bytes`.
- `loadProjectBlob`: if `json.audio` and the `audio/track` entry exist, `decodeAudioBytes(bytes)` →
  rebuild the `AudioTrack` (carry `name`/`offsetFrames`/`muted` from json, `bytes` from the zip).
  Missing audio → `null`. `ProjectJson` gains `audio: { name: string; offsetFrames: number; muted: boolean } | null`.
- `loadProjectBlob` is already `async` and returns a `Promise<Project>`, so the extra decode fits.

## Error handling

- Decode failure (unsupported/corrupt file) → `loadAudioTrack` rejects; the Toolbar shows the existing
  error path (same as a failed image/video import) and leaves any current track unchanged.
- A project zip whose `audio/track` bytes fail to decode on load → log and load the project with
  `audio: null` rather than failing the whole open.
- `AudioContext` requires a user gesture; `play()` calls `ctx.resume()` (the play button is a gesture).

## Testing

Vitest runs in **Node** (no Web Audio / `AudioContext` / `AudioBuffer`). Unit tests cover the pure
helpers only; decode, engine, import, lane, and sync are manual-verified.

**Unit (`src/__tests__/audio.test.ts`):**
- `computePeaks`: returns exactly `columns` values; each in `[0,1]`; a full-scale block → ~1; silence
  → 0; constant downsampling regardless of input length.
- `audioFrameSpan`: `ceil(duration*fps)` (e.g. 2.0s@12 → 24; 2.01s@12 → 25); floors at 0 for 0 duration.
- `bufferOffsetForFrame`: `(frame-offset)/fps`; clamps to 0 before the offset; matches at the offset.

**Manual (browser):**
- Import an mp3/wav/m4a → a waveform lane appears under the ruler, anchored at frame 0.
- Press play → audio plays in sync with the playhead; pause stops it; with loop on, audio restarts
  each loop and stays aligned.
- Remove (✕) clears the lane and silences playback.
- Save the project, reload it → the audio and its waveform come back and still play.
- Importing a second file replaces the first.
- A non-audio / corrupt file shows an error and leaves the current track intact.

## Self-review notes

- Phase 1 is independently shippable and useful (import → see → hear → save).
- Pure helpers (`computePeaks`, `audioFrameSpan`, `bufferOffsetForFrame`) carry the only Node-testable
  logic; the Web Audio parts are isolated in `decode.ts` / `engine.ts` and manual-verified.
- `offsetFrames`/`muted` are in the model + persistence from day one, so Phases 2–3 add UI and export
  without a save-format migration.
- The frames-master sync contract (re-sync on play + loop wrap, free-run between) is the one nuanced
  area and is stated explicitly; it reuses the existing `Playback` callbacks rather than a new clock.
