import { dilateMask, erodeMask } from "./mask-ops";

export interface FillEnclosedResult {
  /** w*h, 1 = part of the shape: ink, or a region the ink encloses. */
  mask: Uint8Array;
  inkArea: number;
  /** Area of the ink after dilation. Diagnostic only — see `outlineFillFailed` for why it is NOT a
   *  usable baseline for the report. */
  grownArea: number;
  insideArea: number;
  /** Area of the ink's bounding box (0 when there is no ink). `inkArea / inkBBoxArea` is how dense
   *  the art is inside its own extent — the signal that tells an OUTLINE from a filled shape. */
  inkBBoxArea: number;
  /** Mask pixels the ink did not already cover, bridging included (`mask \ grown`). This is the
   *  area the flood actually ENCLOSED: 0 means the fill achieved nothing. */
  enclosedArea: number;
}

/** Largest `gap` the fill accepts. The morphology is O(pixels × r²) and unseparated, so an
 *  unclamped value (a typed `50` in the number input) would block the main thread for minutes on a
 *  full-size lift — with the cell's pixels already cleared by the lift. */
export const MAX_GAP = 8;

/** Coerce anything a caller (or a number input, which writes `null` when emptied) might supply into
 *  an integer 0..MAX_GAP. */
export function clampGap(gap: unknown): number {
  const n = Math.floor(Number(gap));
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_GAP, Math.max(0, n));
}

/** Fraction of its own bounding box that ink may cover and still count as an OUTLINE. A solid
 *  silhouette measures ~1.0, a single stroke 1.0 along its own axis, the 15×15 test ring 0.33. */
export const OUTLINE_DENSITY_MAX = 0.4;

/**
 * Did the fill FAIL on art that actually wanted filling? Two conditions:
 *
 * 1. **The art must look like an outline** — sparse within its own bounding box. Without this, every
 *    drawing with NOTHING to fill (a filled silhouette, a single stroke) reports failure, and
 *    "raise Gap, or fill the shape" is then both wrong and unactionable.
 * 2. **The flood must have enclosed nothing at all.** Not `insideArea < grownArea * 1.1`, which the
 *    original spec proposed: `grownArea` counts dilation bloat that the erode then removes, so on a
 *    small shape it exceeds a SUCCESSFUL fill's area — a closed 15×15 ring at gap 2 fills perfectly
 *    (121 px, same as gap 0) yet measures 121 < 188×1.1, i.e. the remedy reports itself as failing.
 *    `enclosedArea` is the direct measurement instead, and a leak drives it to exactly 0.
 *
 * Deliberately conservative: a PARTIAL fill (one closed pocket, the body still leaking) does not
 * warn. A false alarm is the worse failure — it is sticky on iPad, where there is no hover to
 * replace it, and it displaces the pose bar's own guidance. Pure; the message lives in the UI.
 */
export function outlineFillFailed(r: FillEnclosedResult): boolean {
  if (r.inkArea === 0 || r.inkBBoxArea === 0) return false;
  if (r.inkArea >= OUTLINE_DENSITY_MAX * r.inkBBoxArea) return false; // filled art: nothing to fill
  return r.enclosedArea === 0;
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
  const gap = clampGap(opts.gap ?? 0); // clamped HERE, not at the caller: the cost is O(pixels × r²)

  // Pad by gap+1: the pose lift is a TIGHT content bbox, so ink routinely touches all four edges.
  // Without a guaranteed clear ring the border flood has nowhere to start and everything reads as
  // inside.
  const p = gap + 1;
  const W = w + 2 * p,
    H = h + 2 * p;
  const ink = new Uint8Array(W * H);
  let inkArea = 0;
  let minX = w,
    maxX = -1,
    minY = h,
    maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[(y * w + x) * 4 + 3] > threshold) {
        ink[(y + p) * W + (x + p)] = 1;
        inkArea++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const inkBBoxArea = maxX < 0 ? 0 : (maxX - minX + 1) * (maxY - minY + 1);

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
  let enclosedArea = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pi = (y + p) * W + (x + p);
      // Union with the ink: erosion must never be able to eat the strokes themselves.
      if (filled[pi] || ink[pi]) {
        mask[y * w + x] = 1;
        insideArea++;
        if (!grown[pi]) enclosedArea++; // gained beyond ink+bridging = genuinely enclosed
      }
    }
  }
  return { mask, inkArea, grownArea, insideArea, inkBBoxArea, enclosedArea };
}
