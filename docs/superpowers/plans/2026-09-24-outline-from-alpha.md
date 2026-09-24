# Outline from layer alpha — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A destructive "Outline" tool that turns the current drawing's solid shapes into outlines of adjustable thickness, with two noise-driven knobs (Wobble, Variation), previewed live and baked as one undo step.

**Architecture:** A pure core (`src/core/outline.ts`) builds a signed distance field from the cell's alpha — seeded sub-pixel from the brush's anti-aliasing — and keeps the pixels whose distance falls inside a band whose offset and width are driven by two seeded value-noise fields. `Canvas.svelte` drives it as a lift-style tool: entry snapshots the cell, every knob change re-derives the preview from that snapshot into the cell itself, Apply bakes through `pixelCommand`, Cancel restores.

**Tech Stack:** TypeScript, Svelte 5 runes, Vitest (node env, no DOM), Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-09-24-outline-from-alpha-design.md` — read it first; this plan argues from it.

## Global Constraints

- `npm run build` must end **0 errors, 0 warnings** (`svelte-check && tsc --noEmit && vite build`). This is the bar for every task.
- `npm test` must stay green. Baseline before this plan: **1447 passing**.
- Runes mode everywhere. A component using the `$state` rune must import the store as `import { state as appState }` (CLAUDE.md gotcha #1). `Canvas.svelte` already does.
- Undo snapshots share cell/canvas refs: never mutate a cell in place, replace it (gotcha #8).
- Never re-render the document from a pointermove handler; coalesce to one animation frame (gotcha #17).
- Any new draggable surface sets `touch-action: none` (gotcha #10). Controls inside the stage carry `.selection-actions-panel` and act on `onpointerdown` (gotchas #12, #18).
- Units: the cell canvas is device px (`DPR`, currently 1). Thickness is device px.
- Pure logic goes in `src/core/`, is node-testable, and is where the tests live. Canvas/DOM code is verified in the browser, not in Vitest.

---

### Task 1: Signed distance field

**Files:**
- Create: `src/core/outline.ts`
- Test: `src/__tests__/outline.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `signedDistanceField(alpha: Uint8Array | Uint8ClampedArray, w: number, h: number): Float32Array` — distance in px to the shape's edge, **positive inside, negative outside**, `0.5` for a pixel centre half a pixel from a hard edge.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/outline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { signedDistanceField } from "../core/outline";

/** w×h alpha plane with a filled rectangle (x0..x1, y0..y1 inclusive) at alpha 255. */
function rectAlpha(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const a = new Uint8Array(w * h);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) a[y * w + x] = 255;
  return a;
}

describe("signedDistanceField", () => {
  it("is negative everywhere when nothing is drawn", () => {
    const d = signedDistanceField(new Uint8Array(4 * 4), 4, 4);
    expect([...d].every((v) => v < 0)).toBe(true);
  });

  it("puts a hard edge half a pixel outside the last opaque pixel", () => {
    // 8×8 with a 4×4 block at (2,2)..(5,5).
    const d = signedDistanceField(rectAlpha(8, 8, 2, 2, 5, 5), 8, 8);
    expect(d[2 * 8 + 2]).toBeCloseTo(0.5, 5); // corner of the block: first ring inside
    expect(d[3 * 8 + 3]).toBeCloseTo(1.5, 5); // one ring further in
    expect(d[1 * 8 + 2]).toBeCloseTo(-0.5, 5); // first ring outside
  });

  it("counts off-canvas as outside, so a shape flush to the edge has an edge there", () => {
    // 6×6 filled solid: every border pixel is a boundary pixel.
    const a = new Uint8Array(6 * 6).fill(255);
    const d = signedDistanceField(a, 6, 6);
    expect(d[0]).toBeCloseTo(0.5, 5);
    expect(d[2 * 6 + 2]).toBeCloseTo(2.5, 5);
  });

  it("carries the source's anti-aliasing sub-pixel", () => {
    // A vertical hard edge, but the boundary column is half-covered: the 50% crossing sits ON
    // that pixel's centre, so its distance is 0, not 0.5.
    const w = 6, h = 1;
    const a = new Uint8Array(w * h);
    a[0] = 255; a[1] = 255; a[2] = 128; // 128/255 ≈ 0.502
    const d = signedDistanceField(a, w, h);
    expect(Math.abs(d[2])).toBeLessThan(0.05);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/outline.test.ts`
Expected: FAIL — `Failed to resolve import "../core/outline"`.

- [ ] **Step 3: Write the implementation**

Create `src/core/outline.ts`:

```ts
/**
 * Outline-from-alpha: the pure half of the Outline tool. Turns a cell's alpha plane into an
 * outline of adjustable thickness, with two noise-driven knobs.
 *
 * See `docs/superpowers/specs/2026-09-24-outline-from-alpha-design.md`. The short version: a
 * SIGNED distance field (positive inside), seeded sub-pixel from the brush's anti-aliasing, then
 * keep the pixels whose distance falls inside a band whose offset (Wobble) and width (Variation)
 * come from two seeded noise fields. Signed rather than inside-only because an inside-only field
 * clips an outward wobble, leaving something indistinguishable from Variation.
 */

const ORTH = 1;
const DIAG = Math.SQRT2;
const FAR = 1e9;

/**
 * Distance in px from each pixel centre to the shape's edge: POSITIVE inside, NEGATIVE outside.
 *
 * Two-pass chamfer (orthogonal 1, diagonal √2 — about 4% high on long diagonals, under 1px at the
 * tool's maximum thickness). Boundary pixels are seeded at `|alpha/255 - 0.5|` rather than 0, so a
 * hard edge lands half a pixel outside the last opaque pixel (geometrically right) and an
 * anti-aliased edge keeps its sub-pixel position — which is what stops outlined text going blocky.
 *
 * Off-canvas counts as OUTSIDE, matching `erodeMask`'s documented convention, so a shape running
 * off the edge of the canvas is outlined along that edge.
 */
export function signedDistanceField(
  alpha: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
): Float32Array {
  const n = w * h;
  const inside = new Uint8Array(n);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    inside[i] = alpha[i] >= 128 ? 1 : 0;
    d[i] = FAR;
  }
  // Seed every pixel that has a differently-classified 4-neighbour (off-grid = outside).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const me = inside[i];
      const left = x > 0 ? inside[i - 1] : 0;
      const right = x < w - 1 ? inside[i + 1] : 0;
      const up = y > 0 ? inside[i - w] : 0;
      const down = y < h - 1 ? inside[i + w] : 0;
      if (left !== me || right !== me || up !== me || down !== me) {
        d[i] = Math.abs(alpha[i] / 255 - 0.5);
      }
    }
  }
  // Forward pass: top-left to bottom-right.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + ORTH);
      if (y > 0) v = Math.min(v, d[i - w] + ORTH);
      if (y > 0 && x > 0) v = Math.min(v, d[i - w - 1] + DIAG);
      if (y > 0 && x < w - 1) v = Math.min(v, d[i - w + 1] + DIAG);
      d[i] = v;
    }
  }
  // Backward pass: bottom-right to top-left.
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + ORTH);
      if (y < h - 1) v = Math.min(v, d[i + w] + ORTH);
      if (y < h - 1 && x < w - 1) v = Math.min(v, d[i + w + 1] + DIAG);
      if (y < h - 1 && x > 0) v = Math.min(v, d[i + w - 1] + DIAG);
      d[i] = v;
    }
  }
  for (let i = 0; i < n; i++) if (!inside[i]) d[i] = -d[i];
  return d;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/outline.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Build, then commit**

