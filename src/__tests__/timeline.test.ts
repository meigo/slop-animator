import { describe, it, expect } from "vitest";
import type { Cell, DrawingLayer, Project, ReferenceLayer } from "../anim/document";
import { defaultBoilConfig } from "../anim/document";
import {
  addFrame, insertKeyframe, insertBlankKeyframe, setHold, duplicateKeyframe, deleteFrame,
  ensureDrawableKeyframe, insertFrameAllLayers, deleteFrameAllLayers, moveKeyframe, setHoldSpan,
  planMergeDown, type CanvasOps,
} from "../anim/timeline";

// Fake canvases are tagged objects so we can assert identity/cloning without the DOM.
let tag = 0;
const fakeOps: CanvasOps = {
  create: () => ({ __id: ++tag } as unknown as HTMLCanvasElement),
  clone: (src) => ({ __cloneOf: (src as unknown as { __id: number }).__id, __id: ++tag } as unknown as HTMLCanvasElement),
};

function layer(cells: Cell[]): DrawingLayer {
  return { kind: "draw", id: 1, name: "L", visible: true, locked: false, opacity: 100, boilStrength: 1, groupId: null, cells };
}

describe("timeline operations", () => {
  it("addFrame inserts a hold after the current frame on the layer, shifting later cells", () => {
    const k = fakeOps.create();
    const l = layer([{ kind: "key", canvas: k }, { kind: "hold" }]);
    addFrame(l, 0); // after frame 0
    expect(l.cells.length).toBe(3);
    expect(l.cells[0]).toEqual({ kind: "key", canvas: k });
    expect(l.cells[1]).toEqual({ kind: "hold" });
    expect(l.cells[2]).toEqual({ kind: "hold" });
  });

  it("insertKeyframe inserts a clone of the shown drawing AFTER the current frame, shifting later cells", () => {
    const src = fakeOps.create() as unknown as { __id: number };
    const l = layer([{ kind: "key", canvas: src as unknown as HTMLCanvasElement }, { kind: "hold" }, { kind: "hold" }]);
    insertKeyframe(l, 0, fakeOps); // after frame 0
    expect(l.cells.length).toBe(4);
    const inserted = l.cells[1];
    expect(inserted.kind).toBe("key");
    if (inserted.kind === "key") {
      expect((inserted.canvas as unknown as { __cloneOf: number }).__cloneOf).toBe(src.__id);
    }
    expect(l.cells[2]).toEqual({ kind: "hold" });
  });

  it("insertKeyframe on a blank frame inserts a blank keyframe after it", () => {
    const l = layer([{ kind: "hold" }, { kind: "hold" }]);
    insertKeyframe(l, 0, fakeOps);
    expect(l.cells.length).toBe(3);
    const inserted = l.cells[1];
    expect(inserted.kind).toBe("key");
    if (inserted.kind === "key") {
      expect((inserted.canvas as unknown as { __cloneOf?: number }).__cloneOf).toBeUndefined();
    }
  });

  it("insertBlankKeyframe inserts an empty keyframe after the current frame", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
    insertBlankKeyframe(l, 0, fakeOps);
    expect(l.cells.length).toBe(3);
    const inserted = l.cells[1];
    expect(inserted.kind).toBe("key");
    if (inserted.kind === "key") {
      expect((inserted.canvas as unknown as { __cloneOf?: number }).__cloneOf).toBeUndefined();
    }
  });

  it("setHold converts a cell back to a hold", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }]);
    setHold(l, 0);
    expect(l.cells[0]).toEqual({ kind: "hold" });
  });

  it("duplicateKeyframe inserts a clone of the resolved keyframe after the current frame", () => {
    const src = fakeOps.create() as unknown as { __id: number };
    const l = layer([{ kind: "key", canvas: src as unknown as HTMLCanvasElement }, { kind: "hold" }]);
    duplicateKeyframe(l, 1, fakeOps); // current frame 1 holds frame-0's drawing
    expect(l.cells.length).toBe(3);
    const inserted = l.cells[2];
    expect(inserted.kind).toBe("key");
    if (inserted.kind === "key") {
      expect((inserted.canvas as unknown as { __cloneOf: number }).__cloneOf).toBe(src.__id);
    }
  });

  it("deleteFrame removes the cell and shifts later cells left", () => {
    const k = fakeOps.create();
    const l = layer([{ kind: "hold" }, { kind: "key", canvas: k }]);
    deleteFrame(l, 0);
    expect(l.cells.length).toBe(1);
    expect(l.cells[0]).toEqual({ kind: "key", canvas: k });
  });

  it("deleteFrame is a no-op when only one cell remains", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }]);
    deleteFrame(l, 0);
    expect(l.cells.length).toBe(1);
  });

  it("deleteFrame is a no-op for an out-of-range frame", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
    deleteFrame(l, 5);
    expect(l.cells.length).toBe(2);
  });

  it("ensureDrawableKeyframe converts a hold into a keyframe that clones the held drawing", () => {
    const src = fakeOps.create() as unknown as { __id: number };
    const l = layer([{ kind: "key", canvas: src as unknown as HTMLCanvasElement }, { kind: "hold" }]);
    const canvas = ensureDrawableKeyframe(l, 1, fakeOps);
    expect(l.cells[1].kind).toBe("key");
    expect((canvas as unknown as { __cloneOf: number }).__cloneOf).toBe(src.__id);
  });

  it("ensureDrawableKeyframe creates a blank keyframe when nothing is held", () => {
    const l = layer([{ kind: "hold" }]);
    const canvas = ensureDrawableKeyframe(l, 0, fakeOps);
    expect(l.cells[0].kind).toBe("key");
    expect((canvas as unknown as { __cloneOf?: number }).__cloneOf).toBeUndefined();
  });

  it("ensureDrawableKeyframe returns the existing canvas when the frame is already a keyframe", () => {
    const existing = fakeOps.create();
    const l = layer([{ kind: "key", canvas: existing }]);
    const canvas = ensureDrawableKeyframe(l, 0, fakeOps);
    expect(canvas).toBe(existing);
  });

  it("ensureDrawableKeyframe extends the layer with holds when drawing past its end", () => {
    const l = layer([{ kind: "hold" }]); // length 1
    const canvas = ensureDrawableKeyframe(l, 3, fakeOps);
    expect(l.cells.length).toBe(4);
    expect(l.cells[1]).toEqual({ kind: "hold" });
    expect(l.cells[2]).toEqual({ kind: "hold" });
    expect(l.cells[3].kind).toBe("key");
    expect((canvas as unknown as { __cloneOf?: number }).__cloneOf).toBeUndefined();
  });
});

