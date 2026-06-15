import { describe, it, expect } from "vitest";
import { boilSeedOffset } from "../core/boil-gl";

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
