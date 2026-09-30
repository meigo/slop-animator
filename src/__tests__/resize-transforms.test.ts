import { describe, it, expect } from "vitest";
import {
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
