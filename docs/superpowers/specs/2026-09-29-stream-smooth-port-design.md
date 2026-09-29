# Stream as a rope, Smooth smooths the path — port from slop-paint

Date: 2026-09-29. Source: slop-paint `0ad830e`, `c13ed06`, `2b7f465` (its `src/stroke-smoothing.ts`,
`src/input.ts`, `src/brush.ts`). Roadmap item "Port from slop-paint (1)" in `CLAUDE.md`.

## Problem

- **Stream** (`src/core/input.ts`) is a per-EVENT average: each point moves `t = 1 − 0.88v` of the
  way toward the pen. Its strength therefore depends on the pointer rate; at 100% a 240 Hz Pencil
  keeps 1.9 of a 3 px wobble. The iPad, where the app is used most, gets the weakest Stream.
- **Smooth** (`src/core/brush.ts`) is passed to perfect-freehand's `smoothing`, which is only the
  outline point spacing, and `decimationSmoothing` caps it at the stroke's thinnest width
  (≤ 22% has any effect at Press 3). Most of the slider does nothing.

## Goal / success criteria

1. Stream at 100% keeps a 3 px wobble off the line at any pointer rate and any zoom.
2. Smooth visibly changes the line across its whole range, with no lag; a stroke still starts and
   ends exactly where it was drawn.
3. A corner where the pen pauses stays a corner (Stream always; Smooth when "Sharp corners" is on).
4. Nothing else about stroke input changes: coalesced events, the 4 px gap interpolation, the
   Pencil double-tap, `pointercancel`/`lostpointercapture` ending the stroke, Stream = 0 on non-brush
   tools.

## Design

### 1. `src/core/stroke-smoothing.ts` (new, pure)

Copied from slop-paint unchanged apart from the import path:

- `ropeLength(v)` — Stream 0–1 → string length in SCREEN px, `40 · v²` (50% = 10 px).
- `ropeStep(brush, pen, length)` — returns `brush` itself (same object) while the string is slack,
  else the point pulled along so it is exactly `length` behind the pen.
- `ropeCatchUp(brush, pen, dtMs)` — exponential glide (τ = 25 ms) toward a pausing pen, snapped
  when under 0.5 px.
- `pathSmoothRadius(smoothing, zoom)` — Smooth 0–100 → averaging radius in DOCUMENT px,
  `32 · s / zoom`, so it means the same screen distance at any zoom.
- `pauseBreaks(points, stillDist, pauseMs = 50)` — indices where the pen stayed within
  `stillDist` for ≥ 50 ms (from timestamps).
- `smoothPath(points, radius, sharpCorners = false)` — Gaussian-weighted average of position and
  pressure over ±`radius` of arc length, window narrowed toward each end (ends stay put); with
  `sharpCorners`, done leg by leg between `pauseBreaks(points, radius / 8)`.
- Constants `PAUSE_MS = 50`, `STILL_PX = 3`, `CATCH_UP_MS = 25`, `ROPE_MAX_PX = 40`,
  `SMOOTH_MAX_PX = 32`.

`smoothPath` returns points with `{...points[i], x, y, pressure}`, so this app's extra
`hasPressure` field survives.

### 2. `src/core/input.ts` — Stream becomes the rope

Same structure as slop-paint's `input.ts` after `2b7f465`:

- The rope's brush end lives in CLIENT px (screen space, so rotation/zoom don't change it).
  `getPoint(e, cx, cy)` maps an arbitrary client position through `transformCoords`.
- `pointerdown`: rope = pen; start the corner state (`stillAt`, `stillSince`, `penEvent`) and a
  `requestAnimationFrame` `catchUp` loop (a still pen sends no events).
- `pointermove`, per coalesced event: if the pen moved > `STILL_PX` from `stillAt`, and it had
  been still ≥ `PAUSE_MS`, first snap the rope to `stillAt` and add that point stamped with
  `stillSince` (so the corner is kept even when frames were late); then reset `stillAt`. Then
  `ropeStep`; a slack rope adds no point. The gap interpolation moves into an `addPoint` helper.
