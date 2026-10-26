/**
 * Blend brush (2026-10-23): moves the paint already on the layer instead of laying down colour.
 * Stamp-based and incremental, as the stamp tips (`stamp-brush.ts`): only new points are drawn.
 *
 * Each dab reads the layer under it, mixes that into the paint the brush carries (`load`), and
 * puts the load back through the tip's mask. Smear sets how far the load carries: at 0 the brush
 * picks up fresh paint at every dab and blurs it, so it blurs in place; higher it carries the
 * paint along the stroke — a smudge, then a long smear. The tip's mask gives the edge texture.
 * It never adds the brush colour: a Colour slider that mixed it in (as Photoshop's Mixer brush)
 * was dropped the same day — it made Blend a paint brush too, and how much colour came through
 * depended on Smear (about 20% at Smear 0, 90% at 100).
 *
 * Works in the layer's DEVICE pixels, with whole-pixel dab positions, so a dab reads and writes the
 * same pixels with no resampling. Every write to the layer is a canvas draw, so a marquee's clip on
 * the layer context applies to it; only the blur runs in JS (`boxBlur3`).
 */

import type { InputPoint } from "./input";
import { widthRange, type BrushSettings } from "./brush";
import { blendTip } from "./brush-textures";
import { spaceStamps, mipIndex } from "./stamp-brush";

/** Dabs are this share of their width apart (the stamp tips use 0.15; a smear needs them closer,
 *  or it shows each dab's edge). */
export const BLEND_SPACING = 0.1;

/** How far the load carries, in dab widths, before it falls to 1/e, at Smear 100. */
export const MAX_CARRY_WIDTHS = 4;
/** How far the blur reaches at Smear 0, as a share of the dab's width. */
export const MAX_BLUR_SHARE = 0.25;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * One dab's mixing, for Smear (0–100) when the dab is `stepShare` of its width past the
 * last one: `keep`, how much of the load stays (the rest is picked up from under the dab; 0 =
 * a fresh pick-up, which is the blur); `blur`, the blur radius as a share of the dab's width (none
 * at Smear 100, where the smear itself softens). `keep` follows the step, so a dab spaced further apart (a tiny brush, whose step is
 * at least a pixel) carries as far along the page.
 */
export function blendMix(smear: number, stepShare: number): { keep: number; blur: number } {
  const s = clamp01(smear / 100);
  const carry = MAX_CARRY_WIDTHS * s * s;
  const step = Math.max(0, stepShare);
  return {
    keep: carry > 0 ? Math.exp(-step / carry) : 0,
    blur: MAX_BLUR_SHARE * (1 - s) * (1 - s),
  };
}

/** A dab's strength (0–1): Opacity, times the pen's pressure (with a floor, so a light touch still
 *  blends a little); a mouse (no pressure) blends at Opacity. */
export function blendStrength(opacity: number, pressure: number, hasPressure: boolean): number {
  const o = clamp01(opacity / 100);
  return hasPressure ? o * (0.2 + 0.8 * clamp01(pressure)) : o;
}

/** RGBA bytes (as `getImageData` gives them) to premultiplied floats in `out`, which holds at
 *  least as many values: blurred unpremultiplied, a transparent pixel's black would darken the
 *  edge of the paint next to it. */
export function toPremultiplied(data: ArrayLike<number>, out: Float32Array, n = data.length) {
  for (let i = 0; i < n; i += 4) {
    const a = data[i + 3];
    const f = a / 255;
    out[i] = data[i] * f;
    out[i + 1] = data[i + 1] * f;
    out[i + 2] = data[i + 2] * f;
    out[i + 3] = a;
  }
}

/** Premultiplied floats back to RGBA bytes in `data` (`n` values). */
export function fromPremultiplied(f: Float32Array, data: Uint8ClampedArray, n = data.length) {
  for (let i = 0; i < n; i += 4) {
    const a = f[i + 3];
    if (a <= 0) {
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
      continue;
    }
    const k = 255 / a;
    data[i] = f[i] * k;
    data[i + 1] = f[i + 1] * k;
    data[i + 2] = f[i + 2] * k;
    data[i + 3] = a;
  }
}

/** The mean of each `k`×`k` block of RGBA bytes (`w`×`h`, both multiples of `k`), premultiplied,
 *  into `out` ((w/k)×(h/k) pixels). Every block counts whole, so no paint is lost or added. */
