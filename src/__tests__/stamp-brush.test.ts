import { describe, it, expect } from "vitest";
import { stampFootprint, MIN_STAMP_PX } from "../core/stamp-brush";

/**
 * A 64px tip drawn into a box smaller than MIN_STAMP_PX downsamples to alpha 0 in
 * every browser measured (2026-08-29 analysis) — the stamp draws literally nothing.
 * The floor trades width for alpha so a thin stroke FADES instead of vanishing.
 */
describe("stampFootprint", () => {
  it("leaves widths at or above the floor untouched and fully opaque", () => {
    for (const w of [MIN_STAMP_PX, 3, 8, 40, 200]) {
      const { drawSize, alphaScale } = stampFootprint(w);
      expect(drawSize).toBeCloseTo(w, 6);
      expect(alphaScale).toBe(1);
    }
  });

  it("draws a sub-floor width at the floor instead of vanishing", () => {
    expect(stampFootprint(0.5).drawSize).toBe(MIN_STAMP_PX);
    expect(stampFootprint(1).drawSize).toBe(MIN_STAMP_PX);
  });

  it("fades a sub-floor width in proportion, so the ink laid down is conserved", () => {
    // half the intended width -> half the alpha over twice the area
    expect(stampFootprint(MIN_STAMP_PX / 2).alphaScale).toBeCloseTo(0.5, 6);
    expect(stampFootprint(MIN_STAMP_PX / 4).alphaScale).toBeCloseTo(0.25, 6);
  });

  it("lays down no ink at zero width", () => {
    expect(stampFootprint(0).alphaScale).toBe(0);
  });

  it("never returns a drawSize under the floor, nor an alphaScale outside 0..1", () => {
    for (const w of [-5, 0, 0.01, 0.5, 1.99, 2, 2.01, 100]) {
      const { drawSize, alphaScale } = stampFootprint(w);
      expect(drawSize).toBeGreaterThanOrEqual(MIN_STAMP_PX);
      expect(alphaScale).toBeGreaterThanOrEqual(0);
      expect(alphaScale).toBeLessThanOrEqual(1);
    }
  });

  it("is continuous across the floor — no visible step as pressure crosses it", () => {
    const below = stampFootprint(MIN_STAMP_PX - 1e-6);
    const at = stampFootprint(MIN_STAMP_PX);
    expect(below.alphaScale).toBeCloseTo(at.alphaScale, 4);
    expect(below.drawSize).toBeCloseTo(at.drawSize, 4);
  });
});