```bash
npm run build   # must print 0 ERRORS 0 WARNINGS
git add src/core/outline.ts src/__tests__/outline.test.ts
git commit -m "feat(outline): signed distance field, sub-pixel at the edge"
```

---

### Task 2: Seeded value noise

**Files:**
- Modify: `src/core/outline.ts`
- Test: `src/__tests__/outline.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `valueNoise(x: number, y: number, seed: number): number` in [-1, 1], smooth, deterministic per `(x, y, seed)`. `x`/`y` are in NOISE-LATTICE units, not px — the caller divides px by the feature size.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/outline.test.ts`:

```ts
import { valueNoise } from "../core/outline";

describe("valueNoise", () => {
  it("is deterministic for the same (x, y, seed)", () => {
    expect(valueNoise(1.25, 3.5, 7)).toBe(valueNoise(1.25, 3.5, 7));
  });

  it("gives a different field for a different seed", () => {
    const a = valueNoise(1.25, 3.5, 7);
    const b = valueNoise(1.25, 3.5, 8);
    expect(a).not.toBe(b);
  });

  it("stays within [-1, 1]", () => {
    for (let i = 0; i < 500; i++) {
      const v = valueNoise(i * 0.37, i * 0.11, 3);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is smooth: neighbouring samples within a lattice cell stay close", () => {
    let maxJump = 0;
    for (let i = 0; i < 200; i++) {
      const a = valueNoise(5 + i * 0.01, 2.5, 4);
      const b = valueNoise(5 + (i + 1) * 0.01, 2.5, 4);
      maxJump = Math.max(maxJump, Math.abs(a - b));
    }
    expect(maxJump).toBeLessThan(0.1); // a hash-per-pixel field would jump ~2
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/outline.test.ts -t valueNoise`
Expected: FAIL — `valueNoise is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/core/outline.ts`:

```ts
/** Integer hash → [0, 1). `Math.imul` keeps the multiplies in 32-bit, which is both faster and
 *  reproducible across engines (a plain `*` would go through doubles and lose the low bits). */
function hash2(xi: number, yi: number, seed: number): number {
  let n = Math.imul(xi, 374761393) ^ Math.imul(yi, 668265263) ^ Math.imul(seed, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** Smooth 2D value noise in [-1, 1]. `x`/`y` are lattice units: divide px by the feature size. */
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smoothstep(x - xi);
  const ty = smoothstep(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const e = hash2(xi + 1, yi + 1, seed);
  const top = a + (b - a) * tx;
  const bottom = c + (e - c) * tx;
  return (top + (bottom - top) * ty) * 2 - 1;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/outline.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Build, then commit**

```bash
npm run build
git add src/core/outline.ts src/__tests__/outline.test.ts
git commit -m "feat(outline): seeded smooth value noise"
```

---

### Task 3: `outlineMask` — the band

**Files:**
- Modify: `src/core/outline.ts`
- Test: `src/__tests__/outline.test.ts`

**Interfaces:**
- Consumes: `signedDistanceField` (Task 1), `valueNoise` (Task 2).
- Produces:
  - `export interface OutlineOptions { thickness: number; wobble: number; variation: number; seed: number }`
  - `outlineMask(alpha, w, h, opts, field?: Float32Array): Uint8ClampedArray` — alpha coverage, 0..255. `field` is an optional precomputed `signedDistanceField` result, which the tool caches across knob changes.
  - `clampThickness(value: unknown): number` — 0..`MAX_THICKNESS`.
  - Constants `MAX_THICKNESS = 24`, `WOBBLE_MAX = 3`, `VARIATION_MAX = 0.6`, `MIN_WIDTH = 0.75`, `FEATURE_PX = 24`.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/outline.test.ts`:

