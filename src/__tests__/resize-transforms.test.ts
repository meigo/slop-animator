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
  accumulatePendingFit,
  applyPendingFit,
  pendingFitFactor,
  settlePendingFit,
  centredBands,
  centredCellOffset,
  resizeCentredTransform,
  turnsOrScales,
  type Anchor,
  type Placement,
  type ResizeMode,
} from "../anim/resize";
import { forwardTransformPoint, MIN_SCALE } from "../core/ref-transform";
import { containRect, type PendingFit, type ReferenceLayer } from "../anim/document";

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

// Review 2026-10-17 #11: a layer track's keys are lerped linearly, while the anchor correction
// `A·e` of resizeDocPivotTransform is not linear in the rotation, so in-between frames drifted
// (134 px at the midpoint of a 0°→90° pair after a middle-left Crop of 1920 → 1000). A layer whose
// track turns or scales gets its cells placed CENTRED instead, and its whole anchor shift goes into
// the translation, which is linear — exact on every frame.
describe("an animated, turning layer stays exact between keys (resizeCentredTransform)", () => {
  const lerp = (a: typeof T, b: typeof T, u: number) => ({
    dx: a.dx + (b.dx - a.dx) * u,
    dy: a.dy + (b.dy - a.dy) * u,
    scaleX: a.scaleX + (b.scaleX - a.scaleX) * u,
    scaleY: a.scaleY + (b.scaleY - a.scaleY) * u,
    rotation: a.rotation + (b.rotation - a.rotation) * u,
  });
  const K0 = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 };
  const K1 = { dx: 40, dy: -30, scaleX: 1.3, scaleY: 0.8, rotation: Math.PI / 2 };

  it("the review's scenario: middle-left Crop 1920×1080 → 1000×1080, frame 5 of 0°→90°", () => {
    const { pl, M } = placement(1920, 1080, 1000, 1080, "crop", { ax: 0, ay: 0.5 });
    const R0 = { ...K0 };
    const R1 = { ...K0, rotation: Math.PI / 2 };
    const want = M(
      forwardTransformPoint({ x: 0, y: 0, w: 1920, h: 1080 }, lerp(R0, R1, 0.5), {
        x: 500,
        y: 540,
      }),
    );
    const o = centredCellOffset(pl, 1);
    const q = { x: pl.f * 500 + o.x, y: pl.f * 540 + o.y };
    const t = lerp(resizeCentredTransform(R0, pl, o), resizeCentredTransform(R1, pl, o), 0.5);
    const got = forwardTransformPoint({ x: 0, y: 0, w: 1000, h: 1080 }, t, q);
    expect(got.x).toBeCloseTo(want.x, 6);
    expect(got.y).toBeCloseTo(want.y, 6);
    // The old mapping is the drift the review measured.
    const old = lerp(resizeDocPivotTransform(R0, pl), resizeDocPivotTransform(R1, pl), 0.5);
    const drift = forwardTransformPoint(
      { x: 0, y: 0, w: 1000, h: 1080 },
      old,
      M({ x: 500, y: 540 }),
    );
    expect(Math.hypot(drift.x - want.x, drift.y - want.y)).toBeGreaterThan(100);
  });

  it("every in-between frame shows where the resize moved it, over modes and anchors", () => {
    each((W, H, W2, H2, mode, a) => {
      const { pl, M } = placement(W, H, W2, H2, mode, a);
      const o = centredCellOffset(pl, 1);
      const k0 = resizeCentredTransform(K0, pl, o);
      const k1 = resizeCentredTransform(K1, pl, o);
      for (const u of [0, 0.25, 0.5, 0.8, 1])
        for (const p of pts) {
          const want = M(forwardTransformPoint({ x: 0, y: 0, w: W, h: H }, lerp(K0, K1, u), p));
          const q = { x: pl.f * p.x + o.x, y: pl.f * p.y + o.y };
          const got = forwardTransformPoint({ x: 0, y: 0, w: W2, h: H2 }, lerp(k0, k1, u), q);
          expect(got.x).toBeCloseTo(want.x, 6);
          expect(got.y).toBeCloseTo(want.y, 6);
        }
    });
  });

  it("the centred cell keeps every pixel in Scale and in a growing Crop", () => {
    for (const [W, H, W2, H2, mode] of [
      [1920, 1080, 1000, 1080, "scale"],
      [1000, 800, 2000, 800, "scale"],
      [1000, 800, 1200, 900, "crop"],
    ] as [number, number, number, number, ResizeMode][]) {
      const { pl } = placement(W, H, W2, H2, mode, { ax: 0, ay: 0 });
      const o = centredCellOffset(pl, 1);
      expect(o.x).toBeGreaterThanOrEqual(-1e-9);
      expect(o.y).toBeGreaterThanOrEqual(-1e-9);
      expect(o.x + pl.f * W).toBeLessThanOrEqual(W2 + 1e-9);
      expect(o.y + pl.f * H).toBeLessThanOrEqual(H2 + 1e-9);
    }
  });

  it("an odd margin in a Crop copies whole pixels: keys exact, in-betweens within the remainder", () => {
    // The batch-B review's case: 1000×800 → 1201×800 Crop, middle-left; C' − C = 100.5.
    for (const dpr of [1, 2]) {
      const { pl, M } = placement(1000, 800, 1201, 801, "crop", { ax: 0, ay: 0.5 });
      const o = centredCellOffset(pl, dpr);
      expect(Number.isInteger(o.x * dpr)).toBe(true);
      expect(Number.isInteger(o.y * dpr)).toBe(true);
      const k0 = resizeCentredTransform(K0, pl, o);
      const k1 = resizeCentredTransform(K1, pl, o);
      for (const u of [0, 0.3, 0.5, 1])
        for (const p of pts) {
          const want = M(
            forwardTransformPoint({ x: 0, y: 0, w: 1000, h: 800 }, lerp(K0, K1, u), p),
          );
          const q = { x: p.x + o.x, y: p.y + o.y };
          const got = forwardTransformPoint({ x: 0, y: 0, w: 1201, h: 801 }, lerp(k0, k1, u), q);
          const err = Math.hypot(got.x - want.x, got.y - want.y);
          if (u === 0 || u === 1) expect(err).toBeLessThan(1e-6);
          else expect(err).toBeLessThanOrEqual(Math.SQRT1_2 / dpr + 1e-9);
        }
    }
  });

  it("a Scale keeps the exact (unrounded) offset", () => {
    const { pl } = placement(1000, 800, 1201, 900, "scale", { ax: 0, ay: 0 });
    const o = centredCellOffset(pl, 1);
    expect(o.x).toBeCloseTo(pl.newW / 2 - (pl.f * 1000) / 2, 12);
  });

  it("centredBands: which band of the new paper the centred cell no longer reaches", () => {
    // The review's cases: Scale 1920×1080 → 1000×1080 top-left: e.y = −259 → the bottom 259 px.
    expect(centredBands(placement(1920, 1080, 1000, 1080, "scale", { ax: 0, ay: 0 }).pl)).toEqual([
      { edge: "bottom", px: 259 },
    ]);
    // Crop 1000 → 1400 anchored left: e.x = −200 → the right 200 px.
    expect(centredBands(placement(1000, 800, 1400, 800, "crop", { ax: 0, ay: 0.5 }).pl)).toEqual([
      { edge: "right", px: 200 },
    ]);
    expect(centredBands(placement(1000, 800, 1400, 900, "crop", { ax: 1, ay: 1 }).pl)).toEqual([
      { edge: "left", px: 200 },
      { edge: "top", px: 50 },
    ]);
    expect(centredBands(placement(1000, 800, 1400, 800, "crop", { ax: 0.5, ay: 0.5 }).pl)).toEqual(
      [],
    );
  });

  it("turnsOrScales: only a track whose keys differ in turn or scale needs it", () => {
    expect(turnsOrScales([K0])).toBe(false);
    expect(turnsOrScales([K0, { ...K0, dx: 50, dy: 9 }])).toBe(false);
    expect(turnsOrScales([K0, { ...K0, rotation: 0.1 }])).toBe(true);
    expect(turnsOrScales([K0, { ...K0, scaleY: -1 }])).toBe(true);
  });
});

