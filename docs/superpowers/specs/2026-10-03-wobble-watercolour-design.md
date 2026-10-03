# Wobble and the Watercolour brush — port from slop-paint

Date: 2026-10-03. Source: slop-paint branch `feat/watercolour` (deployed there, not merged to its main):
`f9fb670` (Watercolour), `4d24cde` (Wobble for Smooth / Calligraphy; its resting-tip fix is already
ported here, `a952778`). slop-paint's CLAUDE.md on that branch has the notes (`wobble.ts`,
`watercolor-brush.ts`). The user chose both (2026-10-03) and said to go on without stops.

## Goal

1. **Wobble** for Smooth (`smoothWobble`) and Calligraphy (`nibWobble`), 0 by default, in the brush
   gear: each outline point / ribbon corner moves by 2D value noise of its PAGE position, seeded by
   `strokeSeed` — a drawn part never moves as the stroke grows; Calligraphy's pieces stay joined, and
   its FROZEN ranges (this app's freeze, `2026-10-02`) must still match a full redraw.
2. **Watercolour** (BrushKind `"watercolor"`, menu "Watercolour"): a see-through wash with a darker rim,
   paper grain and an uneven outline; strokes mix as glazes. ONE filled perfect-freehand outline per
   stroke; alpha = coverage × washAlpha(distance inside the edge) × grain; composited `multiply` when
   Mix colours is on (default); alpha lock / draw behind / eraser keep their own ops (eraser: no rim).
   Settings `washEdge` 50, `washGrain` 40, `washWobble` 30, `washMultiply` true; Smooth applies; the
   resting-pen hold (`holdRestPressure`) applies to it as to Smooth. Saved; eraser can use it.

## Design (port the code; adapt the wiring)

- Copy slop-paint's `src/wobble.ts`, `src/watercolor-brush.ts` and their tests at `4d24cde` into
  `src/core/`; `strokeSeed` moves to `wobble.ts` as there, so `src/core/dry-brush.ts` must become
  slop-paint's branch version byte for byte (it stays identical to slop-paint's).
- `src/core/brush.ts` / `calligraphy-brush.ts`: slop-paint's hunks (`outlineOfPath(..., steadySpacing)`,
  wobble hooks). Our calligraphy engine now has the freeze `from` / `to` range (port of `b89284d`) —
  check the wobble keeps a frozen range identical to a full redraw.
- The rim's windowed recompute (only the changed window, padded by the outline's reach and grown by the
  rim width twice; whole stroke under 1.5 widths) needs `distanceToMask` — already in
  `src/core/mask-ops.ts`. Grain pinned to the cell's device pixels (= document pixels here, DPR 1).
- Wiring in `src/lib/Canvas.svelte` `paintStroke`: a full-redraw branch like Ink / Dry for
  `"watercolor"`, the stamp-reset exclusion, `holdRestPressure` + Smooth's path averaging for it.
  Watercolour is NOT frozen (translucent by nature). UI rows in `src/lib/ToolOptions.svelte` like the
  other brushes'; defaults on brush AND eraser in `appState`; preferences merge.
- Pitfalls slop-paint found (keep them fixed): perfect-freehand's decimation spacing following the
  thinnest width so far (use the settings' thinnest: `steadySpacing`), and clipping the coverage fill to
  the window (antialiasing ticks). Dev flag `window.slopWashFull` (whole-stroke recompute) to compare.

## Testing

slop-paint's tests (failing first); `npm test`; build 0/0; a browser look (WebKit) at Watercolour light /
heavy / crossing strokes, Mix on / off, and Wobble 0 vs 50 on Smooth and Calligraphy — screenshots read;
Calligraphy freeze on vs off with Wobble on (pixel diff as the freeze check did); the windowed rim vs
`slopWashFull` (only a few hundred edge px within ~13% alpha); per-frame timing of a long wide
Watercolour stroke; a `test:ipad` check for Watercolour (paints, translucent, crossing darker under
multiply) broken on purpose to fail.
