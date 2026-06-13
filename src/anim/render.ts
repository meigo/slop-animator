import { buildFrameDrawList, type Project } from "./document";

interface RenderOpts {
  /** Paint the project background color first. Default true. */
  drawBg?: boolean;
}

/**
 * Draw the visible layers' resolved keyframes for `frame` onto `ctx`, bottom→top,
 * each at its layer opacity. Does NOT clear or fill — the caller is responsible for
 * resetting the transform to identity and clearing/filling beforehand.
 */
export function compositeFrameLayers(
  ctx: CanvasRenderingContext2D,
  project: Project,
  frame: number,
  _dpr: number
): void {
  const layersById = new Map(project.layers.map((l) => [l.id, l]));
  for (const op of buildFrameDrawList(project, frame)) {
    const layer = layersById.get(op.layerId)!;
    const cell = layer.cells[op.keyframeIndex];
    if (cell.kind !== "key") continue;
    ctx.globalAlpha = op.opacity / 100;
    ctx.drawImage(cell.canvas, 0, 0);
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
  const { drawBg = true } = opts;

  // Reset to identity first so clearRect/fillRect/drawImage operate in raw device
  // pixels regardless of any transform the context carried in.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, project.width * dpr, project.height * dpr);

  if (drawBg) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = project.bgColor;
    ctx.fillRect(0, 0, project.width * dpr, project.height * dpr);
  }

  compositeFrameLayers(ctx, project, frame, dpr);
}
