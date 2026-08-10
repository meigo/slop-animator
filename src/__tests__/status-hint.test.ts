import { describe, it, expect } from "vitest";
import { contextHint, type HintContext } from "../lib/status-hint";

const base: HintContext = {
  tool: "brush",
  locked: false,
  hiddenLayer: false,
  layerTransformed: false,
  selectionActive: false,
  selectionFloating: false,
  poseActive: false,
};
const ctx = (over: Partial<HintContext>): HintContext => ({ ...base, ...over });

describe("contextHint precedence", () => {
  it("a locked layer outranks every tool hint", () => {
    expect(contextHint(ctx({ tool: "transform", locked: true }))).toMatch(/Layer locked/);
    expect(contextHint(ctx({ tool: "pose", locked: true, poseActive: true }))).toMatch(/unlock/);
  });

  it("a transformed layer blocks select/lasso/deform/pose, but not transform or brush", () => {
    for (const tool of ["select", "lasso", "deform", "pose"]) {
      expect(contextHint(ctx({ tool, layerTransformed: true }))).toMatch(/Apply or reset/);
    }
    expect(contextHint(ctx({ tool: "transform", layerTransformed: true }))).toMatch(
      /corners scale/,
    );
    expect(contextHint(ctx({ tool: "brush", layerTransformed: true }))).toBe("");
  });
});

describe("hidden layers", () => {
  it("a hidden layer explains itself, and lock wins when both apply", () => {
    expect(contextHint(ctx({ tool: "brush", hiddenLayer: true }))).toBe(
      "Layer hidden — show it to edit",
    );
    expect(contextHint(ctx({ tool: "select", locked: true, hiddenLayer: true }))).toMatch(
      /Layer locked/,
    );
  });
});

describe("contextHint per tool state", () => {
  it("select: idle → marquee → floating", () => {
    expect(contextHint(ctx({ tool: "select" }))).toBe("Drag to select an area");
    expect(contextHint(ctx({ tool: "select", selectionActive: true }))).toBe(
      "Drag inside to move · tap outside to deselect",
    );
    expect(contextHint(ctx({ tool: "select", selectionFloating: true }))).toBe(
      "Drag to move · tap outside to bake · Deselect reverts",
    );
  });

  it("lasso differs from select only when idle", () => {
    expect(contextHint(ctx({ tool: "lasso" }))).toBe("Draw a loop to select");
    expect(contextHint(ctx({ tool: "lasso", selectionActive: true }))).toBe(
      contextHint(ctx({ tool: "select", selectionActive: true })),
    );
  });

  it("deform and pose teach that leaving the tool bakes the edit", () => {
    expect(contextHint(ctx({ tool: "deform" }))).toMatch(/lift it into a warp grid/);
    expect(contextHint(ctx({ tool: "deform", selectionFloating: true }))).toMatch(
      /leaving the tool bakes it/,
    );
    expect(contextHint(ctx({ tool: "pose" }))).toMatch(/build the pose mesh/);
    expect(contextHint(ctx({ tool: "pose", poseActive: true }))).toMatch(
      /leaving the tool bakes it/,
    );
  });

  it("plain drawing tools stay silent with no selection", () => {
    for (const tool of ["brush", "eraser", "fill", "eyedropper"]) {
      expect(contextHint(ctx({ tool }))).toBe("");
    }
  });

  it("paint tools explain the clip (and where the deselect is) when a selection exists", () => {
    for (const tool of ["brush", "eraser", "fill"]) {
      expect(contextHint(ctx({ tool, selectionActive: true }))).toMatch(/clipped to the selection/);
      expect(contextHint(ctx({ tool, selectionFloating: true }))).toMatch(/deselects/);
    }
    // The eyedropper doesn't paint, so a selection changes nothing for it.
    expect(contextHint(ctx({ tool: "eyedropper", selectionActive: true }))).toBe("");
  });
});
