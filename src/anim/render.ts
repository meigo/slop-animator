import {
  buildFrameDrawList,
  cellTransform,
  containRect,
  mediaIntrinsicSize,
  isCrispFrame,
  isIdentityTransform,
  IDENTITY_TRANSFORM,
  groupOf,
  groupTransform,
  type Project,
  type BoilConfig,
  type ReferenceLayer,
  type RefTransform,
} from "./document";
import { boilBegin, boilLayer, boilBlit } from "../core/boil-gl";
import { groupBoxLogical } from "../lib/cell-ink";

interface RenderOpts {
  /** Paint the project background color first. Default true. */
  drawBg?: boolean;
  /** Include reference layers. Default true (display); export passes false. */
  includeReference?: boolean;
  /** Line-boil warp for drawing layers. Omitted = no boil. */
  boil?: BoilConfig;
  /** Content version (bumped on every draw mutation) — forwarded to bounds cache. Default 0. */
  version?: number;
}

/** Draw `img` onto `ctx` (assumed at identity, DEVICE pixels) placed by `base` (device rect) + `t`. */
export function drawTransformed(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  base: { x: number; y: number; w: number; h: number },
  t: RefTransform,
  dpr: number,
): void {
  ctx.save();
  ctx.translate(base.x + base.w / 2 + t.dx * dpr, base.y + base.h / 2 + t.dy * dpr);
  ctx.rotate(t.rotation);
  ctx.scale(t.scale, t.scale);
  ctx.drawImage(img, -base.w / 2, -base.h / 2, base.w, base.h);
  ctx.restore();
}

/**
 * Draw a reference layer's media onto `ctx`, sized via containRect and placed by its transform.
 * ASSUMES `ctx` is at the identity transform and works in DEVICE pixels. The caller sets
 * `ctx.globalAlpha` (render path uses layer opacity; rasterize leaves it at 1). No-op for missing
 * or not-yet-loaded media.
 */
export function drawReferenceMedia(
  ctx: CanvasRenderingContext2D,
  layer: ReferenceLayer,
  docW: number,
  docH: number,
  dpr: number,
): void {
  if (layer.media.type === "missing") return;
  const size = mediaIntrinsicSize(layer.media);
  if (size.w === 0 || size.h === 0) return;
  const base = containRect(size.w, size.h, docW * dpr, docH * dpr);
  drawTransformed(ctx, layer.media.el, base, layer.transform, dpr);
}

/** Draw `cell` through cellT (about its content-box center) then layerT (about doc center) then
 *  groupT (about the group box center). DEVICE px. Outer args default to identity / full-doc. */
export function drawCellComposed(
  ctx: CanvasRenderingContext2D,
  cell: CanvasImageSource,
  wDev: number,
  hDev: number,
  layerT: RefTransform,
  cellT: RefTransform,
  cellBoxDev: { x: number; y: number; w: number; h: number },
  dpr: number,
  groupT: RefTransform = IDENTITY_TRANSFORM,
  groupBoxDev: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: wDev, h: hDev },
): void {
  ctx.save();
  if (!isIdentityTransform(groupT)) {
    const gcx = groupBoxDev.x + groupBoxDev.w / 2,
      gcy = groupBoxDev.y + groupBoxDev.h / 2;
    ctx.translate(gcx + groupT.dx * dpr, gcy + groupT.dy * dpr);
    ctx.rotate(groupT.rotation);
    ctx.scale(groupT.scale, groupT.scale);
    ctx.translate(-gcx, -gcy);
  }
  const dcx = wDev / 2,
    dcy = hDev / 2;
  ctx.translate(dcx + layerT.dx * dpr, dcy + layerT.dy * dpr);
  ctx.rotate(layerT.rotation);
  ctx.scale(layerT.scale, layerT.scale);
  ctx.translate(-dcx, -dcy);
  const ccx = cellBoxDev.x + cellBoxDev.w / 2,
    ccy = cellBoxDev.y + cellBoxDev.h / 2;
  ctx.translate(ccx + cellT.dx * dpr, ccy + cellT.dy * dpr);
  ctx.rotate(cellT.rotation);
  ctx.scale(cellT.scale, cellT.scale);
  ctx.translate(-ccx, -ccy);
  ctx.drawImage(cell, 0, 0);
  ctx.restore();
}

function scaleRect(r: { x: number; y: number; w: number; h: number }, k: number) {
  return { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k };
}

/** Resolve the outer group transform args for `layer`. Identity / full-doc when ungrouped or
 *  the group transform is identity. */
function groupComposeArgs(
  layer: Project["layers"][number],
  project: Project,
  frame: number,
  dpr: number,
  version: number,
): { groupT: RefTransform; groupBoxDev: { x: number; y: number; w: number; h: number } } {
  const g = groupOf(layer, project.groups);
  const t = groupTransform(g);
  const fullDocDev = { x: 0, y: 0, w: project.width * dpr, h: project.height * dpr };
  if (!g || isIdentityTransform(t)) return { groupT: IDENTITY_TRANSFORM, groupBoxDev: fullDocDev };
  const box = groupBoxLogical(g, project, frame, dpr, version);
  return { groupT: t, groupBoxDev: scaleRect(box, dpr) };
}

