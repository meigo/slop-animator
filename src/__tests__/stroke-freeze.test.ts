import { describe, it, expect } from "vitest";
import { MIN_STEP_PX, settledIndex } from "../core/stroke-freeze";

const pt = (x: number, y: number) => ({ x, y });

describe("settledIndex", () => {
  it("is the last point at least `marginPx` of travel and `minPts` points behind the pen", () => {
    // A straight line, 1 px a point: at least 100 px of travel back, and under one counted step
    // (MIN_STEP_PX) more — travel is counted in steps of at least that.
    const line = Array.from({ length: 500 }, (_, i) => pt(i, 0));
    const back = 499 - settledIndex(line, 100, 40);
    expect(back).toBeGreaterThanOrEqual(100);
    expect(back).toBeLessThan(100 + MIN_STEP_PX);
    // The point count can be the larger margin.
    expect(settledIndex(line, 10, 40)).toBe(499 - 40);
  });

  it("does not count a resting pen's jitter as travel", () => {
    // Moving right to x=200, resting there for 600 points of ±1 px jitter, then 20 px down.
    const pts = [
      ...Array.from({ length: 201 }, (_, i) => pt(i, 0)),
      ...Array.from({ length: 600 }, (_, i) => pt(200 + (i % 2 ? 1 : -1), i % 3 ? 0.5 : -0.5)),
      ...Array.from({ length: 20 }, (_, i) => pt(200, i + 1)),
    ];
    // 2 × width + 30 px = 110 px: the settled point lies on the first, moving part — 110 px of real
    // travel back from the pen — never inside the rest, where only the jitter "travelled".
    const i = settledIndex(pts, 110, 40);
    expect(i).toBeLessThan(201);
    expect(pts[i].x).toBeLessThanOrEqual(200 - 110 + 20 + 3);
  });

  it("is 0 for a stroke shorter than the margin", () => {
    expect(settledIndex([pt(0, 0), pt(5, 0)], 100, 40)).toBe(0);
  });
});