```ts
import { clampThickness, outlineMask, MAX_THICKNESS } from "../core/outline";
import { erodeMask } from "../core/mask-ops";

const plain = { wobble: 0, variation: 0, seed: 1 };

describe("outlineMask", () => {
  it("hollows a solid rectangle to a ring of exactly the requested thickness", () => {
    const w = 20, h = 20;
    const out = outlineMask(rectAlpha(w, h, 4, 4, 15, 15), w, h, { ...plain, thickness: 2 });
    expect(out[4 * w + 4]).toBe(255); // outer ring
    expect(out[5 * w + 5]).toBe(255); // second ring — thickness 2
    expect(out[6 * w + 6]).toBe(0); // third ring is hollowed
    expect(out[10 * w + 10]).toBe(0); // middle is empty
    expect(out[3 * w + 4]).toBe(0); // nothing outside the silhouette
  });

  it("matches `mask minus erodeMask` when both knobs are zero", () => {
    const w = 24, h = 24;
    const alpha = rectAlpha(w, h, 5, 6, 18, 17);
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = alpha[i] >= 128 ? 1 : 0;
    const eroded = erodeMask(mask, w, h, 3);
    const out = outlineMask(alpha, w, h, { ...plain, thickness: 3 });
    for (let i = 0; i < mask.length; i++) {
      const expected = mask[i] && !eroded[i] ? 255 : 0;
      expect(out[i]).toBe(expected);
    }
  });

  it("leaves a shape thinner than the thickness solid", () => {
    const w = 12, h = 12;
    const alpha = rectAlpha(w, h, 2, 5, 9, 6); // a 2px-tall bar
    const out = outlineMask(alpha, w, h, { ...plain, thickness: 6 });
    for (let x = 2; x <= 9; x++) {
      expect(out[5 * w + x]).toBe(255);
      expect(out[6 * w + x]).toBe(255);
    }
  });

  it("outlines a hole's edge too", () => {
    const w = 24, h = 24;
    const alpha = rectAlpha(w, h, 4, 4, 19, 19);
    for (let y = 9; y <= 14; y++) for (let x = 9; x <= 14; x++) alpha[y * w + x] = 0; // punch a hole
    const out = outlineMask(alpha, w, h, { ...plain, thickness: 1 });
    expect(out[8 * w + 11]).toBe(255); // ring around the hole
    expect(out[11 * w + 11]).toBe(0); // the hole itself stays empty
  });

  it("is byte-identical for one seed and different for another", () => {
    const w = 30, h = 30;
    const alpha = rectAlpha(w, h, 5, 5, 24, 24);
    const opts = { thickness: 3, wobble: 0.8, variation: 0.8 };
    const a = outlineMask(alpha, w, h, { ...opts, seed: 1 });
    const b = outlineMask(alpha, w, h, { ...opts, seed: 1 });
    const c = outlineMask(alpha, w, h, { ...opts, seed: 2 });
    expect([...a]).toEqual([...b]);
    expect([...a]).not.toEqual([...c]);
  });

  it("keeps a wobbled line within WOBBLE_MAX of the plain band", () => {
    const w = 40, h = 40;
    const alpha = rectAlpha(w, h, 8, 8, 31, 31);
    const wobbled = outlineMask(alpha, w, h, { thickness: 2, wobble: 1, variation: 0, seed: 5 });
    const field = signedDistanceField(alpha, w, h);
    for (let i = 0; i < wobbled.length; i++) {
      if (wobbled[i] > 0) expect(field[i]).toBeGreaterThan(-3.5); // never further out than WOBBLE_MAX (+ the AA ramp)
    }
  });

  it("anti-aliases: a soft source edge gives a soft outer edge", () => {
    const w = 10, h = 1;
    const alpha = new Uint8Array(w * h);
    alpha[3] = 160; // partial coverage on the boundary pixel
    for (let x = 4; x <= 8; x++) alpha[x] = 255;
    const out = outlineMask(alpha, w, h, { ...plain, thickness: 2 });
    expect(out[3]).toBeGreaterThan(0);
    expect(out[3]).toBeLessThan(255);
  });

  it("returns empty for empty input, and for thickness 0", () => {
    const w = 8, h = 8;
    expect([...outlineMask(new Uint8Array(w * h), w, h, { ...plain, thickness: 3 })].every((v) => v === 0)).toBe(true);
    expect([...outlineMask(rectAlpha(w, h, 1, 1, 6, 6), w, h, { ...plain, thickness: 0 })].every((v) => v === 0)).toBe(true);
  });

  it("clamps a thickness a NumberField could produce", () => {
    expect(clampThickness(null)).toBe(0);
    expect(clampThickness(-4)).toBe(0);
    expect(clampThickness(1000)).toBe(MAX_THICKNESS);
    expect(clampThickness(3.7)).toBe(3.7);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/outline.test.ts -t outlineMask`