// Review 2026-10-17 #17: every other path floors a scale's magnitude at MIN_SCALE (in-betweens,
// load, the next drag), so a resize that left one below it showed right until any of those ran.
describe("resizeFitTransform keeps a reference's scale at or above the floor", () => {
  it("the review's scenario: 480×270 → 1920×1080 Crop, scale 0.15 → floored at 0.05", () => {
    const pl: Placement = { f: 1, ox: 720, oy: 405, oldW: 480, oldH: 270, newW: 1920, newH: 1080 };
    const t = resizeFitTransform({ dx: 0, dy: 0, scaleX: 0.15, scaleY: -0.15, rotation: 0 }, pl, 4);
    expect(t.scaleX).toBe(MIN_SCALE);
    expect(t.scaleY).toBe(-MIN_SCALE); // a mirror stays mirrored
  });
  it("a scale that stays above the floor is exact", () => {
    const pl: Placement = { f: 1, ox: 0, oy: 0, oldW: 480, oldH: 270, newW: 1920, newH: 1080 };
    const t = resizeFitTransform({ dx: 0, dy: 0, scaleX: 0.8, scaleY: 0.8, rotation: 0 }, pl, 4);
    expect(t.scaleX).toBeCloseTo(0.2, 12);
  });
});

// Review 2026-10-17 #18: a reference whose media is missing has no size, so its re-fit (k) can't
// be known and the resize leaves its scale as it was. The resize records what it couldn't do, and
// a relink applies it once the size is known.
describe("a pending re-fit for a reference with unknown media size", () => {
  const media = { w: 1920, h: 1080 }; // 16:9 video
  const T0 = { dx: 12, dy: -7, scaleX: 0.9, scaleY: -0.9, rotation: 0.3 };
  function known(W: number, H: number, W2: number, H2: number, mode: ResizeMode, t: typeof T0) {
    const { pl } = placement(W, H, W2, H2, mode, { ax: 0, ay: 0.5 });
    const k = containRect(media.w, media.h, W2, H2).w / containRect(media.w, media.h, W, H).w;
    return { t: resizeFitTransform(t, pl, k), pl };
  }
  function unknown(
    W: number,
    H: number,
    W2: number,
    H2: number,
    mode: ResizeMode,
    t: typeof T0,
    p?: PendingFit,
  ) {
    const { pl } = placement(W, H, W2, H2, mode, { ax: 0, ay: 0.5 });
    return { t: resizeFitTransform(t, pl, pl.f), pending: accumulatePendingFit(p, pl) };
  }

  it("the review's scenario: 1920×1080 → 1080×1080 Crop, relinked after", () => {
    const want = known(1920, 1080, 1080, 1080, "crop", T0).t;
    const { t, pending } = unknown(1920, 1080, 1080, 1080, "crop", T0);
    const got = applyPendingFit(t, pendingFitFactor(pending, media, 1080, 1080));
    expect(got.scaleX).toBeCloseTo(want.scaleX, 9);
    expect(got.scaleY).toBeCloseTo(want.scaleY, 9);
    expect(got.dx).toBeCloseTo(want.dx, 9); // the centre was right all along
    expect(got.dy).toBeCloseTo(want.dy, 9);
  });

  it("several resizes before the relink add up to the same as with the size known", () => {
    const a = known(1920, 1080, 1080, 1080, "crop", T0);
    const b = known(1080, 1080, 640, 900, "scale", a.t);
    const c = known(640, 900, 2000, 700, "crop", b.t);
    const u1 = unknown(1920, 1080, 1080, 1080, "crop", T0);
    const u2 = unknown(1080, 1080, 640, 900, "scale", u1.t, u1.pending);
    const u3 = unknown(640, 900, 2000, 700, "crop", u2.t, u2.pending);
    const got = applyPendingFit(u3.t, pendingFitFactor(u3.pending, media, 2000, 700));
    expect(got.scaleX).toBeCloseTo(c.t.scaleX, 9);
    expect(got.dx).toBeCloseTo(c.t.dx, 9);
  });

  it("a factor of 1 when the size is still unknown", () => {
    const { pending } = unknown(1920, 1080, 1080, 1080, "crop", T0);
    expect(pendingFitFactor(pending, { w: 0, h: 0 }, 1080, 1080)).toBe(1);
  });
});

