# Flash/Animate-style Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the timeline to Flash/Animate's idiom — no per-frame grid, hold runs drawn as filled spans instead of per-frame marks, and an adjustable frame width — without changing what any gesture does.

**Architecture:** Three independently shippable phases against `src/lib/Timeline.svelte` (2,935 lines) and its pure helpers. Phase 1 is CSS-only. Phase 2 adds one pure function (`computeTimelineSpans`) derived from the existing, tested `computeTimelineGlyphs`, and swaps drawing-layer rows from per-frame cells to absolutely-positioned span rects. Phase 3 makes `CELL_W` a persisted preference and scales the two pointer thresholds that depend on it.

**Tech Stack:** Svelte 5 runes, TypeScript, Tailwind 4 (`@theme` roles), Vitest (node env, no DOM).

**Spec:** `docs/superpowers/specs/2026-09-09-flash-style-timeline-design.md`

## Global Constraints

- Build bar is **0 errors, 0 warnings** from `npm run build` (`svelte-check && tsc --noEmit && vite build`). Never commit with either non-zero.
- Test baseline is **1096 passing** (`npm test`). It only goes up.
- Colours come from Tailwind role utilities or `var(--color-*)`, never hex. Spans use `media-clip` / `media-clip-border`, matching reference-layer clips.
- The app is **dark-only** as of 2026-09-08. There is no `.dark` class and no light theme.
- **No gesture may change behaviour.** This is appearance and hit-test geometry only.
- **INVARIANT (`Timeline.svelte:1051`):** `EDGE_PX + MOVE_CANCEL_PX < CELL_W / 2`. Currently `5 + 6 = 11 < 12`. Phase 3 must keep this true at every zoom level.
- Every task ends with `npm run build && npm test` green, then a commit.
- Canvas/DOM/Svelte code is not node-testable here; only pure helpers get unit tests. Everything else is browser-verified.

---

## Phase 1 — Lose the grid, keep the count

### Task 1: Delete the property-row grid cells

The transform/opacity track rows render one empty bordered `<div>` per frame purely to paint grid lines; their actual content (the segment lines) is already absolutely positioned. With the grid gone these cells render nothing at all, so they are a pure deletion — and the largest single DOM saving in the plan.

**Files:**
- Modify: `src/lib/Timeline.svelte:2559-2561`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Later tasks do not depend on this.

- [ ] **Step 1: Read the block to confirm what is being removed**

Run: `sed -n '2555,2575p' src/lib/Timeline.svelte`

Confirm it reads:

```svelte
              {#each Array(appState.project.frameCount) as _, f (f)}
                <div class="box-border h-6 border border-border" style="width: {CELL_W}px"></div>
              {/each}
```

and that the `{#each segments as s (s.frame)}` block immediately below it positions its lines with `style="left: {s.x}px; width: {s.w}px"` — i.e. absolutely, not relative to those cells.

- [ ] **Step 2: Delete the per-frame cells, keeping the row's height**

Delete the three-line `{#each}` above outright. The parent row then has no child supplying height, so it needs its own. Its opening tag is at `Timeline.svelte:2528`:

```svelte
            <div
              class="relative flex select-none"
              style="touch-action: none"
              role="presentation"
```

Change that class to `"relative flex h-6 select-none"`. Nothing else about the row changes — the segment lines below are `absolute` and positioned from `s.x` / `s.w`, so they do not depend on the deleted cells.

- [ ] **Step 3: Verify the build**

Run: `npm run build 2>&1 | grep -E "COMPLETED|ERROR"`
Expected: `0 ERRORS 0 WARNINGS`

- [ ] **Step 4: Verify in the browser that property rows are unchanged in height and their segment lines still land on the right frames**

Run: `npm run dev`, open the app, select a layer with a transform or opacity track (or add a keyframe to create one). The track row must be the same height as before and its solid/dashed segment lines must sit at the same frames.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Timeline.svelte
git commit -m "perf: drop the property-row grid cells

