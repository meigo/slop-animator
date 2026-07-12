# Video reference memory + playback pass — design

**Date:** 2026-07-12
**Status:** Design (approved for planning)
**Feature:** Reduce the memory and playback cost of video reference layers — (1) free blob URLs +
decoder when media becomes unreachable, (2) lazy `preload="metadata"`, (3) `play()` the video during
playback instead of seeking every frame.

## Motivation

Video references are a live `<video>` element (`reference.ts:17`) drawn each composite via
`drawImage`. Frame sync (`syncReferenceVideos`, `reference.ts:54`) **seeks** the element
(`currentTime = (frame+offset)/fps`) on every playhead change and never `play()`s it. Analysis found:

- **Blob-URL leak:** `URL.createObjectURL` is never revoked for reference media — the encoded file
  bytes stay in memory for the whole session, and relinking/replacing leaks the old blob.
- **Eager preload:** `preload="auto"` buffers whole files into the media cache.
- **Seek-per-frame playback:** during playback, each frame steps the playhead → seeks the video; seek
  latency exceeds the frame interval, so the reference lags/freezes while the rest plays. Seeking is
  the wrong primitive for playback.

This pass fixes #1/#2/#3. Not doing WebCodecs or a frame cache (deferred).

## Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Release point | Free media (revoke URL + decoder teardown) on `relinkReference` (old media) and `replaceProject` (all outgoing ref media). **NOT** on `removeLayer` — it's undoable and the snapshot shares the media object; revoking would break undo. |
| D2 | Preload | `preload="metadata"`; resolve the load promise on **`loadedmetadata`** (with metadata-only preload, `loadeddata` may never fire). |
| D3 | Playback | Add a `playing` flag to `syncReferenceVideos`: paused → exact seek (today); playing → re-seek only on drift > 0.3 s + resume `play()` if paused. `onPlayingChange` seeks-then-`play()`s on start, `pause()`s on stop. |
| D4 | Playback exactness | While playing, the video is **rate-matched, not frame-locked** (may be a few hundred ms off exact). Scrubbing stays frame-exact. Accepted tradeoff (frame-lock is what causes today's stutter). |
| D5 | Scope | Reference layers only. No WebCodecs, no per-frame bitmap cache, no export-time video muxing. |

## Architecture

### `src/anim/reference.ts`

- **`loadVideoMedia`**: `el.preload = "metadata"`; resolve on `loadedmetadata` (not `loadeddata`).
  `videoWidth/videoHeight` are available at `loadedmetadata`, so `mediaIntrinsicSize` /
  contain-fit math is unaffected. The first visible frame still arrives via the initial sync seek →
  `seeked` → `bump` (`onSeeked` unchanged).
- **`releaseReferenceMedia(media: ReferenceMedia): void`** (new, pure-ish DOM):
  - image: if `el.src` starts with `blob:` → `URL.revokeObjectURL(el.src)`.
  - video: `el.pause()`; if `el.src` is a `blob:` → `URL.revokeObjectURL(el.src)`; then
    `el.removeAttribute("src"); el.load();` (the standard sequence that detaches the source and lets
    the decoder be reclaimed).
  - `missing`: no-op.
- **`syncReferenceVideos(project, frame, fps, playing: boolean)`** (signature gains `playing`):
  ```
  for each video ref layer:
    wanted = clamp((frame + offset)/fps, 0, duration)
    if (!playing) {
      if (|currentTime - wanted| > 1e-3) currentTime = wanted   // exact seek (today)
    } else {
      if (el.paused) { currentTime = wanted; void el.play().catch(()=>{}) }  // resume (ended / joined mid-play)
      else if (|currentTime - wanted| > DRIFT) currentTime = wanted           // re-align only on big drift
    }
  ```
  `DRIFT = 0.3` (s). The `> DRIFT` also catches loop-wrap (end→start jump) and re-seeks there.
  `playbackRate` stays 1 (real-time mapping: 1 frame = 1/fps s).

### `src/state/appState.svelte.ts`

- **`relinkReference(id, media)`**: `releaseReferenceMedia(layer.media)` **before** `layer.media = media`.
- **`replaceProject(project)`**: before `state.project = project`, `releaseReferenceMedia` every
  `kind === "ref"` layer's media in the **outgoing** `state.project`. (History is cleared here, so the
  old media is unreachable — safe.)
- **`onPlayingChange(p)`** (in the `playbackController` config): on `p === true` → for each video ref
  layer seek to the current playhead time and `void el.play().catch(()=>{})`; on `p === false` → for
  each video ref layer `el.pause()` (the next Canvas tick exact-seeks it onto the paused frame). Reuse
  a small shared helper or inline; keep it beside the existing audio `play()/pause()` calls there.

### `src/lib/Canvas.svelte`

- The tick loop's `syncReferenceVideos(appState.project, appState.playhead, appState.project.fps)`
  gains the 4th arg `appState.playback.isPlaying`.

### `removeLayer` — intentionally unchanged (D1)

Deleting a reference layer does **not** release its media (undo could restore it). Its blob is
reclaimed at the next `replaceProject` (New/Open) or page unload. Documented as the accepted
compromise; the leak is bounded to deleted-this-session references, not every import.

## Testing

The seek/drift/clamp/resume logic in `syncReferenceVideos` becomes **node-unit-testable** with a fake
video object (tagged plain object with mutable `currentTime`/`paused`/`duration` + a `play()` spy),
mirroring the `CanvasOps` fake pattern. Cover:
- paused: seeks to exact time; no seek when already within 1e-3.
- playing + within drift: **no** seek (lets it run).
- playing + drift > 0.3: re-seeks.
- playing + `paused` element: seeks + calls `play()` (resume/loop-wrap).
- clamp to `[0, duration]`; `offsetFrames` applied; non-video/missing layers skipped.

`releaseReferenceMedia`, `preload`/`loadedmetadata`, and real playback smoothness are DOM/decoder —
build + reasoning + browser verified.

- **Build:** `npm run build` 0/0. `npm test` baseline + the new sync tests.
- **Browser (verification debt — flag to user):** import a video → scrub (frame-exact, snappier) →
  play (smooth, rate-matched, not frozen) → loop-wrap re-aligns → relink a video (old one released) →
  New/Open (all released); memory doesn't climb across repeated import/relink; large file no longer
  fully buffered on import.

## Non-goals / deferred

- **WebCodecs `VideoDecoder` / `requestVideoFrameCallback`** frame-accurate decode.
- **Per-frame bitmap cache** for scrubbed frames.
- **Releasing on `removeLayer`** (blocked by undo sharing the media object) — revisit if a
  media-aware undo lands.
- **Audio/video export muxing**, video trimming, per-layer playback rate.
