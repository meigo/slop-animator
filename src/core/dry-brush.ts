import type { InputPoint } from "./input";
import type { BrushSettings } from "./brush";
import { widthRange } from "./brush";

/**
 * Dry brush (2026-10-01): a bristle brush running short of paint — parallel hair stripes along
 * the stroke, broken where the hairs run dry, with ragged edges.
 *
 * The stroke is many thin hairs side by side across its width. Each hair has its own place across
 * the width, thickness, ink load and noise. Along the stroke a hair leaves paint only where its
 * "presence" is above a threshold: its load, pressure (pressing harder brings more hairs into
 * contact), smooth noise along the arc (the dry breaks), and the paint running out over the
 * stroke's length. The outer hairs carry less paint and wander a little, and each hair touches
 * down a little later than its neighbours — the hairy edges and the splayed start.
 *
 * FULL REDRAW, like Ink and Calligraphy: the caller restores the pre-stroke copy and passes the
 * whole stroke each frame. So everything here must depend only on the stroke so far and a seed —
 * the path is resampled at a fixed arc-length step from its start, and the noise is a function of
 * arc length, so appending points never changes what is already drawn. The seed comes from the
 * stroke's first point, which doesn't change while it grows.
 */

/** Hairs across a stroke `width` px wide (the widest it gets): one per ~1.6 px, 5 to 48. */
export function bristleCount(width: number): number {
  return Math.max(5, Math.min(48, Math.round(width / 1.6)));
}

export interface Bristle {
  /** Place across the stroke, −1 (one edge) to 1 (the other). */
  offset: number;
  /** Thickness as a multiple of the hair spacing (width / count). */
  thickness: number;
  /** How much paint it carries, 0–1; the outer hairs carry less. */
  load: number;
  /** Arc length (in stroke widths) before this hair touches down — the splayed start. */
  lag: number;
  /** Arc length (in stroke widths) before the stroke's end where it lifts off — the frayed end.
   *  The end is wherever the pen is, so while drawing the tip frays as it goes. */
  tail: number;
  /** How dark it paints, 0–1: the hairs overlap, so this gives the stroke tone inside. */
  tone: number;
  /** Seeds its own noise. */
  key: number;
}

