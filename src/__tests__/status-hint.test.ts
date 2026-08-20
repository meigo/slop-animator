import { describe, it, expect } from "vitest";
import { contextHint, editBlockLabel, type HintContext } from "../lib/status-hint";

const base: HintContext = {
  tool: "brush",
  locked: false,
  hiddenLayer: false,
  notDraw: false,
  audioRow: false,
  groupRow: false,
  selectionActive: false,
  selectionFloating: false,
  poseActive: false,
  animatedFrame: null,
};
const ctx = (over: Partial<HintContext>): HintContext => ({ ...base, ...over });

describe("contextHint precedence", () => {
  it("a locked layer outranks every tool hint", () => {
    expect(contextHint(ctx({ tool: "transform", locked: true }))).toMatch(/Layer locked/);
    expect(contextHint(ctx({ tool: "pose", locked: true, poseActive: true }))).toMatch(/unlock/);
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

describe("reference layers", () => {
  it("pixel tools say to switch; transform/select/eyedropper stay usable", () => {
    for (const tool of ["brush", "eraser", "fill", "deform", "pose"]) {
      expect(contextHint(ctx({ tool, notDraw: true }))).toBe("Switch to a drawing layer to edit");
    }
    expect(contextHint(ctx({ tool: "transform", notDraw: true }))).toMatch(/Drag to move/);
    expect(contextHint(ctx({ tool: "select", notDraw: true }))).toMatch(/Drag to select/);
    expect(contextHint(ctx({ tool: "eyedropper", notDraw: true }))).toBe("");
  });

  it("lock still outranks a reference", () => {
    expect(contextHint(ctx({ tool: "brush", notDraw: true, locked: true }))).toMatch(/locked/);
  });
});

describe("group row selected", () => {
  // NOT "switch to a drawing layer": on a group row the active layer usually IS an unlocked
  // drawing layer, so that message described a state that was not true. The row is the problem.
  it("pixel tools say to pick a LAYER ROW; transform still aims at the group", () => {
    expect(contextHint(ctx({ tool: "brush", groupRow: true }))).toBe("Select a layer row to edit");
    expect(contextHint(ctx({ tool: "transform", groupRow: true }))).toMatch(/Drag to move/);
  });

  it("does not inherit a leftover member's lock", () => {
    expect(contextHint(ctx({ tool: "brush", groupRow: true, locked: true }))).toMatch(/layer row/);
  });
});

describe("audio row selected", () => {
  // Transform in particular was actively misdirected by the old copy: a REFERENCE row transforms
  // fine, so "switch to a drawing layer" pointed at the wrong remedy.
  it("pixel tools and transform say to pick a LAYER ROW", () => {
    expect(contextHint(ctx({ tool: "brush", audioRow: true }))).toBe("Select a layer row to edit");
    expect(contextHint(ctx({ tool: "transform", audioRow: true }))).toBe(
      "Select a layer row to edit",
    );
  });

  it("does not inherit a leftover layer's lock", () => {
    expect(contextHint(ctx({ tool: "transform", audioRow: true, locked: true }))).toMatch(
      /layer row/,
    );
  });

  // The two refusals must stay distinguishable: a reference layer really is the wrong KIND.
  it("is a different message from a reference layer's", () => {
    expect(contextHint(ctx({ tool: "brush", audioRow: true }))).not.toBe(
      contextHint(ctx({ tool: "brush", notDraw: true })),
    );
  });
});

describe("editBlockLabel", () => {
  it("is tool-agnostic (edit, not transform)", () => {
    expect(editBlockLabel("locked")).toBe("Layer locked — unlock it to edit");
    expect(editBlockLabel("hidden")).toBe("Layer hidden — show it to edit");
    expect(editBlockLabel("not-draw")).toBe("Switch to a drawing layer to edit");
    expect(editBlockLabel("not-layer-row")).toBe("Select a layer row to edit");
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

describe("contextHint — animated layer", () => {
  const base = {
    tool: "transform",
    locked: false,
    hiddenLayer: false,
    notDraw: false,
    audioRow: false,
    groupRow: false,
    selectionActive: false,
    selectionFloating: false,
    poseActive: false,
  };

  // Auto-key's one real hazard is silence: a nudge made while scrubbed between keys bends the
  // motion with nothing said. Naming the frame is the mitigation, so it is not optional.
  // 1-BASED, matching every other number the artist sees (the f n/n readout, the ruler, a key's
  // tooltip). `animatedFrame` itself is a model frame, so it is 0-based — asserting "12" would pass
  // against a hint that forgot to convert, and read one frame off against the ruler beside it.
  it("names the frame a drag will key, numbered as the artist sees it", () => {
    expect(contextHint({ ...base, animatedFrame: 12 })).toContain("13");
    expect(contextHint({ ...base, animatedFrame: 0 })).toContain("1");
  });

  it("falls back to the plain transform hint when the layer is not animated", () => {
    expect(contextHint({ ...base, animatedFrame: null })).toBe(
      "Drag to move · corners scale · top handle rotates",
    );
  });

  // A hint for a gesture that currently does nothing is worse than none.
  it("still puts the locked refusal first", () => {
    expect(contextHint({ ...base, locked: true, animatedFrame: 12 })).toContain("locked");
  });
});
