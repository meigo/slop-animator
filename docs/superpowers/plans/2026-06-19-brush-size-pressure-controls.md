# Brush Size & Pressure Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give light pen pressure a thinner-than-nominal width (Model 2), share the width formula via a tested `widthRange` helper, keep mouse strokes at nominal width, and add a numerical size field + preset chips to the toolbar.

**Architecture:** A pure `widthRange(size, sizeRange)` helper in `brush.ts` replaces the triplicated min/max formula in the three renderers. `InputPoint` gains a `hasPressure` flag so `Canvas.svelte` can pass `sizeRange = 1` (constant nominal width) for mouse strokes. The toolbar gets a bound number input and preset buttons — no store/persistence changes.

**Tech Stack:** TypeScript, Svelte 5 (Toolbar uses legacy mode — plain `let`/`$:`, no `$state`), Vitest, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-06-19-brush-size-pressure-controls-design.md`

**Branch:** execute on a new branch `brush-size-pressure-controls` (off `main`).

**Key constraints (verified against current code):**
- The min/max formula is currently identical in `brush.ts:32-33`, `ink-brush.ts:28-29`, `stamp-brush.ts:57-58`. All three must use the helper.
- `brush.ts` floors size at `Math.max(0.5, settings.size)` *before* multiplying — `widthRange` must reproduce that so `max` is unchanged when `sizeRange` is unchanged.
- Pressure entering the renderers is already curved (`Canvas.svelte:112` `pressureCurve.evaluate`). Do not re-apply the curve.
- `state.sizeRange` and `state.brush.size` are already persisted — no preferences/project schema change.
- Vitest has no DOM: only `widthRange` (pure) is unit-tested; renderers + input plumbing are build/manual-verified.

---

### Task 1: `widthRange` helper + unit tests

**Files:**
- Modify: `src/core/brush.ts`
- Test: `src/__tests__/brush.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/brush.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { widthRange } from "../core/brush";

