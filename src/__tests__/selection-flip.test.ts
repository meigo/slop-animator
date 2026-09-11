import { describe, it, expect } from "vitest";
import { flipMatrix, type Mat } from "../core/selection";

const I: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const ap = (m: Mat, x: number, y: number) => ({
  x: m.a * x + m.c * y + m.e,
  y: m.b * x + m.d * y + m.f,
});
const rect = { x: 10, y: 20, w: 40, h: 30 }; // centre (30, 35)

describe("flipMatrix", () => {
  it("horizontal: the left edge lands on the right edge, y unchanged", () => {
    const m = flipMatrix(I, rect, "h");
    expect(ap(m, 10, 25)).toEqual({ x: 50, y: 25 });
    expect(ap(m, 50, 44)).toEqual({ x: 10, y: 44 });
  });

  it("vertical: the top edge lands on the bottom edge, x unchanged", () => {
    const m = flipMatrix(I, rect, "v");
    expect(ap(m, 15, 20)).toEqual({ x: 15, y: 50 });
    expect(ap(m, 33, 50)).toEqual({ x: 33, y: 20 });
  });

  it("flipping twice is a no-op", () => {
    for (const axis of ["h", "v"] as const) {
      const m = flipMatrix(flipMatrix(I, rect, axis), rect, axis);
      for (const [x, y] of [
        [10, 25],
        [33, 41],
      ]) {
        const p = ap(m, x, y);
        expect(p.x).toBeCloseTo(x);
        expect(p.y).toBeCloseTo(y);
      }
    }
  });

  it("a moved and rotated float flips about its own centre, along its own axis", () => {
    const rot: Mat = { a: 0, b: 1, c: -1, d: 0, e: 100, f: 0 }; // 90° + translate
    const m = flipMatrix(rot, rect, "h");
    const centre = ap(rot, 30, 35);
    const c2 = ap(m, 30, 35);
    expect(c2.x).toBeCloseTo(centre.x);
    expect(c2.y).toBeCloseTo(centre.y);
    // The float's local left edge now appears where its right edge was.
    const was = ap(rot, 50, 35);
    const now = ap(m, 10, 35);
    expect(now.x).toBeCloseTo(was.x);
    expect(now.y).toBeCloseTo(was.y);
  });
});