describe("moveKeyframe", () => {
  it("moves a key onto a hold cell, leaving a hold behind", () => {
    const k = fakeOps.create();
    const l = layer([{ kind: "key", canvas: k }, { kind: "hold" }, { kind: "hold" }]);
    moveKeyframe(l, 0, 2);
    expect(l.cells[0]).toEqual({ kind: "hold" });
    expect(l.cells[2]).toEqual({ kind: "key", canvas: k });
  });

  it("swaps when the target is also a key", () => {
    const a = fakeOps.create();
    const b = fakeOps.create();
    const l = layer([{ kind: "key", canvas: a }, { kind: "hold" }, { kind: "key", canvas: b }]);
    moveKeyframe(l, 0, 2);
    expect(l.cells[0]).toEqual({ kind: "key", canvas: b });
    expect(l.cells[2]).toEqual({ kind: "key", canvas: a });
  });

  it("appends past the end, padding holds, and leaves a hold behind", () => {
    const k = fakeOps.create();
    const l = layer([{ kind: "key", canvas: k }, { kind: "hold" }]);
    moveKeyframe(l, 0, 3);
    expect(l.cells.length).toBe(4);
    expect(l.cells[0]).toEqual({ kind: "hold" });
    expect(l.cells[1]).toEqual({ kind: "hold" });
    expect(l.cells[2]).toEqual({ kind: "hold" });
    expect(l.cells[3]).toEqual({ kind: "key", canvas: k });
  });

  it("is a no-op when the source is not a key or target equals source", () => {
    const k = fakeOps.create();
    const l = layer([{ kind: "hold" }, { kind: "key", canvas: k }]);
    moveKeyframe(l, 0, 1); // source is a hold
    expect(l.cells[1]).toEqual({ kind: "key", canvas: k });
    moveKeyframe(l, 1, 1); // same index
    expect(l.cells[1]).toEqual({ kind: "key", canvas: k });
  });
});

