import { describe, it, expect } from "vitest";
import {
  transformCenter,
  transformedCorners,
  hitTestHandle,
  applyMove,
  applyScale,
  applyRotate,
  inverseTransformPoint,
  forwardTransformPoint,
  forwardChain,
  inverseChain,
  type Rect,
} from "../core/ref-transform";

const base: Rect = { x: 100, y: 100, w: 200, h: 100 }; // center (200,150)
const id = { dx: 0, dy: 0, scale: 1, rotation: 0 };

describe("transformCenter", () => {
  it("identity → fit center", () => {
    expect(transformCenter(base, id)).toEqual({ x: 200, y: 150 });
  });
  it("translate shifts the center", () => {
    expect(transformCenter(base, { ...id, dx: 10, dy: -20 })).toEqual({ x: 210, y: 130 });
  });
});

describe("transformedCorners", () => {
  it("identity → the fit rect corners (NW,NE,SE,SW)", () => {
    const [nw, ne, se, sw] = transformedCorners(base, id);
    expect(nw).toEqual({ x: 100, y: 100 });
    expect(ne).toEqual({ x: 300, y: 100 });
    expect(se).toEqual({ x: 300, y: 200 });
    expect(sw).toEqual({ x: 100, y: 200 });
  });
  it("scale=2 doubles each corner's distance from center", () => {
    const [nw] = transformedCorners(base, { ...id, scale: 2 });
    expect(nw).toEqual({ x: 0, y: 50 });
  });
  it("rotation=π/2 rotates corners a quarter turn about center", () => {
    const [nw] = transformedCorners(base, { ...id, rotation: Math.PI / 2 });
    expect(nw.x).toBeCloseTo(250, 6);
    expect(nw.y).toBeCloseTo(50, 6);
  });
});

describe("hitTestHandle", () => {
  const gap = 30;
  it("hits a corner near it", () => {
    expect(hitTestHandle(base, id, { x: 300, y: 200 }, 8, gap)).toBe("se");
  });
  it("hits the rotate handle above the top edge", () => {
    expect(hitTestHandle(base, id, { x: 200, y: 100 - gap }, 8, gap)).toBe("rotate");
  });
  it("hits the body inside", () => {
    expect(hitTestHandle(base, id, { x: 200, y: 150 }, 8, gap)).toBe("body");
  });
  it("misses outside + tolerance", () => {
    expect(hitTestHandle(base, id, { x: 500, y: 500 }, 8, gap)).toBe(null);
  });
});

describe("applyMove", () => {
  it("adds to dx/dy and leaves scale/rotation", () => {
    expect(applyMove({ dx: 1, dy: 2, scale: 3, rotation: 4 }, 10, -5)).toEqual({
      dx: 11,
      dy: -3,
      scale: 3,
      rotation: 4,
    });
  });
});

describe("applyScale", () => {
  const center = { x: 200, y: 150 };
  it("doubling the distance from center doubles scale", () => {
    const out = applyScale(id, center, { x: 250, y: 150 }, { x: 300, y: 150 });
    expect(out.scale).toBeCloseTo(2, 6);
    expect(out.dx).toBe(0);
    expect(out.dy).toBe(0);
    expect(out.rotation).toBe(0);
  });
  it("clamps to a small minimum", () => {
    const out = applyScale(id, center, { x: 300, y: 150 }, { x: 200.0001, y: 150 });
    expect(out.scale).toBeGreaterThan(0);
  });
});

describe("applyRotate", () => {
  const center = { x: 200, y: 150 };
  it("a 90° pointer sweep adds π/2", () => {
    const out = applyRotate(id, center, { x: 300, y: 150 }, { x: 200, y: 250 });
    expect(out.rotation).toBeCloseTo(Math.PI / 2, 6);
    expect(out.scale).toBe(1);
    expect(out.dx).toBe(0);
  });
});

