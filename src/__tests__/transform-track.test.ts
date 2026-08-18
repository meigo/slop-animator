import { describe, it, expect } from "vitest";
import {
  transformAt,
  createTransformTrack,
  withTransformKey,
  withoutTransformKey,
  withMovedTransformKey,
  withPastedTransformKey,
  withKeyInterp,
  cloneTransformTrack,
  hasKeyAt,
  createProject,
  createDrawingLayer,
  createReferenceLayer,
  type Layer,
  type TransformTrack,
} from "../anim/document";
import { saveProjectBlob, loadProjectBlob } from "../persist/project-file";

const T = (dx: number, rotation = 0, scale = 1) => ({ dx, dy: 0, scale, rotation });
const layer = (track?: TransformTrack) =>
  ({ kind: "draw", id: 1, name: "L", transform: T(5), transformTrack: track }) as Layer;
const track = (over: Partial<TransformTrack> = {}): TransformTrack => ({
  keys: [
    { frame: 0, v: T(0) },
    { frame: 10, v: T(100) },
  ],
  box: null,
  ...over,
});
/** Interpolation lives on the key that STARTS a segment, so a "hold track" is a track whose first
 *  key holds. */
const holdTrack = (): TransformTrack =>
  track({
    keys: [
      { frame: 0, v: T(0), interp: "hold" },
      { frame: 10, v: T(100) },
    ],
  });

describe("transformAt", () => {
  it("returns the static transform when there is no track", () => {
    expect(transformAt(layer(), 7).dx).toBe(5);
  });

  it("holds the single key everywhere", () => {
    const t = track({ keys: [{ frame: 4, v: T(20) }] });
    expect(transformAt(layer(t), 0).dx).toBe(20);
    expect(transformAt(layer(t), 99).dx).toBe(20);
  });

  // A track never extrapolates: outside the keys it holds the nearest one.
  it("holds before the first key and after the last", () => {
    expect(transformAt(layer(track()), -5).dx).toBe(0);
    expect(transformAt(layer(track()), 999).dx).toBe(100);
  });

  it("interpolates linearly between keys", () => {
    expect(transformAt(layer(track()), 5).dx).toBeCloseTo(50, 10);
    expect(transformAt(layer(track()), 2).dx).toBeCloseTo(20, 10);
  });

  it("hits an exact key exactly", () => {
    expect(transformAt(layer(track()), 10).dx).toBe(100);
  });

  it("hold does not interpolate", () => {
    const t = holdTrack();
    expect(transformAt(layer(t), 9).dx).toBe(0);
    expect(transformAt(layer(t), 10).dx).toBe(100);
  });

  // Time is quantised GLOBALLY and then evaluated, so the motion updates on 2s like the drawings.
  it("sampleEvery steps the motion", () => {
    const t = track({ sampleEvery: 2 });
    expect(transformAt(layer(t), 4).dx).toBeCloseTo(40, 10);
    expect(transformAt(layer(t), 5).dx).toBeCloseTo(40, 10); // still showing frame 4's value
    expect(transformAt(layer(t), 6).dx).toBeCloseTo(60, 10);
  });

  // The grid is global, so the quantised frame can fall in an earlier bracket than `frame` does.
  // That is the intent — sample-and-hold the whole animation — not an edge case to correct.
  it("quantises into an earlier bracket when the grid is coarse", () => {
    const t = track({
      keys: [
        { frame: 0, v: T(0) },
        { frame: 3, v: T(30) },
        { frame: 10, v: T(100) },
      ],
      sampleEvery: 5,
    });
    expect(transformAt(layer(t), 4).dx).toBeCloseTo(0, 10); // q = 0
    expect(transformAt(layer(t), 5).dx).toBeCloseTo(50, 10); // q = 5, between 3 and 10
  });

  it("a hold segment ignores sampleEvery — there is nothing to sample", () => {
    const t = track({
      keys: [
        { frame: 0, v: T(0), interp: "hold" },
        { frame: 10, v: T(100) },
      ],
      sampleEvery: 5,
    });
    expect(transformAt(layer(t), 9).dx).toBe(0);
  });

  // The one place the obvious implementation is wrong: a deliberate 720° spin is stored as 4π and
  // must render as two turns. Shortest-path normalisation would silently make it zero.
  it("interpolates rotation absolutely, without shortest-path normalisation", () => {
    const spin = track({
      keys: [
        { frame: 0, v: T(0, 0) },
        { frame: 10, v: T(0, 4 * Math.PI) },
      ],
    });
    expect(transformAt(layer(spin), 5).rotation).toBeCloseTo(2 * Math.PI, 10);
  });

  it("interpolates scale linearly", () => {
    const z = track({
      keys: [
        { frame: 0, v: T(0, 0, 1) },
        { frame: 10, v: T(0, 0, 3) },
      ],
    });
    expect(transformAt(layer(z), 5).scale).toBeCloseTo(2, 10);
  });
});