describe("setHoldSpan", () => {
  it("grows a key's span by inserting holds, pushing following keys right", () => {
    const a = fakeOps.create();
    const b = fakeOps.create();
    // key A occupies frames 0-1 (span 2), key B at 2
    const l = layer([{ kind: "key", canvas: a }, { kind: "hold" }, { kind: "key", canvas: b }]);
    setHoldSpan(l, 0, 4); // A should occupy 0-3
    expect(l.cells.length).toBe(5);
    expect(l.cells[0]).toEqual({ kind: "key", canvas: a });
    expect(l.cells[1]).toEqual({ kind: "hold" });
    expect(l.cells[2]).toEqual({ kind: "hold" });
    expect(l.cells[3]).toEqual({ kind: "hold" });
    expect(l.cells[4]).toEqual({ kind: "key", canvas: b });
  });

  it("shrinks a key's span by removing trailing holds, pulling following keys left", () => {
    const a = fakeOps.create();
    const b = fakeOps.create();
    const l = layer([{ kind: "key", canvas: a }, { kind: "hold" }, { kind: "hold" }, { kind: "key", canvas: b }]);
    setHoldSpan(l, 0, 1); // A occupies only frame 0
    expect(l.cells.length).toBe(2);
    expect(l.cells[0]).toEqual({ kind: "key", canvas: a });
    expect(l.cells[1]).toEqual({ kind: "key", canvas: b });
  });

  it("never deletes the following key (clamps removal to this span's holds) and floors span at 1", () => {
    const a = fakeOps.create();
    const b = fakeOps.create();
    const l = layer([{ kind: "key", canvas: a }, { kind: "hold" }, { kind: "key", canvas: b }]);
    setHoldSpan(l, 0, 0); // floored to 1
    expect(l.cells.length).toBe(2);
    expect(l.cells[0]).toEqual({ kind: "key", canvas: a });
    expect(l.cells[1]).toEqual({ kind: "key", canvas: b });
  });

  it("is a no-op when the frame is not a key", () => {
    const l = layer([{ kind: "hold" }, { kind: "hold" }]);
    setHoldSpan(l, 0, 5);
    expect(l.cells.length).toBe(2);
  });
});

function refLayerFixture(id: number): ReferenceLayer {
  return {
    kind: "ref", id, name: `R${id}`, visible: true, opacity: 60, offsetFrames: 0, groupId: null,
    media: { type: "image", el: {} as HTMLImageElement },
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  };
}

describe("all-layers timeline operations", () => {
  it("insertFrameAllLayers inserts a hold at `at` in every drawing layer and refreshes length", () => {
    const a = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
    const b = layer([{ kind: "hold" }, { kind: "hold" }]);
    const r = refLayerFixture(3);
    const p: Project = { width: 10, height: 10, fps: 12, bgColor: "#fff", frameCount: 2, boil: defaultBoilConfig(), groups: [], layers: [a, b, r], audio: null };
    insertFrameAllLayers(p, 1);
    expect(a.cells.length).toBe(3);
    expect(b.cells.length).toBe(3);
    expect(a.cells[1]).toEqual({ kind: "hold" });
    expect(p.frameCount).toBe(3);
    expect((r as unknown as { cells?: unknown }).cells).toBeUndefined();
  });

  it("deleteFrameAllLayers removes `at` from every drawing layer and refreshes length", () => {
    const a = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
    const b = layer([{ kind: "hold" }, { kind: "hold" }]);
    const p: Project = { width: 10, height: 10, fps: 12, bgColor: "#fff", frameCount: 2, boil: defaultBoilConfig(), groups: [], layers: [a, b], audio: null };
    deleteFrameAllLayers(p, 0);
    expect(a.cells.length).toBe(1);
    expect(b.cells.length).toBe(1);
    expect(p.frameCount).toBe(1);
  });
});