Expected: FAIL — `outlineMask is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/core/outline.ts`:

```ts
/** Widest band the tool offers. The cost is flat in thickness (the field does the work), so this
 *  is a taste limit, not a performance one. */
export const MAX_THICKNESS = 24;
/** How far Wobble at 100% moves the line across the true edge, in px. */
export const WOBBLE_MAX = 3;
/** How much Variation at 100% swells or thins the band, as a fraction of `thickness`. */
export const VARIATION_MAX = 0.6;
/** The band never goes below this, so the line cannot break. Gaps were a deliberate non-goal —
 *  see the spec's decision 3; a `MIN_WIDTH` of 0 is how you would get them. */
export const MIN_WIDTH = 0.75;
/** Noise lattice size in px. What makes the variation read as hand movement rather than static. */
export const FEATURE_PX = 24;

export interface OutlineOptions {
  /** Band width in device px. Clamped to 0..MAX_THICKNESS; 0 yields an empty result. */
  thickness: number;
  /** 0..1 — how far the line wanders across the true edge. */
  wobble: number;
  /** 0..1 — how much the width swells and thins. */
  variation: number;
  /** Any integer. The same seed and options give byte-identical output. */
  seed: number;
}

/** Coerce anything a caller (or a `NumberField`, which writes `null` when emptied) might supply.
 *  Mirrors `clampGap` in `fill-holes.ts`, and for the same reason. */
export function clampThickness(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_THICKNESS, Math.max(0, n));
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/**
 * Alpha coverage (0..255) of the outline for `alpha`.
 *
 * `field` lets the caller reuse a `signedDistanceField` across knob changes: the field depends on
 * the ART only, so the tool computes it once per entry and every thickness/wobble/variation change
 * then costs one pass. Pass nothing and it is computed here.
 */
export function outlineMask(
  alpha: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  opts: OutlineOptions,
  field?: Float32Array,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  const thickness = clampThickness(opts.thickness);
  if (thickness <= 0) return out;
  const wobble = clamp01(opts.wobble);
  const variation = clamp01(opts.variation);
  const seed = Number.isFinite(opts.seed) ? Math.trunc(opts.seed) : 0;
  const d = field ?? signedDistanceField(alpha, w, h);
  // A second, independent field for the width. Offsetting the lattice as well as the seed keeps the
  // two from sharing their zero crossings, which would tie a thin spot to an inward wobble.
  const widthSeed = seed ^ 0x9e3779b9;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const offset =
        wobble === 0 ? 0 : WOBBLE_MAX * wobble * valueNoise(x / FEATURE_PX, y / FEATURE_PX, seed);
      const width =
        variation === 0
          ? thickness
          : Math.max(
              MIN_WIDTH,
              thickness *
                (1 +
                  VARIATION_MAX *
                    variation *
                    valueNoise(x / FEATURE_PX + 11.5, y / FEATURE_PX + 7.25, widthSeed)),
            );
      // One-pixel ramp centred on each edge of the band: +0.5 puts the 50% point ON the boundary.
      const coverage = Math.min(d[i] - offset, offset + width - d[i]) + 0.5;
      out[i] = coverage <= 0 ? 0 : coverage >= 1 ? 255 : Math.round(coverage * 255);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/outline.test.ts`
Expected: PASS, 17 tests.

If the `mask minus erodeMask` test fails by a pixel at the corners, do NOT relax it by switching the rectangle to a circle — the rectangle is the case where chamfer and the circular structuring element agree exactly, and a mismatch there means the band arithmetic is off by half a pixel.

- [ ] **Step 5: Measure the cost, and record it**

Add a throwaway script (do not commit it) to check the one-off cost at full canvas size:

```bash
cat > /tmp/outline-bench.mjs <<'EOF'
import { signedDistanceField, outlineMask } from "./src/core/outline.ts";
const w = 1280, h = 720;
const a = new Uint8Array(w * h);
for (let y = 100; y < 600; y++) for (let x = 100; x < 1100; x++) a[y * w + x] = 255;
let t = performance.now();
const f = signedDistanceField(a, w, h);
const fieldMs = performance.now() - t;
t = performance.now();
outlineMask(a, w, h, { thickness: 3, wobble: 0.5, variation: 0.5, seed: 1 }, f);
console.log({ fieldMs, bandMs: performance.now() - t });
EOF
npx vite-node /tmp/outline-bench.mjs
```

Write both numbers into the commit message. They are the input to the spec's half-resolution fallback decision, and nobody will measure them again later.

- [ ] **Step 6: Build, then commit**

```bash
npm run build
git add src/core/outline.ts src/__tests__/outline.test.ts
git commit -m "feat(outline): the noise-modulated band

Field <N>ms, band <M>ms at 1280x720."
```

---

### Task 4: The tool — state, toolbar button, enter/apply/cancel

**Files:**
- Modify: `src/state/appState.svelte.ts` (the `Tool` union ~line 223, the `AnimState` interface ~line 279, its initial value ~line 400, and the actions registry near `poseActions` ~line 2503)
- Modify: `src/lib/Toolbar.svelte` (after the Pose button, ~line 248)
- Modify: `src/lib/Canvas.svelte`
- Modify: `src/App.svelte` (the Escape/Enter handlers, ~lines 161 and 165)

