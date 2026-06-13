# Plan 3 — Bucket Fill Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a paint-bucket (flood fill) tool that fills an enclosed area of the active frame's drawing with the current colour, with undo — useful for dropping solid black masses or an accent colour into an ink outline.

**Architecture:** Port slop-paint's proven scanline `floodFill` (`fill.ts`) into `src/core/`, then wire a new `"fill"` tool: on pointer-down the canvas resolves/creates the active keyframe (same `ensureDrawableKeyframe` path as the brush), flood-fills at the click point in device pixels, and records a before/after ImageData undo command. The `floodFill`'s default `expand: 0` path is pure (ImageData in/out), so it is unit-tested in Node with a fake context; the `expand > 0` path (used by the app to bleed fill behind anti-aliased ink) is the same battle-tested slop-paint code.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest. (Bucket fill is the first of the "remaining tools"; selection + transform is a separate, larger plan.)

**Builds on Plans 1–2 (on `main`).** Relevant existing APIs:
- `src/state/appState.svelte.ts`: `type Tool = "brush" | "eraser"`; `state` (`tool`, `brush.color`, `brush.opacity`, `playhead`, …); `activeLayer()`, `canvasOps`, `history`, `DPR`, `bump()`.
- `src/anim/timeline.ts`: `ensureDrawableKeyframe(layer, frame, ops)` → the cell canvas to draw on.
- `src/lib/Canvas.svelte`: `onStroke(points, done)` receives canvas-logical coordinates (via `viewport.screenToCanvas`); `recomposite()` repaints; the brush path snapshots ImageData for undo.
- `src/lib/Toolbar.svelte`: Brush / Eraser buttons; `src/App.svelte`: keyboard shortcuts with an INPUT/TEXTAREA guard.
- tsconfig: `erasableSyntaxOnly`, `noUnusedLocals`.

---

## File Structure

```
src/
  core/
    fill.ts            ← NEW (copied verbatim from slop-paint): floodFill, hexToRgba, FillOptions
  state/
    appState.svelte.ts ← MODIFY: add "fill" to Tool + a fill settings object
  lib/
    Canvas.svelte      ← MODIFY: handle the fill tool in onStroke (fill + undo)
    Toolbar.svelte     ← MODIFY: add a Fill button
  App.svelte           ← MODIFY: add 'g' = fill shortcut
  __tests__/
    fill.test.ts       ← NEW: hexToRgba (ported) + floodFill (fake-ctx node test)
```

---

## Task 1: Port `fill.ts` + tests

**Files:**
- Create (by copy): `src/core/fill.ts`
- Create: `src/__tests__/fill.test.ts`

- [ ] **Step 1: Copy `fill.ts` from slop-paint**

Run:
```bash
cp /Users/meigo/Projects/slop/slop-paint/src/fill.ts /Users/meigo/Projects/slop/slop-animator/src/core/fill.ts
```
Do NOT modify it. It exports `FillOptions`, `floodFill(ctx, startX, startY, fillColor, options?)`, and `hexToRgba(hex, opacity)`. It has no imports (self-contained).

- [ ] **Step 2: Write the test file (write tests first, then run)**

