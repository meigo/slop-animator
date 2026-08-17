import { describe, it, expect } from "vitest";
import {
  transformAt,
  createTransformTrack,
  withTransformKey,
  withoutTransformKey,
  hasKeyAt,
  createProject,
  createDrawingLayer,
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
  interp: "linear",
  box: null,
  ...over,
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

  it("hold mode does not interpolate", () => {
    const t = track({ interp: "hold" });
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

  it("sampleEvery is ignored in hold mode", () => {
    const t = track({ interp: "hold", sampleEvery: 5 });
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
    expect(t.interp).toBe("linear");
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
        { frame: 0, t: T(0) },
        { frame: 8, t: T(80, 1.5) },
      ],
      interp: "hold",
      sampleEvery: 2,
      box: { x: 1, y: 2, w: 3, h: 4 },
    };
    project.layers.push(l);
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    const back = loaded.layers[loaded.layers.length - 1];
    expect(back.transformTrack).toEqual(l.transformTrack);
  });

  it("a layer with no track round-trips as undefined (old saves)", async () => {
    const project = createProject();
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    expect(loaded.layers[0].transformTrack).toBeUndefined();
  });
});
