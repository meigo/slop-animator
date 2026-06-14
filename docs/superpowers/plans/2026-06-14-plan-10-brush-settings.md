# Plan 10 — Brush settings (opacity/smoothing, taper, textured brushes, pressure curve) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose opacity/smoothing/streamline sliders, add a taper toggle, wire the already-copied stamp engine (Pencil/Charcoal/Airbrush brush types), and add a pressure-curve editor — all from slop-paint.

**Architecture:** Opacity/smoothing already drive the brush — they just need sliders. Taper requires a tiny `brush.ts` change (it currently hardcodes `taper:false`) plus a setting. Brush types branch `onStroke` between the smooth perfect-freehand path (full-redraw) and the incremental stamp engine (`drawStampStrokeIncremental`), both already in `core/`. The pressure curve is a shared `PressureCurve` instance whose `evaluate()` remaps each point's pressure before drawing, edited via the copied `createCurveEditor` widget in a popup.

**Tech Stack:** Svelte 5 (runes), Tailwind 4, perfect-freehand (smooth), the copied `core/stamp-brush.ts` + `core/brush-textures.ts` (stamps) + `core/pressure-curve.ts` (curve).

> ⚠️ **VERIFICATION NOTE:** no new unit tests (these are brush-engine integration + UI). Gate: type-check/build/no-regression (72 tests) + **human** verification (each brush type draws; taper tapers; pressure curve changes response).

**Builds on Plans 1–9 (on `main`).** Existing facts:
- `src/core/brush.ts`: `BrushSettings { size, color, opacity, smoothing, isEraser, drawBehind, alphaLock }`; `drawStroke(ctx, points, settings, done, sizeRange)` (uses `opacity`/`smoothing`, hardcodes `taper:false`).
- `src/core/stamp-brush.ts`: `resetStampState()`, `drawStampStrokeIncremental(ctx, points, settings: StampBrushSettings, sizeRange?, spacing?)`, `StampBrushSettings = BrushSettings & { brushType: BrushType }`.
- `src/core/brush-textures.ts`: `type BrushType = "smooth" | "pencil" | "charcoal" | "airbrush"`.
- `src/core/pressure-curve.ts`: `class PressureCurve { evaluate(t): number }`, `createCurveEditor(curve, onChange): HTMLElement & { redraw(): void }`.
- `src/state/appState.svelte.ts`: `state.brush` (BrushSettings), `state.sizeRange`, `state.streamline`; `state` is a `$state` proxy.
- `src/lib/Canvas.svelte`: `onStroke` brush path does `putImageData(before)` → `save()` → `setTransform(DPR)` → `selection?.applyClip` → `drawStroke(...)` → `restore()` each move; `state` is imported (so **no `$state` rune** can be used in this file).
- `src/lib/Toolbar.svelte`: currently Size + Press(sizeRange) sliders + color; themed (`bg-surface`, `text-text-secondary`, `border-border`).
- tsconfig: `erasableSyntaxOnly`, `noUnusedLocals`.

---

## File Structure

```
src/
  core/brush.ts            ← MODIFY: BrushSettings.taper + apply taper in drawStroke
  state/appState.svelte.ts ← MODIFY: brush.taper default; brushType; export pressureCurve
  lib/Canvas.svelte        ← MODIFY: onStroke — pressure-curve remap + smooth/stamp branch
  lib/Toolbar.svelte       ← MODIFY: opacity/smoothing/streamline sliders, taper toggle,
                             brush-type picker, pressure-curve popup button + editor
  app.css                  ← MODIFY: .curve-popup styles
```

---

## Task 1: Engine + state (taper, brushType, pressureCurve)

**Files:**
- Modify: `src/core/brush.ts`, `src/state/appState.svelte.ts`

- [ ] **Step 1: Add `taper` to BrushSettings and apply it in `drawStroke`**

In `src/core/brush.ts`, add `taper` to the `BrushSettings` interface (after `alphaLock: boolean;`):
```ts
  taper?: boolean;
```
Then in `drawStroke`, the perfect-freehand options currently are:
```ts
    start: { taper: false, cap: true },
    end: { taper: false, cap: true },
```
Replace with:
```ts
    start: { taper: settings.taper ?? false, cap: !(settings.taper ?? false) },
    end: { taper: settings.taper ?? false, cap: !(settings.taper ?? false) },
```
(Tapered ends draw to a point with no cap; default off preserves the round cap.)

- [ ] **Step 2: Extend app state**

In `src/state/appState.svelte.ts`:
1. Add imports — merge `type BrushType` from brush-textures and `PressureCurve` from pressure-curve into the imports:
```ts
import type { BrushType } from "../core/brush-textures";
import { PressureCurve } from "../core/pressure-curve";
```
2. In `interface AnimState`, add after `streamline: number;`:
```ts
  brushType: BrushType;
```
3. In the `brush: { … }` initializer, add `taper: false,` after `alphaLock: false,`.
4. In the `$state({ … })` initializer, add after `streamline: 50,`:
```ts
  brushType: "smooth",
```
5. At the end of the file, add:
```ts
/** Shared pressure-response curve, remaps raw pen pressure before drawing. Imperative widget. */
export const pressureCurve = new PressureCurve();
```

