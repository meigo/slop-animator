# Play Range — Design

**Status:** Approved (design phase)
**Date:** 2026-06-15

## Goal

Let the user mark an in/out frame range and have playback play and loop only within it, to
concentrate on and replay a specific part of the animation. The range is a transient playback aid:
it does not affect scrubbing, transport navigation, export, or persistence.

## Context

`advancePlayhead(current, frameCount, loop)` (`src/anim/playback.ts`) computes the next playhead over
`[0, frameCount)` — `+1` until the last frame, then loop to `0` or stop. Its only caller is
`Playback.step`. The `Playback` driver reads `getFrameCount`/`getCurrent`/`getLoop`/`setFrame` from
`appState`; `state.playback = { isPlaying, loop }`. The timeline ruler scrubs by setting
`state.playhead`. This feature is **independent** of the animation-length and audio features.

## Scope

In scope:
- Generalize `advancePlayhead` to arbitrary inclusive bounds `(current, start, end, loop)`.
- Pure helpers `effectiveRange`, `withRangeIn`, `withRangeOut` in `src/anim/playback.ts`, unit-tested.
- `Playback` reads range bounds; `play()` snaps the playhead into range when it starts outside.
- `state.playback.range` + store actions `setPlayRangeIn` / `setPlayRangeOut` / `clearPlayRange`.
- Playbar in/out/clear buttons + readout; a ruler highlight band on the active range.

Out of scope (YAGNI):
- Persisting the range with the project (it is session-only).
- Range affecting export (export always renders the full animation).
- Range clamping scrubbing or transport buttons (free navigation — the chosen "playback only" scope).
- Draggable ruler handles (in/out are set at the playhead via buttons).

## Decisions

