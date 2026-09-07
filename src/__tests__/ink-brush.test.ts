import { describe, it, expect } from "vitest";
import {
  inkRuns,
  dwellSwell,
  INK_WIDTH_QUANTUM,
  MAX_DWELL_SWELL,
  POOL_REF_WIDTH,
  type InkRun,
} from "../core/ink-brush";
import type { InputPoint } from "../core/input";

/**
 * The run count IS the fix: it is the number of stroke() calls, and therefore the number of
 * times an antialiased edge pixel can be re-composited and driven toward opaque. A regression
 * here is a regression in edge quality, which no node test can observe directly.
 */

const total = (runs: InkRun[]) => runs.reduce((n, r) => n + (r.to - r.from), 0);

describe("inkRuns", () => {
  it("returns no runs for an empty stroke", () => {
    expect(inkRuns([])).toEqual([]);
  });

  it("merges a constant-width stroke into a single run", () => {
    const runs = inkRuns(new Array(400).fill(8));
    expect(runs).toEqual([{ width: 8, from: 0, to: 400 }]);
  });

  it("covers every segment exactly once, in order, with no gaps", () => {
    const widths = Array.from({ length: 200 }, (_, i) => 2 + 20 * Math.sin((i / 200) * Math.PI));
    const runs = inkRuns(widths);
    expect(total(runs)).toBe(widths.length);
    expect(runs[0].from).toBe(0);
    expect(runs[runs.length - 1].to).toBe(widths.length);
    for (let i = 1; i < runs.length; i++) expect(runs[i].from).toBe(runs[i - 1].to);
  });

  it("collapses the measured stroke to roughly a quarter of its segments", () => {
    // The case measured when fixing this: 400 segments over a 13px pressure swing, which
    // spans ~104 quantum steps and came out at 105 stroke() calls in the browser.
    const widths = Array.from({ length: 400 }, (_, i) => 9 + 13 * Math.sin((i / 400) * Math.PI));
    expect(inkRuns(widths).length).toBeLessThan(120);
  });

  it("bounds the run count by the width variation, NOT by the point count", () => {
    // This is the property the fix rests on. The old engine emitted one composite per input
    // point, so a faster event rate meant a harder edge; runs depend only on how much the
    // width actually moves, so sampling the same stroke 4x more finely costs ~nothing.
    const profile = (n: number) =>
      Array.from({ length: n }, (_, i) => 9 + 13 * Math.sin((i / n) * Math.PI));
    const coarse = inkRuns(profile(400)).length;
    const fine = inkRuns(profile(1600)).length;
    expect(fine).toBeLessThan(coarse * 1.1);
    expect(fine).toBeLessThan(1600 / 10);
  });

  it("splits when the quantized width actually changes", () => {
    const runs = inkRuns([4, 4, 9, 9]);
    expect(runs).toEqual([
      { width: 4, from: 0, to: 2 },
      { width: 9, from: 2, to: 4 },
    ]);
  });

  it("keeps widths within one quantum of the requested width", () => {
    // One quantum, not half of one: the merge test is hysteresis against the run's own width
    // (see inkRuns), which buys noise immunity at the cost of doubling this bound. 0.25px of
    // width is 0.125px of edge — still under a device pixel at dpr 1.
    const widths = Array.from({ length: 100 }, (_, i) => 0.5 + i * 0.137);
    for (const run of inkRuns(widths)) {
      for (let s = run.from; s < run.to; s++) {
        expect(Math.abs(run.width - widths[s])).toBeLessThanOrEqual(INK_WIDTH_QUANTUM + 1e-9);
      }
    }
  });

  it("does not fall apart on a noisy pressure profile", () => {
    // The failure mode hysteresis exists to prevent, and the one a smooth Math.sin profile
    // cannot show. Widths are built exactly as drawInkStroke builds them — size 8, size range
    // 3, so widthRange gives 2.67..24 — over a pressure ramp carrying +/-0.02 of noise, which
    // is ordinary for a Pencil at streamline 0. Quantizing each segment independently gives
    // 219 runs here (vs 119 for the same profile without noise); merging by hysteresis gives
    // 101, i.e. the batching survives real input rather than collapsing back toward one
    // stroke() per segment.
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const n = 400;
    const min = 8 / 3;
    const max = 8 * 3;
    const pressures = Array.from({ length: n }, (_, i) =>
      Math.max(0, Math.min(1, 0.15 + 0.7 * Math.sin((i / n) * Math.PI) + (rnd() * 2 - 1) * 0.02)),
    );
    const widths = pressures
      .slice(1)
      .map((p, i) => (min + pressures[i] * (max - min) + (min + p * (max - min))) / 2);
    expect(inkRuns(widths).length).toBeLessThan(130);
  });

  it("never quantizes a hairline down to zero width", () => {
    for (const run of inkRuns([0, 0.001, 0.05, 0.1])) {
      expect(run.width).toBeGreaterThanOrEqual(INK_WIDTH_QUANTUM);
    }
  });

  it("does not merge across a width change that a coarser quantum would swallow", () => {
    expect(inkRuns([4, 4.5], 0.25)).toHaveLength(2);
    expect(inkRuns([4, 4.5], 2)).toHaveLength(1);
  });
});

