import { describe, expect, it } from "vitest";
import {
  signedDistanceField,
  valueNoise,
  clampThickness,
  outlineMask,
  MAX_THICKNESS,
} from "../core/outline";
import { erodeMask } from "../core/mask-ops";

/** w×h alpha plane with a filled rectangle (x0..x1, y0..y1 inclusive) at alpha 255. */
function rectAlpha(
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Uint8Array {
  const a = new Uint8Array(w * h);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) a[y * w + x] = 255;
  return a;
}

describe("signedDistanceField", () => {
  it("is negative everywhere when nothing is drawn", () => {
    const d = signedDistanceField(new Uint8Array(4 * 4), 4, 4);
    expect([...d].every((v) => v < 0)).toBe(true);
  });

  it("puts a hard edge half a pixel outside the last opaque pixel", () => {
    // 8×8 with a 4×4 block at (2,2)..(5,5).
    const d = signedDistanceField(rectAlpha(8, 8, 2, 2, 5, 5), 8, 8);
    expect(d[2 * 8 + 2]).toBeCloseTo(0.5, 5); // corner of the block: first ring inside
    expect(d[3 * 8 + 3]).toBeCloseTo(1.5, 5); // one ring further in
    expect(d[1 * 8 + 2]).toBeCloseTo(-0.5, 5); // first ring outside
  });

  it("counts off-canvas as outside, so a shape flush to the edge has an edge there", () => {
    // 6×6 filled solid: every border pixel is a boundary pixel.
    const a = new Uint8Array(6 * 6).fill(255);
    const d = signedDistanceField(a, 6, 6);
    expect(d[0]).toBeCloseTo(0.5, 5);
    expect(d[2 * 6 + 2]).toBeCloseTo(2.5, 5);
  });

  it("carries the source's anti-aliasing sub-pixel", () => {
    // A vertical hard edge, but the boundary column is half-covered: the 50% crossing sits ON
    // that pixel's centre, so its distance is 0, not 0.5.
    const w = 6,
      h = 1;
    const a = new Uint8Array(w * h);
    a[0] = 255;
    a[1] = 255;
    a[2] = 128; // 128/255 ≈ 0.502
    const d = signedDistanceField(a, w, h);
    expect(Math.abs(d[2])).toBeLessThan(0.05);
  });
});