/** A small deterministic generator (mulberry32), so a stroke's hairs are the same every frame. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The stroke's seed: from its first point, which stays put while the stroke grows. */
export function strokeSeed(first: InputPoint): number {
  const h = Math.imul(Math.round(first.x * 16) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.round(first.y * 16);
  return Math.imul(h ^ Math.round(first.timestamp), 0xc2b2ae35) >>> 0 || 1;
}

/** `count` hairs, evenly spread across the width with a little jitter, outer ones drier. */
export function makeBristles(count: number, seed: number): Bristle[] {
  const r = rng(seed);
  const out: Bristle[] = [];
  for (let i = 0; i < count; i++) {
    const even = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
    const offset = Math.max(-1, Math.min(1, even + (r() - 0.5) * (1.6 / count)));
    const edge = Math.abs(offset);
    out.push({
      offset,
      thickness: 0.6 + r() * 0.7,
      // Few hairs (a narrow stroke) are nearly all edge: don't starve them.
      load: Math.max(0, 0.55 + r() * 0.45 - edge ** 3 * 0.35 * Math.min(1, count / 12)),
      lag: r() * (0.15 + edge * 0.6),
      tail: r() * (0.15 + edge * 0.6),
      // The outer hairs lighter, so the stroke fades a little at its edges (2026-10-01).
      tone: (0.85 + r() * 0.15) * (1 - 0.3 * edge * edge),
      key: Math.floor(r() * 2 ** 31),
    });
  }
  return out;
}

/** Smooth value noise in [0, 1] along `x`, one random value per integer, cosine-blended. */
export function noise1(key: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const t = (1 - Math.cos(f * Math.PI)) / 2;
  return lattice(key, i) * (1 - t) + lattice(key, i + 1) * t;
}

/** The noise's random value at integer `n`: `rng`'s first number for that seed, computed inline —
 *  the same values, without making two closures per noise sample (slop-animator's review,
 *  2026-10-01: it was most of the Dry brush's geometry time late in a long stroke). */
function lattice(key: number, n: number): number {
  const seed = (Math.imul(key ^ n, 0x27d4eb2d) ^ (n * 0x165667b1)) >>> 0;
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Whether hair `b` leaves paint at arc length `s` (px) with `pressure` 0–1. `width` is the
 *  stroke's widest, `dryness` 0–100, `edgeNow` how near the hair is to the stroke's CURRENT edge
 *  (0 the middle, 1 the edge; light pressure narrows the stroke, so a hair near the middle can be
 *  at its edge). Pure, so it can be tested and is the same every frame. */
export function hairPaints(
  b: Bristle,
  s: number,
  pressure: number,
  width: number,
  dryness: number,
  edgeNow: number = Math.abs(b.offset),
): boolean {
  const dry = Math.max(0, Math.min(100, dryness)) / 100;
  if (s < b.lag * width) return false;
  // A narrow stroke has few hairs, nearly all of them "edge": thin the edge only as it widens
  // (a 4 px stroke came out hollow and faint at Press 1).
  const edge = edgeNow * Math.min(1, width / 16);
  // Lengths ALONG the stroke scale with its width, but never below 24 px: scaled to a 4 px
  // stroke, the breaks came every ~10 px (dashes) and the paint ran out after ~100 px.
  const long = Math.max(width, 24);
  // Breaks every ~1–3 widths along a hair: a coarse noise for long dry runs, a fine one for grain.
  const coarse = noise1(b.key, s / (long * 2.5));
  const fine = noise1(b.key ^ 0x5bd1e995, s / (long * 0.6));
  // The paint runs out: over ~25 widths at Dryness 100, never at 0.
  const spent = dry > 0 ? Math.min(1, s / (long * (6 + 40 * (1 - dry)))) * dry * 0.4 : 0;
  // Light pressure: only the hair tips skim the paper, so more breaks; pressing hard flattens the
  // hairs onto it and the stroke fills in — as a real dry brush (2026-10-01).
  const contact = 0.4 + 0.6 * pressure;
  const presence = b.load * contact - spent + (coarse - 0.5) * 0.55 + (fine - 0.5) * 0.3;
  // Dryness raises the bar a hair has to clear; the edge raises it more.
  const threshold = -0.35 + dry * 0.7 + edge ** 2 * (0.1 + dry * 0.25);
  return presence > threshold;
}

/** The path resampled every `step` px of arc length from its start, with each sample's pressure
 *  and unit normal. A fixed grid from the start keeps the samples where they were as the stroke
 *  grows; the normal is taken over a window of a few samples so jitter doesn't twist the hairs. */
export function resample(
  points: readonly InputPoint[],
  step: number,
): { x: number; y: number; s: number; pressure: number; nx: number; ny: number }[] {
  const out: { x: number; y: number; s: number; pressure: number; nx: number; ny: number }[] = [];
  if (points.length === 0) return out;
  let next = 0;
  let s = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    while (next <= s + len) {
      const t = (next - s) / len;
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        s: next,
        pressure: a.pressure + (b.pressure - a.pressure) * t,
        nx: 0,
        ny: 0,
      });
      next += step;
    }
    s += len;
  }
  const w = 3;
  for (let i = 0; i < out.length; i++) {
    const p = out[Math.max(0, i - w)];
    const q = out[Math.min(out.length - 1, i + w)];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    out[i].nx = -dy / len;
    out[i].ny = dx / len;
  }
  return out;
}

