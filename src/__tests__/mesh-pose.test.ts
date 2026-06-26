import { describe, it, expect } from "vitest";
import { nearestVertex } from "../core/mesh-pose";

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
