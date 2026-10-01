/**
 * Stamp-based brush engine.
 * Draws incrementally — only new points since last call.
 */

import type { InputPoint } from "./input";
import type { BrushSettings } from "./brush";
import { widthRange } from "./brush";
import { getTip, type BrushType } from "./brush-textures";

export interface StampBrushSettings extends BrushSettings {
  brushType: BrushType;
}

/** Pencil grades, hardest first, as on real graphite pencils (2026-10-01). */
export const PENCIL_GRADES = ["4H", "2H", "HB", "2B", "4B", "6B", "8B"] as const;
export type PencilGrade = (typeof PENCIL_GRADES)[number];

/** What a grade does to the Pencil: `strength` scales every stamp's alpha (a hard pencil is
 *  lighter), `floor` is how dark the lightest touch already is (a soft one is dark even when barely
 *  pressed; the stamp's pressure alpha runs `floor` → 1), `grain` how much paper shows through the
 *  tip (soft graphite fills the paper's tooth). HB is the Pencil as it was: strength 1, floor 0.5
 *  (the stamp engine's old `0.5 + p × 0.5`), grain 1. An unknown grade is HB. */
export function pencilGrade(grade: string | undefined): {
  strength: number;
  floor: number;
  grain: number;
} {
  switch (grade) {
    case "4H":
      return { strength: 0.55, floor: 0.3, grain: 1.3 };
    case "2H":
      return { strength: 0.75, floor: 0.4, grain: 1.15 };
    case "2B":
      return { strength: 1, floor: 0.62, grain: 0.8 };
    case "4B":
      return { strength: 1, floor: 0.72, grain: 0.6 };
    case "6B":
      return { strength: 1, floor: 0.8, grain: 0.45 };
    case "8B":
      return { strength: 1, floor: 0.88, grain: 0.3 };
    default:
      return { strength: 1, floor: 0.5, grain: 1 };
  }
}

/**
 * Below this box size a 64px tip downsamples to alpha 0 (Chrome samples a couple of texels in the
 * transparent corner), so the stamp draws nothing at all. Measured in slop-animator.
 */
export const MIN_STAMP_PX = 2;

/**
 * The box to stamp into, and how far to fade it. A width under the floor is drawn AT the floor
 * with alpha scaled down in proportion, so a thin stroke fades instead of disappearing.
 */
export function stampFootprint(width: number): { drawSize: number; alphaScale: number } {
  const w = Math.max(0, width);
  if (w >= MIN_STAMP_PX) return { drawSize: w, alphaScale: 1 };
  return { drawSize: MIN_STAMP_PX, alphaScale: w / MIN_STAMP_PX };
}

// Track how many points we've already drawn for incremental stamping
let lastStampCount = 0;
/** Distance travelled since the last stamp, carried across segments AND calls (each pointermove
 *  is one call): reset per call, it stamped at least once per input segment, whatever the size. */
let sinceLastStamp = 0;

/**
 * Where to stamp along one segment of length `segLen`, `step` apart, when `since` has been
 * travelled since the last stamp: the positions, and the distance left over for the next segment.
 */
export function spaceStamps(
  segLen: number,
  step: number,
  since: number,
): { positions: number[]; since: number } {
  const positions: number[] = [];
  for (let pos = Math.max(0, step - since); pos <= segLen; pos += step) positions.push(pos);
  const last = positions[positions.length - 1];
  return { positions, since: last === undefined ? since + segLen : segLen - last };
}
/**
 * Which mip level to stamp from (2026-10-01): `sizes` largest first (the tip halved down to 4 px),
 * the smallest that is still at least `devicePx` — so no stamp is shrunk more than 2×. Stamping a
 * 2–4 px brush straight from the 64 px tip sampled a handful of its texels, so each stamp's
 * coverage jumped with the grain: small Pencil and Charcoal strokes came out beaded and jagged
 * (most visibly at 1× layers, as on iPad). Each level is the one above shrunk by half, which
 * averages it properly.
 */
export function mipIndex(devicePx: number, sizes: readonly number[]): number {
  let i = 0;
  while (i + 1 < sizes.length && sizes[i + 1] >= devicePx) i++;
  return i;
}

