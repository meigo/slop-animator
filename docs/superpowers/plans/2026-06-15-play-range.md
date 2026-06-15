# Play Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark an in/out frame range so playback plays and loops only within it (a session-only preview aid; scrubbing, transport, export, and persistence are unaffected).

**Architecture:** Pure helpers in `src/anim/playback.ts` (`effectiveRange`, `withRangeIn`, `withRangeOut`, `snapPlayheadToRange`) plus a generalized `advancePlayhead(current, start, end, loop)`. The `Playback` driver takes range bounds via `getRangeStart`/`getRangeEnd`; `play()` snaps the playhead into range using the pure helper (testable without rAF). `state.playback.range` holds the range; store actions set/clear it; the Playbar shows in/out/clear buttons and the timeline ruler highlights the active region.

**Tech Stack:** TypeScript, Svelte 5 (runes-free Playbar/Timeline scripts use legacy `let`), Vitest (Node — no jsdom/rAF), Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-15-play-range-design.md`

**Branch:** execute on a new branch `play-range` (off `main`).

**Key constraints (verified against the codebase):**
- Vitest runs in **Node**; `requestAnimationFrame` is undefined and `Playback.play()` uses it — so existing tests only call `step()` directly, never `play()`. The play-time snap is therefore extracted into the pure `snapPlayheadToRange` helper and tested there; **do not** write a test that calls `play()`.
- `advancePlayhead`'s only caller is `Playback.step` (`src/anim/playback.ts`); its only test is `src/__tests__/playback.test.ts`. The signature change is fully contained by updating those two plus the appState wiring.
- `appState.playbackController` (`src/state/appState.svelte.ts:315`) currently passes `getFrameCount`; that option is replaced by `getRangeStart`/`getRangeEnd`, so appState must change in the same task that changes `PlaybackOptions`, or the build breaks.
- The range is session state on `state.playback` — not in `Project`, not serialized. No persistence, no migration, not undoable (direct assignment, Svelte-reactive).

---

### Task 1: pure range helpers

**Files:**
- Modify: `src/anim/playback.ts` (add four exported helpers; do NOT change `advancePlayhead` yet)
- Test: `src/__tests__/playback.test.ts` (extend the import; add describe blocks)

These are purely additive — the build and all existing tests stay green.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/playback.test.ts`, change the import to:

```ts
import { advancePlayhead, Playback, effectiveRange, withRangeIn, withRangeOut, snapPlayheadToRange } from "../anim/playback";
```

Append:

```ts
describe("effectiveRange", () => {
  it("null range → full timeline", () => {
    expect(effectiveRange(null, 10)).toEqual({ start: 0, end: 9 });
  });
  it("clamps out past the last frame", () => {
    expect(effectiveRange({ in: 2, out: 99 }, 10)).toEqual({ start: 2, end: 9 });
  });
  it("invalid (in > out after clamp) → full timeline", () => {
    expect(effectiveRange({ in: 8, out: 3 }, 10)).toEqual({ start: 0, end: 9 });
  });
  it("passes a normal in-bounds range through", () => {
    expect(effectiveRange({ in: 3, out: 6 }, 10)).toEqual({ start: 3, end: 6 });
  });
});

describe("withRangeIn / withRangeOut", () => {
  it("setting in on a null range yields a single-frame range", () => {
    expect(withRangeIn(null, 4)).toEqual({ in: 4, out: 4 });
  });
  it("setting out on a null range yields a single-frame range", () => {
    expect(withRangeOut(null, 4)).toEqual({ in: 4, out: 4 });
  });
  it("setting in past out drags out along", () => {
    expect(withRangeIn({ in: 2, out: 5 }, 8)).toEqual({ in: 8, out: 8 });
  });
  it("setting out before in drags in along", () => {
    expect(withRangeOut({ in: 4, out: 9 }, 1)).toEqual({ in: 1, out: 1 });
  });
  it("normal set keeps the other bound", () => {
    expect(withRangeIn({ in: 2, out: 9 }, 4)).toEqual({ in: 4, out: 9 });
    expect(withRangeOut({ in: 2, out: 9 }, 6)).toEqual({ in: 2, out: 6 });
  });
});

describe("snapPlayheadToRange", () => {
  it("returns current when inside the range", () => {
    expect(snapPlayheadToRange(4, 3, 6)).toBe(4);
  });
  it("returns start when before the range", () => {
    expect(snapPlayheadToRange(1, 3, 6)).toBe(3);
  });
  it("returns start when after the range", () => {
    expect(snapPlayheadToRange(8, 3, 6)).toBe(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/playback.test.ts`
Expected: FAIL — `effectiveRange` / `withRangeIn` / `withRangeOut` / `snapPlayheadToRange` not exported.

- [ ] **Step 3: Implement the helpers**