/** Each hair's painted runs as polylines (x, y pairs), and its thickness in px. Pure. */
export function bristleRuns(
  points: readonly InputPoint[],
  size: number,
  sizeRange: number,
  dryness: number,
): { width: number; tone: number; runs: number[][] }[] {
  if (points.length < 2) return [];
  const { min, max } = widthRange(size, sizeRange);
  const count = bristleCount(max);
  const bristles = makeBristles(count, strokeSeed(points[0]));
  const step = Math.max(0.75, Math.min(4, max / 10));
  const samples = resample(points, step);
  const spacing = max / count;
  const end = samples.length ? samples[samples.length - 1].s : 0;
  // A mouse has no pressure (it reads 0): touch as a medium press, not the lightest.
  const mouse = points[0].hasPressure === false;
  return bristles.map((b) => {
    const runs: number[][] = [];
    let run: number[] | null = null;
    // The hairs keep their spacing: each sits at its place across the WIDEST stroke. Pressure
    // narrows the stroke, so only the hairs within it touch — fewer hairs, not the same hairs
    // squeezed together (which overlapped into a solid band at light pressure, the opposite of a
    // dry brush). 2026-10-01.
    const across = Math.abs(b.offset) * (max / 2);
    for (const p of samples) {
      const half = (min + p.pressure * (max - min)) / 2;
      const pressure = mouse ? 0.6 : p.pressure;
      const touching = across <= half + spacing / 2;
      const edgeNow = Math.min(1, across / Math.max(half, spacing));
      // The hairs near the edge wander a little across the stroke.
      const wander = (noise1(b.key ^ 0x68e31da4, p.s / (max * 1.5)) - 0.5) * edgeNow * 0.25;
      const o = b.offset * (max / 2) + wander * half;
      if (
        touching &&
        p.s <= end - b.tail * max &&
        hairPaints(b, p.s, pressure, max, dryness, edgeNow)
      ) {
        if (!run) runs.push((run = []));
        run.push(p.x + p.nx * o, p.y + p.ny * o);
      } else {
        run = null;
      }
    }
    return {
      // At least 0.9 px: a sub-pixel hair antialiases to a faint grey.
      width: Math.max(0.9, spacing * b.thickness),
      tone: b.tone,
      runs: runs.filter((r) => r.length >= 2),
    };
  });
}

/** How many widths a hair's taper is drawn in (see `taperLevels`). */
export const TAPER_LEVELS = 8;

/**
 * Each segment of one painted run of a hair, as the width level (1 … `levels`) it is drawn at:
 * full width in the middle, narrowing to the thinnest over `taper` px at both ends (a run shorter
 * than twice that never reaches full width), on a sine ease so it fades in rather than starting
 * as a wedge. Pure. 2026-10-01: drawn as constant-width lines every run was a uniform bar; the
 * first taper filled each run as an outline polygon, one large path per hair rebuilt every frame,
 * which broke up into hollow boxes on iPad late in a long stroke (not reproducible in software
 * WebKit) and cost twice the points. So the hair is LINES again, in a few widths.
 */
export function taperLevels(run: readonly number[], taper: number, levels: number): number[] {
  const n = run.length / 2;
  if (n < 2) return [];
  const along = [0];
  for (let i = 1; i < n; i++) {
    along.push(
      along[i - 1] + Math.hypot(run[2 * i] - run[2 * i - 2], run[2 * i + 1] - run[2 * i - 1]),
    );
  }
  const total = along[n - 1];
  const out: number[] = [];
  for (let i = 1; i < n; i++) {
    const mid = (along[i - 1] + along[i]) / 2;
    const k = taper > 0 ? Math.min(1, Math.min(mid, total - mid) / taper) : 1;
    out.push(Math.max(1, Math.ceil(Math.sin((k * Math.PI) / 2) * levels)));
  }
  return out;
}

/** How long each hair run's taper is, in px: `taper` 0–100 (the Taper slider) as a share of the
 *  stroke's widest width `width` — 10 (the default, close to the first look) is a fifth of it, 100
 *  twice it — and never under 4 px. */
export function dryTaperPx(width: number, taper: number): number {
  const t = Math.max(0, Math.min(100, taper));
  return Math.max(4, (width * t) / 50);
}

/** Scratch for a translucent stroke: the hairs overlap, so they're drawn opaque here and the
 *  whole stroke composited once at the opacity (as Ink does). */
let scratch: HTMLCanvasElement | null = null;
/** The part of `scratch` the last frame drew into, so the next one clears it. */
let scratchBox: Box | null = null;

type Box = { x: number; y: number; w: number; h: number };

/** A document-space box under transform `m` (scale and translate) as whole device pixels,
 *  clamped to a `w`×`h` canvas; null when it falls outside. */
