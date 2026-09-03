# Calligraphic Brush Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a calligraphy brush type — a stamped nib that is non-uniformly scaled (elliptical) and
held at a fixed rotation — as a 6th `brushType` option alongside Smooth/Ink/Pencil/Charcoal/Airbrush.

**Architecture:** Extends the existing stamp-brush engine (`stamp-brush.ts`/`brush-textures.ts`)
rather than adding a new tool or a new engine. The tip's shape (flatness) is baked into a cached
bitmap the same way color-tinting already is; the nib's fixed angle is applied as a per-stamp
`ctx.rotate()`, never baked — so only a flatness change triggers a rebake, never an angle change.

**Tech Stack:** TypeScript, Svelte 5 (runes), Canvas 2D, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-03-calligraphic-brush-design.md`

## Global Constraints

- Build bar is **0 errors, 0 warnings** (`npm run build` = `svelte-check && tsc --noEmit && vite build`)
  — every task must leave this clean.
- **One commit per task**, per this project's workflow (`CLAUDE.md`).
- Commit messages end with:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QbwFuq4R28yCV1FZDnr6dW
  ```
  (this supersedes the `Co-Authored-By: Grok <noreply@x.ai>` trailer `CLAUDE.md` otherwise documents
  — use the one above for this plan's commits).
- **Angle is NEVER baked into the tip bitmap.** It is always applied as a per-stamp `ctx.rotate()` in
  `stamp-brush.ts`. Only `flatness` (and color, as today) may trigger a tinted-tip cache rebake.
- **The nib's long axis always equals the tip's full radius; flatness only shrinks the short axis.**
  This is what keeps the ellipse inside the existing `TIP_SIZE` square canvas at every rotation angle
  with no extra padding — do not grow the long axis or the canvas size.
- `nibAngle`/`nibFlatness` ride the existing `ToolSettings` → `gatherPreferences`/`applyPreferences`
  spread-merge (`src/state/appState.svelte.ts`). Do not add separate persistence code for them.
- Calligraphy must be selectable for **both** Brush and Eraser through the existing shared
  `brushType` `<select>` in `ToolOptions.svelte` — no special-casing to exclude it from the eraser.
- Canvas/DOM code in this codebase is not Vitest-testable (node env, no DOM/Canvas) — only pure
  logic gets unit tests; canvas-touching and Svelte-markup changes are verified via `npm run build`
  plus a manual `npm run dev` check, per this project's established convention.

---

### Task 1: Calligraphy nib geometry (pure, TDD)

**Files:**
- Create: `src/__tests__/brush-textures.test.ts`
- Modify: `src/core/brush-textures.ts` (add after the `getCachedTip` helper, i.e. after its closing
  brace at line 23, before `hardRoundTip`)

**Interfaces:**
- Produces: `MAX_NIB_FLATNESS: number` (constant), `clampNibFlatness(flatness: number): number`,
  `nibSemiAxes(radius: number, flatness: number): { a: number; b: number }` — all exported from
  `src/core/brush-textures.ts`. Task 2 uses these to draw the tip; Task 5 uses `MAX_NIB_FLATNESS` for
  the UI slider's `max`; Task 6 uses `nibSemiAxes` to size the on-canvas cursor ellipse.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/brush-textures.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nibSemiAxes, clampNibFlatness, MAX_NIB_FLATNESS } from "../core/brush-textures";

describe("clampNibFlatness", () => {
  it("passes through values already in range", () => {
    expect(clampNibFlatness(0)).toBe(0);
    expect(clampNibFlatness(0.5)).toBe(0.5);
  });

  it("clamps below 0 up to 0", () => {
    expect(clampNibFlatness(-1)).toBe(0);
  });

  it("clamps above MAX_NIB_FLATNESS down to it", () => {
    expect(clampNibFlatness(1)).toBe(MAX_NIB_FLATNESS);
    expect(clampNibFlatness(100)).toBe(MAX_NIB_FLATNESS);
  });
});

describe("nibSemiAxes", () => {
  it("at flatness 0 the short axis equals the long axis (a circle)", () => {
    const { a, b } = nibSemiAxes(10, 0);
    expect(a).toBe(10);
    expect(b).toBe(10);
  });

  it("the long axis is always the full radius, regardless of flatness", () => {
    for (const f of [0, 0.35, 0.9, 1, 5]) {
      expect(nibSemiAxes(10, f).a).toBe(10);
    }
  });

  it("the short axis shrinks as flatness rises, but never reaches zero", () => {
    expect(nibSemiAxes(10, 0.5).b).toBeCloseTo(5, 6);
    expect(nibSemiAxes(10, MAX_NIB_FLATNESS).b).toBeCloseTo(1, 6);
    expect(nibSemiAxes(10, 0.9).b).toBeGreaterThan(0);
  });

  it("clamps an out-of-range flatness the same way clampNibFlatness does", () => {
    expect(nibSemiAxes(10, 1).b).toBeCloseTo(nibSemiAxes(10, MAX_NIB_FLATNESS).b, 6);
    expect(nibSemiAxes(10, -1).b).toBe(10);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- brush-textures`
Expected: FAIL — `nibSemiAxes`/`clampNibFlatness`/`MAX_NIB_FLATNESS` are not exported yet (import
error or undefined).

- [ ] **Step 3: Implement the minimal code**

In `src/core/brush-textures.ts`, insert after the `getCachedTip` function (after its closing `}` at
line 23), before `hardRoundTip`:

```ts
/** The calligraphic nib never gets flatter than this — 1.0 would collapse its short axis to
 *  zero, which either draws nothing or divides by zero downstream. */
export const MAX_NIB_FLATNESS = 0.9;

export function clampNibFlatness(flatness: number): number {
  return Math.max(0, Math.min(MAX_NIB_FLATNESS, flatness));
}

/** Semi-axes of the calligraphy nib for a tip of the given radius. The long axis (`a`) is
 *  always the tip's full radius — so flatness 0 is pixel-identical to the round tip, and a
 *  rotated ellipse never exceeds the tip's own bounding square. The short axis (`b`) shrinks
 *  toward (but never reaches) 0 as flatness approaches 1. Shared by the tip generator (bakes
 *  the ellipse) and BrushCursor (previews it), so the two can never disagree about the nib's
 *  shape. */
export function nibSemiAxes(radius: number, flatness: number): { a: number; b: number } {
  const f = clampNibFlatness(flatness);
  return { a: radius, b: radius * (1 - f) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- brush-textures`
Expected: PASS, all cases green.

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/core/brush-textures.ts src/__tests__/brush-textures.test.ts
git commit -m "$(cat <<'EOF'
feat: add calligraphy nib geometry (nibSemiAxes, clampNibFlatness)

Pure geometry shared by the tip generator and the brush cursor —
long axis always the tip's full radius, short axis shrinks with
flatness, clamped so it never collapses to zero.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QbwFuq4R28yCV1FZDnr6dW
EOF
)"
```

---

### Task 2: Calligraphy tip texture + `BrushType`

**Files:**
- Modify: `src/core/brush-textures.ts:129-144`

**Interfaces:**
- Consumes: `nibSemiAxes` (Task 1, same file, no import needed).
- Produces: `BrushType` now includes `"calligraphy"`; `getTip(type: BrushType, flatness?: number):
  HTMLCanvasElement` — the `flatness` param is new and optional (default `0`), so the one existing
  caller (`stamp-brush.ts`'s `getTintedTip`, still calling `getTip(type)` with one arg until Task 3)
  keeps compiling unchanged. Task 3 passes a real `flatness` through.

No automated test for this task — it only touches `HTMLCanvasElement` drawing, which Vitest's node
environment can't render. Visual correctness (does it actually look like a nib?) is verified once
Task 5 makes it selectable from the UI; this task's gate is the type-check/build.

- [ ] **Step 1: Replace the `BrushType` union and `getTip`, and add `calligraphyTip`**

In `src/core/brush-textures.ts`, replace (currently lines 129–144):

```ts
export type BrushType = "smooth" | "pencil" | "charcoal" | "airbrush";

export function getTip(type: BrushType): HTMLCanvasElement {
  switch (type) {
    case "smooth":
      return hardRoundTip();
    case "pencil":
      return pencilTip();
    case "charcoal":
      return charcoalTip();
    case "airbrush":
      return airbrushTip();
    default:
      return softRoundTip();
  }
}
```

with:

```ts
export type BrushType = "smooth" | "pencil" | "charcoal" | "airbrush" | "calligraphy";

/** Calligraphy nib — a crisp (non-textured) ellipse, unrotated. Reuses hardRoundTip's
 *  gradient-based antialiased edge by drawing that same circle through a vertical `ctx.scale`
 *  — so at flatness 0 this is pixel-identical to hardRoundTip. Rotation is deliberately NOT
 *  baked here: it is applied per stamp in stamp-brush.ts, so this bitmap only ever varies by
 *  flatness (see the design spec and this file's `nibSemiAxes`). */
function calligraphyTip(flatness: number): HTMLCanvasElement {
  const f = clampNibFlatness(flatness);
  return getCachedTip(`calligraphy:${f}`, (ctx, s) => {
    const r = s / 2;
    const { a, b } = nibSemiAxes(r, f);
    ctx.save();
    ctx.translate(r, r);
    ctx.scale(1, b / a);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(0.85, "rgba(0,0,0,1)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(-r, -r, s, s);
    ctx.restore();
  });
}

export function getTip(type: BrushType, flatness: number = 0): HTMLCanvasElement {
  switch (type) {
    case "smooth":
      return hardRoundTip();
    case "pencil":
      return pencilTip();
    case "charcoal":
      return charcoalTip();
    case "airbrush":
      return airbrushTip();
    case "calligraphy":
      return calligraphyTip(flatness);
    default:
      return softRoundTip();
  }
}
```

- [ ] **Step 2: Run existing tests to confirm nothing broke**

Run: `npm test`
Expected: PASS (this is a type-safe, additive change; no existing test touches `getTip`/`BrushType`
directly other than through `stampFootprint`, which is unaffected).

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add src/core/brush-textures.ts
git commit -m "$(cat <<'EOF'
feat: add calligraphy tip texture and BrushType variant

Unrotated ellipse, baked via a vertical scale on the same
gradient-based circle hardRoundTip already uses, so flatness 0 is
pixel-identical to the round tip. Not yet reachable from the UI.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QbwFuq4R28yCV1FZDnr6dW
EOF
)"
```

---

### Task 3: Stamp engine — rotate the nib per stamp

**Files:**
- Modify: `src/core/brush.ts:47-56` (`BrushSettings` interface)
- Modify: `src/core/stamp-brush.ts:36-63` (tinted-tip cache) and `:96-133`
  (`drawStampStrokeIncremental`'s two draw call sites)

**Interfaces:**
- Consumes: `getTip(type, flatness)` (Task 2).
- Produces: `BrushSettings` gains `nibAngle?: number` and `nibFlatness?: number` (optional, read only
  by the stamp engine for `brushType === "calligraphy"`, ignored everywhere else — same relationship
  `taper?: boolean` already has to the ink/stamp engines). `ToolSettings` (appState) inherits both
  fields automatically via its existing `Omit<BrushSettings, "isEraser"> & {...}` definition — no
  change needed there; Task 4 only adds default *values*. New local helper `stampAt(...)` in
  `stamp-brush.ts` (not exported — internal to the draw loop).

No automated test — this is canvas-drawing glue around the already-tested `stampFootprint`, matching
that file's existing test boundary (`src/__tests__/stamp-brush.test.ts` only covers the pure
`stampFootprint`, never the drawing itself).

- [ ] **Step 1: Add the two new fields to `BrushSettings`**

In `src/core/brush.ts`, replace (currently lines 47–56):

```ts
export interface BrushSettings {
  size: number;
  color: string;
  opacity: number;
  smoothing: number;
  isEraser: boolean;
  drawBehind: boolean;
  alphaLock: boolean;
  taper?: boolean;
}
```

with:

```ts
export interface BrushSettings {
  size: number;
  color: string;
  opacity: number;
  smoothing: number;
  isEraser: boolean;
  drawBehind: boolean;
  alphaLock: boolean;
  taper?: boolean;
  /** Calligraphy nib only — read by stamp-brush.ts's stamp draw call, ignored by every other
   *  engine (same relationship `taper` already has to the ink/stamp engines). */
  nibAngle?: number;
  nibFlatness?: number;
}
```

- [ ] **Step 2: Extend the tinted-tip cache to key on flatness, and add `stampAt`**

In `src/core/stamp-brush.ts`, replace (currently lines 36–63):

```ts
let lastStampCount = 0;
let tintedTip: HTMLCanvasElement | null = null;
let tintedColor = "";
let tintedType: BrushType | null = null;

export function resetStampState() {
  lastStampCount = 0;
  tintedTip = null;
}

function getTintedTip(type: BrushType, color: string): HTMLCanvasElement {
  if (tintedTip && tintedColor === color && tintedType === type) return tintedTip;

  const tip = getTip(type);
  const cvs = document.createElement("canvas");
  cvs.width = tip.width;
  cvs.height = tip.height;
  const ctx = cvs.getContext("2d")!;
  ctx.drawImage(tip, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, cvs.width, cvs.height);

  tintedTip = cvs;
  tintedColor = color;
  tintedType = type;
  return cvs;
}
```

with:

```ts
let lastStampCount = 0;
let tintedTip: HTMLCanvasElement | null = null;
let tintedColor = "";
let tintedType: BrushType | null = null;
let tintedFlatness = 0;

export function resetStampState() {
  lastStampCount = 0;
  tintedTip = null;
}

function getTintedTip(type: BrushType, color: string, flatness: number): HTMLCanvasElement {
  if (
    tintedTip &&
    tintedColor === color &&
    tintedType === type &&
    (type !== "calligraphy" || tintedFlatness === flatness)
  ) {
    return tintedTip;
  }

  const tip = getTip(type, flatness);
  const cvs = document.createElement("canvas");
  cvs.width = tip.width;
  cvs.height = tip.height;
  const ctx = cvs.getContext("2d")!;
  ctx.drawImage(tip, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, cvs.width, cvs.height);

  tintedTip = cvs;
  tintedColor = color;
  tintedType = type;
  tintedFlatness = flatness;
  return cvs;
}

/** Draws one stamp. Every brush type draws it axis-aligned; calligraphy additionally rotates it
 *  by the nib's FIXED angle — never derived from stroke direction (see the design spec) — so the
 *  elongated tip holds a constant orientation while the stroke direction varies around it. That
 *  is the entire calligraphic effect: no other code path needs to know about it. */
function stampAt(
  ctx: CanvasRenderingContext2D,
  tip: HTMLCanvasElement,
  x: number,
  y: number,
  drawSize: number,
  brushType: BrushType,
  nibAngle: number,
) {
  if (brushType !== "calligraphy") {
    ctx.drawImage(tip, x - drawSize / 2, y - drawSize / 2, drawSize, drawSize);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((nibAngle * Math.PI) / 180);
  ctx.drawImage(tip, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
  ctx.restore();
}
```

- [ ] **Step 3: Wire `drawStampStrokeIncremental` through `getTintedTip`/`stampAt`**

Still in `src/core/stamp-brush.ts`:

Replace:
```ts
  const tip = getTintedTip(settings.brushType, settings.color);
```
with:
```ts
  const tip = getTintedTip(settings.brushType, settings.color, settings.nibFlatness ?? 0);
```

Replace (first-point stamp, currently line 106):
```ts
    ctx.drawImage(tip, p.x - drawSize / 2, p.y - drawSize / 2, drawSize, drawSize);
```
with:
```ts
    stampAt(ctx, tip, p.x, p.y, drawSize, settings.brushType, settings.nibAngle ?? 0);
```

Replace (segment loop stamp, currently line 132):
```ts
        ctx.drawImage(tip, x - drawSize / 2, y - drawSize / 2, drawSize, drawSize);
```
with:
```ts
        stampAt(ctx, tip, x, y, drawSize, settings.brushType, settings.nibAngle ?? 0);
```

- [ ] **Step 4: Run existing tests**

Run: `npm test`
Expected: PASS — `stampFootprint`'s own tests are untouched by this change.

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/core/brush.ts src/core/stamp-brush.ts
git commit -m "$(cat <<'EOF'
feat: rotate the calligraphy nib per stamp, cache keyed on flatness

BrushSettings gains nibAngle/nibFlatness (calligraphy-only, ignored
elsewhere, same relationship taper has to ink/stamp). The tinted-tip
cache now keys on flatness too; angle is applied as a per-stamp
ctx.rotate() and never baked, so an angle change costs nothing extra.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QbwFuq4R28yCV1FZDnr6dW
EOF
)"
```

---

### Task 4: Default settings + Canvas dispatch

**Files:**
- Modify: `src/state/appState.svelte.ts:260-271` (brush init) and `:272-283` (eraser init)
- Modify: `src/lib/Canvas.svelte:672-680` (`paintStroke`'s `settings` object)

**Interfaces:**
- Consumes: `BrushSettings.nibAngle`/`nibFlatness` (Task 3).
- Produces: `state.brush`/`state.eraser` now carry real `nibAngle`/`nibFlatness` values at runtime;
  `Canvas.svelte`'s `paintStroke` now forwards them into the object it passes to
  `drawStampStrokeIncremental`. No UI to reach this yet — verified by build/tests only; the visual
  check happens once Task 5 makes the brush type selectable.

- [ ] **Step 1: Add default values to both `ToolSettings` init objects**

In `src/state/appState.svelte.ts`, replace (currently lines 260–271):

```ts
  brush: {
    size: 4,
    color: "#1a1a1a",
    opacity: 100,
    smoothing: 50,
    drawBehind: false,
    alphaLock: false,
    taper: false,
    sizeRange: 3.0, // full pen pressure → 3× the base width (light pressure → base)
    streamline: 50,
    brushType: "smooth",
  },
  eraser: {
    size: 8,
    color: "#000000", // unused (eraser composites destination-out)
    opacity: 100,
    smoothing: 50,
    drawBehind: false,
    alphaLock: false,
    taper: false,
    sizeRange: 3.0,
    streamline: 50,
    brushType: "smooth",
  },
```

with:

```ts
  brush: {
    size: 4,
    color: "#1a1a1a",
    opacity: 100,
    smoothing: 50,
    drawBehind: false,
    alphaLock: false,
    taper: false,
    sizeRange: 3.0, // full pen pressure → 3× the base width (light pressure → base)
    streamline: 50,
    brushType: "smooth",
    nibAngle: 45,
    nibFlatness: 0.35,
  },
  eraser: {
    size: 8,
    color: "#000000", // unused (eraser composites destination-out)
    opacity: 100,
    smoothing: 50,
    drawBehind: false,
    alphaLock: false,
    taper: false,
    sizeRange: 3.0,
    streamline: 50,
    brushType: "smooth",
    nibAngle: 45,
    nibFlatness: 0.35,
  },
```

- [ ] **Step 2: Forward the new fields through `Canvas.svelte`'s stroke settings**

In `src/lib/Canvas.svelte`, replace (currently lines 672–680):

```ts
    const settings = {
      size: stroke.size,
      color: stroke.color,
      opacity: stroke.opacity,
      smoothing: stroke.smoothing,
      drawBehind: stroke.drawBehind,
      alphaLock: stroke.alphaLock,
      taper: stroke.taper,
      isEraser: appState.tool === "eraser",
    };
```

with:

```ts
    const settings = {
      size: stroke.size,
      color: stroke.color,
      opacity: stroke.opacity,
      smoothing: stroke.smoothing,
      drawBehind: stroke.drawBehind,
      alphaLock: stroke.alphaLock,
      taper: stroke.taper,
      nibAngle: stroke.nibAngle,
      nibFlatness: stroke.nibFlatness,
      isEraser: appState.tool === "eraser",
    };
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/state/appState.svelte.ts src/lib/Canvas.svelte
git commit -m "$(cat <<'EOF'
feat: default nib angle/flatness and forward them through paintStroke

Brush and eraser ToolSettings both default to a 45deg/0.35 nib.
Not yet reachable — no UI offers "calligraphy" as a brush type yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QbwFuq4R28yCV1FZDnr6dW
EOF
)"
```

---

### Task 5: ToolOptions UI — brush-type option + Angle/Flatness sliders

**Files:**
- Modify: `src/lib/ToolOptions.svelte` (imports, a derived flag, the `brushType` `<select>`, two new
  sliders)

**Interfaces:**
- Consumes: `MAX_NIB_FLATNESS` (Task 1), `stroke.brushType`/`nibAngle`/`nibFlatness` (Task 4's
  defaults, live via the `$derived` `stroke` binding already in this file).

This is the first task where a human can actually select and use the brush — its own manual
verification is the primary check for the whole feature so far.

- [ ] **Step 1: Import `MAX_NIB_FLATNESS`**

In `src/lib/ToolOptions.svelte`, add alongside the existing `MAX_GAP` import (near line 17):

```ts
import { MAX_NIB_FLATNESS } from "../core/brush-textures";
```

- [ ] **Step 2: Add an `isCalligraphy` derived flag**

Near the existing `smoothOnly` derived (around line 28), add:

```ts
const isCalligraphy = $derived(stroke.brushType === "calligraphy");
```

- [ ] **Step 3: Add the dropdown option**

In the `brushType` `<select>` (currently lines 120–128), add a fifth `<option>` after Airbrush:

```svelte
      <option value="airbrush">Airbrush</option>
      <option value="calligraphy">Calligraphy</option>
    </select>
```

(Replaces the existing `<option value="airbrush">Airbrush</option>\n    </select>` — i.e. insert the
new option between the existing Airbrush option and the closing `</select>`.)

- [ ] **Step 4: Add the Angle and Flatness sliders**

Immediately after the `</select>` (before the Opacity `<label>` that currently follows it), add:

```svelte
    {#if isCalligraphy}
      <label class="flex items-center gap-1 text-xs text-text-secondary" title="Fixed nib angle">
        Angle
        <input type="range" min="0" max="180" step="1" class="w-16" bind:value={stroke.nibAngle} />
        <span class="text-xs text-text-secondary w-8 tabular-nums">{stroke.nibAngle}°</span>
      </label>
      <label
        class="flex items-center gap-1 text-xs text-text-secondary"
        title="How elongated the nib is — 0% is a round tip"
      >
        Flatness
        <input
          type="range"
          min="0"
          max={MAX_NIB_FLATNESS}
          step="0.01"
          class="w-16"
          bind:value={stroke.nibFlatness}
        />
        <span class="text-xs text-text-secondary w-8 tabular-nums"
          >{Math.round(stroke.nibFlatness * 100)}%</span
        >
      </label>
    {/if}
```

(The `tabular-nums` class and reserved-width `w-8` readout span match this codebase's own documented
convention for live counters that update while dragging — CLAUDE.md's "Live-counter jitter" entry —
so the Angle/Flatness numbers don't shift neighboring controls as they change.)

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Manual verification (`npm run dev`)**

- Select the Brush tool, open the brush-type dropdown, confirm "Calligraphy" is listed and selectable.
- Confirm Angle and Flatness sliders appear **only** when Calligraphy is selected, and disappear for
  every other type.
- Confirm Smooth and Taper are still dimmed for Calligraphy (they should be — `smoothOnly` already
  covers every non-"smooth" type, calligraphy included).
- Drag Flatness from 0% up: at 0% the tip should look like a plain round brush; increasing it should
  visibly elongate the stroke into a nib shape.
- Drag Angle and draw strokes in different directions: dragging *along* the nib's long axis should
  lay a thin line, dragging *across* it should lay the full width — the same stroke direction should
  produce a visibly different width depending on the Angle setting.
- Switch to the Eraser tool and confirm "Calligraphy" is selectable there too.
- Confirm the Angle/Flatness numeric readouts don't cause neighboring toolbar controls to shift as
  you drag.
- Drag the Flatness slider continuously (each change rebakes the tinted-tip cache, unlike Angle,
  which is free) and confirm it doesn't feel laggy. If it does, that's the flag from the spec's
  "Open questions" section worth reporting back, not a silent thing to work around.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ToolOptions.svelte
git commit -m "$(cat <<'EOF'
feat: add Calligraphy to the brush-type picker with Angle/Flatness

Two sliders shown only for the calligraphy brush type, matching
this project's live-counter (tabular-nums + reserved width)
convention. Verified in the browser: nib shape, angle-dependent
width, eraser reuse, and dimmed Smooth/Taper all behave correctly.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QbwFuq4R28yCV1FZDnr6dW
EOF
)"
```

---

### Task 6: Calligraphic brush cursor

**Files:**
- Modify: `src/lib/BrushCursor.svelte`

**Interfaces:**
- Consumes: `nibSemiAxes` (Task 1), `activeStroke().brushType`/`nibAngle`/`nibFlatness` (already
  live via Tasks 4–5), `Viewport.rotation` (existing, radians — see `src/core/viewport.ts`).

- [ ] **Step 1: Import `nibSemiAxes`**

In `src/lib/BrushCursor.svelte`, add to the imports:

```ts
import { nibSemiAxes } from "../core/brush-textures";
```

- [ ] **Step 2: Add cursor height/rotation state**

Near the existing `let diameter = $state(0);` (line 20), add:

```ts
let cursorHeight = $state(0);
let cursorRotationDeg = $state(0);
```

- [ ] **Step 3: Compute the ellipse in `tick()`**

Replace (currently lines 64–66):

```ts
  function tick() {
    diameter = activeStroke().size * (getViewport()?.zoom ?? 1);
    dashed = appState.tool === "eraser";
```

with:

```ts
  function tick() {
    const stroke = activeStroke();
    diameter = stroke.size * (getViewport()?.zoom ?? 1);
    dashed = appState.tool === "eraser";
    if (stroke.brushType === "calligraphy") {
      const { b } = nibSemiAxes(diameter / 2, stroke.nibFlatness ?? 0);
      cursorHeight = b * 2;
      // Screen-space rotation must include the canvas's own twist (Viewport.rotation, radians)
      // on top of the nib's fixed angle, or the cursor would lie about paint direction whenever
      // the canvas is rotated — the actual painted stroke is computed in document space and is
      // unaffected by the view transform.
      cursorRotationDeg = (stroke.nibAngle ?? 0) + ((getViewport()?.rotation ?? 0) * 180) / Math.PI;
    } else {
      cursorHeight = diameter;
      cursorRotationDeg = 0;
    }
```

- [ ] **Step 4: Rotate and reshape the cursor element**

Replace (currently line 89–92):

```svelte
  <div
    class="brush-cursor"
    class:dashed
    style="transform: translate({x}px, {y}px) translate(-50%, -50%); width: {diameter}px; height: {diameter}px;"
  ></div>
```

with:

```svelte
  <div
    class="brush-cursor"
    class:dashed
    style="transform: translate({x}px, {y}px) rotate({cursorRotationDeg}deg) translate(-50%, -50%); width: {diameter}px; height: {cursorHeight}px;"
  ></div>
```

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Manual verification (`npm run dev`)**

- Select Calligraphy: the cursor should render as an ellipse (not a circle) once Flatness > 0, sized
  and oriented to match the Angle/Flatness sliders.
- Drag the Angle slider and confirm the cursor **rotates in place around its own center** — it must
  not drift or orbit around the pointer position as the angle changes. If it orbits instead of
  spinning in place, the `rotate()` needs to move earlier in the `transform:` chain (before the
  `-50%,-50%` translate) — fix and re-verify before moving on.
- Confirm every other brush type's cursor is an unchanged plain circle (regression check).
- If a canvas-rotate gesture is available on your platform, rotate the canvas and confirm the
  cursor's on-screen orientation still visually matches the direction ink will actually lay down
  thick vs. thin.

- [ ] **Step 7: Commit**

```bash
git add src/lib/BrushCursor.svelte
git commit -m "$(cat <<'EOF'
feat: render the calligraphy brush cursor as a rotated ellipse

Matches the nib's Angle/Flatness settings, compensated for the
canvas's own rotation (Viewport.rotation) so the on-screen preview
never lies about paint direction. Every other brush type's circular
cursor is unchanged. Verified in the browser.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QbwFuq4R28yCV1FZDnr6dW
EOF
)"
```

---

## Post-plan: CLAUDE.md entry

Once all 6 tasks are merged, per this project's convention (every feature gets a dated entry), add a
short entry to `CLAUDE.md`'s current-state/changelog area describing what shipped, that it is a stamp
engine variant (not a new tool), that angle is a per-stamp rotation while only flatness is cached, and
flag it as build+review-verified only where true (canvas/DOM work has no Vitest coverage in this
project) versus what was actually eyeballed per Task 5/6's manual verification steps. This plan does
not include that as a numbered task since it's a documentation step the executor should do once the
real, observed behavior (not just the planned behavior) is in hand.