describe("widthRange (Model 2 pressure-width mapping)", () => {
  it("opens the range both ways around the nominal size", () => {
    const { min, max } = widthRange(2, 3);
    expect(min).toBeCloseTo(2 / 3, 5); // 0.667 — thinner than nominal
    expect(max).toBeCloseTo(6, 5);     // size * range — unchanged from old model
  });

  it("collapses to a constant width when range is 1 (mouse / no-pressure path)", () => {
    for (const size of [0.5, 1, 4, 12, 60]) {
      const { min, max } = widthRange(size, 1);
      expect(min).toBeCloseTo(size, 5);
      expect(max).toBeCloseTo(size, 5);
    }
  });

  it("clamps the thin end at the 0.5px floor", () => {
    const { min, max } = widthRange(1, 8);
    expect(min).toBe(0.5); // 1/8 = 0.125 < 0.5
    expect(max).toBeCloseTo(8, 5);
  });

  it("floors sub-0.5 sizes at 0.5 before scaling", () => {
    const { min, max } = widthRange(0.25, 4);
    expect(min).toBe(0.5);          // flooredSize 0.5, 0.5/4 = 0.125 → clamp 0.5
    expect(max).toBeCloseTo(2, 5);  // 0.5 * 4
  });

  it("never inverts: min <= flooredSize <= max", () => {
    for (const size of [0.5, 1, 2, 7.5, 30, 60]) {
      for (const range of [1, 1.5, 3, 8]) {
        const { min, max } = widthRange(size, range);
        const floored = Math.max(0.5, size);
        expect(min).toBeLessThanOrEqual(floored + 1e-9);
        expect(floored).toBeLessThanOrEqual(max + 1e-9);
        expect(min).toBeLessThanOrEqual(max + 1e-9);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/brush.test.ts`
Expected: FAIL — `widthRange` is not exported from `../core/brush`.

- [ ] **Step 3: Add the helper**

In `src/core/brush.ts`, after the imports (above `export interface BrushSettings`), add:
```ts
/**
 * Model 2 pressure→width range. `size` is the nominal (medium) width:
 * light pressure → size / sizeRange (clamped to the 0.5px floor),
 * full pressure → size * sizeRange. `size` is floored at 0.5 before scaling so
 * `max` is unchanged from the legacy model when `sizeRange` is unchanged.
 * `sizeRange === 1` ⇒ constant width (used for the no-pressure / mouse path).
 */
export function widthRange(size: number, sizeRange: number): { min: number; max: number } {
  const floored = Math.max(0.5, size);
  return { min: Math.max(0.5, floored / sizeRange), max: floored * sizeRange };
}
```

- [ ] **Step 4: Use it in `drawStroke`**

In `src/core/brush.ts`, replace lines 28-33:
```ts
  // sizeRange: light pressure → settings.size, full pressure → settings.size * sizeRange.
  // We handle size-from-pressure ourselves and tell pf thinning=1 so it
  // uses our mapped pressure directly: rendered_width = size * pressure.
  // Use at least 0.5 so strokes can be very thin
  const minSize = Math.max(0.5, settings.size);
  const maxSize = minSize * sizeRange;
```
with:
```ts
  // Model 2: size is the nominal width; pressure opens the range both ways
  // (light → size/sizeRange clamped at 0.5px, full → size*sizeRange). We map
  // size→pressure ourselves and tell pf thinning=1 so it uses our mapped
  // pressure directly: rendered_width = maxSize * mappedPressure.
  const { min: minSize, max: maxSize } = widthRange(settings.size, sizeRange);
```
Leave the `inputPoints` map (lines 34-38) unchanged — it still computes
`desiredSize = minSize + p.pressure * (maxSize - minSize)` and `mappedPressure = desiredSize / maxSize`.

- [ ] **Step 5: Run tests + build**

Run: `npx vitest run src/__tests__/brush.test.ts` → PASS (5 tests).
Run: `npm run build` → 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/core/brush.ts src/__tests__/brush.test.ts
git commit -m "feat: Model 2 pressure-width mapping via tested widthRange helper"
```

---

### Task 2: Use `widthRange` in the ink and stamp renderers

**Files:**
- Modify: `src/core/ink-brush.ts`
- Modify: `src/core/stamp-brush.ts`

No new automated test (these draw to a canvas; covered by `widthRange` tests + build + manual).

- [ ] **Step 1: ink-brush — import the helper**

In `src/core/ink-brush.ts`, below the existing `import type { BrushSettings } from "./brush";` (line 2), add:
```ts
import { widthRange } from "./brush";
```

- [ ] **Step 2: ink-brush — use it**

Replace lines 28-29:
```ts
  const minSize = Math.max(0.5, settings.size);
  const maxSize = minSize * sizeRange;
```
with:
```ts
  // Model 2 range (see widthRange in brush.ts): pressure thins below / widens above nominal.
  const { min: minSize, max: maxSize } = widthRange(settings.size, sizeRange);
```
Leave line 30 (`const widthAt = (p) => minSize + p.pressure * (maxSize - minSize);`) unchanged.

- [ ] **Step 3: stamp-brush — import the helper**

In `src/core/stamp-brush.ts`, below `import type { BrushSettings } from "./brush";` (line 7), add:
```ts
import { widthRange } from "./brush";
```

- [ ] **Step 4: stamp-brush — use it**

Replace lines 57-58:
```ts
  const minSize = Math.max(0.5, settings.size);
  const maxSize = minSize * sizeRange;
```
with:
```ts
  // Model 2 range (see widthRange in brush.ts): pressure thins below / widens above nominal.
  const { min: minSize, max: maxSize } = widthRange(settings.size, sizeRange);
```
Leave the later `minSize + ... * (maxSize - minSize)` usages (lines ~84, 100, 110) unchanged.

- [ ] **Step 5: Build + tests**

Run: `npm run build` → 0 errors, 0 warnings (watch for unused `widthRange` — it must be used in each file).
Run: `npm test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/ink-brush.ts src/core/stamp-brush.ts
git commit -m "refactor: share widthRange across ink and stamp renderers"
```

---

### Task 3: `hasPressure` flag on input points

**Files:**
- Modify: `src/core/input.ts`

No automated test (pointer events need a DOM). Verified by build + Task 4 manual.

- [ ] **Step 1: Add the field to the interface**

In `src/core/input.ts`, add to `InputPoint` (after `pressure: number;`, line 4):
```ts
  /** True when the device reports real pressure (pen). False for mouse, so the
   *  renderer can draw a constant nominal width instead of the thin pressure floor. */
  hasPressure: boolean;
```

- [ ] **Step 2: Set it in `getPoint`**

In `getPoint` (lines 62-71), replace the `pressure` line + its comment (lines 65-69):
```ts
      // Mouse has no pressure sensor; report 0 so the size mapping in brush.ts/stamp-brush.ts
      // resolves to minSize = settings.size. This matches the user's mental model where the
      // size slider value IS the stroke width, with sizeRange only widening pen strokes
      // *up* from there at higher pressure.
      pressure: e.pointerType === "mouse" ? 0 : e.pressure,
```
with:
```ts
      // Mouse has no pressure sensor. Under Model 2 the size mapping thins below the
      // nominal size at low pressure, so a mouse must be flagged hasPressure:false —
      // Canvas.svelte then draws it at constant nominal width (sizeRange = 1).
      pressure: e.pointerType === "mouse" ? 0 : e.pressure,
      hasPressure: e.pointerType !== "mouse",
```

- [ ] **Step 3: Carry it through the streamline lerp**

In `onPointerMove`, the streamlined-point object (lines 122-127) builds a new point without `hasPressure`. Add it (pressure flag is constant within a stroke — copy from `raw`):
```ts
        pt = {
          x: lastStreamlined.x + (raw.x - lastStreamlined.x) * sT,
          y: lastStreamlined.y + (raw.y - lastStreamlined.y) * sT,
          pressure: lastStreamlined.pressure + (raw.pressure - lastStreamlined.pressure) * sT,
          hasPressure: raw.hasPressure,
          timestamp: raw.timestamp,
        };
```

- [ ] **Step 4: Carry it through gap interpolation**

In the interpolation loop (lines 143-148), the pushed point also omits `hasPressure`. Add it (copy from `pt`):
```ts
            currentPoints.push({
              x: prev.x + dx * t,
              y: prev.y + dy * t,
              pressure: prev.pressure + (pt.pressure - prev.pressure) * t,
              hasPressure: pt.hasPressure,
              timestamp: prev.timestamp + (pt.timestamp - prev.timestamp) * t,
            });
```

- [ ] **Step 5: Build**

Run: `npm run build` → 0 errors, 0 warnings. (TypeScript will flag any other `InputPoint` literal missing `hasPressure` — there should be none beyond those above; fix if the compiler reports one.)
Run: `npm test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/input.ts
git commit -m "feat: flag input points with hasPressure (mouse = false)"
```

---

### Task 4: Canvas passes a per-stroke effective range

**Files:**
- Modify: `src/lib/Canvas.svelte`

- [ ] **Step 1: Compute the effective range in `paintStroke`**

In `src/lib/Canvas.svelte`, inside `paintStroke` (after line 112, the `curved` map), add:
```ts
    // No-pressure strokes (mouse) draw at constant nominal width: range = 1.
    const sr = (curved[0]?.hasPressure ?? true) ? state.sizeRange : 1;
```
(The `{ ...p }` spread on line 112 already carries `hasPressure` onto each curved point.)

- [ ] **Step 2: Pass `sr` to the three draw calls**

Replace `state.sizeRange` with `sr` in the three calls:
- Line 121: `drawStroke(strokeCtx, curved, settings, done, sr);`
- Line 128: `drawInkStrokeIncremental(strokeCtx, curved, settings, sr);`
- Line 135: `drawStampStrokeIncremental(strokeCtx, curved, { ...settings, brushType: kind }, sr);`

- [ ] **Step 3: Build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass.

- [ ] **Step 4: Manual verification (browser)**

Run `npm run dev`:
- Pen/Pencil: light pressure draws clearly thinner than the set size; full pressure matches the old thickness. Dramatic at small sizes (try size 2, Press 3×).
- Mouse: a stroke is a constant line at exactly the set size (no thinning).
- All brush types (smooth/ink/pencil/charcoal/airbrush) + eraser honour the new range; pressure-curve editor still shapes response.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Canvas.svelte
git commit -m "feat: draw mouse strokes at constant nominal width"
```

---

### Task 5: Toolbar number field + size presets

**Files:**
- Modify: `src/lib/Toolbar.svelte`

No automated test (UI; no DOM in Vitest). Build + manual.

- [ ] **Step 1: Add the presets constant**

In the `<script>` of `src/lib/Toolbar.svelte`, add (near the other top-level consts):
```ts
  const SIZE_PRESETS = [0.5, 1, 2, 4, 8, 16, 32, 60];
```

- [ ] **Step 2: Add the number field + chips beside the Size slider**

Replace the existing Size label block (lines 90-92):
```svelte
  <label class="flex items-center gap-1 text-sm text-text-secondary">Size
    <input type="range" min="0.5" max="60" step="0.5" bind:value={state.brush.size} />
  </label>
```
with:
```svelte
  <label class="flex items-center gap-1 text-sm text-text-secondary">Size
    <input type="range" min="0.5" max="60" step="0.5" bind:value={state.brush.size} />
    <input class="w-12 text-xs bg-surface border border-border rounded px-1 text-text"
           type="number" min="0.5" max="60" step="0.5" bind:value={state.brush.size}
           title="Brush size" />
  </label>
  <div class="flex items-center gap-0.5" title="Size presets">
    {#each SIZE_PRESETS as preset}
      <button class="px-1 text-xs rounded text-text-secondary hover:bg-surface-hover tabular-nums"
              class:bg-surface-active={state.brush.size === preset}
              onclick={() => (state.brush.size = preset)}>{preset}</button>
    {/each}
  </div>
```

- [ ] **Step 3: Build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass.

- [ ] **Step 4: Manual verification (browser)**

Run `npm run dev`:
- The number field shows the current size and edits it; the slider and chips reflect typed values; `[` / `]` shortcuts still adjust and stay in sync.
- Each preset chip sets the size; the chip equal to the current size is highlighted; small-end chips (0.5–8) give fine control.
- Setting a tiny size (e.g. 1) then drawing with the pen shows the expanded thin↔thick range from Tasks 1-4.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Toolbar.svelte
git commit -m "feat: brush size numerical field + presets"
```

---

## Final verification

- [ ] `npm run build` → 0 errors, 0 warnings.
- [ ] `npm test` → all prior tests pass + 5 new `widthRange` tests.
- [ ] Manual checklists (Task 4 Step 4, Task 5 Step 4) confirmed in browser.

## Self-Review (completed by plan author)

**Spec coverage:** Model 2 mapping (Task 1) ✅; `widthRange` helper shared across all 3 renderers (Tasks 1-2) ✅; mouse → nominal via `hasPressure`/`sr=1` (Tasks 3-4) ✅; number field + presets `0.5·1·2·4·8·16·32·60` inline (Task 5) ✅; `widthRange` unit tests incl. floor-clamp / constant-when-range-1 / no-inversion (Task 1) ✅; no persistence/schema change ✅; out-of-scope items (toolbar de-crowding, geometric interp, log slider) absent ✅.

**Placeholder scan:** No TBD/TODO; every code step shows the exact before/after. ✅

**Type consistency:** `widthRange(size, sizeRange): {min, max}` defined in Task 1 and called identically in Tasks 1-2; `InputPoint.hasPressure: boolean` defined in Task 3 and read as `curved[0]?.hasPressure` in Task 4; `SIZE_PRESETS: number[]` defined and iterated in Task 5. The `min:`/`max:` destructure renames to the local `minSize`/`maxSize` the existing interpolation lines expect. ✅
