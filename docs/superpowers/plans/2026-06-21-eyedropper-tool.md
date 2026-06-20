# Eyedropper Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A toolbar eyedropper tool — tap the canvas to sample the composited color into the brush color, then auto-return to the previous tool; a live swatch previews the color under the pointer.

**Architecture:** Pure `rgbToHex` (tested) in `fill.ts`; a `"eyedropper"` tool + `selectEyedropper()`/`applyEyedropper()` in appState (reusing the `toolBeforeEraser` idiom); `sampleAt()` + an `onStroke` branch in Canvas reading `displayCtx`; the preview by extending `BrushCursor` with a `sampleColor` prop; a Pipette toolbar button.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest, Tailwind, lucide.

**Spec:** `docs/superpowers/specs/2026-06-21-eyedropper-tool-design.md`

**Branch:** execute on a new branch `eyedropper-tool` (off `main`).

**Conventions:** husky pre-commit runs eslint+prettier on staged files (expected). Canvas imports `state` unaliased; runes components (`BrushCursor`, `Toolbar`) import `state as appState`. Existing **209** tests must stay green; build **0/0**; lint clean.

---

### Task 1: `rgbToHex` helper (TDD)

**Files:** Modify `src/core/fill.ts`; modify `src/__tests__/fill.test.ts`.

- [ ] **Step 1: Failing test** — add to `src/__tests__/fill.test.ts` (add `rgbToHex` to the existing `../core/fill` import):
```ts
describe("rgbToHex", () => {
  it("maps black and white", () => {
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
    expect(rgbToHex(255, 255, 255)).toBe("#ffffff");
  });
  it("maps a mid color", () => {
    expect(rgbToHex(26, 26, 26)).toBe("#1a1a1a");
  });
  it("rounds and clamps out-of-range/fractional inputs", () => {
    expect(rgbToHex(255.6, -3, 300)).toBe("#ff00ff");
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run src/__tests__/fill.test.ts` (rgbToHex not exported).

- [ ] **Step 3: Implement** — in `src/core/fill.ts`, next to `hexToRgba`:
```ts
/** [0..255] r,g,b → "#rrggbb" (lowercase); clamps + rounds. */
export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
```

- [ ] **Step 4: Verify** — `npx vitest run src/__tests__/fill.test.ts` passes; `npm run build` → 0/0.

- [ ] **Step 5: Commit**
```bash
git add src/core/fill.ts src/__tests__/fill.test.ts
git commit -m "feat: rgbToHex helper for the eyedropper"
```

---

### Task 2: Tool enum + appState actions

**Files:** Modify `src/state/appState.svelte.ts`.

- [ ] **Step 1: Tool union** — add `"eyedropper"`:
```ts
export type Tool = "brush" | "eraser" | "fill" | "select" | "lasso" | "transform" | "eyedropper";
```

- [ ] **Step 2: Actions** — near the existing `toolBeforeEraser`/`toggleEraser`:
```ts
let toolBeforeEyedropper: Tool = "brush";
export function selectEyedropper() {
  if (state.tool === "eyedropper") return; // already active → no-op
  toolBeforeEyedropper = state.tool;
  state.tool = "eyedropper";
}
/** Set the brush color from a sampled pixel, then return to the pre-eyedropper tool. */
export function applyEyedropper(hex: string) {
  state.brush.color = hex;
  state.tool = toolBeforeEyedropper === "eyedropper" ? "brush" : toolBeforeEyedropper;
}
```
(Color is a setting — no undo entry.)

- [ ] **Step 3: Verify** — `npm run build` → 0/0; `npm test` → 209.

- [ ] **Step 4: Commit**
```bash
git add src/state/appState.svelte.ts
git commit -m "feat: eyedropper tool enum + select/apply actions"
```

---

### Task 3: BrushCursor — eyedropper preview swatch

**Files:** Modify `src/lib/BrushCursor.svelte`.

- [ ] **Step 1: Add the `sampleColor` prop**

