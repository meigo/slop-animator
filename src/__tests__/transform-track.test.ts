import { describe, it, expect } from "vitest";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import {
  transformAt,
  createTransformTrack,
  withTransformKey,
  withMovedKey,
  withMovedTransformKey,
  withPastedKey,
  withPastedTransformKey,
  withKeyInterp,
  withTrackKeys,
  withoutKey,
  withKey,
  groupTransformAt,
  groupOpacityAt,
  copyTracks,
  hasKeyAt,
  createProject,
  createDrawingLayer,
  createReferenceLayer,
  resolveTrack,
  copyKeyframe,
  copyTrack,
  type Layer,
  type LayerGroup,
  type TransformTrack,
  type Track,
} from "../anim/document";
import { saveProjectBlob, loadProjectBlob } from "../persist/project-file";

const T = (dx: number, rotation = 0, scale = 1) => ({ dx, dy: 0, scale, rotation });
const layer = (track?: TransformTrack) =>
  ({ kind: "draw", id: 1, name: "L", transform: T(5), tracks: { transform: track } }) as Layer;
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

  it("hasKeyAt reports an exact frame match", () => {
    expect(hasKeyAt(track(), 10)).toBe(true);
    expect(hasKeyAt(track(), 9)).toBe(false);
  });
});

describe("transform track persistence", () => {
  it("round-trips a track", async () => {
    const project = createProject();
    const l = createDrawingLayer(1, "L");
    l.tracks = {
      transform: {
        keys: [
          { frame: 0, v: T(0), interp: "hold" },
          { frame: 8, v: T(80, 1.5) },
        ],
        sampleEvery: 2,
        box: { x: 1, y: 2, w: 3, h: 4 },
      },
    };
    project.layers.push(l);
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    const back = loaded.layers[loaded.layers.length - 1];
    expect(back.tracks?.transform).toEqual(l.tracks.transform);
  });

  it("round-trips a track on a REFERENCE layer", async () => {
    const project = createProject();
    const ref = createReferenceLayer({ type: "missing", was: "image", name: "a.png" }, "R");
    ref.tracks = {
      transform: {
        keys: [
          { frame: 0, v: T(0), interp: "ease-in-out" },
          { frame: 5, v: T(50, 0.5) },
        ],
        sampleEvery: 3,
        box: { x: 10, y: 20, w: 30, h: 40 },
      },
    };
    project.layers.push(ref);
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    const back = loaded.layers[loaded.layers.length - 1];
    expect(back.tracks?.transform).toEqual(ref.tracks.transform);
  });

  // "Stop animating" leaves the bag present but empty (`{ ...l.tracks, transform: undefined }`).
  // A bag with nothing in it is not an animation, so it must load back as `undefined` — one
  // representation of "no animation", not two that a future `if (layer.tracks)` could disagree on.
  it("loads an EMPTY bag back as undefined", async () => {
    const project = createProject();
    const l = createDrawingLayer(1, "L");
    l.tracks = { transform: undefined };
    project.layers.push(l);
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    expect(loaded.layers.find((x) => x.id === l.id)!.tracks).toBeUndefined();
  });

  it("a layer with no track round-trips as undefined (old saves)", async () => {
    const project = createProject();
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    expect(loaded.layers[0].tracks?.transform).toBeUndefined();
  });
});

