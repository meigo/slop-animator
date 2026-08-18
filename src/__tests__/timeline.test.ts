import { describe, it, expect } from "vitest";
import type { Cell, DrawingLayer, Project, ReferenceLayer } from "../anim/document";
import { defaultBoilConfig } from "../anim/document";
import {
  addFrame,
  insertKeyframe,
  insertBlankKeyframe,
  setHold,
  duplicateKeyframe,
  deleteFrame,
  ensureDrawableKeyframe,
  restoreCellTrack,
  insertFrameAllLayers,
  deleteFrameAllLayers,
  shiftSpan,
  shiftStartFrame,
  moveKeyframe,
  setHoldSpan,
  planMergeDown,
  shiftLayerTransformKeys,
  shiftTransformTrackFrames,
  type CanvasOps,
} from "../anim/timeline";

// Fake canvases are tagged objects so we can assert identity/cloning without the DOM.
let tag = 0;
const fakeOps: CanvasOps = {
  create: () => ({ __id: ++tag }) as unknown as HTMLCanvasElement,
  clone: (src) =>
    ({
      __cloneOf: (src as unknown as { __id: number }).__id,
      __id: ++tag,
    }) as unknown as HTMLCanvasElement,
};

function layer(cells: Cell[]): DrawingLayer {
  return {
    kind: "draw",
    id: 1,
    name: "L",
    visible: true,
    locked: false,
    opacity: 100,
    boilStrength: 1,
    groupId: null,
    cells,
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  };
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
    const l = layer([
      { kind: "key", canvas: src as unknown as HTMLCanvasElement },
      { kind: "hold" },
      { kind: "hold" },
    ]);
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
    const l = layer([
      { kind: "key", canvas: src as unknown as HTMLCanvasElement },
      { kind: "hold" },
    ]);
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
    const l = layer([
      { kind: "key", canvas: src as unknown as HTMLCanvasElement },
      { kind: "hold" },
    ]);
    const { canvas } = ensureDrawableKeyframe(l, 1, fakeOps);
    expect(l.cells[1].kind).toBe("key");
    expect((canvas as unknown as { __cloneOf: number }).__cloneOf).toBe(src.__id);
  });

  it("ensureDrawableKeyframe copies the held key's transform onto the new key", () => {
    const src = fakeOps.create();
    const t = { dx: 12, dy: -4, scale: 1.5, rotation: 0.3 };
    const box = { x: 10, y: 20, w: 100, h: 80 };
    const l = layer([
      { kind: "key", canvas: src, transform: t, transformBox: box },
      { kind: "hold" },
    ]);
    ensureDrawableKeyframe(l, 1, fakeOps);
    const neu = l.cells[1];
    expect(neu.kind).toBe("key");
    if (neu.kind !== "key") return;
    expect(neu.transform).toEqual(t);
    expect(neu.transform).not.toBe(t); // new object — gotcha #8
    expect(neu.transformBox).toEqual(box);
    expect(neu.transformBox).not.toBe(box);
  });

  it("ensureDrawableKeyframe creates a blank keyframe when nothing is held", () => {
    const l = layer([{ kind: "hold" }]);
    const { canvas } = ensureDrawableKeyframe(l, 0, fakeOps);
    expect(l.cells[0].kind).toBe("key");
    expect((canvas as unknown as { __cloneOf?: number }).__cloneOf).toBeUndefined();
  });

  it("ensureDrawableKeyframe returns the existing canvas when the frame is already a keyframe", () => {
    const existing = fakeOps.create();
    const l = layer([{ kind: "key", canvas: existing }]);
    const { canvas } = ensureDrawableKeyframe(l, 0, fakeOps);
    expect(canvas).toBe(existing);
  });

  it("ensureDrawableKeyframe extends the layer with holds when drawing past its end", () => {
    const l = layer([{ kind: "hold" }]); // length 1
    const { canvas } = ensureDrawableKeyframe(l, 3, fakeOps);
    expect(l.cells.length).toBe(4);
    expect(l.cells[1]).toEqual({ kind: "hold" });
    expect(l.cells[2]).toEqual({ kind: "hold" });
    expect(l.cells[3].kind).toBe("key");
    expect((canvas as unknown as { __cloneOf?: number }).__cloneOf).toBeUndefined();
  });

  // Materialising a keyframe is a STRUCTURAL change made by a tool that records a PIXEL command.
  // For years nothing captured it: undo reverted the pixels and left a blank ◆ behind, and undoing
  // an earlier structural entry deleted the cell out from under the pixel command that owned it.
  // These pin the reporting that lets a caller fold it into the same undo entry.
  it("reports no materialization when the frame is already a keyframe", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }]);
    expect(ensureDrawableKeyframe(l, 0, fakeOps).materialized).toBeNull();
  });

  it("reports the cell track on both sides of a hold→key materialization", () => {
    const src = fakeOps.create();
    const l = layer([{ kind: "key", canvas: src }, { kind: "hold" }]);
    const { materialized } = ensureDrawableKeyframe(l, 1, fakeOps);
    expect(materialized).not.toBeNull();
    expect(materialized!.before[1]).toEqual({ kind: "hold" });
    expect(materialized!.after[1].kind).toBe("key");
  });

  it("restoring `before` turns the materialized keyframe back into a hold", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
    const { materialized } = ensureDrawableKeyframe(l, 1, fakeOps);
    restoreCellTrack(l, materialized!.before);
    expect(l.cells[1]).toEqual({ kind: "hold" }); // the ◆ undo has to remove
    expect(l.cells.length).toBe(2);
  });

  it("restoring `before` truncates the holds appended past the layer's end", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }]);
    const { materialized } = ensureDrawableKeyframe(l, 3, fakeOps);
    expect(l.cells.length).toBe(4);
    restoreCellTrack(l, materialized!.before);
    expect(l.cells.length).toBe(1); // the track never grew
  });

  it("restoring `after` puts back the SAME canvas, so a redo paints into a cell in the document", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
    const { canvas, materialized } = ensureDrawableKeyframe(l, 1, fakeOps);
    restoreCellTrack(l, materialized!.before);
    restoreCellTrack(l, materialized!.after);
    const cell = l.cells[1];
    expect(cell.kind).toBe("key");
    if (cell.kind !== "key") return;
    expect(cell.canvas).toBe(canvas); // identity matters: the pixel command holds this ctx
  });

  it("restoreCellTrack copies, so a later edit of the live track can't corrupt the record", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
    const { materialized } = ensureDrawableKeyframe(l, 1, fakeOps);
    restoreCellTrack(l, materialized!.before);
    l.cells.push({ kind: "hold" }); // an unrelated op edits the live array in place
    expect(materialized!.before.length).toBe(2); // record untouched
  });

  // `after` is what REDO installs, so it has the same aliasing exposure as `before`.
  it("restoreCellTrack copies `after` too, so a redo can be repeated", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
    const { materialized } = ensureDrawableKeyframe(l, 1, fakeOps);
    restoreCellTrack(l, materialized!.after);
    l.cells.push({ kind: "hold" }); // live array grows under the record
    expect(materialized!.after.length).toBe(2);
    restoreCellTrack(l, materialized!.after); // redo again → same track, not the mutated one
    expect(l.cells.length).toBe(2);
  });

  it("`after` carries the holds appended past the layer's end", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }]);
    const { materialized } = ensureDrawableKeyframe(l, 3, fakeOps);
    expect(materialized!.after.length).toBe(4);
    expect(materialized!.after[1]).toEqual({ kind: "hold" });
    expect(materialized!.after[3].kind).toBe("key");
  });

  it("before → after → before round-trips (undo/redo/undo of the same entry)", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
    const { materialized } = ensureDrawableKeyframe(l, 1, fakeOps);
    const materializedTrack = l.cells.slice();
    restoreCellTrack(l, materialized!.before);
    restoreCellTrack(l, materialized!.after);
    expect(l.cells).toEqual(materializedTrack);
    restoreCellTrack(l, materialized!.before);
    expect(l.cells[1]).toEqual({ kind: "hold" });
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
    const l = layer([
      { kind: "key", canvas: a },
      { kind: "hold" },
      { kind: "hold" },
      { kind: "key", canvas: b },
    ]);
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
    kind: "ref",
    id,
    name: `R${id}`,
    visible: true,
    opacity: 60,
    offsetFrames: 0,
    speed: 1,
    audioEnabled: false,
    groupId: null,
    media: { type: "image", el: {} as HTMLImageElement },
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  };
}

