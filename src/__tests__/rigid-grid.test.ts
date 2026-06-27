import { describe, it, expect } from "vitest";
import { rigidDeformGrid } from "../core/rigid-grid";

type Pt = { x: number; y: number };

const uniform = (rows: number, cols: number, step = 100): Pt[][] =>
  Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ({ x: c * step, y: r * step })),
  );

describe("rigidDeformGrid", () => {
  it("0 pins: a drag translates the whole grid uniformly", () => {
    const g = uniform(3, 3);
    const out = rigidDeformGrid(g, new Map(), 0, { x: g[0][0].x + 40, y: g[0][0].y + 40 }, 3);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        expect(out[r][c].x).toBeCloseTo(g[r][c].x + 40, 6);
        expect(out[r][c].y).toBeCloseTo(g[r][c].y + 40, 6);
      }
  });

  it("preserves an existing non-uniform deformation under a 0-pin drag (regression: pose not wiped)", () => {
    // gridStart already carries un-pinned deformation (a pulled corner + center). The bug rebuilt
    // from the uniform entry grid and collapsed this back to uniform; the fix sources from gridStart.
    const g = uniform(3, 3);
    g[0][2] = { x: 220, y: -30 };
    g[1][1] = { x: 130, y: 70 };
    const out = rigidDeformGrid(g, new Map(), 0, { x: g[0][0].x + 5, y: g[0][0].y + 5 }, 3);
    // every point == its deformed position + the uniform (5,5) translation
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        expect(out[r][c].x).toBeCloseTo(g[r][c].x + 5, 6);
        expect(out[r][c].y).toBeCloseTo(g[r][c].y + 5, 6);
      }
  });

  it("a pinned point stays put while the dragged point reaches its target", () => {
    const g = uniform(3, 3);
    const pinned = new Map<number, Pt>([[0, { x: g[0][0].x, y: g[0][0].y }]]); // pin corner 0
    const target = { x: g[2][2].x + 60, y: g[2][2].y };
    const out = rigidDeformGrid(g, pinned, 8, target, 3); // drag opposite corner (flat idx 8)
    expect(out[0][0].x).toBeCloseTo(g[0][0].x, 6); // anchor unchanged
    expect(out[0][0].y).toBeCloseTo(g[0][0].y, 6);
    expect(out[2][2].x).toBeCloseTo(target.x, 6); // dragged corner exact (coincidence rule)
    expect(out[2][2].y).toBeCloseTo(target.y, 6);
  });
});