/**
 * Stamps this small (in device px) are drawn as two soft discs, not the tip image (2026-10-01).
 * On iPad small Pencil strokes still came out dashed and beaded after the mip levels — a tiny
 * image draw there seems to land on whole pixels (the GPU canvas; not reproducible in software
 * WebKit), so stamps 1–2 px apart clumped into a pattern. A filled arc is antialiased at its
 * sub-pixel position on every renderer, and at this size the grain is finer than a pixel anyway.
 */
export const SMALL_STAMP_PX = 8;

/** A tip's darkness as two rings, for the disc stand-in: mean alpha (0–1) inside 0.6 of the
 *  radius, and between 0.6 and 1. `alpha` is the tip's alpha channel, `size`×`size`, row by row. */
export function discProfile(
  alpha: ArrayLike<number>,
  size: number,
): { inner: number; outer: number } {
  const r = size / 2;
  let inner = 0;
  let nIn = 0;
  let outer = 0;
  let nOut = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
      if (d > 1) continue;
      const a = alpha[y * size + x] / 255;
      if (d < 0.6) {
        inner += a;
        nIn++;
      } else {
        outer += a;
        nOut++;
      }
    }
  }
  return { inner: nIn ? inner / nIn : 0, outer: nOut ? outer / nOut : 0 };
}

/** The tinted tip and its halvings down to 4 px, largest first. */
let tintedTip: HTMLCanvasElement[] | null = null;
/** The tinted tip's two-ring darkness, for small stamps. */
let tintedProfile = { inner: 1, outer: 1 };
let tintedColor = "";
let tintedType: BrushType | null = null;
let tintedGrain = 1;
let tintedTexture: string | undefined;

export function resetStampState() {
  lastStampCount = 0;
  sinceLastStamp = 0;
  tintedTip = null;
}

