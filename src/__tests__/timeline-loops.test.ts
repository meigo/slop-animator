import { describe, it, expect } from "vitest";
import type { Cell, DrawingLayer } from "../anim/document";
import { computeTimelineGlyphs, resolveGlyphHolds } from "../lib/timeline-glyphs";
import { computeTimelineSpans } from "../lib/timeline-spans";
import { computeLoopGhostSpans, defaultLoopBack, loopButtonState } from "../lib/timeline-loops";
import { planCellPointer } from "../lib/timeline-grid";
import { setLoop, removeLoop, setLoopBack } from "../anim/timeline";

const key = (empty = false) =>
  ({ kind: "key", canvas: { empty } as unknown as HTMLCanvasElement }) as Cell;
const hold = () => ({ kind: "hold" }) as Cell;
const loop = (back: number) => ({ kind: "loop", back }) as Cell;
const isEmpty = (c: HTMLCanvasElement) => (c as unknown as { empty: boolean }).empty;
const glyphs = (cells: Cell[], n: number) => computeTimelineGlyphs(cells, n, isEmpty);
const layerOf = (cells: Cell[]) => ({ kind: "draw", id: 1, cells }) as unknown as DrawingLayer;

describe("glyphs with loops", () => {
  it("↺ on the loop key, blank across its region (the ghosts draw it)", () => {
    expect(glyphs([key(), key(), loop(2), hold(), hold()], 6)).toEqual(["◆", "◆", "↺", "", "", ""]);
  });
  it("the key that ends the loop draws solid again", () => {
    expect(glyphs([key(), loop(1), hold(), key()], 4)).toEqual(["◆", "↺", "", "◆"]);
  });
  it("solid spans stop at the loop key", () => {
    expect(computeTimelineSpans(glyphs([key(), hold(), loop(2), hold()], 4))).toEqual([
      { startFrame: 0, endFrame: 1, blank: false, keyFrames: [0] },
    ]);
  });
  it("resolveGlyphHolds keeps ↺ and blanks the holds after it", () => {
    expect(resolveGlyphHolds(["◆", "—", "↺", "—"])).toEqual(["◆", "—", "↺", ""]);
  });
});

describe("computeLoopGhostSpans", () => {
  it("replays the cycle's spans across the region", () => {
    const cells = [key(), hold(), key(), hold(), loop(4), hold(), hold(), hold()];
    expect(computeLoopGhostSpans(cells, glyphs(cells, 8), 8)).toEqual([
      { startFrame: 4, endFrame: 7, blank: false, keyFrames: [4, 6] },
    ]);
  });
  it("replays a blank key as a ghost hollow diamond", () => {
    const cells = [key(), key(true), loop(2), hold()];
    expect(computeLoopGhostSpans(cells, glyphs(cells, 4), 4)).toEqual([
      { startFrame: 2, endFrame: 2, blank: false, keyFrames: [2] },
      { startFrame: 3, endFrame: 3, blank: true, keyFrames: [] },
    ]);
  });
  it("a pass may start on a held frame (no key mark at its start)", () => {
    const cells = [key(), hold(), hold(), loop(2), hold()];
    expect(computeLoopGhostSpans(cells, glyphs(cells, 5), 5)).toEqual([
      { startFrame: 3, endFrame: 4, blank: false, keyFrames: [] },
    ]);
  });
  it("stops at the key that ends the loop", () => {
    const cells = [key(), loop(1), hold(), key()];
    expect(computeLoopGhostSpans(cells, glyphs(cells, 4), 4)).toEqual([
      { startFrame: 1, endFrame: 2, blank: false, keyFrames: [1, 2] },
    ]);
  });
});

describe("defaultLoopBack", () => {
  it("loops the whole content run before the frame", () => {
    const cells = [key(), hold(), key(), hold()];
    expect(defaultLoopBack(computeTimelineSpans(glyphs(cells, 6)), 4)).toBe(4);
  });
  it("stops at the last blank key", () => {
    const cells = [key(), key(true), key(), hold()];
    expect(defaultLoopBack(computeTimelineSpans(glyphs(cells, 6)), 4)).toBe(2);
  });
  it("is 1 when the frame before is blank", () => {
    const cells = [key(), key(true), hold()];
    expect(defaultLoopBack(computeTimelineSpans(glyphs(cells, 4)), 3)).toBe(1);
  });
});

describe("loopButtonState", () => {
  const cells = [key(), hold(), loop(1), key()];
  it("adds on a hold or past the end", () => {
    expect(loopButtonState(cells, 1, true).action).toBe("add");
    expect(loopButtonState(cells, 9, true).action).toBe("add");
  });
  it("removes on a loop key", () => {
    expect(loopButtonState(cells, 2, true)).toEqual({ action: "remove", title: "Remove loop" });
  });
  it("refuses a key, frame 0, a read-only layer and no drawing row", () => {
    expect(loopButtonState(cells, 3, true).action).toBeNull();
    expect(loopButtonState(cells, 0, true).action).toBeNull();
    expect(loopButtonState(cells, 1, false).action).toBeNull();
    expect(loopButtonState(null, 1, true).action).toBeNull();
  });
});

describe("planCellPointer with loops", () => {
  const cells = [key(), hold(), loop(2), hold()];
  it("a loop key is grabbable like a key", () => {
    expect(planCellPointer(cells, 2 * 24 + 12, 24, 6)).toEqual({ kind: "move", keyIndex: 2 });
  });
  it("the key before a loop ends its span at the loop (grabbed from the left of the boundary)", () => {
    expect(planCellPointer(cells, 2 * 24 - 1, 24, 6)).toEqual({ kind: "resize", keyIndex: 0 });
  });
  it("a trailing loop's region resizes at the document end", () => {
    expect(planCellPointer(cells, 6 * 24 - 1, 24, 6)).toEqual({ kind: "resize", keyIndex: 2 });
  });
});

describe("loop ops", () => {
  it("setLoop replaces a hold, pads past the end, clamps back, refuses keys and frame 0", () => {
    const l = layerOf([key(), hold()]);
    setLoop(l, 1, 5);
    expect(l.cells[1]).toEqual({ kind: "loop", back: 1 });
    setLoop(l, 3, 2);
    expect(l.cells.map((c) => c.kind)).toEqual(["key", "loop", "hold", "loop"]);
    setLoop(l, 0, 1);
    expect(l.cells[0].kind).toBe("key");
  });
  it("removeLoop turns the loop back into a hold", () => {
    const l = layerOf([key(), loop(1)]);
    removeLoop(l, 1);
    expect(l.cells[1]).toEqual({ kind: "hold" });
  });
  it("setLoopBack replaces the cell with the clamped back", () => {
    const orig = loop(1);
    const l = layerOf([key(), key(), orig]);
    setLoopBack(l, 2, 9);
    expect(l.cells[2]).toEqual({ kind: "loop", back: 2 });
    expect(orig).toEqual({ kind: "loop", back: 1 });
  });
});