describe("all-layers timeline operations", () => {
  it("insertFrameAllLayers inserts a hold at `at` in every drawing layer and refreshes length", () => {
    const a = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
    const b = layer([{ kind: "hold" }, { kind: "hold" }]);
    const r = refLayerFixture(3);
    const p: Project = {
      name: "t",
      width: 10,
      height: 10,
      fps: 12,
      bgColor: "#fff",
      frameCount: 2,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [a, b, r],
      audio: null,
    };
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
    const p: Project = {
      name: "t",
      width: 10,
      height: 10,
      fps: 12,
      bgColor: "#fff",
      frameCount: 2,
      boil: defaultBoilConfig(),
      groups: [],
      layers: [a, b],
      audio: null,
    };
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
    const below = [k(bcanvas), h()]; // content on 0–1, then ENDS (length 2)
    const upper = [h(), h(), h(), k(ucanvas)]; // blank 0–2, key at 3 (length 4)
    const plan = planMergeDown(below, upper);
    expect(plan.length).toBe(4);
    expect(plan[0]).toEqual({ kind: "key", below: bcanvas, upper: null }); // below starts
    expect(plan[1]).toEqual({ kind: "hold" }); // below holds
    expect(plan[2]).toEqual({ kind: "key", below: null, upper: null }); // below ENDED → blank key
    expect(plan[3]).toEqual({ kind: "key", below: null, upper: ucanvas }); // upper starts
  });

  it("keeps leading blank frames as holds (no spurious keyframe before any content)", () => {
    const ucanvas = fakeOps.create();
    const below = [h(), h()];
    const upper = [h(), k(ucanvas)];
    const plan = planMergeDown(below, upper);
    expect(plan[0]).toEqual({ kind: "hold" }); // nothing shown yet
    expect(plan[1]).toEqual({ kind: "key", below: null, upper: ucanvas });
  });
});

