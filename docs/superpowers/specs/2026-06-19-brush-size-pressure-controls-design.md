# Brush Size & Pressure Controls — Design

**Status:** Approved (design phase)
**Date:** 2026-06-19

## Goal

Three related improvements to brush-size and pressure-width control:

1. **Larger pressure range, especially at small sizes** — let light pen pressure draw *thinner*
   than the set size (today the set size is the thinnest a stroke can get).
2. **Numerical size field** — a typed input for exact sizes (the slider alone is imprecise at the
   low end).
3. **Size presets** — quick-pick chips, spaced so the small range is more granular.

## Current behaviour

Pressure → width is computed identically in three renderers (`brush.ts`, `ink-brush.ts`,
`stamp-brush.ts`):

```
minSize = max(0.5, settings.size)     // light pressure → your set size (the floor)
maxSize = minSize × sizeRange         // full pressure → size × Press
width   = minSize + curvedPressure × (maxSize − minSize)   // linear
```

`curvedPressure` is `pressureCurve.evaluate(rawPressure)`, applied upstream in
`Canvas.svelte` (line ~112). A mouse reports `pressure: 0` (`input.ts`), so under the old model it
draws at exactly `settings.size` (the floor).

Toolbar controls: `Size` range slider (0.5–60, step 0.5) and `Press`/`sizeRange` slider (1–8×, step
0.5, default 3).

**Problem:** the set size is the *minimum* width — pressure only widens upward. With a size-2 brush at
3× the stroke spans only 2→6px, so small brushes feel like they have almost no pressure range; and you
can never draw a line thinner than your size setting.

## Design

### 1. Width model — "Model 2" (nominal size, symmetric range)

The set size becomes the **nominal** width; the pressure range opens *both* directions around it:

```
minWidth = max(0.5, size / sizeRange)   // light pressure → thinner than nominal (clamped at 0.5px)
maxWidth = size × sizeRange             // full pressure → unchanged from today
width    = minWidth + curvedPressure × (maxWidth − minWidth)   // linear, unchanged
```

- **Thick end is identical to today** (`size × sizeRange`), so existing full-pressure feel and saved
  sizes are not re-scaled at the top.
- A **thin end is added below** the nominal size: a size-2 brush at 3× now spans 0.667→6px instead of
  2→6px. The thin end is clamped to the existing 0.5px floor so a stroke never vanishes.
- `Press`/`sizeRange` becomes a single "expressiveness" knob: total ratio = `sizeRange²`
  (thinnest→thickest), centred on the nominal size.

**Invariants** (no width inversion possible): for `size ≥ 0.5` and `sizeRange ≥ 1`,
`size × sizeRange ≥ 0.5`, and `max(0.5, size/sizeRange) ≤ size ≤ size × sizeRange`, so
`minWidth ≤ maxWidth` always. `sizeRange = 1` ⇒ `minWidth = maxWidth = size` (constant width, no
pressure variation).

Interpolation stays **linear** (smallest change; the `Press` slider + pressure-curve editor remain
the tuning controls). Geometric interpolation was considered and set aside (YAGNI).

### 2. Shared helper (DRY + testability)

The min/max formula is currently duplicated across the three renderers. Extract one pure helper and
have all three call it:

```ts
// src/core/brush.ts (exported; ink-brush.ts and stamp-brush.ts import it)
export function widthRange(size: number, sizeRange: number): { min: number; max: number } {
  const max = Math.max(0.5, size) * sizeRange;
  const min = Math.max(0.5, Math.max(0.5, size) / sizeRange);
  return { min, max };
}
```

Note `size` is floored at 0.5 (preserving the existing `Math.max(0.5, settings.size)`) before both
the divide and the multiply, so `max` matches today exactly when `sizeRange` is unchanged. Each
renderer replaces its local `minSize`/`maxSize` lines with `const { min: minSize, max: maxSize } =
widthRange(settings.size, sizeRange);` and keeps its existing per-point interpolation
(`brush.ts` still derives `mappedPressure = desiredSize / maxSize` for perfect-freehand;
`ink-brush.ts`/`stamp-brush.ts` keep their `minSize + p × (maxSize − minSize)` usage).

### 3. Mouse / no-pressure handling

A mouse has no pressure sensor and must keep drawing at exactly the nominal `size` (not the new thin
floor).

- `InputPoint` gains `hasPressure: boolean` (`src/core/input.ts`). `getPoint` sets it
  `e.pointerType !== "mouse"` (pen → `true`, mouse → `false`). The synthetic mouse `pressure` value
  is now irrelevant to width (see below) but is left at `0`.
- `hasPressure` is carried through the streamline lerp and the gap-interpolation in `input.ts` (it is
  constant within a stroke — copy from the source point).