In `src/anim/playback.ts`, add (e.g. directly under the existing `advancePlayhead`):

```ts
/** Clamp a stored range into [0, frameCount-1]; null or invalid (in>out) → the full timeline. */
export function effectiveRange(
  range: { in: number; out: number } | null,
  frameCount: number,
): { start: number; end: number } {
  const last = Math.max(0, frameCount - 1);
  if (!range) return { start: 0, end: last };
  const start = Math.max(0, Math.min(range.in, last));
  const end = Math.max(0, Math.min(range.out, last));
  if (start > end) return { start: 0, end: last };
  return { start, end };
}

/** Set the range's in-point to `frame`, dragging out along if in would pass it. */
export function withRangeIn(range: { in: number; out: number } | null, frame: number) {
  return { in: frame, out: range ? Math.max(range.out, frame) : frame };
}

/** Set the range's out-point to `frame`, dragging in along if out would precede it. */
export function withRangeOut(range: { in: number; out: number } | null, frame: number) {
  return { in: range ? Math.min(range.in, frame) : frame, out: frame };
}

/** Where the playhead should sit when play starts: snap to `start` only if outside [start, end]. */
export function snapPlayheadToRange(current: number, start: number, end: number): number {
  return current < start || current > end ? start : current;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/playback.test.ts`
