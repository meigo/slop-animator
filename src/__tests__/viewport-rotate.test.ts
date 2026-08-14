import { describe, it, expect } from "vitest";
import { panKeepingScreenPoint } from "../core/viewport";

describe("panKeepingScreenPoint", () => {
  it("does not change pan when rotation is unchanged", () => {
    const p = panKeepingScreenPoint(200, 150, 10, 20, 1, 0.3, 0.3);
    expect(p.panX).toBeCloseTo(10);
    expect(p.panY).toBeCloseTo(20);
  });

  it("adjusts pan so a 90° snap does not move the pivot (not the top-left origin)", () => {
    // Pivot at (100, 100), identity view. After +90° (CSS/screen, y-down = clockwise)
    // the canvas point under the pivot must stay at (100, 100).
    const zoom = 1;
    const oldR = 0;
    const newR = Math.PI / 2;
    const rx = 100,
      ry = 100;
    const p = panKeepingScreenPoint(rx, ry, 0, 0, zoom, oldR, newR);

    // Forward: screen = pan + rotate(scale(canvas)). Canvas point under pivot was (100, 100).
    const cx = 100,
      cy = 100;
    const cos = Math.cos(newR),
      sin = Math.sin(newR);
    const sx = cx * zoom;
    const sy = cy * zoom;
    expect(p.panX + sx * cos - sy * sin).toBeCloseTo(rx);
    expect(p.panY + sx * sin + sy * cos).toBeCloseTo(ry);
  });
});