describe("shiftSpan (how a reference range reacts to a ripple insert/delete)", () => {
  it("moves a span that starts at or after the inserted frame", () => {
    expect(shiftSpan({ start: 10, end: 20 }, 5, 1)).toEqual({ start: 11, end: 21 });
    expect(shiftSpan({ start: 5, end: 20 }, 5, 1)).toEqual({ start: 6, end: 21 }); // boundary
  });

  it("GROWS a span that straddles the inserted frame — the frame lands inside the shot", () => {
    expect(shiftSpan({ start: 4, end: 20 }, 5, 1)).toEqual({ start: 4, end: 21 });
    expect(shiftSpan({ start: 4, end: 5 }, 5, 1)).toEqual({ start: 4, end: 6 }); // at == end
  });

  it("leaves a span entirely before the inserted frame alone", () => {
    expect(shiftSpan({ start: 0, end: 4 }, 5, 1)).toEqual({ start: 0, end: 4 });
  });

  it("moves a span that starts after the deleted frame", () => {
    expect(shiftSpan({ start: 10, end: 20 }, 5, -1)).toEqual({ start: 9, end: 19 });
  });

  it("SHRINKS a span that straddles the deleted frame", () => {
    expect(shiftSpan({ start: 4, end: 20 }, 5, -1)).toEqual({ start: 4, end: 19 });
    expect(shiftSpan({ start: 5, end: 20 }, 5, -1)).toEqual({ start: 5, end: 19 }); // at == start
  });

  it("never inverts a span — deleting its only frame floors it at one frame", () => {
    expect(shiftSpan({ start: 7, end: 7 }, 7, -1)).toEqual({ start: 7, end: 7 });
  });

  it("leaves a span entirely before the deleted frame alone", () => {
    expect(shiftSpan({ start: 0, end: 4 }, 5, -1)).toEqual({ start: 0, end: 4 });
  });
});

