# Clipboard Image Paste + Reference Rasterize (Approach A) — Design

**Status:** Approved (design phase)
**Date:** 2026-06-19

## Goal

Two related changes that make image handling more fluid and resolve the overlap between image
*reference* layers and *drawing* layers:

1. **Paste an image from the clipboard** → a new image reference layer (immediately transformable via
   the existing gizmo).
2. **Rasterize an image reference → drawing layer** — a one-way "commit to pixels" bridge, so the two
   layer types become complementary and convertible instead of competing.

## Background — why this shape

A reference layer is essentially a drawing layer minus painting, plus a persistent free transform
(`RefTransform {dx,dy,scale,rotation}`, edited with `RefTransformGizmo` / `core/ref-transform.ts`,
no selection needed) and lossless off-canvas retention (it redraws the original media each frame).
Drawing layers can only be transformed through a *selection*, destructively, and their cells are
clipped to a document-sized canvas.

Video references are genuinely distinct (animated source) and stay as-is. The redundancy is only for
*image* references, and only in those two transform/retention advantages. Rather than collapse the
types or give drawing layers a free transform now (that is **Approach B**, deferred to its own spec),
this design keeps both types and adds a convert action. Paste lands as a reference (leverages the
whole existing transform/render path with zero new transform code); rasterize lets you commit to
paintable pixels when you want to draw.

**Deferred (Approach B, separate spec):** a persistent layer-level free transform for drawing layers
(so a layer can be both transformed without a selection *and* painted on). Out of scope here.

## Part 1 — Clipboard image paste

### Flow

Both entry points end at one async action; neither adds transform code.

- **Keyboard (`Cmd/Ctrl+V`)** — a `window` `paste` listener in `src/App.svelte`. The browser fires a
  native `paste` event for the shortcut, so `e.clipboardData` is available with no permission prompt.
  Scan `e.clipboardData.items` for the first `type.startsWith("image/")`, call `item.getAsFile()` →
  `Blob`. If none, ignore (let normal paste proceed; do not `preventDefault` unless an image is found).
- **Toolbar "Paste image" button** — there is no event, so use
  `await navigator.clipboard.read()`, find the `ClipboardItem` whose `types` includes an `image/*`,
  `await item.getType(type)` → `Blob`. On no-image / unsupported / permission-denied, `alert(...)` a
  short message (the app has no toast system; `alert` is the minimal acceptable feedback for an
  explicit button press).

### Shared action (`src/state/appState.svelte.ts`)

```ts
export async function pasteImageReference(blob: Blob): Promise<void> {
  // loadImageMedia reads file.name only for its error message; wrap the blob in a File so the
  // existing loader works unchanged.
  const file = new File([blob], "Pasted image", { type: blob.type || "image/png" });
  const media = await loadImageMedia(file);
  const layer = createReferenceLayer(media, "Pasted image");
  layer.opacity = 100; // pasted images are content, not a dimmed trace underlay (ref default is 60)
  addLayerToProject(layer);
}
```

- `addLayerToProject` is already group-aware and sets `state.activeLayerId`, so the pasted layer is
  selected (and its gizmo ready) immediately. It is fit-centered at the identity transform by
  `createReferenceLayer`.
- Undo: `addLayerToProject` already wraps a structural commit, so paste is a single undo step.

## Part 2 — Rasterize image reference → drawing layer

### Shared render helper (extracted, DRY)

`render.ts` draws a reference's media in two places (the WebGL-composite branch and the plain-2D
branch) with identical translate/rotate/scale + `drawImage` math. Extract it so rasterize produces
**pixel-identical** output and the duplication is removed:

```ts
// src/anim/render.ts — assumes ctx is at the identity transform; draws in device pixels.
export function drawReferenceMedia(
  ctx: CanvasRenderingContext2D,
  layer: ReferenceLayer,
  docW: number,
  docH: number,
  dpr: number
): void {
  if (layer.media.type === "missing") return;
  const size = mediaIntrinsicSize(layer.media);
  if (size.w === 0 || size.h === 0) return; // not loaded
  const r = containRect(size.w, size.h, docW * dpr, docH * dpr);
  const t = layer.transform;
  const cx = r.x + r.w / 2 + t.dx * dpr;
  const cy = r.y + r.h / 2 + t.dy * dpr;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t.rotation);
  ctx.scale(t.scale, t.scale);
  ctx.drawImage(layer.media.el, -r.w / 2, -r.h / 2, r.w, r.h);
  ctx.restore();
}
```

Both existing reference-draw blocks in `render.ts` are replaced by a call to this helper (they already
run with the context at identity in device pixels).

### Action (`src/state/appState.svelte.ts`)