export function shrinkPremultiplied(
  data: ArrayLike<number>,
  w: number,
  h: number,
  k: number,
  out: Float32Array,
) {
  const sw = w / k;
  const sh = h / k;
  const n = sw * sh * 4;
  out.fill(0, 0, n);
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / k) * sw;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = (row + Math.floor(x / k)) * 4;
      const f = data[i + 3] / 255;
      out[o] += data[i] * f;
      out[o + 1] += data[i + 1] * f;
      out[o + 2] += data[i + 2] * f;
      out[o + 3] += data[i + 3];
    }
  }
  const inv = 1 / (k * k);
  for (let i = 0; i < n; i++) out[i] *= inv;
}

/**
 * Blur premultiplied RGBA floats (`w`×`h`) in place: three box blurs of radius `r` across and
 * down, which is close to a Gaussian (σ² = r(r+1)) and reaches 3r. Past the edge
 * counts as transparent, so with 3r of padding round the paint none of it is lost. `tmp` holds
 * at least w×h×4 values. Done here rather than by shrinking and growing a canvas: a browser's
 * "high" quality shrink doesn't keep the paint (WebKit lost 4–11% a time, Chromium gained up to
 * 5%), and over the many overlapping dabs a blur stroke turned a line grey.
 */
export function boxBlur3(f: Float32Array, w: number, h: number, r: number, tmp: Float32Array) {
  if (r < 1) return;
  const inv = 1 / (2 * r + 1);
  /** One box pass along lines of `len` values `step` apart, `lines` of them `lineStep` apart. */
  const pass = (
    src: Float32Array,
    dst: Float32Array,
    lines: number,
    lineStep: number,
    len: number,
    step: number,
  ) => {
    for (let l = 0; l < lines; l++) {
      const base = l * lineStep;
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let s3 = 0;
      for (let j = 0; j <= Math.min(r, len - 1); j++) {
        const i = base + j * step;
        s0 += src[i];
        s1 += src[i + 1];
        s2 += src[i + 2];
        s3 += src[i + 3];
      }
      for (let j = 0; j < len; j++) {
        const o = base + j * step;
        dst[o] = s0 * inv;
        dst[o + 1] = s1 * inv;
        dst[o + 2] = s2 * inv;
        dst[o + 3] = s3 * inv;
        const add = j + r + 1;
        if (add < len) {
          const i = base + add * step;
          s0 += src[i];
          s1 += src[i + 1];
          s2 += src[i + 2];
          s3 += src[i + 3];
        }
        const drop = j - r;
        if (drop >= 0) {
          const i = base + drop * step;
          s0 -= src[i];
          s1 -= src[i + 1];
          s2 -= src[i + 2];
          s3 -= src[i + 3];
        }
      }
    }
  };
  for (let k = 0; k < 3; k++) {
    pass(f, tmp, h, w * 4, w, 4);
    pass(tmp, f, w, 4, h, w * 4);
  }
}

/** The blur for a dab `d` device px wide at `share` of its width (`blendMix().blur`): `radius`, each
 *  box pass's radius in px of the (shrunk) copy; `k`, how much it is shrunk first — a large dab is
 *  blurred at 1/k size, so the cost stays near a ~4 px radius's; `pad`, the margin read round the
 *  dab (the blur's reach, so the paint near it counts); `size`, the side of the region read, a
 *  multiple of `k`. `radius` 0 = no blur. */
export function blurPlan(
  d: number,
  share: number,
): { radius: number; k: number; pad: number; size: number } {
  const b = Math.round((share * d) / 3);
  if (b < 1) return { radius: 0, k: 1, pad: 0, size: d };
  const k = Math.max(1, Math.floor(b / 4));
  const radius = Math.max(1, Math.round(b / k));
  const pad = 3 * radius * k;
  const size = Math.ceil((d + 2 * pad) / k) * k;
  return { radius, k, pad, size };
}

/** Float buffers for the blur, kept between dabs (a pair per dab was garbage for the collector). */
let blurBuf = new Float32Array(0);
let blurTmp = new Float32Array(0);

// --- Per-stroke state (one stroke at a time, as the stamp engine) ---
let lastCount = 0;
let sinceLast = 0;
/** The paint the brush carries, at the stroke's widest dab (`loadSize` device px a side). */
let load: HTMLCanvasElement | null = null;
let loadSize = 0;
let loaded = false;
/** Scratch canvases: the layer under a dab (padded for the blur), the blur's small copy, the
 *  dab's mask, and the load cut to the mask. */
let under: HTMLCanvasElement | null = null;
let small: HTMLCanvasElement | null = null;
let mask: HTMLCanvasElement | null = null;
let dab: HTMLCanvasElement | null = null;
/** The tip and its halvings down to 4 px, largest first, for the tip in `mipTip`. */
let mips: HTMLCanvasElement[] = [];
let mipTip = "";

/** Start a stroke afresh (call at the press). */
export function resetBlendState() {
  lastCount = 0;
  sinceLast = 0;
  loaded = false;
}