describe("inverseTransformPoint", () => {
  const base = { x: 0, y: 0, w: 100, h: 100 }; // doc center = (50,50)
  const id = { dx: 0, dy: 0, scale: 1, rotation: 0 };

  it("identity is a no-op", () => {
    expect(inverseTransformPoint(base, id, { x: 30, y: 70 })).toEqual({ x: 30, y: 70 });
  });

  it("pure translate subtracts the offset", () => {
    const p = inverseTransformPoint(base, { ...id, dx: 10, dy: -5 }, { x: 30, y: 70 });
    expect(p.x).toBeCloseTo(20, 5);
    expect(p.y).toBeCloseTo(75, 5);
  });

  it("pure scale divides distance from doc center", () => {
    const p = inverseTransformPoint(base, { ...id, scale: 2 }, { x: 70, y: 50 });
    expect(p.x).toBeCloseTo(60, 5);
    expect(p.y).toBeCloseTo(50, 5);
  });

  it("round-trips the forward render transform", () => {
    const t = { dx: 12, dy: -7, scale: 1.5, rotation: 0.6 };
    const cx = base.x + base.w / 2,
      cy = base.y + base.h / 2;
    const local = { x: 73, y: 21 };
    const ox = local.x - cx,
      oy = local.y - cy;
    const cos = Math.cos(t.rotation),
      sin = Math.sin(t.rotation);
    const screen = {
      x: cx + t.dx + t.scale * (ox * cos - oy * sin),
      y: cy + t.dy + t.scale * (ox * sin + oy * cos),
    };
    const back = inverseTransformPoint(base, t, screen);
    expect(back.x).toBeCloseTo(local.x, 4);
    expect(back.y).toBeCloseTo(local.y, 4);
  });
});

describe("forwardTransformPoint", () => {
  const base = { x: 0, y: 0, w: 100, h: 100 };
  const id = { dx: 0, dy: 0, scale: 1, rotation: 0 };
  it("identity is a no-op", () => {
    expect(forwardTransformPoint(base, id, { x: 30, y: 70 })).toEqual({ x: 30, y: 70 });
  });
  it("round-trips with inverseTransformPoint", () => {
    const t = { dx: 12, dy: -7, scale: 1.5, rotation: 0.6 };
    const p = { x: 73, y: 21 };
    const back = inverseTransformPoint(base, t, forwardTransformPoint(base, t, p));
    expect(back.x).toBeCloseTo(p.x, 5);
    expect(back.y).toBeCloseTo(p.y, 5);
  });
});

describe("forwardChain / inverseChain", () => {
  const docBase = { x: 0, y: 0, w: 100, h: 100 };
  const cellBase = { x: 20, y: 30, w: 40, h: 50 };
  const tLayer = { dx: 5, dy: -7, scale: 1.2, rotation: 0.3 };
  const tCell = { dx: -2, dy: 4, scale: 0.8, rotation: -0.15 };
  const tIdent = { dx: 0, dy: 0, scale: 1, rotation: 0 };

  it("empty chain is identity", () => {
    expect(forwardChain([], { x: 17, y: 23 })).toEqual({ x: 17, y: 23 });
    expect(inverseChain([], { x: 17, y: 23 })).toEqual({ x: 17, y: 23 });
  });

  it("single non-identity step matches forward/inverseTransformPoint", () => {
    const p = { x: 33, y: 44 };
    const f = forwardChain([{ base: docBase, t: tLayer }], p);
    expect(f).toEqual(forwardTransformPoint(docBase, tLayer, p));
    const inv = inverseChain([{ base: docBase, t: tLayer }], f);
    expect(inv.x).toBeCloseTo(p.x, 5);
    expect(inv.y).toBeCloseTo(p.y, 5);
  });

  it("two-step chain composes inner-to-outer and round-trips", () => {
    // Steps are inner-to-outer: [cell, layer]. Forward = cell-local → doc.
    const steps = [
      { base: cellBase, t: tCell },
      { base: docBase, t: tLayer },
    ];
    const p = { x: 11, y: 13 };
    const fwd = forwardChain(steps, p);
    // Expected: layer.forward(cell.forward(p))
    const manual = forwardTransformPoint(
      docBase,
      tLayer,
      forwardTransformPoint(cellBase, tCell, p),
    );
    expect(fwd.x).toBeCloseTo(manual.x, 5);
    expect(fwd.y).toBeCloseTo(manual.y, 5);
    // Round-trip
    const back = inverseChain(steps, fwd);
    expect(back.x).toBeCloseTo(p.x, 5);
    expect(back.y).toBeCloseTo(p.y, 5);
  });

  it("identity steps are skipped (no precision drift)", () => {
    const steps = [
      { base: cellBase, t: tIdent },
      { base: docBase, t: tIdent },
    ];
    const p = { x: 7, y: 9 };
    expect(forwardChain(steps, p)).toEqual(p);
    expect(inverseChain(steps, p)).toEqual(p);
  });
});
