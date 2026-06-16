import { buildFrameDrawList, containRect, mediaIntrinsicSize, isCrispFrame, type Project, type BoilConfig } from "./document";
import { boilBegin, boilLayer, boilBlit } from "../core/boil-gl";

interface RenderOpts {
  /** Paint the project background color first. Default true. */
  drawBg?: boolean;
  /** Include reference layers. Default true (display); export passes false. */
  includeReference?: boolean;
  /** Line-boil warp for drawing layers. Omitted = no boil. */
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
  const ops = buildFrameDrawList(project, frame, includeReference);

  // WebGL boil — composite every drawing layer inside ONE GL surface (displaced + blended in
  // z-order) and read it back exactly once (iOS Safari can't drawImage a GL canvas per-layer).
  // Reference layers are drawn in 2D below the drawing stack (the rotoscope case).
  if (boil && boilBegin(w, h)) {
    for (const op of ops) {
      const layer = layersById.get(op.layerId)!;
      if (op.kind === "ref" && layer.kind === "ref") {
        const size = mediaIntrinsicSize(layer.media);
        if (size.w === 0 || size.h === 0) continue;
        const r = containRect(size.w, size.h, w, h);
        ctx.globalAlpha = op.opacity / 100;
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
    }
    for (const op of ops) {
      const layer = layersById.get(op.layerId)!;
      if (op.kind !== "draw" || layer.kind !== "draw") continue;
      const cell = layer.cells[op.keyframeIndex];
      if (cell.kind !== "key") continue;
      const strength = layer.boilStrength;
      const crisp = isCrispFrame(layer.cells, frame, boil.holdsOnly) || strength <= 0 || (boil.amount <= 0 && boil.weight <= 0);
      const seed = (frame % Math.max(1, boil.rate)) * 100003 + op.layerId * 9176;
      boilLayer(cell.canvas, op.opacity / 100, crisp ? 0 : boil.amount * strength, boil.cols, crisp ? 0 : boil.weight * strength, seed);
    }
    ctx.globalAlpha = 1;
    boilBlit(ctx);
    return;
  }

  for (const op of ops) {
    const layer = layersById.get(op.layerId)!;
    ctx.globalAlpha = op.opacity / 100;
    if (op.kind === "draw" && layer.kind === "draw") {
      const cell = layer.cells[op.keyframeIndex];
      if (cell.kind !== "key") continue;
      ctx.drawImage(cell.canvas, 0, 0);
    } else if (op.kind === "ref" && layer.kind === "ref") {
      const size = mediaIntrinsicSize(layer.media);
      if (size.w === 0 || size.h === 0) continue; // media not loaded yet
      const r = containRect(size.w, size.h, project.width * dpr, project.height * dpr);
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
