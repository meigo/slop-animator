# Drag-to-change number fields — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every numeric field in the app can be changed by pressing it and dragging sideways, so
setting fps, brush size or canvas width on an iPad no longer needs the on-screen keyboard.

**Architecture:** One pure arithmetic module (`src/core/scrub.ts`, unit-tested) plus one Svelte
component (`src/lib/NumberField.svelte`) that owns the pointer gesture and the typing draft. The nine
existing `type="number"` inputs become `NumberField` call sites; each keeps its own store writes, so
no store code changes.

**Tech Stack:** Svelte 5 runes, TypeScript, Tailwind 4, Vitest (node env, no DOM).

**Spec:** `docs/superpowers/specs/2026-09-18-drag-to-change-number-fields-design.md`

## Global Constraints

- `npm run build` (svelte-check + tsc + vite build) must end with **0 errors, 0 warnings**; the
  pre-existing "chunks are larger than 500 kB" notice is not a warning this gate counts.
- Runes mode everywhere. A component using the `$state` rune must import the store as
  `import { state as appState }` (CLAUDE.md gotcha #1).
- Every draggable surface sets `touch-action: none`, or iPad cancels the pointer stream
  (gotcha #10). In Tailwind that is the `touch-none` class.
- A drag must never push more than one undo entry (see `applyAnimationLength`'s doc comment).
- Test baseline before this work: **1372 passing**. Update the counts in `README.md` and `CLAUDE.md`
  in the final task, from an actual `npm test` run.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Spec amendment (decided while writing this plan)

**§4 case 2 — Length — is replaced by commit-on-release.** The spec said Length would write live
through `applyAnimationLength` inside one undo bracket. That is wrong: `Playbar.commitLength`
asks for confirmation before a shortening that would drop keyframes
(`confirm("Shorten to N frames? This removes K keyframe(s).")`), and a live drag would either fire
that dialog on every pointermove or drop keyframes with no confirmation at all. Length therefore
behaves like Track step: the field shows the number while dragging and writes once on release,
through the existing confirm-then-`setAnimationLength` path. No undo bracketing is needed, so
`beginStructuralEdit`/`commitStructuralEdit` do not appear in this plan.

---

## File structure

| File | Responsibility |
|---|---|
| `src/core/scrub.ts` (new) | Pure drag arithmetic: threshold, fine factor, step decimals, `scrubbedValue`. No DOM. |
| `src/__tests__/scrub.test.ts` (new) | Unit tests for the above. |
| `src/lib/NumberField.svelte` (new) | The control: pointer gesture, typing draft, keyboard, styling. |
| `src/lib/ToolOptions.svelte` | Brush size call site. |
| `src/lib/Canvas.svelte` | Pose gap call site. |
| `src/lib/LayerProps.svelte` | Video speed call site. |
| `src/lib/Playbar.svelte` | fps + Length call sites. |
| `src/lib/ProjectSettingsDialog.svelte` | fps call site. |
| `src/lib/SizeDialog.svelte` | Canvas W/H call sites. |
| `src/lib/TrackKeyControls.svelte` | Track step call site. |
| `README.md`, `CLAUDE.md`, `docs/superpowers/CHANGELOG.md`, the spec | Documentation. |

---

### Task 1: Scrub arithmetic

**Files:**
- Create: `src/core/scrub.ts`
- Test: `src/__tests__/scrub.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SCRUB_THRESHOLD_PX: number`, `FINE_FACTOR: number`,
  `stepDecimals(step: number): number`,
  `scrubbedValue(a: ScrubArgs): number` where
  `ScrubArgs = { startValue: number; dx: number; step: number; pxPerStep: number; fine: boolean; min: number; max: number }`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/scrub.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scrubbedValue, stepDecimals, SCRUB_THRESHOLD_PX, FINE_FACTOR } from "../core/scrub";

const fps = { startValue: 24, step: 1, pxPerStep: 8, fine: false, min: 1, max: 60 };

describe("stepDecimals", () => {
  it("reads the precision from the step, so 0.1 steps display one decimal", () => {
    expect(stepDecimals(1)).toBe(0);
    expect(stepDecimals(0.5)).toBe(1);
    expect(stepDecimals(0.1)).toBe(1);
    expect(stepDecimals(8)).toBe(0);
  });
});

describe("scrubbedValue", () => {
  it("moves one step per pxPerStep of travel, to the right", () => {
    expect(scrubbedValue({ ...fps, dx: 8 })).toBe(25);
    expect(scrubbedValue({ ...fps, dx: 80 })).toBe(34);
  });
  it("moves down when dragged left", () => {
    expect(scrubbedValue({ ...fps, dx: -80 })).toBe(14);
  });
  it("lands on whole steps, rounding part-way travel", () => {
    expect(scrubbedValue({ ...fps, dx: 3 })).toBe(24); // under half a step
    expect(scrubbedValue({ ...fps, dx: 5 })).toBe(25); // over half a step
  });
  it("returns exactly the start value when dragged back to the press point", () => {
    expect(scrubbedValue({ ...fps, dx: 0 })).toBe(24);
  });
  it("is measured from the press, not accumulated", () => {
    // 80px out then back to 8px is the same as going straight to 8px.
    expect(scrubbedValue({ ...fps, dx: 8 })).toBe(scrubbedValue({ ...fps, dx: 8 }));
    expect(scrubbedValue({ ...fps, dx: 800 })).toBe(60); // clamped, not wrapped
  });
  it("clamps to min and max", () => {
    expect(scrubbedValue({ ...fps, dx: 10000 })).toBe(60);
    expect(scrubbedValue({ ...fps, dx: -10000 })).toBe(1);
  });
  it("fine mode needs FINE_FACTOR times the travel for one step", () => {
    expect(scrubbedValue({ ...fps, dx: 8, fine: true })).toBe(24);
    expect(scrubbedValue({ ...fps, dx: 8 * FINE_FACTOR, fine: true })).toBe(25);
  });
  it("snaps onto the step grid measured from min", () => {
    // Brush size: min 0.5, step 0.5 — an off-grid start value lands on the grid.
    expect(scrubbedValue({ startValue: 3.7, dx: 4, step: 0.5, pxPerStep: 4, fine: false, min: 0.5, max: 60 })).toBe(4);
  });
  it("keeps 0.1 steps clean, with no float dust", () => {
    const speed = { startValue: 1, step: 0.1, pxPerStep: 8, fine: false, min: 0.1, max: 8 };
    expect(scrubbedValue({ ...speed, dx: 24 })).toBe(1.3);
    expect(scrubbedValue({ ...speed, dx: -24 })).toBe(0.7);
  });
  it("ignores a non-finite dx", () => {
    expect(scrubbedValue({ ...fps, dx: NaN })).toBe(24);
  });
  it("exposes a 3px threshold, so a tap is not a drag", () => {
    expect(SCRUB_THRESHOLD_PX).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/__tests__/scrub.test.ts`
Expected: FAIL — `Cannot find module '../core/scrub'`.

- [ ] **Step 3: Write the implementation**

Create `src/core/scrub.ts`:

```ts
/**
 * Drag-to-change arithmetic for `lib/NumberField.svelte`. Pure: no DOM, no store.
 *
 * Mirrors slop-video-compositor's `src/lib/scrub.ts`, with the value quantised to the field's own
 * step — the compositor's fields are all 0.01-step floats, while these are whole fps, whole pixels
 * and half-pixel brush sizes, which must not drift off their grid.
 */

/** Travel before a press becomes a drag. Below this it is still a tap that focuses the field for
 *  typing, which is how one control serves both gestures. Same value as the compositor's. */
export const SCRUB_THRESHOLD_PX = 3;

/** Shift costs this many times more travel per step — FINER control on the SAME grid. (The
 *  compositor's Shift multiplies the step by 0.1 instead, which here would produce 0.1 fps.) */
export const FINE_FACTOR = 4;

/** Digits after the point implied by `step`, for display and for float cleanup. */
export function stepDecimals(step: number): number {
  const s = String(step);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

export interface ScrubArgs {
  /** Value at pointerdown. The drag is always measured from here, never accumulated, so returning
   *  the pointer to where it was pressed restores the value exactly. */
  startValue: number;
  dx: number; // clientX - startX
  step: number;
  pxPerStep: number;
  fine: boolean; // Shift held
  min: number;
  max: number;
}

export function scrubbedValue({
  startValue,
  dx,
  step,
  pxPerStep,
  fine,
  min,
  max,
}: ScrubArgs): number {
  if (!Number.isFinite(dx)) return startValue;
  const steps = Math.round(dx / (pxPerStep * (fine ? FINE_FACTOR : 1)));
  // Snapped to the grid ANCHORED AT `min`, not at 0: that is the grid the arrow keys and the old
  // spinner walked, so a dragged value lands on the same numbers a typed one does.
  const raw = startValue + steps * step;
  const snapped = min + Math.round((raw - min) / step) * step;
  const clamped = Math.max(min, Math.min(max, snapped));
  return Number(clamped.toFixed(stepDecimals(step)));
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/__tests__/scrub.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/scrub.ts src/__tests__/scrub.test.ts
git commit -m "feat(scrub): drag arithmetic for number fields

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The NumberField component

**Files:**
- Create: `src/lib/NumberField.svelte`

**Interfaces:**
- Consumes: `SCRUB_THRESHOLD_PX`, `scrubbedValue`, `stepDecimals` from `src/core/scrub.ts`.
- Produces: a component with props
  `{ value: number; min: number; max: number; step: number; pxPerStep?: number; decimals?: number; title?: string; ariaLabel: string; disabled?: boolean; class?: string; onInput?: (v: number) => void; onCommit: (v: number) => void }`.
  `onInput` present = the field writes live on every move; absent = it writes once, on release.

There is no DOM in Vitest, so this task has no unit test; it is verified by the build and by the
browser pass in Task 6.

- [ ] **Step 1: Write the component**

Create `src/lib/NumberField.svelte`:

```svelte
<script lang="ts">
  import { SCRUB_THRESHOLD_PX, scrubbedValue, stepDecimals } from "../core/scrub";

  interface Props {
    value: number;
    min: number;
    max: number;
    /** The typing/arrow increment AND the grid a drag snaps to. */
    step: number;
    /** Horizontal travel worth one step. */
    pxPerStep?: number;
    decimals?: number;
    title?: string;
    ariaLabel: string;
    disabled?: boolean;
    class?: string;
    /** Called on every move of a LIVE field. Omit it for a field whose setter is undoable and has
     *  no non-committing variant: the field then shows the number while dragging and writes once,
     *  on release, so one drag is one undo entry. */
    onInput?: (v: number) => void;
    onCommit: (v: number) => void;
  }

  let {
    value,
    min,
    max,
    step,
    pxPerStep = 8,
    decimals,
    title = "",
    ariaLabel,
    disabled = false,
    class: klass = "",
    onInput,
    onCommit,
  }: Props = $props();

  const dp = $derived(decimals ?? stepDecimals(step));
  const show = (v: number) => v.toFixed(dp);

  let input: HTMLInputElement | undefined;
  let draft = $state(show(value));
  /** The field owns the text while it is focused or being dragged; outside that the store does. */
  let editing = $state(false);

  // Re-sync when the value changes from OUTSIDE this field — undo, a preset button, a timeline
  // drag. Guarded by `editing`, or it would overwrite what is being typed or dragged.
  $effect(() => {
    const next = show(value);
    if (!editing && draft !== next) draft = next;
  });

  const clamp = (v: number) => Math.max(min, Math.min(max, v));

  // Non-reactive on purpose: nothing renders from it.
  let scrub: { startX: number; startValue: number; moved: boolean } | null = null;

  function onPointerDown(e: PointerEvent) {
    if (disabled || e.button !== 0) return;
    scrub = { startX: e.clientX, startValue: value, moved: false };
    // NO preventDefault: the browser still focuses the field and places the caret, so a press that
    // never travels is an ordinary tap-to-type.
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    // An OS-cancelled stream (iPad palm rejection) must END the gesture, not leave it armed for the
    // next press to inherit — the gap CLAUDE.md gotcha #6 records for the transform drags.
    window.addEventListener("pointercancel", onPointerUp);
  }

  function onPointerMove(e: PointerEvent) {
    if (!scrub) return;
    const dx = e.clientX - scrub.startX;
    if (!scrub.moved) {
      if (Math.abs(dx) < SCRUB_THRESHOLD_PX) return;
      scrub.moved = true;
      editing = true;
      input?.blur(); // a caret blinking in a field being scrubbed is a lie
    }
    const next = scrubbedValue({
      startValue: scrub.startValue,
      dx,
      step,
      pxPerStep,
      fine: e.shiftKey,
      min,
      max,
    });
    draft = show(next);
    onInput?.(next);
  }

  function onPointerUp() {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    const moved = scrub?.moved ?? false;
    scrub = null;
    editing = false;
    if (!moved) return; // a tap: the field is focused for typing, nothing is written
    const v = Number(draft);
    if (Number.isFinite(v)) onCommit(clamp(v));
  }

  /** Write a typed value. A draft equal to the current value writes NOTHING, so tabbing through a
   *  field cannot push an empty undo entry. */
  function commitDraft() {
    const v = Number(draft);
    if (!Number.isFinite(v) || draft.trim() === "") {
      draft = show(value);
      return;
    }
    const c = clamp(v);
    if (c === value) {
      draft = show(value); // normalise what is displayed (e.g. "07" → "7")
      return;
    }
    onCommit(c);
    draft = show(c);
  }

  function onKeyDown(e: KeyboardEvent) {
    // The global handler drops single-key shortcuts whose target is an INPUT (App.svelte), but a
    // field is exactly where a stray `b`/`e`/`f` would be most annoying, so stop them here too.
    e.stopPropagation();
    if (e.key === "Enter") {
      input?.blur();
      return;
    }
    if (e.key === "Escape") {
      draft = show(value);
      input?.blur();
      return;
    }
    // Replaces the spinner arrows the text input does not have.
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = clamp(value + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
      if (next === value) return;
      draft = show(next);
      onInput?.(next);
      onCommit(next);
    }
  }
</script>

<!-- `type="text"` with a decimal inputmode, NOT `type="number"`: a number input owns pointer
     gestures for its spinner, which is exactly the gesture the scrub needs. It stays an <input> so
     App.svelte's INPUT/TEXTAREA guard keeps single-key tool shortcuts out while it is focused. -->
<input
  bind:this={input}
  class="{klass} touch-none tabular-nums {disabled ? '' : 'cursor-ew-resize'}"
  type="text"
  inputmode="decimal"
  aria-label={ariaLabel}
  aria-disabled={disabled}
  title={title ? `${title} · Drag to change` : "Drag to change"}
  value={draft}
  oninput={(e) => (draft = e.currentTarget.value)}
  onpointerdown={onPointerDown}
  onfocus={() => (editing = true)}
  onblur={() => {
    editing = false;
    commitDraft();
  }}
  onkeydown={onKeyDown}
/>
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: `0 ERRORS 0 WARNINGS` from svelte-check, tsc silent, vite build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/NumberField.svelte
git commit -m "feat(ui): NumberField — a drag-to-change numeric input

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Live fields — brush size, pose gap, video speed

Three fields whose writes are not undoable today, so they write on every move exactly as they do
now. Each keeps its existing classes, so nothing moves on screen.

**Files:**
- Modify: `src/lib/ToolOptions.svelte:107-115` (the `type="number"` after the range slider)
- Modify: `src/lib/Canvas.svelte:2457-2472` (the pose Gap field)
- Modify: `src/lib/LayerProps.svelte:521-530` (the video speed field)

**Interfaces:**
- Consumes: `NumberField` from Task 2.
- Produces: nothing for later tasks.

- [ ] **Step 1: Brush size**

In `src/lib/ToolOptions.svelte`, add the import next to the existing ones:

```ts
  import NumberField from "./NumberField.svelte";
```

Replace the number input (the second `<input>` inside the Size label, the one with
`class="w-12 …"`) with:

```svelte
      <NumberField
        class="w-12 text-xs bg-surface border border-border rounded px-1 text-text"
        value={stroke.size}
        min={0.5}
        max={60}
        step={0.5}
        pxPerStep={4}
        title="Brush size"
        ariaLabel="Brush size"
        onInput={(v) => (stroke.size = v)}
        onCommit={(v) => (stroke.size = v)}
      />
```

`stroke` is `$derived(appState.tool === "eraser" ? appState.eraser : appState.brush)`, so writing
`stroke.size` writes through the store proxy exactly as the old `bind:value` did.

- [ ] **Step 2: Pose gap**

In `src/lib/Canvas.svelte`, add `import NumberField from "./NumberField.svelte";` with the other
component imports, and replace the Gap input with:

```svelte
            <NumberField
              class="w-10 text-xs bg-surface border border-border rounded px-1 text-text"
              value={appState.pose.gap}
              min={0}
              max={MAX_GAP}
              step={1}
              title="Bridge breaks in the outline, up to about twice this many pixels"
              ariaLabel="Fill gap"
              onInput={(v) => {
                appState.pose.gap = v;
                rebuildPoseMesh();
              }}
              onCommit={(v) => {
                appState.pose.gap = v;
                rebuildPoseMesh();
              }}
            />
```

The old handler's clamp-and-write-back comment goes with it: `NumberField` clamps to `min`/`max`
itself and re-renders from the store value, which is what that code was doing by hand. Leave
`clampGap` in `src/core/fill-holes.ts` alone — the fill engine and its tests still use it.

The label wrapping this field carries the same `title`; leave the label's `title` as it is.

- [ ] **Step 3: Video speed**

In `src/lib/LayerProps.svelte`, add `import NumberField from "./NumberField.svelte";`, and replace
the speed input with:

```svelte
          <NumberField
            class="w-9 text-xs bg-surface border border-border px-0.5 text-text"
            value={layer.speed}
            min={0.1}
            max={8}
            step={0.1}
            title="Playback speed (× real time)"
            ariaLabel="Video playback speed"
            onInput={(v) => {
              layer.speed = v;
              bump();
            }}
            onCommit={(v) => {
              layer.speed = v;
              bump();
            }}
          />
```

- [ ] **Step 4: Verify**

Run: `npm run build && npm test`
Expected: 0 errors, 0 warnings; tests pass (count unchanged from Task 1's run).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ToolOptions.svelte src/lib/Canvas.svelte src/lib/LayerProps.svelte
git commit -m "feat(ui): drag brush size, pose gap and video speed

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: fps (both places) and canvas W/H

**Files:**
- Modify: `src/lib/Playbar.svelte:186-195` (fps in the settings popover)
- Modify: `src/lib/ProjectSettingsDialog.svelte:80-89` (fps in Project settings)
- Modify: `src/lib/SizeDialog.svelte:99-120` (W and H)

**Interfaces:**
- Consumes: `NumberField` from Task 2.
- Produces: nothing for later tasks.

- [ ] **Step 1: fps in the Playbar**

Add `import NumberField from "./NumberField.svelte";` to `src/lib/Playbar.svelte` and replace the
fps input with:

```svelte
          <NumberField
            class="w-12 bg-surface border border-border text-text px-1"
            value={appState.project.fps}
            min={1}
            max={60}
            step={1}
            title="Frames per second"
            ariaLabel="Frames per second"
            onInput={setFps}
            onCommit={setFps}
          />
```

`setFps` already clamps to 1–60 and calls `bump()`; leave it as it is.

- [ ] **Step 2: fps in Project settings**

Add `import NumberField from "./NumberField.svelte";` to `src/lib/ProjectSettingsDialog.svelte` and
replace its fps input with:

```svelte
          <NumberField
            class="w-20 bg-surface border border-border text-text px-1"
            value={appState.project.fps}
            min={1}
            max={60}
            step={1}
            title="Frames per second"
            ariaLabel="Frames per second"
            onInput={setFps}
            onCommit={setFps}
          />
```

That file's own `setFps` (clamp + `bump()`) is unchanged.

- [ ] **Step 3: Canvas W and H**

Add `import NumberField from "./NumberField.svelte";` to `src/lib/SizeDialog.svelte` and replace the
two inputs with:

```svelte
      <div class="flex items-center gap-3">
        <label class="flex items-center gap-1 text-text-secondary"
          >W
          <NumberField
            class="w-20 bg-surface border border-border text-text px-1"
            value={w}
            min={16}
            max={8192}
            step={8}
            pxPerStep={4}
            title="Canvas width in pixels"
            ariaLabel="Canvas width"
            onInput={(v) => (w = v)}
            onCommit={(v) => (w = v)}
          /></label
        >
        <label class="flex items-center gap-1 text-text-secondary"
          >H
          <NumberField
            class="w-20 bg-surface border border-border text-text px-1"
            value={h}
            min={16}
            max={8192}
            step={8}
            pxPerStep={4}
            title="Canvas height in pixels"
            ariaLabel="Canvas height"
            onInput={(v) => (h = v)}
            onCommit={(v) => (h = v)}
          /></label
        >
      </div>
```

`w` and `h` are dialog-local `$state` applied when the dialog is confirmed, so there is nothing to
undo here. A preset button still writes both, and the `$effect` that prefills from the document
still re-syncs the fields, because `NumberField` follows its `value` prop whenever it is not being
edited.

Note the step: 8 pixels. A typed value is NOT forced onto that grid — typing 1281 keeps 1281; only a
drag snaps, and it snaps to `16 + 8k`.

- [ ] **Step 4: Verify**

Run: `npm run build && npm test`
Expected: 0 errors, 0 warnings; tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Playbar.svelte src/lib/ProjectSettingsDialog.svelte src/lib/SizeDialog.svelte
git commit -m "feat(ui): drag fps and canvas size

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The two undoable fields — Length and Track step

Both setters commit an undo entry per call, so neither field passes `onInput`: the number moves under
the finger, and one write happens on release. One drag = one undo entry.

**Files:**
- Modify: `src/lib/Playbar.svelte:44-60` (`commitLength`) and its Length input
- Modify: `src/lib/TrackKeyControls.svelte:207-231` (the Step input)

**Interfaces:**
- Consumes: `NumberField` from Task 2 (already imported into `Playbar.svelte` in Task 4).
- Produces: nothing for later tasks.

- [ ] **Step 1: Length — take a number instead of an event**

In `src/lib/Playbar.svelte`, replace the whole `commitLength` function with:

```ts
  // Called once per gesture (release of a drag, Enter, or blur) — never per pointermove, so the
  // confirm below cannot fire mid-drag and a drag cannot leave a trail of undo entries.
  function commitLength(n: number) {
    const target = Math.max(1, Math.min(9999, Math.floor(n)));
    if (target === appState.project.frameCount) return;
    if (target < appState.project.frameCount) {
      const dropped = countKeyframesPastLength(appState.project, target);
      if (dropped > 0 && !confirm(`Shorten to ${target} frames? This removes ${dropped} keyframe(s).`))
        return; // cancelled — NumberField re-reads the unchanged store value and snaps back
    }
    setAnimationLength(target);
  }
```

and the Length input with:

```svelte
          <NumberField
            class="w-16 bg-surface border border-border text-text px-1"
            value={appState.project.frameCount}
            min={1}
            max={9999}
            step={1}
            pxPerStep={6}
            title="Animation length in frames"
            ariaLabel="Animation length in frames"
            onCommit={commitLength}
          />
```

No `onInput`: passing one would run `setAnimationLength` — which ripples every layer and asks for
confirmation — on every pixel of the drag.

- [ ] **Step 2: Track step**

In `src/lib/TrackKeyControls.svelte`, add `import NumberField from "./NumberField.svelte";` and
replace the Step input with:

```svelte
    <NumberField
      class={STEP}
      value={track.sampleEvery ?? 1}
      min={1}
      max={MAX_SAMPLE_EVERY}
      step={1}
      pxPerStep={10}
      title={stepTitle}
      ariaLabel="Sample every N frames"
      disabled={!!blocked}
      onCommit={(v) => {
        if (!blocked) setTrackSampleEvery(trackRef, v);
      }}
    />
```

The old handler's "write the RESOLVED value back" dance is no longer needed: `setTrackSampleEvery`
clamps, and `NumberField` re-renders from `track.sampleEvery` whenever the field is not being edited,
so a refused or clamped write shows up by itself. The `pointer-events-none` class is replaced by the
component's `disabled` prop, which also skips the drag. Keep the surrounding `<label>` and its
`title={stepTitle}` exactly as they are.

- [ ] **Step 3: Verify**

Run: `npm run build && npm test`
Expected: 0 errors, 0 warnings; tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/Playbar.svelte src/lib/TrackKeyControls.svelte
git commit -m "feat(ui): drag animation length and track step, committing once per drag

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Browser pass and documentation

**Files:**
- Modify: `README.md` (Features bullet + test count), `CLAUDE.md` (test count + a gotcha line),
  `docs/superpowers/CHANGELOG.md` (dated entry), and the spec's §4 (record the Length amendment).

- [ ] **Step 1: Run the app and check every field**

Run: `npm run dev` and open the app. For each of the nine fields — brush size (Tool options), fps
(playbar settings popover), fps (Project settings dialog), Length (playbar settings popover), W and H
(New/Resize canvas dialog), pose Gap (Pose tool bar), video speed (a video reference layer's row),
Step (a property track's key bar) — confirm:

1. Press and drag right: the number rises; drag left: it falls; back to the press point: the
   original value.
2. A tap without moving focuses the field and lets you type; Enter commits, Escape restores.
3. Shift-drag moves more slowly, on the same numbers.
4. Arrow Up/Down step the value; Shift-arrow moves by ten.

Then the two undo checks:

5. Drag Length from 10 to 20, then ⌘Z once: the length returns to 10 in ONE undo.
6. Drag Length down past keyframes: the confirm appears ONCE, on release, not during the drag.
7. Drag Step on a property track, then ⌘Z once: one entry.

- [ ] **Step 2: Write the changelog entry**

Append to `docs/superpowers/CHANGELOG.md` a dated entry covering: the ask, the component and its
arithmetic module, the per-field step/pxPerStep table, the three commit shapes (live / commit on
release), the Length amendment and why (the confirm), `touch-action: none`, the lost desktop spinner
and the arrow keys that replace it, and what was verified where. Follow the file's existing style:
bold lead sentence with the date, then bullets.

- [ ] **Step 3: Update the spec**

In `docs/superpowers/specs/2026-09-18-drag-to-change-number-fields-design.md`, mark §4 case 2
superseded, per CLAUDE.md's rule that a superseded entry must be marked:

```markdown
> **SUPERSEDED 2026-09-18 by the plan's "Spec amendment":** Length is commit-on-release, like Track
> step. `commitLength` asks for confirmation before dropping keyframes, and a live drag would fire
> that dialog per pointermove.
```

- [ ] **Step 4: Update README and CLAUDE.md**

In `README.md`, add to the Features list:

```markdown
- Numeric fields change by dragging — press a field and drag sideways (Shift for fine steps); tap it to type as before
```

Run `npm test`, read the real number off the output, and update both the README scripts block
(`pure-logic unit tests (N)`) and `CLAUDE.md`'s `Baseline **N passing**`.

In `CLAUDE.md`, add one line to the Current state section noting that numeric fields scrub.

- [ ] **Step 5: Final verification and commit**

Run: `npm run build && npm test && npm run lint`
Expected: 0 errors, 0 warnings, all tests pass, lint clean.

```bash
git add -A
git commit -m "docs: drag-to-change number fields

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Deploy for the iPad pass**

Run: `npm run deploy`, then confirm the live bundle changed (compare the `index-*.js` name in
`dist/index.html` with a cache-busted fetch of the site). Tell the user what to try: a Pencil drag on
each field changes the value WITHOUT raising the keyboard; a tap still opens the keyboard for typing;
a palm-rejected drag leaves no stuck state; panels still scroll where a drag does not start on a
field.

---

## Self-review

**Spec coverage:** §1 → Task 1. §2 → Task 2. §3 (per-field table) → Tasks 3–5. §4 case 1 → Task 3 and
Task 4; case 2 → amended, Task 5; case 3 → Task 5. §5 (out of scope) → no task touches the sliders.
§6 → Task 1's tests, Task 6 steps 1 and 6. §7 (risks) → the fields are converted in three separate,
individually verified commits.

**Placeholders:** none — every step carries the code or the exact command.

**Type consistency:** `scrubbedValue`/`ScrubArgs`/`stepDecimals`/`SCRUB_THRESHOLD_PX`/`FINE_FACTOR`
are defined in Task 1 and used with those names in Tasks 1–2. `NumberField`'s props are defined in
Task 2 and every call site in Tasks 3–5 passes that exact set (`onInput` omitted only in Task 5).
`commitLength` changes signature from `(e: Event)` to `(n: number)` in Task 5, and its only caller is
the field defined in the same step.
