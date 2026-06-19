import { describe, it, expect } from "vitest";
import { columnAtX, planCellPointer } from "../lib/timeline-grid";
import type { Cell } from "../anim/document";

describe("columnAtX", () => {
  const W = 24;

  it("maps an offset inside column 0 to 0", () => {
    expect(columnAtX(0, W, 10)).toBe(0);
    expect(columnAtX(23, W, 10)).toBe(0);
  });

  it("maps offsets to the column under the pointer (floor of offset/cellW)", () => {
    expect(columnAtX(24, W, 10)).toBe(1);
    expect(columnAtX(60, W, 10)).toBe(2); // 60/24 = 2.5 -> 2
  });

  it("clamps a negative offset to 0", () => {
    expect(columnAtX(-50, W, 10)).toBe(0);
  });

  it("clamps an offset past the end to the last column", () => {
    expect(columnAtX(10_000, W, 10)).toBe(9);
  });

  it("returns 0 when there are no columns", () => {
    expect(columnAtX(100, W, 0)).toBe(0);
  });
});

describe("planCellPointer", () => {
  const W = 24;
  const k = (): Cell => ({ kind: "key", canvas: {} as HTMLCanvasElement });
  const h = (): Cell => ({ kind: "hold" });

  it("seeks on an empty cell (no keyframe at or before it)", () => {
    expect(planCellPointer([h(), h()], 5, W, 2)).toEqual({ kind: "seek", frame: 0 });
  });

  it("seeks when the pointer is on a hold cell's body", () => {
    expect(planCellPointer([k(), h(), h(), k()], 30, W, 4)).toEqual({ kind: "seek", frame: 1 });
  });

  it("moves when the pointer grabs a keyframe cell's body", () => {
    expect(planCellPointer([k(), h(), h(), k()], 5, W, 4)).toEqual({ kind: "move", keyIndex: 0 });
  });

  it("resizes when the pointer is near the right edge of a key's span", () => {
    // span [0..2] (key 0 + holds 1,2), next key at 3 → span end column = 3 → right edge x = 72
    expect(planCellPointer([k(), h(), h(), k()], 71, W, 4)).toEqual({
      kind: "resize",
      keyIndex: 0,
    });
  });

  it("resizes at the right edge of a single-cell keyframe", () => {
    expect(planCellPointer([k()], 22, W, 1)).toEqual({ kind: "resize", keyIndex: 0 });
  });

  it("seeks past the layer's own end", () => {
    expect(planCellPointer([k()], 90, W, 4)).toEqual({ kind: "seek", frame: 3 });
  });
});
