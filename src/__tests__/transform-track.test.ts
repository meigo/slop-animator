import { describe, it, expect } from "vitest";
import {
  transformAt,
  createTransformTrack,
  withTransformKey,
  withoutTransformKey,
  withMovedTransformKey,
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
    { frame: 0, t: T(0) },
    { frame: 10, t: T(100) },
  ],
  box: null,
  ...over,
});
/** Interpolation lives on the key that STARTS a segment, so a "hold track" is a track whose first
 *  key holds. */
const holdTrack = (): TransformTrack =>
  track({
    keys: [
      { frame: 0, t: T(0), interp: "hold" },
      { frame: 10, t: T(100) },
    ],
  });

describe("transformAt", () => {
  it("returns the static transform when there is no track", () => {
    expect(transformAt(layer(), 7).dx).toBe(5);
  });

  it("holds the single key everywhere", () => {
    const t = track({ keys: [{ frame: 4, t: T(20) }] });
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
        { frame: 0, t: T(0) },
        { frame: 3, t: T(30) },
        { frame: 10, t: T(100) },
      ],
      sampleEvery: 5,
    });
    expect(transformAt(layer(t), 4).dx).toBeCloseTo(0, 10); // q = 0
    expect(transformAt(layer(t), 5).dx).toBeCloseTo(50, 10); // q = 5, between 3 and 10
  });

  it("a hold segment ignores sampleEvery — there is nothing to sample", () => {
    const t = track({
      keys: [
        { frame: 0, t: T(0), interp: "hold" },
        { frame: 10, t: T(100) },
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
        { frame: 0, t: T(0, 0) },
        { frame: 10, t: T(0, 4 * Math.PI) },
      ],
    });
    expect(transformAt(layer(spin), 5).rotation).toBeCloseTo(2 * Math.PI, 10);
  });

  it("interpolates scale linearly", () => {
    const z = track({
      keys: [
        { frame: 0, t: T(0, 0, 1) },
        { frame: 10, t: T(0, 0, 3) },
      ],
    });
    expect(transformAt(layer(z), 5).scale).toBeCloseTo(2, 10);
  });
});

describe("track mutations", () => {
  it("createTransformTrack seeds one key at frame 0 with the static value", () => {
    const t = createTransformTrack(T(9), { x: 1, y: 2, w: 3, h: 4 });
    expect(t.keys).toEqual([{ frame: 0, t: T(9) }]);
    expect(t.box).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it("createTransformTrack copies the transform and the box", () => {
    const src = T(9);
    const box = { x: 1, y: 2, w: 3, h: 4 };
    const t = createTransformTrack(src, box);
    expect(t.keys[0].t).not.toBe(src);
    expect(t.box).not.toBe(box);
  });

  it("withTransformKey inserts in frame order", () => {
    const t = withTransformKey(track(), 5, T(55));
    expect(t.keys.map((k) => k.frame)).toEqual([0, 5, 10]);
  });

  it("withTransformKey replaces a key at the same frame", () => {
    const t = withTransformKey(track(), 10, T(999));
    expect(t.keys).toHaveLength(2);
    expect(t.keys[1].t.dx).toBe(999);
  });

  // Undo snapshots share layer objects, so a writer must never touch the track it was handed.
  it("withTransformKey leaves the input untouched", () => {
    const original = track();
    withTransformKey(original, 5, T(55));
    expect(original.keys.map((k) => k.frame)).toEqual([0, 10]);
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
    const t = track({ keys: [{ frame: 0, t: T(0) }] });
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
        { frame: 0, t: T(0), interp: "hold" },
        { frame: 8, t: T(80, 1.5) },
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
        { frame: 0, t: T(0), interp: "ease-in-out" },
        { frame: 5, t: T(50, 0.5) },
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
    expect(t.keys[0].t.dx).toBe(0); // the moved key's own value travels with it
  });

  // Overwrite, matching how a timeline block move treats the cells it lands on. It is one undo away.
  it("overwrites a key already at the destination", () => {
    const t = withMovedTransformKey(track(), 0, 10);
    expect(t.keys).toHaveLength(1);
    expect(t.keys[0]).toEqual({ frame: 10, t: T(0) });
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

  it("leaves the input untouched", () => {
    const t = track();
    withMovedTransformKey(t, 0, 5);
    expect(t.keys.map((k) => k.frame)).toEqual([0, 10]);
  });
});

// Easing curves the TIME of one segment, so it belongs to the key that starts that segment.
describe("per-segment easing", () => {
  const eased = (interp: "ease-in" | "ease-out" | "ease-in-out") =>
    track({
      keys: [
        { frame: 0, t: T(0), interp },
        { frame: 10, t: T(100) },
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
        { frame: 0, t: T(0), interp: "hold" },
        { frame: 10, t: T(100), interp: "ease-in" },
        { frame: 20, t: T(200) },
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
        { frame: 0, t: T(0), interp: "ease-in" },
        { frame: 10, t: T(100) },
      ],
      sampleEvery: 2,
    });
    expect(transformAt(layer(t), 5).dx).toBeCloseTo(16, 10); // q = 4 → (0.4)² × 100
    expect(transformAt(layer(t), 4).dx).toBeCloseTo(16, 10);
  });
});
