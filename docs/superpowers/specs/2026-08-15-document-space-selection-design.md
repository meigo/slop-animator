# Document-space selection — Design

**Status:** Approved (2026-08-15)
**Date:** 2026-08-15
**Builds on:** per-cell / layer / group compose (`2026-06-22-per-cell-transform-design.md`,
`2026-06-23-group-transform-design.md`); selection clip + deform (`2026-06-14-plan-9`);
selection cut/copy/paste (`2026-07-11-selection-cut-copy-paste-design.md`).

## Problem

A marquee is already **document-level in lifetime** (it survives a layer/frame switch; only a lift
is banked). Its **coordinates are not**. `selection.rect` / lasso points live in cell-local space,
pointers go through `toCellSpace` (`inverseChain` of `group ∘ layer ∘ cell`), and the overlay
draws the ants through `applyCompose` of whichever layer is active.

So: select on an untransformed layer, switch to a scaled/moved layer, and the same numbers are
pushed through a new compose — the ants jump and scale. The floating action bar (which maps the
raw rect through `viewport.canvasToScreen`) does **not** follow that compose, so ants and bar can
disagree.

The user wants the selection to be **global**: a region of the paper. Viewport pan / zoom /
canvas-rotate still apply. Layer Frame / Layer / Group transforms do not.

## Decisions (from brainstorming)

- **Stay put on the paper.** Switching layers, or changing the active layer’s compose, does not
  move the ants. Paint / lift / fill / copy use whatever of the **active** layer sits under that
  region.
- **Viewport still applies.** `applyView` (pan, rotate, zoom) stays. Screen-constant chrome
  (1 px ants, 8 px handles) stays.
- **Inverse-map only when writing or sampling pixels.** Clip, lift, clear, copy, fill, commit.
- **A live lift still belongs to one layer.** Layer/frame switch still commits it (`bankActiveEdits`).
  Only the unlifted marquee is paper-stable.
- **Frame / Layer / Group scopes are unchanged.** The jump was the marquee inheriting them, not a
  reason to cut the three-scope model in this change.

## Coordinate model

| What | Space |
|---|---|
| `selection.rect`, lasso points, transform matrix, warp grid | **Document** (paper / project logical px) |
| Overlay chrome + hit-test + create/drag | Document, then `applyView` |
| Floating pixels (the lifted bitmap) | Document-space crop of what that region *looked like* on the paper |
| Stroke / fill / lift / copy / clear / commit into a cell | Inverse-map document shape through the **current** `cellComposeSteps(activeLayer)` |

Identity compose ⇒ document space == cell space ⇒ bit-identical to today.

A paper-axis-aligned rect over a rotated/scaled layer selects the ink you **see** under that box
(a quad in the cell, not a cell-aligned AABB).

## Mechanism

### Overlay

`drawOverlay` keeps `applyView`. It **stops** calling `applyCompose` for the marquee, handles, and
the floating bitmap (the float is already a paper crop). `selection.screenScale` is `viewport.zoom`
only — drop the `composeScaleOf` extra, or the chrome would shrink on a scaled-up layer.

`getScreenBounds` already returns the raw rect / transformed corners; with the rect in document
space, the action bar and the ants finally agree.

### Pointers (select / lasso)

`onStroke` for select/lasso uses **document** points (`screenToCanvas`), not `toCellSpace`.
Deform / pose / draw / fill keep `toCellSpace` — they write the cell.

### Pixel ops

Canvas installs a mapper on the selection:

```ts
selection.docToCell = (p) => inverseChain(cellComposeSteps(activeLayer()), p);
```

(and the identity short-circuit already in `toCellSpace`).

`applyClip` / `copyPixels` / `clearRegion` map the document rect (4 corners) or lasso points
through `docToCell` and clip that path. Identity mapper ⇒ today’s `rect()` / `lassoPath`.

**Lift** (enterTransform, first grab-inside, deform is out of scope):

1. Rasterize the active layer’s cell through its compose into a document-sized temp (existing
   `drawCellComposed`).
2. Crop the temp to the document selection (lasso-clipped if needed) → float bitmap.
3. Punch a hole in the cell with the inverse-mapped clip (`clearRegion`).

**Commit** (`renderFloatingTo` onto the cell ctx): apply the **inverse** compose as a 2D transform
(invert `applyOverlayCompose`), then draw the float at `rect` under `matrix` / warp. Identity
compose ⇒ today’s blit.

**Copy** uses step 1–2 only (no hole). **Delete** is `clearRegion` only. **Paste** stays a
document-space float at `rect + PASTE_OFFSET` (the clipboard rect is already document space after
this change).

### Layer / frame switch

Unchanged: `bankActiveEdits` commits a lift, keeps a plain marquee. The kept marquee no longer
picks up the new layer’s compose.

## Out of scope

- Redesigning or removing Frame / Layer / Group transform scopes.
- Deform / Pose (they cancel the marquee and lift the cell’s content bounds — still cell-local).
- Animated / keyframed transforms.
- Expanding the cell beyond the document (tiled storage). A paper selection that extends off a
  transformed layer’s paintable rect still clips at the cell edge; `LayerBoundsHint` remains the
  honest wall.

## Testing

Pure mapper (rect / lasso through identity, through a 2× scale about doc center, through a
translation) is unit-tested. Overlay / lift / commit / iPad gestures are build + review.
**Browser pass owed:** select on an identity layer → switch to a moved/scaled/rotated layer → ants
stay put; paint/fill inside that box hits the new layer’s ink under the box; Free transform lifts
what you see; undo; identity-layer path unchanged; viewport pan/zoom still moves the ants with the
paper.
