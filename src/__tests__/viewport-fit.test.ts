import { describe, it, expect } from "vitest";
import { computeFitTransform } from "../core/viewport-fit";

describe("computeFitTransform", () => {
  it("fits by the limiting (wider-than-tall content in a square parent) dimension and centers", () => {
    // content 200x100 into 1000x1000, margin 1 → zoom limited by width: 1000/200 = 5
    const r = computeFitTransform(1000, 1000, 200, 100, 1);
    expect(r.zoom).toBe(5);
    expect(r.panX).toBe((1000 - 200 * 5) / 2); // 0, centered horizontally (fills width)
    expect(r.panY).toBe((1000 - 100 * 5) / 2); // 250, centered vertically
  });

  it("fits by height when content is taller relative to the parent", () => {
    const r = computeFitTransform(1000, 400, 100, 200, 1); // zoom = min(1000/100, 400/200) = 2
    expect(r.zoom).toBe(2);
    expect(r.panX).toBe((1000 - 100 * 2) / 2); // 400
    expect(r.panY).toBe((400 - 200 * 2) / 2); // 0
  });

  it("applies the margin (default 0.9)", () => {
    const r = computeFitTransform(1000, 1000, 100, 100); // min(10,10)*0.9 = 9
    expect(r.zoom).toBe(9);
  });

  it("degenerates safely on zero/negative dimensions (identity)", () => {
    expect(computeFitTransform(0, 0, 100, 100)).toEqual({ zoom: 1, panX: 0, panY: 0 });
    expect(computeFitTransform(1000, 1000, 0, 100)).toEqual({ zoom: 1, panX: 0, panY: 0 });
    expect(computeFitTransform(1000, 1000, 100, -5)).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });
});