1. **Range = inclusive frame indices**, `state.playback.range: { in: number; out: number } | null`;
   `null` means the whole timeline (today's behavior).
2. **Session-only, not undoable.** The range lives in app state like the onion-skin settings; set via
   direct `state.playback.range = …` (Svelte-reactive), no `commitStructural`, no persistence.
3. **Playback only.** Scrubbing and the prev/next/first/last transport buttons keep moving across the
   whole timeline. Only play/loop are bounded.
4. **Snap-on-play only when outside.** `play()` moves the playhead to `start` *only if* it is outside
   `[start, end]`. With no range (`start=0, end=frameCount-1`) the playhead is always inside, so
   existing playback is unchanged.
5. **Length-change safe.** Bounds are derived through `effectiveRange`, which clamps into
   `[0, frameCount-1]` and falls back to the full timeline if the stored range is invalid (e.g. `out`
   beyond a now-shorter animation). The stored range is never mutated by length changes.
6. **Export ignores the range.** It is a preview aid only.

## Behavior

### Generalized `advancePlayhead(current, start, end, loop)`

`end` is the inclusive last playable index.
- `current < end` → `{ frame: current + 1, stop: false }`.
- `current >= end` → looping → `{ frame: start, stop: false }`; otherwise `{ frame: current, stop: true }`.

The previous full-timeline call is exactly `advancePlayhead(current, 0, frameCount - 1, loop)`.

### `effectiveRange(range, frameCount)`

```ts
export function effectiveRange(
  range: { in: number; out: number } | null,
  frameCount: number,
): { start: number; end: number } {
  const last = Math.max(0, frameCount - 1);
  if (!range) return { start: 0, end: last };
  const start = Math.max(0, Math.min(range.in, last));
  const end = Math.max(0, Math.min(range.out, last));
  if (start > end) return { start: 0, end: last }; // invalid → full timeline
  return { start, end };
}
```

### Range-setting helpers (keep `in <= out`)

```ts
export function withRangeIn(range: { in: number; out: number } | null, frame: number) {
  const out = range ? Math.max(range.out, frame) : frame;
  return { in: frame, out };
}
export function withRangeOut(range: { in: number; out: number } | null, frame: number) {
  const start = range ? Math.min(range.in, frame) : frame;
  return { in: start, out: frame };
}
```

Setting `in` past the current `out` drags `out` to match (single-frame range), and vice-versa.

### `Playback` changes

- `PlaybackOptions`: replace `getFrameCount` with `getRangeStart: () => number` and
  `getRangeEnd: () => number`.
- `step()` calls `advancePlayhead(getCurrent(), getRangeStart(), getRangeEnd(), getLoop())`.
- `play()`: after setting `playing`, read `s = getRangeStart()`, `e = getRangeEnd()`, `c = getCurrent()`;
  if `c < s || c > e` then `setFrame(s)`. (No-range case never triggers this.)

### `appState` wiring & store actions

- `state.playback` gains `range: { in: number; out: number } | null` (initial `null`).
- `playbackController` options:
  `getRangeStart: () => effectiveRange(state.playback.range, state.project.frameCount).start`,
  `getRangeEnd: () => effectiveRange(state.playback.range, state.project.frameCount).end`.
- Store actions:
  ```ts
  export function setPlayRangeIn()  { state.playback.range = withRangeIn(state.playback.range, state.playhead); }
  export function setPlayRangeOut() { state.playback.range = withRangeOut(state.playback.range, state.playhead); }
  export function clearPlayRange()  { state.playback.range = null; }
  ```
  These are imported from `../anim/playback`. No `bump()` needed — the Playbar and ruler read
  `state.playback.range` reactively.

### UI

- **Playbar** (`src/lib/Playbar.svelte`): three buttons near the transport — "In" (set in at playhead),
  "Out" (set out at playhead), and a clear "✕" (disabled when `range === null`) — plus a small readout
  `In {in+1} – Out {out+1}` shown only when a range is set (1-based to match the frame counter).
- **Timeline ruler** (`src/lib/Timeline.svelte`): when a range is set, the columns in
  `[start, end]` (via `effectiveRange`) get a highlight background so the active region is visible.
  Scrubbing is unchanged.

## Persistence & export

No changes. The range is session state (not in `Project`, not serialized); export
(`src/export/*`) iterates the full `frameCount` and is unaffected.

## Testing

Vitest runs in **Node**; pure logic is unit-tested, store/UI are manual-verified.

**Unit (`src/__tests__/playback.test.ts`):**
- `advancePlayhead` (new signature): advances mid-range; loops to `start` at `end`; stops at `end`
  when not looping; respects a non-zero `start`. (Rewrite the 3 existing cases to `(current, start,
  end, loop)`.)
- `effectiveRange`: null → full timeline; clamps `out` past `frameCount`; invalid (`in > out` after
  clamp) → full timeline; normal range passes through.
- `withRangeIn` / `withRangeOut`: set on a null range yields a single-frame range; setting `in` past
  `out` drags `out`; setting `out` before `in` drags `in`; normal sets keep the other bound.
- `Playback` harness: update the harness to provide `getRangeStart`/`getRangeEnd`; existing step
  tests pass with `start=0, end=frameCount-1`. Add: with a range, `play()` snaps the playhead to
  `start` when it begins outside, and leaves it untouched when inside; stepping loops within
  `[start, end]`.

**Manual (browser):**
- Set in/out at the playhead; the ruler highlights `in…out`; the readout shows the bounds.
- Play with a range: playback runs `in…out`; with loop on it loops within the range; with loop off it
  stops at `out`. Pressing play from before `in` jumps to `in`; from inside the range it plays from the
  current frame.
- Scrubbing and first/last/prev/next still move across the whole timeline.
- Clear removes the highlight and restores full-timeline playback.
- Shortening the animation below `out` (length feature) does not break playback (falls back sanely).
- Export still renders the full animation regardless of the range.

## Self-review notes

- One pure module (`playback.ts`: one generalized function + three helpers) + thin store actions +
  two small UI additions. No new files, no new deps, no persistence.
- The signature change to `advancePlayhead` is contained: one caller and three tests, all updated.
- `effectiveRange` is the single choke point that keeps a stale/oversized range from corrupting
  playback after a length change.
