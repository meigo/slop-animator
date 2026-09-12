import { describe, it, expect } from "vitest";
import { flipMatrix, cornerScaleMatrix, sideStretchMatrix, type Mat } from "../core/selection";

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

describe("sideStretchMatrix", () => {
  it("r: stretches x only, the left edge stays put", () => {
    const m = sideStretchMatrix("r", rect, { x: 90, y: 999 });
    expect(ap(m, 50, 25)).toEqual({ x: 90, y: 25 });
    expect(ap(m, 10, 44)).toEqual({ x: 10, y: 44 });
    expect(m.b).toBe(0);
    expect(m.c).toBe(0);
  });
  it("l: dragging past the anchored right edge mirrors", () => {
    const m = sideStretchMatrix("l", rect, { x: 70, y: 0 });
    expect(m.a).toBeCloseTo(-0.5, 12);
    expect(ap(m, 50, 30).x).toBeCloseTo(50, 12);
  });
  it("b and t: stretch y only, the opposite edge stays put", () => {
    const b = sideStretchMatrix("b", rect, { x: -5, y: 80 });
    expect(ap(b, 30, 50)).toEqual({ x: 30, y: 80 });
    expect(ap(b, 30, 20)).toEqual({ x: 30, y: 20 });
    const t = sideStretchMatrix("t", rect, { x: 0, y: 35 });
    expect(ap(t, 30, 20).y).toBeCloseTo(35, 12);
    expect(ap(t, 30, 50).y).toBeCloseTo(50, 12);
    expect(t.b).toBe(0);
    expect(t.c).toBe(0);
  });
});

describe("cornerScaleMatrix", () => {
  it("free: each axis follows the pointer (today's behaviour)", () => {
    const m = cornerScaleMatrix("br", rect, { x: 90, y: 60 }, false);
    expect(m.a).toBeCloseTo(2, 12);
    expect(m.d).toBeCloseTo(40 / 30, 12);
    const anchor = ap(m, 10, 20);
    expect(anchor.x).toBeCloseTo(10, 12);
    expect(anchor.y).toBeCloseTo(20, 12);
  });
  it("proportional: one factor along the diagonal from the anchor corner", () => {
    const m = cornerScaleMatrix("br", rect, { x: 90, y: 60 }, true);
    expect(m.a).toBeCloseTo(4400 / 2500, 12);
    expect(m.d).toBeCloseTo(m.a, 12);
    const anchor = ap(m, 10, 20);
    expect(anchor.x).toBeCloseTo(10, 12);
    expect(anchor.y).toBeCloseTo(20, 12);
  });
  it("proportional: crossing the anchor flips both axes", () => {
    const m = cornerScaleMatrix("br", rect, { x: -30, y: -10 }, true);
    expect(m.a).toBeCloseTo(-1, 12);
    expect(m.d).toBeCloseTo(-1, 12);
  });
  it("tl anchors at the bottom-right corner", () => {
    const m = cornerScaleMatrix("tl", rect, { x: -30, y: -10 }, true);
    const anchor = ap(m, 50, 50);
    expect(anchor.x).toBeCloseTo(50, 12);
    expect(anchor.y).toBeCloseTo(50, 12);
    expect(m.a).toBeCloseTo(2, 12);
    expect(m.d).toBeCloseTo(2, 12);
  });
});

describe("degenerate drags cannot kill the float", () => {
  // A handle released exactly on its anchor gives a scale of 0: the matrix is singular and the next
  // `invert()` yields NaN, so the float stops hit-testing — it cannot be grabbed again. The factor is
  // floored the way the gizmo's own scale is (MIN_SCALE, sign kept).
  it("a side dropped on the anchored edge floors instead of collapsing", () => {
    const onAnchor = sideStretchMatrix("r", rect, { x: rect.x, y: 0 }); // r's anchor is the LEFT edge
    expect(Math.abs(onAnchor.a)).toBeCloseTo(0.05, 12);
    expect(Number.isFinite(onAnchor.e)).toBe(true);
    const past = sideStretchMatrix("r", rect, { x: rect.x - 100, y: 0 });
    expect(past.a).toBeLessThan(0); // still mirrors past the anchor
    expect(Math.abs(past.a)).toBeGreaterThanOrEqual(0.05);
  });

  it("a corner dropped on the anchored corner floors on both axes, proportional or free", () => {
    for (const keep of [true, false]) {
      const m = cornerScaleMatrix("br", rect, { x: rect.x, y: rect.y }, keep);
      expect(Math.abs(m.a)).toBeCloseTo(0.05, 12);
      expect(Math.abs(m.d)).toBeCloseTo(0.05, 12);
    }
  });

  it("an ordinary drag is untouched by the floor", () => {
    const m = sideStretchMatrix("r", rect, { x: 90, y: 0 });
    expect(m.a).toBeCloseTo(2, 12);
  });
});
