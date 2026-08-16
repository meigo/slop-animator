# Audio Clip Trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trim the head and tail of the project's audio clip by dragging its ends on the audio lane, so a long take can be cut down to the shot without re-importing.

**Architecture:** Two optional frame counts on `AudioTrack` (absent = untrimmed), plus a small pure module that owns all trim arithmetic. Playback and export both already call `AudioBufferSourceNode.start(when, offset, duration)`, so trimming supplies the arguments rather than adding machinery. The gesture reuses the reference clip's edge-handle shape, and the lane keeps drawing the whole buffer, dimming what was trimmed.

**Tech Stack:** Svelte 5 (runes), TypeScript, Web Audio (`AudioBufferSourceNode`, `OfflineAudioContext`), Vitest (node env, no DOM).

**Spec:** `docs/superpowers/specs/2026-08-16-audio-clip-trim-design.md`

## Global Constraints

- **Build gate:** `npm run build` (`svelte-check && tsc --noEmit && vite build`) must report **0 errors, 0 warnings** before any commit.
- **Test baseline:** `npm test` is currently **567 passing**. Never let it go down.
- **Lint:** `npm run lint` clean. The pre-commit hook auto-runs `eslint --fix` + `prettier --write`.
- **Only pure logic is unit-tested.** Vitest runs in node with no DOM. `engine.ts` (Web Audio), `AudioLane.svelte` and `appState.svelte.ts` are build+review-verified by project convention — do not add a DOM harness.
- **`src/state/appState.svelte.ts` is NOT node-importable.** Never import it from a test.
- **`src/export/audio-mix.ts` module scope must stay DOM-free** above `buildExportAudio` — `audioExportPlan` is imported directly by node tests, so a top-level `OfflineAudioContext`/`AudioBuffer` reference would break that import.
- **Format version stays 1.** `trimInFrames`/`trimLenFrames` are optional; absent means untrimmed.
- **Trimming is NON-DESTRUCTIVE.** The encoded `bytes` are never modified.
- **Trim frames, never seconds** — matching `offsetFrames`.
- **A head trim moves `offsetFrames` and `trimInFrames` by the SAME delta**, so kept audio stays at the same project frame.
- **Two coordinate systems:** `audioPlayPlan` reasons in kept-span time (0 = first kept sample); `start()` needs buffer time (0 = first sample of the file). Add the in-point ONLY at the `start()` call.
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

### Task 1: Model fields and the pure trim module

**Files:**
- Modify: `src/anim/document.ts` (the `AudioTrack` interface, ~line 201)
- Create: `src/audio/trim.ts`
- Create: `src/__tests__/audio-trim.test.ts`

**Interfaces:**
- Consumes: `audioFrameSpan(durationSec, fps)` from `src/audio/peaks.ts` (existing).
- Produces:
  - `AudioTrack.trimInFrames?: number`, `AudioTrack.trimLenFrames?: number`
  - `audioTrimSpan(trimInFrames: number | undefined, trimLenFrames: number | undefined, durationS: number, fps: number): { inS: number; lenS: number }`
  - `trimHead(offsetFrames: number, trimInFrames: number | undefined, trimLenFrames: number | undefined, deltaFrames: number, extentFrames: number): { offsetFrames: number; trimInFrames: number; trimLenFrames: number }`
  - `trimTail(trimInFrames: number | undefined, trimLenFrames: number | undefined, deltaFrames: number, extentFrames: number): { trimInFrames: number; trimLenFrames: number }`

- [ ] **Step 1: Add the model fields**

In `src/anim/document.ts`, inside `export interface AudioTrack`, after `muted`:

```ts
  /** Frames of the SOURCE skipped at the head. Absent/0 = from the start. Non-destructive: `bytes`
   *  and `buffer` are never modified, so widening a handle recovers the audio. */
  trimInFrames?: number;
  /** Frames of the SOURCE kept from `trimInFrames`. Absent = to the end of the buffer. */
  trimLenFrames?: number;
```

- [ ] **Step 2: Write the failing tests**

