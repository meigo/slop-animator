import { describe, it, expect } from "vitest";
import { mlsRigid } from "../core/mls";

const grid = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 0, y: 10 },
  { x: 10, y: 10 },
];

describe("mlsRigid", () => {
  it("identity when handles are unmoved", () => {
    const out = mlsRigid(grid, [{ x: 0, y: 0 }], [{ x: 0, y: 0 }]);
    out.forEach((p, i) => {
      expect(p.x).toBeCloseTo(grid[i].x, 6);
      expect(p.y).toBeCloseTo(grid[i].y, 6);
    });
  });

  it("a single handle translates the whole shape", () => {
    const out = mlsRigid(grid, [{ x: 0, y: 0 }], [{ x: 5, y: 7 }]);
    out.forEach((p, i) => {
      expect(p.x).toBeCloseTo(grid[i].x + 5, 6);
      expect(p.y).toBeCloseTo(grid[i].y + 7, 6);
    });
  });

  it("two handles moved by the same delta translate uniformly", () => {
    const out = mlsRigid(
      grid,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 2, y: 3 },
        { x: 12, y: 3 },
      ],
    );
    out.forEach((p, i) => {
      expect(p.x).toBeCloseTo(grid[i].x + 2, 6);
      expect(p.y).toBeCloseTo(grid[i].y + 3, 6);
    });
  });

  it("places a handle vertex exactly on its target (coincidence)", () => {
    const out = mlsRigid(
      grid,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ],
    );
    expect(out[0].x).toBeCloseTo(0, 6);
    expect(out[0].y).toBeCloseTo(0, 6);
    expect(out[1].x).toBeCloseTo(10, 6);
    expect(out[1].y).toBeCloseTo(5, 6);
  });

  it("a two-handle rotation places handles exactly and keeps free points finite", () => {
    const out = mlsRigid(
      grid,
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
      ],
    );
    expect(out[0].x).toBeCloseTo(0, 6);
    expect(out[0].y).toBeCloseTo(0, 6);
    expect(out[1].x).toBeCloseTo(0, 6);
    expect(out[1].y).toBeCloseTo(10, 6);
    expect(Number.isFinite(out[3].x) && Number.isFinite(out[3].y)).toBe(true);
  });
});
