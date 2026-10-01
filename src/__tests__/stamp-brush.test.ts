import { describe, it, expect } from "vitest";
import {
  spaceStamps,
  stampFootprint,
  MIN_STAMP_PX,
  PENCIL_GRADES,
  pencilGrade,
  mipIndex,
  discProfile,
} from "../core/stamp-brush";

/**
 * A 64px tip drawn into a box smaller than MIN_STAMP_PX downsamples to alpha 0 in
 * every browser measured — the stamp draws literally nothing.
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

describe("pencilGrade", () => {
  it("HB is the Pencil as it was, and the default for anything else", () => {
    expect(pencilGrade("HB")).toEqual({ strength: 1, floor: 0.5, grain: 1 });
    expect(pencilGrade(undefined)).toEqual(pencilGrade("HB"));
    expect(pencilGrade("9Z")).toEqual(pencilGrade("HB"));
  });

  it("darkens from hard to soft: stronger, darker at a light touch, less paper grain", () => {
    const g = PENCIL_GRADES.map(pencilGrade);
    for (let i = 1; i < g.length; i++) {
      expect(g[i].strength).toBeGreaterThanOrEqual(g[i - 1].strength);
      expect(g[i].floor).toBeGreaterThan(g[i - 1].floor);
      expect(g[i].grain).toBeLessThan(g[i - 1].grain);
    }
    // Full pressure always reaches the grade's strength; a light touch never above it.
    for (const { strength, floor } of g) {
      expect(floor).toBeLessThan(1);
      expect(strength).toBeLessThanOrEqual(1);
    }
  });
});

describe("mipIndex", () => {
  const sizes = [64, 32, 16, 8, 4];

  it("picks the smallest level still at least the stamp, so nothing shrinks more than 2×", () => {
    expect(mipIndex(2, sizes)).toBe(4); // 4 px
    expect(mipIndex(4, sizes)).toBe(4);
    expect(mipIndex(5, sizes)).toBe(3); // 8 px
    expect(mipIndex(12, sizes)).toBe(2); // 16 px
    expect(mipIndex(32, sizes)).toBe(1);
    expect(mipIndex(33, sizes)).toBe(0);
    for (const px of [2, 3, 5, 7, 9, 15, 17, 31, 40]) {
      const level = sizes[mipIndex(px, sizes)];
      expect(level).toBeGreaterThanOrEqual(Math.min(px, 64));
      expect(level / px).toBeLessThanOrEqual(2);
    }
  });

  it("uses the full tip above its own size", () => {
    expect(mipIndex(200, sizes)).toBe(0);
  });
});

describe("discProfile", () => {
  /** A size×size alpha map from a function of the distance to the centre (0 centre, 1 rim). */
  const tip = (size: number, f: (d: number) => number) =>
    Array.from({ length: size * size }, (_, i) => {
      const x = (i % size) + 0.5 - size / 2;
      const y = Math.floor(i / size) + 0.5 - size / 2;
      const d = Math.hypot(x, y) / (size / 2);
      return d > 1 ? 0 : Math.round(f(d) * 255);
    });

  it("reads a flat tip as equally dark inside and out", () => {
    const p = discProfile(
      tip(64, () => 1),
      64,
    );
    expect(p.inner).toBeCloseTo(1, 2);
    expect(p.outer).toBeCloseTo(1, 2);
  });

  it("reads a soft tip as darker inside than in its outer ring", () => {
    const p = discProfile(
      tip(64, (d) => 0.8 * (1 - d)),
      64,
    );
    expect(p.inner).toBeGreaterThan(p.outer);
    expect(p.inner).toBeCloseTo(0.8 * (1 - 0.4), 1); // mean of 1 − d over the inner disc ≈ 0.6
  });
});
