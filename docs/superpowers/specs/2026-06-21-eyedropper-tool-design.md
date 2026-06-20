# Eyedropper Tool — Design

**Status:** Approved (design phase)
**Date:** 2026-06-21

## Goal

A toolbar eyedropper tool: tap the canvas to sample the color under the pointer (the composited image
you see) and set the brush color to it, then automatically return to the previous tool. While the
tool is active, a small swatch previews the color under the pointer.

## Decisions (from brainstorming)

- **Sample the composited image** (what you see) — read the display canvas, the blend of all visible
  layers + paper background at that point.
- **Auto-return** after one pick (Procreate-style): pick → set color → switch back to the previously
  active tool.
- Picked color goes to **`brush.color`**, **RGB only** (opaque hex; alpha ignored). Eraser has no
  color, unaffected.
- Include a **live hover-swatch preview** while the tool is active.
- **No** native `EyeDropper` API (Chromium-desktop-only; breaks iPad-first), no active-layer-only
  sampling, no multi-pick mode, no alpha.

## Pure helper (`src/core/fill.ts`)

`fill.ts` already has `hexToRgba`; add the inverse next to it (node-testable):
```ts
/** [0..255] r,g,b → "#rrggbb" (lowercase). */
export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
```

## Tool + state (`src/state/appState.svelte.ts`)

- Add `"eyedropper"` to the `Tool` union.
- Add a "remember previous tool" action mirroring the existing `toolBeforeEraser` pattern:
  ```ts
  let toolBeforeEyedropper: Tool = "brush";
  export function selectEyedropper() {
    if (state.tool === "eyedropper") return; // already active → no-op
    toolBeforeEyedropper = state.tool;
    state.tool = "eyedropper";
  }
  /** Set the brush color from a sampled pixel and return to the pre-eyedropper tool. */
  export function applyEyedropper(hex: string) {
    state.brush.color = hex;
    state.tool = toolBeforeEyedropper === "eyedropper" ? "brush" : toolBeforeEyedropper;
  }
  ```
  (Color is a setting, not a document edit — **no undo entry**.)

## Sampling (`src/lib/Canvas.svelte`)

- A helper that reads the composited display pixel at a logical canvas point:
  ```ts
  function sampleAt(p: { x: number; y: number }): string | null {
    const px = Math.round(p.x * DPR), py = Math.round(p.y * DPR);
    if (px < 0 || py < 0 || px >= display.width || py >= display.height) return null;
    const [r, g, b] = displayCtx.getImageData(px, py, 1, 1).data; // opaque composite (bg is filled)
    return rgbToHex(r, g, b);
  }
  ```
  (`displayCtx` always has the current frame composited with the paper bg, so the sample is never
  transparent. Input points arrive in logical doc coords; ×DPR maps to device pixels.)
- In `onStroke`, add an early branch (before the draw/select handling):
  ```ts
  if (state.tool === "eyedropper") {
    if (points.length === 1) {            // act on the gesture's first point (a tap)
      const hex = sampleAt(points[0]);
      if (hex) applyEyedropper(hex);       // sets color + returns to the previous tool
    }
    return;                                // never draws, never pushes undo
  }
  ```
  (Acting on `points.length === 1` fires on pointer-down so the pick + tool-switch is immediate; an
  out-of-bounds tap returns null → no change, tool stays eyedropper so the user can tap again.)

## Live preview (extend `src/lib/BrushCursor.svelte`)

`BrushCursor` already tracks the mouse/pen pointer over the `stage`. Give it an optional sampler so it
can render an eyedropper swatch instead of the stroke ring:
- New prop `sampleColor?: (clientX: number, clientY: number) => string | null` (passed from Canvas;
  Canvas maps client→logical via `viewport.screenToCanvas` then calls `sampleAt`).
- When `appState.tool === "eyedropper"` and visible: render a small **swatch chip** (≈22px, the
  sampled color fill + a light/dark double border + a tiny pointer notch) offset just above-right of
  the pointer, plus the existing center dot for the exact sample point. Recompute the sampled color in
  the rAF `tick` (cheap: one `getImageData(1×1)`), so the swatch updates as you hover.
- When the tool is brush/eraser, behavior is exactly as today (the ring); for any other tool, nothing.

## Cursor (`src/lib/Canvas.svelte`)

The `stage` cursor class becomes: `cursor: none` for brush/eraser (ring shown), `cursor: crosshair`
for the eyedropper (precise sampling, no OS arrow blocking), default otherwise. E.g. two `class:`
bindings (`cursor-none` for stroke tools, `cursor-crosshair` for eyedropper).

## Toolbar (`src/lib/Toolbar.svelte`)

Add an eyedropper tool button (lucide `Pipette`) in the tool group, `title="Eyedropper (sample
color)"`, `class:bg-surface-active={appState.tool === "eyedropper"}`, `onclick={selectEyedropper}`
(import the action). Place it near the brush/eraser buttons.

## Testing

- **Automated (node):** `rgbToHex` in a `fill`-area test — `(0,0,0)→"#000000"`, `(255,255,255)→
  "#ffffff"`, a mid value, and clamping/rounding of out-of-range/fractional inputs. (The existing fill
  test file is the natural home.)
- The tool wiring, sampling (`getImageData`), preview, and cursor are DOM — **build + manual**, no new
  component tests. Existing **209** stay green; build **0/0**; lint clean.

**Manual (browser):**
- Select the eyedropper → cursor is a crosshair, a swatch previews the color under the pointer.
- Tap a drawn area → the brush color becomes that color and the tool returns to the previous one
  (draw immediately with the picked color). Tap blank paper → picks the bg color.
- Tapping outside the canvas does nothing (stays in eyedropper). Finger taps behave as taps (pen/mouse
  show the preview; the swatch follows hover on hover-capable devices).
- Switching to/from the eyedropper doesn't disturb the eraser's separate settings or brush size.

## Out of scope

- Native `EyeDropper` API; active-layer-only sampling; multi-pick/persistent mode; alpha sampling; a
  recent-colors palette (separate feature).

## Self-review notes

- Reuses three established patterns: the `toolBeforeEraser` "remember previous tool" idiom, the
  `fill.ts` pixel-read + hex helpers, and the `BrushCursor` pointer-overlay mount — so the surface is
  small and familiar.
- The only pure logic (`rgbToHex`) is unit-tested; everything else is thin DOM glue verified manually,
  consistent with the rest of the canvas code.
- Sampling the composited display (not a layer) means a pick always yields an opaque, sensible color
  (bg is always filled), avoiding the transparent-pixel edge case.
