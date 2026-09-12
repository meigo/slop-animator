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
  transformedSides,
  rotateHandlePos,
  rotateHandleStem,
  applyFreeScale,
  applyStretch,
  dragTransform,
  mirrorTransform,
  mirrorTransformTrack,
  type Rect,
} from "../core/ref-transform";
import { isSameTransform, transformAt, type Layer, type TransformTrack } from "../anim/document";

const base: Rect = { x: 100, y: 100, w: 200, h: 100 }; // center (200,150)
const id = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 };

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
    const [nw] = transformedCorners(base, { ...id, scaleX: 2, scaleY: 2 });
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
    expect(applyMove({ dx: 1, dy: 2, scaleX: 3, scaleY: 3, rotation: 4 }, 10, -5)).toEqual({
      dx: 11,
      dy: -3,
      scaleX: 3,
      scaleY: 3,
      rotation: 4,
    });
  });
});

// base = { x: 100, y: 100, w: 200, h: 100 }, centre (200,150) — declared at the top of this file.
const c0 = { x: 200, y: 150 };

describe("side handles", () => {
  it("transformedSides are the N, E, S, W edge midpoints", () => {
    expect(transformedSides(base, id)).toEqual([
      { x: 200, y: 100 },
      { x: 300, y: 150 },
      { x: 200, y: 200 },
      { x: 100, y: 150 },
    ]);
  });
  it("hitTestHandle finds each side", () => {
    expect(hitTestHandle(base, id, { x: 200, y: 101 }, 5, 20)).toBe("n");
    expect(hitTestHandle(base, id, { x: 299, y: 150 }, 5, 20)).toBe("e");
    expect(hitTestHandle(base, id, { x: 200, y: 199 }, 5, 20)).toBe("s");
    expect(hitTestHandle(base, id, { x: 101, y: 150 }, 5, 20)).toBe("w");
  });
  it("sides follow rotation", () => {
    const r = { ...id, rotation: Math.PI / 2 };
    expect(hitTestHandle(base, r, { x: 200, y: 249 }, 5, 20)).toBe("e");
  });
  it("the rotate handle stays above the visual top edge when Y is mirrored", () => {
    const m = { ...id, scaleY: -1 };
    expect(rotateHandlePos(base, m, 20)).toEqual({ x: 200, y: 80 });
    expect(rotateHandleStem(base, m)).toEqual({ x: 200, y: 100 });
    expect(hitTestHandle(base, m, { x: 200, y: 150 }, 5, 20)).toBe("body");
  });
});

describe("applyScale (proportional)", () => {
  it("doubling the distance along the grab direction doubles both axes", () => {
    const out = applyScale(id, c0, { x: 300, y: 200 }, { x: 400, y: 250 });
    expect(out.scaleX).toBeCloseTo(2, 9);
    expect(out.scaleY).toBeCloseTo(2, 9);
    expect(out.dx).toBe(0);
    expect(out.rotation).toBe(0);
  });
  it("keeps each axis's sign", () => {
    const out = applyScale(
      { ...id, scaleX: -1, scaleY: 2 },
      c0,
      { x: 300, y: 200 },
      { x: 400, y: 250 },
    );
    expect(out.scaleX).toBeCloseTo(-2, 9);
    expect(out.scaleY).toBeCloseTo(4, 9);
  });
  it("dragging through the centre flips both axes", () => {
    const out = applyScale(id, c0, { x: 300, y: 200 }, { x: 100, y: 100 });
    expect(out.scaleX).toBeCloseTo(-1, 9);
    expect(out.scaleY).toBeCloseTo(-1, 9);
  });
  it("floors the magnitude at 0.05 on either side of zero", () => {
    expect(applyScale(id, c0, { x: 300, y: 200 }, { x: 200.001, y: 150 }).scaleX).toBe(0.05);
    expect(applyScale(id, c0, { x: 300, y: 200 }, { x: 199.999, y: 150 }).scaleX).toBe(-0.05);
  });
  it("a grab at the centre changes nothing", () => {
    expect(applyScale(id, c0, c0, { x: 400, y: 400 })).toBe(id);
  });
});