Create `src/__tests__/fill.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { hexToRgba, floodFill } from "../core/fill";

describe("hexToRgba", () => {
  it("parses black at full opacity", () => {
    expect(hexToRgba("#000000", 100)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
  });
  it("parses white at full opacity", () => {
    expect(hexToRgba("#ffffff", 100)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });
  it("parses red", () => {
    expect(hexToRgba("#ff0000", 100)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });
  it("handles half opacity", () => {
    expect(hexToRgba("#000000", 50).a).toBe(128);
  });
  it("handles zero opacity", () => {
    expect(hexToRgba("#ffffff", 0).a).toBe(0);
  });
  it("parses arbitrary hex", () => {
    const c = hexToRgba("#1a2b3c", 100);
    expect([c.r, c.g, c.b]).toEqual([0x1a, 0x2b, 0x3c]);
  });
});

// A minimal fake 2D context backed by a flat RGBA buffer, sufficient for floodFill's
// default (expand:0) path which only uses getImageData/putImageData (no DOM).
function gridCtx(w: number, h: number, fill: (i: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b, a] = fill(i);
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
  }
  const img = { data, width: w, height: h };
  const ctx = {
    canvas: { width: w, height: h },
    getImageData: () => img,
    putImageData: () => {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, data };
}

function px(data: Uint8ClampedArray, i: number): [number, number, number, number] {
  return [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];
}

describe("floodFill (expand:0)", () => {
  it("fills a fully-connected transparent region with the fill colour", () => {
    const { ctx, data } = gridCtx(2, 2, () => [0, 0, 0, 0]);
    floodFill(ctx, 0, 0, { r: 255, g: 0, b: 0, a: 255 }, { tolerance: 32, expand: 0 });
    for (let i = 0; i < 4; i++) expect(px(data, i)).toEqual([255, 0, 0, 255]);
  });

  it("stops at pixels that don't match the start colour (bounded fill)", () => {
    // 3x1: [transparent, opaque-black wall, transparent]. Fill from the left.
    const { ctx, data } = gridCtx(3, 1, (i) => (i === 1 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
    floodFill(ctx, 0, 0, { r: 255, g: 0, b: 0, a: 255 }, { tolerance: 32, expand: 0 });
    expect(px(data, 0)).toEqual([255, 0, 0, 255]); // filled
    expect(px(data, 1)).toEqual([0, 0, 0, 255]);   // wall, unchanged
    expect(px(data, 2)).toEqual([0, 0, 0, 0]);     // unreachable, unchanged
  });

  it("does nothing when the start pixel already matches the fill colour", () => {
    const { ctx, data } = gridCtx(2, 2, () => [255, 0, 0, 255]);
    floodFill(ctx, 0, 0, { r: 255, g: 0, b: 0, a: 255 }, { tolerance: 32, expand: 0 });
    for (let i = 0; i < 4; i++) expect(px(data, i)).toEqual([255, 0, 0, 255]);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npm test -- fill`
Expected: PASS (6 hexToRgba + 3 floodFill = 9). (`fill.ts` already exists from Step 1, so these pass immediately — this task ports proven code and locks it with coverage rather than red-green TDD.) Then `npm run check` — 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/fill.ts src/__tests__/fill.test.ts
git commit -m "feat(core): port flood-fill from slop-paint with tests"
```

---

## Task 2: Add the fill tool to app state

**Files:**
- Modify: `src/state/appState.svelte.ts`

- [ ] **Step 1: Add `"fill"` to the `Tool` union**

The current line is:
```ts
export type Tool = "brush" | "eraser";
```
Replace it with:
```ts
export type Tool = "brush" | "eraser" | "fill";
```

- [ ] **Step 2: Add a fill settings field to the state interface**

In `interface AnimState { … }`, add after `streamline: number;`:
```ts
  fill: { tolerance: number; expand: number };
```

- [ ] **Step 3: Add its default to the `$state({...})` initializer**

After the `streamline: 50,` line, add:
```ts
  fill: { tolerance: 32, expand: 2 },
```
(`tolerance: 32` matches the clicked colour within ±32 per channel; `expand: 2` bleeds the fill 2px behind existing ink so it tucks under anti-aliased outline edges.)

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: 0 errors. Run `npm test` — still green (all prior + fill tests).

- [ ] **Step 5: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat(state): add fill tool + fill settings"
```

---

## Task 3: Wire the fill tool into the canvas

**Files:**
- Modify: `src/lib/Canvas.svelte`

- [ ] **Step 1: Import the fill functions**

The current brush/render imports near the top include:
```ts
  import { drawStroke } from "../core/brush";
```
Add immediately after it:
```ts
  import { floodFill, hexToRgba } from "../core/fill";
```

- [ ] **Step 2: Add a fill-gesture guard variable**

Next to the other stroke state declarations:
```ts
  let strokeCanvas: HTMLCanvasElement | null = null;
  let strokeCtx: CanvasRenderingContext2D | null = null;
  let beforeSnapshot: ImageData | null = null;
```
add:
```ts
  // True once the current fill gesture has already filled (one fill per pointer press).
  let fillUsed = false;
```

- [ ] **Step 3: Add the `doFill` function**

Immediately above the existing `function onStroke(` declaration, add:
```ts
  function doFill(pt: { x: number; y: number }) {
    const layer = activeLayer();
    if (layer.locked) return;
    const canvas = ensureDrawableKeyframe(layer, state.playhead, canvasOps);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const color = hexToRgba(state.brush.color, state.brush.opacity);
    // points are canvas-logical coords; floodFill indexes device pixels.
    floodFill(ctx, pt.x * DPR, pt.y * DPR, color, {
      tolerance: state.fill.tolerance,
      expand: state.fill.expand,
    });

    const after = ctx.getImageData(0, 0, canvas.width, canvas.height);
    history.push({
      undo: () => { ctx.putImageData(before, 0, 0); recomposite(); },
      redo: () => { ctx.putImageData(after, 0, 0); recomposite(); },
    });
    bump();
    recomposite();
  }
```