**Interfaces:**
- Consumes: `outlineMask`, `signedDistanceField`, `clampThickness`, `OutlineOptions` (Task 3).
- Produces: `appState.tool === "outline"`; `appState.outline: { thickness: number; wobble: number; variation: number; seed: number }`; `outlineActions: { active: () => boolean; apply: () => void; cancel: () => void }` registered by `Canvas.svelte`; and, inside `Canvas.svelte`, `enterOutline()`, `refreshOutlinePreview()`, `applyOutline()`, `cancelOutline()`, `outlineActive()`.

- [ ] **Step 1: Add the tool and its settings to the store**

In `src/state/appState.svelte.ts`, extend the union (~line 223):

```ts
export type Tool =
  | "brush"
  | "eraser"
  | "fill"
  | "select"
  | "lasso"
  | "transform"
  | "eyedropper"
  | "deform"
  | "pose"
  | "outline";
```

Add to the `AnimState` interface, beside `pose` (~line 279):

```ts
  /** Outline tool settings. Session-only, like `pose` — not in `Preferences`. */
  outline: { thickness: number; wobble: number; variation: number; seed: number };
```

Add the initial value beside `pose: { fillHoles: true, gap: 0 },` (~line 400):

```ts
  outline: { thickness: 3, wobble: 0.35, variation: 0.35, seed: 1 },
```

Add the registry beside `poseActions` (~line 2503):

```ts
/** Canvas-owned Outline-tool actions for App's Enter (apply) / Escape (cancel) keys. */
export const outlineActions: { active: () => boolean; apply: () => void; cancel: () => void } = {
  active: () => false,
  apply: () => {},
  cancel: () => {},
};
```

- [ ] **Step 2: Add the toolbar button**

In `src/lib/Toolbar.svelte`, import `Spline` from `@lucide/svelte` alongside the existing icons, and add after the Pose button (~line 253):

```svelte
  <button
    class={toolBtn}
    class:opacity-40={toolsDimmed}
    class:ui-on={appState.tool === "outline"}
    title={pixelTitle("Outline (hollow the drawing to a line)")}
    onclick={() => (appState.tool = "outline")}><Spline size={18} /></button
  >
```

- [ ] **Step 3: Implement enter / preview / apply / cancel in `Canvas.svelte`**

Add the imports (`outlineMask`, `signedDistanceField` from `../core/outline`; `outlineActions` from the store import list). Then add, near the pose functions:

```ts
  // Outline tool. Unlike Pose, the preview writes into the CELL and is re-derived from the snapshot
  // on every change — so what you see is the real compositor's output (layer opacity, the layer and
  // group transform, boil, onion), and an app killed mid-tune leaves an outline rather than the
  // empty cell an overlay lift would.
  let outlineCtx: CanvasRenderingContext2D | null = null;
  let outlineBefore: ImageData | null = null;
  let outlineField: Float32Array | null = null; // depends on the ART only — computed once per entry
  let outlineLayer: DrawingLayer | null = null;
  let outlineMaterialized: CellTrackChange | null = null;
  let outlineRaf = 0;

  function outlineActive(): boolean {
    return outlineBefore !== null;
  }

  function enterOutline() {
    const al = activeLayer();
    if (
      workingTarget(appState.activeRow).kind !== "layer" ||
      al.kind !== "draw" ||
      !isLayerEditable(al, appState.project.groups) ||
      onLoopFrame(al)
    )
      return;
    const mk = ensureDrawableKeyframe(al, appState.playhead, canvasOps);
    const ctx = mk.canvas.getContext("2d", { willReadFrequently: true })!;
    const before = ctx.getImageData(0, 0, mk.canvas.width, mk.canvas.height);
    // Nothing drawn → nothing to outline. Leave the hold a hold.
    if (!before.data.some((v, i) => i % 4 === 3 && v > 0)) {
      if (mk.materialized) restoreCellTrack(al, mk.materialized.before);
      return;
    }
    outlineLayer = al;
    outlineMaterialized = mk.materialized;
    outlineCtx = ctx;
    outlineBefore = before;
    outlineField = null;
    refreshOutlinePreview();
  }

  /** Re-derive the preview from the snapshot. Coalesced to one animation frame (gotcha #17): a
   *  thickness scrub fires a pointermove per pen event and each preview is a full-canvas pass. */
  function scheduleOutlinePreview() {
    if (outlineRaf) return;
    outlineRaf = requestAnimationFrame(() => {
      outlineRaf = 0;
      refreshOutlinePreview();
    });
  }

  function refreshOutlinePreview() {
    const ctx = outlineCtx,
      before = outlineBefore;
    if (!ctx || !before) return;
    const w = ctx.canvas.width,
      h = ctx.canvas.height;
    const src = before.data;
    const alpha = new Uint8Array(w * h);
    for (let i = 0, p = 3; i < alpha.length; i++, p += 4) alpha[i] = src[p];
    // The field is a function of the ART, which the preview never changes — so it survives every
    // knob change and only a fresh entry rebuilds it.
    outlineField ??= signedDistanceField(alpha, w, h);
    const cov = outlineMask(alpha, w, h, { ...appState.outline }, outlineField);
    // RGB is carried over from the source: only alpha changes, so coloured art keeps its colour.
    const next = new ImageData(new Uint8ClampedArray(src), w, h);
    for (let i = 0, p = 3; i < cov.length; i++, p += 4) next.data[p] = cov[i];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(next, 0, 0);
    markInkChanged(ctx.canvas);
    recomposite();
  }

  function applyOutline() {
    const ctx = outlineCtx,
      before = outlineBefore;
    if (!ctx || !before) return;
    if (outlineRaf) {
      cancelAnimationFrame(outlineRaf);
      outlineRaf = 0;
      refreshOutlinePreview(); // the pending frame's settings are the ones being applied
    }
    const after = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    const layerId = outlineLayer?.id ?? null;
    const mat = outlineMaterialized;
    history.push(
      pixelCommand(
        ctx.canvas,
        () => {
          ctx.putImageData(before, 0, 0);
          if (layerId !== null && mat) restoreTrackById(layerId, mat.before); // outlining a hold made this ◆
          recomposite();
        },
        () => {
          if (layerId !== null && mat) restoreTrackById(layerId, mat.after);
          ctx.putImageData(after, 0, 0);
          recomposite();
        },
        before,
        after,
      ),
    );
    clearOutline();
    bump();
  }

  function cancelOutline() {
    if (outlineCtx && outlineBefore) {
      outlineCtx.putImageData(outlineBefore, 0, 0);
      markInkChanged(outlineCtx.canvas);
      // …and the keyframe entry materialised, so a cancelled outline leaves a hold a hold.
      if (outlineLayer && outlineMaterialized)
        restoreCellTrack(outlineLayer, outlineMaterialized.before);
    }
    clearOutline();
    recomposite();
    repaint(); // version only — the cancel restored the cell, so there is nothing new to persist
  }

  function clearOutline() {
    if (outlineRaf) {
      cancelAnimationFrame(outlineRaf);
      outlineRaf = 0;
    }
    outlineCtx = null;
    outlineBefore = null;
    outlineField = null;
    outlineLayer = null;
    outlineMaterialized = null;
  }
```