function deviceBox(
  m: DOMMatrix,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w: number,
  h: number,
): Box | null {
  const ax = m.a * x0 + m.e;
  const bx = m.a * x1 + m.e;
  const ay = m.d * y0 + m.f;
  const by = m.d * y1 + m.f;
  const left = Math.max(0, Math.floor(Math.min(ax, bx)));
  const top = Math.max(0, Math.floor(Math.min(ay, by)));
  const right = Math.min(w, Math.ceil(Math.max(ax, bx)));
  const bottom = Math.min(h, Math.ceil(Math.max(ay, by)));
  return right > left && bottom > top
    ? { x: left, y: top, w: right - left, h: bottom - top }
    : null;
}

function unionBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function drawDryStroke(
  ctx: CanvasRenderingContext2D,
  points: InputPoint[],
  settings: BrushSettings,
  sizeRange: number = 1.0,
) {
  const hairs = bristleRuns(points, settings.size, sizeRange, settings.dryness ?? 50);
  if (hairs.length === 0) return;
  const taperPx = dryTaperPx(widthRange(settings.size, sizeRange).max, settings.dryTaper ?? 10);
  const alpha = settings.opacity / 100;
  const op: GlobalCompositeOperation = settings.isEraser
    ? "destination-out"
    : settings.alphaLock
      ? "source-atop"
      : settings.drawBehind
        ? "destination-over"
        : "source-over";

  // Each hair is lines, in TAPER_LEVELS widths: the run's middle at full width, its ends in steps
  // down to the thinnest. One path per width, so a hair is a handful of strokes. Butt ends, so
  // the steps meet edge to edge instead of overlapping (an overlap darkens at a tone below 1).
  const levelsOf = hairs.map((h) => h.runs.map((r) => taperLevels(r, taperPx, TAPER_LEVELS)));
  const paint = (c: CanvasRenderingContext2D) => {
    c.strokeStyle = settings.color;
    c.lineCap = "butt";
    c.lineJoin = "round";
    hairs.forEach((h, hi) => {
      c.globalAlpha = h.tone;
      for (let level = 1; level <= TAPER_LEVELS; level++) {
        c.lineWidth = (h.width * level) / TAPER_LEVELS;
        c.beginPath();
        let any = false;
        h.runs.forEach((r, ri) => {
          const lv = levelsOf[hi][ri];
          let open = false;
          for (let i = 0; i < lv.length; i++) {
            if (lv[i] !== level) {
              open = false;
              continue;
            }
            if (!open) c.moveTo(r[2 * i], r[2 * i + 1]);
            c.lineTo(r[2 * i + 2], r[2 * i + 3]);
            open = true;
            any = true;
          }
        });
        if (any) c.stroke();
      }
    });
  };

  // The stroke's box in device px, padded by the widest hair: only that much of the scratch is
  // cleared and composited (it was the whole document every frame). The box only grows as the
  // stroke does, and the last frame's box is cleared too.
  const m = ctx.getTransform();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let pad = 0;
  for (const h of hairs) {
    pad = Math.max(pad, h.width);
    for (const r of h.runs) {
      for (let i = 0; i < r.length; i += 2) {
        if (r[i] < x0) x0 = r[i];
        if (r[i] > x1) x1 = r[i];
        if (r[i + 1] < y0) y0 = r[i + 1];
        if (r[i + 1] > y1) y1 = r[i + 1];
      }
    }
  }
  if (x0 > x1) return; // nothing painted yet

  // The hairs overlap one another, and `destination-over` / `source-atop` would treat each hair as
  // its own layer: paint the stroke once onto a scratch canvas, then composite it in one go.
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  if (!scratch || scratch.width !== w || scratch.height !== h) {
    scratch = document.createElement("canvas");
    scratch.width = w;
    scratch.height = h;
    scratchBox = null;
  }
  const box = deviceBox(m, x0 - pad, y0 - pad, x1 + pad, y1 + pad, w, h);
  if (!box) return;
  const sctx = scratch.getContext("2d")!;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  const clear = scratchBox ? unionBox(scratchBox, box) : box;
  sctx.clearRect(clear.x, clear.y, clear.w, clear.h);
  scratchBox = box;
  sctx.setTransform(m);
  paint(sctx);

  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = op;
    ctx.globalAlpha = alpha;
    ctx.drawImage(scratch, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
  } finally {
    ctx.restore();
  }
}
