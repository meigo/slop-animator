# Stream as a rope, Smooth smooths the path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port slop-paint's rope Stream and path-averaging Smooth (with optional Sharp corners) into this app.

**Architecture:** A new pure module `src/core/stroke-smoothing.ts` (verbatim from slop-paint). `input.ts` runs the rope in screen space; `Canvas.svelte` `paintStroke` averages the Smooth brush's path in document space before the cell-space inverse mapping; `brush.ts` fixes perfect-freehand's outline spacing.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest (node).

**Spec:** `docs/superpowers/specs/2026-09-29-stream-smooth-port-design.md`

## Global Constraints

- `npm run build` 0 errors, 0 warnings; `npm test` all passing.
- `InputPoint.hasPressure` is REQUIRED in this app (optional in slop-paint): every point built in new code carries it.
- Keep `isStageChromeTarget`, Pencil double-tap, `pointercancel`/`lostpointercapture` handling in `input.ts`.
- `sharpCorners` defaults `false`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Stream 0 (and every non-brush tool, whose getter returns 0) must behave exactly as before: rope length 0 → `ropeStep` returns the pen → every event adds a point. Covered by the `ropeStep` "no string" test.
- A tap (down + up, no move) still produces a one-point-then-lift stroke and the Pencil double-tap still fires — nothing in the rope path touches the tap bookkeeping. Browser check.
- Stroke on a scaled/rotated layer: Smooth radius is applied before `inverseChain`, so the smoothing distance on screen is unchanged. Browser check.
- Tool branches (pose/deform/outline/select) that key off `points.length === 1 && !done` still get exactly one such call per press. Guaranteed by the "only call onStroke when a point was added" guard.
- Interpolated gap points must carry `hasPressure` (TS enforces).

---

### Task 1: `stroke-smoothing.ts` + tests

**Files:**
- Create: `src/core/stroke-smoothing.ts` — copy of slop-paint `src/stroke-smoothing.ts` @ `4064b59`, import changed to `import type { InputPoint } from "./input";`
- Test: `src/__tests__/stroke-smoothing.test.ts` — copy of slop-paint `src/__tests__/stroke-smoothing.test.ts`, import path `../core/stroke-smoothing`, and every fixture point gets `hasPressure: true` (the `wobble`, straight-line, uneven-spacing, `lStroke` and `gap` fixtures).

**Produces:** `ropeLength(v)`, `ropeStep(brush, pen, length)`, `ropeCatchUp(brush, pen, dtMs)`, `pathSmoothRadius(smoothing, zoom)`, `pauseBreaks(points, stillDist, pauseMs?)`, `smoothPath(points, radius, sharpCorners?)`, constants `PAUSE_MS`, `STILL_PX`, `CATCH_UP_MS`, `ROPE_MAX_PX`, `SMOOTH_MAX_PX`.

- [ ] Copy the test file first; run `npx vitest run src/__tests__/stroke-smoothing.test.ts` → FAIL (module missing).
- [ ] Copy the module; rerun → PASS.
- [ ] Commit `feat: stroke-smoothing module (rope, path smoothing) from slop-paint`.

### Task 2: Stream as a rope in `input.ts`

**Files:** Modify `src/core/input.ts`.

**Consumes:** `PAUSE_MS`, `STILL_PX`, `ropeCatchUp`, `ropeLength`, `ropeStep`.

- [ ] Replace `getStreamlineT`/`lastStreamlined` with `getRopeLength()` (= `ropeLength(v)`), `rope`, `penEvent`, `stillAt`, `stillSince`, `catchUpFrame`, `lastTick` exactly as slop-paint `src/input.ts` @ `4064b59`.
- [ ] `getPoint(e, cx = e.clientX, cy = e.clientY)` maps `(cx, cy)`; keeps `hasPressure`.
- [ ] `addPoint(pt)` helper holding the existing 4 px gap interpolation (interpolated points keep `hasPressure: pt.hasPressure`).
- [ ] `onPointerDown`: after the existing guards and `first`, set rope/penEvent/stillAt/stillSince/lastTick and start `requestAnimationFrame(catchUp)`. Keep the pen-tap bookkeeping.
- [ ] `onPointerMove`: keep the tap-movement tracking; per coalesced event do the pause snap, `ropeStep`, `addPoint`; call `onStroke` only if `currentPoints.length` changed.
- [ ] `catchUp(now)` as slop-paint.
- [ ] `onPointerUp`: clear rope/penEvent, `cancelAnimationFrame(catchUpFrame)`, push the lift point with the last point's pressure (when there is one), then the existing double-tap check.
- [ ] Update the `streamline` doc comment. `npm test` + `npx svelte-check` clean. Commit `feat: Stream is a rope — same strength at any pointer rate, corners kept on a pause`.

### Task 3: Smooth averages the path; Sharp corners; docs

**Files:** Modify `src/core/brush.ts`, `src/lib/Canvas.svelte` (`paintStroke`), `src/state/appState.svelte.ts` (defaults), `src/lib/ToolOptions.svelte`, `README.md`, `CLAUDE.md`, `docs/superpowers/CHANGELOG.md`.

**Consumes:** `smoothPath`, `pathSmoothRadius`.

- [ ] `brush.ts`: add `sharpCorners?: boolean` to `BrushSettings` (doc comment); add `const OUTLINE_SPACING = 0.5;` and pass `decimationSmoothing(OUTLINE_SPACING, minStrokeWidth, pfSize)`; `smoothing`'s doc comment says it is read by `Canvas.svelte` (path radius), not here.
- [ ] `appState.svelte.ts`: `sharpCorners: false` in `brush` and `eraser` defaults.
- [ ] `Canvas.svelte` `paintStroke`: before the `inverseChain` mapping,
  ```ts
  const stroke0 = asEraser ? appState.eraser : appState.brush;
  if (stroke0.brushType === "smooth" && viewport)
    pts = smoothPath(pts, pathSmoothRadius(stroke0.smoothing, viewport.zoom), stroke0.sharpCorners ?? false);
  ```
  (reuse the existing `stroke` const by moving it up rather than adding a second one).
- [ ] `ToolOptions.svelte`: new tooltips on Stream/Smooth; a "Sharp corners" checkbox after Smooth inside `{#if smoothOnly}`.
- [ ] README Features/test count; CLAUDE.md roadmap (1) marked shipped + the port note gains `2b7f465` (folded in) and `72564fa` (opacity slider, unmeasured); CHANGELOG entry.
- [ ] `npm test`, `npm run build` clean. Commit `feat: Smooth smooths the path, with optional Sharp corners`.
