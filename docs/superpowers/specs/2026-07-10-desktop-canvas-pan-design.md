# Desktop canvas pan + fit-view — design

**Date:** 2026-07-10
**Status:** Design (approved for planning)
**Feature:** Add canvas panning on desktop (mouse/trackpad) — space-drag, middle-mouse drag, and
plain-scroll pan — plus a fit-to-view key. Touch/iPad gestures are unchanged.

## Motivation

Panning exists on iPad (one-finger pan + two-finger pinch, via `touch-gestures.ts`, gated to
`pointerType === "touch"`), but on desktop the only viewport control is `onWheel` → `zoomAt` (all
wheel scrolling zooms). There is **no way to pan with a mouse/trackpad**, and no reset/fit control
(`viewport.resetView()` exists but is unbound). This adds the standard desktop conventions.

## Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Pan inputs | **Space + left-drag**, **middle-mouse drag**, and **plain wheel/trackpad scroll**. |
| D2 | Wheel split | **Plain scroll = pan** (`deltaX`/`deltaY`); **⌘/Ctrl + scroll = zoom** at cursor (trackpad pinch arrives as ctrl+wheel → still zooms). Changes today's "any wheel zooms". |
| D3 | Fit key | **`0`** → fit the canvas to the view (scale to fit + center). Ignored while typing in a field. |
| D4 | Touch | iPad gestures unchanged. |

## Architecture

Two files. Pure fit math is unit-tested; the DOM wiring is build + browser verified.

### `src/core/viewport.ts` — new methods

The `Viewport` already has `startPan/updatePan/endPan`, `panning` getter, `zoomAt`, and `resetView()`
(1:1 at origin). Add:

```ts
/** Pan by a screen-pixel delta (for wheel/trackpad scrolling). */
panBy(dx: number, dy: number): void; // this.panX += dx; this.panY += dy; applyTransform(); onChange()

/** Fit `contentW × contentH` (logical px) into the parent with a margin and center it. */
fitView(contentW: number, contentH: number): void;
```

`fitView` delegates the math to a pure, testable helper (no DOM):

```ts
// src/core/viewport-fit.ts (new)
export function computeFitTransform(
  parentW: number, parentH: number, contentW: number, contentH: number, margin = 0.9,
): { zoom: number; panX: number; panY: number } {
  if (contentW <= 0 || contentH <= 0 || parentW <= 0 || parentH <= 0)
    return { zoom: 1, panX: 0, panY: 0 };
  const zoom = Math.min(parentW / contentW, parentH / contentH) * margin;
  const panX = (parentW - contentW * zoom) / 2;
  const panY = (parentH - contentH * zoom) / 2;
  return { zoom, panX, panY };
}
```

`fitView(contentW, contentH)` reads `this.parent.clientWidth/clientHeight`, calls
`computeFitTransform`, assigns `zoom/panX/panY`, sets `rotation = 0`, then `applyTransform()` +
`onChange()`. (`minZoom`/`maxZoom` clamp still applies to the resulting zoom.)

### `src/lib/Canvas.svelte` — desktop viewport controls

All new handlers use the existing `viewport`. The `stage` element is the stable outer container;
drawing input (`setupInput`) is attached to the inner `display` canvas.

1. **Wheel (D2)** — replace `onWheel`:
   ```ts
   function onWheel(e: WheelEvent) {
     e.preventDefault();
     if (e.ctrlKey || e.metaKey) viewport?.zoomAt(e.clientX, e.clientY, e.deltaY);
     else viewport?.panBy(-e.deltaX, -e.deltaY); // plain scroll → pan (content follows the scroll)
   }
   ```
   (Pan sign: scrolling down moves the content up so you see lower content — `panBy(-deltaX, -deltaY)`;
   final sign confirmed in the browser.)

