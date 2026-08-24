/**
 * The canvas driver for PSD export: one frame of the project turned into the tree `encodePsd`
 * consumes.
 *
 * This is where the render chain meets the encoder. Each surviving drawing layer is rendered
 * ALONE through its full `group ∘ layer ∘ cell` compose, cropped to its own ink, and handed over
 * as a thunk; the encoder resolves those one at a time so a single full-size bitmap is live at
 * once (ten held together is ~83 MB at 1920x1080, which the 1x document-scale work exists to
 * avoid). The tree-shaping decisions — what is included, how it nests, what opacity each node
 * carries — live in the pure `psd-plan.ts`, where they can be tested.
 *
 * **Transforms bake, opacity does not.** A transform has no PSD equivalent that survives a paint
 * stroke, so it is rendered into the pixels; opacity is a byte in the layer record, which is what
 * lets the colourist keep re-tuning it.
 */
import { resolvedKeyCell, type DrawingLayer, type Project } from "../anim/document";
import { drawLayerCell, renderFrame } from "../anim/render";
import { boundsOfPixels } from "../lib/cell-ink";
import { planPsdFrame } from "./psd-plan";
import { encodePsd, type PsdNode, type PsdRect } from "./psd";

/**
 * Paint ONE layer's resolved key cell onto `ctx` at full alpha, with nothing else on the surface.
 *
 * The compose itself is `render.ts`'s `drawLayerCell`, the same call the editor's own composite
 * makes — a second copy of that geometry would be invisible to `tsc` and unreachable by any test.
 * The two differences a PSD layer needs are both here rather than there: the surface is cleared
 * first, and `globalAlpha` stays at 1 because the opacity travels as a byte in the layer record.
 *
 * `version` is 0 for the same reason the PNG exporter's `renderFrame` call leaves it at the
 * default: an exporter has no document version to thread, and the caches it feeds are keyed by
 * version, so a wrong one costs a recompute and never a wrong answer.
 */
function drawLayerAlone(
  ctx: CanvasRenderingContext2D,
  project: Project,
  layer: DrawingLayer,
  frame: number,
  dpr: number,
  wDev: number,
  hDev: number,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, wDev, hDev);
  const resolved = resolvedKeyCell(layer, frame);
  if (!resolved) return; // no key at or before this frame — nothing to draw, and no ink to find
  drawLayerCell(ctx, project, layer, resolved.cell, frame, dpr, 0);
}

/**
 * Encode `frame` of `project` as a layered `.psd`.
 *
 * Every bitmap goes through ONE scratch canvas, which is also why each layer is drawn twice: once
 * now to find its ink bounds, once inside its thunk to read the crop. Keeping the measured
 * ImageData instead would mean holding every layer's pixels until the encoder asked for them,
 * which is the allocation this whole path is shaped to avoid — and the second draw is cheap beside
 * PackBits. The thunks are safe to share the canvas because `encodePsd` resolves them strictly in
 * sequence, and each returns an `ImageData.data` copy rather than a view.
 */
export function exportPsdFrame(project: Project, frame: number, dpr: number): Uint8Array {
  const wDev = Math.round(project.width * dpr);
  const hDev = Math.round(project.height * dpr);

  const scratch = document.createElement("canvas");
  scratch.width = wDev;
  scratch.height = hDev;
  // Read-heavy by construction: a getImageData per layer to measure, another to crop, one more for
  // the composite.
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;

  const nodes = planPsdFrame(project, frame, (layer, opacity): PsdNode | null => {
    drawLayerAlone(ctx, project, layer, frame, dpr, wDev, hDev);
    // `boundsOfPixels`, never `contentBounds`: that one memoises by CANVAS identity, and every
    // layer here measures the same scratch — so it would hand layer 2 layer 1's rect.
    const b = boundsOfPixels(ctx.getImageData(0, 0, wDev, hDev).data, wDev, hDev);
    if (!b) return null; // no ink at this frame — the plan drops it, and its folder if it empties
    const rect: PsdRect = { top: b.y, left: b.x, bottom: b.y + b.h, right: b.x + b.w };
    return {
      kind: "layer",
      name: layer.name,
      opacity,
      rect,
      pixels: () => {
        drawLayerAlone(ctx, project, layer, frame, dpr, wDev, hDev);
        return ctx.getImageData(b.x, b.y, b.w, b.h).data;
      },
    };
  });

  return encodePsd({
    width: wDev,
    height: hDev,
    // A frame whose layers are all hidden or all blank yields NO nodes, and that is what ships: a
    // PSD declaring zero layers, carrying only the merged composite. It is the truthful answer —
    // there are no layers — and the file still opens showing the frame, flat. The alternative
    // considered was inventing a placeholder layer to avoid the zero count; it would put a layer in
    // the colourist's panel that the animator never drew, which is worse than the degenerate-but-
    // legal count. (A zero-length layer-and-mask section is what most writers emit here, and it is
    // not reachable from this side: `encodePsd` always writes the section. The difference is
    // invisible to a length-respecting reader, but it is the one shape in this export that no unit
    // test can vouch for — it belongs on the owed-Photoshop-pass list.)
    nodes,
    // Last thing the encoder asks for, so it is safe to reuse the same scratch canvas. Matches the
    // PNG exporter's settings minus boil: boil composites every layer inside one GL surface and
    // reads it back once, so there is no per-layer equivalent to bake, and the clean line is what
    // paint-up wants anyway.
    composite: () => {
      renderFrame(ctx, project, frame, dpr, {
        drawBg: !project.transparentBg,
        includeReference: false,
        boil: undefined,
      });
      return ctx.getImageData(0, 0, wDev, hDev).data;
    },
  });
}
