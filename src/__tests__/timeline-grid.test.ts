import { describe, it, expect } from "vitest";
import { columnAtX, lengthAtX, planCellPointer } from "../lib/timeline-grid";
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

describe("lengthAtX", () => {
  const W = 24;

  it("maps a boundary offset to that many frames (1-based, rounds to the nearest boundary)", () => {
    expect(lengthAtX(10 * W, W)).toBe(10);
    expect(lengthAtX(10 * W - 4, W)).toBe(10); // grabbed at the handle's left edge
    expect(lengthAtX(10 * W + 11, W)).toBe(10); // still nearer boundary 10 than 11
    expect(lengthAtX(10 * W + 13, W)).toBe(11);
  });

  it("is an absolute measure, so the same offset always yields the same length", () => {
    // The length drag re-measures from the strip's left edge every move; unlike a delta from a
    // screen-space origin it cannot accumulate (the bug that collapsed the length under a still
    // pointer once shrinking clamped the scroller).
    for (const n of [1, 5, 60]) expect(lengthAtX(n * W, W)).toBe(n);
  });

  it("clamps to the model's 1..9999", () => {
    expect(lengthAtX(0, W)).toBe(1);
    expect(lengthAtX(-500, W)).toBe(1);
    expect(lengthAtX(10_000 * W, W)).toBe(9999);
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

  it("puts a TRAILING hold's resize hotspot at the document's end, not the track's", () => {
    // One key, four document frames: the hold runs visually to frame 3, so the edge is at x = 96.
    expect(planCellPointer([k()], 94, W, 4)).toEqual({ kind: "resize", keyIndex: 0 });
    // ...and the old spot (the end of the stored track) is now just the key's own body.
    expect(planCellPointer([k()], 22, W, 4)).toEqual({ kind: "move", keyIndex: 0 });
  });

  it("leaves an INTERIOR span's hotspot where the next key starts", () => {
    // A later key stops the run, so the document's length is irrelevant here.
    expect(planCellPointer([k(), h(), k(), h()], 47, W, 8)).toEqual({
      kind: "resize",
      keyIndex: 0,
    });
  });
});

import { edgePx, moveCancelPx, MIN_CELL_W, MAX_CELL_W } from "../lib/timeline-grid";

describe("edgePx keeps the resize hotspot inside half a column", () => {
  it("is the historical 5px at the default 24px column", () => {
    expect(edgePx(24)).toBe(5);
  });

  it("never lets EDGE_PX + MOVE_CANCEL_PX reach half the column", () => {
    // The invariant recorded at Timeline.svelte:1051, asserted as it is actually stated — BOTH
    // thresholds against half the column, not edgePx alone. At 12px it is impossible with a fixed
    // MOVE_CANCEL_PX of 6, which is exactly why the cancel threshold scales too (Step 3).
    //
    // Every REACHABLE zoom-slider stop (min="12" step="2"), not just a convenient subset: sampling
    // only multiples of 4 ([12, 16, 20, 24, 28, 32]) stepped exactly over w=14 and w=18, where
    // `Math.round` on the old `moveCancelPx` rounded the `.5` case up and broke the invariant.
    for (let w = MIN_CELL_W; w <= MAX_CELL_W; w += 2) {
      expect(edgePx(w) + moveCancelPx(w)).toBeLessThan(w / 2);
    }
  });

  it("shrinks with the column rather than staying fixed", () => {
    expect(edgePx(12)).toBeLessThan(edgePx(24));
  });

  it("never collapses to nothing", () => {
    expect(edgePx(8)).toBeGreaterThanOrEqual(2);
  });
});