/** Let go of the scratch canvases (the stroke's end): WebKit holds a canvas's pixels until it is
 *  collected, so size 0 first. */
export function releaseBlendState() {
  for (const c of [load, under, small, mask, dab]) releaseCanvas(c);
  blurBuf = new Float32Array(0);
  blurTmp = new Float32Array(0);
  load = under = small = mask = dab = null;
  loadSize = 0;
  loaded = false;
}

/** A scratch canvas at least `w`×`h`, kept between dabs; the layers are CPU canvases
 *  (`willReadFrequently`), so these are too, or every copy would cross to the GPU and back. */
function scratch(c: HTMLCanvasElement | null, w: number, h: number): HTMLCanvasElement {
  const cvs = c ?? document.createElement("canvas");
  if (cvs.width < w || cvs.height < h) {
    cvs.width = Math.max(cvs.width, w);
    cvs.height = Math.max(cvs.height, h);
    cvs.getContext("2d", { willReadFrequently: true });
  }
  return cvs;
}

const ctx2d = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: true })!;

function tipMips(tip: string | undefined): HTMLCanvasElement[] {
  const key = tip ?? "soft";
  if (mipTip === key && mips.length) return mips;
  const top = blendTip(key);
  const levels = [top];
  for (let size = top.width / 2; size >= 4; size /= 2) {
    const half = document.createElement("canvas");
    half.width = size;
    half.height = size;
    const h = half.getContext("2d")!;
    h.imageSmoothingQuality = "high";
    h.drawImage(levels[levels.length - 1], 0, 0, size, size);
    levels.push(half);
  }
  mips = levels;
  mipTip = key;
  return levels;
}

/**
 * Draw the stroke's new dabs onto `ctx` (a layer's context, its clip set by the caller).
 * Call `resetBlendState()` at the press and pass `done` at the release.
 */
