# Deform Tool (FFD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-frame **Deform** tool that auto-lifts a cell's content into a draggable warp grid (4×4 default, −/+ density), reusing the existing selection-warp engine; bakes destructively on Apply.

**Architecture:** Mostly orchestration of existing `Selection` primitives. New: a `"deform"` tool, a thin `src/core/deform.ts` (pure entry logic — the isolated block a future ARAP swap replaces), `enterDeform()` + `onStroke` routing in `Canvas.svelte`, and −/+ density buttons in the warp panel. No new warp/render/bake code.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-26-deform-tool-ffd-design.md`

**Branch:** execute on a new branch `deform-tool-ffd` (off `main`).

**Conventions:** Canvas imports `state` unaliased; Toolbar/SelectionActions import `state as appState`. Husky pre-commit runs eslint+prettier (expected). Existing test baseline must stay green; build **0/0**; lint clean. Reused `Selection` API (verified present): `selection.rect` (settable `{x,y,w,h}` logical), `liftPixels(ctx, dpr)`, `beginTransform(lifted)`, `beginWarp(rows, cols)`, `densifyWarp(rows, cols)`, `warpRows`, `state` (`"warping"`), `hitTest(x,y)`, `startDrag(handle,x,y)`, `updateDrag(x,y)`, `endDrag()`, `hasFloating`, `commit()`, `cancel()`. Canvas already wires `selection.onCommit` (bakes warped pixels + one undo step) / `onCancel` (restores `selBefore`), using `selCtx`/`selBefore`.

---

### Task 1: `src/core/deform.ts` — pure entry helpers (TDD)

**Files:** Create `src/core/deform.ts`; create `src/__tests__/deform.test.ts`.

- [ ] **Step 1: Write the failing tests** — `src/__tests__/deform.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { contentRectLogical, clampDensity } from "../core/deform";

