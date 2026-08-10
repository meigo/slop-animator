# Contextual Status Hints — Design

**Status:** Approved (2026-08-11)
**Date:** 2026-08-11
**Builds on:** the status bar from `2026-07-10-status-bar-and-resizable-timeline-design.md` (left =
hover/press hint sourced from every `title=`; right = frame/tool/layer readout).

## Problem

The app's most useful gestures are invisible. Tap-outside-to-deselect prompted this (the user asked
how to deselect on iPad and the answer was an undocumented tap); Deform and Pose commit via Enter or
a **tool switch**, and without a keyboard the tool switch is the only path — nothing says so. Layer
lock and the layer-transform guard both make tools *silently* refuse input. The status bar's left
half is empty whenever nothing is hovered, which is most of the time — and `title=` hints don't
appear on touch at all without a hover.

## Design (user-approved)

### Mechanism

- Pure `contextHint(ctx: HintContext): string` in `src/lib/status-hint.ts` — no DOM, no store
  import, unit-tested. `StatusBar` renders `appState.statusHint || contextHint(...)`: an actual
  hover/press hint always wins; the context hint fills the idle gap.
- Content rule (user's choice): **non-obvious gestures only.** No keyboard-shortcut lists, nothing
  restating a visible button. Every line must teach something a first-time user cannot see.

### Precedence (a hint for a gesture that currently does nothing is worse than no hint)

1. Active layer **locked** → "Layer locked — unlock it in the layer list to edit"
2. Tool **blocked by a layer transform** (select/lasso/deform/pose bail on a non-identity layer
   transform) → "Apply or reset the layer transform to use this tool"
3. Otherwise, the tool/state hint below.

### Hints

| Context | Line |
|---|---|
| select, no selection | Drag to select an area |
| lasso, no selection | Draw a loop to select |
| select/lasso, marquee active | Drag inside to move · tap outside to deselect |
| select/lasso, floating (moved) | Drag to move · tap outside to bake · Deselect reverts |
| transform | Drag to move · corners scale · top handle rotates |
| deform, not entered | Tap the drawing to lift it into a warp grid |
| deform, warping | Drag a grid point to warp · leaving the tool bakes it |
| pose, not entered | Tap the drawing to build the pose mesh |
| pose, posing | Tap to add a handle · drag a handle to pose · drag its nub to rotate and set reach · leaving the tool bakes it |
| brush/eraser/fill/eyedropper | "" (drag-to-draw needs no teaching; noise weakens the rest) |

Reference layers: the locked/transform rules are draw-layer concepts, so a ref active layer falls
through to the plain tool hint.

### Removal

`RefTransformGizmo`'s on-canvas text label ("Transform: drag to move · corners scale · top handle
rotates") is deleted — the bar now carries it without covering artwork. **The "Reset to fit" button
in that same overlay stays.**

## Out of scope

Input-adaptive phrasing (touch vs keyboard wording); hints for timeline/layer-list contexts;
dismissing/disabling hints; animating or timing them out.

## Testing

`contextHint` is pure → unit-tested across every row above plus the two precedence overrides.
`StatusBar`/gizmo wiring is build + review verified. **Browser pass owed:** each tool's idle line;
hover still overrides; the Transform label no longer paints on canvas; iPad.
