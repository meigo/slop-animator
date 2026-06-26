import { describe, it, expect } from "vitest";
import { geodesicDistances, deformMeshGeodesic } from "../core/geodesic";
import { triangulateSilhouette, type Mesh } from "../core/triangulate";
import { mlsRigid } from "../core/mls";

const tri = (a: number, b: number, c: number) => [a, b, c] as [number, number, number];

describe("geodesicDistances", () => {
  it("single triangle: distances are edge lengths", () => {
    const mesh: Mesh = {
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
      triangles: [tri(0, 1, 2)],
    };
    const d = geodesicDistances(mesh, [0]);
    expect(d[0][0]).toBe(0);
    expect(d[0][1]).toBeCloseTo(10, 6);
    expect(d[0][2]).toBeCloseTo(10, 6);
  });
  it("two-triangle strip: shortest path along edges", () => {
    const mesh: Mesh = {
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
      ],
      triangles: [tri(0, 1, 2), tri(1, 3, 2)],
    };
    expect(geodesicDistances(mesh, [0])[0][3]).toBeCloseTo(20, 6);
  });
  it("disconnected vertex → Infinity", () => {
    const mesh: Mesh = {
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
        { x: 99, y: 99 },
      ],
      triangles: [tri(0, 1, 2)],
    };
    expect(geodesicDistances(mesh, [0])[0][3]).toBe(Infinity);
  });
});

describe("deformMeshGeodesic", () => {
  const mesh: Mesh = {
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    ],
    triangles: [tri(0, 1, 2), tri(1, 3, 2)],
  };
  it("a handle vertex lands exactly on its target", () => {
    const out = deformMeshGeodesic(mesh, [{ vertex: 0, to: { x: -5, y: -5 } }]);
    expect(out[0].x).toBeCloseTo(-5, 6);
    expect(out[0].y).toBeCloseTo(-5, 6);
  });
  it("a single handle translates the connected component", () => {
    const out = deformMeshGeodesic(mesh, [{ vertex: 0, to: { x: 2, y: 3 } }]);
    out.forEach((p, i) => {
      expect(p.x).toBeCloseTo(mesh.vertices[i].x + 2, 6);
      expect(p.y).toBeCloseTo(mesh.vertices[i].y + 3, 6);
    });
  });
  it("an unhandled disjoint component stays at rest", () => {
    const m2: Mesh = {
      vertices: [...mesh.vertices, { x: 50, y: 50 }, { x: 60, y: 50 }, { x: 50, y: 60 }],
      triangles: [...mesh.triangles, tri(4, 5, 6)],
    };
    const out = deformMeshGeodesic(m2, [{ vertex: 0, to: { x: 2, y: 3 } }]);
    for (const i of [4, 5, 6]) {
      expect(out[i].x).toBeCloseTo(m2.vertices[i].x, 6);
      expect(out[i].y).toBeCloseTo(m2.vertices[i].y, 6);
    }
  });
  it("geodesic beats Euclidean: with an anchor + a dragged tip, the far tip moves less under geodesic", () => {
    // U opening upward: 30×30 minus a top-center slot (x 10..19, y 0..19). Two arms joined at the base.
    const inside = (x: number, y: number) =>
      x >= 0 && x < 30 && y >= 0 && y < 30 && !(x >= 10 && x < 20 && y < 20);
    const m = triangulateSilhouette(inside, 30, 30, { spacing: 4 });
    const nearest = (px: number, py: number) => {
      let best = 0,
        bd = Infinity;
      m.vertices.forEach((v, i) => {
        const d = (v.x - px) ** 2 + (v.y - py) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      return best;
    };
    const anchor = nearest(15, 28); // base middle — held at rest
    const leftTip = nearest(5, 1); // dragged up
    const rightTip = nearest(25, 1); // far tip: Euclidean-close to leftTip, mesh-far (around the U)

    const handles = [
      { vertex: anchor, to: { x: m.vertices[anchor].x, y: m.vertices[anchor].y } },
      { vertex: leftTip, to: { x: m.vertices[leftTip].x, y: m.vertices[leftTip].y - 12 } },
    ];
    const from = handles.map((h) => m.vertices[h.vertex]);
    const to = handles.map((h) => h.to);

    const geo = deformMeshGeodesic(m, handles);
    const eucl = mlsRigid(m.vertices, from, to); // same handles, Euclidean weights

    const move = (out: { x: number; y: number }[], i: number) =>
      Math.hypot(out[i].x - m.vertices[i].x, out[i].y - m.vertices[i].y);

    expect(move(geo, leftTip)).toBeGreaterThan(10); // dragged tip moves under geodesic
    // the geodesically-far tip is held by the (mesh-near) anchor under geodesic, but bleeds toward the
    // (Euclidean-near) dragged tip under Euclidean — so it moves notably less under geodesic:
    expect(move(geo, rightTip)).toBeLessThan(move(eucl, rightTip) * 0.6);
  });
});
