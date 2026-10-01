# Freeze the settled part of long opaque Ink and Calligraphy strokes — port from slop-paint

Date: 2026-10-02. Source: slop-paint `b89284d` (merged `1a05069`), confirmed on the iPad there.
Requested by the slop-paint session; the user said to go ahead without approval stops.

## Problem

Ink and Calligraphy redraw the whole stroke every frame (a piecewise draw would composite edge
pixels many times and harden them), so a frame costs more the longer the stroke. Measured here
(WebKit, Mac, 1920×1080, 2026-10-02): Ink 14 ms (size 12) / 45 ms (size 40) per frame at 4800
points (~20 s of Pencil), Calligraphy 7 / 14 ms; an iPad is slower.

## Goal

1. A long OPAQUE Ink or Calligraphy stroke costs about the same per frame at any length.
2. The result is the same pixels as the full redraw, up to antialiased edge pixels where the stroke
   overlaps itself (slop-paint: ~1000 pixels of a heavily self-overlapping scribble).
3. Translucent strokes, Smooth, Dry and the stamp brushes are unchanged.

## Design

- **Engines** (`src/core/ink-brush.ts`, `src/core/calligraphy-brush.ts`): slop-paint's patch, as is
  (our files equal its pre-change ones but for three comments). `drawInkStroke` /
  `drawCalligraphyStroke` take optional `from` / `to` input-point indices and draw only that range,
  with the geometry worked out over the whole stroke. Ink: `strokeRuns` intersects each run with
  [from, to). Calligraphy: `decimateIndices` keeps each sample's input index; a piece is drawn if its
  start index is in range, the dab only when `from === 0`.
- **Canvas.svelte** — differs from slop-paint where this app differs: each frame restores from
  `beforeSnapshot` (ImageData), which is ALSO the undo step's "before", so it must stay untouched.
  The frozen part goes into a separate `frozenCanvas` (document-sized, `willReadFrequently`), made
  at the first freeze from `beforeSnapshot`; once it exists, the Ink / Calligraphy branches restore
  from it (`copy` composite, identity transform) instead of `putImageData(beforeSnapshot)`.
  Every `FREEZE_STEP` (300) points, the part at least 2 × the widest width + 30 px of path and 40
  points behind the pen is drawn into `frozenCanvas` (stroke transform `DPR`, selection clip) from
  `frozenTo - FREEZE_OVERLAP` (8) to it; each frame then draws from `frozenTo - 8`. Only when
  opacity ≥ 100 and the kind is Ink or Calligraphy, and not when the dev-only
  `window.slopNoFreeze` is set (same name as slop-paint). `frozenTo` / `frozenCanvas` reset at stroke
  start, commit and discard (undo and discard still use `beforeSnapshot`).
- Onion skins, boil and undo read finished cells / `beforeSnapshot`: unaffected.

## Testing

- Engines: no unit tests (they need a canvas) — as in slop-paint.
- Browser: the same long scribble (Ink and Calligraphy, opaque, a few thousand points) with
  `slopNoFreeze` on and off; diff the cell pixels (expect only a small number of edge pixels) and
  time the last frames (expect flat). Translucent: identical either way (not frozen).
- `npm test`, build 0/0, `test:ipad`.
