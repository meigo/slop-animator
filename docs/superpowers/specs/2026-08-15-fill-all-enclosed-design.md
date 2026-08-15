# Fill all enclosed — Design

**Status:** Approved (2026-08-15)
**Date:** 2026-08-15
**Builds on:** `2026-08-15-pose-fill-outlines-design.md`, which added `fillEnclosed` — the pure pass
that finds every region the ink encloses. This feature paints that region instead of only telling
the mesh about it.

## Why this is not the thing that was declined

Auto fill-holes was declined in June, and the standing preference is recorded as
`prefers-manual-over-auto-altering-art`: view aids and manual tools, never silent pixel changes.
This does not reverse that. **"Auto" here means the tool FINDS the regions for you; you still press
the button.** What was declined was a pass that altered art as a side effect of doing something
else. This is one deliberate act, on one cell, with one undo entry.

## What it buys over the mask

`fillEnclosed`'s mask fixes only the MESH. Painting fixes everything downstream:

- the layer becomes opaque, so layers below stop showing through the character
- export and onion skins render the shape as a shape
- the Pose tool then works with **Fill outlines off**, because there is a real body

The mask is the non-destructive approximation; this is the honest fix.

## Requirements (user-confirmed)

1. **A button in the Fill tool's ToolOptions bar**, beside Tolerance / Expand / colour. It is a
   fill — one press instead of clicking every region — so it inherits the tool's colour swatch and
   the user's existing mental model.
2. **Current cell only.** The active layer's keyframe at the playhead. One press, one result, one
   undo entry — matching every other painting operation in the app. No all-frames variant.
3. **Paints with the Fill colour, BEHIND the ink** (`destination-over`), so strokes stay untouched
   on top. This is the animator's white-under-black-outline, and `fill.ts` already has the
   destination-over path.

## Design

### The region

`fillEnclosed(alpha, w, h, { gap })` (`src/core/fill-holes.ts`) already returns everything needed.
The pixels to paint are **`mask AND NOT ink`** — exactly what `enclosedArea` counts. No new geometry.

Nothing is painted where the flood reached, so this **fails safe**: an unclosed outline simply is
not enclosed, and nothing is filled there. That is the property that makes a one-press whole-cell
fill acceptable at all — a naive flood from a click point leaks across the entire canvas through a
single gap, and this cannot.

`fillEnclosed` reads the CELL's own alpha. The cell canvas is document-sized and the fill writes to
the same canvas, so no compose/inverse mapping is involved (unlike the click-point fill at
`Canvas.svelte:404-405`, which must `inverseChain` the pointer). Transforms are irrelevant here.

### Gap

The Fill tool needs its own gap control — `fill.expand` is a different thing (it grows the *result*
to cover anti-aliased edges; gap bridges *breaks in the outline* before the flood). Add
`state.fill.gap`, default **0**, clamped by the existing `clampGap` / `MAX_GAP` from
`fill-holes.ts`. Rendered next to Tolerance and Expand.

Rule of thumb, measured in the previous spec: **gap `r` bridges a break of roughly `2r` px.**

### Anti-aliased edges

The enclosed mask stops at `fillEnclosed`'s alpha threshold, so the anti-aliased fringe of a stroke
counts as "not ink" and would be left unfilled — a one-pixel halo between the fill and the stroke.
The existing `state.fill.expand` is exactly the fix (it is why that setting exists), so **dilate the
paint region by `expand`** before painting, reusing `dilateMask`. Painting behind the ink means the
dilation can only ever tuck *under* the strokes, never over them.

### Painting

```ts
fillAllEnclosed(ctx, w, h, colour, { gap, expand })
```
in `src/core/fill.ts` (it belongs with the other fill, and needs the same `destination-over`
composite). It builds an RGBA image of the paint region and composites it with
`globalCompositeOperation = "destination-over"` — the path `floodFill` already uses at
`fill.ts:158-161`.

Pure region maths (which pixels) stays in `fill-holes.ts` and is unit-testable; the canvas
compositing is a thin DOM-coupled wrapper, per project convention.

### Wiring

A new action alongside the click-fill in `Canvas.svelte`, following that function's existing shape
exactly (`Canvas.svelte:406-448`):

1. `ensureDrawableKeyframe(layer, playhead, canvasOps)` — materialises a keyframe on a hold, as the
   click-fill does.
2. `before = ctx.getImageData(...)`, paint, `after = ctx.getImageData(...)`,
   `history.push(pixelCommand(undo, redo, before, after))` — one entry, and `pixelCommand` already
   carries the byte cost the History RAM cap accounts for.
3. Guarded by `isLayerEditable` like every other write, and honouring a live selection clip the same
   way the click-fill does (flood on a temp copy, composite back through `selection.applyClip`).
4. `bump()` afterwards, so autosave and the glyph/bounds caches see it.

### Feedback

If the region is empty (nothing enclosed), do nothing and say so — reuse the same honest-failure
reasoning as the pose warning: the outline is not closed, raise Gap. It must not silently no-op,
because a no-op and a successful fill of an already-white interior look identical.

Unlike the pose case this fires from a button click, so `statusHint` is not clobbered by a
window-level `pointerdown` mirror the way it was in `Canvas.svelte:1316` — but it IS overwritten by
the next hover, which is acceptable for a transient confirmation.

## Out of scope

- **All-frames / batch fill** (requirement 2). It is a batch edit over art you cannot all see at
  once, with an undo spanning many frames.
- Filling on a reference layer, or anything but the active layer's current keyframe.
- Changing the click-point Fill tool's behaviour in any way.
- Auto-invoking this from the Pose tool. The pose mask stays non-destructive; if a user wants pixels
  they press this button deliberately.

## Testing & verification

Pure region maths is unit-tested (node): the paint region of a closed ring is exactly its interior;
a gapped ring yields an empty region at gap 0 and a full interior at a sufficient gap; a solid blob
yields an empty region (nothing enclosed); `expand` grows the region by the expected radius; nested
holes fill independently. The canvas compositing and the ToolOptions button are build + review
verified per project convention.

**Browser pass owed:** fill an outline drawing and confirm the interior fills behind the strokes
with no halo at `expand` ≥ 1; that the strokes themselves are unmodified; undo restores in one step;
a gapped outline reports rather than silently doing nothing, and raising Gap then fills it; a filled
drawing reports "nothing enclosed" rather than appearing to work; filling on a HOLD materialises a
keyframe (known app-wide behaviour); a selection clips the fill; a locked or hidden layer refuses;
and the Pose tool then meshes that drawing as a body with **Fill outlines off**.