- [ ] **Step 4: Register the actions and enter on tool selection**

In `Canvas.svelte`'s `onMount` (beside `liftGuard.discard = discardActiveEdits`, ~line 1503):

```ts
    outlineActions.active = outlineActive;
    outlineActions.apply = applyOutline;
    outlineActions.cancel = cancelOutline;
```

In the tool-change `$effect` (the `toolChanged` block, ~line 2221), enter on arrival and cancel on leaving, next to the pose/deform handling:

```ts
      if (prevTool === "outline" && t !== "outline") cancelOutline();
      if (t === "outline" && toolEntryPrimed && !strokeCanvas) enterOutline();
```

`toolEntryPrimed` matters for the same reason Pose reads it: the tool is not persisted into `Preferences`, but the effect's first run still reports a change from the hardcoded initial value, and entering there would rewrite a drawing with no gesture behind it.

- [ ] **Step 5: Wire Enter and Escape**

In `src/App.svelte`, import `outlineActions` and extend the two handlers, after the `poseActions` arm in each:

```ts
      else if (outlineActions.active()) outlineActions.cancel();   // Escape, ~line 161
      else if (outlineActions.active()) outlineActions.apply();    // Enter, ~line 165
```

- [ ] **Step 6: Verify in the browser**

```bash
npx vite --host ::1 --port 5180 --strictPort
```

With a drawing on the active layer: pick the Outline tool → the drawing hollows immediately. Press Escape → it comes back. Pick it again, press Enter → it stays outlined, and one ⌘Z restores the solid. On a hold, the same Enter leaves a ◆ and ⌘Z takes the ◆ away with it. On a locked or hidden layer, selecting the tool changes nothing.

- [ ] **Step 7: Build, test, commit**

```bash
npm run build && npx vitest run
git add src/state/appState.svelte.ts src/lib/Toolbar.svelte src/lib/Canvas.svelte src/App.svelte
git commit -m "feat(outline): the tool — enter, live preview, apply, cancel"
```

---

### Task 5: The on-canvas bar

