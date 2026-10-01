import { describe, expect, it } from "vitest";
import {
  autoScrollStep,
  DRAG_THRESHOLD_PX,
  ghostTop,
  pastThreshold,
  ROW_PX,
  SCROLL_MAX_PX,
  slideOffsets,
} from "../lib/layer-drag-visual";
import type { RowBox } from "../anim/layer-drop";

const rows: RowBox[] = [
  { kind: "layer", id: 4, key: "l4", top: 0, bottom: 32 },
  { kind: "group", id: 3, key: "g3", top: 32, bottom: 64 },
  { kind: "layer", id: 2, key: "l2", top: 64, bottom: 96 },
  { kind: "layer", id: 3, key: "l3", top: 96, bottom: 128 },
];

describe("layer drag visuals", () => {
  it("starts a drag only past the threshold", () => {
    expect(DRAG_THRESHOLD_PX).toBe(3);
    expect(pastThreshold(0, 0)).toBe(false);
    expect(pastThreshold(2, 2)).toBe(false);
    expect(pastThreshold(0, 3)).toBe(true);
    expect(pastThreshold(-3, 0)).toBe(true);
  });

  it("slides each row to its place in the new order, by the rows' own heights", () => {
    // Top row down two places: it moves 64px down, the two rows it passed close up.
    expect([...slideOffsets(rows, ["g3", "l2", "l4", "l3"])]).toEqual([
      ["g3", -32],
      ["l2", -32],
      ["l4", 64],
    ]);
    // Bottom row to the top: the rest move down one row. (A layer and a group share id 3.)
    expect([...slideOffsets(rows, ["l3", "l4", "g3", "l2"])]).toEqual([
      ["l3", -96],
      ["l4", 32],
      ["g3", 32],
      ["l2", 32],
    ]);
    // Mixed heights: a 40px row and a 20px row swap.
    const mixed: RowBox[] = [
      { kind: "group", id: 1, key: "g1", top: 0, bottom: 40 },
      { kind: "layer", id: 2, key: "l2", top: 40, bottom: 60 },
    ];
    expect([...slideOffsets(mixed, ["l2", "g1"])]).toEqual([
      ["l2", -40],
      ["g1", 20],
    ]);
  });

  it("closes up over a row the new order leaves out (a group emptied by the drop)", () => {
    // g3 is gone after the drop: l2 and l3 move up into its place.
    expect([...slideOffsets(rows, ["l4", "l2", "l3"])]).toEqual([
      ["l2", -32],
      ["l3", -32],
    ]);
  });

  it("slides nothing for the same order or a refused drop", () => {
    expect(slideOffsets(rows, ["l4", "g3", "l2", "l3"]).size).toBe(0);
    expect(slideOffsets(rows, []).size).toBe(0);
    expect(slideOffsets([], ["l1"]).size).toBe(0);
  });

  it("keeps the floating row inside the content", () => {
    expect(ghostTop(100, 10, 400)).toBe(90);
    expect(ghostTop(5, 10, 400)).toBe(0);
    expect(ghostTop(500, 10, 400)).toBe(400 - ROW_PX);
    expect(ghostTop(20, 10, 10)).toBe(0);
    // A row height of its own (spine's rows are shorter than ROW_PX).
    expect(ghostTop(500, 10, 400, 29)).toBe(400 - 29);
  });

  it("scrolls near an edge, faster deeper in, and not in the middle", () => {
    // A 200px list from 100 to 300: 32px bands.
    expect(autoScrollStep(200, 100, 300)).toBe(0);
    expect(autoScrollStep(132, 100, 300)).toBe(0);
    expect(autoScrollStep(268, 100, 300)).toBe(0);
    expect(autoScrollStep(116, 100, 300)).toBe(-SCROLL_MAX_PX / 2);
    expect(autoScrollStep(100, 100, 300)).toBe(-SCROLL_MAX_PX);
    expect(autoScrollStep(40, 100, 300)).toBe(-SCROLL_MAX_PX);
    expect(autoScrollStep(284, 100, 300)).toBe(SCROLL_MAX_PX / 2);
    expect(autoScrollStep(400, 100, 300)).toBe(SCROLL_MAX_PX);
    // A short list narrows the bands so its middle still holds still.
    expect(autoScrollStep(150, 100, 200)).toBe(0);
    expect(autoScrollStep(110, 100, 100)).toBe(0);
  });
});
