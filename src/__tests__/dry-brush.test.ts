import { describe, it, expect } from "vitest";
import {
  bristleCount,
  bristleRuns,
  hairPaints,
  makeBristles,
  noise1,
  resample,
  rng,
  taperLevels,
  TAPER_LEVELS,
  dryTaperPx,
} from "../core/dry-brush";
import type { InputPoint } from "../core/input";

/** A straight stroke along x from 0 to `len`, so a point's x is its arc length. */
const line = (len: number, pressure = 0.6, at = 1000): InputPoint[] =>
  Array.from({ length: Math.round(len / 2) + 1 }, (_, i) => ({
    x: i * 2,
    y: 50,
    pressure,
    hasPressure: true,
    timestamp: at + i,
  }));

/** How much of the stroke paints: total length of every hair's runs. */
const painted = (hairs: { runs: number[][] }[]) =>
  hairs.reduce((sum, h) => sum + h.runs.reduce((s, r) => s + Math.abs(r.at(-2)! - r[0]), 0), 0);

describe("dry brush", () => {
  it("has 5 to 48 hairs, about one per 1.6 px", () => {
    expect(bristleCount(2)).toBe(5);
    expect(bristleCount(32)).toBe(20);
    expect(bristleCount(500)).toBe(48);
  });

  it("is deterministic: the same seed gives the same hairs and noise", () => {
    expect(makeBristles(12, 7)).toEqual(makeBristles(12, 7));
    expect(makeBristles(12, 7)).not.toEqual(makeBristles(12, 8));
    const a = rng(3);
    const b = rng(3);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(noise1(5, 2.37)).toBe(noise1(5, 2.37));
  });

  it("spreads the hairs across the width, outer ones carrying less paint", () => {
    const hairs = makeBristles(30, 11);
    const offsets = hairs.map((h) => h.offset);
    expect(Math.min(...offsets)).toBeLessThan(-0.85);
    expect(Math.max(...offsets)).toBeGreaterThan(0.85);
    const load = (pick: (o: number) => boolean) => {
      const l = hairs.filter((h) => pick(Math.abs(h.offset)));
      return l.reduce((s, h) => s + h.load, 0) / l.length;
    };
    expect(load((e) => e > 0.8)).toBeLessThan(load((e) => e < 0.4));
  });

  it("noise stays in 0..1 and is continuous", () => {
    for (let x = 0; x < 20; x += 0.37) {
      const v = noise1(9, x);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(noise1(9, x + 0.01) - v)).toBeLessThan(0.05);
    }
  });

  it("a hair touches down only after its lag", () => {
    const [b] = makeBristles(1, 1);
    const hair = { ...b, lag: 0.5, load: 1 };
    expect(hairPaints(hair, 10, 1, 40, 0)).toBe(false); // 10 < 0.5 × 40
    expect(hairPaints(hair, 30, 1, 40, 0)).toBe(true);
  });

  it("resamples at a fixed arc-length step from the start, with unit normals", () => {
    const pts = resample(line(100), 5);
    expect(pts.map((p) => p.s)).toEqual(Array.from({ length: 21 }, (_, i) => i * 5));
    expect(pts[3].x).toBeCloseTo(15);
    expect(pts[3].nx).toBeCloseTo(0);
    expect(Math.abs(pts[3].ny)).toBeCloseTo(1);
  });

  it("paints less the drier it is", () => {
    const wet = painted(bristleRuns(line(600), 30, 1, 0));
    const mid = painted(bristleRuns(line(600), 30, 1, 50));
    const dry = painted(bristleRuns(line(600), 30, 1, 100));
    expect(wet).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(dry);
    expect(dry).toBeGreaterThan(0);
  });

  it("presses more hairs into contact with more pressure", () => {
    const light = painted(bristleRuns(line(600, 0.1), 30, 1, 60));
    const hard = painted(bristleRuns(line(600, 1), 30, 1, 60));
    expect(hard).toBeGreaterThan(light);
  });

  it("keeps what is already drawn as the stroke grows (it is redrawn every frame)", () => {
    // Away from the growing end, where hairs lift off, the runs must not change.
    const cut = 300;
    const early = (hairs: { runs: number[][] }[]) =>
      hairs.map((h) => h.runs.flat().filter((_, i, a) => i % 2 === 0 && a[i] < cut));
    const short = bristleRuns(line(400), 30, 1, 60);
    const long = bristleRuns(line(900), 30, 1, 60);
    expect(early(long)).toEqual(early(short));
  });

  it("keeps a narrow stroke (Press 1) mostly painted, not dashed", () => {
    // 4 px at Press 1 used to break every ~10 px and run dry after ~100 px.
    for (const size of [2, 4, 8]) {
      const hairs = bristleRuns(line(600), size, 1, 50);
      const share = painted(hairs) / (hairs.length * 600);
      expect(share).toBeGreaterThan(0.6);
      // And no hair is thinner than a pixel's worth (a faint grey line).
      expect(Math.min(...hairs.map((h) => h.width))).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("draws each hair run thinnest at both ends and full width in the middle", () => {
    // A straight run along x, 0 to 40 in 2 px steps, tapering over 10 px: 20 segments.
    const run = Array.from({ length: 21 }, (_, i) => [i * 2, 0]).flat();
    const lv = taperLevels(run, 10, TAPER_LEVELS);
    expect(lv.length).toBe(20);
    expect(lv[0]).toBeLessThanOrEqual(2);
    expect(lv[19]).toBeLessThanOrEqual(2);
    expect(lv[10]).toBe(TAPER_LEVELS);
    // Rising to the middle, never skipping below 1.
    for (let i = 1; i <= 5; i++) expect(lv[i]).toBeGreaterThanOrEqual(lv[i - 1]);
    expect(Math.min(...lv)).toBeGreaterThanOrEqual(1);
    // A run shorter than two tapers never reaches full width.
    expect(Math.max(...taperLevels([0, 0, 2, 0, 4, 0, 6, 0], 10, TAPER_LEVELS))).toBeLessThan(
      TAPER_LEVELS,
    );
    // No taper: all full width.
    expect(taperLevels(run, 0, TAPER_LEVELS).every((l) => l === TAPER_LEVELS)).toBe(true);
    expect(taperLevels([0, 0], 10, TAPER_LEVELS)).toEqual([]);
  });

  it("sets the taper from the Taper slider as a share of the stroke's width, at least 4 px", () => {
    expect(dryTaperPx(60, 10)).toBeCloseTo(12); // the default: a fifth of the width
    expect(dryTaperPx(60, 100)).toBeCloseTo(120); // twice the width
    expect(dryTaperPx(60, 0)).toBe(4);
    expect(dryTaperPx(4, 50)).toBe(4);
    expect(dryTaperPx(60, 500)).toBeCloseTo(120); // clamped
  });

  it("draws nothing for fewer than two points", () => {
    expect(bristleRuns(line(0), 30, 1, 50)).toEqual([]);
  });
});