- `Canvas.svelte` chooses the effective range per stroke:
  `const sr = (curved[0]?.hasPressure ?? true) ? state.sizeRange : 1;` and passes `sr` to
  `drawStroke` / `drawInkStrokeIncremental` / `drawStampStrokeIncremental`. With `sr = 1`,
  `widthRange` collapses to `min = max = size`, so a mouse draws a constant nominal-width line and the
  pressure curve is moot for it.

The existing `Math.max(0.5, settings.size)` spread keeps `hasPressure` on the curved-point copy in
`Canvas.svelte` (`{ ...p, pressure: ... }`).

### 4. Toolbar UI (`src/lib/Toolbar.svelte`)

Inline, beside the existing `Size` slider. (Toolbar crowding is acknowledged and will be addressed in
a later pass.)

- **Number field:** `<input type="number" min="0.5" max="60" step="0.5" bind:value={state.brush.size}>`,
  bound to the same `state.brush.size` as the slider (the two stay in sync automatically). Lets the
  user type exact small values.
- **Preset chips:** a row of buttons from `const SIZE_PRESETS = [0.5, 1, 2, 4, 8, 16, 32, 60]`. Each
  sets `state.brush.size = preset` on click. The chip whose value equals the current
  `state.brush.size` is highlighted (`class:bg-surface-active={state.brush.size === preset}`). The
  geometric (~2×) spacing packs five chips into 0.5–8, giving the requested finer control at small
  sizes.
- The `Press`/`sizeRange` slider is unchanged (1–8×, default 3). The `Size` slider stays linear.

No new persisted fields; `state.brush.size` and `state.sizeRange` are already persisted, so no
preferences/project schema change.

## Files touched

- `src/core/brush.ts` — add exported `widthRange`; use it in `drawStroke`; update the stale comment.
- `src/core/ink-brush.ts` — import + use `widthRange`; update comment.
- `src/core/stamp-brush.ts` — import + use `widthRange`; update comment.
- `src/core/input.ts` — add `hasPressure` to `InputPoint`; set it in `getPoint`; carry it through the
  streamline lerp and gap-interpolation; rewrite the stale mouse comment.
- `src/lib/Canvas.svelte` — compute per-stroke `sr` from `hasPressure`; pass `sr` to the three draw
  calls.
- `src/lib/Toolbar.svelte` — number field + preset chips beside the `Size` slider; `SIZE_PRESETS`.
- `src/__tests__/brush.test.ts` (new — matches the existing `src/__tests__/` convention) — unit tests
  for `widthRange`.

## Testing

**Automated (Vitest — pure logic only; no DOM):**

- `widthRange(2, 3)` → `{ min: 0.667, max: 6 }` (≈, floating-point tolerance).
- `widthRange(2, 1)` → `{ min: 2, max: 2 }` (constant width when range = 1).
- Floor clamp: `widthRange(1, 8)` → `min === 0.5` (since 1/8 = 0.125 < 0.5), `max === 8`.
- Sub-floor size: `widthRange(0.25, 4)` → `min === 0.5`, `max === 2` (size floored at 0.5 first).
- No inversion: for a spread of `(size, range)` pairs, `min ≤ max` and `min ≤ flooredSize ≤ max`.
- Mouse-equivalent: `widthRange(size, 1).min === widthRange(size, 1).max` (the value Canvas passes for
  a no-pressure stroke) for several sizes.

The renderers and the `hasPressure` plumbing draw to a canvas / read pointer events, which Vitest has
no DOM for, so they are build- + manually verified (consistent with the rest of the canvas code).

**Manual (browser):**

- Apple Pencil / pen: light pressure now draws clearly thinner than the set size; full pressure
  matches the previous thickness. Effect is dramatic at small sizes (e.g. size 2).
- Mouse: drawing produces a constant line at exactly the set size (no thinning).
- Number field: typing `1` or `1.5` sets the size; slider and presets reflect it; `[` / `]` shortcuts
  still adjust and stay in sync.
- Presets: each chip sets the size; the active size's chip highlights; small-end chips give fine
  control.
- `ink`, `pencil`, `charcoal`, `airbrush`, `smooth` brush types and the eraser all honour the new
  range. Pressure-curve editor still shapes response.

## Out of scope

- De-crowding the toolbar / moving presets into a popover (explicitly deferred by the user).
- Geometric pressure-width interpolation, a higher `Press` cap, logarithmic size slider, or a
  separate min-width control (all considered and set aside).
- Per-layer or per-brush-type pressure settings.

## Self-review notes

- Thick-end behaviour and persisted values are preserved; only the thin end is added — minimal
  disruption while delivering "larger range, especially at small sizes."
- The one genuine behaviour risk (mouse drawing thin) is handled explicitly via `hasPressure` →
  `sr = 1`, verified by the `widthRange(size, 1)` constant-width test.
- `widthRange` extraction removes existing triplication and is the unit-tested core of the change.