describe("applyFreeScale", () => {
  it("each axis follows the pointer independently", () => {
    const out = applyFreeScale(id, c0, { x: 300, y: 200 }, { x: 400, y: 225 });
    expect(out.scaleX).toBeCloseTo(2, 9);
    expect(out.scaleY).toBeCloseTo(1.5, 9);
  });
  it("measures in the target's rotated frame", () => {
    const r = { ...id, rotation: Math.PI / 2 };
    // local SE corner (100, 50) sits at doc offset (-50, 100) under a 90° turn
    const out = applyFreeScale(r, c0, { x: 150, y: 250 }, { x: 100, y: 350 });
    expect(out.scaleX).toBeCloseTo(2, 9);
    expect(out.scaleY).toBeCloseTo(2, 9);
  });
});

describe("applyStretch", () => {
  it("stretches only the named axis", () => {
    const out = applyStretch(id, "x", c0, { x: 300, y: 150 }, { x: 400, y: 190 });
    expect(out.scaleX).toBeCloseTo(2, 9);
    expect(out.scaleY).toBe(1);
    const outY = applyStretch(id, "y", c0, { x: 200, y: 200 }, { x: 260, y: 175 });
    expect(outY.scaleY).toBeCloseTo(0.5, 9);
    expect(outY.scaleX).toBe(1);
  });
  it("crossing the centre mirrors that axis, floored at 0.05", () => {
    expect(applyStretch(id, "x", c0, { x: 300, y: 150 }, { x: 150, y: 150 }).scaleX).toBeCloseTo(
      -0.5,
      9,
    );
    expect(applyStretch(id, "x", c0, { x: 300, y: 150 }, { x: 199.999, y: 150 }).scaleX).toBe(
      -0.05,
    );
  });
  it("follows rotation", () => {
    const r = { ...id, rotation: Math.PI / 2 };
    expect(applyStretch(r, "x", c0, { x: 200, y: 250 }, { x: 200, y: 350 }).scaleX).toBeCloseTo(
      2,
      9,
    );
  });
});

describe("dragTransform", () => {
  const start = { x: 300, y: 200 };
  const p = { x: 400, y: 225 };
  it("dispatches corners on keepProportions", () => {
    expect(dragTransform("se", id, c0, start, p, true)).toEqual(applyScale(id, c0, start, p));
    expect(dragTransform("se", id, c0, start, p, false)).toEqual(applyFreeScale(id, c0, start, p));
  });
  it("sides stretch one axis whatever keepProportions says", () => {
    const e = dragTransform("e", id, c0, { x: 300, y: 150 }, { x: 400, y: 150 }, true);
    expect([e.scaleX, e.scaleY]).toEqual([2, 1]);
    const n = dragTransform("n", id, c0, { x: 200, y: 100 }, { x: 200, y: 50 }, true);
    expect([n.scaleX, n.scaleY]).toEqual([1, 2]);
  });
  it("body moves and rotate rotates", () => {
    expect(dragTransform("body", id, c0, start, p, true)).toEqual(applyMove(id, 100, 25));
    expect(dragTransform("rotate", id, c0, start, p, true)).toEqual(applyRotate(id, c0, start, p));
  });
});

describe("mirrorTransform", () => {
  const t = { dx: 12, dy: -7, scaleX: 1.5, scaleY: -0.8, rotation: 0.6 };
  const probes = [
    { x: 110, y: 120 },
    { x: 290, y: 185 },
    { x: 200, y: 150 },
  ];
  it("H: every point lands on the reflection of where it was, across x = line", () => {
    const m = mirrorTransform(t, c0, "h", 230);
    for (const p of probes) {
      const q = forwardTransformPoint(base, t, p);
      const r = forwardTransformPoint(base, m, p);
      expect(r.x).toBeCloseTo(2 * 230 - q.x, 9);
      expect(r.y).toBeCloseTo(q.y, 9);
    }
  });
  it("V: the same across y = line", () => {
    const m = mirrorTransform(t, c0, "v", 140);
    for (const p of probes) {
      const q = forwardTransformPoint(base, t, p);
      const r = forwardTransformPoint(base, m, p);
      expect(r.x).toBeCloseTo(q.x, 9);
      expect(r.y).toBeCloseTo(2 * 140 - q.y, 9);
    }
  });
  it("mirroring twice is the identity", () => {
    for (const axis of ["h", "v"] as const) {
      const back = mirrorTransform(mirrorTransform(t, c0, axis, 230), c0, axis, 230);
      expect(back.dx).toBeCloseTo(t.dx, 9);
      expect(back.dy).toBeCloseTo(t.dy, 9);
      expect(back.scaleX).toBeCloseTo(t.scaleX, 9);
      expect(back.scaleY).toBeCloseTo(t.scaleY, 9);
      expect(back.rotation).toBeCloseTo(t.rotation, 9);
    }
  });
});

