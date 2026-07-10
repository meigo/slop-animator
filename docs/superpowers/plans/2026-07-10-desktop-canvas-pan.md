# Desktop Canvas Pan + Fit-View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add desktop canvas panning (space-drag, middle-mouse, plain scroll) + a fit-to-view key (`0`), with plain-scroll = pan and ⌘/Ctrl+scroll = zoom.

**Architecture:** A pure `computeFitTransform` helper (node-unit-tested); two new `Viewport` methods (`panBy`, `fitView`); and desktop input wiring in `Canvas.svelte` (capture-phase pan pointers, space/`0` keys, wheel split, cursor). Touch/iPad gestures unchanged.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vite, Vitest (node env).

## Global Constraints

- Build bar: `npm run build` must be **0 errors, 0 warnings**.
- Test baseline **315 passing**; the new `computeFitTransform` test adds to it. `Viewport`/`Canvas` are DOM-coupled (not node-testable) — build + reasoning + browser verified.
- Do NOT change `touch-gestures.ts` or iPad behavior. Pan handlers act only on mouse (`button === 1` or `spaceHeld`); touch still routes to `touch-gestures.ts`; Pencil still draws.
- Surgical edits; match existing style. Pre-commit hook reformats staged files (expected).

---

## File Structure

- **Create** `src/core/viewport-fit.ts` — pure `computeFitTransform`.
- **Create** `src/__tests__/viewport-fit.test.ts` — its unit tests.
- **Modify** `src/core/viewport.ts` — add `panBy` + `fitView` (using the helper).
- **Modify** `src/lib/Canvas.svelte` — wheel split, capture-phase pan pointers, space/`0` keys, cursor.

---

## Task 1: `computeFitTransform` pure helper

**Files:**
- Create: `src/core/viewport-fit.ts`
- Test: `src/__tests__/viewport-fit.test.ts`

**Interfaces:**
- Produces: `function computeFitTransform(parentW, parentH, contentW, contentH, margin?): { zoom, panX, panY }`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/viewport-fit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeFitTransform } from "../core/viewport-fit";

