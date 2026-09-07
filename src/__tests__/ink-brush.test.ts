import { describe, it, expect } from "vitest";
import { inkRuns, INK_WIDTH_QUANTUM, type InkRun } from "../core/ink-brush";

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
