import { buildFrameDrawList, containRect, mediaIntrinsicSize, isCrispFrame, type Project, type BoilConfig } from "./document";
import { drawBoiled } from "../core/boil";

interface RenderOpts {
  /** Paint the project background color first. Default true. */
  drawBg?: boolean;
  /** Include reference layers. Default true (display); export passes false. */
  includeReference?: boolean;
  /** Line-boil warp for drawing layers (prototype). Omitted = no boil. */
  boil?: BoilConfig;
}

/**
 * Draw the visible layers for `frame` onto `ctx`, bottom→top, each at its layer opacity.
 * Drawing layers blit their resolved keyframe; reference layers draw their media with a
 * "contain" fit. Reference layers are omitted when `includeReference` is false.
 * Does NOT clear or fill — the caller resets the transform and clears/fills beforehand.
 */
export function compositeFrameLayers(
  ctx: CanvasRenderingContext2D,
  project: Project,
  frame: number,
  dpr: number,
  includeReference = true,
  boil?: BoilConfig
): void {
  const w = project.width * dpr, h = project.height * dpr;
  const layersById = new Map(project.layers.map((l) => [l.id, l]));
  for (const op of buildFrameDrawList(project, frame, includeReference)) {
    const layer = layersById.get(op.layerId)!;
    ctx.globalAlpha = op.opacity / 100;
    if (op.kind === "draw" && layer.kind === "draw") {
      const cell = layer.cells[op.keyframeIndex];
      if (cell.kind !== "key") continue;
      const strength = layer.boilStrength;
      const boilThisFrame = boil && strength > 0
        && !isCrispFrame(layer.cells, frame, boil.holdsOnly)
        && (boil.amount > 0 || boil.scale > 0);
      if (boilThisFrame) {
        // Per-layer phase (layerId) + cycle of `rate` warps (frame), scaled by the layer's strength.
        const seed = (frame % Math.max(1, boil!.rate)) * 100003 + op.layerId * 9176;
        drawBoiled(ctx, cell.canvas, w, h, {
          amount: boil!.amount * strength, cols: boil!.cols, scale: boil!.scale * strength, seed,
        });
      } else {
        ctx.drawImage(cell.canvas, 0, 0);
      }
    } else if (op.kind === "ref" && layer.kind === "ref") {
      const size = mediaIntrinsicSize(layer.media);
      if (size.w === 0 || size.h === 0) continue; // media not loaded yet
      const r = containRect(size.w, size.h, project.width * dpr, project.height * dpr);
      ctx.drawImage(layer.media.el, r.x, r.y, r.w, r.h);
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Paint `frame` of `project` onto `ctx`. `dpr` is the device pixel ratio the cell
 * canvases were created at, used to reset the transform before raw drawImage calls.
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  frame: number,
  dpr: number,
  opts: RenderOpts = {}
): void {
  const { drawBg = true, includeReference = true, boil } = opts;

  // Reset to identity first so clearRect/fillRect/drawImage operate in raw device
  // pixels regardless of any transform the context carried in.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, project.width * dpr, project.height * dpr);

  if (drawBg) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = project.bgColor;
    ctx.fillRect(0, 0, project.width * dpr, project.height * dpr);
  }

  compositeFrameLayers(ctx, project, frame, dpr, includeReference, boil);
}