describe("computeFitTransform", () => {
  it("fits by the limiting (wider-than-tall content in a square parent) dimension and centers", () => {
    // content 200x100 into 1000x1000, margin 1 → zoom limited by width: 1000/200 = 5
    const r = computeFitTransform(1000, 1000, 200, 100, 1);
    expect(r.zoom).toBe(5);
    expect(r.panX).toBe((1000 - 200 * 5) / 2); // 0, centered horizontally (fills width)
    expect(r.panY).toBe((1000 - 100 * 5) / 2); // 250, centered vertically
  });

  it("fits by height when content is taller relative to the parent", () => {
    const r = computeFitTransform(1000, 400, 100, 200, 1); // zoom = min(1000/100, 400/200) = 2
    expect(r.zoom).toBe(2);
    expect(r.panX).toBe((1000 - 100 * 2) / 2); // 400
    expect(r.panY).toBe((400 - 200 * 2) / 2); // 0
  });

  it("applies the margin (default 0.9)", () => {
    const r = computeFitTransform(1000, 1000, 100, 100); // min(10,10)*0.9 = 9
    expect(r.zoom).toBe(9);
  });

  it("degenerates safely on zero/negative dimensions (identity)", () => {
    expect(computeFitTransform(0, 0, 100, 100)).toEqual({ zoom: 1, panX: 0, panY: 0 });
    expect(computeFitTransform(1000, 1000, 0, 100)).toEqual({ zoom: 1, panX: 0, panY: 0 });
    expect(computeFitTransform(1000, 1000, 100, -5)).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/viewport-fit.test.ts`
Expected: FAIL — `Cannot find module '../core/viewport-fit'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/viewport-fit.ts`:

```ts
/** Pure fit math (no DOM): scale `contentW × contentH` to fit `parentW × parentH` with a margin,
 *  centered. Returns the viewport zoom + screen-pixel pan (canvas origin offset). Degenerate inputs
 *  (any dimension ≤ 0) return the identity transform. */
export function computeFitTransform(
  parentW: number,
  parentH: number,
  contentW: number,
  contentH: number,
  margin = 0.9,
): { zoom: number; panX: number; panY: number } {
  if (parentW <= 0 || parentH <= 0 || contentW <= 0 || contentH <= 0)
    return { zoom: 1, panX: 0, panY: 0 };
  const zoom = Math.min(parentW / contentW, parentH / contentH) * margin;
  return {
    zoom,
    panX: (parentW - contentW * zoom) / 2,
    panY: (parentH - contentH * zoom) / 2,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/viewport-fit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/viewport-fit.ts src/__tests__/viewport-fit.test.ts
git commit -m "feat: computeFitTransform (pure fit-to-view math)"
```

---

## Task 2: `Viewport.panBy` + `Viewport.fitView`

**Files:**
- Modify: `src/core/viewport.ts` (add the two methods; import the helper)

**Interfaces:**
- Consumes: `computeFitTransform` (Task 1); existing `this.parent`, `this.zoom/panX/panY/rotation`, `this.minZoom/maxZoom`, `applyTransform()`, `onChange`.
- Produces: `panBy(dx: number, dy: number): void`, `fitView(contentW: number, contentH: number): void`.

Build-verified (Viewport constructs from a DOM element; not node-importable).

- [ ] **Step 1: Import the helper**

At the top of `src/core/viewport.ts`:

```ts
import { computeFitTransform } from "./viewport-fit";
```

- [ ] **Step 2: Add the methods**

Add near `resetView()`:

```ts
  /** Pan by a screen-pixel delta (for wheel / trackpad scrolling). */
  panBy(dx: number, dy: number) {
    this.panX += dx;
    this.panY += dy;
    this.applyTransform();
    this.onChange?.();
  }

  /** Fit `contentW × contentH` (logical px) into the parent, centered, resetting rotation. */
  fitView(contentW: number, contentH: number) {
    const fit = computeFitTransform(
      this.parent.clientWidth,
      this.parent.clientHeight,
      contentW,
      contentH,
    );
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, fit.zoom)); // clamp is a no-op at realistic sizes
    this.panX = fit.panX;
    this.panY = fit.panY;
    this.rotation = 0;
    this.applyTransform();
    this.onChange?.();
  }
```

- [ ] **Step 3: Verify build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → baseline + the Task-1 fit test passing.

- [ ] **Step 4: Commit**

```bash
git add src/core/viewport.ts
git commit -m "feat: Viewport.panBy + Viewport.fitView"
```

---

## Task 3: Canvas.svelte — desktop pan, wheel split, fit key, cursor

**Files:**
- Modify: `src/lib/Canvas.svelte` (script: state + handlers; `onMount`: register/cleanup listeners; `onWheel` body; `stage` markup: cursor)

**Interfaces:**
- Consumes: `viewport` (`startPan/updatePan/endPan/panBy/fitView/zoomAt`), `stage` (bound element), `state.project.width/height`.
- Produces: desktop pan + fit + wheel split.

DOM/input code — build + browser verified.

- [ ] **Step 1: Add state + handlers**

In the `<script>`, near the other `let`s (after `let viewport;`), add:

```ts
  let spaceHeld = $state(false);
  let panning = $state(false);

  // Desktop pan: middle-mouse drag, or space + left-drag. Capture-phase on `stage` so it preempts the
  // bubble-phase drawing handler on `display` — a pan never starts a stroke.
  function stagePanDown(e: PointerEvent) {
    if (!viewport) return;
    const wantPan = e.button === 1 || (spaceHeld && e.button === 0);
    if (!wantPan) return;
    e.preventDefault();
    e.stopPropagation();
    viewport.startPan(e.clientX, e.clientY);
    panning = true;
    stage.setPointerCapture(e.pointerId);
  }
  function stagePanMove(e: PointerEvent) {
    if (!panning || !viewport) return;
    e.stopPropagation();
    viewport.updatePan(e.clientX, e.clientY);
  }
  function stagePanUp(e: PointerEvent) {
    if (!panning) return;
    viewport?.endPan();
    panning = false;
    try {
      stage.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  // Space holds a grab-to-pan mode; `0` fits the canvas to the view. Skipped while typing in a field;
  // space is left alone when a BUTTON is focused so it can still activate it.
  function onViewKeyDown(e: KeyboardEvent) {
    const tag = (document.activeElement as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === " " && tag !== "BUTTON") {
      spaceHeld = true;
      e.preventDefault(); // stop page scroll while panning
    } else if (e.key === "0") {
      e.preventDefault();
      viewport?.fitView(state.project.width, state.project.height);
    }
  }
  function onViewKeyUp(e: KeyboardEvent) {
    if (e.key === " ") spaceHeld = false;
  }
```

- [ ] **Step 2: Replace `onWheel`**

Replace the existing `onWheel` (currently `viewport?.zoomAt(e.clientX, e.clientY, e.deltaY)` on every wheel) with the pan/zoom split:

```ts
  // Wheel/trackpad: plain scroll pans; ⌘/Ctrl + scroll (and trackpad pinch, which arrives as
  // ctrl+wheel) zooms at the cursor.
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) viewport?.zoomAt(e.clientX, e.clientY, e.deltaY);
    else viewport?.panBy(-e.deltaX, -e.deltaY); // content follows the scroll
  }
```

- [ ] **Step 3: Register + clean up listeners in `onMount`**

Inside `onMount`, after `viewport = new Viewport(wrapper);` (and after `stage` is available), register the capture-phase pan listeners and the window key listeners:

```ts
    stage.addEventListener("pointerdown", stagePanDown, { capture: true });
    stage.addEventListener("pointermove", stagePanMove, { capture: true });
    stage.addEventListener("pointerup", stagePanUp, { capture: true });
    stage.addEventListener("pointercancel", stagePanUp, { capture: true });
    window.addEventListener("keydown", onViewKeyDown);
    window.addEventListener("keyup", onViewKeyUp);
```

In the `onMount` cleanup `return () => { … }`, add matching removals:

```ts
      stage.removeEventListener("pointerdown", stagePanDown, { capture: true } as EventListenerOptions);
      stage.removeEventListener("pointermove", stagePanMove, { capture: true } as EventListenerOptions);
      stage.removeEventListener("pointerup", stagePanUp, { capture: true } as EventListenerOptions);
      stage.removeEventListener("pointercancel", stagePanUp, { capture: true } as EventListenerOptions);
      window.removeEventListener("keydown", onViewKeyDown);
      window.removeEventListener("keyup", onViewKeyUp);
```

- [ ] **Step 4: Cursor feedback on the stage**

On the `stage` element (`<div bind:this={stage} class="relative flex-1 overflow-hidden bg-canvas-bg touch-none" …>`), add a `style:cursor` directive that wins over the `cursor-none`/`cursor-crosshair` classes while panning or space-held:

```svelte
  style:cursor={panning ? "grabbing" : spaceHeld ? "grab" : null}
```

(`null` removes the inline cursor so the existing class-based cursor applies when not panning.)

- [ ] **Step 5: Verify build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → still passing (no new tests here).

- [ ] **Step 6: Browser verification (user-deferred checklist — do NOT run a browser)**

Record for the user via `npm run dev` on desktop:
- Hold **space** → cursor becomes grab; **drag** pans; release → back to drawing (a space-drag never draws a stroke).
- **Middle-mouse drag** pans. (If middle-click triggers browser autoscroll, note it — may need a `mousedown` preventDefault for button 1.)
- **Plain scroll / two-finger trackpad** pans; **⌘/Ctrl + scroll** zooms at the cursor; **trackpad pinch** zooms.
- **`0`** fits the canvas to the view and centers it.
- **Space still activates a focused toolbar button** (space isn't hijacked when a BUTTON is focused).
- iPad: one-finger pan / two-finger pinch unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/lib/Canvas.svelte
git commit -m "feat: desktop canvas pan (space-drag, middle-mouse, scroll) + fit-view key (0)"
```

---

## Final verification

- [ ] **Full build:** `npm run build` → 0 errors, 0 warnings.
- [ ] **Full tests:** `npm test` → baseline 315 + the new `computeFitTransform` test.
- [ ] **Interactive pass (flag as verification debt):** space-drag / middle-mouse / scroll pan; ⌘Ctrl+scroll & pinch zoom; `0` fit; pan-never-draws; space-still-clicks-buttons; iPad unchanged.

---

## Spec coverage self-check

- Pan inputs: space-drag + middle-mouse (D1) → Task 3 Step 1/3 (capture-phase pan pointers); plain-scroll pan (D1/D2) → Task 3 Step 2 (`onWheel`).
- Wheel split ⌘/Ctrl = zoom (D2) → Task 3 Step 2.
- Fit key `0` (D3) → Task 3 Step 1 (`onViewKeyDown`) + `Viewport.fitView` (Task 2) + `computeFitTransform` (Task 1).
- Cursor feedback → Task 3 Step 4.
- Draw-preemption via capture-phase `stopPropagation` → Task 3 Step 1/3.
- Space-vs-focused-button + typing guards → Task 3 Step 1.
- Touch unchanged (D4) → no change to `touch-gestures.ts`.
- Deferred (rotate, fit-selection, inertia, HUD, config) → not implemented, per spec Non-goals.
