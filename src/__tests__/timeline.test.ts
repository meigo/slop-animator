import { describe, it, expect } from "vitest";
import type { Cell, DrawingLayer, Project, ReferenceLayer } from "../anim/document";
import {
  addFrame, insertKeyframe, insertBlankKeyframe, setHold, duplicateKeyframe, deleteFrame,
  ensureDrawableKeyframe, insertFrameAllLayers, deleteFrameAllLayers, type CanvasOps,
} from "../anim/timeline";

// Fake canvases are tagged objects so we can assert identity/cloning without the DOM.
let tag = 0;
const fakeOps: CanvasOps = {
  create: () => ({ __id: ++tag } as unknown as HTMLCanvasElement),
  clone: (src) => ({ __cloneOf: (src as unknown as { __id: number }).__id, __id: ++tag } as unknown as HTMLCanvasElement),
};

function layer(cells: Cell[]): DrawingLayer {
  return { kind: "draw", id: 1, name: "L", visible: true, locked: false, opacity: 100, cells };
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
});

function refLayerFixture(id: number): ReferenceLayer {
  return {
    kind: "ref", id, name: `R${id}`, visible: true, opacity: 60, offsetFrames: 0,
    media: { type: "image", el: {} as HTMLImageElement },
  };
}

describe("all-layers timeline operations", () => {
  it("insertFrameAllLayers inserts a hold at `at` in every drawing layer and refreshes length", () => {
    const a = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
    const b = layer([{ kind: "hold" }, { kind: "hold" }]);
    const r = refLayerFixture(3);
    const p: Project = { width: 10, height: 10, fps: 12, bgColor: "#fff", frameCount: 2, layers: [a, b, r] };
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
    const p: Project = { width: 10, height: 10, fps: 12, bgColor: "#fff", frameCount: 2, layers: [a, b] };
    deleteFrameAllLayers(p, 0);
    expect(a.cells.length).toBe(1);
    expect(b.cells.length).toBe(1);
    expect(p.frameCount).toBe(1);
  });
});
