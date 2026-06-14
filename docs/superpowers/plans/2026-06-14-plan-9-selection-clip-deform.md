# Plan 9 — Selection: clip-paint + deformation tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an active selection a paint/erase/fill mask, and add on-screen deformation (free transform + distort + mesh warp) via a floating actions panel — usable on iPad without a keyboard.

**Architecture:** When a marquee is active, switching to a drawing tool no longer cancels it; brush/eraser/fill calls are wrapped in `selection.applyClip(ctx)` so they only affect the selected region. Deformation reuses the already-ported (but unwired) warp methods in `core/selection.ts`: `enterTransform`/`enterWarp` lift the pixels and switch the selection into transforming/warping state, and a ported floating `SelectionActions` panel (Transform / Distort / Mesh / Commit / Cancel) drives them by tap. Keyboard `W`/`M` mirror Distort/Mesh on desktop.

**Tech Stack:** Svelte 5 (runes), Tailwind 4 (theme classes), `@lucide/svelte`, Vitest.

> ⚠️ **VERIFICATION NOTE:** only `computeAnchor` (panel positioning math) is unit-tested. Clip-drawing, the warp panel, and the lift/commit flow are DOM/pointer integration — **no other new unit tests**; the gate is type-check/build/no-regression (69 tests) plus **human** verification on the iPad (paint inside a selection; tap Distort/Mesh; drag handles; Commit/Cancel).

**Builds on Plans 1–8 (on `main`).** Existing facts:
- `src/core/selection.ts` (verbatim slop-paint copy) already has: `applyClip(ctx): boolean` (clips to rect/lasso when `state==="selected"`), `liftPixels(srcCtx, dpr)`, `beginTransform(lifted)`, `beginWarp(rows,cols)`, `densifyWarp(rows,cols)`, `commit()`, `cancel()`, `getScreenBounds(): {x,y}[]|null`, getters `active`/`hasFloating`/`isDragging`, props `state`/`mode`/`warpRows`/`warpCols`/`screenScale`, callbacks `onChange`/`onStateChange`/`onCommit`/`onCancel`.
- `src/core/viewport.ts`: `Viewport` with `canvasToScreen(cx,cy)`, `zoom`.
- `src/lib/Canvas.svelte`: `onStroke` (selection branch returns early for select/lasso; brush path; fill via `doFill`); `setupSelection()` wires the Selection instance + `selCtx`/`selBefore` (the lift snapshot used by `onCommit`/`onCancel`); a `$effect` that currently commits/cancels the selection when switching to a drawing tool; markup `stage > wrapper > (display, overlay)`.
- `src/state/appState.svelte.ts`: `state`, `activeLayer()`, `canvasOps`, `bump`, `selectionRef`, `DPR`.
- `src/App.svelte`: global `onKey` with INPUT/TEXTAREA guard; already has `Enter`=commit-or-play and `Escape`=cancel via `selectionRef`.
- tsconfig: `erasableSyntaxOnly`, `noUnusedLocals`.

slop-paint references: `src/selection-anchor.ts`, `src/lib/SelectionActions.svelte` (the originals to port from).

---

## File Structure

```
src/
  core/selection-anchor.ts   ← NEW (verbatim copy): computeAnchor (panel positioning)
  lib/SelectionActions.svelte ← NEW: floating Transform/Distort/Mesh/Commit/Cancel panel (themed, Lucide)
  state/appState.svelte.ts    ← MODIFY: selectionActions ref ({ enterWarp })
  lib/Canvas.svelte           ← MODIFY: enterTransform/enterWarp; clip brush/eraser/fill; keep marquee on
                                 tool switch; mount SelectionActions; populate selectionActions ref
  App.svelte                  ← MODIFY: W/M keyboard shortcuts (desktop)
  __tests__/selection-anchor.test.ts ← NEW (computeAnchor)
```

---

## Task 1: Port `selection-anchor.ts` + test