2. **Pointer pan — space-drag + middle-mouse (D1)** — a **capture-phase** `pointerdown` on `stage`
   (added via `addEventListener("pointerdown", …, { capture: true })` in `onMount`, removed on
   cleanup) so it preempts the bubble-phase drawing handler on `display`:
   ```ts
   let spaceHeld = false;
   function stagePanDown(e: PointerEvent) {
     const wantPan = e.button === 1 || (spaceHeld && e.button === 0); // middle, or space+left
     if (!wantPan) return; // let it fall through to drawing
     e.preventDefault();
     e.stopPropagation(); // capture-phase: the draw handler on `display` never sees it
     viewport.startPan(e.clientX, e.clientY);
     stage.setPointerCapture(e.pointerId);
     panningPointer = e.pointerId;
   }
   ```
   Matching capture-phase `pointermove` → `viewport.updatePan(e.clientX, e.clientY)` while
   `viewport.panning`; `pointerup`/`pointercancel` → `viewport.endPan()` + release capture. A reactive
   `panning` flag (mirrors `viewport.panning`) drives the cursor.

3. **Space tracking + fit key (`0`)** — window `keydown`/`keyup` in `onMount`:
   ```ts
   function onViewKeyDown(e: KeyboardEvent) {
     const tag = (document.activeElement as HTMLElement | null)?.tagName;
     if (tag === "INPUT" || tag === "TEXTAREA") return; // don't hijack typing
     if (e.key === " " && tag !== "BUTTON") { spaceHeld = true; e.preventDefault(); } // grab-to-pan; keep space-activates-button
     else if (e.key === "0") { e.preventDefault(); viewport?.fitView(state.project.width, state.project.height); }
   }
   function onViewKeyUp(e: KeyboardEvent) { if (e.key === " ") spaceHeld = false; }
   ```
   (These are separate from `App.svelte`'s `onKey`; neither `" "` nor `"0"` is bound there, so no
   conflict. `App.svelte`'s single-key guard already ignores INPUT/TEXTAREA similarly.)

4. **Cursor feedback** — on the `stage`: `grab` while `spaceHeld` and not panning, `grabbing` while
   panning; these override the existing `cursor-none` (brush/eraser). Implemented with reactive class
   bindings ordered so the grab/grabbing classes win (or an inline `style="cursor:…"` override while
   `spaceHeld || panning`, which is simplest and avoids Tailwind ordering fights).

## Interaction / edge cases

- **Drawing is preempted, not corrupted:** the capture-phase pan handler `stopPropagation()`s before
  `display`'s draw handler runs, so a space/middle pan never starts a stroke. Releasing space returns
  to normal drawing.
- **Space + focused button:** `keydown " "` is ignored when the focused element is a `BUTTON` (so
  space still activates buttons); otherwise it's consumed for pan and `preventDefault`ed (no page
  scroll / no button trigger).
- **Pencil/touch unaffected:** pan handlers act on `button === 1` or `spaceHeld` (mouse); touch still
  routes to `touch-gestures.ts`. The Pencil draws as before.
- **Zoom clamp** (`minZoom 0.1`, `maxZoom 20`) still bounds `fitView` and wheel-zoom.

## Testing

- **Unit (node):** `computeFitTransform` — fits by the limiting dimension (wide vs tall content),
  centers (`panX`/`panY` symmetric), applies the margin, and degenerates safely (zero/negative
  dimensions → identity).
- **Build:** `npm run build` 0/0; `npm test` baseline + the new fit test.
- **Browser (verification debt — flag to user):** space-drag pans (grab cursor) and returns to
  drawing on release; middle-mouse drag pans; plain scroll pans, ⌘/Ctrl+scroll zooms at the cursor,
  trackpad pinch zooms; `0` fits + centers; pan never starts a stroke; space still clicks a focused
  button; iPad gestures unchanged.

## Non-goals / deferred

- **Rotate on desktop** (touch has it; no desktop control planned).
- **Zoom-to-fit-selection**, pan inertia/momentum, a zoom-percentage HUD, or a toolbar
  pan/zoom/fit button cluster — could come later; `0` + the drag/scroll gestures cover the need.
- **Configurable keybindings.**