They rendered one empty bordered div per frame purely to paint grid
lines, while the segment lines they sit behind are already absolutely
positioned. With the per-frame grid going away they draw nothing, so
this is a pure deletion: on a 500-frame project it removes 500 DOM
nodes per property row."
```

### Task 2: Remove the per-frame grid from drawing-layer rows and add a 5-frame marker

**Files:**
- Modify: `src/lib/Timeline.svelte:2751-2759` (the drawing-layer cell)
- Modify: `src/lib/Timeline.svelte` (row containers — add the horizontal divider)

**Interfaces:**
- Consumes: nothing.
- Produces: the visual baseline Phase 2 builds on. No code interface.

- [ ] **Step 1: Change the drawing-layer cell from a full border to a 5-frame right border**

The cell currently reads:

```svelte
                <div
                  class="box-border h-6 border border-border leading-none text-xs flex items-center justify-center"
                  class:bg-selection={inSelection(layer.id, f)}
                  style="width: {CELL_W}px"
                >
                  {displayGlyph(layer.id, glyphs, f)}
                </div>
```

Replace with — note `border-r` only, only on every 5th frame, matching the ruler's existing cadence:

```svelte
                <div
                  class="box-border h-6 leading-none text-xs flex items-center justify-center {(f +
                    1) %
                    5 ===
                  0
                    ? 'border-r border-line/50'
                    : ''}"
                  class:bg-selection={inSelection(layer.id, f)}
                  style="width: {CELL_W}px"
                >
                  {displayGlyph(layer.id, glyphs, f)}
                </div>
```

`border-line/50` rather than `border-border`: the marker must be quieter than a divider, since it repeats every 5 columns down the whole timeline.

- [ ] **Step 2: Add the horizontal divider between rows**

The drawing-layer row's opening tag is at `Timeline.svelte:2737`:

```svelte
            <div
              class="flex select-none"
              style="touch-action: none; cursor: {rowCursor}"
