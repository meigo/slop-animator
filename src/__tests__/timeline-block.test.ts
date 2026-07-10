import { describe, it, expect } from "vitest";
import type { Cell, DrawingLayer, Project, ReferenceLayer } from "../anim/document";
import { defaultBoilConfig } from "../anim/document";
import type { CanvasOps } from "../anim/timeline";
import {
  cloneCell,
  copyBlock,
  drawingLayerIdsDown,
  pasteBlockOverwrite,
  pasteBlockInsert,
  deleteBlock,
  moveBlockFrames,
} from "../anim/timeline-block";

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
    const ca = fakeOps.create();
    const cb = fakeOps.create();
    const a = drawLayer(1, [key(ca)]);
    const b = drawLayer(2, [key(cb)]);
    const block = copyBlock(proj([a, b], 1), [2, 1], 0, 0, fakeOps);
    expect(block.cols).toBe(2);
    const c0 = block.columns[0][0];
    const c1 = block.columns[1][0];
    if (c0.kind === "key") expect(cloneOf(c0.canvas)).toBe(idOf(cb)); // column 0 = layer 2
    if (c1.kind === "key") expect(cloneOf(c1.canvas)).toBe(idOf(ca)); // column 1 = layer 1
  });
});

describe("drawingLayerIdsDown", () => {
  it("lists drawing layers from the active layer downward (toward bottom of stack), skipping refs", () => {
    // layers[0] = bottom of stack. Display top-first = reversed. "Down" from a layer = toward bottom.
    const bottom = drawLayer(1, [key()]);
    const mid = drawLayer(2, [key()]);
    const top = drawLayer(3, [key()]);
    const p = proj([bottom, mid, top], 1); // stack bottom→top: 1,2,3
    expect(drawingLayerIdsDown(p, 3)).toEqual([3, 2, 1]); // from top downward
    expect(drawingLayerIdsDown(p, 2)).toEqual([2, 1]);
    expect(drawingLayerIdsDown(p, 99)).toEqual([]); // unknown layer
  });
});

describe("pasteBlockOverwrite", () => {
  it("stamps cells in place without changing track length; trailing hold now resolves to new key", () => {
    const orig = fakeOps.create();
    const l = drawLayer(1, [key(orig), hold(), hold()]); // [A][A·][A·]
    const src = fakeOps.create();
    // Build the block directly so paste clones exactly once (src → document); a copyBlock
    // round-trip would clone twice (src → clipboard → document) and break the identity check.
    const block = { cols: 1, rows: 1, columns: [[key(src)]] }; // 1x1 X
    pasteBlockOverwrite(proj([l], 3), block, 1, 1, fakeOps); // overwrite frame 1
    expect(l.cells.length).toBe(3); // length unchanged
    const c1 = l.cells[1];
    expect(c1.kind).toBe("key");
    if (c1.kind === "key") expect(cloneOf(c1.canvas)).toBe(idOf(src));
    expect(l.cells[2]).toEqual({ kind: "hold" }); // trailing hold now holds the pasted key
  });

  it("pads with holds when the paste lands past the layer's end", () => {
    const l = drawLayer(1, [key()]); // length 1
    const block = copyBlock(proj([drawLayer(9, [key()])], 1), [9], 0, 0, fakeOps);
    pasteBlockOverwrite(proj([l], 1), block, 1, 3, fakeOps); // land at frame 3
    expect(l.cells.length).toBe(4);
    expect(l.cells[1]).toEqual({ kind: "hold" });
    expect(l.cells[2]).toEqual({ kind: "hold" });
    expect(l.cells[3].kind).toBe("key");
  });

  it("ignores overflow columns past the bottom layer", () => {
    const only = drawLayer(1, [key()]);
    const block = copyBlock(
      proj([drawLayer(8, [key()]), drawLayer(9, [key()])], 1),
      [9, 8],
      0,
      0,
      fakeOps,
    ); // 2 columns
    pasteBlockOverwrite(proj([only], 1), block, 1, 0, fakeOps); // only 1 target layer
    expect(only.cells.length).toBe(1); // second column silently ignored, no crash
  });

  it("clones out of the clipboard so two pastes never share a canvas ref", () => {
    const a = drawLayer(1, [key()]);
    const b = drawLayer(2, [key()]);
    const block = copyBlock(proj([drawLayer(9, [key()])], 1), [9], 0, 0, fakeOps);
    pasteBlockOverwrite(proj([a], 1), block, 1, 0, fakeOps);
    pasteBlockOverwrite(proj([b], 1), block, 2, 0, fakeOps);
    const ca = a.cells[0],
      cb = b.cells[0];
    if (ca.kind === "key" && cb.kind === "key") expect(ca.canvas).not.toBe(cb.canvas);
  });
});