Change the `$props()` destructure to add an optional sampler:
```ts
  let {
    getViewport,
    getContainer,
    sampleColor,
  }: {
    getViewport: () => Viewport | null;
    getContainer: () => HTMLElement | null;
    sampleColor?: (clientX: number, clientY: number) => string | null;
  } = $props();
```

- [ ] **Step 2: Track the eyedropper state**

Add `$state` for the swatch + last client position, and keep it updated. Add near the other `$state`:
```ts
  let swatch = $state<string | null>(null);
  let clientX = $state(0);
  let clientY = $state(0);
```
In `onMove`, after setting `x`/`y`/`visible`, also record `clientX = e.clientX; clientY = e.clientY;`.
In `tick()`, after the existing `diameter`/`dashed` lines, add:
```ts
    swatch = appState.tool === "eyedropper" && sampleColor ? sampleColor(clientX, clientY) : null;
```

- [ ] **Step 3: Render the swatch (eyedropper) vs the ring (brush/eraser)**

Keep the existing ring block gated on `isStrokeTool()`. Add a separate block for the eyedropper, plus
keep the center dot shared. Replace the current `{#if visible && isStrokeTool() && diameter > 0} …ring… …dot… {/if}` with:
```svelte
{#if visible && isStrokeTool() && diameter > 0}
  <div
    class="brush-cursor"
    class:dashed
    style="transform: translate({x}px, {y}px) translate(-50%, -50%); width: {diameter}px; height: {diameter}px;"
  ></div>
{/if}
{#if visible && appState.tool === "eyedropper" && swatch}
  <div
    class="eyedropper-swatch"
    style="transform: translate({x}px, {y}px) translate(14px, -32px); background: {swatch};"
  ></div>
{/if}
{#if visible && (isStrokeTool() || appState.tool === "eyedropper")}
  <div class="brush-cursor-dot" style="transform: translate({x}px, {y}px) translate(-50%, -50%);"></div>
{/if}
```

Add the swatch style in the `<style>` block:
```css
  .eyedropper-swatch {
    position: absolute;
    left: 0;
    top: 0;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    border: 1.5px solid rgba(0, 0, 0, 0.7);
    box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.7);
    pointer-events: none;
    z-index: 40;
  }
```

- [ ] **Step 2/3 note:** the rAF `tick` calling `sampleColor` (one `getImageData(1×1)`) per frame is
  cheap and only while the eyedropper is active and a pointer is over the canvas.

- [ ] **Step 4: Verify** — `npm run build` → 0/0; `npm test` → 209; `npm run lint` → clean.

- [ ] **Step 5: Commit**
```bash
git add src/lib/BrushCursor.svelte
git commit -m "feat: eyedropper color preview swatch in BrushCursor"
```

---

### Task 4: Canvas — sampling, onStroke branch, cursor, wire preview

**Files:** Modify `src/lib/Canvas.svelte`.

- [ ] **Step 1: Imports** — add `rgbToHex` to the `../core/fill` import; add `selectEyedropper`
  (not needed here) and `applyEyedropper` to the `../state/appState.svelte` import. (Only
  `applyEyedropper` is used in Canvas.)

- [ ] **Step 2: `sampleAt` helper** — add near `doFill`/`paintStroke`:
```ts
  function sampleAt(p: { x: number; y: number }): string | null {
    const px = Math.round(p.x * DPR), py = Math.round(p.y * DPR);
    if (px < 0 || py < 0 || px >= display.width || py >= display.height) return null;
    const [r, g, b] = displayCtx.getImageData(px, py, 1, 1).data;
    return rgbToHex(r, g, b);
  }
```

- [ ] **Step 3: `onStroke` branch** — at the very top of `onStroke` (before the `const al =
  activeLayer();` line), add:
```ts
    if (state.tool === "eyedropper") {
      if (points.length === 1) {
        const hex = sampleAt(points[0]);
        if (hex) applyEyedropper(hex);
      }
      return;
    }
```

