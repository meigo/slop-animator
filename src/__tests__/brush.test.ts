import { describe, it, expect } from "vitest";
import { outlineOfPath, TAPER_WIDTHS, widthRange } from "../core/brush";

describe("widthRange (Model 2 pressure-width mapping)", () => {
  it("opens the range both ways around the nominal size", () => {
    const { min, max } = widthRange(2, 3);
    expect(min).toBeCloseTo(2 / 3, 5);
    expect(max).toBeCloseTo(6, 5);
  });

  it("collapses to a constant width when range is 1 (mouse / no-pressure path)", () => {
    for (const size of [0.5, 1, 4, 12, 60]) {
      const { min, max } = widthRange(size, 1);
      expect(min).toBeCloseTo(size, 5);
      expect(max).toBeCloseTo(size, 5);
    }
  });

  it("clamps the thin end at the 0.5px floor", () => {
    const { min, max } = widthRange(1, 8);
    expect(min).toBe(0.5);
    expect(max).toBeCloseTo(8, 5);
  });

  it("floors sub-0.5 sizes at 0.5 before scaling", () => {
    const { min, max } = widthRange(0.25, 4);
    expect(min).toBe(0.5);
    expect(max).toBeCloseTo(2, 5);
  });

  it("never inverts: min <= flooredSize <= max", () => {
    for (const size of [0.5, 1, 2, 7.5, 30, 60]) {
      for (const range of [1, 1.5, 3, 8]) {
        const { min, max } = widthRange(size, range);
        const floored = Math.max(0.5, size);
        expect(min).toBeLessThanOrEqual(floored + 1e-9);
        expect(floored).toBeLessThanOrEqual(max + 1e-9);
        expect(min).toBeLessThanOrEqual(max + 1e-9);
      }
    }
  });
});

describe("taper", () => {
  /** Width of a horizontal outline at x. */
  const widthAt = (outline: number[][], x: number) => {
    const ys: number[] = [];
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) {
        ys.push(a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
      }
    }
    return Math.max(...ys) - Math.min(...ys);
  };
  const line = (len: number) =>
    Array.from({ length: len / 2 + 1 }, (_, i) => ({
      x: i * 2,
      y: 0,
      pressure: 1,
      hasPressure: true,
      timestamp: i,
    }));

  // perfect-freehand's `taper: true` is the whole stroke's length: a spindle never at full width.
  it("tapers over a fixed length, so a long stroke reaches its full width between", () => {
    const o = outlineOfPath(line(600), 8, 1, true, true);
    expect(TAPER_WIDTHS * 8).toBeLessThan(100);
    expect(widthAt(o, 300)).toBeCloseTo(8, 0);
    expect(widthAt(o, 150)).toBeCloseTo(8, 0);
  });

  it("keeps the drawn start as the live stroke grows", () => {
    const short = widthAt(outlineOfPath(line(200), 8, 1, false, true), 10);
    const long = widthAt(outlineOfPath(line(1600), 8, 1, false, true), 10);
    expect(long).toBeCloseTo(short, 1);
  });
});
