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
  const at = (n: number) => rng(Math.imul(key ^ n, 0x27d4eb2d) ^ (n * 0x165667b1))();
  const t = (1 - Math.cos(f * Math.PI)) / 2;
  return at(i) * (1 - t) + at(i + 1) * t;
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

/**
 * One painted run of a hair as a closed outline (x, y pairs: down one side, back up the other)
 * whose width narrows to a point at both ends (2026-10-01): drawn as constant-width round-capped
 * lines, every run was a uniform bar. The taper runs over `taper` px from each end (a run shorter
 * than twice that tapers all the way, so it peaks in the middle), following a sine ease so it
 * fades in rather than starting as a wedge. Pure.
 */
export function taperedRibbon(run: readonly number[], width: number, taper: number): number[] {
  const n = run.length / 2;
  if (n < 2) return [];
  const along = [0];
  for (let i = 1; i < n; i++) {
    along.push(
      along[i - 1] + Math.hypot(run[2 * i] - run[2 * i - 2], run[2 * i + 1] - run[2 * i - 1]),
    );
  }
  const total = along[n - 1];
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.max(0, i - 1);
    const b = 2 * Math.min(n - 1, i + 1);
    const dx = run[b] - run[a];
    const dy = run[b + 1] - run[a + 1];
    const len = Math.hypot(dx, dy) || 1;
    const nearEnd = Math.min(along[i], total - along[i]);
    const k = taper > 0 ? Math.min(1, nearEnd / taper) : 1;
    const half = (width / 2) * Math.sin((k * Math.PI) / 2);
    const ox = (-dy / len) * half;
    const oy = (dx / len) * half;
    left.push(run[2 * i] + ox, run[2 * i + 1] + oy);
    right.push(run[2 * i] - ox, run[2 * i + 1] - oy);
  }
  for (let i = n - 1; i >= 0; i--) left.push(right[2 * i], right[2 * i + 1]);
  return left;
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

  const paint = (c: CanvasRenderingContext2D) => {
    c.fillStyle = settings.color;
    for (const h of hairs) {
      c.globalAlpha = h.tone;
      // Each run tapers at either end, as long as the Taper slider says.
      c.beginPath();
      for (const r of h.runs) {
        const outline = taperedRibbon(r, h.width, taperPx);
        if (outline.length < 6) continue;
        c.moveTo(outline[0], outline[1]);
        for (let i = 2; i < outline.length; i += 2) c.lineTo(outline[i], outline[i + 1]);
        c.closePath();
      }
      c.fill();
    }
  };

  // The hairs overlap one another, and `destination-over` / `source-atop` would treat each hair as
  // its own layer: paint the stroke once onto a scratch canvas, then composite it in one go.
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  if (!scratch || scratch.width !== w || scratch.height !== h) {
    scratch = document.createElement("canvas");
    scratch.width = w;
    scratch.height = h;
  }
  const sctx = scratch.getContext("2d")!;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, w, h);
  sctx.setTransform(ctx.getTransform());
  paint(sctx);

  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = op;
    ctx.globalAlpha = alpha;
    ctx.drawImage(scratch, 0, 0);
  } finally {
    ctx.restore();
  }
}
