import { describe, it, expect } from "vitest";
import {
  nearestVertex,
  solvePoseDeform,
  defaultHandleReach,
  type PoseHandle,
} from "../core/mesh-pose";
import { poseWeights } from "../core/geodesic";
import { mlsRigidWeighted } from "../core/mls";
import type { Mesh } from "../core/triangulate";

describe("nearestVertex", () => {
  const verts = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ];
  it("returns the index of the closest vertex", () => {
    expect(nearestVertex(verts, { x: 9, y: 1 })).toBe(1);
    expect(nearestVertex(verts, { x: 1, y: 9 })).toBe(2);
    expect(nearestVertex(verts, { x: 1, y: 1 })).toBe(0);
  });
});

// A 4×2 grid "arm" strip: verts 0..3 = top row (y=0), 4..7 = bottom row (y=10).
function armMesh(): Mesh {
  const cols = 4,
    rows = 2,
    step = 10;
  const vertices = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) vertices.push({ x: c * step, y: r * step });
  const triangles: [number, number, number][] = [];
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const i = r * cols + c;
      triangles.push([i, i + 1, i + cols]);
      triangles.push([i + 1, i + cols + 1, i + cols]);
    }
  return { vertices, triangles };
}

describe("solvePoseDeform", () => {
  it("angle 0 matches the plain translate-only MLS solve", () => {
    const mesh = armMesh();
    const handles: PoseHandle[] = [
      { vertex: 0, to: { x: 0, y: 0 }, angle: 0 },
      { vertex: 3, to: { x: 35, y: -5 }, angle: 0 },
    ];
    const { from, weights } = poseWeights(mesh, [0, 3]);
    const out = solvePoseDeform(mesh.vertices, handles, from, weights);
    const ref = mlsRigidWeighted(mesh.vertices, from, [handles[0].to, handles[1].to], weights);
    out.forEach((p, i) => {
      expect(p.x).toBeCloseTo(ref[i].x, 9);
      expect(p.y).toBeCloseTo(ref[i].y, 9);
    });
  });

  it("rotating a handle swings the nearby region (and the pivot/anchor hold)", () => {
    const mesh = armMesh();
    const handles: PoseHandle[] = [
      { vertex: 0, to: { x: 0, y: 0 }, angle: 0 },
      { vertex: 3, to: { x: 30, y: 0 }, angle: Math.PI / 2 },
    ];
    const { from, weights } = poseWeights(mesh, [0, 3]);
    const out = solvePoseDeform(mesh.vertices, handles, from, weights);
    expect(out[3].x).toBeCloseTo(30, 6);
    expect(out[3].y).toBeCloseTo(0, 6);
    expect(out[0].x).toBeCloseTo(0, 6);
    expect(out[0].y).toBeCloseTo(0, 6);
    expect(
      Math.hypot(out[7].x - mesh.vertices[7].x, out[7].y - mesh.vertices[7].y),
    ).toBeGreaterThan(3);
    expect(out[7].x).toBeLessThan(mesh.vertices[7].x - 2);
  });

  it("pivot/anchor hold and the region swings at any satellite offset (offset is a falloff knob)", () => {
    const mesh = armMesh();
    const handles: PoseHandle[] = [
      { vertex: 0, to: { x: 0, y: 0 }, angle: 0 },
      { vertex: 3, to: { x: 30, y: 0 }, angle: Math.PI / 2 },
    ];
    const { from, weights } = poseWeights(mesh, [0, 3]);
    // The satellite offset tunes how far the rotation propagates (NOT a cross-offset invariant), but at
    // every offset the Infinity-weighted pivot/anchor map exactly and the nearby region still swings.
    for (const off of [8, 32]) {
      const out = solvePoseDeform(mesh.vertices, handles, from, weights, off);
      expect(out[3].x).toBeCloseTo(30, 6); // pivot exact
      expect(out[3].y).toBeCloseTo(0, 6);
      expect(out[0].x).toBeCloseTo(0, 6); // anchor exact
      expect(out[0].y).toBeCloseTo(0, 6);
      expect(out[7].x).toBeLessThan(mesh.vertices[7].x - 2); // rotation occurs
    }
  });
});

describe("reach localizes the deform", () => {
  it("a far vertex stays at rest when the handle's reach excludes it", () => {
    const mesh = armMesh();
    const handles: PoseHandle[] = [
      { vertex: 0, to: { x: 0, y: 0 }, angle: 0 },
      { vertex: 3, to: { x: 40, y: 10 }, angle: 0, reach: 12 },
    ];
    const { from, weights } = poseWeights(mesh, [0, 3], 1, [undefined, 12]);
    const out = solvePoseDeform(mesh.vertices, handles, from, weights);
    // vertex 1 is geodesic 20 from handle 3 (≥ 12, outside its reach) and is the anchor's domain → rest.
    expect(out[1].x).toBeCloseTo(mesh.vertices[1].x, 6);
    expect(out[1].y).toBeCloseTo(mesh.vertices[1].y, 6);
    // the reached handle still hits its target exactly (Infinity weight at its own vertex).
    expect(out[3].x).toBeCloseTo(40, 6);
    expect(out[3].y).toBeCloseTo(10, 6);
  });
});

describe("defaultHandleReach", () => {
  const diag = 300; // base = 0.33*300 = 99; floor = 0.12*300 = 36
  it("first handle (no neighbors) uses the mesh-size fraction", () => {
    expect(defaultHandleReach({ x: 0, y: 0 }, [], diag)).toBeCloseTo(diag * 0.33, 5);
  });
  it("caps at the distance to the nearest existing handle", () => {
    const r = defaultHandleReach(
      { x: 0, y: 0 },
      [
        { x: 50, y: 0 },
        { x: 200, y: 0 },
      ],
      diag,
    );
    expect(r).toBeCloseTo(50, 5); // nearest is 50 (< base 99)
  });
  it("never exceeds the mesh-size base even with far neighbors", () => {
    expect(defaultHandleReach({ x: 0, y: 0 }, [{ x: 1000, y: 0 }], diag)).toBeCloseTo(
      diag * 0.33,
      5,
    );
  });
  it("floors so a very-close neighbor doesn't collapse the reach", () => {
    expect(defaultHandleReach({ x: 0, y: 0 }, [{ x: 2, y: 0 }], diag)).toBeCloseTo(diag * 0.12, 5);
  });
});