describe("settlePendingFit", () => {
  function ref(media: unknown, pendingFit?: PendingFit): ReferenceLayer {
    return {
      kind: "ref",
      id: 1,
      name: "v",
      visible: true,
      opacity: 100,
      offsetFrames: 0,
      speed: 1,
      audioEnabled: false,
      groupId: null,
      media: media as ReferenceLayer["media"],
      pendingFit,
      transform: { dx: 5, dy: 6, scaleX: 1, scaleY: 1, rotation: 0 },
      tracks: {
        transform: {
          box: null,
          keys: [{ frame: 0, v: { dx: 0, dy: 0, scaleX: 2, scaleY: -2, rotation: 1 } }],
        },
      },
    };
  }
  const pending = { w: 1920, h: 1080, f: 1 }; // the review's Crop to 1080×1080
  it("scales the static transform and every key once the media has a size, then clears", () => {
    const l = ref({ type: "video", el: { videoWidth: 1920, videoHeight: 1080 } }, pending);
    const before = l.tracks!.transform!;
    expect(settlePendingFit(l, 1080, 1080)).toBe(true);
    expect(l.transform.scaleX).toBeCloseTo(1920 / 1080, 9);
    expect(l.transform.dx).toBe(5);
    expect(l.tracks!.transform!.keys[0].v.scaleY).toBeCloseTo((-2 * 1920) / 1080, 9);
    expect(l.tracks!.transform).not.toBe(before); // replaced, not mutated (gotcha #8)
    expect(before.keys[0].v.scaleX).toBe(2);
    expect(l.pendingFit).toBeUndefined();
  });
  it("waits while the media is still a placeholder", () => {
    const l = ref({ type: "missing", was: "video", name: "v" }, pending);
    expect(settlePendingFit(l, 1080, 1080)).toBe(false);
    expect(l.pendingFit).toEqual(pending);
    expect(l.transform.scaleX).toBe(1);
  });
});