- [ ] **Step 3: Verify**

Run: `npm run check` — 0 errors (BrushType/PressureCurve imports resolve; the `brush` object now satisfies BrushSettings incl. optional `taper`). `npm test` — 72 pass. `npx vite build` — succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/core/brush.ts src/state/appState.svelte.ts
git commit -m "feat(brush): taper setting, brushType, shared pressureCurve"
```

---

## Task 2: onStroke — pressure curve + smooth/stamp branch

**Files:**
- Modify: `src/lib/Canvas.svelte`

- [ ] **Step 1: Import the stamp engine + pressureCurve**

Add to the imports near the top of the `<script>`:
```ts
  import { drawStampStrokeIncremental, resetStampState } from "../core/stamp-brush";
  import { pressureCurve } from "../state/appState.svelte";
```

- [ ] **Step 2: Reset stamp state at stroke start**

In `onStroke`, the stroke-init block currently ends with `bump();`:
```ts
      strokeCanvas = ensureDrawableKeyframe(layer, state.playhead, canvasOps);
      strokeCtx = strokeCanvas.getContext("2d", { willReadFrequently: true })!;
      beforeSnapshot = strokeCtx.getImageData(0, 0, strokeCanvas.width, strokeCanvas.height);
      bump();
```
Add a `resetStampState()` call when the brush is a stamp type:
```ts
      strokeCanvas = ensureDrawableKeyframe(layer, state.playhead, canvasOps);
      strokeCtx = strokeCanvas.getContext("2d", { willReadFrequently: true })!;
      beforeSnapshot = strokeCtx.getImageData(0, 0, strokeCanvas.width, strokeCanvas.height);
      if (state.brushType !== "smooth") resetStampState();
      bump();
```

- [ ] **Step 3: Replace the draw block with the pressure-curve + branch logic**

The current draw block is:
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
Replace it with:
```ts
    // Remap pen pressure through the user's curve.
    const curved = points.map((p) => ({ ...p, pressure: pressureCurve.evaluate(p.pressure) }));
    const settings = { ...state.brush, isEraser: state.tool === "eraser" };

    if (state.brushType === "smooth") {
      // Smooth (perfect-freehand): redraw the whole stroke from the pre-stroke snapshot,
      // clipped to the active selection.
      strokeCtx!.putImageData(beforeSnapshot!, 0, 0);
      strokeCtx!.save();
      strokeCtx!.setTransform(DPR, 0, 0, DPR, 0, 0);
      selection?.applyClip(strokeCtx!);
      drawStroke(strokeCtx!, curved, settings, done, state.sizeRange);
      strokeCtx!.restore();
    } else {
      // Stamp engine (pencil/charcoal/airbrush): incremental — no snapshot restore.
      strokeCtx!.save();
      strokeCtx!.setTransform(DPR, 0, 0, DPR, 0, 0);
      selection?.applyClip(strokeCtx!);
      drawStampStrokeIncremental(strokeCtx!, curved, { ...settings, brushType: state.brushType }, state.sizeRange);
      strokeCtx!.restore();
    }
    recomposite();
```

- [ ] **Step 4: Verify**

Run: `npm run check` — 0 errors. `npm test` — 72 pass. `npx vite build` — succeeds. `npm run dev` (headless) — boots clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Canvas.svelte
git commit -m "feat(brush): pressure-curve remap + smooth/stamp brush branch in onStroke"
```

---

## Task 3: Toolbar controls (sliders, taper, brush types, curve popup) + CSS

**Files:**
- Modify: `src/lib/Toolbar.svelte`, `src/app.css`

- [ ] **Step 1: Add the `.curve-popup` styles to `src/app.css`**

Append to `src/app.css`:
```css
/* Pressure curve popup */
.curve-popup {
  position: absolute;
  top: 40px;
  left: 0;
  z-index: 30;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  display: none;
}
.curve-popup.open { display: flex; flex-direction: column; align-items: center; }
.curve-popup canvas { border-radius: 4px; }
```

- [ ] **Step 2: Add controls to `src/lib/Toolbar.svelte`**

Read `src/lib/Toolbar.svelte`. Keep ALL existing markup/handlers. Make these additions:

1. In the `<script>`, add imports and the curve-popup wiring:
```ts
  import { onMount } from "svelte";
  import { Spline } from "@lucide/svelte";
  import { pressureCurve } from "../state/appState.svelte";
  import { createCurveEditor } from "../core/pressure-curve";

  let curveOpen = $state(false);
  let curvePopupEl: HTMLDivElement;

  onMount(() => {
    const editor = createCurveEditor(pressureCurve, () => {});
    curvePopupEl.appendChild(editor);
  });
```
(`state` is already imported; `Spline` adds to whatever lucide import line already exists — merge it in.)

