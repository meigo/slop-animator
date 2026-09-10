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
} from "../anim/document";
import { cloneCell } from "../anim/timeline-block";
import { ensureDrawableKeyframe, insertKeyframe, clearFrameIsNoOp } from "../anim/timeline";
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
    expect(buildFrameDrawList(p, 3)).toEqual([
      { kind: "draw", layerId: 1, keyframeIndex: 1, opacity: 100 },
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
    const { canvas } = ensureDrawableKeyframe(layer, 3, fakeOps);
    expect((canvas as unknown as { __cloneOf: number }).__cloneOf).toBe(
      (b as unknown as { canvas: { __id: number } }).canvas.__id,
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
