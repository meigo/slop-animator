# Status Bar + Resizable/Scrollable Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bottom status bar (instant `title`-sourced hint + ambient frame/tool/layer readout) and make the timeline a bounded, drag-resizable, vertically-scrollable panel.

**Architecture:** A tiny pure `clampTimelineHeight` helper (node-unit-tested) in `src/anim/timeline-layout.ts`; two new `$state` fields (`statusHint`, `timelineHeight`) + one Preferences field in `appState.svelte.ts`; a new `StatusBar.svelte` plus delegated pointer-hint listeners in `App.svelte`; and a structural change to `Timeline.svelte` (fixed height, top grip, vertical scroll, sticky ruler). DOM parts are build+browser-verified (Vitest has no DOM).

**Tech Stack:** Svelte 5 (runes), TypeScript, Vite, Vitest (node env), Tailwind 4.

## Global Constraints

- Build bar: `npm run build` (`svelte-check && tsc --noEmit && vite build`) must be **0 errors, 0 warnings**.
- Test baseline **302 passing**; the one new unit test adds to it. DOM/gesture/canvas code is NOT node-testable — those tasks are build + reasoning + browser verified (do not fabricate DOM tests).
- **Runes import-alias rule:** any component using the `$state` rune must `import { state as appState }` (never `import { state }`). `Timeline.svelte` already aliases to `appState`. New `StatusBar.svelte` must alias. `App.svelte` imports `{ state }` UNALIASED (it has no `$state` rune) — keep it that way; use `state.` there.
- **Do NOT persist `statusHint`** (transient; would thrash the prefs save on every hover). Only `timelineHeight` is persisted.
- Fixed timeline geometry constants already in `Timeline.svelte`: `CELL_W = 24`, `LABEL_W = 80`; rows are `h-6`.
- Surgical edits; match existing style. Pre-commit hook reformats staged files (expected).

---

## File Structure

- **Create** `src/anim/timeline-layout.ts` — `MIN_TIMELINE_HEIGHT`, `DEFAULT_TIMELINE_HEIGHT`, `clampTimelineHeight`.
- **Create** `src/__tests__/timeline-layout.test.ts` — unit tests for `clampTimelineHeight`.
- **Modify** `src/persist/preferences.ts` — add `timelineHeight?: number` to `Preferences`.
- **Modify** `src/state/appState.svelte.ts` — `statusHint` + `timelineHeight` state; gather/apply.
- **Create** `src/lib/StatusBar.svelte` — the bottom bar (hint + ambient).
- **Modify** `src/App.svelte` — render `<StatusBar />`; add delegated pointer-hint listeners.
- **Modify** `src/lib/Timeline.svelte` — fixed height, grip drag, vertical scroll, sticky ruler.

---

## Task 1: `clampTimelineHeight` pure helper

**Files:**
- Create: `src/anim/timeline-layout.ts`
- Test: `src/__tests__/timeline-layout.test.ts`

**Interfaces:**
- Produces:
  - `const MIN_TIMELINE_HEIGHT = 140`
  - `const DEFAULT_TIMELINE_HEIGHT = 260`
  - `function clampTimelineHeight(px: number, viewportH: number): number`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/timeline-layout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  clampTimelineHeight,
  MIN_TIMELINE_HEIGHT,
  DEFAULT_TIMELINE_HEIGHT,
} from "../anim/timeline-layout";