2. After the existing Press (sizeRange) slider `<label>…Press…</label>` block, add a **brush-type picker**, **opacity**, **smoothing**, **streamline**, **taper**, and the **curve button**:
```svelte
  <select class="h-7 border border-border rounded bg-surface text-text-secondary text-xs px-1" bind:value={state.brushType} title="Brush type">
    <option value="smooth">Smooth</option>
    <option value="pencil">Pencil</option>
    <option value="charcoal">Charcoal</option>
    <option value="airbrush">Airbrush</option>
  </select>
  <label class="flex items-center gap-1 text-xs text-text-secondary">Opacity
    <input type="range" min="1" max="100" class="w-16" bind:value={state.brush.opacity} />
  </label>
  <label class="flex items-center gap-1 text-xs text-text-secondary">Smooth
    <input type="range" min="0" max="100" class="w-16" bind:value={state.brush.smoothing} />
  </label>
  <label class="flex items-center gap-1 text-xs text-text-secondary">Stream
    <input type="range" min="0" max="100" class="w-16" bind:value={state.streamline} />
  </label>
  <label class="flex items-center gap-1 text-xs text-text-secondary" title="Taper stroke ends">
    <input type="checkbox" bind:checked={state.brush.taper} /> Taper
  </label>
  <div class="relative">
    <button class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
            class:bg-surface-active={curveOpen} title="Pressure curve" onclick={() => (curveOpen = !curveOpen)}>
      <Spline size={18} />
    </button>
    <div class="curve-popup" class:open={curveOpen} bind:this={curvePopupEl}></div>
  </div>
```
Place this group after the Press slider and before the color input. Keep the color input + Undo/Redo + the rest unchanged.

- [ ] **Step 3: Verify**

Run: `npm run check` — 0 errors (`Spline`/`createCurveEditor`/`pressureCurve` resolve; `state.brush.taper`/`state.brushType` typed). `npm test` — 72 pass. `npx vite build` — succeeds. `npm run dev` (headless) — boots clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/Toolbar.svelte src/app.css
git commit -m "feat(ui): brush-type picker, opacity/smoothing/streamline, taper, pressure-curve popup"
```

---

## Task 4: Final verification

**Files:** none.

- [ ] **Step 1: Automated DoD**

Run: `npm run check` (0 errors), `npm test` (72 pass), `npx vite build` (success), `npm run dev` headless (boots clean).

- [ ] **Step 2: Manual checklist (HUMAN — required)**

Run `npm run dev:lan`:
1. **Opacity/Smoothing/Streamline** sliders visibly change the stroke (lighter ink; smoother/looser line).
2. **Taper** on → stroke ends taper to a point; off → round caps.
3. **Brush types**: pick Pencil/Charcoal/Airbrush → strokes show the grainy/rough/soft textures (distinct from Smooth). Each respects size, color, pressure, and the selection clip.
4. **Pressure curve**: click the Spline button → a popup with a draggable curve appears; bend it → pen pressure response changes for subsequent strokes (smooth + textured).
5. **No regression**: eraser, fill, selection clip + transform, onion, playback, layers, export, save/load all still work; undo/redo reverts strokes of every brush type.

---

## Self-Review (completed during planning)

**Spec coverage (the four chosen settings):** opacity/smoothing (+streamline) sliders — Task 3; taper — Task 1 (`brush.ts` + setting) + Task 3 (toggle); textured brushes — Task 1 (`brushType` state) + Task 2 (`onStroke` stamp branch) + Task 3 (picker); pressure curve — Task 1 (`pressureCurve` export) + Task 2 (`evaluate` remap) + Task 3 (popup editor + CSS).

**Placeholder scan:** complete code in every code step; exact commands + expected results. The Toolbar control group is given as exact markup to insert at a stated location, preserving existing handlers.

**Type consistency:** `BrushSettings.taper` (Task 1) used in `drawStroke` and the Toolbar toggle. `state.brushType: BrushType` (Task 1) read in `onStroke` (Task 2) and the picker (Task 3). `pressureCurve` (Task 1) consumed by `onStroke` (Task 2) and the Toolbar popup (Task 3). `drawStampStrokeIncremental`/`resetStampState` signatures match `core/stamp-brush.ts`. `createCurveEditor(curve, onChange)` matches `core/pressure-curve.ts`.

**Risks / known limitations:** modifying `brush.ts` (copied core) for taper diverges it from slop-paint — accepted, since slop-paint's brush.ts never actually implemented taper (it claims the feature in its README but hardcodes it off); this is the correct implementation. The stamp path is incremental (no snapshot restore) — its undo still works via the start/end ImageData snapshot. Pressure-curve editor is the copied imperative widget (battle-tested). All visual behavior is human-verified.
