import { describe, it, expect } from "vitest";
import type { Cell, DrawingLayer } from "../anim/document";
import {
  displayFrame,
  resolveDisplayKey,
  resolvedDisplayKeyCell,
  isLoopFrame,
  frameEditKeyCell,
  displayKeyChangeFrames,
  loopRegions,
  loopSourceFrame,
  countKeyframesPastLengthIn,
  buildFrameDrawList,
  isCrispFrame,
  createProject,
  mergeLoopsOk,
  whyNotMergeDown,
} from "../anim/document";
import {
  cloneCell,
  pasteBlockInsert,
  pasteBlockOverwrite,
  copyBlock,
  moveBlockFrames,
} from "../anim/timeline-block";
import {
  ensureDrawableKeyframe,
  insertKeyframe,
  clearFrameIsNoOp,
  rippleLoopBacks,
  normalizeLoopCell,
  insertFrameAllLayers,
  deleteFrameAllLayers,
  setHoldSpan,
  planMergeDown,
} from "../anim/timeline";
import type { CanvasOps } from "../anim/timeline";

let tag = 0;
export const k = (): Cell => ({
  kind: "key",
  canvas: { __id: ++tag } as unknown as HTMLCanvasElement,
});
export const h = (): Cell => ({ kind: "hold" });
export const lp = (back: number): Cell => ({ kind: "loop", back });
export function dl(cells: Cell[], id = 1): DrawingLayer {
  return {
    kind: "draw",
    id,
    name: `L${id}`,
    visible: true,
    locked: false,
    opacity: 100,
    boilStrength: 1,
    groupId: null,
    cells,
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  };
}
export const fakeOps: CanvasOps = {
  create: () => ({ __id: ++tag }) as unknown as HTMLCanvasElement,
  clone: (src) =>
    ({
      __cloneOf: (src as unknown as { __id: number }).__id,
      __id: ++tag,
    }) as unknown as HTMLCanvasElement,
};
const map = (cells: Cell[], n: number) =>
  Array.from({ length: n }, (_, f) => displayFrame(cells, f));

describe("loopSourceFrame", () => {
  it("replays [L-back, L-1] from L on", () => {
    expect([8, 9, 15, 16].map((f) => loopSourceFrame(8, 8, f))).toEqual([0, 1, 7, 0]);
  });
});

