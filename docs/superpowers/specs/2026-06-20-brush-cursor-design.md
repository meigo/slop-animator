# Brush / Eraser Cursor — Design

**Status:** Approved (design phase)
**Date:** 2026-06-20

## Goal

Show a size-accurate cursor that follows the pointer over the canvas for the brush and eraser tools —
a circle whose diameter is the current stroke width. The eraser's cursor is visually distinct
(dashed). There is no brush cursor today (just the OS arrow).

## Decisions (from brainstorming)

- **Shape:** brush = solid ring, **eraser = dashed ring** (same circle; strokes are round for both).
- **Size:** nominal diameter = `activeStroke().size × viewport.zoom` (screen px). Pressure-driven width
  and per-layer-transform scale are **not** reflected (known v1 limitations).
- **Visibility:** shown when a **mouse or pen** pointer is over the canvas (covers hover *and*
  tracking during a stroke); hidden on pointer-leave and for **finger** touches; only for the
  **brush/eraser** tools. The OS cursor is hidden (`cursor: none`) while those tools are active.

## Component: `src/lib/BrushCursor.svelte` (new)

A standalone runes component mounted in the Canvas `stage`, mirroring `RefTransformGizmo` (props
`getViewport`/`getContainer`; rendered `pointer-events-none`). It reads `state` (imported as
`appState`, since it uses the `$state` rune) and `activeStroke()` from `appState`.

**State:** `visible`, `x`, `y` (pointer position relative to the container), `diameter`, and `dashed`
(eraser) — all `$state`.

**Pointer tracking** (listeners on the container = the `stage`, attached in `onMount`, removed on
unmount):
- `pointermove` / `pointerover` with `pointerType === "mouse" | "pen"`: compute `x = clientX -
  rect.left`, `y = clientY - rect.top` (via `getContainer().getBoundingClientRect()`), set `visible`.
- `pointerleave` (or a `touch` pointer): `visible = false`.

**Size/zoom sync** (a `requestAnimationFrame` loop, like the gizmo's `tick`): each frame, set
`diameter = activeStroke().size * (getViewport()?.zoom ?? 1)` and `dashed = appState.tool ===
"eraser"`. This keeps the circle correct when the brush size *or* the zoom changes without a pointer
move. The loop is cheap (a couple of `$state` writes per frame) and only the circle re-renders.

**Render gate:** the circle shows only when `visible && (appState.tool === "brush" || appState.tool
=== "eraser")`.

**Markup:** an absolutely-positioned circle, centered on the pointer via
`transform: translate({x}px, {y}px) translate(-50%, -50%)`, `width/height = {diameter}px`. Contrast on
any background via a **double outline**: a `1.5px` ring (`border`, `solid` for brush / `dashed` for
eraser) plus a `box-shadow: 0 0 0 1.5px` halo in the opposite tone. A small **center dot** (~3px) marks
the exact point. (Exact styles finalized in the plan.)

## Canvas integration (`src/lib/Canvas.svelte`)

- Mount `<BrushCursor getViewport={() => viewport} getContainer={() => stage} />` next to the existing
  `<RefTransformGizmo …/>`.
- Hide the OS cursor while a stroke tool is active: add
  `class:cursor-none={appState.tool === "brush" || appState.tool === "eraser"}` to the `stage` element
  (Tailwind `cursor-none`). The gizmo handles set their own `cursor`, and the gizmo isn't shown for
  draw layers under the brush/eraser tools, so there's no conflict. (Canvas imports `state` as
  `state`, not `appState` — use the name that file already uses.)

## Reactivity / performance

- The rAF loop runs continuously (mounted once) but does near-nothing when nothing changed; it writes
  `diameter`/`dashed`/ and the circle's transform follows `x`/`y` from pointer events. This matches the
  established `RefTransformGizmo` pattern, so it's consistent and proven.
- The component reads `appState.tool` + `activeStroke()` (the per-tool size from the brush/eraser
  settings feature), so it automatically tracks the active tool's size and flips solid↔dashed.

## Out of scope

- Pressure-width preview (cursor shows nominal size).
- Reflecting a transformed draw layer's scale in the cursor size.
- Per-brush-type cursor shapes (all strokes are round).
- A cursor for fill/select/lasso/transform (they keep sensible default cursors).

## Testing

DOM/overlay only — not node-renderable, so **no new automated tests**; the existing **209** stay green
and the build is **0/0**. Verified manually:
- Hover the canvas with the brush → a solid circle sized to the brush diameter follows the pointer;
  the OS arrow is hidden; a center dot marks the point.
- Switch to the eraser → the circle becomes dashed and sized to the eraser's own size.
- Change brush size (slider/`[`/`]`/presets) or zoom (wheel/pinch) → the circle resizes live.
- A finger touch shows no circle; the pointer leaving the canvas hides it.
- Drawing a stroke shows the circle tracking the pointer.

## Self-review notes

- Reuses the proven `RefTransformGizmo` mount + rAF pattern, so the integration surface is small and
  familiar; the component is fully isolated (one file) and Canvas changes are two lines.
- Screen-space sizing (`size × zoom`) keeps the circle a true pixel-accurate preview regardless of
  viewport pan/rotation (a circle is rotation-invariant).
- The two acknowledged inaccuracies (pressure width, layer-transform scale) are explicitly out of
  scope and noted, so the cursor is honest about being a *nominal* size guide.
