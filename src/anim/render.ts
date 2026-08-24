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
  groupTransformAt,
  transformAt,
  type Cell,
  type DrawingLayer,
  type Project,
  type BoilConfig,
  type ReferenceLayer,
  type RefTransform,
} from "./document";
import { boilBegin, boilLayer, boilBlit, boilWeightJitter } from "../core/boil-gl";
import { contentBoxLogical, groupBoxLogical } from "../lib/cell-ink";

interface RenderOpts {
  /** Paint the project background color first. Default true. */
  drawBg?: boolean;
  /** Include reference layers. Default true (display); export passes false. */
  includeReference?: boolean;
  /** Line-boil warp for drawing layers. Omitted = no boil. */
  boil?: BoilConfig;
  /** Content version (bumped on every draw mutation) — forwarded to bounds cache. Default 0. */
  version?: number;
  /** Extra backing-store scale (viewport zoom, capped). Export leaves this at 1. */
  outputScale?: number;
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
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, -base.w / 2, -base.h / 2, base.w, base.h);
  ctx.restore();
}

/**
 * Draw a reference layer's media onto `ctx`, sized via containRect and placed by its transform.
 * ASSUMES `ctx` is at the identity transform and works in DEVICE pixels. The caller sets
 * `ctx.globalAlpha` (render path uses layer opacity; rasterize leaves it at 1). No-op for missing
 * or not-yet-loaded media.
 *
 * When `project`, `frame`, and `version` are provided the layer's group transform (if any) is
 * applied as an outer wrap so reference layers follow their group — identical to drawing layers.
 * The extra params are optional so callers without a project context (e.g. rasterizeReference)
 * continue to work unchanged; those callers want the ref's own transform only.
 */