- [ ] **Step 4: Branch to fill at the top of `onStroke`**

The current `onStroke` starts:
```ts
  function onStroke(points: InputPoint[], done: boolean) {
    if (!strokeCanvas) {
```
Insert the fill branch as the very first statements inside `onStroke` (before `if (!strokeCanvas)`):
```ts
  function onStroke(points: InputPoint[], done: boolean) {
    if (state.tool === "fill") {
      if (!fillUsed && points.length > 0) {
        doFill(points[0]);
        fillUsed = true;
      }
      if (done) fillUsed = false;
      return;
    }
    if (!strokeCanvas) {
```
(The rest of `onStroke` is unchanged.)

- [ ] **Step 5: Verify**

Run: `npm run check`
Expected: 0 errors. Run `npm test` — still green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/Canvas.svelte
git commit -m "feat(ui): wire bucket fill into the canvas with undo"
```

---

## Task 4: Toolbar button, keyboard shortcut, and verification

**Files:**
- Modify: `src/lib/Toolbar.svelte`, `src/App.svelte`

- [ ] **Step 1: Add a Fill button to the toolbar**

In `src/lib/Toolbar.svelte`, the current Eraser button line is:
```svelte
  <button class:font-bold={state.tool === "eraser"} onclick={() => (state.tool = "eraser")}>Eraser</button>
```
Add immediately after it:
```svelte
  <button class:font-bold={state.tool === "fill"} onclick={() => (state.tool = "fill")}>Fill</button>
```

- [ ] **Step 2: Add the `g` shortcut**

In `src/App.svelte`, the current tool shortcuts are:
```ts
    if (e.key === "b") state.tool = "brush";
    else if (e.key === "e") state.tool = "eraser";
```
Change them to:
```ts
    if (e.key === "b") state.tool = "brush";
    else if (e.key === "e") state.tool = "eraser";
    else if (e.key === "g") state.tool = "fill";
```
(Insert the `g` line; leave every other `else if` in the handler unchanged.)

- [ ] **Step 3: Automated verification (Definition of Done — run all, paste real output)**

1. `npm run check` — expect 0 errors.
2. `npm test` — expect all tests pass (previous 40 + 9 fill = 49). Paste the `Tests` summary line.
3. `npx vite build` — expect a successful production build.
4. Dev boot (headless): start `npm run dev` with a short timeout, confirm `Local: http://localhost:5173/` (or fallback port) prints with no compile/runtime errors, then stop.

NOTE: the interactive fill (clicking to flood an enclosed region) requires a browser and is NOT verifiable here — do not claim it works; leave it for the human.

- [ ] **Step 4: Commit**

```bash
git add src/lib/Toolbar.svelte src/App.svelte
git commit -m "feat(ui): fill toolbar button + 'g' shortcut"
```

---

## Self-Review (completed during planning)

**Spec coverage (spec §2: bucket fill — "flood-fill with tolerance; handy for solid black ink masses or dropping an accent colour into an enclosed area"):** ported `floodFill` with tolerance (Task 1), exposed as a `"fill"` tool (Tasks 2–4), wired with undo (Task 3). The `expand:2` default bleeds fill behind ink edges, directly serving the "drop colour into an enclosed outline" use case. Selection + transform (the other "remaining tool") is intentionally deferred to its own plan given `selection.ts` is ~900 lines.

**Placeholder scan:** none — every step has complete code and an exact command + expected result.

**Type consistency:** `Tool` gains `"fill"` once (Task 2) and is matched in Canvas (Task 3), Toolbar and App (Task 4). `state.fill.{tolerance,expand}` is defined in Task 2 and read in Task 3's `doFill`. `floodFill`/`hexToRgba` signatures match the copied `fill.ts` (`floodFill(ctx, startX, startY, fillColor, options?)`, `hexToRgba(hex, opacity)`). `doFill` reuses the established `ensureDrawableKeyframe` + before/after-ImageData undo pattern from the brush path, so undo/redo composes with the existing history.

**Known limitations (intentional):** fill colour/opacity come from the shared brush colour (no separate fill swatch); tolerance/expand are fixed defaults with no UI yet (cheap to add later); filling uses the first pointer-down point only (no drag-to-refill). All acceptable for a minimal tool.