describe("mirrorTransformTrack", () => {
  const T = (dx: number, rotation: number, sx: number) => ({
    dx,
    dy: 3,
    scaleX: sx,
    scaleY: 1,
    rotation,
  });
  const track: TransformTrack = {
    keys: [
      { frame: 0, v: T(0, 0, 1), interp: "ease-in" },
      { frame: 10, v: T(80, 1.2, 2) },
    ],
    sampleEvery: 2,
    box: null,
  };
  const layerOf = (tr: TransformTrack) =>
    ({ kind: "draw", id: 1, name: "L", transform: T(0, 0, 1), tracks: { transform: tr } }) as Layer;

  it("an interpolated frame of the mirrored track is the mirror of the original's", () => {
    const m = mirrorTransformTrack(track, c0, "h", 250);
    for (const f of [0, 3, 4, 7, 10, 14]) {
      const want = mirrorTransform(transformAt(layerOf(track), f), c0, "h", 250);
      const got = transformAt(layerOf(m), f);
      expect(got.dx).toBeCloseTo(want.dx, 9);
      expect(got.scaleX).toBeCloseTo(want.scaleX, 9);
      expect(got.rotation).toBeCloseTo(want.rotation, 9);
    }
  });
  it("mirrors VALUES on the v axis too, not just the h axis", () => {
    // The h case above is value-checked; without this, hard-coding "h" inside mirrorTransformTrack
    // passes the whole suite while every vertical flip of an animated layer is wrong.
    const m = mirrorTransformTrack(track, c0, "v", 100);
    for (const f of [0, 3, 7, 10]) {
      const want = mirrorTransform(transformAt(layerOf(track), f), c0, "v", 100);
      const got = transformAt(layerOf(m), f);
      expect(got.dy).toBeCloseTo(want.dy, 9);
      expect(got.scaleY).toBeCloseTo(want.scaleY, 9);
      expect(got.rotation).toBeCloseTo(want.rotation, 9);
      expect(got.dx).toBeCloseTo(transformAt(layerOf(track), f).dx, 9); // x untouched by a v mirror
    }
  });

  it("keeps frames, easing, sampling and box, and leaves the input untouched", () => {
    const before = JSON.stringify(track);
    const m = mirrorTransformTrack(track, c0, "v", 100);
    expect(m.keys.map((k) => [k.frame, k.interp])).toEqual([
      [0, "ease-in"],
      [10, undefined],
    ]);
    expect(m.sampleEvery).toBe(2);
    expect(m.box).toBeNull();
    expect(JSON.stringify(track)).toBe(before);
  });
});

describe("applyRotate", () => {
  const center = { x: 200, y: 150 };
  it("a 90° pointer sweep adds π/2", () => {
    const out = applyRotate(id, center, { x: 300, y: 150 }, { x: 200, y: 250 });
    expect(out.rotation).toBeCloseTo(Math.PI / 2, 6);
    expect(out.scaleX).toBe(1);
    expect(out.scaleY).toBe(1);
    expect(out.dx).toBe(0);
  });
});

