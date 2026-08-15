# Reference Layer Visibility Ranges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reference layer draws only over a span of project frames, and that span is the clip block you see and drag on its timeline row.

**Architecture:** One optional `range` field on `ReferenceLayer` (images only — a video's span is derived from its footage), resolved by a pure `refVisibleSpan`. A single gate in `buildFrameDrawList` makes the range real for the editor, export and onion at once, because that function has exactly one production consumer. The timeline grows an image clip block with edge handles; trim and slide are undoable through the existing structural-edit bracket.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vite, Tailwind 4, Vitest (node env, no DOM).

**Spec:** `docs/superpowers/specs/2026-08-15-reference-layer-ranges-design.md`

## Global Constraints

- **Build gate:** `npm run build` (`svelte-check && tsc --noEmit && vite build`) must report **0 errors, 0 warnings** before any commit.
- **Test baseline:** `npm test` is currently **508 passing**. Never let it go down.
- **Lint:** `npm run lint` clean. The pre-commit hook auto-runs `eslint --fix` + `prettier --write`; expect reformatting on commit.
- **Only pure logic is unit-tested.** Vitest runs in node with no DOM. Canvas/Svelte/DOM code is build+review-verified by project convention — do not add a DOM harness.
- **`appState.svelte.ts` is NOT node-importable** (it touches window/audio at module load). Never write a unit test that imports it.
- **Format version stays 1.** `range` is an optional field; an old file loads without it.
- **Range is inclusive** on both ends: `{ start, end }` covers frames `start..end`.
- **Absent `range` means "always visible"**, never "empty".
- **Never mutate `layer.range` in place.** Always assign a new object (`layer.range = { start, end }`), matching the cell-replacement discipline in gotcha #8.
- **Every new drag surface needs `touch-action: none` and a bound `pointercancel`** (gotchas #10 and the 2026-08-15 pinch-cancel finding).
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

### Task 1: Range resolver

**Files:**
- Modify: `src/anim/document.ts` (add to the `ReferenceLayer` interface; add two exported functions near `isLayerVisible`)
- Test: `src/__tests__/document.test.ts`

**Interfaces:**
- Consumes: `videoClipLayout` from `src/anim/clip-layout.ts` (existing, no imports of its own, so no cycle).
- Produces:
  - `ReferenceLayer.range?: { start: number; end: number }`
  - `refVisibleSpan(layer: ReferenceLayer, fps: number): { start: number; end: number } | null`
  - `isRefVisibleAtFrame(layer: ReferenceLayer, frame: number, fps: number): boolean`

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/document.test.ts`. Add `refVisibleSpan` and `isRefVisibleAtFrame` to the existing import block from `../anim/document`.

```ts
describe("refVisibleSpan / isRefVisibleAtFrame", () => {
  const imageRef = (over: Partial<ReferenceLayer> = {}): ReferenceLayer =>
    ({
      kind: "ref",
      id: 1,
      name: "R",
      visible: true,
      opacity: 60,
      offsetFrames: 0,
      speed: 1,
      audioEnabled: false,
      groupId: null,
      media: { type: "image", el: {} as HTMLImageElement },
      transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
      ...over,
    }) as ReferenceLayer;

  const videoRef = (duration: number, over: Partial<ReferenceLayer> = {}): ReferenceLayer =>
    imageRef({
      media: { type: "video", el: { duration } as HTMLVideoElement },
      ...over,
    });

  it("an untrimmed image is ALWAYS visible (null span)", () => {
    const l = imageRef();
    expect(refVisibleSpan(l, 12)).toBeNull();
    expect(isRefVisibleAtFrame(l, 0, 12)).toBe(true);
    expect(isRefVisibleAtFrame(l, 9999, 12)).toBe(true);
  });

  it("a trimmed image uses its stored range, inclusive on both ends", () => {
    const l = imageRef({ range: { start: 6, end: 14 } });
    expect(refVisibleSpan(l, 12)).toEqual({ start: 6, end: 14 });
    expect(isRefVisibleAtFrame(l, 5, 12)).toBe(false);
    expect(isRefVisibleAtFrame(l, 6, 12)).toBe(true); // boundary
    expect(isRefVisibleAtFrame(l, 14, 12)).toBe(true); // boundary
    expect(isRefVisibleAtFrame(l, 15, 12)).toBe(false);
  });

  it("a video's span is DERIVED from its footage", () => {
    // 2s at 12fps, speed 1, no offset -> 24 frames, 0..23
    expect(refVisibleSpan(videoRef(2), 12)).toEqual({ start: 0, end: 23 });
  });

  it("a video's derived span honours offsetFrames and speed", () => {
    // offset -12 shifts the visible start to frame 12; 2s at 2x -> 12 frames, 12..23
    expect(refVisibleSpan(videoRef(2, { offsetFrames: -24, speed: 2 }), 12)).toEqual({
      start: 12,
      end: 23,
    });
  });

  it("a video with no duration yet is ALWAYS visible, not blank", () => {
    // preload="metadata" is lazy; blinking out on first paint would look like a bug
    expect(refVisibleSpan(videoRef(NaN), 12)).toBeNull();
    expect(refVisibleSpan(videoRef(0), 12)).toBeNull();
    expect(refVisibleSpan(videoRef(Infinity), 12)).toBeNull();
  });

  it("a video IGNORES a stored range (its span is its footage)", () => {
    const l = videoRef(2, { range: { start: 100, end: 200 } });
    expect(refVisibleSpan(l, 12)).toEqual({ start: 0, end: 23 });
  });

  it("missing media is always (nothing to draw either way)", () => {
    const l = imageRef({
      media: { type: "missing", was: "image", name: "x" },
      range: { start: 3, end: 5 },
    });
    expect(refVisibleSpan(l, 12)).toBeNull();
  });

  it("a sub-frame video still spans exactly one frame", () => {
    // An EMPTY span is unreachable: dur <= 0 returns null before deriving, and ceil() of any
    // positive duration is >= 1. So the floor is one frame, not zero.
    const l = videoRef(0.0001);
    expect(refVisibleSpan(l, 12)).toEqual({ start: 0, end: 0 });
    expect(isRefVisibleAtFrame(l, 0, 12)).toBe(true);
    expect(isRefVisibleAtFrame(l, 1, 12)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/document.test.ts`
Expected: FAIL — `refVisibleSpan is not a function` (and a TS error that `range` is not on `ReferenceLayer`).

- [ ] **Step 3: Add the model field**

In `src/anim/document.ts`, inside `export interface ReferenceLayer`, after the `locked?` field:

```ts
  /** Inclusive project-frame span this ref draws over. ABSENT = always visible (follows the
   *  project's length, so lengthening the animation cannot strand it). Images only — a video's
   *  span is DERIVED from its footage, see refVisibleSpan. */
  range?: { start: number; end: number };
```

- [ ] **Step 4: Implement the resolver**

At the top of `src/anim/document.ts`, add the import:

```ts
import { videoClipLayout } from "./clip-layout";
```

Then add, immediately after `isLayerVisible`:

```ts
/** The inclusive project-frame span a reference draws over, or null for "always visible".
 *  A video's span IS its footage (derived, so there is only ever one span to reason about);
 *  an image has no footage, so its span is whatever the artist trimmed. */
export function refVisibleSpan(
  layer: ReferenceLayer,
  fps: number,
): { start: number; end: number } | null {
  if (layer.media.type === "video") {
    const dur = layer.media.el.duration;
    // Metadata loads lazily (preload="metadata"). With no duration there is no span to derive,
    // and blinking the layer out on first paint would read as a bug, so treat it as always.
    if (!Number.isFinite(dur) || dur <= 0) return null;
    const { startFrame, spanFrames } = videoClipLayout(layer.offsetFrames, layer.speed, dur, fps);
    return { start: startFrame, end: startFrame + spanFrames - 1 };
  }
  // Missing media draws nothing either way; a stored range on a video is ignored rather than an
  // error, so a range survives a re-link to video and comes back on a re-link to an image.
  if (layer.media.type === "missing") return null;
  return layer.range ?? null;
}

export function isRefVisibleAtFrame(layer: ReferenceLayer, frame: number, fps: number): boolean {
  const span = refVisibleSpan(layer, fps);
  return span === null || (frame >= span.start && frame <= span.end);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/document.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the build gate**

Run: `npm run build`
Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 7: Commit**

```bash
git add src/anim/document.ts src/__tests__/document.test.ts
git commit -m "feat: resolve a reference layer's visible frame span

An image stores an optional inclusive range (absent = always visible, so
it follows the project's length); a video derives its span from its
footage, so there is only ever one span. A video with no duration yet
resolves to always, because preload is lazy and blinking out on first
paint would look like a bug.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Gate rendering on the span

**Files:**
- Modify: `src/anim/document.ts` (`buildFrameDrawList`, the `else` branch around line 266)
- Test: `src/__tests__/document.test.ts`

**Interfaces:**
- Consumes: `isRefVisibleAtFrame` from Task 1.
- Produces: no new exports. `buildFrameDrawList` now omits out-of-span refs.

**Why one line is enough:** `buildFrameDrawList` has exactly one production consumer, `renderFrame` at `src/anim/render.ts:197`, which serves the editor, export and onion skins alike. There is no second path to keep in sync.

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe("buildFrameDrawList", …)` block in `src/__tests__/document.test.ts`:

```ts
it("omits a reference outside its range, keeps it inside", () => {
  const ref = {
    kind: "ref",
    id: 9,
    name: "R",
    visible: true,
    opacity: 60,
    offsetFrames: 0,
    speed: 1,
    audioEnabled: false,
    groupId: null,
    media: { type: "image", el: {} as HTMLImageElement },
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
    range: { start: 2, end: 4 },
  } as unknown as Layer;
  const p = { layers: [ref], groups: [], fps: 12 } as unknown as Project;

  expect(buildFrameDrawList(p, 1).length).toBe(0);
  expect(buildFrameDrawList(p, 2).map((o) => o.kind)).toEqual(["ref"]);
  expect(buildFrameDrawList(p, 4).map((o) => o.kind)).toEqual(["ref"]);
  expect(buildFrameDrawList(p, 5).length).toBe(0);
});

it("an untrimmed reference still draws on every frame", () => {
  const ref = {
    kind: "ref",
    id: 9,
    name: "R",
    visible: true,
    opacity: 60,
    offsetFrames: 0,
    speed: 1,
    audioEnabled: false,
    groupId: null,
    media: { type: "image", el: {} as HTMLImageElement },
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  } as unknown as Layer;
  const p = { layers: [ref], groups: [], fps: 12 } as unknown as Project;
  expect(buildFrameDrawList(p, 0).length).toBe(1);
  expect(buildFrameDrawList(p, 500).length).toBe(1);
});
```

`Layer` is already imported as a type in this test file; if not, add it to the type import from `../anim/document`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/document.test.ts -t "outside its range"`
Expected: FAIL — the first assertion gets 1 op instead of 0.

- [ ] **Step 3: Add the gate**

In `buildFrameDrawList`, change the `else` branch to:

```ts
    } else {
      if (!includeReference) continue;
      if (!isRefVisibleAtFrame(layer, frame, project.fps)) continue;
      ops.push({ kind: "ref", layerId: layer.id, opacity: layer.opacity });
    }
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, count up by 2 from baseline plus Task 1's additions.

- [ ] **Step 5: Run the build gate**

Run: `npm run build`
Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 6: Commit**

```bash
git add src/anim/document.ts src/__tests__/document.test.ts
git commit -m "feat: a reference draws only inside its visible span

buildFrameDrawList has a single production consumer (renderFrame), so
this one gate covers the editor, export and onion skins with no second
path to keep in sync.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Stop syncing a video outside its span

**Files:**
- Modify: `src/anim/reference.ts` (`syncReferenceVideos`, the loop body starting `const vid = layer.media.el;`)
- Test: `src/__tests__/reference.test.ts`

**Interfaces:**
- Consumes: `isRefVisibleAtFrame` from Task 1.
- Produces: no new exports.

**Background:** `Math.max(0, Math.min(dur, wanted))` is exactly what manufactured the frozen first/last frame this feature removes. With Task 2's gate an out-of-span frame never composites, so seeking for it wakes the decoder for nothing — the same waste the `persistTick` split existed to remove.

- [ ] **Step 1: Teach the fake video to pause**

`fakeVid` in `src/__tests__/reference.test.ts` has `play()` but no `pause()`. Add it inside the returned object, after `play()`:

```ts
    pauseCount: 0,
    pause() {
      this.pauseCount++;
      this.paused = true;
    },
```

- [ ] **Step 2: Write the failing tests**

Add to `src/__tests__/reference.test.ts`. Note `vidLayer` builds a layer with `duration` on the element, so its span is derived — a 10s clip at 12fps starting at offset 0 spans frames 0..119.

```ts
describe("out-of-span videos", () => {
  it("does not seek a video whose frame is past its footage", () => {
    const v = fakeVid({ duration: 2, currentTime: 0 }); // 2s @ 12fps -> frames 0..23
    syncReferenceVideos(proj([vidLayer(v)]), 100, 12);
    expect(v.currentTime).toBe(0); // untouched, NOT clamped to the last frame
  });

  it("pauses a running video that leaves its span", () => {
    const v = fakeVid({ duration: 2, paused: false, currentTime: 1.9 });
    syncReferenceVideos(proj([vidLayer(v)]), 100, 12, true);
    expect(v.paused).toBe(true);
  });

  it("still syncs normally inside the span", () => {
    const v = fakeVid({ duration: 2, currentTime: 0 });
    syncReferenceVideos(proj([vidLayer(v)]), 12, 12);
    expect(v.currentTime).toBeCloseTo(1);
  });

  it("a video with no duration is never treated as out of span", () => {
    const v = fakeVid({ duration: NaN, currentTime: 0 });
    syncReferenceVideos(proj([vidLayer(v)]), 50, 12);
    expect(v.currentTime).toBeCloseTo(50 / 12);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/reference.test.ts -t "out-of-span"`
Expected: FAIL — the first test finds `currentTime` clamped to `2` instead of left at `0`.

- [ ] **Step 4: Implement the skip**

In `src/anim/reference.ts`, import the resolver:

```ts
import { isRefVisibleAtFrame } from "./document";
```

(If `reference.ts` already imports from `./document`, add it to that import list instead.)

Then in `syncReferenceVideos`, immediately after `const vid = layer.media.el;`, insert:

```ts
    // Outside its span the ref never composites (buildFrameDrawList gates it), so there is nothing
    // to seek for — and waking the decoder for an undrawn frame is exactly the cost the persistTick
    // split exists to avoid. Pause a running element so it cannot free-run past the gate.
    if (!isRefVisibleAtFrame(layer, frame, fps)) {
      if (!vid.paused) vid.pause();
      continue;
    }
```

Place it **before** the `if (vid.seeking) continue;` guard, so an out-of-span video pauses promptly even while a seek is in flight.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/reference.test.ts`
Expected: PASS, all 20 existing cases plus the 4 new ones.

- [ ] **Step 6: Run the build gate**

Run: `npm run build`
Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 7: Commit**

```bash
git add src/anim/reference.ts src/__tests__/reference.test.ts
git commit -m "feat: skip video sync outside the clip's span

The clamp to [0, duration] is what produced the frozen first/last frame
outside a video clip. With the render gate in place those frames never
composite, so seeking for them only wakes the decoder.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Persist the range

**Files:**
- Modify: `src/persist/project-file.ts` (`ReferenceJson` interface ~line 40; the serialize map ~line 205; the deserialize map ~line 368)
- Test: `src/__tests__/persist.test.ts`

**Interfaces:**
- Consumes: `ReferenceLayer.range` from Task 1.
- Produces: `ReferenceJson.range?: { start: number; end: number }`.

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/persist.test.ts`:

This file's existing helpers are `key()`, `hold()`, `dlayer(id, cells)` and `rlayer(id)` — use
those; do not invent new ones.

```ts
describe("reference range persistence", () => {
  const projWith = (ref: ReferenceLayer): Project => ({
    name: "t",
    width: 800,
    height: 600,
    fps: 8,
    bgColor: "#eee",
    frameCount: 2,
    boil: { enabled: true, amount: 2, cols: 16, rate: 2, weight: 0.4, holdsOnly: true },
    groups: [],
    layers: [dlayer(1, [key(), hold()]), ref],
    audio: null,
  });

  it("round-trips a trimmed image range", () => {
    const l = rlayer(2);
    l.range = { start: 6, end: 14 };
    expect(projectToJson(projWith(l)).references[0].range).toEqual({ start: 6, end: 14 });
  });

  it("an untrimmed reference writes no range", () => {
    expect(projectToJson(projWith(rlayer(2))).references[0].range).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/persist.test.ts -t "range"`
Expected: FAIL — `range` is `undefined` on the serialized reference (and a TS error that `range` is not on `ReferenceJson`).

- [ ] **Step 3: Add the field to the JSON interface**

In `export interface ReferenceJson`, after `locked?: boolean;`:

```ts
  range?: { start: number; end: number }; // absent = always visible
```

- [ ] **Step 4: Serialize it**

In the reference `.map(...)` in `projectToJson`, after `locked: l.locked,`:

```ts
        range: l.range,
```

- [ ] **Step 5: Deserialize it**

In the `for (const rj of refsJson)` loop, in the `value` object after `locked: rj.locked ?? false,`:

```ts
      range: rj.range,
```

No `??` fallback — absent must stay absent, because absent is what "always visible" means.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS. Note the existing "serializes settings … excluding reference layers" test does a full `toEqual` on the references array and keeps passing: Vitest's `toEqual` ignores `undefined` properties. Do not "fix" that test.

- [ ] **Step 7: Run the build gate**

Run: `npm run build`
Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 8: Commit**

```bash
git add src/persist/project-file.ts src/__tests__/persist.test.ts
git commit -m "feat: persist a reference layer's trimmed range

Optional field, format version stays 1: an old file has no range, loads
as always-visible, and renders identically.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Range drag math

**Files:**
- Modify: `src/anim/clip-layout.ts`
- Test: `src/__tests__/clip-layout.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `rangeAfterSlide(range: { start: number; end: number }, deltaFrames: number): { start: number; end: number }`
  - `rangeAfterTrim(range: { start: number; end: number }, edge: "start" | "end", deltaFrames: number): { start: number; end: number }`

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/clip-layout.test.ts`, importing the two new functions:

```ts
describe("rangeAfterSlide", () => {
  it("slides both edges, preserving length", () => {
    expect(rangeAfterSlide({ start: 4, end: 9 }, 3)).toEqual({ start: 7, end: 12 });
    expect(rangeAfterSlide({ start: 4, end: 9 }, -2)).toEqual({ start: 2, end: 7 });
  });

  it("clamps the start at frame 0 WITHOUT shrinking the span", () => {
    expect(rangeAfterSlide({ start: 2, end: 7 }, -10)).toEqual({ start: 0, end: 5 });
  });

  it("may slide past the last frame (the strip sizes for it)", () => {
    expect(rangeAfterSlide({ start: 0, end: 3 }, 1000)).toEqual({ start: 1000, end: 1003 });
  });
});

describe("rangeAfterTrim", () => {
  it("trims the start edge", () => {
    expect(rangeAfterTrim({ start: 4, end: 9 }, "start", 2)).toEqual({ start: 6, end: 9 });
  });

  it("trims the end edge", () => {
    expect(rangeAfterTrim({ start: 4, end: 9 }, "end", -3)).toEqual({ start: 4, end: 6 });
  });

  it("never shrinks below a single frame, from either edge", () => {
    expect(rangeAfterTrim({ start: 4, end: 9 }, "start", 99)).toEqual({ start: 9, end: 9 });
    expect(rangeAfterTrim({ start: 4, end: 9 }, "end", -99)).toEqual({ start: 4, end: 4 });
  });

  it("clamps the start edge at frame 0 but lets the end run past the project", () => {
    expect(rangeAfterTrim({ start: 4, end: 9 }, "start", -99)).toEqual({ start: 0, end: 9 });
    expect(rangeAfterTrim({ start: 4, end: 9 }, "end", 500)).toEqual({ start: 4, end: 509 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/clip-layout.test.ts`
Expected: FAIL — `rangeAfterSlide is not a function`.

- [ ] **Step 3: Implement**

Append to `src/anim/clip-layout.ts`:

```ts
/** Slide a whole range by `deltaFrames`, clamping the start at frame 0 and PRESERVING its length
 *  (a clamped slide must not silently trim — that is what the edge handles are for). */
export function rangeAfterSlide(
  range: { start: number; end: number },
  deltaFrames: number,
): { start: number; end: number } {
  const len = range.end - range.start;
  const start = Math.max(0, range.start + deltaFrames);
  return { start, end: start + len };
}

/** Trim one edge by `deltaFrames`. The start clamps at frame 0; the span never shrinks below one
 *  frame; the end may sit past the last project frame, which the timeline strip already sizes for. */
export function rangeAfterTrim(
  range: { start: number; end: number },
  edge: "start" | "end",
  deltaFrames: number,
): { start: number; end: number } {
  if (edge === "start") {
    return { start: Math.min(range.end, Math.max(0, range.start + deltaFrames)), end: range.end };
  }
  return { start: range.start, end: Math.max(range.start, range.end + deltaFrames) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/clip-layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the build gate**

Run: `npm run build`
Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 6: Commit**

```bash
git add src/anim/clip-layout.ts src/__tests__/clip-layout.test.ts
git commit -m "feat: pure slide/trim math for reference ranges

A clamped slide preserves length rather than trimming; a trim never
shrinks below one frame and may run past the last frame.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Render the image clip block

**Files:**
- Modify: `src/lib/Timeline.svelte` (the `stripFrames` `$derived.by` at ~line 77; the reference row branches at ~line 1135)

**Interfaces:**
- Consumes: `refVisibleSpan` (Task 1).
- Produces: an image-ref clip block in the DOM. No new exports.

**No unit test:** this is Svelte markup with no node-testable surface. Verify by build + review, per project convention. It is a separate task from the drag (Task 7) so a reviewer can reject the visuals without rejecting the interaction.

- [ ] **Step 1: Include image ranges in the shared strip width**

A range dragged past the last frame must widen the strip, or the sticky gutters unstick when you scroll to the tail (the 2026-08-14 finding). In the `stripFrames` `$derived.by`, replace the loop body:

```ts
    for (const l of appState.project.layers) {
      if (l.kind !== "ref") continue;
      if (l.media.type === "image") {
        if (l.range) ends.push(l.range.end + 1); // +1: `end` is inclusive, `ends` are exclusive
        continue;
      }
      if (l.media.type !== "video") continue;
      const dur = l.media.el.duration;
      if (!Number.isFinite(dur) || dur <= 0) continue;
      const { startFrame, spanFrames } = videoClipLayout(l.offsetFrames, l.speed, dur, fps);
      ends.push(startFrame + spanFrames);
    }
```

- [ ] **Step 2: Add the image clip block branch**

In `src/lib/Timeline.svelte`, add `refVisibleSpan` to the existing import from `../anim/document`. Then insert a new branch **before** the final `{:else}` type-label branch (the one rendering `{ref.media.type === "video" ? "video" : "image"}`), so images stop falling through to it:

```svelte
            {:else if ref.media.type === "image"}
              {@const span = refVisibleSpan(ref, appState.project.fps)}
              {@const s = span ?? { start: 0, end: stripFrames - 1 }}
              <div
                class="relative box-border h-6 overflow-hidden border bg-media-clip text-xs/6 text-text-secondary"
                class:border-media-clip-border={span !== null}
                class:cursor-grab={span !== null}
                class:border-dashed={span === null}
                class:border-text-muted={span === null}
                class:opacity-70={ref.id !== appState.activeLayerId}
                style="touch-action: none; margin-left: {s.start * CELL_W}px; width: {(s.end -
                  s.start +
                  1) *
                  CELL_W}px"
                role="presentation"
                title={span === null
                  ? "Visible on every frame — drag an edge to trim"
                  : "Drag to move, drag an edge to trim"}
              >
                <span class="relative z-10 block truncate px-1">{ref.name}</span>
              </div>
```

The dashed, default-cursor state is load-bearing: an untrimmed block spans everything **by definition**, so it must not read as a block someone dragged to full width, and its body has nothing to slide.

- [ ] **Step 3: Run the build gate**

Run: `npm run build`
Expected: `0 ERRORS 0 WARNINGS`. In particular no `better-tailwindcss/no-conflicting-classes` error — `border` plus `border-dashed` plus a border-colour utility set three different properties and do not conflict.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Timeline.svelte
git commit -m "feat: image reference layers show a timeline clip block

Untrimmed reads as dashed with no grab cursor: it spans everything by
definition, so it must not look like a block dragged to full width. A
trimmed range also widens the shared strip, or the sticky gutters
unstick when you scroll to its tail.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Trim and slide, undoably

**Files:**
- Modify: `src/state/appState.svelte.ts` (`cloneLayers` ~line 290; `restoreStructure` ~line 300)
- Modify: `src/lib/Timeline.svelte` (new drag state + handlers near `clipDown`/`clipMove`/`clipUp` at ~line 170; the block markup from Task 6)

**Interfaces:**
- Consumes: `rangeAfterSlide`, `rangeAfterTrim` (Task 5); `refVisibleSpan` (Task 1); `beginStructuralEdit`, `commitStructuralEdit`, `transformDragGuard` (existing, `appState.svelte.ts`); `isFinePointer`, `touchPanDown/Move/Up`, `CELL_W` (existing in `Timeline.svelte`).
- Produces: no new exports.

**No unit test:** `appState.svelte.ts` is not node-importable and `Timeline.svelte` is DOM-only. Build + review, then the browser pass.

**Lock:** ranges are deliberately **not** lock-guarded, matching the existing video clip drag and the documented rule that a ref's `locked` pins its *transform* while `offsetFrames`/`speed`/audio stay editable. Do not add a lock check here.

- [ ] **Step 1: Carry `range` through the undo snapshot**

In `cloneLayers`, the ref branch already deep-copies `transform` precisely so a later in-place field write cannot corrupt an in-flight snapshot. `range` is the same kind of nested object:

```ts
  return layers.map((l) =>
    l.kind === "draw"
      ? { ...l, cells: l.cells.slice(), transform: { ...l.transform } }
      : { ...l, transform: { ...l.transform }, range: l.range ? { ...l.range } : undefined },
  );
```

- [ ] **Step 2: Restore `range` on undo**

`restoreStructure`'s live-layer path keeps the existing layer object and copies only the *structural* fields, leaving view-props (visible/opacity/locked/name) live on purpose. `range` is structural. Immediately after the `live.transform = { ...snap.transform };` line:

```ts
      if (live.kind === "ref" && snap.kind === "ref")
        live.range = snap.range ? { ...snap.range } : undefined;
```

Without this, an undo restores the layer but leaves the range where the drag left it.

- [ ] **Step 3: Add the drag state and handlers**

In `src/lib/Timeline.svelte`, add the imports:

```ts
  import { rangeAfterSlide, rangeAfterTrim } from "../anim/clip-layout";
  import { beginStructuralEdit, commitStructuralEdit } from "../state/appState.svelte";
```

(`transformDragGuard` is already imported for the row drags; if not, add it. `beginStructuralEdit`/`commitStructuralEdit` may also already be imported — add only what is missing.)

Then, next to `clipDown`/`clipMove`/`clipUp`:

```ts
  // Image-ref range drag. Mirrors clipDown/Move/Up, but writes layer.range and IS undoable:
  // a range change alters what renders, so a mis-drag silently blanks frames.
  let rangeDrag: {
    layer: ReferenceLayer;
    mode: "slide" | "start" | "end";
    x: number;
    from: { start: number; end: number };
    undo: ReturnType<typeof beginStructuralEdit>;
  } | null = null;

  function rangeDown(e: PointerEvent, layer: ReferenceLayer, mode: "slide" | "start" | "end") {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (!isFinePointer(e)) {
      touchPanDown(e); // finger navigates, pen edits (the app-wide rule)
      return;
    }
    e.stopPropagation(); // an edge handle must not also start a body slide
    const span = refVisibleSpan(layer, appState.project.fps);
    // An untrimmed block has no body to slide; an edge drag materialises the implicit whole-project
    // range and trims from there.
    const from = span ?? { start: 0, end: Math.max(0, appState.project.frameCount - 1) };
    if (span === null && mode === "slide") return;
    rangeDrag = { layer, mode, x: e.clientX, from, undo: beginStructuralEdit() };
    transformDragGuard.settle = () => settleRangeDrag();
  }

  function rangeMove(e: PointerEvent) {
    if (e.pointerType === "touch") {
      touchPanMove(e);
      return;
    }
    if (!rangeDrag) return;
    const delta = Math.round((e.clientX - rangeDrag.x) / CELL_W);
    const next =
      rangeDrag.mode === "slide"
        ? rangeAfterSlide(rangeDrag.from, delta)
        : rangeAfterTrim(rangeDrag.from, rangeDrag.mode, delta);
    const cur = rangeDrag.layer.range;
    if (!cur || cur.start !== next.start || cur.end !== next.end) {
      rangeDrag.layer.range = next; // REPLACE, never mutate in place (shared snapshot refs)
      bump();
    }
  }

  /** Commit iff the gesture actually changed the range; an empty entry makes undo look dead. */
  function settleRangeDrag() {
    if (!rangeDrag) return;
    const cur = rangeDrag.layer.range;
    if (cur && (cur.start !== rangeDrag.from.start || cur.end !== rangeDrag.from.end))
      commitStructuralEdit(rangeDrag.undo);
    rangeDrag = null;
    transformDragGuard.settle = null;
  }

  function rangeUp(e: PointerEvent) {
    if (e.pointerType === "touch") {
      touchPanUp();
      return;
    }
    settleRangeDrag();
  }
```

`bump()` and `ReferenceLayer` are already imported in this file; confirm before adding.

- [ ] **Step 4: Wire the handlers and add the edge handles**

Extend the block from Task 6 with the pointer handlers and two edge handles:

```svelte
                onpointerdown={(e) => rangeDown(e, ref, "slide")}
                onpointermove={rangeMove}
                onpointerup={rangeUp}
                onpointercancel={rangeUp}
              >
                <span class="relative z-10 block truncate px-1">{ref.name}</span>
                <div
                  class="absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize"
                  style="touch-action: none"
                  role="presentation"
                  title="Trim the start"
                  onpointerdown={(e) => rangeDown(e, ref, "start")}
                  onpointermove={rangeMove}
                  onpointerup={rangeUp}
                  onpointercancel={rangeUp}
                ></div>
                <div
                  class="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize"
                  style="touch-action: none"
                  role="presentation"
                  title="Trim the end"
                  onpointerdown={(e) => rangeDown(e, ref, "end")}
                  onpointermove={rangeMove}
                  onpointerup={rangeUp}
                  onpointercancel={rangeUp}
                ></div>
              </div>
```

Both handles carry `touch-action: none` and `pointercancel` — the non-negotiable pair for every drag surface in this app.

- [ ] **Step 5: Run the build gate**

Run: `npm run build`
Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 6: Run the full suite and lint**

Run: `npm test && npm run lint`
Expected: all tests pass (unchanged count — this task adds no unit tests), lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/Timeline.svelte src/state/appState.svelte.ts
git commit -m "feat: trim and slide an image reference's range, undoably

One undo entry per completed gesture via the existing structural bracket,
with transformDragGuard.settle registered so a mid-gesture undo settles
instead of popping the previous command. A no-op drag commits nothing.

This diverges from the video and audio clip drags, which are deliberately
not undoable: those move where a reference sits, while a range change
alters what renders, and blanked frames are what undo is for.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Document the feature and its one behaviour change

**Files:**
- Modify: `README.md` (Features bullets, test count, Roadmap paragraph)
- Modify: `CLAUDE.md` (a dated entry after the Fill entry; the roadmap's reference bullet)
- Modify: `docs/superpowers/specs/2026-08-15-reference-layer-ranges-design.md` (Status line)

**Interfaces:** none.

**Why this is its own task:** the migration note is the whole point. A video shorter than the animation stops holding its last frame, and that is silent — the project opens fine and simply renders differently past the clip.

- [ ] **Step 1: Update the README**

Run `npm test` first and use the **actual** number, never a guess. Then:
- Add a Features bullet: reference layers can be trimmed to a range of frames on the timeline.
- Update the test count in the scripts block.
- Delete anything in the Roadmap that this shipped.
- Add a short note that a video reference no longer holds its final frame past the end of its footage.

- [ ] **Step 2: Add the CLAUDE.md entry**

Append a `**Reference layer visibility ranges (2026-08-15):**` entry covering: the reframing (no ref had a range at all, and the video block only looked like a trim control because `syncReferenceVideos` clamped); the one-span model and why images store a range while videos derive one; absent-means-always and the growing-project trap it avoids; the single gate in `buildFrameDrawList` and why one site suffices; the undo divergence from the video/audio clip drags; the migration; and the owed browser pass from the spec.

- [ ] **Step 3: Flip the spec status**

Change the spec's `**Status:**` line to `Implemented (2026-08-15)`.

- [ ] **Step 4: Verify the whole gate one last time**

Run: `npm run build && npm test && npm run lint`
Expected: `0 ERRORS 0 WARNINGS`, all tests pass, lint clean.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md docs/superpowers/specs/2026-08-15-reference-layer-ranges-design.md
git commit -m "docs: reference layer visibility ranges

Includes the migration note: a video shorter than the animation no
longer holds its final frame, which is silent at load time.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Owed a browser pass (carried from the spec)

None of Tasks 6 and 7 has a unit test, and Task 3's real behaviour is visual. After implementation, verify: an image ref shows a dashed full-strip block; trimming an edge converts it to a solid block and the image disappears outside the span while scrubbing; slide and both edge trims; trim → undo → redo; ⌘Z mid-drag; a range dragged past the last frame (gutters stay pinned); a short video going blank past its footage instead of holding; a not-yet-loaded video not blinking out on first paint; export honouring the range; onion skins honouring it; save → reload preserving a trimmed range; an old project opening unchanged; and iPad for the handles (`touch-action`, `pointercancel`, finger-pan vs pen-edit).