function getTintedTip(
  type: BrushType,
  color: string,
  grain = 1,
  texture?: string,
): HTMLCanvasElement[] {
  if (
    tintedTip &&
    tintedColor === color &&
    tintedType === type &&
    tintedGrain === grain &&
    tintedTexture === texture
  ) {
    return tintedTip;
  }

  const tip = getTip(type, grain, texture);
  const cvs = document.createElement("canvas");
  cvs.width = tip.width;
  cvs.height = tip.height;
  const ctx = cvs.getContext("2d")!;
  ctx.drawImage(tip, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, cvs.width, cvs.height);

  const levels = [cvs];
  for (let size = cvs.width / 2; size >= 4; size /= 2) {
    const half = document.createElement("canvas");
    half.width = size;
    half.height = size;
    const hctx = half.getContext("2d")!;
    hctx.imageSmoothingQuality = "high";
    hctx.drawImage(levels[levels.length - 1], 0, 0, size, size);
    levels.push(half);
  }

  const data = ctx.getImageData(0, 0, cvs.width, cvs.height).data;
  const alpha = new Uint8ClampedArray(cvs.width * cvs.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  tintedProfile = discProfile(alpha, cvs.width);

  tintedTip = levels;
  tintedColor = color;
  tintedType = type;
  tintedGrain = grain;
  tintedTexture = texture;
  return levels;
}

/**
 * Draw new stamps incrementally onto ctx.
 * Call resetStampState() at stroke start.
 */
export function drawStampStrokeIncremental(
  ctx: CanvasRenderingContext2D,
  points: InputPoint[],
  settings: StampBrushSettings,
  sizeRange: number = 1.0,
  spacing: number = 0.15,
) {
  if (points.length === 0) return;

  const { min: minSize, max: maxSize } = widthRange(settings.size, sizeRange);
  // The Pencil's grade (HB for every other tip: the original numbers).
  const grade = pencilGrade(settings.brushType === "pencil" ? settings.pencilGrade : undefined);
  const tips = getTintedTip(
    settings.brushType,
    settings.color,
    grade.grain,
    settings.brushType === "charcoal" ? settings.charcoalTexture : undefined,
  );
  const tipSizes = tips.map((t) => t.width);
  // Stamps are sized in document units; the layer's transform scales them to device pixels.
  const m = ctx.getTransform();
  const toDevice = Math.hypot(m.a, m.b);
  const profile = tintedProfile;
  // The outer disc at the ring's darkness, then the inner one adding up to the centre's.
  const innerOver =
    profile.outer < 1 ? Math.max(0, (profile.inner - profile.outer) / (1 - profile.outer)) : 0;
  ctx.fillStyle = settings.color;
  /** One stamp, at the alpha already set: small ones as two soft discs, larger ones from the
   *  tip's mip level. */
  const stamp = (x: number, y: number, drawSize: number) => {
    if (drawSize * toDevice > SMALL_STAMP_PX) {
      const tip = tips[mipIndex(drawSize * toDevice, tipSizes)];
      // A random turn per stamp (2026-10-01): every stamp is the same tip, so unturned its holes
      // land in the same place each time and line up into rows along the stroke (Charcoal showed
      // it most). Turned about the stamp's centre via the transform: the layer's own (`m`) times
      // a translate to (x, y) and a rotation — cheaper than save/translate/rotate/restore.
      const t = Math.random() * Math.PI * 2;
      const cos = Math.cos(t);
      const sin = Math.sin(t);
      ctx.setTransform(
        m.a * cos + m.c * sin,
        m.b * cos + m.d * sin,
        m.c * cos - m.a * sin,
        m.d * cos - m.b * sin,
        m.a * x + m.c * y + m.e,
        m.b * x + m.d * y + m.f,
      );
      ctx.drawImage(tip, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
      ctx.setTransform(m);
      return;
    }
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * profile.outer;
    ctx.beginPath();
    ctx.arc(x, y, drawSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = a * innerOver;
    ctx.beginPath();
    ctx.arc(x, y, drawSize * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = a;
  };
  // A mouse has no pressure (reported 0): its width is already the nominal one, and its alpha
  // mustn't take the light-pressure half either — mouse stamps drew at half the chosen opacity.
  const hasPressure = points[0].hasPressure ?? true;
  const pressureAlpha = (p: number) =>
    grade.strength * (hasPressure ? grade.floor + p * (1 - grade.floor) : 1);

  ctx.save();
  if (settings.isEraser) {
    ctx.globalCompositeOperation = "destination-out";
  } else if (settings.alphaLock) {
    ctx.globalCompositeOperation = "source-atop";
  } else if (settings.drawBehind) {
    ctx.globalCompositeOperation = "destination-over";
  } else {
    ctx.globalCompositeOperation = "source-over";
  }

  // Only process points we haven't stamped yet
  const startIdx = Math.max(0, lastStampCount - 1);
  const newPoints = points.slice(startIdx);

  if (newPoints.length < 2 && lastStampCount > 0) {
    ctx.restore();
    return;
  }

  // If first stroke point, stamp it
  if (lastStampCount === 0 && newPoints.length > 0) {
    const p = newPoints[0];
    const { drawSize, alphaScale } = stampFootprint(minSize + p.pressure * (maxSize - minSize));
    ctx.globalAlpha = (settings.opacity / 100) * pressureAlpha(p.pressure) * alphaScale;
    stamp(p.x, p.y, drawSize);
    sinceLastStamp = 0;
  }

  // Stamp along new segments
  for (let i = 1; i < newPoints.length; i++) {
    const prev = newPoints[i - 1];
    const curr = newPoints[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen === 0) continue;

    const avgSize = minSize + ((prev.pressure + curr.pressure) / 2) * (maxSize - minSize);
    const stepSize = Math.max(1, avgSize * spacing);

    const spaced = spaceStamps(segLen, stepSize, sinceLastStamp);
    for (const pos of spaced.positions) {
      const t = pos / segLen;
      const x = prev.x + dx * t;
      const y = prev.y + dy * t;
      const p = prev.pressure + (curr.pressure - prev.pressure) * t;
      const { drawSize, alphaScale } = stampFootprint(minSize + p * (maxSize - minSize));
      ctx.globalAlpha = (settings.opacity / 100) * pressureAlpha(p) * alphaScale;
      stamp(x, y, drawSize);
    }
    sinceLastStamp = spaced.since;
  }

  lastStampCount = points.length;
  ctx.restore();
}