describe("displayFrame", () => {
  it("is the identity with no loops", () => {
    expect(map([k(), h(), k(), h()], 4)).toEqual([0, 1, 2, 3]);
  });
  it("drawing on 2s, loop at 8 back 8: 8..15 show 0..7, then again", () => {
    const cells = [k(), h(), k(), h(), k(), h(), k(), h(), lp(8), ...Array.from({ length: 7 }, h)];
    expect(map(cells, 18).slice(8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
  });
  it("a trailing loop keeps replaying past the stored track", () => {
    expect(displayFrame([k(), k(), lp(2)], 7)).toBe(1);
  });
  it("the next key ends the loop (inked or blank alike)", () => {
    expect(map([k(), k(), lp(2), h(), h(), k()], 6)).toEqual([0, 1, 0, 1, 0, 5]);
  });
  it("a second loop ends the first and starts its own cycle", () => {
    expect(map([k(), k(), k(), lp(3), h(), lp(1), h()], 7)).toEqual([0, 1, 2, 0, 1, 1, 1]);
  });
  it("a cycle containing another loop's region resolves through it", () => {
    expect(map([k(), k(), lp(2), h(), lp(4), h(), h(), h()], 8)).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
  });
  it("back may equal the loop frame", () => {
    expect(map([k(), h(), lp(2), h()], 4)).toEqual([0, 1, 0, 1]);
  });
  it("a malformed (NaN) back is treated as 1, not left to crash the remap", () => {
    expect(
      Number.isFinite(displayFrame([k(), h(), { kind: "loop", back: NaN } as Cell, h()], 3)),
    ).toBe(true);
  });
});

describe("resolveDisplayKey / resolvedDisplayKeyCell", () => {
  it("resolves the drawing on screen, not the raw hold", () => {
    const a = k();
    const b = k();
    const cells = [a, b, lp(2), h()];
    expect(resolveDisplayKey(cells, 2)).toBe(0);
    expect(resolveDisplayKey(cells, 3)).toBe(1);
    expect(resolvedDisplayKeyCell(dl(cells), 3)?.cell).toBe(b);
  });
  it("a loop before any key shows nothing", () => {
    expect(resolveDisplayKey([h(), h(), lp(2), h()], 3)).toBeNull();
  });
});

describe("isLoopFrame / frameEditKeyCell", () => {
  const cells = [k(), k(), lp(2), h(), k(), h()];
  it("is true from the loop key up to the key that ends it", () => {
    expect([0, 1, 2, 3, 4, 5].map((f) => isLoopFrame(cells, f))).toEqual([
      false,
      false,
      true,
      true,
      false,
      false,
    ]);
  });
  it("covers frames past the stored track in a trailing region", () => {
    expect(isLoopFrame([k(), lp(1)], 9)).toBe(true);
  });
  it("frameEditKeyCell is null inside a loop region, resolvedKeyCell outside", () => {
    expect(frameEditKeyCell(dl(cells), 3)).toBeNull();
    expect(frameEditKeyCell(dl(cells), 5)?.index).toBe(4);
  });
});

describe("displayKeyChangeFrames", () => {
  it("equals the raw key frames outside loops", () => {
    expect(displayKeyChangeFrames([k(), h(), k(), h()], 4)).toEqual([0, 2]);
  });
  it("counts the replayed keys inside a loop", () => {
    expect(displayKeyChangeFrames([k(), h(), k(), lp(3), h(), h(), h(), k()], 8)).toEqual([
      0, 2, 3, 5, 6, 7,
    ]);
  });
});

describe("loopRegions", () => {
  it("runs each loop to the next non-hold cell, or the document end", () => {
    expect(loopRegions([k(), lp(1), h(), k(), lp(1)], 7)).toEqual([
      { frame: 1, back: 1, end: 3 },
      { frame: 4, back: 1, end: 7 },
    ]);
  });
});

describe("loop cells in existing helpers", () => {
  it("cloneCell copies a loop cell as a new object", () => {
    const c = lp(3);
    const out = cloneCell(c, fakeOps);
    expect(out).toEqual({ kind: "loop", back: 3 });
    expect(out).not.toBe(c);
  });
  it("countKeyframesPastLengthIn counts loop keys too", () => {
    expect(countKeyframesPastLengthIn([dl([k(), k(), lp(1), h()])], 1)).toBe(2);
  });
});

describe("display readers honour loops", () => {
  it("buildFrameDrawList draws the replayed key", () => {
    const p = createProject();
    p.layers = [dl([k(), k(), lp(2), h()])];
    p.frameCount = 4;
    expect(buildFrameDrawList(p, 2)).toEqual([
      { kind: "draw", layerId: 1, keyframeIndex: 0, opacity: 100 },
    ]);
  });
  it("isCrispFrame: a replayed key frame is crisp with holds-only boil", () => {
    const cells = [k(), h(), lp(2), h()];
    expect(isCrispFrame(cells, 2, true)).toBe(true); // shows frame 0, a key
    expect(isCrispFrame(cells, 3, true)).toBe(false); // shows frame 1, a hold
  });
  it("ensureDrawableKeyframe on a repeat frame clones the drawing on screen", () => {
    const a = k();
    const b = k();
    const layer = dl([a, b, lp(2), h()]);
    const { canvas } = ensureDrawableKeyframe(layer, 2, fakeOps);
    expect((canvas as unknown as { __cloneOf: number }).__cloneOf).toBe(
      (a as unknown as { canvas: { __id: number } }).canvas.__id,
    );
  });
  it("insertKeyframe after a repeat frame clones the displayed drawing", () => {
    const a = k();
    const layer = dl([a, k(), lp(2), h()]);
    insertKeyframe(layer, 2, fakeOps); // frame 2 shows frame 0 = a
    const neu = layer.cells[3] as Extract<Cell, { kind: "key" }>;
    expect((neu.canvas as unknown as { __cloneOf: number }).__cloneOf).toBe(
      (a as unknown as { canvas: { __id: number } }).canvas.__id,
    );
  });
  it("clearFrameIsNoOp reads the displayed key", () => {
    const empty = { kind: "key", canvas: { __id: -1, empty: true } } as unknown as Cell;
    const cells = [k(), empty, lp(2), h()];
    const isEmpty = (c: HTMLCanvasElement) => !!(c as unknown as { empty?: boolean }).empty;
    expect(clearFrameIsNoOp(cells, 3, isEmpty)).toBe(true); // shows the blank key
    expect(clearFrameIsNoOp(cells, 2, isEmpty)).toBe(false); // shows the inked key
  });
});

const backAt = (cells: Cell[], i: number) => (cells[i] as { back: number }).back;
function splice(cells: Cell[], at: number, ins: number, del = 0): Cell[] {
  const out = cells.slice();
  out.splice(at, del, ...Array.from({ length: ins }, h));
  return out;
}

describe("rippleLoopBacks", () => {
  const base = () => [k(), k(), k(), lp(3), h()];
  it("insert inside the cycle grows back", () => {
    const c = splice(base(), 1, 1);
    rippleLoopBacks(c, 1, 1);
    expect(backAt(c, 4)).toBe(4);
  });
  it("insert at the cycle start lands before it: back unchanged", () => {
    const c = splice(base(), 0, 1);
    rippleLoopBacks(c, 0, 1);
    expect(backAt(c, 4)).toBe(3);
  });
  it("insert at the loop frame lands at the cycle's end: back grows", () => {
    const c = splice(base(), 3, 1);
    rippleLoopBacks(c, 3, 1);
    expect(backAt(c, 4)).toBe(4);
  });
  it("insert after the loop leaves it alone", () => {
    const c = splice(base(), 4, 1);
    rippleLoopBacks(c, 4, 1);
    expect(backAt(c, 3)).toBe(3);
  });
  it("multi-cell insert grows back by the count", () => {
    const c = splice([k(), k(), lp(2)], 1, 3);
    rippleLoopBacks(c, 1, 3);
    expect(backAt(c, 5)).toBe(5);
  });
  it("delete inside the cycle shrinks back", () => {
    const c = splice(base(), 1, 0, 1);
    rippleLoopBacks(c, 1, -1);
    expect(backAt(c, 2)).toBe(2);
  });
  it("delete before the cycle leaves back alone", () => {
    const c = splice([k(), k(), k(), k(), lp(2)], 0, 0, 1);
    rippleLoopBacks(c, 0, -1);
    expect(backAt(c, 3)).toBe(2);
  });
  it("back floors at 1", () => {
    const c = splice([k(), k(), lp(1)], 1, 0, 1);
    rippleLoopBacks(c, 1, -1);
    expect(backAt(c, 1)).toBe(1);
  });
  it("a loop shifted to frame 0 becomes a hold", () => {
    const c = splice([k(), lp(1)], 0, 0, 1);
    rippleLoopBacks(c, 0, -1);
    expect(c[0]).toEqual({ kind: "hold" });
  });
  it("replaces the loop cell, never mutates it (gotcha #8)", () => {
    const loop = lp(3);
    const c = splice([k(), k(), k(), loop], 1, 1);
    rippleLoopBacks(c, 1, 1);
    expect(loop).toEqual({ kind: "loop", back: 3 });
    expect(c[4]).not.toBe(loop);
  });
});

describe("normalizeLoopCell", () => {
  it("clamps back to the landing frame, and frame 0 becomes a hold", () => {
    expect(normalizeLoopCell(lp(5), 2)).toEqual({ kind: "loop", back: 2 });
    expect(normalizeLoopCell(lp(5), 0)).toEqual({ kind: "hold" });
    const ok = lp(2);
    expect(normalizeLoopCell(ok, 4)).toBe(ok);
  });
});

describe("splice ops ripple loops", () => {
  it("insertFrameAllLayers inside a cycle grows back", () => {
    const p = createProject();
    p.layers = [dl([k(), k(), lp(2), h()])];
    insertFrameAllLayers(p, 1);
    expect(backAt((p.layers[0] as DrawingLayer).cells, 3)).toBe(3);
  });
  it("deleteFrameAllLayers inside a cycle shrinks back", () => {
    const p = createProject();
    p.layers = [dl([k(), k(), k(), lp(3), h()])];
    deleteFrameAllLayers(p, 1);
    expect(backAt((p.layers[0] as DrawingLayer).cells, 2)).toBe(2);
  });
  it("setHoldSpan growing a key inside the cycle grows back", () => {
    const layer = dl([k(), k(), lp(2), h()]);
    setHoldSpan(layer, 1, 3); // key at 1 now owns 3 frames: loop moves to 4
    expect(layer.cells[4]).toEqual({ kind: "loop", back: 4 });
  });
  it("setHoldSpan on a loop cell sets its region length", () => {
    const layer = dl([k(), lp(1), h(), k()]);
    setHoldSpan(layer, 1, 4);
    expect(layer.cells.map((c) => c.kind)).toEqual(["key", "loop", "hold", "hold", "hold", "key"]);
  });
});

describe("block ops and loops", () => {
  function project(cells: Cell[]) {
    const p = createProject();
    p.layers = [dl(cells)];
    return p;
  }
  it("pasteBlockInsert ripples a loop after the paste point", () => {
    const p = project([k(), k(), lp(2), h()]);
    pasteBlockInsert(p, { cols: 1, rows: 1, columns: [[k()]] }, 1, 1, fakeOps);
    expect(backAt((p.layers[0] as DrawingLayer).cells, 3)).toBe(3);
  });
  it("a pasted loop landing at frame 0 becomes a hold; back is clamped", () => {
    const p = project([k(), h(), h(), h()]);
    pasteBlockOverwrite(p, { cols: 1, rows: 2, columns: [[lp(3), lp(9)]] }, 1, 0, fakeOps);
    const cells = (p.layers[0] as DrawingLayer).cells;
    expect(cells[0]).toEqual({ kind: "hold" });
    expect(cells[1]).toEqual({ kind: "loop", back: 1 });
  });
  it("copyBlock's leading repeat frame copies the drawing on screen", () => {
    const a = k();
    const p = project([a, k(), lp(2), h()]);
    const block = copyBlock(p, [1], 2, 2, fakeOps); // frame 2 shows a
    const c0 = block.columns[0][0] as Extract<Cell, { kind: "key" }>;
    expect((c0.canvas as unknown as { __cloneOf: number }).__cloneOf).toBe(
      (a as unknown as { canvas: { __id: number } }).canvas.__id,
    );
  });
  it("moving a repeat-frame hold to a frame showing a different drawing materialises it", () => {
    const a = k();
    const p = project([a, k(), lp(2), h(), h()]);
    moveBlockFrames(p, [1], 4, 4, 1, fakeOps); // frame 4 shows a; frame 5 would show b
    const cells = (p.layers[0] as DrawingLayer).cells;
    expect(cells[5].kind).toBe("key"); // a key in the region ends the loop there
  });
  it("moving it to a frame showing the same drawing keeps it a hold", () => {
    const p = project([k(), k(), lp(2), h(), h()]);
    moveBlockFrames(p, [1], 4, 4, 2, fakeOps); // 4 shows a; 6 shows a too
    expect((p.layers[0] as DrawingLayer).cells[6].kind).toBe("hold");
  });
});

describe("merge down with loops", () => {
  it("passes when the other layer is static across the loop", () => {
    expect(mergeLoopsOk([k()], [k(), k(), lp(2), h(), h()], 5)).toBe(true);
  });
  it("fails when the other layer changes inside the loop's region", () => {
    expect(mergeLoopsOk([k(), h(), h(), k()], [k(), k(), lp(2), h()], 4)).toBe(false);
  });
  it("passes when both layers loop in step", () => {
    expect(mergeLoopsOk([k(), k(), lp(2)], [k(), k(), lp(2)], 6)).toBe(true);
  });
  it("checks loops on the LOWER layer too", () => {
    expect(mergeLoopsOk([k(), k(), lp(2), h()], [k(), h(), h(), k()], 4)).toBe(false);
  });
  it("planMergeDown carries the loop, holds its region, keys outside", () => {
    const plan = planMergeDown([k()], [k(), k(), lp(2), h(), h()]);
    expect(plan.map((p) => p.kind)).toEqual(["key", "key", "loop", "hold", "hold"]);
    expect(plan[2]).toEqual({ kind: "loop", back: 2 });
  });
  it("planMergeDown keys the frame where the loop ends", () => {
    const plan = planMergeDown([k()], [k(), k(), lp(2), h(), k()]);
    expect(plan.map((p) => p.kind)).toEqual(["key", "key", "loop", "hold", "key"]);
  });
  it("planMergeDown is unchanged without loops", () => {
    expect(planMergeDown([k(), h()], [h(), k()]).map((p) => p.kind)).toEqual(["key", "key"]);
  });
  it("whyNotMergeDown refuses a loop that can't be kept", () => {
    const below = dl([k(), h(), h(), k()], 1);
    const upper = dl([k(), k(), lp(2), h()], 2);
    expect(whyNotMergeDown([below, upper], [], 2)).toBe("loop");
    expect(whyNotMergeDown([dl([k()], 1), upper], [], 2)).toBeNull();
  });
});