Create `src/__tests__/audio-trim.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { audioTrimSpan, trimHead, trimTail } from "../audio/trim";

// A 10s buffer at 12fps is 120 frames of extent.
const EXTENT = 120;

describe("audioTrimSpan", () => {
  it("an untrimmed track spans the whole buffer", () => {
    expect(audioTrimSpan(undefined, undefined, 10, 12)).toEqual({ inS: 0, lenS: 10 });
  });

  it("a head trim moves the in-point and shortens what is left", () => {
    // 24 frames at 12fps = 2s skipped, 8s remaining.
    expect(audioTrimSpan(24, undefined, 10, 12)).toEqual({ inS: 2, lenS: 8 });
  });

  it("an explicit length wins over the remaining buffer", () => {
    expect(audioTrimSpan(24, 48, 10, 12)).toEqual({ inS: 2, lenS: 4 });
  });

  it("never returns a negative length", () => {
    expect(audioTrimSpan(240, undefined, 10, 12).lenS).toBe(0);
  });
});

describe("trimTail", () => {
  it("shortens the kept span", () => {
    expect(trimTail(0, 120, -20, EXTENT)).toEqual({ trimInFrames: 0, trimLenFrames: 100 });
  });

  it("never shrinks below one frame", () => {
    expect(trimTail(0, 120, -999, EXTENT)).toEqual({ trimInFrames: 0, trimLenFrames: 1 });
  });

  it("stops at the source's extent when dragged back out", () => {
    expect(trimTail(0, 100, 999, EXTENT)).toEqual({ trimInFrames: 0, trimLenFrames: 120 });
  });

  it("accounts for an existing head trim when capping", () => {
    // 30 already skipped, so at most 90 frames remain.
    expect(trimTail(30, 60, 999, EXTENT)).toEqual({ trimInFrames: 30, trimLenFrames: 90 });
  });

  it("treats an absent length as the whole remaining buffer", () => {
    expect(trimTail(0, undefined, -20, EXTENT)).toEqual({ trimInFrames: 0, trimLenFrames: 100 });
  });
});

describe("trimHead", () => {
  it("moves offsetFrames and trimInFrames by the SAME delta", () => {
    const r = trimHead(10, 0, 120, 15, EXTENT);
    expect(r).toEqual({ offsetFrames: 25, trimInFrames: 15, trimLenFrames: 105 });
  });

  it("KEEPS THE AUDIO IN SYNC — the audible span still ends where it did", () => {
    // The property the two-coordinate-system bug would have broken, invisible in any single value.
    const before = { offsetFrames: 10, trimInFrames: 0, trimLenFrames: 120 };
    const endBefore = before.offsetFrames + before.trimLenFrames; // project frame the audio ends on

    const after = trimHead(before.offsetFrames, before.trimInFrames, before.trimLenFrames, 15, EXTENT);

    expect(after.offsetFrames).toBe(25); // starts where the handle was dropped
    expect(after.offsetFrames + after.trimLenFrames).toBe(endBefore); // and still ends where it did
    // The same source sample is still under the same project frame:
    expect(after.offsetFrames - after.trimInFrames).toBe(before.offsetFrames - before.trimInFrames);
  });

  it("clamps the in-point at 0 when dragged back past the source start", () => {
    const r = trimHead(25, 15, 105, -999, EXTENT);
    expect(r).toEqual({ offsetFrames: 10, trimInFrames: 0, trimLenFrames: 120 });
  });

  it("never shrinks below one frame", () => {
    const r = trimHead(10, 0, 120, 999, EXTENT);
    expect(r.trimLenFrames).toBe(1);
    // Sync still holds at the limit.
    expect(r.offsetFrames - r.trimInFrames).toBe(10);
  });

  it("treats an absent length as the whole remaining buffer", () => {
    const r = trimHead(0, undefined, undefined, 10, EXTENT);
    expect(r).toEqual({ offsetFrames: 10, trimInFrames: 10, trimLenFrames: 110 });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/audio-trim.test.ts`
Expected: FAIL — cannot resolve `../audio/trim`.

- [ ] **Step 4: Implement the module**

Create `src/audio/trim.ts`:

```ts
/** Audio clip trim arithmetic (pure; no DOM, no Web Audio).
 *
 *  Trim is stored as SOURCE frames — `trimInFrames` skipped at the head, `trimLenFrames` kept from
 *  there — matching `offsetFrames`, which is also frames. Both are optional on the track; absent
 *  means untrimmed, so an old project plays the whole buffer.
 */

/** A clip may never be trimmed shorter than this. Zero would be silence with a draggable edge. */
export const AUDIO_MIN_TRIM_FRAMES = 1;

/** The kept span in BUFFER seconds: where to start in the source, and how much of it to play.
 *  `lenS` floors at 0 so a nonsense trim yields silence rather than a negative duration, which
 *  `AudioBufferSourceNode.start()` would throw on. */
export function audioTrimSpan(
  trimInFrames: number | undefined,
  trimLenFrames: number | undefined,
  durationS: number,
  fps: number,
): { inS: number; lenS: number } {
  const inS = Math.max(0, (trimInFrames ?? 0) / fps);
  const remainingS = Math.max(0, durationS - inS);
  const lenS = trimLenFrames == null ? remainingS : Math.max(0, Math.min(trimLenFrames / fps, remainingS));
  return { inS, lenS };
}

/** Drag the TAIL handle by `deltaFrames` (right = longer). Capped at the source's extent and
 *  floored at one frame. `extentFrames` is the whole buffer in frames (`audioFrameSpan`). */
export function trimTail(
  trimInFrames: number | undefined,
  trimLenFrames: number | undefined,
  deltaFrames: number,
  extentFrames: number,
): { trimInFrames: number; trimLenFrames: number } {
  const tin = Math.max(0, trimInFrames ?? 0);
  const cur = trimLenFrames ?? extentFrames - tin;
  const max = Math.max(AUDIO_MIN_TRIM_FRAMES, extentFrames - tin);
  const next = Math.max(AUDIO_MIN_TRIM_FRAMES, Math.min(cur + deltaFrames, max));
  return { trimInFrames: tin, trimLenFrames: next };
}

/** Drag the HEAD handle by `deltaFrames` (right = trim more off the front).
 *
 *  `offsetFrames` and `trimInFrames` move by the SAME delta on purpose: the two changes cancel in
 *  project time, so the audio you KEEP stays under the same frames it was already under. Trimming
 *  usually happens because the sync is already right, so a head trim must not re-sync the clip. */
export function trimHead(
  offsetFrames: number,
  trimInFrames: number | undefined,
  trimLenFrames: number | undefined,
  deltaFrames: number,
  extentFrames: number,
): { offsetFrames: number; trimInFrames: number; trimLenFrames: number } {
  const tin = Math.max(0, trimInFrames ?? 0);
  const len = trimLenFrames ?? extentFrames - tin;
  // Clamp the delta itself, so offset and in-point cannot be clamped by different amounts and
  // break the invariant this function exists to hold.
  const lo = -tin; // cannot skip less than nothing
  const hi = len - AUDIO_MIN_TRIM_FRAMES; // cannot eat the last frame
  const d = Math.max(lo, Math.min(deltaFrames, hi));
  return { offsetFrames: offsetFrames + d, trimInFrames: tin + d, trimLenFrames: len - d };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/audio-trim.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 6: Run the build gate**

Run: `npm run build`
Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 7: Commit**

```bash
git add src/anim/document.ts src/audio/trim.ts src/__tests__/audio-trim.test.ts
git commit -m "feat: audio trim model and pure trim arithmetic

