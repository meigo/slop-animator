import { describe, it, expect } from "vitest";
import {
  boundaryPoints,
  coverSilhouette,
  interiorPoints,
  triangulateSilhouette,
  uncoveredPixels,
} from "../core/triangulate";

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

describe("triangulateSilhouette", () => {
  const sq2 = (x: number, y: number) => x >= 10 && x <= 29 && y >= 10 && y <= 29;
  // L-shape: 30×30 block (5..34) minus the top-right quadrant (x>=20 && y>=20) — a concave notch.
  const L = (x: number, y: number) => x >= 5 && x < 35 && y >= 5 && y < 35 && !(x >= 20 && y >= 20);

  it("meshes a filled square: all triangle centroids inside, indices valid", () => {
    const m = triangulateSilhouette(sq2, 40, 40, { spacing: 6 });
    expect(m.triangles.length).toBeGreaterThan(0);
    for (const [a, b, c] of m.triangles) {
      for (const i of [a, b, c]) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(m.vertices.length);
      }
      const cx = (m.vertices[a].x + m.vertices[b].x + m.vertices[c].x) / 3;
      const cy = (m.vertices[a].y + m.vertices[b].y + m.vertices[c].y) / 3;
      expect(sq2(Math.round(cx), Math.round(cy))).toBe(true);
    }
  });

  it("conforms to a concavity: no triangle centroid in the L's notch", () => {
    const m = triangulateSilhouette(L, 40, 40, { spacing: 5 });
    expect(m.triangles.length).toBeGreaterThan(0);
    for (const [a, b, c] of m.triangles) {
      const cx = (m.vertices[a].x + m.vertices[b].x + m.vertices[c].x) / 3;
      const cy = (m.vertices[a].y + m.vertices[b].y + m.vertices[c].y) / 3;
      expect(cx >= 20 && cy >= 20).toBe(false);
    }
  });

  it("reindex: no unused vertices", () => {
    const m = triangulateSilhouette(sq2, 40, 40, { spacing: 6 });
    const used = new Set(m.triangles.flat());
    expect(used.size).toBe(m.vertices.length);
  });

  it("empty mask → empty mesh", () => {
    expect(triangulateSilhouette(() => false, 40, 40, { spacing: 6 })).toEqual({
      vertices: [],
      triangles: [],
    });
  });
});

describe("coverSilhouette", () => {
  // Shapes the Pose tool lost pixels of (2026-09-30 review): Pose lifts the whole content and paints
  // back only what the mesh carries, so an uncovered ink pixel is erased on Apply.
  const W = 120,
    H = 90;
  const square = (x: number, y: number) => x >= 10 && x <= 49 && y >= 10 && y <= 49;
  const dot = (x: number, y: number) => x === 80 && y === 20; // one separate pixel — an eye
  const hLine = (x: number, y: number) => y === 70 && x >= 5 && x <= 110; // a 1px stroke
  const diag = (x: number, y: number) => x >= 60 && x <= 110 && y === x - 30; // a 1px diagonal
  const disc = (x: number, y: number) => (x - 90) ** 2 + (y - 50) ** 2 <= 64;
  const shapes: [string, (x: number, y: number) => boolean][] = [
    ["a filled square (its right and bottom rim)", square],
    ["a single separate pixel", dot],
    ["a 1px horizontal stroke", hLine],
    ["a 1px diagonal stroke", diag],
    ["a small disc", disc],
    ["all of them together", (x, y) => square(x, y) || dot(x, y) || hLine(x, y) || diag(x, y)],
  ];
  for (const spacing of [4, 16, 40]) {
    for (const [name, ink] of shapes) {
      it(`covers every pixel of ${name} at spacing ${spacing}`, () => {
        const m = coverSilhouette(ink, ink, W, H, { spacing });
        expect(uncoveredPixels(m, ink, W, H)).toEqual([]);
      });
    }
  }

  it("the old mesh did not — which is what erased them", () => {
    const ink = (x: number, y: number) => square(x, y) || dot(x, y) || hLine(x, y);
    const m = triangulateSilhouette(ink, W, H, { spacing: 16 });
    expect(uncoveredPixels(m, ink, W, H).length).toBeGreaterThan(0);
  });

  it("keeps a concavity open: no triangle centroid deep in the L's notch", () => {
    const L = (x: number, y: number) =>
      x >= 5 && x < 35 && y >= 5 && y < 35 && !(x >= 20 && y >= 20);
    const m = coverSilhouette(L, L, 40, 40, { spacing: 5 });
    for (const [a, b, c] of m.triangles) {
      const cx = (m.vertices[a].x + m.vertices[b].x + m.vertices[c].x) / 3;
      const cy = (m.vertices[a].y + m.vertices[b].y + m.vertices[c].y) / 3;
      expect(cx >= 23 && cy >= 23).toBe(false); // the edge may grow in by GROW (2) px, no more
    }
  });

  it("stays about as coarse as the old mesh: refinement adds points only where pixels were bare", () => {
    // More vertices make every Pose drag slower (geodesic weights are O(V²) per handle).
    const big = (x: number, y: number) => x >= 50 && x < 450 && y >= 50 && y < 450;
    const m = coverSilhouette(big, big, 500, 500, { spacing: 16 });
    const old = triangulateSilhouette(big, 500, 500, { spacing: 16 });
    expect(m.vertices.length).toBeLessThan(old.vertices.length * 1.2);
  });

  it("empty ink → empty mesh", () => {
    expect(
      coverSilhouette(
        () => false,
        () => false,
        40,
        40,
      ),
    ).toEqual({
      vertices: [],
      triangles: [],
    });
  });
});
