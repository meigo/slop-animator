// Line-boil prototype: a deterministic coarse mesh warp that wobbles a drawing's outlines
// slightly, so a held keyframe doesn't read as dead-static during playback. The warp is
// piecewise-affine over a low-resolution grid; the outer boundary vertices are pinned so the
// canvas edges don't gap. All randomness is hashed from a seed → reproducible per frame/layer.

export interface BoilConfig {
  amount: number; // max vertex displacement, device px
  cols: number;   // grid columns (coarse = low-frequency, organic; fine = melty)
  rate: number;   // number of distinct warps to cycle (1 = static, 2 = "on twos", 3 = "on threes")
  scale: number;  // max uniform scale jitter (fraction, e.g. 0.02 = ±2%) → line-weight "breathing"
}

export interface BoilOptions {
  amount: number;
  cols: number;
  scale: number;
  seed: number; // per-frame + per-layer
}

/** Integer hash → [-1, 1]. */
function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 0xffffffff) * 2 - 1;
}

/** Draw `src` warped onto `ctx` (device-pixel space, identity transform expected on entry). */
export function drawBoiled(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, w: number, h: number, o: BoilOptions): void {
  const cols = Math.max(2, o.cols | 0);
  const rows = Math.max(2, Math.round((cols * h) / w));
  const cw = w / cols;
  const ch = h / rows;

  // Uniform per-call scale (line-weight "breathing"): up ⇒ fatter lines, down ⇒ thinner.
  // Applied around the canvas centre AFTER the (edge-pinned) displacement.
  const cx = w / 2, cy = h / 2;
  const s = 1 + hash(7, 7, o.seed + 7777) * o.scale;

  // Displaced position of grid vertex (gx, gy). Boundary vertices aren't wobbled (so the
  // wobble can't gap the edges), but the uniform scale still applies to them.
  const dispX = (gx: number, gy: number): number => {
    const pinned = gx === 0 || gx === cols || gy === 0 || gy === rows;
    const base = gx * cw + (pinned ? 0 : hash(gx, gy, o.seed) * o.amount);
    return cx + (base - cx) * s;
  };
  const dispY = (gx: number, gy: number): number => {
    const pinned = gx === 0 || gx === cols || gy === 0 || gy === rows;
    const base = gy * ch + (pinned ? 0 : hash(gx, gy, o.seed + 5051) * o.amount);
    return cy + (base - cy) * s;
  };

  ctx.save();
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const sx0 = gx * cw, sy0 = gy * ch, sx1 = (gx + 1) * cw, sy1 = (gy + 1) * ch;
      const ax = dispX(gx, gy), ay = dispY(gx, gy);
      const bx = dispX(gx + 1, gy), by = dispY(gx + 1, gy);
      const cx = dispX(gx, gy + 1), cy = dispY(gx, gy + 1);
      const ex = dispX(gx + 1, gy + 1), ey = dispY(gx + 1, gy + 1);
      // Split the quad into two triangles and warp each.
      drawTri(ctx, src, sx0, sy0, sx1, sy0, sx1, sy1, ax, ay, bx, by, ex, ey);
      drawTri(ctx, src, sx0, sy0, sx1, sy1, sx0, sy1, ax, ay, ex, ey, cx, cy);
    }
  }
  ctx.restore();
}

const OUTSET = 0.5; // px: slightly enlarge each dest triangle so neighbours overlap (hides seams)

function drawTri(
  ctx: CanvasRenderingContext2D, src: HTMLCanvasElement,
  sax: number, say: number, sbx: number, sby: number, scx: number, scy: number,
  dax: number, day: number, dbx: number, dby: number, dcx: number, dcy: number,
): void {
  // Affine mapping the source triangle onto the destination triangle.
  const ux = sbx - sax, uy = sby - say, vx = scx - sax, vy = scy - say;
  const det = ux * vy - uy * vx;
  if (det === 0) return;
  const Ux = dbx - dax, Uy = dby - day, Vx = dcx - dax, Vy = dcy - day;
  const a = (Ux * vy - Vx * uy) / det;
  const b = (Uy * vy - Vy * uy) / det;
  const c = (Vx * ux - Ux * vx) / det;
  const d = (Vy * ux - Uy * vx) / det;
  const e = dax - a * sax - c * say;
  const f = day - b * sax - d * say;

  // Outset the clip triangle from its centroid to hide hairline seams.
  const gx = (dax + dbx + dcx) / 3, gy = (day + dby + dcy) / 3;
  const out = (x: number, y: number): [number, number] => {
    const dx = x - gx, dy = y - gy, len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * OUTSET, y + (dy / len) * OUTSET];
  };
  const [oax, oay] = out(dax, day), [obx, oby] = out(dbx, dby), [ocx, ocy] = out(dcx, dcy);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(oax, oay);
  ctx.lineTo(obx, oby);
  ctx.lineTo(ocx, ocy);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
}
