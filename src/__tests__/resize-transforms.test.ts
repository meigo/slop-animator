import { describe, it, expect } from "vitest";
import {
  cropBakeMatrix,
  cropShift,
  cropTransformPlan,
  placeContent,
  resizeBox,
  resizeContentPivotTransform,
  resizeDocPivotTransform,
  resizeFitTransform,
  type Anchor,
  type Placement,
  type ResizeMode,
} from "../anim/resize";
import { forwardTransformPoint } from "../core/ref-transform";
import { containRect } from "../anim/document";

// After a resize every transformed thing must show where the resize moved its pixels: the new
// render of the moved point equals the moved old render. Checked against the renderer's own
// forward mapping, over both modes, every anchor, and turned / mirrored / stretched transforms.
const T = { dx: 120, dy: -45, scaleX: 1.7, scaleY: -0.6, rotation: 0.9 };
const cases: [number, number, number, number][] = [
  [1000, 800, 2000, 800],
  [1920, 1080, 960, 540],
  [1000, 1000, 640, 480],
];
const anchors: Anchor[] = [
  { ax: 0, ay: 0 },
  { ax: 0.5, ay: 0.5 },
  { ax: 1, ay: 0 },
  { ax: 0, ay: 1 },
];
const pts = [
  { x: 0, y: 0 },
  { x: 300, y: 200 },
  { x: 777, y: 555 },
];

function placement(W: number, H: number, W2: number, H2: number, mode: ResizeMode, a: Anchor) {
  const r = placeContent(W, H, W2, H2, mode, a);
  const pl: Placement = { f: r.w / W, ox: r.x, oy: r.y, oldW: W, oldH: H, newW: W2, newH: H2 };
  const M = (p: { x: number; y: number }) => ({ x: pl.f * p.x + pl.ox, y: pl.f * p.y + pl.oy });
  return { pl, M };
}

function each(
  fn: (W: number, H: number, W2: number, H2: number, mode: ResizeMode, a: Anchor) => void,
) {
  for (const [W, H, W2, H2] of cases)
    for (const mode of ["scale", "crop"] as ResizeMode[])
      for (const a of anchors) fn(W, H, W2, H2, mode, a);
}

describe("transforms follow a canvas resize", () => {
  it("a drawing layer (turns about the document centre)", () => {
    each((W, H, W2, H2, mode, a) => {
      const { pl, M } = placement(W, H, W2, H2, mode, a);
      const t2 = resizeDocPivotTransform(T, pl);
      for (const p of pts) {
        const want = M(forwardTransformPoint({ x: 0, y: 0, w: W, h: H }, T, p));
        const got = forwardTransformPoint({ x: 0, y: 0, w: W2, h: H2 }, t2, M(p));
        expect(got.x).toBeCloseTo(want.x, 6);
        expect(got.y).toBeCloseTo(want.y, 6);
      }
    });
  });

  it("a reference layer (contain-fitted and centred, re-fitted to the new document)", () => {
    const mw = 640,
      mh = 360;
    each((W, H, W2, H2, mode, a) => {
      const { pl, M } = placement(W, H, W2, H2, mode, a);
      const b1 = containRect(mw, mh, W, H);
      const b2 = containRect(mw, mh, W2, H2);
      const t2 = resizeFitTransform(T, pl, b2.w / b1.w);
      for (const u of [
        { x: 0, y: 0 },
        { x: 0.3, y: 0.8 },
        { x: 1, y: 1 },
      ]) {
        const want = M(
          forwardTransformPoint(b1, T, { x: b1.x + u.x * b1.w, y: b1.y + u.y * b1.h }),
        );
        const got = forwardTransformPoint(b2, t2, { x: b2.x + u.x * b2.w, y: b2.y + u.y * b2.h });
        expect(got.x).toBeCloseTo(want.x, 6);
        expect(got.y).toBeCloseTo(want.y, 6);
      }
    });
  });

  it("a group (turns about its content or its frozen box, both carried by the placement)", () => {
    const box = { x: 200, y: 150, w: 300, h: 220 };
    each((W, H, W2, H2, mode, a) => {
      const { pl, M } = placement(W, H, W2, H2, mode, a);
      const t2 = resizeContentPivotTransform(T, pl);
      const box2 = resizeBox(box, pl);
      for (const p of pts) {
        const want = M(forwardTransformPoint(box, T, p));
        const got = forwardTransformPoint(box2, t2, M(p));
        expect(got.x).toBeCloseTo(want.x, 6);
        expect(got.y).toBeCloseTo(want.y, 6);
      }
    });
  });

  it("an untransformed drawing layer stays untransformed", () => {
    const id = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 };
    each((W, H, W2, H2, mode, a) => {
      const { pl } = placement(W, H, W2, H2, mode, a);
      const t2 = resizeDocPivotTransform(id, pl);
      expect(t2.dx).toBeCloseTo(0, 9);
      expect(t2.dy).toBeCloseTo(0, 9);
    });
  });
});