let boilScratch: HTMLCanvasElement | null = null;
function transformedCell(
  cell: HTMLCanvasElement,
  layerT: RefTransform,
  cellT: RefTransform,
  cellBoxDev: { x: number; y: number; w: number; h: number },
  wDev: number,
  hDev: number,
  dpr: number,
  groupT: RefTransform = IDENTITY_TRANSFORM,
  groupBoxDev: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: wDev, h: hDev },
): HTMLCanvasElement {
  if (!boilScratch) boilScratch = document.createElement("canvas");
  if (boilScratch.width !== wDev || boilScratch.height !== hDev) {
    boilScratch.width = wDev;
    boilScratch.height = hDev;
  }
  const c = boilScratch.getContext("2d")!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, wDev, hDev);
  drawCellComposed(c, cell, wDev, hDev, layerT, cellT, cellBoxDev, dpr, groupT, groupBoxDev);
  return boilScratch;
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
  boil?: BoilConfig,
  version = 0,
): void {
  const w = project.width * dpr,
    h = project.height * dpr;
  const layersById = new Map(project.layers.map((l) => [l.id, l]));
  const ops = buildFrameDrawList(project, frame, includeReference);

  // WebGL boil — composite every drawing layer inside ONE GL surface (displaced + blended in
  // z-order) and read it back exactly once (iOS Safari can't drawImage a GL canvas per-layer).
  // Reference layers are drawn in 2D below the drawing stack (the rotoscope case).
  if (boil && boilBegin(w, h)) {
    for (const op of ops) {
      const layer = layersById.get(op.layerId)!;
      if (op.kind === "ref" && layer.kind === "ref") {
        ctx.globalAlpha = op.opacity / 100;
        drawReferenceMedia(ctx, layer, project.width, project.height, dpr);
      }
    }
    for (const op of ops) {
      const layer = layersById.get(op.layerId)!;
      if (op.kind !== "draw" || layer.kind !== "draw") continue;
      const cell = layer.cells[op.keyframeIndex];
      if (cell.kind !== "key") continue;
      const strength = layer.boilStrength;
      const crisp =
        isCrispFrame(layer.cells, frame, boil.holdsOnly) ||
        strength <= 0 ||
        (boil.amount <= 0 && boil.weight <= 0);
      const seed = (frame % Math.max(1, boil.rate)) * 100003 + op.layerId * 9176;
      const cellT = cellTransform(cell);
      const { groupT, groupBoxDev } = groupComposeArgs(layer, project, frame, dpr, version);
      const bothId =
        isIdentityTransform(layer.transform) &&
        isIdentityTransform(cellT) &&
        isIdentityTransform(groupT);
      const boxDev = isIdentityTransform(cellT)
        ? { x: 0, y: 0, w, h }
        : scaleRect(cell.transformBox!, dpr);
      const src = bothId
        ? cell.canvas
        : transformedCell(
            cell.canvas,
            layer.transform,
            cellT,
            boxDev,
            w,
            h,
            dpr,
            groupT,
            groupBoxDev,
          );
      boilLayer(
        src,
        op.opacity / 100,
        crisp ? 0 : boil.amount * strength,
        boil.cols,
        crisp ? 0 : boil.weight * strength,
        seed,
      );
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
      const cellT = cellTransform(cell);
      const { groupT, groupBoxDev } = groupComposeArgs(layer, project, frame, dpr, version);
      const layerId = isIdentityTransform(layer.transform),
        cellId = isIdentityTransform(cellT),
        groupId = isIdentityTransform(groupT);
      if (layerId && cellId && groupId) ctx.drawImage(cell.canvas, 0, 0);
      else {
        const boxDev = cellId
          ? { x: 0, y: 0, w: project.width * dpr, h: project.height * dpr }
          : scaleRect(cell.transformBox!, dpr);
        drawCellComposed(
          ctx,
          cell.canvas,
          project.width * dpr,
          project.height * dpr,
          layer.transform,
          cellT,
          boxDev,
          dpr,
          groupT,
          groupBoxDev,
        );
      }
    } else if (op.kind === "ref" && layer.kind === "ref") {
      ctx.globalAlpha = op.opacity / 100;
      drawReferenceMedia(ctx, layer, project.width, project.height, dpr);
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
  opts: RenderOpts = {},
): void {
  const { drawBg = true, includeReference = true, boil, version = 0 } = opts;

  // Reset to identity first so clearRect/fillRect/drawImage operate in raw device
  // pixels regardless of any transform the context carried in.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, project.width * dpr, project.height * dpr);

  if (drawBg) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = project.bgColor;
    ctx.fillRect(0, 0, project.width * dpr, project.height * dpr);
  }

  compositeFrameLayers(ctx, project, frame, dpr, includeReference, boil, version);
}