describe("pasteBlockInsert", () => {
  it("splices cells in on the pasted layer, shifting later cells right (length grows)", () => {
    const a = fakeOps.create();
    const b = fakeOps.create();
    const l = drawLayer(1, [key(a), key(b)]); // [A][B]
    const src = fakeOps.create();
    // Build the block directly so paste clones exactly once (src → document); a copyBlock
    // round-trip would clone twice (src → clipboard → document) and break the identity check.
    const block = { cols: 1, rows: 1, columns: [[key(src)]] }; // X
    pasteBlockInsert(proj([l], 2), block, 1, 1, fakeOps); // insert at frame 1
    expect(l.cells.length).toBe(3); // [A][X][B]
    const c1 = l.cells[1];
    expect(c1.kind).toBe("key");
    if (c1.kind === "key") expect(cloneOf(c1.canvas)).toBe(idOf(src));
    const c2 = l.cells[2];
    if (c2.kind === "key") expect(idOf(c2.canvas)).toBe(idOf(b)); // B shifted right, ref preserved
  });

  it("does not touch a non-pasted layer (pasted-layers-only ripple)", () => {
    const target = drawLayer(1, [key()]);
    const other = drawLayer(2, [key(), key()]);
    const block = copyBlock(proj([drawLayer(9, [key()])], 1), [9], 0, 0, fakeOps);
    pasteBlockInsert(proj([target, other], 2), block, 1, 0, fakeOps); // paste only into layer 1
    expect(other.cells.length).toBe(2); // untouched
  });

  it("pads with holds when inserting past the layer's end", () => {
    const l = drawLayer(1, [key()]); // length 1
    const block = copyBlock(proj([drawLayer(9, [key()])], 1), [9], 0, 0, fakeOps);
    pasteBlockInsert(proj([l], 1), block, 1, 3, fakeOps);
    expect(l.cells.length).toBe(4); // [A][hold][hold][X]
    expect(l.cells[1]).toEqual({ kind: "hold" });
    expect(l.cells[3].kind).toBe("key");
  });
});

describe("deleteBlock", () => {
  it("replaces the region with holds, keeping track length", () => {
    const l = drawLayer(1, [key(), key(), key()]);
    deleteBlock(proj([l], 3), [1], 0, 1);
    expect(l.cells.length).toBe(3);
    expect(l.cells[0]).toEqual({ kind: "hold" });
    expect(l.cells[1]).toEqual({ kind: "hold" });
    expect(l.cells[2].kind).toBe("key"); // outside the region, untouched
  });

  it("clamps to the track end and skips reference/missing layers", () => {
    const l = drawLayer(1, [key(), key()]);
    deleteBlock(proj([l], 2), [1, 99], 0, 10); // endFrame past end; id 99 missing
    expect(l.cells.length).toBe(2);
    expect(l.cells[0]).toEqual({ kind: "hold" });
    expect(l.cells[1]).toEqual({ kind: "hold" });
  });
});