Expected: PASS (12 new assertions green; the existing `advancePlayhead`/`Playback.step` tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/anim/playback.ts src/__tests__/playback.test.ts
git commit -m "feat: pure play-range helpers (effectiveRange, withRange*, snapPlayheadToRange)"
```

---

### Task 2: generalize `advancePlayhead` + wire range bounds

**Files:**
- Modify: `src/anim/playback.ts` (`advancePlayhead` signature, `PlaybackOptions`, `Playback.step`, `Playback.play`)
- Modify: `src/state/appState.svelte.ts` (add `range` to the `playback` state; rewire `playbackController`)
- Test: `src/__tests__/playback.test.ts` (rewrite the 3 `advancePlayhead` cases; update the harness)

This is one coordinated signature change — all sites change together so the build stays green.

- [ ] **Step 1: Update the tests first**

In `src/__tests__/playback.test.ts`:

(a) Rewrite the existing `advancePlayhead` describe block to the new `(current, start, end, loop)` signature and add a non-zero-start case:

```ts
describe("advancePlayhead", () => {
  it("advances to the next frame mid-range", () => {
    expect(advancePlayhead(1, 0, 4, true)).toEqual({ frame: 2, stop: false });
  });
  it("wraps to start at the end when looping", () => {
    expect(advancePlayhead(4, 0, 4, true)).toEqual({ frame: 0, stop: false });
  });
  it("stops at the end when not looping", () => {
    expect(advancePlayhead(4, 0, 4, false)).toEqual({ frame: 4, stop: true });
  });
  it("respects a non-zero start when wrapping", () => {
    expect(advancePlayhead(7, 2, 7, true)).toEqual({ frame: 2, stop: false });
  });
});
```

(b) Update the `harness` to provide range getters instead of `getFrameCount` (keep `start` as the initial playhead; add optional `rangeStart`/`rangeEnd` defaulting to the full timeline):

```ts
function harness(opts: { fps: number; frameCount: number; loop: boolean; start?: number; rangeStart?: number; rangeEnd?: number }) {
  let current = opts.start ?? 0;
  let playing = true;
  const pb = new Playback({
    getFps: () => opts.fps,
    getRangeStart: () => opts.rangeStart ?? 0,
    getRangeEnd: () => opts.rangeEnd ?? opts.frameCount - 1,
    getLoop: () => opts.loop,
    getCurrent: () => current,
    setFrame: (f) => { current = f; },
    onPlayingChange: (p) => { playing = p; },
  });
  return { pb, frame: () => current, playing: () => playing };
}
```

The existing `Playback.step` tests are unchanged in body (they pass `frameCount`, so the range defaults to the whole timeline).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/playback.test.ts`
Expected: FAIL — `advancePlayhead` still has the old 3-arg signature (the `(…, 0, 4, …)` calls return wrong values) and `PlaybackOptions` has no `getRangeStart`/`getRangeEnd` (type error in the harness).

- [ ] **Step 3: Update `playback.ts`**

In `src/anim/playback.ts`:

(a) Generalize `advancePlayhead`:

```ts
/** Next playhead position for a tick over the inclusive range [start, end]. `stop` is true when the
 *  end is reached and not looping. */
export function advancePlayhead(
  current: number,
  start: number,
  end: number,
  loop: boolean
): { frame: number; stop: boolean } {
  if (current < end) return { frame: current + 1, stop: false };
  if (loop) return { frame: start, stop: false };
  return { frame: current, stop: true };
}
```

(b) In `PlaybackOptions`, replace `getFrameCount: () => number;` with:

```ts
  getRangeStart: () => number;
  getRangeEnd: () => number;
```

(c) In `Playback.step`, change the `advancePlayhead` call to:

```ts
      const next = advancePlayhead(this.opts.getCurrent(), this.opts.getRangeStart(), this.opts.getRangeEnd(), this.opts.getLoop());
```

(d) In `Playback.play`, add the snap right after `this.opts.onPlayingChange(true);` and before `this.scheduleNext();`:

```ts
    const snapped = snapPlayheadToRange(this.opts.getCurrent(), this.opts.getRangeStart(), this.opts.getRangeEnd());
    if (snapped !== this.opts.getCurrent()) this.opts.setFrame(snapped);
```

(`snapPlayheadToRange` is defined in the same module from Task 1 — no import needed.)

- [ ] **Step 4: Update `appState.svelte.ts`**

(a) Add `effectiveRange` to the import from `../anim/playback`. Check the existing import; if `Playback` is imported from `../anim/playback`, add `effectiveRange` to that statement. (Search for `from "../anim/playback"`.)

(b) Add `range` to the `playback` field of the `AnimState` interface (line 33):

```ts
  playback: { isPlaying: boolean; loop: boolean; range: { in: number; out: number } | null };
```

(c) Add `range: null` to the `playback` initializer (line 69):

```ts
  playback: { isPlaying: false, loop: true, range: null },
```

(d) In the `playbackController` options (line 315), replace `getFrameCount: () => state.project.frameCount,` with:

```ts
  getRangeStart: () => effectiveRange(state.playback.range, state.project.frameCount).start,
  getRangeEnd: () => effectiveRange(state.playback.range, state.project.frameCount).end,
```

- [ ] **Step 5: Run tests + build**

Run: `npx vitest run src/__tests__/playback.test.ts`
Expected: PASS.

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass. Baseline after Task 1 is 145 (133 + 12); unchanged here (the 3 rewritten cases replace the old 3).

- [ ] **Step 6: Commit**

```bash
git add src/anim/playback.ts src/state/appState.svelte.ts src/__tests__/playback.test.ts
git commit -m "feat: range-bounded playback (advancePlayhead bounds + play snap)"
```

---

### Task 3: store actions

**Files:**
- Modify: `src/state/appState.svelte.ts` (import `withRangeIn`/`withRangeOut`; add three actions)

No unit test (store can't be imported under Node). Verification = build + suite.

- [ ] **Step 1: Add the imports**

Add `withRangeIn` and `withRangeOut` to the existing `from "../anim/playback"` import (alongside `effectiveRange` from Task 2).

- [ ] **Step 2: Add the actions**

Near the `playbackController` definition (after it is fine), add:

```ts
/** Set the play range's in-point to the current playhead (session-only, not undoable). */
export function setPlayRangeIn() {
  state.playback.range = withRangeIn(state.playback.range, state.playhead);
}
/** Set the play range's out-point to the current playhead (session-only, not undoable). */
export function setPlayRangeOut() {
  state.playback.range = withRangeOut(state.playback.range, state.playhead);
}
/** Clear the play range (back to full-timeline playback). */
export function clearPlayRange() {
  state.playback.range = null;
}
```

(No `bump()` — the Playbar and ruler read `state.playback.range` reactively.)

- [ ] **Step 3: Build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass, 145 unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat: play-range store actions (set in/out, clear)"
```

---

### Task 4: Playbar in/out/clear controls

**Files:**
- Modify: `src/lib/Playbar.svelte` (import the actions + icons; add a control group)

No automated test (no component tests; jsdom unavailable). Verification = build + manual checklist.

- [ ] **Step 1: Extend imports**

In `src/lib/Playbar.svelte`:
- Add `setPlayRangeIn, setPlayRangeOut, clearPlayRange` to the existing import from `../state/appState.svelte`.
- Add two icons to the existing `@lucide/svelte` import: `Brackets, X` (used for the in/out group and clear). If `Brackets` is unavailable, use `SquareBrackets`; keep it simple — text labels "In"/"Out" are acceptable instead of icons.

- [ ] **Step 2: Add the control group**

After the `<span>Frame …</span>` / Length `<label>` block (around line 32), add:

```svelte
  <div class="flex items-center gap-1 text-text-secondary">
    <button class={btn} title="Set range in-point to current frame" onclick={setPlayRangeIn}>In</button>
    <button class={btn} title="Set range out-point to current frame" onclick={setPlayRangeOut}>Out</button>
    {#if state.playback.range}
      <span class="text-xs">{state.playback.range.in + 1}–{state.playback.range.out + 1}</span>
      <button class={btn} title="Clear play range" onclick={clearPlayRange}><X size={16} /></button>
    {/if}
  </div>
```

(`btn` is the existing button class constant in this file. The readout is 1-based to match the "Frame X/Y" counter.)

- [ ] **Step 3: Build**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass, 145 unchanged.

- [ ] **Step 4: Manual verification (browser)**

Run `npm run dev`, then confirm:
- "In" / "Out" set the range to the current frame; the readout appears showing the 1-based bounds.
- Setting In past the current Out collapses to a single-frame range (and vice-versa).
- "✕" clears the range and the readout disappears.
- With a range set, pressing play runs `in…out`; loop on loops within the range; loop off stops at `out`.
- Pressing play with the playhead before `in` jumps to `in`; from inside the range it plays from the current frame.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Playbar.svelte
git commit -m "feat: play-range in/out/clear controls in Playbar"
```

---

### Task 5: timeline ruler highlight

**Files:**
- Modify: `src/lib/Timeline.svelte` (import `effectiveRange`; highlight the in-range ruler columns)

No automated test. Verification = build + manual.

- [ ] **Step 1: Import the helper**

In `src/lib/Timeline.svelte`, add `effectiveRange` to an import from `../anim/playback` (add a new import line if none exists):

```ts
  import { effectiveRange } from "../anim/playback";
```

- [ ] **Step 2: Highlight in-range ruler cells**

In the ruler `{#each}` (the block rendering each ruler cell, around line 270-273), add a reactive class that marks columns within the effective range. The cell currently is:

```svelte
        {#each Array(state.project.frameCount) as _, f}
          <div class="box-border h-4 border-r border-border text-[10px] leading-4 text-center text-text-muted"
               class:text-accent={f === state.playhead}
               style="width: {CELL_W}px">{rulerLabel(f)}</div>
        {/each}
```

Change it to compute the range and apply a highlight background only when a range is set:

```svelte
        {#each Array(state.project.frameCount) as _, f}
          {@const r = state.playback.range ? effectiveRange(state.playback.range, state.project.frameCount) : null}
          <div class="box-border h-4 border-r border-border text-[10px] leading-4 text-center text-text-muted"
               class:text-accent={f === state.playhead}
               class:bg-selection={r && f >= r.start && f <= r.end}
               style="width: {CELL_W}px">{rulerLabel(f)}</div>
        {/each}
```

(`bg-selection` is the existing highlight token used elsewhere in the timeline; if it reads too strong on the thin ruler, fall back to `bg-surface-active`.)

- [ ] **Step 3: Build**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass, 145 unchanged.

- [ ] **Step 4: Manual verification (browser)**

Run `npm run dev`:
- Setting a range highlights the `in…out` columns on the ruler; clearing removes the highlight.
- Shortening the animation below `out` keeps the highlight valid (clamped via `effectiveRange`) and playback still works.
- Scrubbing/transport still move freely across the whole timeline.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Timeline.svelte
git commit -m "feat: highlight the play range on the timeline ruler"
```

---

## Final verification

- [ ] `npm run build` → 0 errors, 0 warnings.
- [ ] `npm test` → all pass (145 = 133 baseline + 12 new).
- [ ] Manual checklists in Tasks 4 & 5 confirmed.
- [ ] Export still renders the full animation regardless of the range (spot-check an export).

## Self-Review (completed by plan author)

**Spec coverage:**
- `effectiveRange` / `withRangeIn` / `withRangeOut` / `snapPlayheadToRange` pure helpers + tests → Task 1. ✅
- Generalized `advancePlayhead` + `Playback` range bounds + play-time snap → Task 2. ✅
- `state.playback.range` + getters → Task 2; store actions `setPlayRangeIn`/`setPlayRangeOut`/`clearPlayRange` → Task 3. ✅
- Playbar in/out/clear + readout → Task 4. ✅
- Ruler highlight via `effectiveRange` → Task 5. ✅
- Playback-only scope / no persistence / export ignores range → no code needed (range is session state, export untouched); verified in Final verification. ✅

**Placeholder scan:** No TBD/TODO/vague steps; every code step shows complete code. ✅

**Type consistency:** `effectiveRange(range, frameCount): {start, end}` defined in Task 1, used in Task 2 (appState getters) and Task 5 (ruler). `withRangeIn`/`withRangeOut(range, frame)` defined in Task 1, used in Task 3. `snapPlayheadToRange(current, start, end)` defined in Task 1, used in Task 2's `play()`. `advancePlayhead(current, start, end, loop)` redefined in Task 2 and called there. `state.playback.range` shape `{ in, out } | null` is identical across the interface (Task 2), actions (Task 3), Playbar (Task 4), and ruler (Task 5). The `Playback` harness in tests is updated in Task 2 to match the new `PlaybackOptions`. ✅