// A file is untrusted input: `frame` and `sampleEvery` were guarded, the key VALUE never was.
describe("key sanitising on load", () => {
  const load = async (tracks: unknown) => {
    const project = createProject();
    const l = createDrawingLayer(1, "L");
    l.tracks = tracks as Layer["tracks"];
    project.layers.push(l);
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    return loaded.layers.find((x) => x.id === l.id)!;
  };

  it("drops a transform key whose value is not four finite numbers", async () => {
    const back = await load({
      transform: {
        keys: [
          { frame: 0, v: T(0) },
          { frame: 4, v: { dx: 0, dy: NaN, scale: 1, rotation: 0 } },
          { frame: 8, v: null },
        ],
        box: null,
      },
    });
    expect(back.tracks?.transform?.keys.map((k) => k.frame)).toEqual([0]);
  });

  // Sharper than the transform case: `globalAlpha` IGNORES a value outside [0,1] or NaN, so a bad
  // opacity key paints the layer at the PREVIOUS draw op's alpha — a compositing bug, not bad data.
  it("drops an opacity key that is NaN or outside 0-100", async () => {
    const back = await load({
      opacity: {
        keys: [
          { frame: 0, v: 100 },
          { frame: 2, v: NaN },
          { frame: 4, v: 140 },
          { frame: 6, v: -1 },
          { frame: 8, v: 0 },
        ],
      },
    });
    expect(back.tracks?.opacity?.keys).toEqual([
      { frame: 0, v: 100 },
      { frame: 8, v: 0 },
    ]);
  });

  it("drops a fractional or negative frame — no key action could ever match it", async () => {
    const back = await load({
      transform: {
        keys: [
          { frame: -3, v: T(1) },
          { frame: 2.5, v: T(2) },
          { frame: 5, v: T(3) },
        ],
        box: null,
      },
    });
    expect(back.tracks?.transform?.keys.map((k) => k.frame)).toEqual([5]);
  });

  it("collapses a track to no track at all when every key is rejected", async () => {
    const back = await load({ opacity: { keys: [{ frame: 0, v: "full" }] } });
    expect(back.tracks).toBeUndefined();
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
// dropped here is erased from the snapshot too, so redo cannot bring it back. The bag adds a SECOND
// level the no-mutation rule has to reach — a shared bag object is as corrupting as a shared track.
describe("copyTracks", () => {
  it("copies an empty bag to an empty bag", () => {
    expect(copyTracks({})).toEqual({});
  });

  it("preserves each key's segment interpolation", () => {
    const src = track({
      keys: [
        { frame: 0, v: T(0), interp: "hold" },
        { frame: 10, v: T(100), interp: "ease-out" },
      ],
      sampleEvery: 3,
    });
    const copy = copyTracks({ transform: src }).transform!;
    expect(copy.keys).toEqual(src.keys);
    expect(copy.sampleEvery).toBe(3);
  });

  it("shares no mutable object with its input, at either level", () => {
    const src = track({ box: { x: 1, y: 2, w: 3, h: 4 } });
    const bag = { transform: src };
    const copiedBag = copyTracks(bag);
    const copy = copiedBag.transform!;
    expect(copiedBag).not.toBe(bag);
    expect(copy).not.toBe(src);
    expect(copy.keys).not.toBe(src.keys);
    expect(copy.keys[0]).not.toBe(src.keys[0]);
    expect(copy.keys[0].v).not.toBe(src.keys[0].v);
    expect(copy.box).not.toBe(src.box);
    expect(copy.box).toEqual(src.box);
  });

  it("copies an opacity track too, without sharing its keys", () => {
    const bag = { opacity: { keys: [{ frame: 0, v: 100 }], sampleEvery: 2 } };
    const copy = copyTracks(bag);
    expect(copy.opacity).toEqual(bag.opacity);
    expect(copy.opacity!.keys).not.toBe(bag.opacity.keys);
    expect(copy.opacity!.keys[0]).not.toBe(bag.opacity.keys[0]);
  });
});

/**
 * The depth every transform-track writer goes through.
 *
 * `withKeyInterp`/`withoutKey`/`withMovedKey` are generic and know nothing about `box`, so a
 * TransformTrack re-attaches their keys here — and this is the only place that copy can be lost. The
 * generic editors' own behaviour (same-object no-ops, absent-means-linear, per-segment scope) is
 * asserted for BOTH value types under "generic key editors" below; these two assert the one thing
 * only a transform track has to lose.
 */
describe("withTrackKeys", () => {
  it("shares no mutable object with the track it was derived from", () => {
    const src = track({ box: { x: 1, y: 2, w: 3, h: 4 } });
    const out = withTrackKeys(src, withKeyInterp(src, 0, "ease-out", (v) => ({ ...v })).keys);
    expect(out).not.toBe(src);
    expect(out.box).not.toBe(src.box);
    expect(out.box).toEqual(src.box);
    // The edited key is a fresh object with a fresh value, and the INPUT is untouched.
    expect(src.keys[0].interp).toBeUndefined();
    expect(out.keys[0]).not.toBe(src.keys[0]);
    expect(out.keys[0].v).not.toBe(src.keys[0].v);
    expect(out.keys[0]).toEqual({ frame: 0, v: T(0), interp: "ease-out" });
  });

  it("carries a null box through rather than inventing one", () => {
    const src = track();
    expect(withTrackKeys(src, withoutKey(src, 10).keys).box).toBeNull();
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

describe("withPastedKey — opacity", () => {
  it("writes value and curve on a scalar track", () => {
    const src: Track<number> = {
      keys: [
        { frame: 0, v: 0 },
        { frame: 10, v: 100 },
      ],
    };
    const t = withPastedKey(src, 5, { v: 50, interp: "hold" }, (n) => n);
    expect(t.keys[1]).toEqual({ frame: 5, v: 50, interp: "hold" });
  });
});

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
    const v = resolveTrack(held, 5, (a, b, u) => {
      called++;
      return lerpNum(a, b, u);
    });
    expect(called).toBe(0);
    expect(v).toBe(0); // the segment-START key's value, not the end key's (100)
  });

  it("quantises with sampleEvery", () => {
    expect(resolveTrack({ ...t, sampleEvery: 2 }, 5, lerpNum)).toBeCloseTo(40, 10);
  });
});

// The single worst bug in the transform track was a copy site that rebuilt a key as an explicit
// literal and so dropped `interp` when it was added later. These pin that a copy carries EVERY
// field, including ones a future reader has not thought of.
describe("generic copy helpers", () => {
  const id = (n: number) => n;

  it("carries interp and every other field through a keyframe copy", () => {
    const k = { frame: 3, v: 42, interp: "ease-out" as const };
    expect(copyKeyframe(k, id)).toEqual(k);
  });

  it("deep-copies the value with the supplied copier", () => {
    const v = { dx: 1, dy: 2, scale: 1, rotation: 0 };
    const copied = copyKeyframe({ frame: 0, v }, (x: typeof v) => ({ ...x }));
    expect(copied.v).toEqual(v);
    expect(copied.v).not.toBe(v);
  });

  it("copies a whole track without sharing its keys array", () => {
    const t = { keys: [{ frame: 0, v: 1 }], sampleEvery: 3 };
    const c = copyTrack(t, id);
    expect(c).toEqual(t);
    expect(c.keys).not.toBe(t.keys);
    expect(c.keys[0]).not.toBe(t.keys[0]);
  });
});

// transformTrack SHIPPED and is in real projects, including autosaves. The loader must promote it,
// or a saved animation silently disappears on the next open.
describe("legacy transformTrack promotion", () => {
  /** Add the LEGACY `transformTrack` field to a saved blob's `project.json`. Hand-building the zip
   *  is the only way to produce a field this build can no longer write. It deliberately does NOT
   *  strip `tracks`: a layer saved without a bag has no `tracks` key anyway (so the first test gets
   *  a pure legacy file), and leaving it is what lets the second test present a file carrying BOTH. */
  async function withLegacyTransformTrack(
    blob: Blob,
    layerId: number,
    track: TransformTrack,
  ): Promise<Blob> {
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const json = JSON.parse(strFromU8(zip["project.json"])) as {
      layers: { id: number; tracks?: unknown; transformTrack?: TransformTrack }[];
      references: { id: number; tracks?: unknown; transformTrack?: TransformTrack }[];
    };
    for (const lj of [...json.layers, ...(json.references ?? [])]) {
      if (lj.id !== layerId) continue;
      lj.transformTrack = track;
    }
    zip["project.json"] = strToU8(JSON.stringify(json));
    return new Blob([zipSync(zip) as Uint8Array<ArrayBuffer>]);
  }

  it("promotes a legacy track into the tracks bag on load", async () => {
    const project = createProject();
    const l = createDrawingLayer(1, "L");
    project.layers.push(l);
    const blob = await saveProjectBlob(project);
    // Hand-build the legacy shape: write the new file, then rewrite its JSON the old way.
    const legacy = await withLegacyTransformTrack(blob, l.id, {
      keys: [
        { frame: 0, v: T(0) },
        { frame: 6, v: T(60), interp: "hold" },
      ],
      box: null,
    });
    const loaded = await loadProjectBlob(legacy, 1);
    const back = loaded.layers.find((x) => x.id === l.id)!;
    expect(back.tracks?.transform?.keys.map((k) => k.frame)).toEqual([0, 6]);
    expect(back.tracks?.transform?.keys[1].interp).toBe("hold");
    expect((back as unknown as { transformTrack?: unknown }).transformTrack).toBeUndefined();
  });

  it("prefers the new shape when a file carries both", async () => {
    // A file written by this build and then edited by hand could hold both; `tracks` is authoritative.
    const project = createProject();
    const l = createDrawingLayer(1, "L");
    l.tracks = { transform: { keys: [{ frame: 9, v: T(90) }], box: null } };
    project.layers.push(l);
    const blob = await withLegacyTransformTrack(await saveProjectBlob(project), l.id, {
      keys: [{ frame: 0, v: T(0) }],
      box: null,
    });
    const loaded = await loadProjectBlob(blob, 1);
    expect(loaded.layers.find((x) => x.id === l.id)!.tracks?.transform?.keys[0].frame).toBe(9);
  });

  it("promotes a legacy track on a REFERENCE layer too", async () => {
    const project = createProject();
    const ref = createReferenceLayer({ type: "missing", was: "image", name: "a.png" }, "R");
    project.layers.push(ref);
    const legacy = await withLegacyTransformTrack(await saveProjectBlob(project), ref.id, {
      keys: [{ frame: 3, v: T(30), interp: "ease-in" }],
      box: { x: 1, y: 2, w: 3, h: 4 },
    });
    const loaded = await loadProjectBlob(legacy, 1);
    const back = loaded.layers.find((x) => x.id === ref.id)!;
    expect(back.tracks?.transform?.keys[0].frame).toBe(3);
    expect(back.tracks?.transform?.box).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  /** The value field was renamed `t` -> `v` on this branch. The helper above takes a
   *  `TransformTrack`, so it can only express keys that are ALREADY renamed — which is why every
   *  test here passed while the real migration dropped every key a parent build had written. This
   *  one hand-writes the shape `git show b898b14:src/anim/document.ts` actually shipped. Keep it
   *  untyped-by-the-model on purpose: the moment it compiles as a `Keyframe`, it has stopped
   *  testing the thing it exists for. */
  async function withOnDiskLegacyKeys(
    blob: Blob,
    layerId: number,
    legacyTrack: unknown,
  ): Promise<Blob> {
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const json = JSON.parse(strFromU8(zip["project.json"])) as {
      layers: { id: number; transformTrack?: unknown }[];
      references: { id: number; transformTrack?: unknown }[];
    };
    for (const lj of [...json.layers, ...(json.references ?? [])])
      if (lj.id === layerId) lj.transformTrack = legacyTrack;
    zip["project.json"] = strToU8(JSON.stringify(json));
    return new Blob([zipSync(zip) as Uint8Array<ArrayBuffer>]);
  }

  it("migrates a parent-build key whose value is on `t`, not `v`", async () => {
    const project = createProject();
    const l = createDrawingLayer(1, "L");
    project.layers.push(l);
    const legacy = await withOnDiskLegacyKeys(await saveProjectBlob(project), l.id, {
      keys: [
        { frame: 0, t: { dx: 0, dy: 0, scale: 1, rotation: 0 } },
        { frame: 6, t: { dx: 60, dy: 0, scale: 1, rotation: 0 }, interp: "hold" },
      ],
      box: null,
    });
    const back = (await loadProjectBlob(legacy, 1)).layers.find((x) => x.id === l.id)!;
    // Not merely "a track survived": the VALUES have to arrive, or the animation is a straight line.
    expect(back.tracks?.transform?.keys.map((k) => k.frame)).toEqual([0, 6]);
    expect(back.tracks?.transform?.keys[1].v).toEqual({ dx: 60, dy: 0, scale: 1, rotation: 0 });
    expect(back.tracks?.transform?.keys[1].interp).toBe("hold");
  });

  it("still drops a legacy key whose `t` is malformed", async () => {
    // The migration must not become a hole in the validation it runs before.
    const project = createProject();
    const l = createDrawingLayer(1, "L");
    project.layers.push(l);
    const legacy = await withOnDiskLegacyKeys(await saveProjectBlob(project), l.id, {
      keys: [{ frame: 0, t: { dx: null, dy: 0, scale: 1, rotation: 0 } }],
      box: null,
    });
    const back = (await loadProjectBlob(legacy, 1)).layers.find((x) => x.id === l.id)!;
    expect(back.tracks).toBeUndefined();
  });
});

describe("withKey — one writer for every property", () => {
  // The interp-inheritance rule is the part that had already drifted: `withTransformKey` inherited
  // the ENCLOSING segment's curve, while the opacity writer (written inline in appState) only
  // preserved a curve when a key already sat on that exact frame. Same gesture, two answers — so
  // both are asserted here, against the one generic writer they now share.
  it("a key created inside a `hold` segment inherits hold — transform track", () => {
    const tr = track({
      keys: [
        { frame: 0, v: T(0), interp: "hold" },
        { frame: 10, v: T(100) },
      ],
    });
    const out = withTransformKey(tr, 5, T(50));
    expect(out.keys.find((k) => k.frame === 5)?.interp).toBe("hold");
    // …and the segment it split still holds: 5..10 is a hard cut, not a fade.
    expect(transformAt(layer(out), 7).dx).toBe(50);
  });

  it("a key created inside a `hold` segment inherits hold — opacity track", () => {
    const tr: Track<number> = {
      keys: [
        { frame: 0, v: 0, interp: "hold" },
        { frame: 10, v: 100 },
      ],
    };
    const out = withKey(tr, 5, 50, (n) => n);
    expect(out.keys.find((k) => k.frame === 5)?.interp).toBe("hold");
    expect(resolveTrack(out, 7, (a, b, u) => a + (b - a) * u)).toBe(50);
  });

  it("past the last key nothing is being split, so the new segment is linear", () => {
    const tr: Track<number> = { keys: [{ frame: 0, v: 0, interp: "hold" }] };
    expect(withKey(tr, 10, 100, (n) => n).keys.find((k) => k.frame === 10)?.interp).toBeUndefined();
  });

  it("rewriting an existing key keeps that key's own curve", () => {
    const tr: Track<number> = {
      keys: [
        { frame: 0, v: 0, interp: "ease-in" },
        { frame: 10, v: 100 },
      ],
    };
    expect(withKey(tr, 0, 42, (n) => n).keys[0].interp).toBe("ease-in");
  });

  it("returns a new track and leaves the input untouched", () => {
    const tr: Track<number> = { keys: [{ frame: 0, v: 0 }] };
    const out = withKey(tr, 5, 50, (n) => n);
    expect(out).not.toBe(tr);
    expect(out.keys).not.toBe(tr.keys);
    expect(tr.keys).toHaveLength(1);
    expect(out.keys.map((k) => k.frame)).toEqual([0, 5]);
  });
});

describe("groupTransformAt", () => {
  it("resolves the group's track at the frame, else its static transform", () => {
    const g = { id: 1, name: "G", collapsed: false, visible: true, transform: T(7) } as LayerGroup;
    expect(groupTransformAt(g, 5).dx).toBe(7);
    g.tracks = {
      transform: {
        keys: [
          { frame: 0, v: T(0) },
          { frame: 10, v: T(100) },
        ],
        box: null,
      },
    };
    expect(groupTransformAt(g, 5).dx).toBeCloseTo(50, 10);
  });

  it("is identity for a group with neither", () => {
    const g = { id: 1, name: "G", collapsed: false, visible: true } as LayerGroup;
    expect(groupTransformAt(g, 3)).toEqual({ dx: 0, dy: 0, scale: 1, rotation: 0 });
  });

  it("is identity for no group at all (an ungrouped layer's outer step)", () => {
    expect(groupTransformAt(null, 3)).toEqual({ dx: 0, dy: 0, scale: 1, rotation: 0 });
    expect(groupTransformAt(undefined, 3)).toEqual({ dx: 0, dy: 0, scale: 1, rotation: 0 });
  });

  it("holds outside the key range rather than extrapolating", () => {
    const g = {
      id: 1,
      name: "G",
      collapsed: false,
      visible: true,
      transform: T(7),
      tracks: {
        transform: {
          keys: [
            { frame: 2, v: T(10) },
            { frame: 6, v: T(30) },
          ],
          box: null,
        },
      },
    } as LayerGroup;
    expect(groupTransformAt(g, 0).dx).toBe(10);
    expect(groupTransformAt(g, 99).dx).toBe(30);
  });
});

describe("groupOpacityAt", () => {
  const g = (over: Partial<LayerGroup> = {}): LayerGroup =>
    ({ id: 1, name: "G", collapsed: false, visible: true, ...over }) as LayerGroup;

  it("is 100 when the group is missing or has no opacity", () => {
    expect(groupOpacityAt(null, 0)).toBe(100);
    expect(groupOpacityAt(undefined, 0)).toBe(100);
    expect(groupOpacityAt(g(), 0)).toBe(100);
  });

  it("reads the static field when there is no track", () => {
    expect(groupOpacityAt(g({ opacity: 40 }), 7)).toBe(40);
  });

  it("resolves the track, holding outside the key range", () => {
    const track = {
      keys: [
        { frame: 0, v: 100 },
        { frame: 10, v: 0 },
      ],
    };
    const grp = g({ opacity: 80, tracks: { opacity: track } });
    expect(groupOpacityAt(grp, -1)).toBe(100);
    expect(groupOpacityAt(grp, 5)).toBeCloseTo(50, 10);
    expect(groupOpacityAt(grp, 99)).toBe(0);
  });
});

// The group is the second track OWNER, and the first one whose `box` is actually populated — so
// the round trip has to carry it, or an animated rig reloads pivoting about the live content union
// and its whole motion path shifts.
describe("group transform track persistence", () => {
  it("round-trips a group's track, frozen box and all", async () => {
    const project = createProject();
    const l = createDrawingLayer(1, "L");
    project.layers.push(l);
    project.groups.push({
      id: 1,
      name: "G",
      collapsed: false,
      visible: true,
      tracks: {
        transform: {
          keys: [
            { frame: 0, v: T(0) },
            { frame: 8, v: T(80), interp: "ease-out" },
          ],
          box: { x: 10, y: 20, w: 30, h: 40 },
        },
      },
    });
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    const track = loaded.groups[0].tracks?.transform;
    expect(track?.keys.map((k) => k.frame)).toEqual([0, 8]);
    expect(track?.keys[1].interp).toBe("ease-out");
    expect(track?.box).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(groupTransformAt(loaded.groups[0], 4).dx).toBeCloseTo(40, 10);
  });

  it("sanitises an unsorted group track like any other", async () => {
    const project = createProject();
    project.layers.push(createDrawingLayer(1, "L"));
    project.groups.push({
      id: 1,
      name: "G",
      collapsed: false,
      visible: true,
      tracks: {
        transform: {
          keys: [
            { frame: 9, v: T(90) },
            { frame: 2, v: T(20) },
          ],
          box: null,
        },
      },
    });
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    expect(loaded.groups[0].tracks?.transform?.keys.map((k) => k.frame)).toEqual([2, 9]);
  });
});

describe("group opacity persistence", () => {
  it("round-trips static opacity and an opacity track", async () => {
    const project = createProject();
    project.layers.push(createDrawingLayer(1, "L"));
    project.groups.push({
      id: 1,
      name: "G",
      collapsed: false,
      visible: true,
      opacity: 40,
      tracks: {
        opacity: {
          keys: [
            { frame: 0, v: 100 },
            { frame: 8, v: 0 },
          ],
        },
      },
    });
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    expect(loaded.groups[0].opacity).toBe(40);
    expect(loaded.groups[0].tracks?.opacity?.keys.map((k) => k.frame)).toEqual([0, 8]);
    expect(loaded.groups[0].tracks?.opacity?.keys.map((k) => k.v)).toEqual([100, 0]);
  });

  it("loads a bad stored opacity as omitted (fully opaque)", async () => {
    const project = createProject();
    project.layers.push(createDrawingLayer(1, "L"));
    project.groups.push({ id: 1, name: "G", collapsed: false, visible: true, opacity: 40 });
    const blob = await saveProjectBlob(project);
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const json = JSON.parse(strFromU8(zip["project.json"]));
    json.groups[0].opacity = 999;
    const rezipped = new Blob([zipSync({ ...zip, "project.json": strToU8(JSON.stringify(json)) })]);
    const loaded = await loadProjectBlob(rezipped, 1);
    expect(loaded.groups[0].opacity).toBeUndefined();
    expect(groupOpacityAt(loaded.groups[0], 0)).toBe(100);
  });
});

// The generic mover, used by the timeline's key drag on an OPACITY row. Split from
// `withMovedTransformKey` for the same reason `withKey`/`withTransformKey` are: the generic one
// knows nothing about `box`, so a transform track re-attaches its keys through `withTrackKeys`.
describe("withMovedKey", () => {
  const numTrack = () => ({
    keys: [
      { frame: 0, v: 20 },
      { frame: 10, v: 80 },
    ],
  });
  const id = (n: number) => n;

  it("moves a key to a free frame, keeping the array sorted", () => {
    const t = withMovedKey(numTrack(), 0, 5, id);
    expect(t.keys.map((k) => k.frame)).toEqual([5, 10]);
    expect(t.keys[0].v).toBe(20);
  });

  it("overwrites a key already at the destination", () => {
    const t = withMovedKey(numTrack(), 0, 10, id);
    expect(t.keys).toEqual([{ frame: 10, v: 20 }]);
  });

  it("returns the same object when nothing moves", () => {
    const t = numTrack();
    expect(withMovedKey(t, 10, 10, id)).toBe(t);
    expect(withMovedKey(t, 7, 3, id)).toBe(t);
  });

  it("leaves the input untouched", () => {
    const t = numTrack();
    const key = t.keys[0];
    const moved = withMovedKey(t, 0, 5, id);
    expect(t.keys.map((k) => k.frame)).toEqual([0, 10]);
    expect(moved.keys[0]).not.toBe(key);
  });

  it("carries the moved key's segment interpolation with it", () => {
    const t = {
      keys: [
        { frame: 0, v: 20, interp: "hold" as const },
        { frame: 10, v: 80 },
      ],
    };
    expect(withMovedKey(t, 0, 5, id).keys[0].interp).toBe("hold");
  });

  it("clears interp on a key that becomes last — there is no segment after it", () => {
    // Move the last key before the first: the old first is now last, and its leftover hold
    // would otherwise revive if a later key were added again.
    const t = {
      keys: [
        { frame: 5, v: 20, interp: "hold" as const },
        { frame: 10, v: 80, interp: "ease-in" as const },
      ],
    };
    const out = withMovedKey(t, 10, 0, id);
    expect(out.keys.map((k) => k.frame)).toEqual([0, 5]);
    expect(out.keys[1].interp).toBeUndefined();
    // The moved key is no longer last, so its own curve stays — it now starts a real segment.
    expect(out.keys[0].interp).toBe("ease-in");
  });

  it("strips interp when the moved key itself becomes last", () => {
    const t = {
      keys: [
        { frame: 0, v: 20, interp: "hold" as const },
        { frame: 10, v: 80 },
      ],
    };
    expect(withMovedKey(t, 0, 15, id).keys[1].interp).toBeUndefined();
  });
});

/**
 * The key EDITORS, asserted for both value types.
 *
 * A scalar track must reach `hold`, because a hard cut is the spec's stated way to use an opacity
 * track — the gap this pair of assertions exists to keep closed. Asserting the same thing twice, once
 * per value type, is what stops the two drifting apart again, the same reason `withKey`'s
 * hold-inheritance is asserted twice.
 */
describe("generic key editors", () => {
  const scalarTrack = (): Track<number> => ({
    keys: [
      { frame: 0, v: 100 },
      { frame: 10, v: 0 },
    ],
  });

  it("sets hold on an opacity segment exactly as on a transform segment", () => {
    const t = withKeyInterp(track(), 0, "hold", (v) => ({ ...v }));
    const o = withKeyInterp(scalarTrack(), 0, "hold", (n) => n);
    expect(t.keys[0].interp).toBe("hold");
    expect(o.keys[0].interp).toBe("hold");
    // The other segment is untouched in both — easing is per SEGMENT, not per track.
    expect(t.keys[1].interp).toBeUndefined();
    expect(o.keys[1].interp).toBeUndefined();
    // Neither writer mutated its input (gotcha #8: snapshots share layer objects).
    expect(o.keys[0]).not.toBe(scalarTrack().keys[0]);
  });

  // Same-object returns are how every caller detects a no-op and skips pushing an empty undo entry,
  // so they are asserted for BOTH value types — a transform track reaching this through
  // `withTrackKeys` must not start returning a fresh object.
  it("returns the SAME object for either value type when the curve is unchanged", () => {
    const o = scalarTrack();
    const t = track({
      keys: [
        { frame: 0, v: T(0), interp: "hold" },
        { frame: 10, v: T(100) },
      ],
    });
    expect(withKeyInterp(o, 0, "linear", (n) => n)).toBe(o); // absent means linear
    expect(withKeyInterp(o, 7, "hold", (n) => n)).toBe(o); // no key there
    expect(withKeyInterp(t, 0, "hold", (v) => ({ ...v }))).toBe(t); // already that curve
    expect(withKeyInterp(t, 7, "hold", (v) => ({ ...v }))).toBe(t);
    const plain = track();
    expect(withKeyInterp(plain, 0, "linear", (v) => ({ ...v }))).toBe(plain); // absent means linear
  });

  it("refuses to delete the only key in a track, whatever the value type", () => {
    const t = track({ keys: [{ frame: 0, v: T(0) }] });
    const o: Track<number> = { keys: [{ frame: 0, v: 100 }] };
    expect(withoutKey(t, 0)).toBe(t);
    expect(withoutKey(o, 0)).toBe(o);
  });

  it("deletes a key of either value type, and reports a no-op the same way", () => {
    expect(withoutKey(scalarTrack(), 10).keys.map((k) => k.frame)).toEqual([0]);
    expect(withoutKey(track(), 10).keys.map((k) => k.frame)).toEqual([0]);
    const o = scalarTrack();
    const t = track();
    expect(withoutKey(o, 7)).toBe(o);
    expect(withoutKey(t, 7)).toBe(t);
  });

  it("clears interp on the new last key after a later key is deleted", () => {
    const o: Track<number> = {
      keys: [
        { frame: 0, v: 100, interp: "hold" },
        { frame: 10, v: 0 },
      ],
    };
    const t = track({
      keys: [
        { frame: 0, v: T(0), interp: "ease-in" },
        { frame: 10, v: T(100) },
      ],
    });
    expect(withoutKey(o, 10).keys[0].interp).toBeUndefined();
    expect(withoutKey(t, 10).keys[0].interp).toBeUndefined();
    // Input untouched — the leftover lived on a snapshot-shared key object.
    expect(o.keys[0].interp).toBe("hold");
    expect(t.keys[0].interp).toBe("ease-in");
  });

  it("hasKeyAt reads an exact frame match on a scalar track too", () => {
    expect(hasKeyAt(scalarTrack(), 10)).toBe(true);
    expect(hasKeyAt(scalarTrack(), 9)).toBe(false);
  });
});
