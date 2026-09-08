import { describe, it, expect } from "vitest";
import { sliderFill } from "../lib/slider-fill";

const to = (s: string) => Number(/--fill-to:([\d.]+)%/.exec(s)![1]);

describe("sliderFill", () => {
  it("fills nothing at the minimum and everything at the maximum", () => {
    expect(to(sliderFill(0, 0, 100))).toBe(0);
    expect(to(sliderFill(100, 0, 100))).toBe(100);
  });

  it("is proportional across a range that does not start at zero", () => {
    // The real case: brush size runs 0.5..60, so a naive value/max would be wrong at both ends.
    expect(to(sliderFill(0.5, 0.5, 60))).toBe(0);
    expect(to(sliderFill(60, 0.5, 60))).toBe(100);
    expect(to(sliderFill(30.25, 0.5, 60))).toBeCloseTo(50, 1);
  });

  it("clamps a value outside the range instead of overflowing the track", () => {
    expect(to(sliderFill(-10, 0, 100))).toBe(0);
    expect(to(sliderFill(999, 0, 100))).toBe(100);
  });

  it("renders an empty track rather than NaN when the range is degenerate", () => {
    expect(to(sliderFill(5, 5, 5))).toBe(0);
    expect(to(sliderFill(5, 10, 0))).toBe(0);
  });

  it("always emits both stops, so a bipolar control needs no stylesheet change", () => {
    expect(sliderFill(50, 0, 100)).toMatch(/--fill-from:0%;--fill-to:50\.00%/);
  });
});
