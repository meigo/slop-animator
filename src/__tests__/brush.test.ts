import { describe, it, expect } from "vitest";
import { widthRange } from "../core/brush";

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
