# Soft fill edges and a smooth Expand — port from slop-paint

Date: 2026-10-02. Source: slop-paint `main` (`d1e3187`, `ca7277c`, `3e20bd9`, `8034c87`, `c7209d0`, `6cd1fa7`,
`7103ac2`; slop-paint's CLAUDE.md "Fill Tool"). Requested via the slop-paint session; the user asked for
today's slop-paint changes to be ported where they fit. Port the END STATE.

## Problem

The bucket (and Fill enclosed) stops where a soft line's edge passes the colour tolerance: a whole-pixel
staircase with pale gaps inside the line's antialiased edge — most visible on iPad at 1× (this app's DPR).

## Goal

1. A fill against an antialiased line has a smooth edge: the line's own softness places the fill's edge
   between pixels, drawn BEHIND the line; inside the region the fill stays solid.
2. Expand grows the fill by a smooth round offset (true distance), solid to Expand px, fading over
   max(1, 2 × Soft) px, behind the lines. Soft 0 = today's behaviour exactly (whole-pixel `dilateMask`).
3. Fill enclosed behaves the same (region ungrown, grown when painting:
   `fillRegionBehind(ctx, region, color, soft, expand)`).
4. A **Soft** slider in the fill options: 96 px wide, default 1, saved with the fill settings; its value is
   an index into `SOFT_STEPS` (quarters to 2, then 2.5, 3, 4, 5, 6, 8), so 0.5 is easy to hit by finger.

## Design

- `src/core/mask-ops.ts`: slop-paint's `distanceToMask` (exact linear-time Euclidean distance transform).
- `src/core/fill.ts`: slop-paint's `softCoverage`, `expandedCoverage`, `colourDistance`, `SOFT_STEPS`,
  `softStepIndex`, `MAX_SOFT_EDGE`, `SOFT_RANGE_PER_PX`, and the soft paths of `floodFill`,
  `enclosedFillRegion`, `fillRegionBehind`. This app's `fill.ts` has diverged (Fill enclosed wiring, the
  dead `alphaThreshold` option); the implementer decides between adopting slop-paint's file and merging
  its changes, keeping this app's callers (`Canvas.svelte`'s two `floodFill` calls and Fill enclosed)
  working. If slop-paint's end state also brings its bucket **Bridge** (`fillMask`, this app's roadmap 9),
  that is welcome but must be wired deliberately (the existing Gap setting) — or left out with a note.
- Do NOT repeat slop-paint's four failed versions: a feather painted OVER the line (dark halo); filling
  behind to the line's darkest middle (black shows through a see-through grey line); Soft as whole pixels
  behind the line (staircase moves in); Expand in whole pixels before Soft (staircase under the line).
  Any per-pixel rule by STEPS keeps the staircase: use the line's alpha or a true distance.
- UI: `src/lib/ToolOptions.svelte` fill options; `appState.fill.soft` (index or value — store the VALUE,
  map through `softStepIndex` for the slider) with default 1 in the defaults; preferences merge.

## Testing

slop-paint's `fill-soft.test.ts` (+ any mask-ops tests), failing first; a browser comparison at 1× in
WebKit (main vs branch, enlarged screenshots of a fill against a soft line, with and without Expand, and
Fill enclosed); `test:ipad` passing; build 0/0. Cost check on a large canvas (slop-paint: ~0.14 s at 4K).