**Files:**
- Create (by copy): `src/core/selection-anchor.ts`
- Test: `src/__tests__/selection-anchor.test.ts`

- [ ] **Step 1: Copy the file**

Run:
```bash
cp /Users/meigo/Projects/slop/slop-paint/src/selection-anchor.ts /Users/meigo/Projects/slop/slop-animator/src/core/selection-anchor.ts
```
It exports `Point`, `AnchorInput`, `AnchorResult`, `computeAnchor`. No imports.

- [ ] **Step 2: Write the test**

Create `src/__tests__/selection-anchor.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeAnchor } from "../core/selection-anchor";

const idScreen = (p: { x: number; y: number }) => p; // doc==screen for the test

describe("computeAnchor", () => {
  it("centers the panel horizontally over the bbox and places it above by margin", () => {
    const a = computeAnchor({
      bboxDoc: [{ x: 100, y: 100 }, { x: 200, y: 160 }],
      docToScreen: idScreen,
      panelSize: { w: 40, h: 20 },
      viewport: { w: 1000, h: 1000 },
      margin: 10,
    });
    // centerX = 150 → x = 150 - 20 = 130; aboveY = 100 - 10 - 20 = 70
    expect(a).toEqual({ x: 130, y: 70 });
  });

  it("drops below the bbox when there is no room above", () => {
    const a = computeAnchor({
      bboxDoc: [{ x: 100, y: 5 }, { x: 200, y: 40 }],
      docToScreen: idScreen,
      panelSize: { w: 40, h: 20 },
      viewport: { w: 1000, h: 1000 },
      margin: 10,
    });
    // aboveY = 5 - 10 - 20 = -25 < margin → belowY = 40 + 10 = 50
    expect(a.y).toBe(50);
  });

  it("clamps x within the viewport margins", () => {
    const a = computeAnchor({
      bboxDoc: [{ x: 0, y: 100 }, { x: 10, y: 120 }],
      docToScreen: idScreen,
      panelSize: { w: 200, h: 20 },
      viewport: { w: 300, h: 1000 },
      margin: 10,
    });
    expect(a.x).toBe(10); // clamped to left margin
  });
});
```

- [ ] **Step 3: Run to verify it passes**

