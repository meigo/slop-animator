import { describe, it, expect } from "vitest";
import { spaceStamps, stampFootprint, MIN_STAMP_PX } from "../core/stamp-brush";

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

describe("spaceStamps", () => {
  /** Stamps for a line cut into `seg`-long segments, one call each (as pointermoves arrive). */
  function count(total: number, seg: number, step: number) {
    let since = 0;
    let n = 1; // the stroke's first point is stamped on its own
    for (let d = 0; d < total; d += seg) {
      const r = spaceStamps(seg, step, since);
      n += r.positions.length;
      since = r.since;
    }
    return n;
  }

  it("spaces stamps by the step whatever the segment length", () => {
    // Size 80 at spacing 0.15 → a 12 px step: ~17 stamps over 200 px, however the points arrive.
    // (The old loop gave a slow 0.5-1 px stroke several times the stamps of a fast one.)
    expect(count(200, 1, 12)).toBe(17);
    expect(count(200, 4, 12)).toBe(17);
    expect(count(200, 50, 12)).toBe(17);
  });

  it("carries the distance since the last stamp into the next segment", () => {
    expect(spaceStamps(5, 12, 0)).toEqual({ positions: [], since: 5 });
    expect(spaceStamps(10, 12, 5)).toEqual({ positions: [7], since: 3 });
  });

  it("stamps at the segment start when a step is already due", () => {
    expect(spaceStamps(3, 2, 5).positions).toEqual([0, 2]);
  });
});
