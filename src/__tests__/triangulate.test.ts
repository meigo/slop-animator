import { describe, it, expect } from "vitest";
import { boundaryPoints, interiorPoints } from "../core/triangulate";

// A 20×20 filled square inside a 40×40 field (inside = 10..29 in both axes).
const sq = (x: number, y: number) => x >= 10 && x <= 29 && y >= 10 && y <= 29;

describe("boundaryPoints", () => {
  it("returns points on the silhouette edge, none deep-interior", () => {
    const pts = boundaryPoints(sq, 40, 40, 6);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      expect(sq(p.x, p.y)).toBe(true);
      const edge = !sq(p.x + 1, p.y) || !sq(p.x - 1, p.y) || !sq(p.x, p.y + 1) || !sq(p.x, p.y - 1);
      expect(edge).toBe(true);
    }
    expect(pts.some((p) => p.x === 20 && p.y === 20)).toBe(false);
  });
  it("decimates: kept points are not near-duplicates", () => {
    const pts = boundaryPoints(sq, 40, 40, 6);
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        expect(d).toBeGreaterThan(2);
      }
  });
  it("empty mask → no points", () => {
    expect(boundaryPoints(() => false, 40, 40, 6)).toEqual([]);
  });
});

describe("interiorPoints", () => {
  it("returns inside points spaced from the boundary", () => {
    const b = boundaryPoints(sq, 40, 40, 6);
    const pts = interiorPoints(sq, 40, 40, 6, b);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      expect(sq(p.x, p.y)).toBe(true);
      for (const q of b) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(2);
    }
  });
});
