import { dilateMask, erodeMask } from "./mask-ops";

export interface FillEnclosedResult {
  /** w*h, 1 = part of the shape: ink, or a region the ink encloses. */
  mask: Uint8Array;
  inkArea: number;
  /** Area of the ink after dilation — the baseline the report compares against. */
  grownArea: number;
  insideArea: number;
}

/**
 * Treat space ENCLOSED by ink as part of the shape, so an outline-only drawing meshes as a body
 * rather than a thin web. Reads alpha, writes nothing: the artwork is never touched.
 *
 * `gap` bridges breaks in the outline of roughly 2×gap px (the dilated discs have to meet). The
 * ORDER below is load-bearing: closing the INK (dilate → erode) fails to bridge a 1px line at any
 * radius, because the erosion eats the join straight back out. Dilate, fill, then erode the SOLID
 * result — by then the mask is thick enough to survive erosion. See the spec's measured table.
 */
export function fillEnclosed(
  alpha: Uint8ClampedArray,
  w: number,
  h: number,
  opts: { alphaThreshold?: number; gap?: number } = {},
): FillEnclosedResult {
  const threshold = opts.alphaThreshold ?? 10;
  const gap = Math.max(0, Math.floor(opts.gap ?? 0));

  // Pad by gap+1: the pose lift is a TIGHT content bbox, so ink routinely touches all four edges.
  // Without a guaranteed clear ring the border flood has nowhere to start and everything reads as
  // inside.
  const p = gap + 1;
  const W = w + 2 * p,
    H = h + 2 * p;
  const ink = new Uint8Array(W * H);
  let inkArea = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[(y * w + x) * 4 + 3] > threshold) {
        ink[(y + p) * W + (x + p)] = 1;
        inkArea++;
      }
    }
  }

  const grown = dilateMask(ink, W, H, gap);
  let grownArea = 0;
  for (let i = 0; i < grown.length; i++) grownArea += grown[i];

  // Flood the outside from the padded border, travelling only through non-ink.
  const outside = new Uint8Array(W * H);
  const stack: number[] = [];
  const visit = (x: number, y: number) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = y * W + x;
    if (outside[i] || grown[i]) return;
    outside[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < W; x++) {
    visit(x, 0);
    visit(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    visit(0, y);
    visit(W - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % W,
      y = (i - x) / W;
    visit(x + 1, y);
    visit(x - 1, y);
    visit(x, y + 1);
    visit(x, y - 1);
  }

  let filled = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) filled[i] = outside[i] ? 0 : 1;
  const eroded = erodeMask(filled, W, H, gap); // undo the dilation's bloat, on a solid mask
  filled = new Uint8Array(eroded); // ensure consistent buffer type

  const mask = new Uint8Array(w * h);
  let insideArea = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pi = (y + p) * W + (x + p);
      // Union with the ink: erosion must never be able to eat the strokes themselves.
      if (filled[pi] || ink[pi]) {
        mask[y * w + x] = 1;
        insideArea++;
      }
    }
  }
  return { mask, inkArea, grownArea, insideArea };
}