describe("inverseTransformPoint", () => {
  const base = { x: 0, y: 0, w: 100, h: 100 }; // doc center = (50,50)
  const id = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 };

  it("identity is a no-op", () => {
    expect(inverseTransformPoint(base, id, { x: 30, y: 70 })).toEqual({ x: 30, y: 70 });
  });

  it("pure translate subtracts the offset", () => {
    const p = inverseTransformPoint(base, { ...id, dx: 10, dy: -5 }, { x: 30, y: 70 });
    expect(p.x).toBeCloseTo(20, 5);
    expect(p.y).toBeCloseTo(75, 5);
  });

  it("pure scale divides distance from doc center", () => {
    const p = inverseTransformPoint(base, { ...id, scaleX: 2, scaleY: 2 }, { x: 70, y: 50 });
    expect(p.x).toBeCloseTo(60, 5);
    expect(p.y).toBeCloseTo(50, 5);
  });

  it("round-trips the forward render transform", () => {
    const t = { dx: 12, dy: -7, scaleX: 1.5, scaleY: 1.5, rotation: 0.6 };
    const cx = base.x + base.w / 2,
      cy = base.y + base.h / 2;
    const local = { x: 73, y: 21 };
    const ox = local.x - cx,
      oy = local.y - cy;
    const cos = Math.cos(t.rotation),
      sin = Math.sin(t.rotation);
    const screen = {
      x: cx + t.dx + (t.scaleX * ox * cos - t.scaleY * oy * sin),
      y: cy + t.dy + (t.scaleX * ox * sin + t.scaleY * oy * cos),
    };
    const back = inverseTransformPoint(base, t, screen);
    expect(back.x).toBeCloseTo(local.x, 4);
    expect(back.y).toBeCloseTo(local.y, 4);
  });
});

describe("forwardTransformPoint", () => {
  const base = { x: 0, y: 0, w: 100, h: 100 };
  const id = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 };
  it("identity is a no-op", () => {
    expect(forwardTransformPoint(base, id, { x: 30, y: 70 })).toEqual({ x: 30, y: 70 });
  });
  it("round-trips with inverseTransformPoint", () => {
    const t = { dx: 12, dy: -7, scaleX: 1.5, scaleY: 1.5, rotation: 0.6 };
    const p = { x: 73, y: 21 };
    const back = inverseTransformPoint(base, t, forwardTransformPoint(base, t, p));
    expect(back.x).toBeCloseTo(p.x, 5);
    expect(back.y).toBeCloseTo(p.y, 5);
  });
});

describe("forwardChain / inverseChain", () => {
  const docBase = { x: 0, y: 0, w: 100, h: 100 };
  const cellBase = { x: 20, y: 30, w: 40, h: 50 };
  const tLayer = { dx: 5, dy: -7, scaleX: 1.2, scaleY: 1.2, rotation: 0.3 };
  const tCell = { dx: -2, dy: 4, scaleX: 0.8, scaleY: 0.8, rotation: -0.15 };
  const tIdent = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 };

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

describe("isSameTransform", () => {
  const t = { dx: 3, dy: -1, scaleX: 1.5, scaleY: 1.5, rotation: 0.2 };
  it("exact field equality", () => {
    expect(isSameTransform(t, { ...t })).toBe(true);
    expect(isSameTransform(t, { ...t, dx: 3.0000001 })).toBe(false);
    expect(isSameTransform(t, { ...t, rotation: 0 })).toBe(false);
  });
});

describe("per-axis transforms", () => {
  const t = { dx: 12, dy: -7, scaleX: -1.5, scaleY: 0.8, rotation: 0.6 };
  it("forward then inverse round-trips with rotation, stretch and a mirror", () => {
    for (const p of [
      { x: 120, y: 130 },
      { x: 290, y: 190 },
      { x: 200, y: 150 },
    ]) {
      const q = inverseTransformPoint(base, t, forwardTransformPoint(base, t, p));
      expect(q.x).toBeCloseTo(p.x, 9);
      expect(q.y).toBeCloseTo(p.y, 9);
    }
  });
  it("corners are the forward map of the base corners", () => {
    const fwd = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 200 },
      { x: 100, y: 200 },
    ].map((p) => forwardTransformPoint(base, t, p));
    transformedCorners(base, t).forEach((c, i) => {
      expect(c.x).toBeCloseTo(fwd[i].x, 9);
      expect(c.y).toBeCloseTo(fwd[i].y, 9);
    });
  });
  it("isSameTransform compares both scales", () => {
    expect(isSameTransform(t, { ...t })).toBe(true);
    expect(isSameTransform(t, { ...t, scaleY: 0.81 })).toBe(false);
  });
});