describe("track mutations", () => {
  it("createTransformTrack seeds one key at frame 0 with the static value", () => {
    const t = createTransformTrack(T(9), { x: 1, y: 2, w: 3, h: 4 });
    expect(t.keys).toEqual([{ frame: 0, v: T(9) }]);
    expect(t.box).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it("createTransformTrack copies the transform and the box", () => {
    const src = T(9);
    const box = { x: 1, y: 2, w: 3, h: 4 };
    const t = createTransformTrack(src, box);
    expect(t.keys[0].v).not.toBe(src);
    expect(t.box).not.toBe(box);
  });

  it("withTransformKey inserts in frame order", () => {
    const t = withTransformKey(track(), 5, T(55));
    expect(t.keys.map((k) => k.frame)).toEqual([0, 5, 10]);
  });

  it("withTransformKey replaces a key at the same frame", () => {
    const t = withTransformKey(track(), 10, T(999));
    expect(t.keys).toHaveLength(2);
    expect(t.keys[1].v.dx).toBe(999);
  });

  // Undo snapshots share layer objects, so a writer must never touch the track it was handed.
  it("withTransformKey leaves the input untouched", () => {
    const original = track();
    withTransformKey(original, 5, T(55));
    expect(original.keys.map((k) => k.frame)).toEqual([0, 10]);
  });

  // A drag rewrites a VALUE, never a curve — the documented contract, and `interp` is optional so
  // nothing but a test notices a copy that forgets it.
  it("withTransformKey preserves the destination key's interpolation when replacing", () => {
    const t = withTransformKey(
      track({
        keys: [
          { frame: 0, v: T(0), interp: "hold" },
          { frame: 10, v: T(100), interp: "ease-in" },
        ],
      }),
      10,
      T(999),
    );
    expect(t.keys[1]).toEqual({ frame: 10, v: T(999), interp: "ease-in" });
    expect(t.keys[0].interp).toBe("hold"); // the other key is carried across untouched
  });

  // Same rule seen from the other side: a key CREATED inside a segment must not change that
  // segment's curve, so it inherits it. Defaulting to linear would tween a `hold` as a side effect
  // of a value drag.
  it("withTransformKey inherits the enclosing segment's interpolation when creating a key", () => {
    const t = withTransformKey(
      track({
        keys: [
          { frame: 0, v: T(0), interp: "hold" },
          { frame: 10, v: T(100) },
        ],
      }),
      5,
      T(55),
    );
    expect(t.keys[1]).toEqual({ frame: 5, v: T(55), interp: "hold" });
  });

  it("withTransformKey does not inherit past the last key — nothing is being split there", () => {
    const t = withTransformKey(
      track({
        keys: [
          { frame: 0, v: T(0) },
          { frame: 10, v: T(100), interp: "hold" },
        ],
      }),
      20,
      T(200),
    );
    expect(t.keys[2]).toEqual({ frame: 20, v: T(200) });
  });

  it("withTransformKey creates a linear key before the track starts", () => {
    const t = withTransformKey(
      track({
        keys: [
          { frame: 5, v: T(0), interp: "hold" },
          { frame: 10, v: T(100) },
        ],
      }),
      0,
      T(-1),
    );
    expect(t.keys[0]).toEqual({ frame: 0, v: T(-1) });
  });

  it("withoutTransformKey removes the key at that frame", () => {
    expect(withoutTransformKey(track(), 10).keys.map((k) => k.frame)).toEqual([0]);
  });

  // Returning the SAME object is how callers detect a no-op and skip pushing an empty undo entry.
  it("withoutTransformKey returns the same object when there is nothing at that frame", () => {
    const t = track();
    expect(withoutTransformKey(t, 7)).toBe(t);
  });

  it("withoutTransformKey refuses to empty the track", () => {
    const t = track({ keys: [{ frame: 0, v: T(0) }] });
    expect(withoutTransformKey(t, 0)).toBe(t);
  });

  it("hasKeyAt reports an exact frame match", () => {
    expect(hasKeyAt(track(), 10)).toBe(true);
    expect(hasKeyAt(track(), 9)).toBe(false);
  });
});

describe("transform track persistence", () => {
  it("round-trips a track", async () => {
    const project = createProject();
    const l = createDrawingLayer(1, "L");
    l.transformTrack = {
      keys: [
        { frame: 0, v: T(0), interp: "hold" },
        { frame: 8, v: T(80, 1.5) },
      ],
      sampleEvery: 2,
      box: { x: 1, y: 2, w: 3, h: 4 },
    };
    project.layers.push(l);
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    const back = loaded.layers[loaded.layers.length - 1];
    expect(back.transformTrack).toEqual(l.transformTrack);
  });

  it("round-trips a track on a REFERENCE layer", async () => {
    const project = createProject();
    const ref = createReferenceLayer({ type: "missing", was: "image", name: "a.png" }, "R");
    ref.transformTrack = {
      keys: [
        { frame: 0, v: T(0), interp: "ease-in-out" },
        { frame: 5, v: T(50, 0.5) },
      ],
      sampleEvery: 3,
      box: { x: 10, y: 20, w: 30, h: 40 },
    };
    project.layers.push(ref);
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    const back = loaded.layers[loaded.layers.length - 1];
    expect(back.transformTrack).toEqual(ref.transformTrack);
  });

  it("a layer with no track round-trips as undefined (old saves)", async () => {
    const project = createProject();
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    expect(loaded.layers[0].transformTrack).toBeUndefined();
  });
});

describe("withMovedTransformKey", () => {
  it("moves a key to a free frame, keeping the array sorted", () => {
    const t = withMovedTransformKey(track(), 0, 5);
    expect(t.keys.map((k) => k.frame)).toEqual([5, 10]);
    expect(t.keys[0].v.dx).toBe(0); // the moved key's own value travels with it
  });

  // Overwrite, matching how a timeline block move treats the cells it lands on. It is one undo away.
  it("overwrites a key already at the destination", () => {
    const t = withMovedTransformKey(track(), 0, 10);
    expect(t.keys).toHaveLength(1);
    expect(t.keys[0]).toEqual({ frame: 10, v: T(0) });
  });

  // Same-object returns are what let a caller skip pushing an undo entry for a gesture that
  // changed nothing.
  it("returns the same object when the frame does not change", () => {
    const t = track();
    expect(withMovedTransformKey(t, 10, 10)).toBe(t);
  });

  it("returns the same object when there is no key to move", () => {
    const t = track();
    expect(withMovedTransformKey(t, 7, 3)).toBe(t);
  });

  // Frame order alone would pass an implementation that reused the key object and rewrote `t` in
  // place — which is exactly the corruption gotcha #8 warns about, since snapshots share layers.
  it("leaves the input untouched, nested transform included", () => {
    const t = track({ box: { x: 1, y: 2, w: 3, h: 4 } });
    const key = t.keys[0];
    const before = { ...key.v };
    const moved = withMovedTransformKey(t, 0, 5);
    expect(t.keys.map((k) => k.frame)).toEqual([0, 10]);
    expect(key.frame).toBe(0);
    expect(key.v).toEqual(before);
    expect(moved.keys[0]).not.toBe(key);
    expect(moved.keys[0].v).not.toBe(key.v);
    expect(moved.box).not.toBe(t.box);
  });

  // `interp` is optional, so nothing in the type system notices a copy that enumerates fields and
  // forgets it — and a dropped curve is silent and permanent.
  it("carries the moved key's segment interpolation with it", () => {
    const t = track({
      keys: [
        { frame: 0, v: T(0), interp: "ease-in" },
        { frame: 10, v: T(100) },
      ],
    });
    expect(withMovedTransformKey(t, 0, 5).keys[0]).toEqual({
      frame: 5,
      v: T(0),
      interp: "ease-in",
    });
  });
});

// THE copy site for `cloneLayers`, `restoreStructure` (undo AND redo) and `duplicateLayer`: a field
// dropped here is erased from the snapshot too, so redo cannot bring it back.
describe("cloneTransformTrack", () => {
  it("passes undefined through", () => {
    expect(cloneTransformTrack(undefined)).toBeUndefined();
  });

  it("preserves each key's segment interpolation", () => {
    const src = track({
      keys: [
        { frame: 0, v: T(0), interp: "hold" },
        { frame: 10, v: T(100), interp: "ease-out" },
      ],
      sampleEvery: 3,
    });
    const copy = cloneTransformTrack(src)!;
    expect(copy.keys).toEqual(src.keys);
    expect(copy.sampleEvery).toBe(3);
  });

  it("shares no mutable object with its input", () => {
    const src = track({ box: { x: 1, y: 2, w: 3, h: 4 } });
    const copy = cloneTransformTrack(src)!;
    expect(copy).not.toBe(src);
    expect(copy.keys).not.toBe(src.keys);
    expect(copy.keys[0]).not.toBe(src.keys[0]);
    expect(copy.keys[0].v).not.toBe(src.keys[0].v);
    expect(copy.box).not.toBe(src.box);
    expect(copy.box).toEqual(src.box);
  });
});

describe("withKeyInterp", () => {
  const holdFirst = () =>
    track({
      keys: [
        { frame: 0, v: T(0), interp: "hold" },
        { frame: 10, v: T(100) },
      ],
    });

  it("sets the curve of the segment starting at that key", () => {
    const t = withKeyInterp(track(), 0, "ease-in");
    expect(t.keys[0]).toEqual({ frame: 0, v: T(0), interp: "ease-in" });
    expect(t.keys[1]).toEqual({ frame: 10, v: T(100) }); // the other segment is untouched
  });

  // Same-object returns are how a caller skips pushing an undo entry that changes nothing.
  it("returns the SAME object when there is no key at that frame", () => {
    const t = track();
    expect(withKeyInterp(t, 7, "ease-in")).toBe(t);
  });

  it("returns the SAME object when the value is unchanged", () => {
    const t = holdFirst();
    expect(withKeyInterp(t, 0, "hold")).toBe(t);
  });

  // Absent means linear, so setting linear on an absent interp is genuinely a no-op.
  it("treats an absent interp as linear", () => {
    const t = track();
    expect(withKeyInterp(t, 0, "linear")).toBe(t);
  });

  it("leaves the input untouched and shares no mutable object with it", () => {
    const src = track({ box: { x: 1, y: 2, w: 3, h: 4 } });
    const out = withKeyInterp(src, 0, "ease-out");
    expect(src.keys[0].interp).toBeUndefined();
    expect(out.keys[0]).not.toBe(src.keys[0]);
    expect(out.keys[0].v).not.toBe(src.keys[0].v);
    expect(out.box).not.toBe(src.box);
  });
});

// Easing curves the TIME of one segment, so it belongs to the key that starts that segment.
describe("per-segment easing", () => {
  const eased = (interp: "ease-in" | "ease-out" | "ease-in-out") =>
    track({
      keys: [
        { frame: 0, v: T(0), interp },
        { frame: 10, v: T(100) },
      ],
    });

  it("ease-in starts slow and still lands exactly on both keys", () => {
    const t = eased("ease-in");
    expect(transformAt(layer(t), 0).dx).toBe(0);
    expect(transformAt(layer(t), 10).dx).toBe(100);
    expect(transformAt(layer(t), 5).dx).toBeCloseTo(25, 10); // u² at the midpoint
  });

  it("ease-out is ease-in mirrored", () => {
    expect(transformAt(layer(eased("ease-out")), 5).dx).toBeCloseTo(75, 10);
  });

  it("ease-in-out is symmetric about the midpoint", () => {
    const t = eased("ease-in-out");
    expect(transformAt(layer(t), 5).dx).toBeCloseTo(50, 10);
    expect(transformAt(layer(t), 2).dx).toBeCloseTo(8, 10);
    expect(transformAt(layer(t), 8).dx).toBeCloseTo(92, 10);
  });

  // The point of putting it on the key: one track, different segments.
  it("applies each segment's own curve, not the track's", () => {
    const t = track({
      keys: [
        { frame: 0, v: T(0), interp: "hold" },
        { frame: 10, v: T(100), interp: "ease-in" },
        { frame: 20, v: T(200) },
      ],
    });
    expect(transformAt(layer(t), 5).dx).toBe(0); // held by the first segment
    expect(transformAt(layer(t), 15).dx).toBeCloseTo(125, 10); // eased by the second
  });

  it("an unknown or absent interp behaves as linear", () => {
    expect(transformAt(layer(track()), 5).dx).toBeCloseTo(50, 10);
  });

  // Easing curves the time; sampleEvery quantises it. They compose rather than override.
  it("composes with sampleEvery — a stepped move steps along the curve", () => {
    const t = track({
      keys: [
        { frame: 0, v: T(0), interp: "ease-in" },
        { frame: 10, v: T(100) },
      ],
      sampleEvery: 2,
    });
    expect(transformAt(layer(t), 5).dx).toBeCloseTo(16, 10); // q = 4 → (0.4)² × 100
    expect(transformAt(layer(t), 4).dx).toBeCloseTo(16, 10);
  });
});

describe("withPastedTransformKey", () => {
  // A paste carries the whole key. `withTransformKey` deliberately does the opposite — it preserves
  // the destination's curve, because a DRAG rewrites a value, not a curve.
  it("writes both the value and the segment interpolation", () => {
    const t = withPastedTransformKey(track(), 5, { v: T(55), interp: "ease-in" });
    expect(t.keys[1]).toEqual({ frame: 5, v: T(55), interp: "ease-in" });
  });

  it("replaces an existing key outright, curve included", () => {
    const src = track({
      keys: [
        { frame: 0, v: T(0), interp: "hold" },
        { frame: 10, v: T(100) },
      ],
    });
    const t = withPastedTransformKey(src, 0, { v: T(9) });
    expect(t.keys[0]).toEqual({ frame: 0, v: T(9) }); // the old "hold" did not survive
  });

  it("keeps the array sorted and leaves the input untouched", () => {
    const src = track();
    const t = withPastedTransformKey(src, 5, { v: T(55) });
    expect(t.keys.map((k) => k.frame)).toEqual([0, 5, 10]);
    expect(src.keys.map((k) => k.frame)).toEqual([0, 10]);
  });
});

import { resolveTrack, type Track } from "../anim/document";

// The skeleton is the part that took the most care — bracket search, quantisation, easing, holding
// at both ends. Proving it works for a SECOND value type is what says it was genuinely generic
// rather than transform-shaped with the names filed off.
describe("resolveTrack over a scalar", () => {
  const lerpNum = (a: number, b: number, u: number) => a + (b - a) * u;
  const t: Track<number> = {
    keys: [
      { frame: 0, v: 0 },
      { frame: 10, v: 100 },
    ],
  };

  it("interpolates, and holds at both ends", () => {
    expect(resolveTrack(t, -5, lerpNum)).toBe(0);
    expect(resolveTrack(t, 5, lerpNum)).toBeCloseTo(50, 10);
    expect(resolveTrack(t, 999, lerpNum)).toBe(100);
  });

  it("applies the segment's own easing", () => {
    const eased: Track<number> = {
      keys: [
        { frame: 0, v: 0, interp: "ease-in" },
        { frame: 10, v: 100 },
      ],
    };
    expect(resolveTrack(eased, 5, lerpNum)).toBeCloseTo(25, 10);
  });

  it("holds a `hold` segment without calling lerp at all", () => {
    let called = 0;
    const held: Track<number> = {
      keys: [
        { frame: 0, v: 0, interp: "hold" },
        { frame: 10, v: 100 },
      ],
    };
    resolveTrack(held, 5, (a, b, u) => {
      called++;
      return lerpNum(a, b, u);
    });
    expect(called).toBe(0);
  });

  it("quantises with sampleEvery", () => {
    expect(resolveTrack({ ...t, sampleEvery: 2 }, 5, lerpNum)).toBeCloseTo(40, 10);
  });
});