Two optional source-frame counts on AudioTrack (absent = untrimmed) and
a pure module owning the arithmetic. trimHead moves offsetFrames and
trimInFrames by the same delta so the kept audio stays under the same
project frames — it clamps the DELTA rather than the two results, or
they could clamp by different amounts and break that invariant.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Playback honours the trim

**Files:**
- Modify: `src/audio/engine.ts` (`play`, ~line 20; `scrub`, ~line 48)
- Test: `src/__tests__/audio.test.ts`

**Interfaces:**
- Consumes: `audioTrimSpan` (Task 1); `bufferOffsetForFrame`, `audioPlayPlan` from `src/audio/peaks.ts` (existing, UNCHANGED).
- Produces: no new exports.

**Read this before writing code — it is the whole task.** `audioPlayPlan(at, duration)` reasons in
**kept-span time**, where 0 is the first kept sample. `start()` needs **buffer time**, where 0 is the
first sample of the file. The in-point converts between them and must be added ONLY at the `start()`
call. Folding it into `at` while passing the trimmed length as `duration` compares the two systems
against each other and cuts every trimmed clip short by exactly the in-point.

`bufferOffsetForFrame` already returns kept-span time without modification, because a head trim moved
`offsetFrames` with `trimInFrames` (Task 1). It needs no change.

- [ ] **Step 1: Write the failing tests**

`audioPlayPlan` is unchanged, so these prove the SEMANTICS the engine relies on: a smaller `duration`
argument moves the silence boundary. Add to `src/__tests__/audio.test.ts` inside the existing
`describe("audioPlayPlan", …)` block (add it if absent):

```ts
  it("a trimmed length moves the silence boundary earlier than the buffer's own end", () => {
    // 10s buffer trimmed to 4s: at 3.9s still audible, at 4s silent — even though the buffer runs on.
    expect(audioPlayPlan(3.9, 4)).toEqual({ kind: "offset", offsetS: 3.9 });
    expect(audioPlayPlan(4, 4)).toEqual({ kind: "silence" });
    expect(audioPlayPlan(4, 10)).toEqual({ kind: "offset", offsetS: 4 }); // untrimmed: still audible
  });

  it("the delay branch is unaffected by a trimmed length", () => {
    // A clip dragged right of the playhead still schedules a delayed start; trimming the tail
    // cannot make a not-yet-started clip silent.
    expect(audioPlayPlan(-2, 4)).toEqual({ kind: "delay", delayS: 2 });
  });
```

- [ ] **Step 2: Run the tests to verify they pass ALREADY**

Run: `npx vitest run src/__tests__/audio.test.ts`
Expected: PASS. This is deliberate — `audioPlayPlan` needs no change, and these tests pin the
behaviour the engine is about to depend on. If they fail, stop: the assumption behind this task is
wrong.

- [ ] **Step 3: Wire `play` to the trim**

In `src/audio/engine.ts`, add the import:

```ts
import { audioTrimSpan } from "./trim";
```

Replace the body of `play` from the `const at =` line through the `src.start(...)` lines with:

```ts
    const { inS, lenS } = audioTrimSpan(
      this.track.trimInFrames,
      this.track.trimLenFrames,
      this.track.buffer.duration,
      fps,
    );
    const at = bufferOffsetForFrame(frame, this.track.offsetFrames, fps); // KEPT-SPAN time
    const plan = audioPlayPlan(at, lenS); // ...so the trimmed tail reuses the existing guard
    if (plan.kind === "silence") {
      this.stop(); // clip already over → silent, animation continues
      return;
    }
    const ctx = getAudioContext();
    void ctx.resume();
    this.stop();
    const src = ctx.createBufferSource();
    src.buffer = this.track.buffer;
    src.connect(ctx.destination);
    // `inS` is added HERE and nowhere else: this is the one place buffer time is needed.
    if (plan.kind === "offset") src.start(0, plan.offsetS + inS, lenS - plan.offsetS);
    else src.start(ctx.currentTime + plan.delayS, inS, lenS);
    this.source = src;
```

