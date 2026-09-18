import { describe, it, expect } from "vitest";
import { boilSeedOffset, boilStateIndex, boilWeightJitter } from "../core/boil-gl";

describe("boilSeedOffset", () => {
  it("is bounded well below the magnitudes that collapse GLSL noise", () => {
    for (const seed of [0, 1, 100003, 9176, 300009 + 27528, 1e7]) {
      const [x, y] = boilSeedOffset(seed);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(17);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(17);
    }
  });
  it("is deterministic", () => {
    expect(boilSeedOffset(42)).toEqual(boilSeedOffset(42));
  });
  it("gives distinct offsets for the rate/layer seeds it will see", () => {
    const a = boilSeedOffset(0 * 100003 + 1 * 9176);
    const b = boilSeedOffset(1 * 100003 + 1 * 9176);
    const c = boilSeedOffset(0 * 100003 + 2 * 9176);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe("boilWeightJitter", () => {
  it("stays within [-1, 1]", () => {
    for (let f = 0; f < 50; f++) {
      for (const rate of [1, 2, 3, 5, 8]) {
        const v = boilWeightJitter(f, rate, 1);
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  // The regression this function exists for: the jitter used to be a hash of the boil seed, which
  // takes only `rate` distinct values — and that subset came out all-positive at the default rate,
  // so the line fattened constantly instead of breathing, and the weight slider looked dead.
  it("takes BOTH signs over one cycle, for every animating rate and layer", () => {
    for (const rate of [2, 3, 4, 5, 6, 7, 8]) {
      for (const layerId of [1, 2, 3, 7, 12]) {
        const cycle = Array.from({ length: rate }, (_, f) => boilWeightJitter(f, rate, layerId));
        expect(cycle.some((v) => v > 0)).toBe(true);
        expect(cycle.some((v) => v < 0)).toBe(true);
      }
    }
  });

  it("repeats with the rate cycle, so weight holds in step with the displacement", () => {
    for (const rate of [2, 3, 5]) {
      for (let f = 0; f < rate; f++) {
        expect(boilWeightJitter(f + rate, rate, 1)).toBeCloseTo(boilWeightJitter(f, rate, 1), 12);
      }
    }
  });

  it("gives stacked layers different phases so they don't breathe in lockstep", () => {
    expect(boilWeightJitter(0, 3, 1)).not.toBeCloseTo(boilWeightJitter(0, 3, 2), 6);
  });

  it("is constant at rate 1 — one distinct warp means one thickness (documented, not a bug)", () => {
    const v = boilWeightJitter(0, 1, 1);
    for (let f = 1; f < 10; f++) expect(boilWeightJitter(f, 1, 1)).toBeCloseTo(v, 12);
  });
});

describe("boilStateIndex", () => {
  it("changes every frame at step 1 — today's behaviour, unchanged", () => {
    const seq = Array.from({ length: 7 }, (_, f) => boilStateIndex(f, 3, 1));
    expect(seq).toEqual([0, 1, 2, 0, 1, 2, 0]);
  });

  it("HOLDS each state for `step` frames — boil on twos and threes", () => {
    expect(Array.from({ length: 9 }, (_, f) => boilStateIndex(f, 3, 2))).toEqual([
      0, 0, 1, 1, 2, 2, 0, 0, 1,
    ]);
    expect(Array.from({ length: 9 }, (_, f) => boilStateIndex(f, 4, 3))).toEqual([
      0, 0, 0, 1, 1, 1, 2, 2, 2,
    ]);
  });

  it("stays inside the cycle, so the seed set is still `rate` states wide", () => {
    for (const rate of [1, 2, 3, 5, 8]) {
      for (const step of [1, 2, 3, 7]) {
        for (let f = 0; f < 60; f++) {
          const i = boilStateIndex(f, rate, step);
          expect(i).toBeGreaterThanOrEqual(0);
          expect(i).toBeLessThan(rate);
        }
      }
    }
  });

  it("treats a nonsense rate or step as 1 rather than dividing by zero", () => {
    expect(boilStateIndex(5, 0, 0)).toBe(0);
    expect(boilStateIndex(5, 1, -3)).toBe(0);
  });

  it("holds the WEIGHT in step with the displacement, not just the warp", () => {
    // The whole point: with step 2 the line must not breathe on frames where the warp is frozen.
    const a = boilStateIndex(4, 3, 2);
    const b = boilStateIndex(5, 3, 2);
    expect(a).toBe(b);
    expect(boilWeightJitter(a, 3, 1)).toBeCloseTo(boilWeightJitter(b, 3, 1), 12);
  });
});