/**
 * Dwell pooling: a real pen leaves a fatter mark where the nib lingers, because the ink has
 * longer to soak in. The measure is CONTACT TIME — how long the nib takes to travel its own
 * width — so it means the same thing for a hairline and a marker, and it is computed over a
 * time window rather than a neighbour count so it cannot become sample-rate dependent (the
 * failure mode `inkRuns` already had once).
 */

/** A stroke as (position, time) with constant pressure — the two things dwell reads. */
function stroke(steps: { dx: number; dt: number; n: number }[]): InputPoint[] {
  const pts: InputPoint[] = [{ x: 0, y: 0, pressure: 0.5, hasPressure: true, timestamp: 0 }];
  for (const leg of steps) {
    for (let i = 0; i < leg.n; i++) {
      const last = pts[pts.length - 1];
      pts.push({
        x: last.x + leg.dx,
        y: 0,
        pressure: 0.5,
        hasPressure: true,
        timestamp: last.timestamp + leg.dt,
      });
    }
  }
  return pts;
}

const flat = (pts: InputPoint[], w: number) => new Array(pts.length - 1).fill(w);

describe("dwellSwell", () => {
  it("leaves the widths untouched at pool 0", () => {
    const pts = stroke([{ dx: 0.01, dt: 8, n: 40 }]); // barely moving — maximum provocation
    const widths = flat(pts, 8);
    expect(dwellSwell(pts, widths, 0)).toEqual(widths);
  });

  it("adds no variation to a constant-speed stroke", () => {
    // Slow enough to pool everywhere, so the swell is uniform rather than absent — the point
    // is that a steady hand gets a steady line, not that nothing happened.
    const pts = stroke([{ dx: 0.05, dt: 8, n: 60 }]);
    const out = dwellSwell(pts, flat(pts, 8), 100);
    for (const w of out) expect(w).toBeCloseTo(out[0], 6);
  });

  it("swells where the pen pauses and not where it moves", () => {
    const fast = { dx: 8, dt: 4, n: 25 }; // 2 px/ms — 4ms to cross an 8px nib
    const pts = stroke([fast, { dx: 0.02, dt: 4, n: 25 }, fast]);
    const out = dwellSwell(pts, flat(pts, 8), 100);
    const mid = out[Math.floor(out.length / 2)];
    expect(out[0]).toBeCloseTo(8, 6);
    expect(out[out.length - 1]).toBeCloseTo(8, 6);
    expect(mid).toBeGreaterThan(8 * 1.5);
  });

  it("caps the swell no matter how long the pen rests", () => {
    const brief = stroke([{ dx: 0, dt: 8, n: 20 }]);
    const forever = stroke([{ dx: 0, dt: 8, n: 2000 }]);
    const capped = 8 + MAX_DWELL_SWELL * Math.sqrt(8 * POOL_REF_WIDTH);
    for (const out of [
      dwellSwell(brief, flat(brief, 8), 100),
      dwellSwell(forever, flat(forever, 8), 100),
    ]) {
      for (const w of out) expect(w).toBeLessThanOrEqual(capped + 1e-9);
    }
    expect(Math.max(...dwellSwell(forever, flat(forever, 8), 100))).toBeCloseTo(capped, 6);
  });

  it("scales the swell with the pool amount", () => {
    const pts = stroke([{ dx: 0, dt: 8, n: 20 }]);
    const half = Math.max(...dwellSwell(pts, flat(pts, 8), 50));
    const full = Math.max(...dwellSwell(pts, flat(pts, 8), 100));
    expect(half - 8).toBeCloseTo((full - 8) / 2, 6);
  });

  it("gives the same widths however finely the same stroke is sampled", () => {
    // THE load-bearing property, and the reason the window is measured in milliseconds. A
    // neighbour-count window would narrow as the Pencil sampled faster and change the result;
    // the same path drawn at the same speed must render the same at any event rate.
    const coarse = stroke([
      { dx: 8, dt: 4, n: 20 },
      { dx: 0.04, dt: 4, n: 20 },
      { dx: 8, dt: 4, n: 20 },
    ]);
    const fine = stroke([
      { dx: 4, dt: 2, n: 40 },
      { dx: 0.02, dt: 2, n: 40 },
      { dx: 4, dt: 2, n: 40 },
    ]);
    const c = dwellSwell(coarse, flat(coarse, 8), 100);
    const f = dwellSwell(fine, flat(fine, 8), 100);
    expect(Math.max(...f)).toBeCloseTo(Math.max(...c), 1);
    expect(Math.min(...f)).toBeCloseTo(Math.min(...c), 1);
    // and at matched points along the path, not just at the extremes
    for (const frac of [0.25, 0.5, 0.75]) {
      const ci = Math.floor(c.length * frac);
      const fi = Math.floor(f.length * frac);
      expect(f[fi]).toBeCloseTo(c[ci], 1);
    }
  });
});