describe("clampTimelineHeight", () => {
  it("returns a value within range unchanged", () => {
    expect(clampTimelineHeight(300, 1000)).toBe(300); // 140 <= 300 <= 600
  });

  it("floors at MIN below the minimum", () => {
    expect(clampTimelineHeight(50, 1000)).toBe(MIN_TIMELINE_HEIGHT);
  });

  it("caps at 60% of the viewport above the maximum", () => {
    expect(clampTimelineHeight(900, 1000)).toBe(600); // 0.6 * 1000
  });

  it("keeps MIN even when 60% of a tiny viewport is below MIN", () => {
    expect(clampTimelineHeight(500, 100)).toBe(MIN_TIMELINE_HEIGHT); // 0.6*100=60 < 140 → MIN wins
  });

  it("rounds the max to a whole pixel", () => {
    expect(clampTimelineHeight(9999, 777)).toBe(Math.round(777 * 0.6)); // 466
  });

  it("DEFAULT is within the sane range", () => {
    expect(DEFAULT_TIMELINE_HEIGHT).toBeGreaterThanOrEqual(MIN_TIMELINE_HEIGHT);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/timeline-layout.test.ts`
Expected: FAIL — `Cannot find module '../anim/timeline-layout'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/anim/timeline-layout.ts`:

```ts
/** Layout geometry for the resizable timeline panel (pure; no DOM). */

export const MIN_TIMELINE_HEIGHT = 140; // toolbar + ruler + ~2 rows — keep the canvas from collapsing
export const DEFAULT_TIMELINE_HEIGHT = 260;

/** Clamp a proposed timeline height (px) to [MIN, 60% of the viewport], MIN always winning. */
export function clampTimelineHeight(px: number, viewportH: number): number {
  const max = Math.max(MIN_TIMELINE_HEIGHT, Math.round(viewportH * 0.6));
  return Math.max(MIN_TIMELINE_HEIGHT, Math.min(px, max));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/timeline-layout.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/anim/timeline-layout.ts src/__tests__/timeline-layout.test.ts
git commit -m "feat: clampTimelineHeight helper (timeline panel bounds)"
```

---

## Task 2: appState state + Preferences plumbing

**Files:**
- Modify: `src/persist/preferences.ts` (`Preferences` interface ~L4-16)
- Modify: `src/state/appState.svelte.ts` (imports; `AnimState` ~L62-80; state literal ~L85-135; `gatherPreferences` ~L676; `applyPreferences` ~L690)

**Interfaces:**
- Consumes: `clampTimelineHeight`, `DEFAULT_TIMELINE_HEIGHT` (Task 1).
- Produces: `state.statusHint: string`, `state.timelineHeight: number`; persisted `Preferences.timelineHeight`.

Not node-testable (store file). Build-verified.

- [ ] **Step 1: Add the Preferences field**

In `src/persist/preferences.ts`, add to the `Preferences` interface (after `loop: boolean;`):

```ts
  timelineHeight?: number; // px height of the resizable timeline panel
```

- [ ] **Step 2: Import the helper in appState**

In `src/state/appState.svelte.ts`, add near the other `../anim/*` imports:

```ts
import { clampTimelineHeight, DEFAULT_TIMELINE_HEIGHT } from "../anim/timeline-layout";
```

- [ ] **Step 3: Extend AnimState + state literal**

In `interface AnimState { … }` add (after `playback`):

```ts
  statusHint: string; // description of the hovered/pressed control (from its title=); "" when idle
  timelineHeight: number; // px height of the resizable timeline panel
```

In the `export const state: AnimState = $state({ … })` literal, add (after `playback: { … },`):

```ts
  statusHint: "",
  timelineHeight: DEFAULT_TIMELINE_HEIGHT,
```

- [ ] **Step 4: Persist in gather/apply**

In `gatherPreferences()`'s returned object, add:

```ts
    timelineHeight: state.timelineHeight,
```

In `applyPreferences(p)`, add (with the other guards):

```ts
  if (typeof p.timelineHeight === "number")
    state.timelineHeight = clampTimelineHeight(p.timelineHeight, window.innerHeight);
```

- [ ] **Step 5: Verify build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → 302 (+ the Task-1 unit test) passing.

- [ ] **Step 6: Commit**

```bash
git add src/persist/preferences.ts src/state/appState.svelte.ts
git commit -m "feat: statusHint + persisted timelineHeight state"
```

---

## Task 3: Status bar component + hint wiring

**Files:**
- Create: `src/lib/StatusBar.svelte`
- Modify: `src/App.svelte` (imports; add `onPointerHint`; `<svelte:window>` ~L119; render `<StatusBar />` after `<Timeline />` ~L128)

**Interfaces:**
- Consumes: `state.statusHint`, `state.playhead`, `state.project`, `state.tool`, `state.brush`, `activeLayer()`.
- Produces: a rendered bottom bar; `state.statusHint` written by the window listeners.

DOM code — build + browser verified.

- [ ] **Step 1: Create the component**

Create `src/lib/StatusBar.svelte`:

```svelte
<script lang="ts">
  import { state as appState, activeLayer } from "../state/appState.svelte";

  // Ambient readout: frame, tool (brush/eraser show their stroke type), and the active layer.
  const ambient = $derived.by(() => {
    const p = appState.project;
    const toolLabel =
      appState.tool === "eraser"
        ? "eraser"
        : appState.tool === "brush"
          ? appState.brush.brushType
          : appState.tool;
    return `f ${appState.playhead + 1}/${p.frameCount} · ${toolLabel} · ${activeLayer().name}`;
  });
</script>

<div
  class="flex items-center justify-between gap-3 border-t border-border bg-surface px-2 h-6 text-xs text-text-secondary select-none"
>
  <span class="truncate">{appState.statusHint}</span>
  <span class="shrink-0 tabular-nums">{ambient}</span>
</div>
```

- [ ] **Step 2: Add the hint listeners + render in App.svelte**

In `src/App.svelte`, import the component with the other `./lib/*` imports:

```ts
  import StatusBar from "./lib/StatusBar.svelte";
```

Add the handler (near `onPaste`), which reads the nearest `title=` up the tree and writes it to state:

```ts
  // Instant status hint: mirror the hovered/pressed control's title= into the status bar. pointerover
  // covers desktop hover; pointerdown covers touch/Pencil (iPad has no hover). Moving onto an untitled
  // element sets "" (natural clear). No pointerup clear — a tapped control's hint persists until the
  // next hover/press, which is the readable behavior on touch.
  function onPointerHint(e: PointerEvent) {
    const el = (e.target as Element | null)?.closest("[title]");
    state.statusHint = el?.getAttribute("title") ?? "";
  }
```

Extend the existing `<svelte:window .../>` (currently `onkeydown={onKey} onpaste={onPaste}`) to:

```svelte
<svelte:window
  onkeydown={onKey}
  onpaste={onPaste}
  onpointerover={onPointerHint}
  onpointerdown={onPointerHint}
/>
```

Render the bar as the LAST child of the app flex-col, immediately after `<Timeline />`:

```svelte
  <Playbar />
  <Timeline />
  <StatusBar />
</div>
```

- [ ] **Step 3: Verify build + tests**

Run: `npm run build` → 0/0.
Run: `npm test` → still passing (no new tests here).

- [ ] **Step 4: Browser verification (user-deferred checklist — do NOT run a browser)**

Record for the user to eyeball via `npm run dev`:
- Hovering a toolbar/timeline button shows its label in the bar's left, instantly (desktop).
- On iPad, tapping a control shows its label instantly (no native tooltip needed).
- Moving over empty canvas clears the left hint.
- Right side tracks frame (`f n/total`), tool (brush shows its brush type; eraser shows "eraser"), and active layer name as you change them.

- [ ] **Step 5: Commit**

```bash
git add src/lib/StatusBar.svelte src/App.svelte
git commit -m "feat: bottom status bar with instant title-hint + ambient readout"
```

---

## Task 4: Resizable + vertically-scrollable timeline

**Files:**
- Modify: `src/lib/Timeline.svelte` (script: add grip/resize handlers + import; markup: outer div ~L360, toolbar div ~L361, grid wrapper ~L511, ruler container ~L528)

**Interfaces:**
- Consumes: `state.timelineHeight` (Task 2), `clampTimelineHeight` (Task 1).
- Produces: a fixed-height, internally-scrollable, drag-resizable timeline panel.

DOM/gesture code — build + browser verified.

- [ ] **Step 1: Import the clamp helper**

In `Timeline.svelte`'s script, add to the `../anim/*` imports:

```ts
  import { clampTimelineHeight } from "../anim/timeline-layout";
```

- [ ] **Step 2: Add grip drag + window re-clamp handlers**

Add near the other pointer handlers in the script:

```ts
  // Resize the panel by dragging the top grip. Drag UP → taller (shrinks the canvas above);
  // DOWN → shorter. Clamped to [MIN, 60% viewport]. The prefs $effect persists the change.
  let gripStartY = 0;
  let gripStartH = 0;
  function gripDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gripStartY = e.clientY;
    gripStartH = appState.timelineHeight;
  }
  function gripMove(e: PointerEvent) {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    appState.timelineHeight = clampTimelineHeight(
      gripStartH + (gripStartY - e.clientY),
      window.innerHeight,
    );
  }
  function gripUp(e: PointerEvent) {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }
  // Keep the panel within 60% of the viewport if the window shrinks.
  function onWindowResize() {
    appState.timelineHeight = clampTimelineHeight(appState.timelineHeight, window.innerHeight);
  }
```

- [ ] **Step 3: Bind window resize**

At the top of `Timeline.svelte`'s markup (before the outer `<div>`), add:

```svelte
<svelte:window onresize={onWindowResize} />
```

- [ ] **Step 4: Make the outer panel a fixed-height flex column + add the grip**

Change the outer div (currently `<div class="border-t border-border bg-surface text-text p-2 text-sm">`) to:

```svelte
<div
  class="border-t border-border bg-surface text-text p-2 text-sm flex flex-col min-h-0 relative"
  style="height: {appState.timelineHeight}px"
>
  <!-- resize grip: overlays the top padding strip, full width; drag to resize the panel -->
  <div
    class="absolute top-0 left-0 right-0 h-2 z-30 flex items-center justify-center cursor-row-resize text-text-muted hover:text-text"
    style="touch-action: none"
    role="separator"
    aria-orientation="horizontal"
    aria-label="Resize timeline"
    title="Drag to resize the timeline"
    onpointerdown={gripDown}
    onpointermove={gripMove}
    onpointerup={gripUp}
    onpointercancel={gripUp}
  >
    <div class="h-0.5 w-8 rounded bg-current opacity-60"></div>
  </div>
```

(Everything already inside the outer div stays; you are only editing the outer opening tag and inserting the grip as its first child.)

- [ ] **Step 5: Keep the toolbar fixed-height**

On the tools toolbar div (currently `<div class="flex items-center gap-1 mb-2 flex-wrap">`, the first child after the grip), add `shrink-0` so it keeps its natural height and doesn't compress:

```svelte
  <div class="flex items-center gap-1 mb-2 flex-wrap shrink-0">
```

- [ ] **Step 6: Make the grid wrapper the scroll region (both axes)**

Change the grid wrapper (currently `<div class="relative overflow-x-auto" bind:this={gridWrapper}>`) to fill the remaining height and scroll vertically too:

```svelte
  <div class="relative flex-1 min-h-0 overflow-auto" bind:this={gridWrapper}>
```

- [ ] **Step 7: Pin the ruler while tracks scroll**

Change the ruler container (currently `<div class="flex items-stretch">`, the one holding the sticky-left label span + the scrub `role="slider"` div) to stick to the top of the scroller with an opaque background:

```svelte
    <div class="flex items-stretch sticky top-0 z-20 bg-surface">
```

(The label gutter is already `sticky left-0`. Note: the playhead line stays `z-10`, so it draws over the rows but under the sticky ruler band — the line no longer crosses the ruler numbers; confirm this reads acceptably in the browser.)

- [ ] **Step 8: Verify build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → still passing.

- [ ] **Step 9: Browser verification (user-deferred checklist — do NOT run a browser)**

Record for the user to eyeball via `npm run dev`:
- Dragging the top grip up makes the timeline taller (canvas shrinks) and down makes it shorter; it stops at ~140px min and ~60% of the window max.
- Height persists across a reload (Preferences).
- Adding enough layers makes the track rows scroll vertically **inside** the panel; the ruler stays pinned at the top and the label gutter stays pinned at the left while scrolling.
- The selection action bar (from the block copy/paste feature) still anchors correctly to the selected cells inside the now-vertically-scrolling wrapper (it reads `scrollTop`/`clientHeight`, so it should).
- Shrinking the browser window re-clamps the panel so it never exceeds 60% of the viewport.

- [ ] **Step 10: Commit**

```bash
git add src/lib/Timeline.svelte
git commit -m "feat: resizable + vertically-scrollable timeline panel (top grip, sticky ruler)"
```

---

## Final verification

- [ ] **Full build:** `npm run build` → 0 errors, 0 warnings.
- [ ] **Full tests:** `npm test` → baseline 302 + the Task-1 unit test passing.
- [ ] **Interactive pass (flag as verification debt):** status-bar hint on desktop hover AND iPad tap; ambient readout; grip resize + persistence + min/max clamp; vertical track scroll with pinned ruler/gutter; selection action bar still correct; window-shrink re-clamp.

---

## Spec coverage self-check

- Status bar left=hint (from `title=`, pointerover+pointerdown), right=ambient (frame/tool/brush|eraser/layer) → Task 3 (+ D3/D4 hint mechanism). Note: the spec floated a `pointerup` clear; the plan intentionally omits it so a tapped control's hint persists (better on touch) — the natural clear on hovering untitled elements remains.
- `statusHint` not persisted; `timelineHeight` persisted via existing debounced prefs effect → Task 2.
- Bounded height, min/max clamp, default → Task 1 + Task 2.
- Visible top grip, drag up=taller, `touch-action:none`, row-resize → Task 4 Steps 2/4.
- Vertical scroll of tracks, sticky ruler, sticky label gutter (pre-existing) → Task 4 Steps 6/7.
- Window-shrink re-clamp → Task 4 Steps 2/3.
- Selection action bar keeps working via `scrollTop`/`clientHeight` (no change needed) → verified in Task 4 browser checklist.
