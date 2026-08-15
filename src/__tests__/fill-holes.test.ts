import { describe, it, expect } from "vitest";
import { fillEnclosed, outlineFillFailed, clampGap, MAX_GAP } from "../core/fill-holes";

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

/** A filled 20×20 square inside a 30×30 bitmap — art with nothing to fill. */
function solid(size = 30): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 5; y < 25; y++) for (let x = 5; x < 25; x++) rgba[(y * size + x) * 4 + 3] = 255;
  return rgba;
}
/** A single horizontal stroke — also nothing to fill. */
function stroke(size = 30): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let x = 5; x < 25; x++) rgba[(15 * size + x) * 4 + 3] = 255;
  return rgba;
}

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

  it("encloses nothing when it leaks, however much the dilation bloats it", () => {
    // A failed fill still measures ~1.26× the ink from dilation bloat alone, so an ink-based
    // ratio would call this a success. `enclosedArea` (mask beyond ink+bridging) is exactly 0.
    const r = fillEnclosed(ring(5), 15, 15, { gap: 2 });
    expect(r.insideArea / r.inkArea).toBeGreaterThan(1.2); // the misleading number
    expect(r.enclosedArea).toBe(0); // the honest one
  });
});

describe("outlineFillFailed — only warn when an OUTLINE failed to fill", () => {
  it("reports a gapped outline, at every gap too small to bridge it", () => {
    expect(outlineFillFailed(fillEnclosed(ring(5), 15, 15))).toBe(true);
    expect(outlineFillFailed(fillEnclosed(ring(5), 15, 15, { gap: 2 }))).toBe(true);
  });

  it("does NOT report art with nothing to fill", () => {
    // Both satisfy the old `insideArea < grownArea * 1.1` criterion, so both used to be told
    // "Outline isn't closed — raise Gap, or fill the shape". Dense ink is not an outline.
    for (const gap of [0, 2]) {
      expect(outlineFillFailed(fillEnclosed(solid(), 30, 30, { gap }))).toBe(false);
      expect(outlineFillFailed(fillEnclosed(stroke(), 30, 30, { gap }))).toBe(false);
    }
  });

  it("does NOT report a fill that SUCCEEDED because the gap was raised", () => {
    // The regression the old criterion had in the other direction: a closed ring fills identically
    // at gap 0 and gap 2 (121 px), but at gap 2 the dilation bloats `grownArea` to 188, so the
    // remedy the message asks for reported itself as still failing.
    const r = fillEnclosed(ring(0), 15, 15, { gap: 2 });
    expect(r.insideArea).toBe(121);
    expect(r.insideArea).toBeLessThan(r.grownArea * 1.1); // the old criterion fired here
    expect(outlineFillFailed(r)).toBe(false);
    expect(outlineFillFailed(fillEnclosed(ring(1), 15, 15, { gap: 1 }))).toBe(false);
  });

  it("does not report an empty bitmap", () => {
    expect(outlineFillFailed(fillEnclosed(new Uint8ClampedArray(15 * 15 * 4), 15, 15))).toBe(false);
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

  it("clamps gap to 0..MAX_GAP, whatever the caller passes", () => {
    // The `max="8"` on the number input is advisory — a browser accepts a typed 50, and the
    // morphology is O(pixels × r²), so an unclamped radius freezes the tab mid-lift.
    expect(clampGap(50)).toBe(MAX_GAP);
    expect(clampGap(-3)).toBe(0);
    expect(clampGap(2.9)).toBe(2);
    expect(clampGap(null)).toBe(0); // an emptied number input binds null
    expect(clampGap(undefined)).toBe(0);
    expect(clampGap(NaN)).toBe(0);
    const huge = fillEnclosed(ring(5), 15, 15, { gap: 50 });
    const capped = fillEnclosed(ring(5), 15, 15, { gap: MAX_GAP });
    expect(huge.insideArea).toBe(capped.insideArea);
    expect(Array.from(huge.mask)).toEqual(Array.from(capped.mask));
  });

  it("respects the alpha threshold", () => {
    const faint = ring(0);
    for (let i = 3; i < faint.length; i += 4) if (faint[i]) faint[i] = 5; // below the default 10
    expect(fillEnclosed(faint, 15, 15).inkArea).toBe(0);
    expect(fillEnclosed(faint, 15, 15, { alphaThreshold: 4 }).inkArea).toBe(40);
  });
});