describe("contentRectLogical", () => {
  it("scales device bounds to logical by 1/dpr", () => {
    expect(contentRectLogical({ x: 20, y: 40, w: 60, h: 80 }, 2)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });
  it("passes through at dpr 1", () => {
    expect(contentRectLogical({ x: 3, y: 4, w: 5, h: 6 }, 1)).toEqual({ x: 3, y: 4, w: 5, h: 6 });
  });
  it("returns null for null bounds (empty cell)", () => {
    expect(contentRectLogical(null, 2)).toBeNull();
  });
});

describe("clampDensity", () => {
  it("never goes below 2", () => {
    expect(clampDensity(1)).toBe(2);
    expect(clampDensity(2)).toBe(2);
    expect(clampDensity(0)).toBe(2);
  });
  it("rounds and keeps higher values", () => {
    expect(clampDensity(4)).toBe(4);
    expect(clampDensity(6.4)).toBe(6);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run src/__tests__/deform.test.ts` (module missing).

- [ ] **Step 3: Implement** — `src/core/deform.ts`:
```ts
// Deform-tool logic, isolated so a future ARAP solver replaces only this module's deformation block
// (the FFD version is just lattice plumbing; the lift/warp/render/bake pipeline lives in selection.ts).

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Convert a device-px content-bounds rect to a logical selection rect; null when there's no content. */
export function contentRectLogical(bounds: Rect | null, dpr: number): Rect | null {
  if (!bounds) return null;
  return { x: bounds.x / dpr, y: bounds.y / dpr, w: bounds.w / dpr, h: bounds.h / dpr };
}

/** Warp grids need ≥2 control points per axis. */
export function clampDensity(n: number): number {
  return Math.max(2, Math.round(n));
}
```

- [ ] **Step 4: Verify** — `npx vitest run src/__tests__/deform.test.ts` passes; `npm run build` → 0/0.
- [ ] **Step 5: Commit**
```bash
git add src/core/deform.ts src/__tests__/deform.test.ts
git commit -m "feat: deform-tool pure entry helpers (contentRectLogical, clampDensity)"
```

---

### Task 2: Tool enum + Toolbar button

**Files:** Modify `src/state/appState.svelte.ts`, `src/lib/Toolbar.svelte`.

- [ ] **Step 1: Tool union** — in `appState.svelte.ts`, add `"deform"`:
```ts
export type Tool = "brush" | "eraser" | "fill" | "select" | "lasso" | "transform" | "eyedropper" | "deform";
```

- [ ] **Step 2: Toolbar button** — in `Toolbar.svelte`, add `Spline` is already imported? (it's used for the pressure curve). Use a distinct icon: add `Workflow` to the `@lucide/svelte` import. After the Transform tool button, add:
```svelte
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "deform"}
    title="Deform (warp the drawing)"
    onclick={() => (appState.tool = "deform")}><Workflow size={18} /></button
  >
```

- [ ] **Step 3: Verify** — `npm run build` → 0/0; `npm test` → baseline; lint clean.
- [ ] **Step 4: Commit**
```bash
git add src/state/appState.svelte.ts src/lib/Toolbar.svelte
git commit -m "feat: deform tool enum + toolbar button"
```

---

### Task 3: Canvas — `enterDeform()`, onStroke routing, leave-commit

**Files:** Modify `src/lib/Canvas.svelte`.

- [ ] **Step 1: Imports** — add `contentRectLogical, clampDensity` from `../core/deform`; `contentBounds` from `./cell-ink`; `type Tool` from `../state/appState.svelte`. (`ensureDrawableKeyframe`, `activeLayer`, `isIdentityTransform`, `selection`, `selCtx`, `selBefore`, `DPR`, `canvasOps` already present.)

- [ ] **Step 2: `enterDeform()`** — add near `enterWarp`/`enterTransform`:
```ts
  function enterDeform() {
    const al = activeLayer();
    if (al.kind !== "draw" || al.locked || !isIdentityTransform(al.transform)) return;
    const canvas = ensureDrawableKeyframe(al, state.playhead, canvasOps);
    const rect = contentRectLogical(contentBounds(canvas, state.version), DPR);
    if (!rect) return; // empty cell → nothing to deform
    selCtx = canvas.getContext("2d", { willReadFrequently: true })!;
    selBefore = selCtx.getImageData(0, 0, canvas.width, canvas.height);
    selCtx.setTransform(DPR, 0, 0, DPR, 0, 0); // liftPixels operates in CSS/logical coords
    selection.rect = rect;
    const lifted = selection.liftPixels(selCtx, DPR);
    if (!lifted) {
      selCtx = null;
      selBefore = null;
      return;
    }
    selection.beginTransform(lifted);
    selection.beginWarp(4, 4);
  }
```
(Mirrors the existing transform-lift setup at lines ~530-536; `onCommit`/`onCancel` already bake/restore using `selCtx`/`selBefore`.)

- [ ] **Step 3: onStroke routing** — in `onStroke`, the existing guard early-returns selection on a transformed layer:
```ts
    if (
      (state.tool === "select" || state.tool === "lasso") &&
      al.kind === "draw" &&
      !isIdentityTransform(al.transform)
    )
      return;
```
Extend the condition to include deform (so it's disabled-with-hint identically):
```ts
    if (
      (state.tool === "select" || state.tool === "lasso" || state.tool === "deform") &&
      al.kind === "draw" &&
      !isIdentityTransform(al.transform)
    )
      return;
```
Then add a **deform branch BEFORE the select/lasso branch**:
```ts
    if (state.tool === "deform") {
      const p = points[points.length - 1];
      if (selection.state !== "warping") {
        if (points.length === 1 && !done) enterDeform(); // first press lifts + enters the grid
        return;
      }
      if (points.length === 1 && !done) {
        const handle = selection.hitTest(p.x, p.y);
        if (handle === "grid") {
          selectionMode = "drag";
          selection.startDrag(handle, p.x, p.y);
        }
      } else if (!done) {
        if (selectionMode === "drag") selection.updateDrag(p.x, p.y);
      } else {
        if (selectionMode === "drag") selection.endDrag();
        selectionMode = null;
      }
      return;
    }
```
(Deform never starts a marquee; a press off a handle does nothing.)

- [ ] **Step 4: Leave-deform commit** — declare a tracker near `selectionMode`: `let prevTool: Tool = "brush";`. Replace the existing tool-watching `$effect` body:
```ts
  $effect(() => {
    const t = state.tool;
    if (!selection) return;
    // Leaving the deform tool banks the floating warp (one undo step via onCommit).
    if (prevTool === "deform" && t !== "deform" && selection.hasFloating) selection.commit();
    prevTool = t;
    if (t === "select") selection.mode = "rect";
    else if (t === "lasso") selection.mode = "lasso";
    else if (t !== "deform") {
      // Switching to a drawing tool: bank a floating transform, keep a plain marquee for clipping.
      if (selection.hasFloating) selection.commit();
      selectionMode = null;
    }
    // t === "deform": entry happens on the first canvas press (onStroke).
  });
```

- [ ] **Step 5: Verify** — `npm run build` → 0/0; `npm test` → baseline; lint clean.
- [ ] **Step 6: Commit**
```bash
git add src/lib/Canvas.svelte
git commit -m "feat: Canvas — deform tool entry + warp-grid drag routing"
```

---

### Task 4: Density −/+ in the warp panel

**Files:** Modify `src/lib/SelectionActions.svelte`, `src/lib/Canvas.svelte`.

- [ ] **Step 1: Panel prop** — in `SelectionActions.svelte`, add an `onDensify` prop to the existing props block:
```ts
    onDensify,
```
and to its type:
```ts
    onDensify: (delta: number) => void;
```

- [ ] **Step 2: Density buttons** — in the panel markup, in the warping state (near the existing Distort/Mesh/Apply/Cancel controls), add −/+ buttons. Show them whenever `mode === "warping"`:
```svelte
  {#if mode === "warping"}
    <button class="px-2 py-1 text-xs border border-border rounded bg-surface" title="Less detail" onpointerdown={tap(() => onDensify(-1))}>−</button>
    <span class="text-xs text-text-secondary tabular-nums">{warp.rows}×{warp.cols}</span>
    <button class="px-2 py-1 text-xs border border-border rounded bg-surface" title="More detail" onpointerdown={tap(() => onDensify(1))}>+</button>
  {/if}
```
(`tap` and the `mode`/`warp` `$state` are already in this component; `warp = { rows, cols }` is synced each tick.)

- [ ] **Step 3: Wire it in Canvas** — the `<SelectionActions … />` element (in `Canvas.svelte`) gets:
```svelte
    onDensify={(d) => {
      if (!selection) return;
      const n = clampDensity(selection.warpRows + d);
      selection.densifyWarp(n, n);
    }}
```

- [ ] **Step 4: Verify** — `npm run build` → 0/0; `npm test` → baseline; lint clean.
- [ ] **Step 5: Manual (browser, `npm run dev`)**
  - On a draw layer with content, pick **Deform** → press the canvas → a 4×4 grid appears over the
    drawing. Drag handles to bend/reshape; the warp follows.
  - −/+ changes density (`N×N` readout updates) and **preserves the pose** (densifyWarp resample).
  - **Apply** (the panel's commit) bakes into the cell as one undo step; **Cancel/Esc** restores.
    Switching to a brush also banks the warp.
  - Empty cell → nothing happens. A layer with a non-identity transform → deform is inert (same as
    select/lasso; Apply the transform first). A hold frame promotes/targets its key via
    `ensureDrawableKeyframe`.
  - The baked result composites with onion/boil/export and survives save-reload (it's cell pixels).
- [ ] **Step 6: Commit**
```bash
git add src/lib/SelectionActions.svelte src/lib/Canvas.svelte
git commit -m "feat: deform grid density −/+ controls"
```

---

## Final verification

- [ ] `npm run build` → 0/0; `npm test` → baseline + new `deform.ts` tests; lint clean.
- [ ] Manual checklist (Task 4 Step 5) confirmed — enter, drag, density, Apply/Cancel, guards.

## Self-Review (completed by plan author)

**Spec coverage:** reuse the warp engine (no new warp/bake — Tasks 3/4 use `Selection` only) ✅; `"deform"` tool + button (T2) ✅; entry orchestration auto-targets `contentBounds`, lift, `beginWarp(4,4)` (T3 `enterDeform`) ✅; whole-content target, no marquee (T3 routing ignores off-handle press) ✅; 4×4 default + −/+ density via `densifyWarp` (T1 `clampDensity` + T4) ✅; destructive bake + one undo via existing `onCommit` (reused, T3 comment) ✅; disabled on transformed layer with the same guard (T3 Step 3) ✅; isolated deform module for ARAP swap (`src/core/deform.ts`, T1) ✅; out-of-scope items (non-destructive storage, bicubic/WebGL, ARAP, ref layers) absent ✅; testing = pure helpers unit-tested + build/manual (T1 + T4 manual) ✅.

**Placeholder scan:** No TBD/TODO; every step has concrete before/after. The icon choice (`Workflow`) is concrete (swap only if it collides with an existing import — verify during T2).

**Type consistency:** `contentRectLogical(bounds: Rect|null, dpr): Rect|null` and `clampDensity(n): number` defined in T1, used in Canvas (T3 `enterDeform`, T4 wiring). `onDensify: (delta: number) => void` declared in SelectionActions (T4) and supplied from Canvas (T4) with the matching signature. Reused `Selection` members match the verified API list in the header. `Tool` gains `"deform"` (T2) and is used for `prevTool` (T3).
