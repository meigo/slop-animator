import { describe, expect, it } from "vitest";
import { signedDistanceField } from "../core/outline";

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
