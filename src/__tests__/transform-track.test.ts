import { describe, it, expect } from "vitest";
import { transformAt, type Layer, type TransformTrack } from "../anim/document";

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