- [ ] **Step 4: Wire `scrub` to the trim**

In `scrub`, replace the `const at =` line and the guard below it, and the `src.start(0, at)` line:

```ts
    const { inS, lenS } = audioTrimSpan(
      this.track.trimInFrames,
      this.track.trimLenFrames,
      this.track.buffer.duration,
      fps,
    );
    const at = bufferOffsetForFrame(frame, this.track.offsetFrames, fps);
    if (at < 0 || at >= lenS) return; // playhead outside the TRIMMED clip → silence
```

and

```ts
    src.start(0, at + inS);
```

- [ ] **Step 5: Run the full suite and the build gate**

Run: `npm test && npm run build`
Expected: all tests pass (567 + Task 1's 16 + 2 here), `0 ERRORS 0 WARNINGS`.

- [ ] **Step 6: Commit**

```bash
git add src/audio/engine.ts src/__tests__/audio.test.ts
git commit -m "feat: playback honours the audio trim

audioPlayPlan is unchanged: passing the trimmed length instead of the
buffer's duration makes its existing at >= duration guard cover the
trimmed tail. Only the engine changes, adding the in-point at the
start() call and a play duration.

The in-point is added ONLY there. audioPlayPlan reasons in kept-span
time and start() needs buffer time; folding the in-point into `at` while
passing the trimmed length as duration would cut every trimmed clip
short by exactly the in-point.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Export renders only the kept span

**Files:**
- Modify: `src/export/audio-mix.ts` (`AudioExportInput`/`AudioExportPlan`, `audioExportPlan`, `buildExportAudio`)
- Test: `src/__tests__/audio-export.test.ts`

**Interfaces:**
- Consumes: `audioTrimSpan` (Task 1); `bufferOffsetForFrame` (existing).
- Produces: `AudioExportPlan.sourceDuration: number` — seconds of source to play from `sourceOffset`.

**Keep module scope DOM-free** above `buildExportAudio`: `audioExportPlan` is imported by node tests.
`audioTrimSpan` is pure, so importing it at the top is safe.

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/audio-export.test.ts`. Match the existing tests' construction of the input
object; the fields below are the ones `audioExportPlan` reads.

```ts
describe("audioExportPlan with a trimmed clip", () => {
  it("an untrimmed clip renders its whole buffer", () => {
    const p = audioExportPlan(
      { offsetFrames: 0, muted: false, durationS: 10, trimInFrames: undefined, trimLenFrames: undefined },
      12,
      120,
    );
    expect(p).toEqual({ windowS: 10, startAt: 0, sourceOffset: 0, sourceDuration: 10 });
  });

  it("a tail trim shortens sourceDuration without moving the start", () => {
    const p = audioExportPlan(
      { offsetFrames: 0, muted: false, durationS: 10, trimInFrames: 0, trimLenFrames: 48 },
      12,
      120,
    );
    expect(p).toEqual({ windowS: 10, startAt: 0, sourceOffset: 0, sourceDuration: 4 });
  });

  it("a head trim starts further into the source", () => {
    // trimHead moved offsetFrames to 24 alongside trimInFrames, so the audio stays at frame 24.
    const p = audioExportPlan(
      { offsetFrames: 24, muted: false, durationS: 10, trimInFrames: 24, trimLenFrames: 96 },
      12,
      120,
    );
    expect(p).toEqual({ windowS: 10, startAt: 2, sourceOffset: 2, sourceDuration: 8 });
  });

  it("returns null when the TRIMMED span falls entirely outside the window", () => {
    // Kept span is one frame, dragged past the last frame: no audio track at all, not a silent one.
    expect(
      audioExportPlan(
        { offsetFrames: 240, muted: false, durationS: 10, trimInFrames: 0, trimLenFrames: 1 },
        12,
        120,
      ),
    ).toBeNull();
  });

  it("still returns null for a muted track", () => {
    expect(
      audioExportPlan(
        { offsetFrames: 0, muted: true, durationS: 10, trimInFrames: 0, trimLenFrames: 48 },
        12,
        120,
      ),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/audio-export.test.ts`
Expected: FAIL — the returned object has no `sourceDuration`.

- [ ] **Step 3: Extend the input and plan types**

In `src/export/audio-mix.ts`, add to `AudioExportInput`:

```ts
  trimInFrames?: number;
  trimLenFrames?: number;
```

and to `AudioExportPlan`:

```ts
  /** Seconds of source to play from `sourceOffset`, so the trimmed tail is not rendered. */
  sourceDuration: number;
```

- [ ] **Step 4: Compute it**

Add the import at the top of the file (pure, so module scope stays DOM-free):

```ts
import { audioTrimSpan } from "../audio/trim";
```

Replace the body of `audioExportPlan` after the `muted` guard:

```ts
  const windowS = frameCount / fps;
  const { inS, lenS } = audioTrimSpan(
    input.trimInFrames,
    input.trimLenFrames,
    input.durationS,
    fps,
  );
  const at = bufferOffsetForFrame(0, input.offsetFrames, fps); // KEPT-SPAN time
  const startAt = at >= 0 ? 0 : -at;
  const keptOffset = at >= 0 ? at : 0; // seconds into the KEPT span
  if (startAt >= windowS || keptOffset >= lenS) return null;
  return {
    windowS,
    startAt,
    // Buffer time: the in-point is added HERE, the same rule the engine follows.
    sourceOffset: keptOffset + inS,
    // Never render past the kept span, nor past the window.
    sourceDuration: Math.min(lenS - keptOffset, windowS - startAt),
  };
```

- [ ] **Step 5: Pass it to the render**

In `buildExportAudio`, extend the object handed to `audioExportPlan`:

```ts
      durationS: track.buffer.duration,
      trimInFrames: track.trimInFrames,
      trimLenFrames: track.trimLenFrames,
```

and give `start()` its third argument:

```ts
  src.start(plan.startAt, plan.sourceOffset, plan.sourceDuration);
```

- [ ] **Step 6: Run the tests and the build gate**

Run: `npx vitest run src/__tests__/audio-export.test.ts && npm run build`
Expected: PASS, `0 ERRORS 0 WARNINGS`.

- [ ] **Step 7: Commit**

```bash
git add src/export/audio-mix.ts src/__tests__/audio-export.test.ts
git commit -m "feat: export renders only the kept audio span

AudioExportPlan gains sourceDuration, passed as start()'s third argument
inside the existing OfflineAudioContext — placement, truncation,
resampling and now trimming stay ONE render.

sourceOffset adds the in-point, matching the engine: the plan reasons in
kept-span time and start() needs buffer time. A clip whose trimmed span
falls entirely outside the window returns null, so the file carries no
audio track rather than a silent one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Persist the trim

**Files:**
- Modify: `src/persist/project-file.ts` (the `audio` field of `ProjectJson` ~line 135; the serialize block ~line 224; the deserialize block ~line 427)
- Test: `src/__tests__/persist.test.ts`

**Interfaces:**
- Consumes: `AudioTrack.trimInFrames`/`trimLenFrames` (Task 1).
- Produces: two optional numbers on the audio JSON.

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/persist.test.ts`. Build the `Project` inline the way the neighbouring
`describe("projectToJson")` tests do; the audio object needs `name`, `bytes`, `buffer`,
`offsetFrames`, `muted` plus the two new fields, and `buffer` can be `{ duration: 10 }` cast, since
`projectToJson` only reads the scalars.

```ts
describe("audio trim persistence", () => {
  const audio = (over = {}) =>
    ({
      name: "take.wav",
      bytes: new Uint8Array(0),
      buffer: { duration: 10 } as unknown as AudioBuffer,
      offsetFrames: 0,
      muted: false,
      ...over,
    }) as unknown as Project["audio"];

  it("round-trips a trimmed clip", () => {
    const p = {
      name: "t",
      width: 800,
      height: 600,
      fps: 8,
      bgColor: "#eee",
      frameCount: 2,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [dlayer(1, [key(), hold()])],
      audio: audio({ trimInFrames: 24, trimLenFrames: 96 }),
    } as unknown as Project;
    expect(projectToJson(p).audio).toMatchObject({ trimInFrames: 24, trimLenFrames: 96 });
  });

  it("an untrimmed clip writes no trim fields", () => {
    const p = {
      name: "t",
      width: 800,
      height: 600,
      fps: 8,
      bgColor: "#eee",
      frameCount: 2,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [dlayer(1, [key(), hold()])],
      audio: audio(),
    } as unknown as Project;
    const j = projectToJson(p).audio!;
    expect(j.trimInFrames).toBeUndefined();
    expect(j.trimLenFrames).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/persist.test.ts -t "audio trim"`
Expected: FAIL — `trimInFrames` is undefined on the serialized audio (and a TS error that it is not
on the JSON type).

- [ ] **Step 3: Extend the JSON type**

In `src/persist/project-file.ts`, change the `audio` field of `ProjectJson`:

```ts
  audio: {
    name: string;
    offsetFrames: number;
    muted: boolean;
    trimInFrames?: number;
    trimLenFrames?: number;
  } | null;
```

- [ ] **Step 4: Serialize**

In `projectToJson`'s audio block, after `muted: project.audio.muted,`:

```ts
          trimInFrames: project.audio.trimInFrames,
          trimLenFrames: project.audio.trimLenFrames,
```

- [ ] **Step 5: Deserialize**

Find where the loader rebuilds the audio track (it reads `aj.offsetFrames`) and add, alongside the
other fields:

```ts
        trimInFrames: aj.trimInFrames,
        trimLenFrames: aj.trimLenFrames,
```

No `??` fallback — absent must stay absent, because absent is what "untrimmed" means.

- [ ] **Step 6: Run the full suite and the build gate**

Run: `npm test && npm run build`
Expected: PASS, `0 ERRORS 0 WARNINGS`. Existing audio round-trip tests keep passing — Vitest's
`toEqual` ignores `undefined` properties, so an untrimmed track serializes as before.

- [ ] **Step 7: Commit**

```bash
git add src/persist/project-file.ts src/__tests__/persist.test.ts
git commit -m "feat: persist the audio trim

Two optional numbers on the audio JSON; format version stays 1, and an
old project loads untrimmed. The encoded bytes are untouched, so
widening a handle after a reload recovers the audio.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Undo plumbing and the trim action

**Files:**
- Modify: `src/state/appState.svelte.ts` (`StructSnapshot` ~line 236, `snapshotStructure`, `restoreStructure`, and a new exported action)

**Interfaces:**
- Consumes: `AudioTrack.trimInFrames`/`trimLenFrames` (Task 1).
- Produces: `setAudioTrim(trimInFrames: number, trimLenFrames: number, offsetFrames: number): void` — writes all three in one go, for the head-trim case where offset and in-point must move together.

**No unit test:** `appState.svelte.ts` is not node-importable. Build + review, per convention.

**Why the snapshot needs scalars, not just the track:** `StructSnapshot` already holds `audio` by
reference plus `audioOffsetFrames`/`audioMuted` as separate numbers, because those are written IN
PLACE on the shared track object, so `snap.audio.offsetFrames` tracks the live value and cannot be a
before-state (gotcha #8). The trim fields are written in place too, so they must join as scalars —
and their writer must push a command. Adding the fields without bracketing the writer reproduces the
bug fixed on 2026-08-15, where an unrelated structural undo silently reverted a non-undoable audio
write.

- [ ] **Step 1: Add the snapshot fields**

In `export interface StructSnapshot`, after `audioMuted`:

```ts
  /** Trim, captured as scalars for the same reason the offset is: both are written in place on the
   *  shared `audio` object, so the reference cannot carry their before-state. */
  audioTrimInFrames: number | null;
  audioTrimLenFrames: number | null;
```

- [ ] **Step 2: Capture them**

In `snapshotStructure`, after the `audioMuted` line:

```ts
    audioTrimInFrames: state.project.audio?.trimInFrames ?? null,
    audioTrimLenFrames: state.project.audio?.trimLenFrames ?? null,
```

- [ ] **Step 3: Restore them**

In `restoreStructure`, inside the existing `if (state.project.audio) { … }` block that restores the
offset and mute:

```ts
    state.project.audio.trimInFrames = s.audioTrimInFrames ?? undefined;
    state.project.audio.trimLenFrames = s.audioTrimLenFrames ?? undefined;
```

Assign unconditionally inside that block, unlike the offset's `!== null` guard: `null` here means
"was untrimmed", and restoring that state has to CLEAR the fields, not skip them.

- [ ] **Step 4: Add the action**

Next to `setAudioTrack`/`removeAudioTrack`:

```ts
/** Write a completed trim gesture. Takes `offsetFrames` too because a HEAD trim moves it and
 *  `trimInFrames` by the same delta — the two must land in one undo entry, or undoing would leave
 *  the clip trimmed but re-synced. Not wrapped in `commitStructural`: the lane brackets the whole
 *  drag itself, so one gesture is one entry. */
export function setAudioTrim(
  trimInFrames: number,
  trimLenFrames: number,
  offsetFrames: number,
): void {
  const t = state.project.audio;
  if (!t) return;
  t.trimInFrames = trimInFrames;
  t.trimLenFrames = trimLenFrames;
  t.offsetFrames = offsetFrames;
  bump();
}
```

- [ ] **Step 5: Run the build gate and the full suite**

Run: `npm run build && npm test`
Expected: `0 ERRORS 0 WARNINGS`, all tests pass (count unchanged — this task adds none).

- [ ] **Step 6: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat: audio trim is covered by undo

StructSnapshot gains the two trim fields as scalars, for the same reason
the offset is one: both are written in place on the shared track object,
so the reference cannot carry their before-state.

Restoring assigns unconditionally — null means 'was untrimmed', and that
state has to CLEAR the fields rather than be skipped.

setAudioTrim writes the trim and the offset together, because a head
trim moves both and undoing half of it would leave the clip trimmed but
re-synced.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Lane handles and dimmed trimmed audio

**Files:**
- Modify: `src/lib/AudioLane.svelte` (the `waveform` action's draw function; the clip markup)

**Interfaces:**
- Consumes: `trimHead`, `trimTail`, `AUDIO_MIN_TRIM_FRAMES` (Task 1); `audioFrameSpan` from `src/audio/peaks.ts`; `setAudioTrim` (Task 5); `beginStructuralEdit`, `commitStructuralEdit`, `transformDragGuard` (existing).
- Produces: no new exports.

**No unit test:** Svelte markup and a canvas draw. Build + review, per convention.

- [ ] **Step 1: Draw the trimmed head and tail dimmed**

The canvas already draws the whole buffer and already dims the region past the last frame. Add the
same treatment for the trimmed regions. In the `waveform` action's `draw`, after `docEndX` is
computed, add the kept span's pixel bounds:

```ts
      // Trimmed head/tail stay drawn, dimmed, so you can see what was cut and drag it back.
      // Same tokens and alpha the past-the-last-frame tail already uses.
      const fps2 = state.project.fps;
      const extentFrames = audioFrameSpan(audio.buffer.duration, fps2);
      const keptFrom = Math.max(0, audio.trimInFrames ?? 0);
      const keptTo = Math.min(extentFrames, keptFrom + (audio.trimLenFrames ?? extentFrames - keptFrom));
      const pxPerFrame = (w / naturalW) * cellW;
      const keptX0 = keptFrom * pxPerFrame;
      const keptX1 = keptTo * pxPerFrame;
```

Then, immediately after the existing plate fill, overpaint the trimmed regions with the dim token:

```ts
      if (keptX0 > 0 || keptX1 < w) {
        ctx.fillStyle = token("--color-media-clip-dim", "#24272f");
        if (keptX0 > 0) ctx.fillRect(0, 0, keptX0, node.height);
        if (keptX1 < w) ctx.fillRect(keptX1, 0, w - keptX1, node.height);
      }
```

and in the peak loop, dim a column that is outside the kept span as well as one past the doc end:

```ts
        ctx.globalAlpha = x >= keptX0 && x < keptX1 && x < docEndX ? 1 : 0.25;
```

Add `audioFrameSpan` to the existing import from `../audio/peaks`.

- [ ] **Step 2: Add the trim drag state and handlers**

In the script block, next to the existing `dragStart`/`settleLaneDrag`:

```ts
  import { trimHead, trimTail, AUDIO_MIN_TRIM_FRAMES } from "../audio/trim";
  import { audioFrameSpan } from "../audio/peaks";
  import { setAudioTrim } from "../state/appState.svelte";

  // Edge trim. Separate from the body drag (which slides offsetFrames) but brackets undo the same
  // way: one entry per completed gesture, settle registered so a mid-drag undo cannot leave it open.
  let trimDrag: {
    edge: "head" | "tail";
    x: number;
    from: { offsetFrames: number; trimInFrames: number; trimLenFrames: number };
    undo: ReturnType<typeof beginStructuralEdit>;
  } | null = null;

  function trimDown(e: PointerEvent, edge: "head" | "tail") {
    const audio = state.project.audio;
    if (!audio) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (e.pointerType === "touch") {
      onTouchDown(e); // finger navigates, pen/mouse edits
      return;
    }
    if (trimDrag) return; // a handle already owns this gesture
    const extent = audioFrameSpan(audio.buffer.duration, state.project.fps);
    trimDrag = {
      edge,
      x: e.clientX,
      from: {
        offsetFrames: audio.offsetFrames,
        trimInFrames: audio.trimInFrames ?? 0,
        trimLenFrames: audio.trimLenFrames ?? extent - (audio.trimInFrames ?? 0),
      },
      undo: beginStructuralEdit(),
    };
    transformDragGuard.settle = () => settleTrimDrag();
  }

  function trimMove(e: PointerEvent) {
    if (e.pointerType === "touch") {
      onTouchMove(e);
      return;
    }
    const audio = state.project.audio;
    if (!trimDrag || !audio) return;
    const delta = Math.round((e.clientX - trimDrag.x) / cellW);
    const extent = audioFrameSpan(audio.buffer.duration, state.project.fps);
    const f = trimDrag.from;
    const next =
      trimDrag.edge === "head"
        ? trimHead(f.offsetFrames, f.trimInFrames, f.trimLenFrames, delta, extent)
        : { offsetFrames: f.offsetFrames, ...trimTail(f.trimInFrames, f.trimLenFrames, delta, extent) };
    // Compare against the CURRENT EFFECTIVE values, not against `delta === 0`.
    //   - A tap writes nothing, because next equals what is already there (so no autosave re-arm,
    //     and an untrimmed clip is not silently materialised into explicit 0/extent fields).
    //   - A drag that goes out and comes BACK to its start still writes, restoring the clip.
    // An early `if (delta === 0) return` gets the first right and the second wrong: it would leave
    // the clip stranded at the last non-zero delta, so a gesture could not be cancelled by
    // returning to where it began.
    const curIn = audio.trimInFrames ?? 0;
    const curLen = audio.trimLenFrames ?? extent - curIn;
    if (
      audio.offsetFrames === next.offsetFrames &&
      curIn === next.trimInFrames &&
      curLen === next.trimLenFrames
    )
      return;
    setAudioTrim(next.trimInFrames, next.trimLenFrames, next.offsetFrames);
  }

  /** Commit iff the gesture changed something — a click without a drag must push nothing. */
  function settleTrimDrag() {
    if (!trimDrag) return;
    const audio = state.project.audio;
    const f = trimDrag.from;
    const changed =
      !!audio &&
      (audio.offsetFrames !== f.offsetFrames ||
        (audio.trimInFrames ?? 0) !== f.trimInFrames ||
        audio.trimLenFrames !== f.trimLenFrames);
    if (changed) commitStructuralEdit(trimDrag.undo);
    trimDrag = null;
    transformDragGuard.settle = null;
  }

  function trimUp(e: PointerEvent) {
    if (e.pointerType === "touch") {
      onTouchUp();
      return;
    }
    if (trimDrag && state.playback.isPlaying)
      audioEngine.syncTo(state.playhead, state.project.fps);
    settleTrimDrag();
  }
```

- [ ] **Step 3: Guard the body drag against a handle press**

In `laneDown`, add as the FIRST line after the `state.project.audio` check:

```ts
    if (trimDrag) return; // a trim handle already claimed this gesture
```

This is how the reference clip resolves the same overlap. Do NOT use `stopPropagation` on the
handles: it would suppress `App.svelte`'s window-level status-hint listener for the very pointer
performing the gesture.

- [ ] **Step 4: Add the handle elements**

The `<canvas>` is currently a bare child of the lane's flex row and carries the clip's position in
its OWN `margin-left`. Absolute handles need a positioned ancestor sharing that origin, so first wrap
it: move `margin-left: {state.project.audio.offsetFrames * cellW}px` off the canvas and onto a new
`<div class="relative">` around it (the canvas keeps `touch-action: none` and its handlers). Handle
positions are then measured from the buffer's frame 0, which is that wrapper's left edge.

Inside that wrapper, after the `<canvas>`, add two handles anchored to the kept span's ends.
`AUDIO_MIN_TRIM_FRAMES` keeps them from overlapping on a 1-frame clip:

```svelte
      {@const _extent = audioFrameSpan(state.project.audio.buffer.duration, state.project.fps)}
      {@const _in = state.project.audio.trimInFrames ?? 0}
      {@const _len = state.project.audio.trimLenFrames ?? _extent - _in}
      <div
        class="absolute inset-y-0 z-20 w-2 cursor-ew-resize"
        style="left: {_in * cellW}px; touch-action: none"
        role="presentation"
        title="Trim the start of the audio"
        onpointerdown={(e) => trimDown(e, "head")}
        onpointermove={trimMove}
        onpointerup={trimUp}
        onpointercancel={trimUp}
      ></div>
      <div
        class="absolute inset-y-0 z-20 w-2 cursor-ew-resize"
        style="left: {Math.max(_in + AUDIO_MIN_TRIM_FRAMES, _in + _len) * cellW - 8}px; touch-action: none"
        role="presentation"
        title="Trim the end of the audio"
        onpointerdown={(e) => trimDown(e, "tail")}
        onpointermove={trimMove}
        onpointerup={trimUp}
        onpointercancel={trimUp}
      ></div>
```

Both are inside the new `relative` wrapper, so their `left` is in buffer-frame space and needs no
`offsetFrames` term — the wrapper already carries it.

- [ ] **Step 5: Run the build gate, tests and lint**

Run: `npm run build && npm test && npm run lint`
Expected: `0 ERRORS 0 WARNINGS`, all tests pass (unchanged count), lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/AudioLane.svelte
git commit -m "feat: trim the audio clip from its lane handles

The canvas keeps drawing the whole buffer; the trimmed head and tail are
overpainted with the dim token and their peaks drop to the same 0.25
alpha the past-the-last-frame tail already uses, so you can see what was
cut and drag it back.

Two 8px edge handles with touch-action:none and pointercancel bound,
bracketing undo per completed gesture. The body drag bails when a handle
owns the gesture rather than the handles calling stopPropagation, which
would suppress the status-hint listener.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Documentation

**Files:**
- Modify: `README.md` (Features bullets, test count)
- Modify: `CLAUDE.md` (a dated entry after the most recent one)
- Modify: `docs/superpowers/specs/2026-08-16-audio-clip-trim-design.md` (Status line)

- [ ] **Step 1: Update the README**

Run `npm test` first and use the ACTUAL number, never a guess. Add a Features bullet that the audio
clip can be trimmed on the timeline; update the test count in the scripts block.

- [ ] **Step 2: Add the CLAUDE.md entry**

Append an `**Audio clip trim (2026-08-16):**` entry covering: the two optional source-frame fields
and absent-means-untrimmed; **the two coordinate systems** and why the in-point is added only at
`start()` (the bug the spec's self-review caught); why `trimHead` clamps the DELTA rather than the
two results; that `audioPlayPlan` needed no signature change because a smaller `duration` moves its
existing silence boundary; the export's single render gaining `sourceDuration`; the snapshot scalars
and why they cannot be read off `snap.audio`; that restoring assigns unconditionally because `null`
means "was untrimmed"; non-destructive `bytes`; and the owed browser pass below.

- [ ] **Step 3: Flip the spec status**

Change the spec's `**Status:**` line to `Implemented (2026-08-16)`.

- [ ] **Step 4: Verify the whole gate**

Run: `npm run build && npm test && npm run lint`
Expected: `0 ERRORS 0 WARNINGS`, all pass, lint clean.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md docs/superpowers/specs/2026-08-16-audio-clip-trim-design.md
git commit -m "docs: audio clip trim

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Owed a browser pass (carried from the spec)

Tasks 5 and 6 have no unit tests and Task 2's real behaviour is audible, so after implementation
verify: trim head and tail and hear the result match the waveform; **a head trim leaves the kept
audio at the same project frame** (the sync-preserving property — check this first); drag a handle
back out and recover the audio; trim → undo → redo; ⌘Z mid-drag; a trimmed clip exports with exactly
the kept span; a trim that puts the clip entirely outside the window exports with no audio track and
still succeeds; scrub inside and outside the trimmed span; mute unchanged; save → reload preserves
the trim and the bytes; an old project opens untrimmed; iPad for the handles (`touch-action`,
finger-pan vs pen-trim).
