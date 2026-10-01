import { describe, it, expect } from "vitest";
import { CHARCOAL_TEXTURES, charcoalHoles } from "../core/brush-textures";

describe("charcoalHoles", () => {
  it("Medium is the Charcoal tip as it was, and the default for anything else", () => {
    expect(charcoalHoles("medium")).toEqual({ count: 200, minR: 1, maxR: 4, minA: 0.2, maxA: 0.8 });
    expect(charcoalHoles(undefined)).toEqual(charcoalHoles("medium"));
    expect(charcoalHoles("velvet")).toEqual(charcoalHoles("medium"));
  });

  it("goes from big holes to small ones, Rough to Dense", () => {
    const h = CHARCOAL_TEXTURES.map(charcoalHoles);
    for (let i = 1; i < h.length; i++) {
      expect(h[i].maxR).toBeLessThan(h[i - 1].maxR);
      expect(h[i].minR).toBeLessThanOrEqual(h[i - 1].minR);
    }
    for (const x of h) {
      expect(x.minR).toBeLessThanOrEqual(x.maxR);
      expect(x.minA).toBeLessThanOrEqual(x.maxA);
      expect(x.maxA).toBeLessThanOrEqual(1);
    }
  });
});