```

Change that class to `"relative flex select-none border-b border-border-light"`. `border-b` separates rows now that nothing separates columns; **`relative` is required by Task 4**, which positions spans absolutely inside this element — adding it now means Task 4 touches only the row body.

- [ ] **Step 3: Verify the build**

Run: `npm run build 2>&1 | grep -E "COMPLETED|ERROR"`
Expected: `0 ERRORS 0 WARNINGS`

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`. Check:
- No vertical line between every frame; a faint one every 5th, aligned with the ruler's every-5 tick.
- A horizontal line between layer rows.
- Selection highlight (`bg-selection`) still fills whole cells when you marquee a block.
- The playhead still lands on the correct column (it is positioned by `GUTTER_W + ph * CELL_W + CELL_W / 2`, unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/lib/Timeline.svelte
git commit -m "feat: drop the per-frame timeline grid, keep a 5-frame marker

Flash does not rule every frame, but it does mark every 5th and that is
what lets you count frames away from the ruler. For animating on 1s and
2s the difference between a 3-frame and a 4-frame hold is the work
itself, so the marker is load-bearing rather than decoration. Rows are
now separated horizontally instead."
```

**STOP HERE and look at it.** Phase 1 is the cheap, reversible half. Decide whether the denser look is what you want before spending Phase 2.

---

## Phase 2 — Spans instead of per-frame cells

### Task 3: `computeTimelineSpans` (pure, tested)

**Files:**
- Create: `src/lib/timeline-spans.ts`
- Test: `src/__tests__/timeline-spans.test.ts`

**Interfaces:**
- Consumes: the `string[]` returned by `computeTimelineGlyphs(cells, frameCount, isEmpty)` from `src/lib/timeline-glyphs.ts` — values are `"◆"`, `"◇"`, `"—"`, `""`.
- Produces: `computeTimelineSpans(glyphs: string[]): TimelineSpan[]` where `interface TimelineSpan { startFrame: number; endFrame: number; blank: boolean }`. `endFrame` is INCLUSIVE. Task 4 renders these.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/timeline-spans.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeTimelineSpans } from "../lib/timeline-spans";

describe("computeTimelineSpans", () => {
  it("an inked key with holds is one span covering all of them", () => {
    expect(computeTimelineSpans(["◆", "—", "—"])).toEqual([
      { startFrame: 0, endFrame: 2, blank: false },
    ]);
  });

  it("a lone key with no holds is a one-frame span", () => {
    expect(computeTimelineSpans(["◆"])).toEqual([{ startFrame: 0, endFrame: 0, blank: false }]);
  });

  it("back-to-back keys are separate spans, not one run", () => {
    expect(computeTimelineSpans(["◆", "◆", "—"])).toEqual([
      { startFrame: 0, endFrame: 0, blank: false },
      { startFrame: 1, endFrame: 2, blank: false },
    ]);
  });

  it("a blank key is its own one-frame span and ends the run before it", () => {
    // ◇ is a real keyframe boundary with no content: the ink stops here.
    expect(computeTimelineSpans(["◆", "—", "◇", ""])).toEqual([
      { startFrame: 0, endFrame: 1, blank: false },
      { startFrame: 2, endFrame: 2, blank: true },
    ]);
  });

  it("leading blank frames produce no span", () => {
    expect(computeTimelineSpans(["", "", "◆", "—"])).toEqual([
      { startFrame: 2, endFrame: 3, blank: false },
    ]);
  });

  it("a run continuing past the stored track is one span to the end", () => {
    // computeTimelineGlyphs emits — past the track for an inked key; a span must not stop early.
    expect(computeTimelineSpans(["◆", "—", "—", "—", "—"])).toEqual([
      { startFrame: 0, endFrame: 4, blank: false },
    ]);
  });

  it("an empty track produces no spans", () => {
    expect(computeTimelineSpans([])).toEqual([]);
    expect(computeTimelineSpans(["", "", ""])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/__tests__/timeline-spans.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/timeline-spans"`. The feature is missing, not mistyped.

- [ ] **Step 3: Write the implementation**

Create `src/lib/timeline-spans.ts`:

```typescript
/**
 * Hold runs as Flash draws them: a keyframe plus the frames it holds over, as ONE span.
 *
 * Derived from `computeTimelineGlyphs`'s output rather than from the cells, deliberately. That
 * function already answers every hard question — which key resolves at a frame, whether it has
 * ink, and that an inked key keeps holding past the end of the stored track — and it is tested.
 * Re-deriving any of that here would create a second answer that can drift from the first.
 *
 * `endFrame` is INCLUSIVE. A `blank` span is a `◇` keyframe: a real boundary with no content,
 * drawn as an outline rather than a fill, and always one frame long because nothing holds over it.
 */
export interface TimelineSpan {
  startFrame: number;
  endFrame: number;
  blank: boolean;
}

export function computeTimelineSpans(glyphs: string[]): TimelineSpan[] {
  const out: TimelineSpan[] = [];
  for (let f = 0; f < glyphs.length; f++) {
    const g = glyphs[f];
    if (g === "◆") {
      let end = f;
      while (end + 1 < glyphs.length && glyphs[end + 1] === "—") end++;
      out.push({ startFrame: f, endFrame: end, blank: false });
      f = end;
    } else if (g === "◇") {
      out.push({ startFrame: f, endFrame: f, blank: true });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/__tests__/timeline-spans.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full suite and build**

Run: `npm test 2>&1 | grep -E "Tests " && npm run build 2>&1 | grep -E "COMPLETED|ERROR"`
Expected: `Tests 1103 passed` (1096 + 7), `0 ERRORS 0 WARNINGS`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/timeline-spans.ts src/__tests__/timeline-spans.test.ts
git commit -m "feat: computeTimelineSpans — hold runs as Flash draws them

Derived from computeTimelineGlyphs' output rather than from the cells, so
the two cannot disagree about where a span runs. That function already
answers which key resolves at a frame, whether it has ink, and that an
inked key keeps holding past the stored track's end - all tested."
```

### Task 4: Render drawing-layer rows as spans

**Files:**
- Modify: `src/lib/Timeline.svelte` (import, a `spansFor` derivation, and the row body at ~2751)

**Interfaces:**
- Consumes: `computeTimelineSpans(glyphs)` and `TimelineSpan` from Task 3; the existing `glyphsFor(layer, version)` memo in `Timeline.svelte:212`; `CELL_W`.
- Produces: no new exports.

> **The block-drag preview must survive this task.** `displayGlyph(layerId, glyphs, f)` exists to
> preview a block drag: during one it returns the glyph *sliding into* a target cell and clears the
> vacated source. Spanning the RAW glyphs would silently drop that preview — a behaviour change,
> which the Global Constraints forbid. Step 2 therefore spans the DISPLAYED glyphs, and Step 1's
> cache is bypassed while a drag is live (the cache is keyed on `appState.version`, which a drag
> does not bump, so it would serve stale spans for the whole gesture).

- [ ] **Step 1: Import the function and add a memoized per-layer span list**

Beside the existing `import { computeTimelineGlyphs } from "./timeline-glyphs";` (line ~133) add:

```typescript
  import { computeTimelineSpans, type TimelineSpan } from "./timeline-spans";
```

Then beside `glyphsFor` (line ~212) add a matching cache, keyed the same way — `appState.version` bumps on every edit, and scrubbing does not bump it, so this is a cache hit while scrubbing exactly as the glyph memo is:

```typescript
  const spanCache = new Map<number, { version: number; frameCount: number; spans: TimelineSpan[] }>();
  function spansFor(layer: DrawingLayer, version: number): TimelineSpan[] {
    const frameCount = appState.project.frameCount;
    const hit = spanCache.get(layer.id);
    if (hit && hit.version === version && hit.frameCount === frameCount) return hit.spans;
    const spans = computeTimelineSpans(glyphsFor(layer, version));
    spanCache.set(layer.id, { version, frameCount, spans });
    return spans;
  }

  /** Spans as CURRENTLY DISPLAYED: identical to `spansFor` except while a block drag is previewing
   *  over this row, when the glyphs are re-read through `displayGlyph` so the spans slide with the
   *  ghost. Uncached on purpose — a drag does not bump `appState.version`, so the cache cannot see
   *  it, and the cost is one O(frames) pass on the handful of rows a drag touches. */
  function displaySpansFor(layer: DrawingLayer, version: number): TimelineSpan[] {
    if (!selRect || !rowMovesWithBlock(layer.id)) return spansFor(layer, version);
    const glyphs = glyphsFor(layer, version);
    const shown = Array.from({ length: appState.project.frameCount }, (_, f) =>
      displayGlyph(layer.id, glyphs, f),
    );
    return computeTimelineSpans(shown);
  }
```

- [ ] **Step 2: Replace the per-frame cells with span rects plus a selection overlay**

The row currently renders one `<div>` per frame carrying both the glyph and `class:bg-selection={inSelection(layer.id, f)}`. Selection is per-frame and independent of spans, so it becomes its own absolutely-positioned layer. Replace the `{#each Array(appState.project.frameCount) as _, f (f)}` block from Task 2 with:

```svelte
              <!-- Selection first, UNDER the spans: a selected frame tints the lane, and the ink
                   drawn on it must stay legible. Per-frame because a marquee selects frames, not
                   spans — a block can start and end mid-run. -->
              {#each Array(appState.project.frameCount) as _, f (f)}
                {#if inSelection(layer.id, f)}
                  <div
                    class="pointer-events-none absolute top-0 h-6 bg-selection"
                    style="left: {f * CELL_W}px; width: {CELL_W}px"
                  ></div>
                {/if}
              {/each}
              {#each displaySpansFor(layer, appState.version) as s (s.startFrame)}
                <div
                  class="pointer-events-none absolute top-1 h-4 rounded-sm border"
                  class:bg-media-clip={!s.blank}
                  class:border-media-clip-border={!s.blank}
                  class:border-line={s.blank}
                  style="left: {s.startFrame * CELL_W + 2}px; width: {(s.endFrame -
                    s.startFrame +
                    1) *
                    CELL_W -
                    4}px"
                ></div>
              {/each}
```

`media-clip` / `media-clip-border` are the same roles reference-layer clips use, so a drawing span and a reference clip read as the same kind of object. The `+2 / −4` inset leaves a hairline gap between adjacent spans so back-to-back keys stay countable.

**No hollow end-cap** is drawn, deliberately: that is open question 3 in the spec, and the inset gap above already makes a span's end visible. Add one only if the browser pass says the end is hard to find — it is a change to this one block.

- [ ] **Step 3: Verify the build**

Run: `npm run build 2>&1 | grep -E "COMPLETED|ERROR"`
Expected: `0 ERRORS 0 WARNINGS`

- [ ] **Step 4: Verify in the browser — this is the task that can break gestures**

Run: `npm run dev`. Check every one of these, since the row's children changed:
- A key with holds draws as one filled rect; a blank key draws as an outline.
- Back-to-back keys read as two rects, not one.
- Tap a cell to select it; marquee-drag across frames and layers.
- Drag a selected block sideways — the spans must slide with the ghost, and the source frames must clear. This is what `displaySpansFor` exists for; if the spans sit still during a drag, that function is not being called or `rowMovesWithBlock` is returning false.
- Drag a span's right edge to resize the hold run (the `EDGE_PX` hotspot).
- Scrub the ruler and confirm no jitter.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Timeline.svelte
git commit -m "feat: draw drawing-layer hold runs as spans

One filled rect per keyframe run instead of one DOM node per frame, in
the media-clip roles reference clips already use, so both read as the
same kind of object. Selection stays per-frame and moves under the spans,
since a marquee selects frames and a block can start mid-run.

On a 500-frame, 10-layer project this replaces about 5,000 cell elements
with a handful of rects per row. That matters here: the glyph memoization
exists because per-cell work caused scrub jitter."
```

---

## Phase 3 — Cell width as a persisted zoom

### Task 5: Scale the pointer thresholds with the cell width

Do this BEFORE making the width adjustable, so no intermediate commit can violate the invariant.

**Files:**
- Modify: `src/lib/timeline-grid.ts:9,33`
- Modify: `src/lib/Timeline.svelte:1051-1053`
- Test: `src/__tests__/timeline-grid.test.ts`

**Interfaces:**
- Consumes: `planCellPointer(cells, offsetX, cellW, count)` — already takes `cellW`.
- Produces: `edgePx(cellW: number): number`, exported from `timeline-grid.ts`, used by Task 6.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/timeline-grid.test.ts`:

```typescript
import { edgePx } from "../lib/timeline-grid";

describe("edgePx keeps the resize hotspot inside half a column", () => {
  const MOVE_CANCEL_PX = 6; // Timeline.svelte's companion constant

  it("is the historical 5px at the default 24px column", () => {
    expect(edgePx(24)).toBe(5);
  });

  it("never lets EDGE_PX + MOVE_CANCEL_PX reach half the column", () => {
    // The invariant recorded at Timeline.svelte:1051. At 12px it is impossible with a fixed
    // MOVE_CANCEL_PX of 6, which is exactly why the cancel threshold scales too (Task 5 Step 3).
    for (const w of [12, 16, 20, 24, 28, 32]) {
      expect(edgePx(w)).toBeLessThan(w / 2);
    }
  });

  it("shrinks with the column rather than staying fixed", () => {
    expect(edgePx(12)).toBeLessThan(edgePx(24));
  });

  it("never collapses to nothing", () => {
    expect(edgePx(8)).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/__tests__/timeline-grid.test.ts`
Expected: FAIL — `edgePx` is not exported.

- [ ] **Step 3: Implement, and scale the cancel threshold too**

In `src/lib/timeline-grid.ts`, replace `const EDGE_PX = 5;` with:

```typescript
/**
 * Resize-hotspot half-width for a given column width. Was a fixed 5px, which held only because
 * the column was a fixed 24: the invariant at Timeline.svelte:1051 requires
 * `edgePx + moveCancelPx < cellW / 2`, and at 24 that is 5 + 6 = 11 < 12 — one pixel of margin.
 * Below about 22px a fixed pair breaks it and a pending long-press can let a resize cross a column
 * boundary before it is cancelled. Both thresholds therefore scale with the column.
 */
export function edgePx(cellW: number): number {
  return Math.max(2, Math.min(5, Math.round(cellW * 0.2)));
}

/** Companion to `edgePx`: how far a pointer may travel before a pending long-press is cancelled. */
export function moveCancelPx(cellW: number): number {
  return Math.max(3, Math.min(6, Math.round(cellW * 0.25)));
}
```

Then at line 33 replace `EDGE_PX` with `edgePx(cellW)`.

In `src/lib/Timeline.svelte`, replace the `MOVE_CANCEL_PX = 6` constant and its comment with:

```typescript
  // INVARIANT: edgePx(CELL_W) + moveCancelPx(CELL_W) must stay < CELL_W/2, so a pending
  // long-press can't let a resize cross a column boundary before it's cancelled. Both scale with
  // the column now — a fixed 5 + 6 held only at the fixed 24px width (11 < 12, one pixel spare)
  // and breaks below about 22px. `timeline-grid.test.ts` pins it across the zoom range.
  const MOVE_CANCEL_PX = $derived(moveCancelPx(CELL_W));
```

and add `moveCancelPx` to the existing `timeline-grid` import.

- [ ] **Step 4: Run the tests and the build**

Run: `npx vitest run src/__tests__/timeline-grid.test.ts && npm test 2>&1 | grep -E "Tests " && npm run build 2>&1 | grep -E "COMPLETED|ERROR"`
Expected: all green, `0 ERRORS 0 WARNINGS`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeline-grid.ts src/lib/Timeline.svelte src/__tests__/timeline-grid.test.ts
git commit -m "fix: scale the timeline pointer thresholds with the column width

EDGE_PX 5 and MOVE_CANCEL_PX 6 held the invariant at Timeline.svelte:1051
only because the column was a fixed 24px: 5 + 6 = 11 < 12, one pixel of
margin. Below about 22px they break it and a pending long-press can let a
resize cross a column boundary before it is cancelled. Both now scale,
with a test pinning the invariant across the zoom range."
```

### Task 6: Make the cell width a persisted preference

**Files:**
- Modify: `src/state/appState.svelte.ts` (state field + default)
- Modify: `src/persist/preferences.ts` (`Preferences` field)
- Modify: `src/lib/Timeline.svelte:140` (`CELL_W` becomes derived)
- Test: `src/__tests__/preferences.test.ts`

**Interfaces:**
- Consumes: `edgePx` / `moveCancelPx` from Task 5.
- Produces: `state.timelineCellW: number`, persisted as `Preferences.timelineCellW`.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/preferences.test.ts`:

```typescript
describe("timelineCellW", () => {
  it("round-trips through parsePreferences", () => {
    expect(parsePreferences('{"timelineCellW":16}')).toEqual({ timelineCellW: 16 });
  });

  it("clamps to the supported zoom range", () => {
    expect(clampTimelineCellW(4)).toBe(12);
    expect(clampTimelineCellW(99)).toBe(32);
    expect(clampTimelineCellW(24)).toBe(24);
  });
});
```

Import `clampTimelineCellW` from `../lib/timeline-grid` at the top of that file.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/__tests__/preferences.test.ts`
Expected: FAIL — `clampTimelineCellW` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/timeline-grid.ts`:

```typescript
/** Supported frame-column widths. 24 is the historical fixed value and stays the default, so
 *  nothing changes until the zoom is moved. 12 is Flash's default; below it the marks stop being
 *  hittable with a finger even with the scaled thresholds. */
export const MIN_CELL_W = 12;
export const MAX_CELL_W = 32;
export const DEFAULT_CELL_W = 24;

export function clampTimelineCellW(w: number): number {
  if (!Number.isFinite(w)) return DEFAULT_CELL_W;
  return Math.max(MIN_CELL_W, Math.min(MAX_CELL_W, Math.round(w)));
}
```

In `src/persist/preferences.ts`, add to the `Preferences` interface:

```typescript
  timelineCellW?: number; // px width of a timeline frame column
```

In `src/state/appState.svelte.ts`: add `timelineCellW: number;` to the state type, `timelineCellW: DEFAULT_CELL_W,` to the initial state, `timelineCellW: state.timelineCellW,` to `gatherPreferences`, and to `applyPreferences`:

```typescript
  if (typeof p.timelineCellW === "number")
    state.timelineCellW = clampTimelineCellW(p.timelineCellW);
```

In `src/lib/Timeline.svelte:140`, replace the constant:

```typescript
  const CELL_W = $derived(appState.timelineCellW);
```

- [ ] **Step 4: Run the tests and the build**

Run: `npm test 2>&1 | grep -E "Tests " && npm run build 2>&1 | grep -E "COMPLETED|ERROR"`
Expected: green, `0 ERRORS 0 WARNINGS`. If `svelte-check` reports `CELL_W` used before initialization in a non-reactive context, move that use into a `$derived`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: timeline frame width is a persisted preference

CELL_W was a fixed 24. It is now state, clamped to 12..32 and defaulting
to 24 so nothing changes until it is moved. The geometry helpers already
took cellW as an argument, so only the constant and the two pointer
thresholds needed to become reactive."
```

### Task 7: The zoom control

**Files:**
- Modify: `src/lib/Timeline.svelte` (the timeline's own toolbar row)

**Interfaces:**
- Consumes: `state.timelineCellW`, `MIN_CELL_W`, `MAX_CELL_W` from Task 6; `sliderFill` from `src/lib/slider-fill.ts`.
- Produces: nothing.

- [ ] **Step 1: Add the slider beside the existing timeline toggles**

Find the timeline's toolbar row (`grep -n 'const toolBtn' src/lib/Timeline.svelte` — the onion/boil toggles live beside it) and add:

```svelte
    <label class="flex items-center gap-1 text-xs text-text-secondary" title="Frame width">
      <input
        type="range"
        min={MIN_CELL_W}
        max={MAX_CELL_W}
        step="2"
        class="w-20"
        bind:value={appState.timelineCellW}
        style={sliderFill(appState.timelineCellW, MIN_CELL_W, MAX_CELL_W)}
      />
    </label>
```

Import `sliderFill` from `./slider-fill` and the two constants from `./timeline-grid`.

- [ ] **Step 2: Verify the build**

Run: `npm run build 2>&1 | grep -E "COMPLETED|ERROR"`
Expected: `0 ERRORS 0 WARNINGS`

- [ ] **Step 3: Verify in the browser across the zoom range**

Run: `npm run dev`. At **12, 24 and 32px**, check: spans land on the right frames; the ruler stays aligned with the lanes; the playhead lands on the right column; the 5-frame markers still line up; tap-select, marquee, block drag and span-edge resize all still work. **The resize hotspot at 12px is the specific thing Task 5 exists for** — confirm a drag near a span's right edge resizes rather than seeking.

- [ ] **Step 4: Verify the width survives a reload**

Set the zoom to 16, reload the page, confirm it is still 16.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Timeline.svelte
git commit -m "feat: a frame-width zoom on the timeline

Flash's ~12px frames were mouse-driven and this app is Pencil and finger,
so the width is a control rather than a constant - the same refusal to
pick a number that the resizable timeline height already makes, and the
compositor ships a px/s zoom for the same reason."
```

---

## Verification debt

Phases 1 and 3 are CSS and constant changes with no node-testable surface; Task 4's rendering is Svelte markup. All of it is browser-verified only. **Everything here is owed an iPad pass**, and Task 7's narrow end is the specific risk: 12px columns are comfortable with a Pencil and may not be with a finger. That is the whole reason it is a zoom and not a new default.