Run: `npm test -- selection-anchor`
Expected: PASS (3 tests). (`selection-anchor.ts` is a verbatim port of working code — these lock its behavior.) Then `npm run check` — 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/selection-anchor.ts src/__tests__/selection-anchor.test.ts
git commit -m "feat(core): port selection-anchor (panel positioning) with tests"
```

---

## Task 2: SelectionActions floating panel

**Files:**
- Create: `src/lib/SelectionActions.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/SelectionActions.svelte`:
```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { Move, SquareDashed, Grid3x3, Check, X } from "@lucide/svelte";
  import type { Selection } from "../core/selection";
  import type { Viewport } from "../core/viewport";
  import { computeAnchor } from "../core/selection-anchor";

  let { selection, viewport, containerEl, onTransform, onDistort, onMesh, onCommit, onCancel }: {
    selection: Selection;
    viewport: Viewport;
    containerEl: HTMLElement;
    onTransform: () => void;
    onDistort: () => void;
    onMesh: () => void;
    onCommit: () => void;
    onCancel: () => void;
  } = $props();

  const MARGIN = 12;
  let panelEl: HTMLDivElement;
  let visible = $state(false);
  let mode = $state<"selected" | "transforming" | "warping">("selected");
  let warp = $state({ rows: 2, cols: 2 });
  let pos = $state({ x: 0, y: 0 });
  let rafId = 0;

  function tick() {
    if (panelEl && containerEl) {
      const bounds = selection.getScreenBounds();
      if (!bounds || selection.isDragging) {
        visible = false;
      } else {
        mode = selection.state as "selected" | "transforming" | "warping";
        warp = { rows: selection.warpRows, cols: selection.warpCols };
        const wsRect = containerEl.getBoundingClientRect();
        const panelRect = panelEl.getBoundingClientRect();
        const a = computeAnchor({
          bboxDoc: bounds,
          docToScreen: (p) => {
            const s = viewport.canvasToScreen(p.x, p.y);
            return { x: s.x - wsRect.left, y: s.y - wsRect.top };
          },
          panelSize: { w: panelRect.width || 180, h: panelRect.height || 40 },
          viewport: { w: containerEl.clientWidth, h: containerEl.clientHeight },
          margin: MARGIN,
        });
        pos = { x: a.x, y: a.y };
        visible = true;
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  onMount(() => {
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  });

  const distortActive = $derived(mode === "warping" && warp.rows === 2 && warp.cols === 2);
  const meshActive = $derived(mode === "warping" && (warp.rows !== 2 || warp.cols !== 2));

  // Stop taps from bleeding through to the canvas (which would start a new selection).
  function tap(handler: () => void) {
    return (e: PointerEvent) => { e.stopPropagation(); e.preventDefault(); handler(); };
  }
</script>

<div bind:this={panelEl}
  class="selection-actions-panel absolute z-30 flex items-center gap-1 p-1 rounded-lg bg-surface border border-border shadow-md"
  style="left: {pos.x}px; top: {pos.y}px; opacity: {visible ? 1 : 0}; pointer-events: {visible ? 'auto' : 'none'}; touch-action: none;">
  {#if mode === "selected"}
    <button class="w-10 h-10 rounded-md border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover"
            onpointerdown={tap(onTransform)} title="Free transform">
      <Move size={18} />
    </button>
  {/if}
  <button class="w-10 h-10 rounded-md border flex items-center justify-center"
          class:bg-accent={distortActive} class:text-accent-text={distortActive} class:border-accent={distortActive}
          class:bg-surface={!distortActive} class:text-text-secondary={!distortActive} class:border-border={!distortActive}
          onpointerdown={tap(onDistort)} title="Distort (4-corner)">
    <SquareDashed size={18} />
  </button>
  <button class="w-10 h-10 rounded-md border flex items-center justify-center"
          class:bg-accent={meshActive} class:text-accent-text={meshActive} class:border-accent={meshActive}
          class:bg-surface={!meshActive} class:text-text-secondary={!meshActive} class:border-border={!meshActive}
          onpointerdown={tap(onMesh)} title="Mesh warp (3×3)">
    <Grid3x3 size={18} />
  </button>
  {#if mode !== "selected"}
    <div class="w-px h-6 bg-border mx-0.5"></div>
    <button class="w-10 h-10 rounded-md border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover"
            onpointerdown={tap(onCommit)} title="Commit">
      <Check size={18} />
    </button>
    <button class="w-10 h-10 rounded-md border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover"
            onpointerdown={tap(onCancel)} title="Cancel">
      <X size={18} />
    </button>
  {/if}
</div>
```
(The `selection-actions-panel` class is recognized by `core/touch-gestures.ts`, which already skips finger gestures on it — so taps don't pan the canvas.)

- [ ] **Step 2: Verify**

Run: `npm run check` — 0 errors. `npm test` — 72 pass (69 + 3 anchor).

- [ ] **Step 3: Commit**

```bash
git add src/lib/SelectionActions.svelte
git commit -m "feat(ui): floating selection actions panel (transform/distort/mesh/commit/cancel)"
```

---

## Task 3: Clip paint/erase/fill to the selection

**Files:**
- Modify: `src/lib/Canvas.svelte`

- [ ] **Step 1: Wrap the brush/eraser draw in the selection clip**

In `onStroke`, the brush draw block currently is:
```ts
    // Re-render the in-progress stroke from the pre-stroke snapshot each move.
    strokeCtx!.putImageData(beforeSnapshot!, 0, 0);
    strokeCtx!.setTransform(DPR, 0, 0, DPR, 0, 0);
    const settings = { ...state.brush, isEraser: state.tool === "eraser" };
    drawStroke(strokeCtx!, points, settings, done, state.sizeRange);
    recomposite();
```
Replace it with:
```ts
    // Re-render the in-progress stroke from the pre-stroke snapshot each move,
    // clipped to the active selection (if any) so painting/erasing stays inside it.
    strokeCtx!.putImageData(beforeSnapshot!, 0, 0);
    strokeCtx!.save();
    strokeCtx!.setTransform(DPR, 0, 0, DPR, 0, 0);
    selection?.applyClip(strokeCtx!);
    const settings = { ...state.brush, isEraser: state.tool === "eraser" };
    drawStroke(strokeCtx!, points, settings, done, state.sizeRange);
    strokeCtx!.restore();
    recomposite();
```

- [ ] **Step 2: Clip the fill (flood on a temp canvas, composite back through the clip)**

In `doFill`, replace the single `floodFill(...)` call. The current body is:
```ts
    const color = hexToRgba(state.brush.color, state.brush.opacity);
    // points are canvas-logical coords; floodFill indexes device pixels.
    floodFill(ctx, pt.x * DPR, pt.y * DPR, color, {
      tolerance: state.fill.tolerance,
      expand: state.fill.expand,
    });
```
Replace with:
```ts
    const color = hexToRgba(state.brush.color, state.brush.opacity);
    if (selection && selection.state === "selected") {
      // Flood on a temp copy, then composite back through the selection clip.
      const tmp = document.createElement("canvas");
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
      tctx.drawImage(canvas, 0, 0);
      floodFill(tctx, pt.x * DPR, pt.y * DPR, color, { tolerance: state.fill.tolerance, expand: state.fill.expand });
      ctx.save();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      selection.applyClip(ctx);
      ctx.drawImage(tmp, 0, 0, tmp.width / DPR, tmp.height / DPR);
      ctx.restore();
    } else {
      floodFill(ctx, pt.x * DPR, pt.y * DPR, color, { tolerance: state.fill.tolerance, expand: state.fill.expand });
    }
```

- [ ] **Step 3: Keep a marquee alive when switching to a drawing tool**

The `$effect` that reacts to `state.tool` currently is:
```ts
  $effect(() => {
    const t = state.tool;
    if (!selection) return;
    if (t === "select") selection.mode = "rect";
    else if (t === "lasso") selection.mode = "lasso";
    else {
      // Switching to a drawing tool: bank or drop any active selection.
      if (selection.hasFloating) selection.commit();
      else if (selection.active) selection.cancel();
      selectionMode = null;
    }
  });
```
Replace the `else { … }` body so a non-floating marquee is KEPT (so drawing clips to it); only a floating transform is banked:
```ts
    else {
      // Switching to a drawing tool: bank a floating transform, but KEEP a plain
      // marquee so brush/eraser/fill clip to it. (Esc clears it.)
      if (selection.hasFloating) selection.commit();
      selectionMode = null;
    }
```

- [ ] **Step 4: Verify**

Run: `npm run check` — 0 errors. `npm test` — 72 pass. `npx vite build` — succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Canvas.svelte
git commit -m "feat(selection): clip brush/eraser/fill to the active selection"
```

---

## Task 4: Deformation entry + mount the panel

**Files:**
- Modify: `src/state/appState.svelte.ts`, `src/lib/Canvas.svelte`

- [ ] **Step 1: Add a `selectionActions` ref to app state**

In `src/state/appState.svelte.ts`, after the existing `export const selectionRef … = { current: null };`, add:
```ts
/** Canvas-owned selection actions reachable from App keyboard shortcuts (W/M warp). */
export const selectionActions: { enterWarp: ((rows: number, cols: number) => void) | null } = { enterWarp: null };
```

- [ ] **Step 2: Add `enterTransform`/`enterWarp` and the panel to Canvas**

In `src/lib/Canvas.svelte`:
1. Add imports near the top of the `<script>`:
```ts
  import SelectionActions from "./SelectionActions.svelte";
  import { selectionActions } from "../state/appState.svelte";
```
2. Add a reactive readiness flag with the other `let`s (so the panel only renders after `selection`/`viewport` exist):
```ts
  let panelReady = $state(false);
```
3. Add these two functions (place them just below `setupSelection`):
```ts
  function enterTransform() {
    if (!selection || selection.state !== "selected") return;
    const layer = activeLayer();
    if (layer.kind !== "draw" || layer.locked) return;
    const canvas = ensureDrawableKeyframe(layer, state.playhead, canvasOps);
    selCtx = canvas.getContext("2d", { willReadFrequently: true })!;
    selBefore = selCtx.getImageData(0, 0, canvas.width, canvas.height);
    const lifted = selection.liftPixels(selCtx, DPR);
    if (!lifted) return;
    selection.beginTransform(lifted);
    recomposite();
  }

  function enterWarp(rows: number, cols: number) {
    if (!selection) return;
    if (selection.state === "selected") enterTransform();
    if (selection.state === "transforming") selection.beginWarp(rows, cols);
    else if (selection.state === "warping") selection.densifyWarp(rows, cols);
  }
```
4. At the END of the `onMount` body, right before the `return () => { … }` cleanup line, add:
```ts
    selectionActions.enterWarp = enterWarp;
    panelReady = true;
```
5. In the cleanup return, also clear the ref. The current return is:
```ts
    return () => { cleanup(); cleanupTouch(); cancelAnimationFrame(raf); selectionRef.current = null; };
```
Change to:
```ts
    return () => { cleanup(); cleanupTouch(); cancelAnimationFrame(raf); selectionRef.current = null; selectionActions.enterWarp = null; };
```
6. In the markup, mount the panel inside the `stage` div (after the `wrapper` div, still inside `stage`). The stage currently is:
```svelte
<div bind:this={stage} class="relative flex-1 overflow-hidden bg-canvas-bg touch-none" onwheel={onWheel}>
  <div bind:this={wrapper} class="absolute left-0 top-0">
    <canvas bind:this={display} class="absolute left-0 top-0 shadow-lg touch-none"></canvas>
    <canvas bind:this={overlay} class="absolute left-0 top-0 pointer-events-none"></canvas>
  </div>
</div>
```
Change to:
```svelte
<div bind:this={stage} class="relative flex-1 overflow-hidden bg-canvas-bg touch-none" onwheel={onWheel}>
  <div bind:this={wrapper} class="absolute left-0 top-0">
    <canvas bind:this={display} class="absolute left-0 top-0 shadow-lg touch-none"></canvas>
    <canvas bind:this={overlay} class="absolute left-0 top-0 pointer-events-none"></canvas>
  </div>
  {#if panelReady}
    <SelectionActions {selection} {viewport} containerEl={stage}
      onTransform={enterTransform}
      onDistort={() => enterWarp(2, 2)}
      onMesh={() => enterWarp(3, 3)}
      onCommit={() => selection.commit()}
      onCancel={() => selection.cancel()} />
  {/if}
</div>
```

- [ ] **Step 3: Verify**

Run: `npm run check` — 0 errors. `npm test` — 72 pass. `npx vite build` — succeeds. `npm run dev` (headless) — boots clean.

- [ ] **Step 4: Commit**

```bash
git add src/state/appState.svelte.ts src/lib/Canvas.svelte
git commit -m "feat(selection): free transform + distort/mesh warp via floating panel"
```

---

## Task 5: Keyboard W/M (desktop) + verification

**Files:**
- Modify: `src/App.svelte`

- [ ] **Step 1: Add W/M shortcuts**

In `src/App.svelte`, import `selectionActions`. The current appState import line is:
```ts
  import { state, history, bump, playbackController, selectionRef } from "./state/appState.svelte";
```
Add `selectionActions`:
```ts
  import { state, history, bump, playbackController, selectionRef, selectionActions } from "./state/appState.svelte";
```
Then in `onKey`, after the `Escape`/`Enter` selection handling and before the tool letter shortcuts (`if (e.key === "b") …`), add:
```ts
    else if (e.key === "w") { if (selectionRef.current?.active) { e.preventDefault(); selectionActions.enterWarp?.(2, 2); } }
    else if (e.key === "m") { if (selectionRef.current?.active) { e.preventDefault(); selectionActions.enterWarp?.(3, 3); } }
```
Place these as additional `else if` branches in the existing chain (after the `s`/`l` tool branches is fine, as long as they're part of the same `if/else if` chain). Ensure they don't shadow the tool shortcuts — `w` and `m` are not used by any tool, so order is unimportant; keep them in the chain.

- [ ] **Step 2: Automated verification (Definition of Done)**

Run and confirm: `npm run check` (0 errors), `npm test` (72 pass), `npx vite build` (success), `npm run dev` headless (boots clean).

- [ ] **Step 3: Commit**

```bash
git add src/App.svelte
git commit -m "feat(selection): W/M keyboard shortcuts for distort/mesh"
```

- [ ] **Step 4: Manual verification checklist (HUMAN — required; iPad + desktop)**

Run `npm run dev:lan`:
1. **Clip paint:** Select tool → drag a marquee → switch to Brush → drawing only marks **inside** the marquee; Eraser only erases inside it; Fill only fills inside it. Press Esc to clear the marquee, then drawing is unrestricted again.
2. **Lasso clip:** same with a Lasso marquee (irregular shape).
3. **Free transform:** with a marquee, tap **Transform** (Move icon) in the floating panel → pixels lift with scale/rotate handles → drag to move/scale/rotate → tap **Commit** (✓). Undo reverts the whole thing.
4. **Distort:** tap **Distort** → 4 corner handles → drag a corner to skew/distort the pixels → Commit.
5. **Mesh:** tap **Mesh** → 3×3 grid of handles → drag interior/edge points to warp → Commit. **Cancel** (✕) discards.
6. **Desktop keys:** `W` = distort, `M` = mesh, `Enter` = commit, `Esc` = cancel still work.
7. **No regression:** drawing without a selection, onion, playback, layers, export, save/load all still work; finger pan/pinch still works and tapping the panel buttons does NOT pan the canvas.

---

## Self-Review (completed during planning)

**Spec coverage (the user's request — "selected portion paintable/erasable + deformation tools"):** clip paint/erase (Task 3 Step 1) + clip fill (Task 3 Step 2) + keep marquee across tool switch (Task 3 Step 3) make the selection a paint mask; deformation = free transform (`enterTransform`) + distort (`enterWarp(2,2)`) + mesh (`enterWarp(3,3)`) driven by the floating `SelectionActions` panel (Tasks 2, 4) and W/M keys (Task 5). All warp math already exists in the ported `selection.ts`.

**Placeholder scan:** complete code in every code step; exact commands + expected results.

**Type consistency:** `computeAnchor` (Task 1) used by `SelectionActions` (Task 2). `SelectionActions` props (`selection`, `viewport`, `containerEl`, `onTransform`/`onDistort`/`onMesh`/`onCommit`/`onCancel`) match the mount site (Task 4 Step 2). `selectionActions.enterWarp` (Task 4 Step 1) set in Canvas (Task 4 Step 2) and read in App (Task 5). `enterTransform`/`enterWarp` set `selCtx`/`selBefore` (the same vars `setupSelection`'s `onCommit`/`onCancel` consume) so commit/cancel undo works for warps exactly as for moves.

**Risks / known limitations:** `applyClip` clips in CSS coords under the `setTransform(DPR,…)` we apply first — consistent with how strokes are drawn. The panel polls via rAF (cheap). Distort/mesh warp quality is whatever the ported slop-paint mesh code produces (battle-tested). All interaction is human-verified (esp. on iPad, the panel's pointer-tap + the touch-gestures `.selection-actions-panel` exclusion).
