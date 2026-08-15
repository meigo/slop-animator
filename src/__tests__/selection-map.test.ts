import { describe, it, expect } from "vitest";
import {
  mapDocRectToCell,
  mapDocPolyToCell,
  inverseComposeMatrix,
  applyMat6,
  needsMap,
} from "../core/selection-map";
import { forwardChain, inverseChain, type ComposeStep } from "../core/ref-transform";

const DOC = { x: 0, y: 0, w: 200, h: 100 };
const id = (over = {}): ComposeStep => ({
  base: DOC,
  t: { dx: 0, dy: 0, scale: 1, rotation: 0, ...over },
});

/** cell ∘ layer ∘ group, inner-to-outer, with a rotation in the middle — the highest-risk shape. */
const CHAIN: ComposeStep[] = [
  { base: { x: 20, y: 10, w: 80, h: 60 }, t: { dx: 12, dy: -7, scale: 1.4, rotation: 0.3 } },
  { base: DOC, t: { dx: -30, dy: 25, scale: 0.6, rotation: -0.75 } },
  { base: { x: 5, y: 5, w: 150, h: 90 }, t: { dx: 8, dy: 3, scale: 2, rotation: 1.1 } },
];

describe("needsMap", () => {
  it("is false for an empty or all-identity chain", () => {
    expect(needsMap([])).toBe(false);
    expect(needsMap([id(), id()])).toBe(false);
  });

  it("is true as soon as one step moves", () => {
    expect(needsMap([id(), id({ dx: 1 })])).toBe(true);
  });
});

describe("mapDocPolyToCell", () => {
  it("identity steps leave the points alone", () => {
    expect(mapDocPolyToCell([id()], [{ x: 40, y: 20 }])).toEqual([{ x: 40, y: 20 }]);
    expect(mapDocPolyToCell([], [{ x: 40, y: 20 }])).toEqual([{ x: 40, y: 20 }]);
  });

  it("copies the points on the identity path (never aliases the caller's objects)", () => {
    const pts = [{ x: 1, y: 2 }];
    const out = mapDocPolyToCell([], pts);
    expect(out[0]).not.toBe(pts[0]);
  });

  it("undoes a translation (doc = cell + dx)", () => {
    expect(mapDocPolyToCell([id({ dx: 30, dy: -10 })], [{ x: 70, y: 10 }])).toEqual([
      { x: 40, y: 20 },
    ]);
  });

  it("undoes a 2× scale about the doc center", () => {
    // center (100, 50); a paper point 20 px right of center came from 10 px right in the cell
    const [cell] = mapDocPolyToCell([id({ scale: 2 })], [{ x: 120, y: 50 }]);
    expect(cell.x).toBeCloseTo(110);
    expect(cell.y).toBeCloseTo(50);
  });

  it("maps each lasso point", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(mapDocPolyToCell([id({ dx: 5, dy: 0 })], pts)).toEqual([
      { x: -5, y: 0 },
      { x: 5, y: 0 },
    ]);
  });

  it("round-trips a rotated 3-step chain: cell → doc → cell is the identity", () => {
    const cellPts = [
      { x: 30, y: 20 },
      { x: 95, y: 22 },
      { x: 88, y: 61 },
      { x: 24, y: 58 },
    ];
    const docPts = cellPts.map((p) => forwardChain(CHAIN, p));
    // A wrong compose ORDER still round-trips per-step, so assert the doc points actually moved.
    expect(docPts[0].x).not.toBeCloseTo(cellPts[0].x);
    const back = mapDocPolyToCell(CHAIN, docPts);
    back.forEach((p, i) => {
      expect(p.x).toBeCloseTo(cellPts[i].x, 6);
      expect(p.y).toBeCloseTo(cellPts[i].y, 6);
    });
  });
});

describe("mapDocRectToCell", () => {
  it("identity: corners match the rect", () => {
    const r = { x: 10, y: 20, w: 40, h: 10 };
    expect(mapDocRectToCell([id()], r)).toEqual([
      { x: 10, y: 20 },
      { x: 50, y: 20 },
      { x: 50, y: 30 },
      { x: 10, y: 30 },
    ]);
  });

  it("2× scale maps a paper box to a half-size cell box about the same center", () => {
    const r = { x: 80, y: 40, w: 40, h: 20 }; // paper center (100, 50)
    const q = mapDocRectToCell([id({ scale: 2 })], r);
    expect(q[0].x).toBeCloseTo(90);
    expect(q[0].y).toBeCloseTo(45);
    expect(q[2].x).toBeCloseTo(110);
    expect(q[2].y).toBeCloseTo(55);
  });
});

describe("inverseComposeMatrix", () => {
  const SAMPLES = [
    { x: 0, y: 0 },
    { x: 200, y: 100 },
    { x: 37, y: 84 },
    { x: -25, y: 130 },
  ];

  it("is the identity for an empty or all-identity chain", () => {
    expect(inverseComposeMatrix([])).toEqual([1, 0, 0, 1, 0, 0]);
    expect(inverseComposeMatrix([id(), id()])).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("agrees with inverseChain on a single translated + scaled step", () => {
    const steps = [id({ dx: 30, dy: -10, scale: 2 })];
    const m = inverseComposeMatrix(steps);
    for (const p of SAMPLES) {
      const viaMatrix = applyMat6(m, p);
      const viaChain = inverseChain(steps, p);
      expect(viaMatrix.x).toBeCloseTo(viaChain.x, 6);
      expect(viaMatrix.y).toBeCloseTo(viaChain.y, 6);
    }
  });

  it("agrees with inverseChain over a rotated 3-step chain (compose order)", () => {
    const m = inverseComposeMatrix(CHAIN);
    for (const p of SAMPLES) {
      const viaMatrix = applyMat6(m, p);
      const viaChain = inverseChain(CHAIN, p);
      expect(viaMatrix.x).toBeCloseTo(viaChain.x, 6);
      expect(viaMatrix.y).toBeCloseTo(viaChain.y, 6);
    }
  });

  it("inverts forwardChain over the same rotated chain", () => {
    const m = inverseComposeMatrix(CHAIN);
    for (const p of SAMPLES) {
      const back = applyMat6(m, forwardChain(CHAIN, p));
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
  });
});