export function drawReferenceMedia(
  ctx: CanvasRenderingContext2D,
  layer: ReferenceLayer,
  docW: number,
  docH: number,
  dpr: number,
  project?: Project,
  frame?: number,
  version?: number,
): void {
  if (layer.media.type === "missing") return;
  const size = mediaIntrinsicSize(layer.media);
  if (size.w === 0 || size.h === 0) return;
  const base = containRect(size.w, size.h, docW * dpr, docH * dpr);
  const g = project ? groupOf(layer, project.groups) : null;
  // Frame-aware whenever a frame was supplied, exactly like `lt` below. Without a frame this call
  // is the legacy "just the ref's own transform" path, which the guard below then takes anyway.
  const groupT = frame == null ? groupTransform(g) : groupTransformAt(g, frame);
  const lt = frame == null ? layer.transform : transformAt(layer, frame);
  if (!g || isIdentityTransform(groupT) || frame == null || project == null) {
    drawTransformed(ctx, layer.media.el, base, lt, dpr);
    return;
  }
  const lb = groupBoxLogical(g, project, frame, dpr, version ?? 0);
  ctx.save();
  const gcx = lb.x * dpr + (lb.w * dpr) / 2,
    gcy = lb.y * dpr + (lb.h * dpr) / 2;
  ctx.translate(gcx + groupT.dx * dpr, gcy + groupT.dy * dpr);
  ctx.rotate(groupT.rotation);
  ctx.scale(groupT.scale, groupT.scale);
  ctx.translate(-gcx, -gcy);
  drawTransformed(ctx, layer.media.el, base, lt, dpr);
  ctx.restore();
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
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
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
  // The RENDER frame, not the playhead: `renderFrame` is called per exported/onion frame, so a
  // playhead read would paint every frame with the group's current pose.
  const t = groupTransformAt(g, frame);
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
 * Draw ONE drawing layer's key cell through its full `group ∘ layer ∘ cell` compose. DEVICE px,
 * `ctx` assumed at the identity transform.
 *
 * Extracted so the PSD export can reach the same geometry. It is the single most-revised
 * expression in this codebase — per-cell, then per-layer, then per-group, then animated via
 * `transformAt`/`groupTransformAt`, each revision landing right here — and a second copy of it
 * elsewhere would be invisible to `tsc` (two independently-valid call sites) and unreachable by
 * any test. The symptom of a drift is a layer drawn somewhere the editor never showed it.
 *
 * Does NOT touch `globalAlpha`: the caller owns it. The render path sets the drawlist opacity;
 * the PSD export leaves it at 1, because a PSD layer carries its opacity as a byte instead.
 *
 * The BOIL path deliberately keeps its own copy — it composes into a GL surface via
 * `transformedCell` rather than onto `ctx`, so it shares the arguments but not the call.
 */
export function drawLayerCell(
  ctx: CanvasRenderingContext2D,
  project: Project,
  layer: DrawingLayer,
  cell: Extract<Cell, { kind: "key" }>,
  frame: number,
  dpr: number,
  version = 0,
): void {
  const wDev = project.width * dpr,
    hDev = project.height * dpr;
  const cellT = cellTransform(cell);
  const layerT = transformAt(layer, frame);
  const { groupT, groupBoxDev } = groupComposeArgs(layer, project, frame, dpr, version);
  if (isIdentityTransform(layerT) && isIdentityTransform(cellT) && isIdentityTransform(groupT)) {
    ctx.drawImage(cell.canvas, 0, 0); // the crisp path: no resample at all
    return;
  }
  // The pivot box only matters when there is a rotation/scale to pivot ABOUT, so the identity
  // branch keeps the full doc. Otherwise `contentBoxLogical` answers it — the app's own ladder
  // (frozen box, else live content bounds, else full doc), and the box the gizmo pivots about, so
  // a cell carrying a `transform` with no `transformBox` (which the save format permits) composes
  // where the gizmo would put it instead of throwing part way through a render or an export.
  const cellBoxDev = isIdentityTransform(cellT)
    ? { x: 0, y: 0, w: wDev, h: hDev }
    : scaleRect(
        contentBoxLogical(
          cell.canvas,
          cell.transformBox,
          project.width,
          project.height,
          dpr,
          version,
        ),
        dpr,
      );
  drawCellComposed(
    ctx,
    cell.canvas,
    wDev,
    hDev,
    layerT,
    cellT,
    cellBoxDev,
    dpr,
    groupT,
    groupBoxDev,
  );
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
        drawReferenceMedia(ctx, layer, project.width, project.height, dpr, project, frame, version);
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
      const layerT = transformAt(layer, frame);
      const { groupT, groupBoxDev } = groupComposeArgs(layer, project, frame, dpr, version);
      const bothId =
        isIdentityTransform(layerT) && isIdentityTransform(cellT) && isIdentityTransform(groupT);
      const boxDev = isIdentityTransform(cellT)
        ? { x: 0, y: 0, w, h }
        : scaleRect(cell.transformBox!, dpr);
      const src = bothId
        ? cell.canvas
        : transformedCell(cell.canvas, layerT, cellT, boxDev, w, h, dpr, groupT, groupBoxDev);
      // Weight is passed as a SIGNED bias: the per-frame breathing jitter comes from the rate cycle,
      // which only this caller knows (boilLayer sees just the seed).
      const wjit = boilWeightJitter(frame, boil.rate, op.layerId);
      boilLayer(
        src,
        op.opacity / 100,
        crisp ? 0 : boil.amount * strength,
        boil.cols,
        crisp ? 0 : boil.weight * strength * wjit,
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
      drawLayerCell(ctx, project, layer, cell, frame, dpr, version);
    } else if (op.kind === "ref" && layer.kind === "ref") {
      ctx.globalAlpha = op.opacity / 100;
      drawReferenceMedia(ctx, layer, project.width, project.height, dpr, project, frame, version);
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
  const { drawBg = true, includeReference = true, boil, version = 0, outputScale = 1 } = opts;

  // outputScale supersamples the display so a CSS-zoomed, scaled-down layer still has
  // enough backing pixels (cell pixels aren't thrown away before the viewport magnifies).
  ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, project.width * dpr, project.height * dpr);

  if (drawBg) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = project.bgColor;
    ctx.fillRect(0, 0, project.width * dpr, project.height * dpr);
  }

  compositeFrameLayers(ctx, project, frame, dpr, includeReference, boil, version);
}
