import { describe, it, expect } from "vitest";
import type { Cell, DrawingLayer, Project, ReferenceLayer } from "../anim/document";
import { defaultBoilConfig } from "../anim/document";
import type { CanvasOps } from "../anim/timeline";
import { cloneCell, copyBlock } from "../anim/timeline-block";

// Fake canvases tagged so we can assert identity/cloning without the DOM.
let tag = 0;
const fakeOps: CanvasOps = {
  create: () => ({ __id: ++tag }) as unknown as HTMLCanvasElement,
  clone: (src) =>
    ({
      __cloneOf: (src as unknown as { __id: number }).__id,
      __id: ++tag,
    }) as unknown as HTMLCanvasElement,
};
const cloneOf = (c: HTMLCanvasElement) => (c as unknown as { __cloneOf?: number }).__cloneOf;
const idOf = (c: HTMLCanvasElement) => (c as unknown as { __id: number }).__id;
const key = (canvas = fakeOps.create()): Cell => ({ kind: "key", canvas });
const hold = (): Cell => ({ kind: "hold" });

function drawLayer(id: number, cells: Cell[]): DrawingLayer {
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
function proj(layers: (DrawingLayer | ReferenceLayer)[], frameCount: number): Project {
  return {
    width: 100,
    height: 100,
    fps: 12,
    bgColor: "#fff",
    frameCount,
    boil: defaultBoilConfig(),
    groups: [],
    layers,
    audio: null,
  };
}

describe("cloneCell", () => {
  it("clones a hold as a hold", () => {
    const h = hold();
    const cloned = cloneCell(h, fakeOps);
    expect(cloned).toEqual({ kind: "hold" });
    expect(cloned).not.toBe(h); // new object, not shared
  });

  it("clones a key cell with canvas cloning", () => {
    const k = key();
    const cloned = cloneCell(k, fakeOps);
    expect(cloned.kind).toBe("key");
    if (cloned.kind === "key" && k.kind === "key") {
      expect(cloneOf(cloned.canvas)).toBe(idOf(k.canvas));
      expect(cloned.canvas).not.toBe(k.canvas);
    }
  });

  it("deep-clones transform and transformBox", () => {
    const tf = { dx: 1, dy: 2, scale: 3, rotation: 4 };
    const box = { x: 5, y: 6, w: 7, h: 8 };
    const k: Cell = { kind: "key", canvas: fakeOps.create(), transform: tf, transformBox: box };
    const cloned = cloneCell(k, fakeOps);
    expect(cloned.kind).toBe("key");
    if (cloned.kind === "key") {
      expect(cloned.transform).toEqual(tf);
      expect(cloned.transform).not.toBe(tf);
      expect(cloned.transformBox).toEqual(box);
      expect(cloned.transformBox).not.toBe(box);
    }
  });

  it("handles null transformBox", () => {
    const k: Cell = { kind: "key", canvas: fakeOps.create(), transformBox: null };
    const cloned = cloneCell(k, fakeOps);
    expect(cloned.kind).toBe("key");
    if (cloned.kind === "key") {
      expect(cloned.transformBox).toBe(null);
    }
  });
});

describe("copyBlock", () => {
  it("materializes a leading hold into a cloned KEY of the resolved drawing", () => {
    const k = fakeOps.create();
    const l = drawLayer(1, [key(k), hold(), hold()]);
    const block = copyBlock(proj([l], 3), [1], 1, 2, fakeOps); // rows starting on a hold
    expect(block.cols).toBe(1);
    expect(block.rows).toBe(2);
    const c0 = block.columns[0][0];
    expect(c0.kind).toBe("key");
    if (c0.kind === "key") expect(cloneOf(c0.canvas)).toBe(idOf(k)); // leading hold → cloned key
    expect(block.columns[0][1]).toEqual({ kind: "hold" }); // interior hold preserved
  });

  it("clones an interior KEY and preserves per-cell transform/transformBox", () => {
    const k = fakeOps.create();
    const tf = { dx: 5, dy: 6, scale: 2, rotation: 1 };
    const box = { x: 1, y: 2, w: 3, h: 4 };
    const l = drawLayer(1, [{ kind: "key", canvas: k, transform: tf, transformBox: box }]);
    const block = copyBlock(proj([l], 1), [1], 0, 0, fakeOps);
    const c = block.columns[0][0];
    expect(c.kind).toBe("key");
    if (c.kind === "key") {
      expect(cloneOf(c.canvas)).toBe(idOf(k));
      expect(c.transform).toEqual(tf);
      expect(c.transform).not.toBe(tf); // deep-cloned, not shared
      expect(c.transformBox).toEqual(box);
      expect(c.transformBox).not.toBe(box);
    }
  });

  it("materializes a blank leading cell (no resolved key) into a fresh blank KEY", () => {
    const l = drawLayer(1, [hold(), hold()]);
    const block = copyBlock(proj([l], 2), [1], 0, 1, fakeOps);
    const c = block.columns[0][0];
    expect(c.kind).toBe("key");
    if (c.kind === "key") expect(cloneOf(c.canvas)).toBeUndefined(); // fresh create, not a clone
  });

  it("produces one column per layer id, in the given order", () => {
    const a = drawLayer(1, [key()]);
    const b = drawLayer(2, [key()]);
    const block = copyBlock(proj([a, b], 1), [2, 1], 0, 0, fakeOps);
    expect(block.cols).toBe(2);
  });
});