export function drawBlendStrokeIncremental(
  ctx: CanvasRenderingContext2D,
  points: InputPoint[],
  settings: BrushSettings,
  sizeRange = 1,
  done = false,
) {
  if (points.length === 0) return;
  const m = ctx.getTransform();
  const toDevice = Math.hypot(m.a, m.b);
  const { min: minSize, max: maxSize } = widthRange(settings.size, sizeRange);
  const hasPressure = points[0].hasPressure ?? true;
  const tips = tipMips(settings.blendTip);
  const tipSizes = tips.map((t) => t.width);
  // A grainy tip is turned at random per dab, or its holes line up into rows along the stroke.
  const turn = settings.blendTip === "grain" || settings.blendTip === "rough";

  if (lastCount === 0) {
    loadSize = Math.max(2, Math.ceil(maxSize * toDevice));
    load = scratch(load, loadSize, loadSize);
    loaded = false;
  }

  ctx.save();
  // Device pixels from here; the caller's clip stays (it is kept in device space).
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const blendDab = (x: number, y: number, pressure: number, stepShare: number) => {
    const width = (minSize + pressure * (maxSize - minSize)) * toDevice;
    const d = Math.max(2, Math.round(width));
    const cx = m.a * x + m.c * y + m.e;
    const cy = m.b * x + m.d * y + m.f;
    const x0 = Math.round(cx - d / 2);
    const y0 = Math.round(cy - d / 2);
    const mix = blendMix(settings.blendSmear ?? 30, stepShare);
    const blur = blurPlan(d, mix.blur);
    const { pad, size: u } = blur;

    // 1. The layer under the dab (with room round it for the blur); off the canvas reads as
    //    transparent. Read, not drawn from the layer: WebKit copies a whole changed canvas to draw
    //    from it, ~5 ms a dab on a 2× layer (a 3840×2160 copy each time).
    under = scratch(under, u, u);
    const uc = ctx2d(under);
    uc.globalCompositeOperation = "source-over";
    uc.globalAlpha = 1;
    const img = ctx.getImageData(x0 - pad, y0 - pad, u, u);

    // 2. Blur (`boxBlur3`), on a copy shrunk by `k` for a large dab, grown back by the canvas.
    if (blur.radius === 0) {
      uc.putImageData(img, 0, 0);
    } else {
      const sw = u / blur.k;
      const n = sw * sw * 4;
      if (blurBuf.length < n) {
        blurBuf = new Float32Array(n);
        blurTmp = new Float32Array(n);
      }
      if (blur.k === 1) {
        toPremultiplied(img.data, blurBuf);
        boxBlur3(blurBuf, u, u, blur.radius, blurTmp);
        fromPremultiplied(blurBuf, img.data);
        uc.putImageData(img, 0, 0);
      } else {
        shrinkPremultiplied(img.data, u, u, blur.k, blurBuf);
        boxBlur3(blurBuf, sw, sw, blur.radius, blurTmp);
        const out = new ImageData(sw, sw);
        fromPremultiplied(blurBuf, out.data);
        small = scratch(small, sw, sw);
        ctx2d(small).putImageData(out, 0, 0);
        uc.imageSmoothingEnabled = true;
        uc.globalCompositeOperation = "copy";
        uc.drawImage(small, 0, 0, sw, sw, 0, 0, u, u);
        uc.globalCompositeOperation = "source-over";
      }
    }

    // 3. Mix it into the load: load × keep + under × (1 − keep), as premultiplied colour — the
    //    `destination-out` scales everything the load holds, the `lighter` adds the pick-up.
    const lc = ctx2d(load!);
    lc.imageSmoothingEnabled = true;
    if (!loaded) {
      lc.globalAlpha = 1;
      lc.globalCompositeOperation = "copy";
      lc.drawImage(under, pad, pad, d, d, 0, 0, loadSize, loadSize);
      loaded = true;
    } else if (mix.keep < 1) {
      const take = 1 - mix.keep;
      lc.globalAlpha = take;
      lc.globalCompositeOperation = "destination-out";
      lc.fillRect(0, 0, loadSize, loadSize);
      lc.globalCompositeOperation = "lighter";
      lc.drawImage(under, pad, pad, d, d, 0, 0, loadSize, loadSize);
    }

    // 4. The dab's mask: the tip at its size (from the mip level that shrinks it least).
    mask = scratch(mask, d, d);
    const mc = ctx2d(mask);
    mc.setTransform(1, 0, 0, 1, 0, 0);
    mc.globalCompositeOperation = "source-over";
    mc.clearRect(0, 0, d, d);
    mc.imageSmoothingEnabled = true;
    mc.imageSmoothingQuality = "high";
    const tip = tips[mipIndex(d, tipSizes)];
    if (turn) {
      const t = Math.random() * Math.PI * 2;
      mc.setTransform(Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), d / 2, d / 2);
      mc.drawImage(tip, -d / 2, -d / 2, d, d);
      mc.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      mc.drawImage(tip, 0, 0, d, d);
    }

    // 5. The load cut to the mask.
    dab = scratch(dab, d, d);
    const dc = ctx2d(dab);
    dc.globalAlpha = 1;
    dc.imageSmoothingEnabled = true;
    dc.globalCompositeOperation = "copy";
    dc.drawImage(load!, 0, 0, loadSize, loadSize, 0, 0, d, d);
    dc.globalCompositeOperation = "destination-in";
    dc.drawImage(mask, 0, 0, d, d, 0, 0, d, d);

    // 6. Onto the layer: layer × (1 − a·mask) + load × a·mask, which can make it more see-through
    //    as well as less (smearing empty space into paint thins it). Alpha lock keeps the layer's
    //    alpha: the load's colour goes over it by the load's own alpha.
    const a = blendStrength(settings.opacity, pressure, hasPressure);
    if (a <= 0) return;
    ctx.globalAlpha = a;
    if (settings.alphaLock) {
      ctx.globalCompositeOperation = "source-atop";
      ctx.drawImage(dab, 0, 0, d, d, x0, y0, d, d);
    } else {
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(mask, 0, 0, d, d, x0, y0, d, d);
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(dab, 0, 0, d, d, x0, y0, d, d);
    }
  };

  const start = Math.max(0, lastCount - 1);
  const fresh = points.slice(start);
  if (lastCount === 0) {
    // The first dab picks up the load; drawn back, it changes nothing.
    blendDab(fresh[0].x, fresh[0].y, fresh[0].pressure, BLEND_SPACING);
    sinceLast = 0;
  }
  for (let i = 1; i < fresh.length; i++) {
    const prev = fresh[i - 1];
    const curr = fresh[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen === 0) continue;
    const width = minSize + ((prev.pressure + curr.pressure) / 2) * (maxSize - minSize);
    // At least one device pixel apart.
    const step = Math.max(1 / toDevice, width * BLEND_SPACING);
    const spaced = spaceStamps(segLen, step, sinceLast);
    for (const pos of spaced.positions) {
      const t = pos / segLen;
      blendDab(
        prev.x + dx * t,
        prev.y + dy * t,
        prev.pressure + (curr.pressure - prev.pressure) * t,
        step / Math.max(width, 1e-6),
      );
    }
    sinceLast = spaced.since;
  }
  lastCount = points.length;
  ctx.restore();
  if (done) releaseBlendState();
}

function releaseCanvas(c: HTMLCanvasElement | null) {
  if (!c) return;
  c.width = 0;
  c.height = 0;
}
