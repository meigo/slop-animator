import { describe, it, expect } from "vitest";
import { mapDocPointToCell, mapDocRectToCell, mapDocPolyToCell } from "../core/selection-map";
import type { ComposeStep } from "../core/ref-transform";

const DOC = { x: 0, y: 0, w: 200, h: 100 };
const id = (over = {}): ComposeStep => ({
  base: DOC,
  t: { dx: 0, dy: 0, scale: 1, rotation: 0, ...over },
});

describe("mapDocPointToCell", () => {
  it("identity steps leave the point alone", () => {
    expect(mapDocPointToCell([id()], { x: 40, y: 20 })).toEqual({ x: 40, y: 20 });
    expect(mapDocPointToCell([], { x: 40, y: 20 })).toEqual({ x: 40, y: 20 });
  });

  it("undoes a translation (doc = cell + dx)", () => {
    expect(mapDocPointToCell([id({ dx: 30, dy: -10 })], { x: 70, y: 10 })).toEqual({
      x: 40,
      y: 20,
    });
  });

  it("undoes a 2× scale about the doc center", () => {
    // center (100, 50); a paper point 20 px right of center came from 10 px right in the cell
    const paper = { x: 120, y: 50 };
    const cell = mapDocPointToCell([id({ scale: 2 })], paper);
    expect(cell.x).toBeCloseTo(110);
    expect(cell.y).toBeCloseTo(50);
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

describe("mapDocPolyToCell", () => {
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
});