// Crop works on CELL pixels, so a transformed layer shows a different part of its cell than the
// paper window the crop keeps (2026-10-17 review #6).
describe("cropTransformPlan", () => {
  const shrink = { mode: "crop" as const, oldW: 1920, oldH: 1080, newW: 1500, newH: 1080 };
  const I = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 };
  const plain = { transform: I, animated: false, groupTransformed: false };
  const moved = { ...plain, transform: { ...I, dx: 400 } };

  it("leaves every layer alone unless a Crop shrinks a side (Scale and a growing Crop keep every cell pixel)", () => {
    expect(cropTransformPlan({ ...shrink, mode: "scale" }, moved)).toBe("keep");
    expect(cropTransformPlan({ ...shrink, newW: 2000, newH: 1200 }, moved)).toBe("keep");
    expect(cropTransformPlan({ ...shrink, newW: 2000, newH: 1000 }, moved)).toBe("shift");
    expect(cropTransformPlan(shrink, plain)).toBe("keep");
  });

  it("shifts the window for a move or a flip, bakes a scale or a turn", () => {
    expect(cropTransformPlan(shrink, moved)).toBe("shift");
    expect(cropTransformPlan(shrink, { ...plain, transform: { ...I, scaleX: -1, dy: 3 } })).toBe(
      "shift",
    );
    expect(cropTransformPlan(shrink, { ...plain, transform: { ...I, scaleX: 0.5 } })).toBe("bake");
    expect(cropTransformPlan(shrink, { ...plain, transform: { ...I, rotation: 0.3 } })).toBe(
      "bake",
    );
    expect(cropTransformPlan(shrink, { ...plain, transform: { ...I, rotation: Math.PI } })).toBe(
      "bake",
    );
  });

  it("can't keep an animated layer or one inside a transformed group: those may lose pixels", () => {
    expect(cropTransformPlan(shrink, { ...plain, animated: true })).toBe("loses");
    expect(cropTransformPlan(shrink, { ...plain, groupTransformed: true })).toBe("loses");
    expect(cropTransformPlan(shrink, { ...moved, groupTransformed: true })).toBe("loses");
  });
});

describe("a Crop keeps what a moved or flipped layer showed (cropShift)", () => {
  const crops: [number, number, number, number][] = [
    [1920, 1080, 1500, 1080],
    [1920, 1080, 1500, 1600], // one side shrinks, the other grows
    [1001, 801, 640, 480],
  ];
  const moves = [
    { dx: 400, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    { dx: -137.25, dy: 300, scaleX: 1, scaleY: 1, rotation: 0 },
    { dx: 90, dy: -40.5, scaleX: -1, scaleY: 1, rotation: 0 },
    { dx: 0, dy: 0, scaleX: -1, scaleY: -1, rotation: 0 },
  ];
  it("the new render of each moved cell pixel is where the old one showed, moved by the crop", () => {
    for (const [W, H, W2, H2] of crops)
      for (const a of anchors)
        for (const t of moves) {
          const { pl, M } = placement(W, H, W2, H2, "crop", a);
          const { offset, transform } = cropShift(t, pl);
          // Whole pixels relative to the placement: copied, not resampled.
          expect(Number.isInteger(offset.x - pl.ox)).toBe(true);
          expect(Number.isInteger(offset.y - pl.oy)).toBe(true);
          for (const p of pts) {
            const want = M(forwardTransformPoint({ x: 0, y: 0, w: W, h: H }, t, p));
            const q = { x: p.x + offset.x, y: p.y + offset.y };
            const got = forwardTransformPoint({ x: 0, y: 0, w: W2, h: H2 }, transform, q);
            expect(got.x).toBeCloseTo(want.x, 6);
            expect(got.y).toBeCloseTo(want.y, 6);
          }
        }
  });

  it("every cell pixel that shows inside the new document lands inside the new cell", () => {
    // Review scenario (a): moved 400 px right, Crop to 1500 wide from the right.
    const { pl } = placement(1920, 1080, 1500, 1080, "crop", { ax: 1, ay: 0.5 });
    const t = { dx: 400, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 };
    const { offset, transform } = cropShift(t, pl);
    // Old cell x 20..1100 showed at paper 420..1500, i.e. new x 0..1080 after the -420 crop.
    for (const x of [20, 500, 1100]) {
      const q = x + offset.x;
      expect(q).toBeGreaterThanOrEqual(0);
      expect(q).toBeLessThanOrEqual(1500);
    }
    expect(transform.dx).toBe(0); // a whole-pixel move goes into the pixels entirely
  });
});

describe("a Crop bakes a scaled or turned layer into the new canvas (cropBakeMatrix)", () => {
  const turns = [
    { dx: 0, dy: 0, scaleX: 0.5, scaleY: 0.5, rotation: 0 },
    { dx: 120, dy: -45, scaleX: 1.7, scaleY: -0.6, rotation: 0.9 },
  ];
  it("draws each cell pixel where it showed, moved by the crop", () => {
    for (const [W, H, W2, H2] of [
      [1920, 1080, 1000, 1080],
      [1920, 1080, 1500, 1600],
    ])
      for (const a of anchors)
        for (const t of turns) {
          const { pl, M } = placement(W, H, W2, H2, "crop", a);
          const [ma, mb, mc, md, me, mf] = cropBakeMatrix(t, pl);
          for (const p of pts) {
            const want = M(forwardTransformPoint({ x: 0, y: 0, w: W, h: H }, t, p));
            expect(ma * p.x + mc * p.y + me).toBeCloseTo(want.x, 6);
            expect(mb * p.x + md * p.y + mf).toBeCloseTo(want.y, 6);
          }
        }
  });
});