```ts
export function rasterizeReference(layerId: number): void {
  commitStructural(() => {
    const layers = state.project.layers;
    const idx = layers.findIndex((l) => l.id === layerId);
    const ref = layers[idx];
    if (!ref || ref.kind !== "ref" || ref.media.type !== "image") return; // image refs only
    if (mediaIntrinsicSize(ref.media).w === 0) return; // not loaded yet

    const cell = createCellCanvas(state.project.width, state.project.height, DPR);
    const ctx = cell.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0); // helper draws in device pixels
    drawReferenceMedia(ctx, ref, state.project.width, state.project.height, DPR);

    // Replace in place: same id/name/group/opacity/visibility, one keyframe at frame 0 (holds after),
    // so the image shows on every frame. Off-canvas pixels are clipped — the accepted commit trade.
    const dl = createDrawingLayer(state.project.frameCount, ref.name);
    dl.id = ref.id;
    dl.groupId = ref.groupId;
    dl.opacity = ref.opacity;
    dl.visible = ref.visible;
    dl.cells[0] = { kind: "key", canvas: cell };
    layers[idx] = dl;
    state.activeLayerId = dl.id;
  });
}
```

- Reusing `ref.id` keeps `activeLayerId` and group membership valid with no fix-ups. (It costs one
  skipped id from `nextId()` inside `createDrawingLayer` — harmless.)
- The new drawing layer is normal from here: paintable, eraseable, boil-able, per-frame.

### UI (`src/lib/LayerList.svelte`)

Add a rasterize button to the **active layer's** row-2 controls, only for an image reference
(`layer.kind === "ref" && layer.media.type === "image"`) — i.e. not for video or missing refs. Use a
lucide icon (`ImageDown`), `title="Rasterize to drawing layer"`, `e.stopPropagation()`, calling
`rasterizeReference(layer.id)`. It sits beside the existing rename / video-offset / re-link controls.

### UI (`src/lib/Toolbar.svelte`)

Add a "Paste image" button (lucide `ClipboardPaste`) next to the Add Image / Add Video buttons,
calling the toolbar's `navigator.clipboard.read()` path → `pasteImageReference(blob)`.

## Files touched

- `src/anim/render.ts` — extract + export `drawReferenceMedia`; call it from both existing ref-draw
  blocks.
- `src/state/appState.svelte.ts` — `pasteImageReference(blob)` and `rasterizeReference(layerId)`;
  import `loadImageMedia` (from `../anim/reference`), `createCellCanvas`, `createDrawingLayer`,
  `mediaIntrinsicSize`, `drawReferenceMedia`.
- `src/App.svelte` — `window` `paste` listener → extract image blob → `pasteImageReference`.
- `src/lib/Toolbar.svelte` — Paste-image button + `navigator.clipboard.read()` handler.
- `src/lib/LayerList.svelte` — rasterize button in the active image-reference row.
- `src/__tests__/rasterize.test.ts` (new) — see Testing.

## Testing

**Automated (Vitest — pure logic; jsdom has a canvas shim but no real raster, so assertions are about
structure, not pixels):**

- `rasterizeReference`: given a project with an image reference layer (a stub `ReferenceMedia` of
  type `image` with an `el` whose `naturalWidth/Height > 0`), after the call: the layer at the same
  index is `kind === "draw"`, keeps the ref's `id`/`name`/`groupId`/`opacity`/`visible`,
  `cells.length === project.frameCount`, `cells[0].kind === "key"`, and the rest are `hold`;
  `activeLayerId` equals that id. A video or missing ref is left unchanged (no-op).
- `drawReferenceMedia` is exercised indirectly (it needs a real 2D context for pixels); in jsdom we
  assert it does not throw for a loaded image stub and is a no-op for `missing` / zero-size media.

**Manual (browser):**

- **Paste:** copy an image (screenshot / from another app), `Cmd/Ctrl+V` → a "Pasted image" reference
  layer appears selected, fit-centered, at 100% opacity, with the transform gizmo active; the Toolbar
  Paste button does the same. Paste with no image in the clipboard → keyboard is a no-op; button
  shows the short alert. (iPad/Safari: confirm `navigator.clipboard.read()` permission flow.)
- **Rasterize:** select an image reference, transform it (move/scale/rotate), click rasterize → it
  becomes a drawing layer at the same stack position/name/group; the pixels match what was displayed;
  drawing/erasing on it now works; off-canvas parts are gone. The gizmo no longer applies. Undo
  restores the reference in one step. The button is absent for video and missing references.

## Out of scope

- **Approach B** — persistent free transform for drawing layers (separate spec).
- Rasterizing a **video** reference (would need a "which frame" choice — easy later add).
- Pasting non-image clipboard content; multiple images per paste (first image only).
- A toast system (the Paste button uses `alert` for its rare empty/denied case).

## Self-review notes

- Paste reuses the entire existing reference load/transform/render path — no new transform or render
  code, lowest risk; the only new surface is reading a blob from the clipboard.
- Rasterize's correctness hinges on `drawReferenceMedia` being the *same* code that renders the ref,
  so extracting it (rather than re-deriving the math) is load-bearing, not just DRY.
- Replace-in-place reusing `ref.id` avoids any dangling `activeLayerId`/`groupId` references.
- The one deliberate lossy behavior (off-canvas clipping on rasterize) is called out in the UI trade
  and is exactly what "commit to pixels" means; the non-destructive path remains (don't rasterize).
