# Pixel undo keeps only the tiles a step changed — port from slop-paint

Date: 2026-09-29. Source: slop-paint `610d67d` (`changedTiles` / `cropPixels` in its `src/history.ts`,
used by its `src/undo.ts`). Roadmap item "Port from slop-paint (2)" in `CLAUDE.md`.

## Problem

Every pixel undo step (`pixelCommand`, `src/anim/history.ts`) keeps two whole-canvas `ImageData`s.
This app's raster scale is fixed at 1 (`DPR = 1`, `appState.svelte.ts`), so at 1920×1080 a step is
2 × 8.3 MB = 16.6 MB and the 256 MB budget holds 16 steps, not the 50-step cap; a 4K canvas
holds about 4. And the undo stack sits near 256 MB once ~16 strokes are drawn, which on iPad
competes with the cell canvases themselves (tabs are reloaded under memory pressure).

(The roadmap note said "at dpr 2 … ~4 steps"; that was slop-paint's number. This app is dpr 1.)

## Goal / success criteria

1. A step keeps only the 64-px tiles that changed, both sides: a typical stroke costs roughly the
   area it touched, so a 1080p document reaches the 50-step cap.
2. Undo/redo restore exactly the same pixels as before.
3. Every call site keeps its current ordering of pixel restore vs. keyframe-track restore and
   recomposite/bump, and `markInkChanged` still fires on push, undo and redo.
4. No full-canvas `ImageData` stays reachable from a pushed command.

## Design

### `src/anim/history.ts`

- `PixelRect`, `UNDO_TILE = 64`, `changedTiles(a, b, width, height, tile?)` and
  `cropPixels(data, width, r)` — copied from slop-paint (32-bit compare per pixel, tiles in row
  order, edge tiles clipped).
- `pixelCommand` changes shape:

  ```ts
  pixelCommand(
    ctx: CanvasRenderingContext2D,
    before: ImageData,
    after: ImageData,
    undo: (put: () => void) => void,
    redo: (put: () => void) => void,
  ): Command
  ```

  It computes the changed tiles once, crops both sides into packed `Uint8ClampedArray`s, and
  returns a command whose `undo`/`redo` call the caller's function with a `put` that writes the
  "before"/"after" tiles back with `ctx.putImageData(new ImageData(data, w, h), x, y)`.
  `ImageData` objects are made at `put` time, not stored (a stored `ImageData` per tile would be the
  same bytes; making them lazily also keeps the module node-testable). `bytes` is the sum of the
  cropped buffers. If `before` and `after` differ in size (not expected — callers snapshot the same
  canvas) the command keeps both whole and `put` writes them at (0, 0), as today.
  `markInkChanged(ctx.canvas)` on creation, undo and redo, as today.
- `DEFAULT_HISTORY_BYTES` comment updated.

### Call sites (9)

`Canvas.svelte`: click fill, enclosed fill, stroke commit, selection commit, delete selection, pose
apply, outline apply; `Timeline.svelte`: clear frame. Each becomes

```ts
history.push(
  pixelCommand(ctx, before, after,
    (put) => { put(); …same restores as today…; recomposite(); },
    (put) => { …same restores…; put(); recomposite(); },
  ),
);
```

`put()` replaces `ctx.putImageData(before|after, 0, 0)` at the same position. The callbacks must
not reference `before`/`after` (that would keep the full snapshots alive through the closure).

### Not changing

- The "nothing changed" checks (`sameImageData`, `clearFrameIsNoOp`) stay where they are.
- Limits (50 steps, 256 MB) and structural undo (`StructSnapshot`, which shares canvas refs and
  holds no pixel copies).
- A step whose tiles are empty (no pixel change but a materialised keyframe) still pushes, with
  `put` a no-op, exactly as its restores need.

## Testing

- Port slop-paint's `history-bounds.test.ts`: `changedTiles` (identical, single pixel, edge clip,
  row order, any channel), `cropPixels`, and a budget check restated for this app (a thick
  corner-to-corner stroke at 1920×1080 dpr 1 fits ≥ 50 steps; a whole-canvas step fits 16).
- `pixelCommand` round trip with a stub context and a stub `ImageData`: after undo the canvas
  buffer equals `before`, after redo equals `after`; `bytes` equals the tile bytes; callback order
  preserved; mismatched sizes fall back to whole buffers; ink revision bumps on push/undo/redo
  (existing test updated to the new signature).
- `npm test`, `npm run build` (0 errors, 0 warnings). Desktop browser: draw, fill, delete a
  selection, pose, clear a frame, undo/redo each.