- [ ] **Step 4: Cursor class** — on the `stage` div, the current single binding is:
```svelte
  class:cursor-none={state.tool === "brush" || state.tool === "eraser"}
```
Add a sibling for the eyedropper:
```svelte
  class:cursor-none={state.tool === "brush" || state.tool === "eraser"}
  class:cursor-crosshair={state.tool === "eyedropper"}
```

- [ ] **Step 5: Wire the preview** — pass the sampler to `BrushCursor` (which maps client→logical via
  the viewport, then calls `sampleAt`):
```svelte
  <BrushCursor
    getViewport={() => viewport}
    getContainer={() => stage}
    sampleColor={(cx, cy) => {
      if (!viewport) return null;
      return sampleAt(viewport.screenToCanvas(cx, cy));
    }}
  />
```

- [ ] **Step 6: Verify** — `npm run build` → 0/0; `npm test` → 209; `npm run lint` → clean.

- [ ] **Step 7: Commit**
```bash
git add src/lib/Canvas.svelte
git commit -m "feat: eyedropper sampling + crosshair cursor + preview wiring in Canvas"
```

---

### Task 5: Toolbar — Pipette button

**Files:** Modify `src/lib/Toolbar.svelte`.

- [ ] **Step 1: Imports** — add `Pipette` to the `@lucide/svelte` import; add `selectEyedropper` to the
  `../state/appState.svelte` import.

- [ ] **Step 2: Button** — after the Fill tool button (`onclick={() => (appState.tool = "fill")}`),
  add:
```svelte
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "eyedropper"}
    title="Eyedropper (sample color)"
    onclick={selectEyedropper}><Pipette size={18} /></button
  >
```

- [ ] **Step 3: Verify** — `npm run build` → 0/0; `npm test` → 209; `npm run lint` → clean.

- [ ] **Step 4: Manual (browser, `npm run dev`)**
  - Select the eyedropper → crosshair cursor; a 22px swatch previews the color under the pointer.
  - Tap a drawn area → brush color becomes that color and the tool returns to the previous one; draw
    immediately with it. Tap blank paper → picks the bg color.
  - Tap outside the canvas → no change, stays in eyedropper.
  - The eraser's separate settings and the brush size are undisturbed by selecting/leaving the tool.

- [ ] **Step 5: Commit**
```bash
git add src/lib/Toolbar.svelte
git commit -m "feat: eyedropper toolbar button"
```

---

## Final verification

- [ ] `npm run build` → 0/0; `npm test` → 209 + 3 new rgbToHex assertions; `npm run lint` → clean.
- [ ] Manual checklist (Task 5 Step 4) confirmed — pick sets color + auto-returns; swatch preview;
      bg-color pick on blank; out-of-bounds no-op.

## Self-Review (completed by plan author)

**Spec coverage:** `rgbToHex` pure + tested (T1) ✅; `"eyedropper"` tool + `selectEyedropper`/
`applyEyedropper` via the `toolBeforeEraser` idiom, no undo (T2) ✅; composited `sampleAt` on
`displayCtx` ×DPR bounds-checked + `onStroke` first-point branch (T4) ✅; preview swatch by extending
`BrushCursor` with a `sampleColor` prop (T3) + wired from Canvas through `viewport.screenToCanvas`
(T4) ✅; crosshair cursor (T4) ✅; Pipette button (T5) ✅; color→`brush.color` RGB-only, eraser
unaffected (T2/T4) ✅; out-of-scope (native EyeDropper, active-layer, multi-pick, alpha) absent ✅.

**Placeholder scan:** No TBD/TODO; every step has concrete before/after.

**Consistency:** `sampleColor?: (clientX, clientY) => string | null` declared in BrushCursor (T3) and
supplied with that exact signature from Canvas (T4 Step 5). `applyEyedropper(hex: string)` defined
(T2) and called in Canvas (T4 Step 3). `sampleAt(p) => string | null` defined once (T4) and used by
both the onStroke branch and the preview sampler. `selectEyedropper` imported in Toolbar (T5). Canvas
uses `state.` (unaliased); BrushCursor/Toolbar use `appState.` — matching each file's existing import.