describe("moveBlockFrames", () => {
  it("shifts keys later and blanks the vacated cells", () => {
    const a = fakeOps.create();
    const l = drawLayer(1, [key(a), hold(), hold(), hold()]); // [A][·][·][·]
    const applied = moveBlockFrames(proj([l], 4), [1], 0, 0, 2, fakeOps); // move frame 0 → 2
    expect(applied).toBe(2);
    expect(l.cells[0]).toEqual({ kind: "hold" }); // vacated
    const c2 = l.cells[2];
    expect(c2.kind).toBe("key");
    if (c2.kind === "key") expect(cloneOf(c2.canvas)).toBe(idOf(a));
  });

  it("overwrites an existing key at the destination", () => {
    const a = fakeOps.create();
    const b = fakeOps.create();
    const l = drawLayer(1, [key(a), key(b)]); // [A][B]
    moveBlockFrames(proj([l], 2), [1], 0, 0, 1, fakeOps); // move A onto B
    expect(l.cells[0]).toEqual({ kind: "hold" });
    const c1 = l.cells[1];
    if (c1.kind === "key") expect(cloneOf(c1.canvas)).toBe(idOf(a)); // A won
  });

  it("handles source/destination overlap (delta 1 on a 2-wide block)", () => {
    const a = fakeOps.create();
    const b = fakeOps.create();
    const l = drawLayer(1, [key(a), key(b), hold()]); // [A][B][·]
    moveBlockFrames(proj([l], 3), [1], 0, 1, 1, fakeOps); // move [A,B] → frames 1,2
    expect(l.cells[0]).toEqual({ kind: "hold" });
    const c1 = l.cells[1];
    const c2 = l.cells[2];
    if (c1.kind === "key") expect(cloneOf(c1.canvas)).toBe(idOf(a));
    if (c2.kind === "key") expect(cloneOf(c2.canvas)).toBe(idOf(b));
  });

  it("clamps so the earliest frame never goes below 0 (returns the applied delta)", () => {
    const a = fakeOps.create();
    const l = drawLayer(1, [hold(), key(a)]); // [·][A]
    const applied = moveBlockFrames(proj([l], 2), [1], 1, 1, -5, fakeOps); // want -5, start=1 → clamp -1
    expect(applied).toBe(-1);
    const c0 = l.cells[0];
    if (c0.kind === "key") expect(cloneOf(c0.canvas)).toBe(idOf(a));
    expect(l.cells[1]).toEqual({ kind: "hold" });
  });

  it("pads with holds when moving past the layer's end", () => {
    const a = fakeOps.create();
    const l = drawLayer(1, [key(a)]); // length 1
    moveBlockFrames(proj([l], 1), [1], 0, 0, 3, fakeOps);
    expect(l.cells.length).toBe(4); // [·][·][·][A]
    expect(l.cells[3].kind).toBe("key");
  });

  it("moves each column on its OWN layer (no cross-layer remap)", () => {
    const a = fakeOps.create();
    const b = fakeOps.create();
    const top = drawLayer(3, [key(a), hold()]);
    const bottom = drawLayer(1, [key(b), hold()]);
    // layerIds top-first: [3,1]
    moveBlockFrames(
      proj([bottom, drawLayer(2, [hold(), hold()]), top], 2),
      [3, 1],
      0,
      0,
      1,
      fakeOps,
    );
    const t1 = top.cells[1];
    const b1 = bottom.cells[1];
    if (t1.kind === "key") expect(cloneOf(t1.canvas)).toBe(idOf(a)); // layer 3's A stayed on layer 3
    if (b1.kind === "key") expect(cloneOf(b1.canvas)).toBe(idOf(b)); // layer 1's B stayed on layer 1
  });

  it("no-ops (returns 0) when applied delta is 0", () => {
    const l = drawLayer(1, [key()]);
    expect(moveBlockFrames(proj([l], 1), [1], 0, 0, 0, fakeOps)).toBe(0);
    expect(l.cells.length).toBe(1);
  });
});