describe("planMergeDown", () => {
  const k = (canvas: HTMLCanvasElement): Cell => ({ kind: "key", canvas });
  const h = (): Cell => ({ kind: "hold" });

  it("keeps holds as holds where both layers hold (does NOT promote every frame)", () => {
    const below = [k(fakeOps.create()), h(), h()];
    const upper = [k(fakeOps.create()), h(), h()];
    const plan = planMergeDown(below, upper);
    expect(plan.map((p) => p.kind)).toEqual(["key", "hold", "hold"]);
  });

  it("makes a keyframe at the union of both layers' keyframes", () => {
    const below = [k(fakeOps.create()), h(), k(fakeOps.create())];
    const upper = [k(fakeOps.create()), h(), h()];
    const plan = planMergeDown(below, upper);
    expect(plan.map((p) => p.kind)).toEqual(["key", "hold", "key"]);
  });

  it("carries the resolved below+upper canvases at a union frame where the other layer holds", () => {
    const bcanvas = fakeOps.create();
    const ucanvas = fakeOps.create();
    const below = [k(bcanvas), h(), h()]; // holds bcanvas across 0–2
    const upper = [h(), h(), k(ucanvas)]; // key at 2, blank before
    const plan = planMergeDown(below, upper);
    expect(plan[0]).toEqual({ kind: "key", below: bcanvas, upper: null }); // below key, upper blank
    expect(plan[1]).toEqual({ kind: "hold" });
    expect(plan[2]).toEqual({ kind: "key", below: bcanvas, upper: ucanvas }); // upper key, below held
  });

  it("extends to the longer layer (upper longer than below)", () => {
    const below = [k(fakeOps.create())];
    const u2 = fakeOps.create();
    const upper = [h(), k(u2)];
    const plan = planMergeDown(below, upper);
    expect(plan.length).toBe(2);
    expect(plan[1]).toEqual({ kind: "key", below: null, upper: u2 }); // past below's end → below blank
  });

  it("inserts a blank keyframe where a layer's content ends, so it does not hold past its end", () => {
    const bcanvas = fakeOps.create();
    const ucanvas = fakeOps.create();
    const below = [k(bcanvas), h()];           // content on 0–1, then ENDS (length 2)
    const upper = [h(), h(), h(), k(ucanvas)]; // blank 0–2, key at 3 (length 4)
    const plan = planMergeDown(below, upper);
    expect(plan.length).toBe(4);
    expect(plan[0]).toEqual({ kind: "key", below: bcanvas, upper: null }); // below starts
    expect(plan[1]).toEqual({ kind: "hold" });                             // below holds
    expect(plan[2]).toEqual({ kind: "key", below: null, upper: null });    // below ENDED → blank key
    expect(plan[3]).toEqual({ kind: "key", below: null, upper: ucanvas }); // upper starts
  });

  it("keeps leading blank frames as holds (no spurious keyframe before any content)", () => {
    const ucanvas = fakeOps.create();
    const below = [h(), h()];
    const upper = [h(), k(ucanvas)];
    const plan = planMergeDown(below, upper);
    expect(plan[0]).toEqual({ kind: "hold" });                              // nothing shown yet
    expect(plan[1]).toEqual({ kind: "key", below: null, upper: ucanvas });
  });
});
