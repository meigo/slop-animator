# Per-video reference speed — design

**Date:** 2026-07-12
**Status:** Design (approved for planning)
**Feature:** A per-video-reference **speed multiplier** so a video reference can play faster or slower
than the project frame rate (1× = today). Slowdowns produce held/sparse frames — fine given the
low-framerate aesthetic.

## Motivation

Video references currently advance 1:1 with the timeline: `syncReferenceVideos` seeks to
`(frame + offsetFrames)/fps`. There's no way to retime a clip (speed it up to fit fewer frames, or
slow it down for a stepped look). Adding a per-layer `speed` factor covers both. `offsetFrames` is
already a persisted, editable per-layer field (`LayerList.svelte:294`), so `speed` slots in beside it.

## Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Representation | **Speed multiplier** (`1` = today; `2` = 2× faster; `0.5` = half speed). Independent of the video's own fps. |
| D2 | Time mapping | `videoTime = (offsetFrames + frame × speed) / fps`, clamped to `[0, duration]`. `offsetFrames` stays a fixed start shift (its meaning at 1× is unchanged). |
| D3 | Playback | Set `vid.playbackRate = clamp(speed, 0.0625, 16)` each sync so playback runs at the right rate; the drift re-seek keeps scrubbing exact regardless of the clamp. |
| D4 | UI | A number field beside the offset input on **video** reference rows (min 0.1, max 8, step 0.1, `×`). Plain field, no presets. Video-only (like offset). |
| D5 | Persistence | Save `speed`; load `speed ?? 1` (old projects → 1×). |

## Architecture

### `src/anim/document.ts`

- `ReferenceLayer` gains `speed: number` (× multiplier; 1 = real-time).
- `createReferenceLayer(...)` sets `speed: 1`.

### `src/anim/reference.ts` — `syncReferenceVideos`

Replace the time computation + add the rate:

```ts
    const off = Number.isFinite(layer.offsetFrames) ? layer.offsetFrames : 0;
    const spd = Number.isFinite(layer.speed) && layer.speed > 0 ? layer.speed : 1;
    const wanted = (off + frame * spd) / fps;
    const dur = isFinite(vid.duration) ? vid.duration : wanted;
    const clamped = Math.max(0, Math.min(dur, wanted));
    const rate = Math.max(0.0625, Math.min(16, spd));
    if (vid.playbackRate !== rate) vid.playbackRate = rate; // so play() runs at speed; live-updates
    // …existing paused/playing seek branches, unchanged, using `clamped`…
```

(The `vid.seeking` coalesce guard and the paused/playing branches from the perf pass stay as-is —
only `wanted` gains `* spd` and `playbackRate` is set.)

### `src/state/appState.svelte.ts` — `onPlayingChange`

The play-start per-layer seek uses the speed-aware formula + sets the rate:

```ts
      for (const l of state.project.layers) {
        if (l.kind !== "ref" || l.media.type !== "video") continue;
        const el = l.media.el;
        const spd = Number.isFinite(l.speed) && l.speed > 0 ? l.speed : 1;
        el.playbackRate = Math.max(0.0625, Math.min(16, spd));
        el.currentTime = (l.offsetFrames + state.playhead * spd) / state.project.fps;
        void el.play().catch(() => {});
      }
```

### `src/lib/LayerList.svelte`

Beside the existing video-ref offset `<input>` (line ~294), add a speed field:

```svelte
          <input
            class="w-9 text-xs bg-surface border border-border px-0.5 text-text"
            type="number"
            step="0.1"
            min="0.1"
            max="8"
            bind:value={layer.speed}
            oninput={bump}
            onclick={(e) => e.stopPropagation()}
            title="Playback speed (×)"
          />
```

(Match the offset input's classes/handlers. A tiny `×` label is optional; the tooltip covers it.)

### `src/persist/project-file.ts`

- **Save** (ref layer serialize, by `offsetFrames: l.offsetFrames`): add `speed: l.speed`.
- **Load** (ref reconstruct, by `offsetFrames: rj.offsetFrames`): add `speed: rj.speed ?? 1`
  (back-compat: pre-speed projects → 1×). Update the ref-JSON type to include optional `speed?: number`.

## Interaction / edge cases

- **speed ≤ 0 / NaN / missing:** guarded to `1` in sync and `onPlayingChange` (and defaulted on load).
- **Slowdown → held frames:** at `speed < 1`, consecutive frames map to near-identical video times; the
  same decoded frame is drawn (the accepted stepped look). No special handling.
- **Clip shorter than needed at high speed:** clamps at `duration` (last frame holds), as today.
- **`playbackRate` clamp:** the 0.1–8 UI range is inside the browser's ~[0.0625, 16] `playbackRate`
  window, so playback is always rate-matched within the UI range; the drift re-seek covers any clamp.
- **Live edit:** changing the field `bump()`s → the next tick re-seeks with the new speed and updates
  `playbackRate` immediately.

## Testing

Extend `src/__tests__/reference.test.ts` (the sync logic is DOM-free, node-testable with the fake
video — add a `speed`/`playbackRate` field to the fake and `speed` to the fake layer):
- `wanted` uses `frame × speed` (e.g. speed 2 at frame 6, 12fps → video time 1.0s not 0.5s).
- `speed < 1` slows advance (speed 0.5 at frame 12 → 0.5s).
- `playbackRate` is set from speed (and clamped for out-of-range).
- missing/`0`/negative `speed` → treated as 1.
- offset still applied additively; existing 1× tests still pass.

`LayerList`/persistence are DOM/IO → build + reasoning + browser verified.

- **Build:** `npm run build` 0/0. `npm test` baseline + new speed cases.
- **Browser (verification debt):** set a video ref's speed to 2× (finishes in half the frames) and
  0.5× (stepped/held frames); scrub + play at each; save→reload keeps the speed; old project loads at 1×.

## Non-goals / deferred

- **Preset buttons** (½/1/2), speed **keyframing/ramping**, reverse (negative) playback.
- Speed for **audio** or **image** references (images have no time).
- Changing the timeline length to match a clip's sped-up duration.