**Files:**
- Modify: `src/lib/Canvas.svelte` (the pose bar's `positionPoseBar`, ~line 1805, and the markup block at the end of the template)

**Interfaces:**
- Consumes: `appState.outline`, `scheduleOutlinePreview`, `applyOutline`, `cancelOutline` (Task 4).
- Produces: `anchorBarToBox(bboxCell, el, pos)` — the shared anchoring helper both bars call.

- [ ] **Step 1: Extract the anchoring helper**

`positionPoseBar` currently owns the bbox → `composeToDoc` → `computeAnchor` chain. Generalise it so a second bar cannot become a third copy (the two bars drifted apart once already — see the 2026-09-24 changelog entry):

```ts
  /** Anchor a bar over (or under) a CELL-space bbox, the way the selection bar anchors to a
   *  selection. Returns the workspace-relative position, or null when it cannot measure yet. */
  function anchorBarToBox(
    box: { x: number; y: number; w: number; h: number },
    el: HTMLElement | undefined,
  ): { x: number; y: number } | null {
    if (!el || !stage || !viewport) return null;
    const wsRect = stage.getBoundingClientRect();
    const panelRect = el.getBoundingClientRect();
    const a = computeAnchor({
      bboxDoc: [
        { x: box.x, y: box.y },
        { x: box.x + box.w, y: box.y },
        { x: box.x + box.w, y: box.y + box.h },
        { x: box.x, y: box.y + box.h },
      ].map(composeToDoc),
      docToScreen: (p) => {
        const sp = viewport.canvasToScreen(p.x, p.y);
        return { x: sp.x - wsRect.left, y: sp.y - wsRect.top };
      },
      panelSize: { w: panelRect.width || 320, h: panelRect.height || 50 },
      viewport: { w: stage.clientWidth, h: stage.clientHeight },
      margin: POSE_BAR_MARGIN,
    });
    return { x: a.x, y: a.y };
  }
```

Rewrite `positionPoseBar` to compute the mesh's bbox from `meshPose.deformed` as it does now, then call `anchorBarToBox(box, poseBarEl)` and assign `poseBarPos`. Behaviour is unchanged; the pose-bar browser checks from the 2026-09-24 entry must still pass.

- [ ] **Step 2: Position the outline bar from the ink's bounds**

```ts
  let outlineBarEl: HTMLDivElement | undefined = $state();
  let outlineBarPos = $state({ x: 0, y: 0 });

  function positionOutlineBar() {
    if (!outlineCtx) return;
    // The ink the tool is working on. `contentBounds` is device px and cached by canvas+version,
    // and the preview bumps that version, so the bar tracks a thinning outline rather than the
    // solid it started from.
    const b = contentBounds(outlineCtx.canvas, appState.version);
    const box = b
      ? { x: b.x / DPR, y: b.y / DPR, w: b.w / DPR, h: b.h / DPR }
      : { x: 0, y: 0, w: appState.project.width, h: appState.project.height };
    const p = anchorBarToBox(box, outlineBarEl);
    if (p) outlineBarPos = p;
  }

  // Same reason as the pose bar's effect: the element is created by the block this positions, so
  // the first pass has nothing to measure and would flash at 0,0.
  $effect(() => {
    if (outlineBarEl && outlineActive()) positionOutlineBar();
  });
```

Call `positionOutlineBar()` at the end of `refreshOutlinePreview()`, so the bar follows the ink as the outline thins.

- [ ] **Step 3: Add the markup**

After the pose bar block in the template:

```svelte
  {#if appState.version >= 0 && outlineActive()}
    <div
      bind:this={outlineBarEl}
      class="selection-actions-panel ui-bar absolute max-w-[min(92vw,34rem)] flex-col z-30"
      style="left: {outlineBarPos.x}px; top: {outlineBarPos.y}px"
    >
      <div class="flex flex-wrap items-center gap-1">
        <label class="flex min-h-10 items-center gap-1 px-1 text-xs" title="Line thickness in pixels">
          Thickness
          <NumberField
            class="w-12 text-xs bg-surface border border-border rounded px-1 text-text"
            value={appState.outline.thickness}
            min={1}
            max={MAX_THICKNESS}
            step={1}
            title="Line thickness in pixels"
            ariaLabel="Outline thickness"
            onInput={(v) => {
              appState.outline.thickness = v;
              scheduleOutlinePreview();
            }}
            onCommit={(v) => {
              appState.outline.thickness = v;
              scheduleOutlinePreview();
            }}
          />
        </label>
        <label class="flex min-h-10 items-center gap-1 px-1 text-xs" title="How far the line wanders across the edge">
          Wobble
          <NumberField
            class="w-12 text-xs bg-surface border border-border rounded px-1 text-text"
            value={Math.round(appState.outline.wobble * 100)}
            min={0}
            max={100}
            step={5}
            title="How far the line wanders across the edge"
            ariaLabel="Outline wobble"
            onInput={(v) => {
              appState.outline.wobble = v / 100;
              scheduleOutlinePreview();
            }}
            onCommit={(v) => {
              appState.outline.wobble = v / 100;
              scheduleOutlinePreview();
            }}
          />
        </label>
        <label class="flex min-h-10 items-center gap-1 px-1 text-xs" title="How much the line swells and thins">
          Variation
          <NumberField
            class="w-12 text-xs bg-surface border border-border rounded px-1 text-text"
            value={Math.round(appState.outline.variation * 100)}
            min={0}
            max={100}
            step={5}
            title="How much the line swells and thins"
            ariaLabel="Outline variation"
            onInput={(v) => {
              appState.outline.variation = v / 100;
              scheduleOutlinePreview();
            }}
            onCommit={(v) => {
              appState.outline.variation = v / 100;
              scheduleOutlinePreview();
            }}
          />
        </label>
        <span class="w-px h-6 bg-border mx-0.5"></span>
        <button
          class="ui-bar-btn bg-surface text-text-secondary hover:bg-surface-hover"
          title="Shuffle the randomness"
          aria-label="Shuffle the randomness"
          onpointerdown={(e) => {
            e.preventDefault();
            appState.outline.seed = (appState.outline.seed + 1) | 0;
            scheduleOutlinePreview();
          }}><Dices size={18} /></button
        >
        <span class="w-px h-6 bg-border mx-0.5"></span>
        <button
          class="ui-bar-btn ui-on border-accent"
          title="Apply outline"
          aria-label="Apply outline"
          onpointerdown={(e) => {
            e.preventDefault();
            applyOutline();
          }}><Check size={18} /></button
        >
        <button
          class="ui-bar-btn bg-surface text-text-secondary hover:bg-surface-hover"
          title="Cancel outline"
          aria-label="Cancel outline"
          onpointerdown={(e) => {
            e.preventDefault();
            cancelOutline();
          }}><X size={18} /></button
        >
      </div>
    </div>
  {/if}
```

Import `Dices` from `@lucide/svelte` alongside `Check` and `X`, `NumberField` is already imported, and `MAX_THICKNESS` comes from `../core/outline`.

`appState.version >= 0` in the `{#if}` is the same reactive gate the pose bar uses: `outlineBefore` is a plain local, so the template would not re-evaluate when it changes (this exact bug cost a debugging round on the pose bar — see the 2026-09-24 changelog entry). `enterOutline` ends in `refreshOutlinePreview` → `recomposite`, and `applyOutline`/`cancelOutline` both bump or repaint, so every transition ticks the version.

- [ ] **Step 4: Verify in the browser**

Each field changes the preview as you scrub it; the dice button reshuffles; ✓ and ✗ behave as the keyboard does; the bar sits above the ink and flips below when the ink is near the top of the stage.

- [ ] **Step 5: Build, test, commit**

```bash
npm run build && npx vitest run
git add src/lib/Canvas.svelte
git commit -m "feat(outline): the on-canvas bar, and one anchoring helper for both bars"
```

---

### Task 6: Lifecycle — guards and refusals

**Files:**
- Modify: `src/lib/Canvas.svelte` (`discardActiveEdits`, `bankActiveEdits`, the layer/frame effects)
- Modify: `src/lib/ToolOptions.svelte` (~line 469)

**Interfaces:**
- Consumes: `cancelOutline`, `outlineActive` (Task 4).
- Produces: no new exports.

- [ ] **Step 1: Cancel on every destructive or context-changing event**

In `discardActiveEdits()`, add `if (outlineActive()) cancelOutline();` — undo, redo, resize and project load all route through it, and each would otherwise leave a preview baked with no undo entry behind it.

In `bankActiveEdits()` (layer and frame switches), also **cancel**, not apply:

```ts
    // Outline CANCELS where pose and deform bank. Entering the tool already rewrites every pixel,
    // so banking would mean a stray tap on the tool button plus a frame step silently outlines a
    // drawing. Re-entering costs nothing — the knob values persist.
    if (outlineActive()) cancelOutline();
```

- [ ] **Step 2: Cancel when the layer becomes read-only**

The `$effect` that mirrors visibility onto the overlays (~line 2334) already discards a lift when the layer or its group locks. Add the outline to the same condition:

```ts
    if (
      isLayerLocked(al, appState.project.groups) &&
      (meshPose || selection?.hasFloating || outlineActive())
    )
      discardActiveEdits();
```

- [ ] **Step 3: Say what the tool does in the options bar**

In `src/lib/ToolOptions.svelte` (~line 469), extend the branch:

```svelte
  {:else if appState.tool === "deform" || appState.tool === "pose" || appState.tool === "outline"}
```

and inside it, beside the deform hint:

```svelte
    {#if !paintBlock && appState.tool === "outline"}
      <span class="text-xs text-text-muted"
        >Hollows the drawing to a line · thickness and randomness in the canvas bar</span
      >
    {/if}
```

- [ ] **Step 4: Verify in the browser**

With an outline previewing: switch frame → the drawing is intact and solid. Switch layer → same. Press ⌘Z → no stray undo entry appeared. Lock the layer → the preview reverts. Resize the project → no baked preview.

- [ ] **Step 5: Build, test, commit**

```bash
npm run build && npx vitest run
git add src/lib/Canvas.svelte src/lib/ToolOptions.svelte
git commit -m "feat(outline): lifecycle — cancel on switch, lock, undo and resize"
```

---

### Task 7: Documentation

**Files:**
- Modify: `README.md` (Features bullets, and the test count in the scripts block)
- Modify: `CLAUDE.md` (the test-count line, and "Current state")
- Modify: `docs/superpowers/CHANGELOG.md` (append an entry)

- [ ] **Step 1: README**

Add to the drawing-tools Features list:

```markdown
- **Outline** — turn a solid drawing into an outline of adjustable thickness, with Wobble (the line wanders across the edge) and Variation (it swells and thins); preview live, then Apply as one undo step
```

Update the test count in the scripts block to the number `npx vitest run` actually prints. Run it; do not guess.

- [ ] **Step 2: CLAUDE.md**

Update the `npm test` baseline line to the same number, and add the tool to the "Current state" paragraph's tool list.

- [ ] **Step 3: CHANGELOG entry**

Append a dated entry covering: what shipped, that the field is SIGNED (and why an inside-only field collapses Wobble into Variation), the sub-pixel seeding, that the field is cached per entry so a knob change is one pass, the measured field/band timings from Task 3, and the deliberate cancel-on-switch divergence from Pose and Deform. Link the spec and this plan.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md docs/superpowers/CHANGELOG.md
git commit -m "docs: the outline tool"
```

---

## What this plan deliberately does not build

From the spec's out-of-scope list, so an executor does not add them uninvited: clipping to a selection, apply-to-all-frames, the gaps and grain knobs, a live non-destructive mode, and the brush-stroked variant (approach C). Nothing here forecloses any of them.

## Owed after the plan

An iPad pass, per the project's verification-debt rule: the three `NumberField`s (gotcha #16) sit in a bar inside the stage (gotchas #12 and #18), and the preview's per-frame cost is the thing most likely to feel different on the device than on a desktop.