describe("valueNoise", () => {
  it("is deterministic for the same (x, y, seed)", () => {
    expect(valueNoise(1.25, 3.5, 7)).toBe(valueNoise(1.25, 3.5, 7));
  });

  it("gives a different field for a different seed", () => {
    const a = valueNoise(1.25, 3.5, 7);
    const b = valueNoise(1.25, 3.5, 8);
    expect(a).not.toBe(b);
  });

  it("stays within [-1, 1]", () => {
    for (let i = 0; i < 500; i++) {
      const v = valueNoise(i * 0.37, i * 0.11, 3);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is smooth: neighbouring samples within a lattice cell stay close", () => {
    let maxJump = 0;
    for (let i = 0; i < 200; i++) {
      const a = valueNoise(5 + i * 0.01, 2.5, 4);
      const b = valueNoise(5 + (i + 1) * 0.01, 2.5, 4);
      maxJump = Math.max(maxJump, Math.abs(a - b));
    }
    expect(maxJump).toBeLessThan(0.1); // a hash-per-pixel field would jump ~2
  });
});

const plain = { wobble: 0, variation: 0, seed: 1 };

describe("outlineMask", () => {
  it("hollows a solid rectangle to a ring of exactly the requested thickness", () => {
    const w = 20,
      h = 20;
    const out = outlineMask(rectAlpha(w, h, 4, 4, 15, 15), w, h, { ...plain, thickness: 2 });
    expect(out[4 * w + 4]).toBe(255); // outer ring
    expect(out[5 * w + 5]).toBe(255); // second ring — thickness 2
    expect(out[6 * w + 6]).toBe(0); // third ring is hollowed
    expect(out[10 * w + 10]).toBe(0); // middle is empty
    expect(out[3 * w + 4]).toBe(0); // nothing outside the silhouette
  });

  it("matches `mask minus erodeMask` when both knobs are zero", () => {
    const w = 24,
      h = 24;
    const alpha = rectAlpha(w, h, 5, 6, 18, 17);
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = alpha[i] >= 128 ? 1 : 0;
    const eroded = erodeMask(mask, w, h, 3);
    const out = outlineMask(alpha, w, h, { ...plain, thickness: 3 });
    for (let i = 0; i < mask.length; i++) {
      const expected = mask[i] && !eroded[i] ? 255 : 0;
      expect(out[i]).toBe(expected);
    }
  });

  it("leaves a shape thinner than the thickness solid", () => {
    const w = 12,
      h = 12;
    const alpha = rectAlpha(w, h, 2, 5, 9, 6); // a 2px-tall bar
    const out = outlineMask(alpha, w, h, { ...plain, thickness: 6 });
    for (let x = 2; x <= 9; x++) {
      expect(out[5 * w + x]).toBe(255);
      expect(out[6 * w + x]).toBe(255);
    }
  });

  it("outlines a hole's edge too", () => {
    const w = 24,
      h = 24;
    const alpha = rectAlpha(w, h, 4, 4, 19, 19);
    for (let y = 9; y <= 14; y++) for (let x = 9; x <= 14; x++) alpha[y * w + x] = 0; // punch a hole
    const out = outlineMask(alpha, w, h, { ...plain, thickness: 1 });
    expect(out[8 * w + 11]).toBe(255); // ring around the hole
    expect(out[11 * w + 11]).toBe(0); // the hole itself stays empty
  });

  it("is byte-identical for one seed and different for another", () => {
    const w = 30,
      h = 30;
    const alpha = rectAlpha(w, h, 5, 5, 24, 24);
    const opts = { thickness: 3, wobble: 0.8, variation: 0.8 };
    const a = outlineMask(alpha, w, h, { ...opts, seed: 1 });
    const b = outlineMask(alpha, w, h, { ...opts, seed: 1 });
    const c = outlineMask(alpha, w, h, { ...opts, seed: 2 });
    expect([...a]).toEqual([...b]);
    expect([...a]).not.toEqual([...c]);
  });

  it("keeps a wobbled line within WOBBLE_MAX of the plain band", () => {
    const w = 40,
      h = 40;
    const alpha = rectAlpha(w, h, 8, 8, 31, 31);
    const wobbled = outlineMask(alpha, w, h, { thickness: 2, wobble: 1, variation: 0, seed: 5 });
    const field = signedDistanceField(alpha, w, h);
    for (let i = 0; i < wobbled.length; i++) {
      if (wobbled[i] > 0) expect(field[i]).toBeGreaterThan(-3.5); // never further out than WOBBLE_MAX (+ the AA ramp)
    }
  });

  it("anti-aliases: a soft source edge gives a soft outer edge", () => {
    const w = 10,
      h = 1;
    const alpha = new Uint8Array(w * h);
    alpha[3] = 160; // partial coverage on the boundary pixel
    for (let x = 4; x <= 8; x++) alpha[x] = 255;
    const out = outlineMask(alpha, w, h, { ...plain, thickness: 2 });
    expect(out[3]).toBeGreaterThan(0);
    expect(out[3]).toBeLessThan(255);
  });

  it("returns empty for empty input, and for thickness 0", () => {
    const w = 8,
      h = 8;
    expect(
      [...outlineMask(new Uint8Array(w * h), w, h, { ...plain, thickness: 3 })].every(
        (v) => v === 0,
      ),
    ).toBe(true);
    expect(
      [...outlineMask(rectAlpha(w, h, 1, 1, 6, 6), w, h, { ...plain, thickness: 0 })].every(
        (v) => v === 0,
      ),
    ).toBe(true);
  });

  it("clamps a thickness a NumberField could produce", () => {
    expect(clampThickness(null)).toBe(0);
    expect(clampThickness(-4)).toBe(0);
    expect(clampThickness(1000)).toBe(MAX_THICKNESS);
    expect(clampThickness(3.7)).toBe(3.7);
  });
});