describe("shiftStartFrame (audio/video, which have no end to grow)", () => {
  it("moves a clip starting at or after the inserted frame", () => {
    expect(shiftStartFrame(10, 5, 1)).toBe(11);
    expect(shiftStartFrame(5, 5, 1)).toBe(6); // boundary
  });

  it("leaves a clip that starts before the inserted frame — footage cannot stretch", () => {
    expect(shiftStartFrame(4, 5, 1)).toBe(4);
  });

  it("moves a clip starting after the deleted frame, leaves one at or before it", () => {
    expect(shiftStartFrame(10, 5, -1)).toBe(9);
    expect(shiftStartFrame(5, 5, -1)).toBe(5);
    expect(shiftStartFrame(4, 5, -1)).toBe(4);
  });
});

describe("ripple insert/delete shift document-space clips", () => {
  const imageRef = (range?: { start: number; end: number }) =>
    ({
      kind: "ref",
      id: 9,
      name: "R",
      visible: true,
      opacity: 60,
      offsetFrames: 0,
      speed: 1,
      audioEnabled: false,
      groupId: null,
      media: { type: "image", el: {} },
      transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
      range,
    }) as unknown as never;

  const proj = (layers: unknown[], audio: unknown = null) =>
    ({
      name: "t",
      width: 10,
      height: 10,
      fps: 12,
      bgColor: "#fff",
      frameCount: 10,
      boil: defaultBoilConfig(),
      groups: [],
      layers,
      audio,
    }) as unknown as Project;

  it("shifts an image reference's range on insert", () => {
    const ref = imageRef({ start: 4, end: 8 }) as unknown as {
      range: { start: number; end: number };
    };
    insertFrameAllLayers(proj([ref]), 2);
    expect(ref.range).toEqual({ start: 5, end: 9 });
  });

  it("grows a straddling range rather than moving it", () => {
    const ref = imageRef({ start: 2, end: 8 }) as unknown as {
      range: { start: number; end: number };
    };
    insertFrameAllLayers(proj([ref]), 4);
    expect(ref.range).toEqual({ start: 2, end: 9 });
  });

  it("leaves an UNTRIMMED reference alone — it has no range to shift", () => {
    const ref = imageRef() as unknown as { range?: unknown };
    insertFrameAllLayers(proj([ref]), 2);
    expect(ref.range).toBeUndefined();
  });

  it("REPLACES the range object rather than mutating it (undo snapshots share refs)", () => {
    const range = { start: 4, end: 8 };
    const ref = imageRef(range) as unknown as { range: { start: number; end: number } };
    insertFrameAllLayers(proj([ref]), 2);
    expect(range).toEqual({ start: 4, end: 8 }); // the original object is untouched
    expect(ref.range).not.toBe(range);
  });

  it("shifts the audio track's start on insert and delete", () => {
    const audio = { offsetFrames: 6 };
    insertFrameAllLayers(proj([], audio), 2);
    expect(audio.offsetFrames).toBe(7);
    deleteFrameAllLayers(proj([], audio), 2);
    expect(audio.offsetFrames).toBe(6);
  });

  it("shrinks a straddling range on delete", () => {
    const ref = imageRef({ start: 2, end: 8 }) as unknown as {
      range: { start: number; end: number };
    };
    deleteFrameAllLayers(proj([ref]), 4);
    expect(ref.range).toEqual({ start: 2, end: 7 });
  });

  // Transform keys are document-frame space too: without this the drawings shifted and the layer's
  // move did not, so the animation finished a frame early and compounded with each ripple.
  describe("layer transform tracks", () => {
    const T = (dx: number) => ({ dx, dy: 0, scale: 1, rotation: 0 });
    const animLayer = (frames: number[]) => {
      const l = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
      l.transformTrack = {
        keys: frames.map((f) => ({ frame: f, t: T(f) })),
        box: null,
      };
      return l;
    };

    it("shifts keys at or after the insert point and leaves earlier ones alone", () => {
      const l = animLayer([0, 10, 24]);
      insertFrameAllLayers(proj([l]), 10);
      expect(l.transformTrack!.keys.map((k) => k.frame)).toEqual([0, 11, 25]);
      expect(l.transformTrack!.keys.map((k) => k.t.dx)).toEqual([0, 10, 24]); // values ride along
    });

    it("shifts keys after the delete point", () => {
      const l = animLayer([0, 10, 24]);
      deleteFrameAllLayers(proj([l]), 5);
      expect(l.transformTrack!.keys.map((k) => k.frame)).toEqual([0, 9, 23]);
    });

    it("collapses a delete collision, keeping the LATER key's value", () => {
      const l = animLayer([4, 5]); // 5 → 4, colliding with the key already at 4
      deleteFrameAllLayers(proj([l]), 4);
      expect(l.transformTrack!.keys).toEqual([{ frame: 4, t: T(5) }]);
    });

    it("leaves a layer with no track untouched", () => {
      const l = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
      insertFrameAllLayers(proj([l]), 0);
      expect(l.transformTrack).toBeUndefined();
    });

    it("REPLACES the track and its keys rather than mutating them (undo snapshots share refs)", () => {
      const l = animLayer([0, 10]);
      const track = l.transformTrack!;
      const keys = track.keys;
      insertFrameAllLayers(proj([l]), 5);
      expect(keys.map((k) => k.frame)).toEqual([0, 10]); // the originals are untouched
      expect(l.transformTrack).not.toBe(track);
      expect(l.transformTrack!.keys[1]).not.toBe(keys[1]);
    });

    it("shifts a REFERENCE layer's track too", () => {
      const ref = imageRef() as unknown as DrawingLayer;
      (ref as unknown as { transformTrack: unknown }).transformTrack = {
        keys: [{ frame: 6, t: T(6) }],
        box: null,
      };
      insertFrameAllLayers(proj([ref]), 2);
      expect(ref.transformTrack!.keys.map((k) => k.frame)).toEqual([7]);
    });

    // `interp` was added to `TransformKey` after this copy was written and the hand-written literal
    // dropped it, so a ripple silently flattened every authored curve. The type system cannot catch
    // it (the field is optional), so it is pinned here.
    it("carries each key's segment interpolation through the shift", () => {
      const l = animLayer([0, 10]);
      l.transformTrack!.keys[0].interp = "ease-in-out";
      l.transformTrack!.keys[1].interp = "hold";
      insertFrameAllLayers(proj([l]), 5);
      expect(l.transformTrack!.keys.map((k) => k.interp)).toEqual(["ease-in-out", "hold"]);
    });

    it("shiftTransformTrackFrames keeps interpolation on a delete collision too", () => {
      const track = {
        keys: [
          { frame: 4, t: T(4), interp: "hold" as const },
          { frame: 5, t: T(5), interp: "ease-in" as const },
        ],
        box: null,
      };
      // The LATER key survives the collision, so its curve must survive with it.
      expect(shiftTransformTrackFrames(track, 4, -1).keys).toEqual([
        { frame: 4, t: T(5), interp: "ease-in" },
      ]);
    });
  });

  // The per-layer counterpart: the frame tools resplice ONE layer's cells, so only that layer's
  // track may move. A reference RANGE is document-space and stays out of it.
  describe("shiftLayerTransformKeys", () => {
    const T = (dx: number) => ({ dx, dy: 0, scale: 1, rotation: 0 });
    const withTrack = (frames: number[]) => {
      const l = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
      l.transformTrack = { keys: frames.map((f) => ({ frame: f, t: T(f) })), box: null };
      return l;
    };

    it("shifts keys at or after an insert", () => {
      const l = withTrack([0, 6, 12]);
      shiftLayerTransformKeys(l, 6, 1);
      expect(l.transformTrack!.keys.map((k) => k.frame)).toEqual([0, 7, 13]);
    });

    it("shifts keys after a delete, collapsing a collision", () => {
      const l = withTrack([0, 4, 5]);
      shiftLayerTransformKeys(l, 4, -1);
      expect(l.transformTrack!.keys.map((k) => k.frame)).toEqual([0, 4]);
    });

    it("does nothing for a layer with no track, so callers can call it unconditionally", () => {
      const l = layer([{ kind: "key", canvas: fakeOps.create() }]);
      expect(() => shiftLayerTransformKeys(l, 0, 1)).not.toThrow();
      expect(l.transformTrack).toBeUndefined();
    });

    it("REPLACES the track rather than mutating it (undo snapshots share layer objects)", () => {
      const l = withTrack([0, 10]);
      const track = l.transformTrack!;
      shiftLayerTransformKeys(l, 5, 1);
      expect(l.transformTrack).not.toBe(track);
      expect(track.keys.map((k) => k.frame)).toEqual([0, 10]);
    });
  });
});
