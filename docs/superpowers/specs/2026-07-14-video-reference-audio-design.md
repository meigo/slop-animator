# Per-video reference audio (unmute) — design

**Date:** 2026-07-14
**Status:** Design (approved for planning)
**Feature:** A per-video-reference **audio toggle** so a video reference can play its own soundtrack
during playback (default off = silent, as today). Speed-synced for free because it's the same media
element already running at the layer's `speed`.

## Motivation

Video references are loaded muted (`loadVideoMedia` sets `el.muted = true`). A user rotoscoping /
timing to live-action footage often wants to *hear* the clip (action beats, lip-sync) while it plays.

The naive path — "import the video's audio into the project audio track" — collides with the
per-video `speed` multiplier: a decoupled project-level audio track plays at 1× and desyncs whenever
the video is retimed (the sync knot). The **unmute** path sidesteps it entirely: the `<video>`
element already exists, is already `play()`d at `playbackRate = clamp(speed)` during playback, and is
already seeked to the right time. Unmuting it plays its soundtrack **in sync at any speed** (pitch
shifts with speed, like scrubbing a tape) with essentially no new machinery, and it's **per-video**
(each reference plays its own audio) — which the single project `audio` track cannot do.

The alternative — extracting the video's audio into an editable, independently-retimable
`project.audio` track — is a separate, heavier feature (single-track, audio-engine `playbackRate`,
persisted bytes, manual A/V sync) and is explicitly out of scope here.

## Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Approach | **Unmute the video element** (no separate audio track, no audio engine). Audio is the element's own soundtrack. |
| D2 | Model | `ReferenceLayer.audioEnabled: boolean` (video-only; ignored for images). Single source of truth. |
| D3 | Default | **`false`** (off). Importing a video stays silent until the user enables audio, so multiple refs don't blast audio unexpectedly. |
| D4 | Element muting | Enforce `vid.muted = !audioEnabled` in `syncReferenceVideos` (guarded, like `playbackRate`), covering load/relink/live-toggle uniformly. The toggle handler also sets `el.muted` directly for immediate feedback while paused. |
| D5 | When audio plays | Only during **playback** (when the element `play()`s). Silent while scrubbing/paused (inherent — a paused/seeking element makes no sound). Correct behavior; no special handling. |
| D6 | Speed sync | Automatic — same element, already at `playbackRate = clamp(speed)`; 2× → 2× pitch-shifted. No extra code. |
| D7 | UI | A 🔊/🔇 toggle button on **video** reference rows in `LayerList`, beside the offset/speed inputs (video-only, like them). |
| D8 | Persistence | Save `audioEnabled`; load `audioEnabled ?? false` (old projects → off). Video bytes still not persisted (re-link on load as today); the flag re-applies to the re-linked element via sync. |

## Architecture

### `src/anim/document.ts`

- `ReferenceLayer` gains `audioEnabled: boolean` (video plays its own audio when true; ignored for images).
- `createReferenceLayer(...)` sets `audioEnabled: false`.

### `src/anim/reference.ts` — `syncReferenceVideos`

In the per-layer loop (after the existing `playbackRate` guard), enforce the mute state from the flag:

```ts
    const wantMuted = !(layer.audioEnabled ?? false);
    if (vid.muted !== wantMuted) vid.muted = wantMuted;
```

`loadVideoMedia` keeps its initial `el.muted = true`; sync corrects it from the flag. (Because
`audioEnabled` defaults `false`, the element stays muted until enabled — consistent.)

### `src/lib/LayerList.svelte`

Beside the existing video-ref offset/speed inputs, add an audio toggle button:

```svelte
          <button
            class="layer-btn"
            style="width:auto;padding:2px 6px;font-size:11px"
            onclick={(e) => {
              e.stopPropagation();
              layer.audioEnabled = !layer.audioEnabled;
              if (layer.media.type === "video") layer.media.el.muted = !layer.audioEnabled;
              bump();
            }}
            title={layer.audioEnabled ? "Audio on (mute)" : "Audio off (unmute)"}
          >
            {layer.audioEnabled ? "🔊" : "🔇"}
          </button>
```

(Match the surrounding controls' pattern; the direct `el.muted` set gives immediate feedback while
paused, and `syncReferenceVideos` enforces it thereafter.)

### `src/persist/project-file.ts`

- **Type:** `interface ReferenceJson` gains `audioEnabled?: boolean`.
- **Save** (ref-layer serialize, beside `speed: l.speed`): add `audioEnabled: l.audioEnabled`.
- **Load** (ref reconstruct, beside `speed: rj.speed ?? 1`): add `audioEnabled: rj.audioEnabled ?? false`
  (back-compat: pre-audio projects → off).

## Interaction / edge cases

- **Autoplay policy:** unmuted `play()` is user-gesture-initiated (the Play button), so browsers don't
  block it. No workaround needed.
- **Scrubbing/paused:** no audio (element isn't playing). Expected.
- **Speed ≠ 1:** audio pitch-shifts with the video (2× higher, 0.5× lower) and stays frame-synced —
  it's literally the same element. This is the intended behavior of the "linked" choice.
- **Multiple video refs with audio on:** each plays its own soundtrack simultaneously, independently
  of each other and of the project `audio` track (separate sources — no conflict).
- **Relink / replaceProject:** the flag persists; sync re-applies `muted` to the (re-linked) element.
  `releaseReferenceMedia` already `pause()`s the element, stopping its audio.
- **`audioEnabled` missing (old projects / in-memory):** guarded to `false` in sync and defaulted on load.

## Testing

Extend `src/__tests__/reference.test.ts` (the sync logic is DOM-free, node-testable with the fake
video — add a `muted` field to `fakeVid` and an `audioEnabled` param to `vidLayer`):

- `audioEnabled: true` → `vid.muted === false` after sync.
- `audioEnabled: false`/missing → `vid.muted === true` after sync.
- toggling the flag between syncs flips `vid.muted` accordingly.
- existing speed/seek tests still pass (the mute enforcement doesn't disturb `currentTime`/`playbackRate`).

`LayerList`/persistence are DOM/IO → build + reasoning + browser verified.

- **Build:** `npm run build` 0/0. `npm test` baseline + new audio cases.
- **Browser (verification debt):** enable audio on a video ref → hear it during playback; scrub is
  silent; 2× plays faster+higher-pitched in sync, 0.5× slower+lower; toggle off mid-play silences it;
  save→reload keeps the flag; old project loads with audio off; two videos with audio play both.

## Non-goals / deferred

- **Per-layer volume slider** (just on/off).
- **Audio during scrub** (would need a separate scrub-audio path; not wanted).
- **Waveform display** for video audio.
- **Muxing video-element audio into export** — export still handles only the project `audio` track
  (future Phase 3).
- **Extracting the video's audio into an editable `project.audio` track with its own speed** — the
  separate, heavier "independent audio" feature set aside during brainstorming.
