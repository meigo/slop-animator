import { describe, it, expect } from "vitest";
import { outlineOfPath } from "../core/brush";
import type { InputPoint } from "../core/input";
import {
  changedFrom,
  GRAIN_TILE,
  grainFactor,
  grainTile,
  rimWidth,
  rimWindowPad,
  washAlpha,
} from "../core/watercolor-brush";

/** A wavy stroke of `n` points whose pressure changes along it. */
const wave = (n: number): InputPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    x: 100 + i * 4,
    y: 200 + 60 * Math.sin(i / 12),
    pressure: 0.4 + 0.5 * Math.abs(Math.sin(i / 9)),
    hasPressure: true,
    timestamp: 1000 + i * 8,
  }));

describe("watercolour brush", () => {
  it("the outline's start stays put as the stroke grows (steady spacing)", () => {
    const pts = wave(200);
    const early = outlineOfPath(pts.slice(0, 120), 20, 3, false, false, true);
    const late = outlineOfPath(pts, 20, 3, false, false, true);
    // perfect-freehand writes the left side forward, then the right side back: the left side's
    // first points belong to the start, well behind the earlier tip.
    const n = Math.floor(early.length / 4);
    expect(late.slice(0, n)).toEqual(early.slice(0, n));
  });

  it("steady spacing holds the start when the stroke gets thinner later (slop-animator)", () => {
    // `wave` is thinnest at its first point, so it passes without steady spacing too; here the
    // pen presses hard first and lightly later, which moved the whole outline before f9fb670.
    const pts = wave(200).map((p, i) => ({ ...p, pressure: i < 100 ? 0.9 : 0.05 }));
    const n = 40;
    const early = outlineOfPath(pts.slice(0, 90), 20, 3, false, false, true);
    const late = outlineOfPath(pts, 20, 3, false, false, true);
    expect(late.slice(0, n)).toEqual(early.slice(0, n));
    const looseEarly = outlineOfPath(pts.slice(0, 90), 20, 3, false, false, false);
    const looseLate = outlineOfPath(pts, 20, 3, false, false, false);
    expect(looseLate.slice(0, n)).not.toEqual(looseEarly.slice(0, n));
  });

  it("the rim is thin whatever the brush", () => {
    expect(rimWidth(2)).toBe(1);
    expect(rimWidth(40)).toBe(4);
    expect(rimWidth(400)).toBe(10);
    expect(rimWindowPad(3.2)).toBe(6);
  });

  it("the wash is darkest at the edge and even at Edge 0", () => {
    expect(washAlpha(0, 4, 50)).toBe(1);
    expect(washAlpha(10, 4, 50)).toBeCloseTo(0.7);
    expect(washAlpha(2, 4, 50)).toBeGreaterThan(0.7);
    expect(washAlpha(2, 4, 50)).toBeLessThan(1);
    expect(washAlpha(1, 4, 100)).toBeGreaterThan(washAlpha(3, 4, 100));
    expect(washAlpha(10, 4, 100)).toBeCloseTo(0.4);
    for (const d of [0, 1, 3, 10]) expect(washAlpha(d, 4, 0)).toBe(1);
  });

  it("the grain tile wraps, is the same each time, and Grain 0 leaves the wash whole", () => {
    const a = grainTile();
    expect(a.length).toBe(GRAIN_TILE * GRAIN_TILE);
    expect(grainTile()).toEqual(a);
    // across the wrap the values step as little as inside the tile
    let seam = 0;
    let inside = 0;
    for (let y = 0; y < GRAIN_TILE; y++) {
      seam = Math.max(seam, Math.abs(a[y * GRAIN_TILE + GRAIN_TILE - 1] - a[y * GRAIN_TILE]));
      inside = Math.max(inside, Math.abs(a[y * GRAIN_TILE + 100] - a[y * GRAIN_TILE + 101]));
    }
    expect(seam).toBeLessThan(inside * 1.5 + 0.05);
    for (const t of [0, 0.5, 1]) expect(grainFactor(t, 0)).toBe(1);
    expect(grainFactor(1, 100)).toBeCloseTo(0.35);
  });

  it("changedFrom finds the first moved point, or where the shorter path ends", () => {
    const a = wave(50);
    const b = [
      ...a.slice(0, 30),
      { ...a[30], x: a[30].x + 1 },
      ...a.slice(31),
      ...wave(55).slice(50),
    ];
    expect(changedFrom(a, b)).toBe(30);
    expect(changedFrom(a.slice(0, 40), a)).toBe(40);
    expect(changedFrom(a, a)).toBe(50);
  });
});
