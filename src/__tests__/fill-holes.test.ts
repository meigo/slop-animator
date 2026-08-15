import { describe, it, expect } from "vitest";
import { fillEnclosed } from "../core/fill-holes";

/**
 * A 15×15 square ring (1 px stroke, inset 2) with a `gap`-wide break in its top edge — the
 * outline-drawing case in miniature. Centre is (7,7); if that is in the mask, the fill worked.
 */
function ring(gap: number, size = 15, inset = 2): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const lo = inset,
    hi = size - 1 - inset;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const onEdge =
        ((x === lo || x === hi) && y >= lo && y <= hi) ||
        ((y === lo || y === hi) && x >= lo && x <= hi);
      const inBreak = y === lo && x >= 7 && x < 7 + gap;
      if (onEdge && !inBreak) rgba[(y * size + x) * 4 + 3] = 255;
    }
  }
  return rgba;
}
const CENTRE = 7 * 15 + 7;

describe("fillEnclosed — a closed outline", () => {
  it("fills the enclosed interior", () => {
    const r = fillEnclosed(ring(0), 15, 15);
    expect(r.mask[CENTRE]).toBe(1);
    expect(r.inkArea).toBe(40);
    expect(r.insideArea).toBe(121); // the 11×11 block the ring encloses, ring included
  });

  it("does not bloat the silhouette at any gap radius", () => {
    for (const gap of [1, 2, 3]) {
      expect(fillEnclosed(ring(0), 15, 15, { gap }).insideArea).toBe(121);
    }
  });
});

describe("fillEnclosed — a broken outline", () => {
  it("leaks through the break at gap 0, finding nothing", () => {
    const r = fillEnclosed(ring(1), 15, 15);
    expect(r.mask[CENTRE]).toBe(0);
    expect(r.insideArea).toBe(r.inkArea); // nothing beyond the ink itself
  });

  it("bridges a break of roughly 2×gap", () => {
    // gap 1 spans a 1px break but not a 3px one; gap 2 spans 3px but not 5px.
    expect(fillEnclosed(ring(1), 15, 15, { gap: 1 }).mask[CENTRE]).toBe(1);
    expect(fillEnclosed(ring(3), 15, 15, { gap: 1 }).mask[CENTRE]).toBe(0);
    expect(fillEnclosed(ring(3), 15, 15, { gap: 2 }).mask[CENTRE]).toBe(1);
    expect(fillEnclosed(ring(5), 15, 15, { gap: 2 }).mask[CENTRE]).toBe(0);
    expect(fillEnclosed(ring(5), 15, 15, { gap: 3 }).mask[CENTRE]).toBe(1);
  });

  it("reports failure against the GROWN mask, not the ink", () => {
    // A failed fill still measures ~1.26× the ink from dilation bloat alone, so an ink-based
    // threshold would call this a success. Against `grownArea` the failure is unambiguous.
    const r = fillEnclosed(ring(5), 15, 15, { gap: 2 });
    expect(r.insideArea / r.inkArea).toBeGreaterThan(1.2); // the misleading number
    expect(r.insideArea).toBeLessThan(r.grownArea * 1.1); // the honest one
  });
});

describe("fillEnclosed — edges and degenerate input", () => {
  it("handles ink flush against the crop edge (the tight-bbox case)", () => {
    // inset 0: the ring IS the bitmap border, so everything it encloses is the whole bitmap.
    const r = fillEnclosed(ring(0, 15, 0), 15, 15);
    expect(r.mask[CENTRE]).toBe(1);
    expect(r.insideArea).toBe(225);
  });

  it("returns an empty mask for a fully transparent bitmap", () => {
    const r = fillEnclosed(new Uint8ClampedArray(15 * 15 * 4), 15, 15);
    expect(r.inkArea).toBe(0);
    expect(r.insideArea).toBe(0);
  });

  it("respects the alpha threshold", () => {
    const faint = ring(0);
    for (let i = 3; i < faint.length; i += 4) if (faint[i]) faint[i] = 5; // below the default 10
    expect(fillEnclosed(faint, 15, 15).inkArea).toBe(0);
    expect(fillEnclosed(faint, 15, 15, { alphaThreshold: 4 }).inkArea).toBe(40);
  });
});