/**
 * The trigger must depend on HOW YOU MOVED, not on which brush you picked. The first model
 * keyed off contact time (`width / speed`), which is the right physics and the wrong control:
 * it made the trigger speed proportional to brush width, so it ranged from 0.02 px/ms on a
 * hairline to 4.5 px/ms on a size-60 brush against real drawing speeds of ~0.1-3 px/ms. Thin
 * brushes never pooled and fat ones always did, which is exactly how it was reported — "I can't
 * tell if it's on all the time or not at all". These three pin the property that was missing.
 */
describe("dwellSwell trigger", () => {
  it("triggers at the same pen speed whatever the brush size", () => {
    // Same motion, two nibs: both must pool (the trigger is speed, not size), and the added ink
    // must follow the same law — normalised by sqrt(width) it is the same number for both.
    const pts = stroke([{ dx: 0.4, dt: 4, n: 40 }]); // 0.1 px/ms — a slow, deliberate stroke
    const thin = dwellSwell(pts, flat(pts, 2), 100);
    const fat = dwellSwell(pts, flat(pts, 40), 100);
    expect(thin[10]).toBeGreaterThan(2);
    expect(fat[10]).toBeGreaterThan(40);
    expect((thin[10] - 2) / Math.sqrt(2)).toBeCloseTo((fat[10] - 40) / Math.sqrt(40), 6);
  });

  it("adds ink as the square root of the nib width, not in proportion to it", () => {
    // A fixed extra volume of ink spreads into a disc, and a disc's radius goes as the square
    // root of its area; the nib delivers ink in proportion to its width, so the extra radius
    // goes as sqrt(width). Reported from the iPad: a linear swell was invisible at size 1 and
    // a bulb past size 10, and looked right only around 3-5. A 16px nib gains exactly twice
    // what a 4px nib gains — a linear law would give four times.
    const pts = stroke([{ dx: 0, dt: 8, n: 20 }]); // resting: full dwell everywhere
    const gain = (w: number) => Math.max(...dwellSwell(pts, flat(pts, w), 100)) - w;
    expect(gain(16)).toBeCloseTo(2 * gain(4), 6);
    expect(gain(1)).toBeCloseTo(gain(4) / 2, 6);
  });

  it("exactly doubles a nib at the reference width", () => {
    const pts = stroke([{ dx: 0, dt: 8, n: 20 }]);
    const w = POOL_REF_WIDTH;
    expect(Math.max(...dwellSwell(pts, flat(pts, w), 100))).toBeCloseTo(2 * w, 6);
  });

  it("leaves a normally paced stroke alone at every brush size", () => {
    const pts = stroke([{ dx: 2.4, dt: 4, n: 40 }]); // 0.6 px/ms — ordinary drawing
    for (const w of [2, 8, 40]) {
      expect(Math.max(...dwellSwell(pts, flat(pts, w), 100))).toBeCloseTo(w, 6);
    }
  });

  it("pools on a deliberate slowdown at the default brush size", () => {
    const pts = stroke([{ dx: 0.4, dt: 4, n: 40 }]); // 0.1 px/ms at a ~4px nib
    expect(dwellSwell(pts, flat(pts, 4), 100)[10]).toBeGreaterThan(4 * 1.3);
  });
});