- **`onStroke` is called only if the move added a point** (`2b7f465`). This app's brush path
  snapshots once per stroke (`if (!strokeCanvas)`), so the undo-leaves-a-dot bug does not occur
  here, but the Pose/Deform/Outline branches treat `points.length === 1 && !done` as "enter"; the
  guard keeps one-point calls meaning "stroke start" only.
- `catchUp(now)`: while pausing ≥ `PAUSE_MS`, `ropeCatchUp` toward `stillAt`, add the point, call
  `onStroke`.
- `pointerup`/cancel/lost capture: cancel the frame loop, and the stroke ends AT THE PEN (the lift
  point is pushed with the last move's pressure — pen `pointerup` reports pressure 0).
- **Kept, unlike slop-paint:** `isStageChromeTarget`, the Pencil double-tap detection
  (`onPencilDoubleTap`), `hasPressure` on every point, the `contextmenu` cleanup.

The `streamline` getter in `Canvas.svelte` is unchanged (0 on non-brush tools → `ropeLength(0) = 0`
→ the rope follows the pen exactly).

### 3. Smooth — averaged in DOCUMENT space (differs from slop-paint)

slop-paint smooths inside `strokeOutline`. Here strokes are mapped into cell space through
group ∘ layer ∘ cell (`Canvas.svelte` `paintStroke`, `inverseChain`), so a radius computed from the
viewport zoom would be wrong on a scaled layer. Instead `paintStroke` smooths `pts` (document
space) BEFORE the inverse mapping, only when `kind === "smooth"`:

```ts
radius = pathSmoothRadius(stroke.smoothing, viewport.zoom)
pts = smoothPath(pts, radius, stroke.sharpCorners ?? false)
```

`brush.ts` stops reading `settings.smoothing`: perfect-freehand's `smoothing` gets a fixed
`OUTLINE_SPACING = 0.5` (the old default), still through `decimationSmoothing`. The ink,
calligraphy and stamp engines never read Smooth, as before.

Every redraw re-smooths the full path from the raw points (the smooth engine already redraws the
whole stroke from `beforeSnapshot` each frame), so there is no lag; the tip settles as the stroke
grows past it. Cost: O(n·w) per frame for a stroke of n points; slop-paint ships the same.

### 4. "Sharp corners where you pause" setting

`BrushSettings.sharpCorners?: boolean`; defaults `false` in both `state.brush` and `state.eraser`.
A checkbox under Smooth in the brush-settings popover (`ToolOptions.svelte`, inside
`{#if smoothOnly}`). Persisted automatically: `gatherPreferences` spreads the whole tool settings
object and `applyPreferences` spreads it back.

### 5. Copy and docs

- Tooltips: Stream — "the line trails the pen on a string, so small wobbles never reach it; it
  catches up when you lift"; Smooth — "rounds out wobble in the stroke's path, with no lag (the
  tip settles as you draw)"; Sharp corners — "keep a corner sharp where the pen paused".
- README Features line for brushes; test count.
- CLAUDE.md: mark roadmap (1) shipped, add a CHANGELOG entry, and add to the port note the two
  slop-paint commits it lacked: `2b7f465` (folded into this port) and `72564fa` (layer opacity
  slider rebuilds the layer list per step — unmeasured here, noted for later).

## Not changing

- Saved Stream/Smooth values keep their numbers (50 now = a 10 px string). slop-paint did not
  migrate either.
- Stream stays applied to every brush engine and the eraser; Smooth stays Smooth-brush-only.

## Testing

- Port slop-paint's `stroke-smoothing.test.ts` (rope length/step/catch-up, radius, pause breaks,
  smoothPath: ends pinned, straight line unchanged, wobble reduced, sharp corners kept, extra
  fields preserved).
- `input.ts` is DOM-bound and not node-tested here; verified by build + review + a browser pass.
- `npm test` and `npm run build` (0 errors, 0 warnings).
- **Owed: an iPad Pencil pass on a deploy** — the feel (rope length, corner catch-up, Smooth
  range) cannot be judged on desktop.
