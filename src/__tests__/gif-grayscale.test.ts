import { describe, it, expect } from "vitest";
import { framesIdentical, grayscaleInPlace } from "../export/gif";

const px = (...vals: number[]) => new Uint8ClampedArray(vals);

describe("grayscaleInPlace", () => {
  it("replaces each pixel with its Rec. 601 luminance", () => {
    // pure red 255,0,0 → 0.299*255 ≈ 76; pure green → 150; pure blue → 29
    const d = px(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255);
    grayscaleInPlace(d);
    expect([d[0], d[1], d[2]]).toEqual([76, 76, 76]);
    expect([d[4], d[5], d[6]]).toEqual([150, 150, 150]);
    expect([d[8], d[9], d[10]]).toEqual([29, 29, 29]);
  });

  it("leaves alpha alone, so a transparent export stays transparent", () => {
    const d = px(200, 100, 50, 0, 200, 100, 50, 128, 200, 100, 50, 255);
    grayscaleInPlace(d);
    expect([d[3], d[7], d[11]]).toEqual([0, 128, 255]);
  });

  it("leaves an already-grey pixel where it is", () => {
    const d = px(0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255);
    grayscaleInPlace(d);
    expect([...d]).toEqual([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
  });

  it("is idempotent — running it twice changes nothing further", () => {
    const d = px(17, 200, 99, 255, 4, 4, 250, 30);
    grayscaleInPlace(d);
    const once = [...d];
    grayscaleInPlace(d);
    expect([...d]).toEqual(once);
  });
});

describe("framesIdentical", () => {
  const frame = (...vals: number[]) => new Uint8ClampedArray(vals);

  it("is true for the same bytes — what a HOLD renders twice", () => {
    expect(
      framesIdentical(frame(1, 2, 3, 255, 9, 9, 9, 255), frame(1, 2, 3, 255, 9, 9, 9, 255)),
    ).toBe(true);
  });

  it("catches a difference in the first pixel", () => {
    expect(framesIdentical(frame(1, 2, 3, 255), frame(2, 2, 3, 255))).toBe(false);
  });

  it("catches a difference in the LAST pixel — the one a word-at-a-time compare could miss", () => {
    expect(
      framesIdentical(frame(0, 0, 0, 255, 1, 2, 3, 255), frame(0, 0, 0, 255, 1, 2, 3, 254)),
    ).toBe(false);
  });

  it("catches a difference in alpha alone", () => {
    expect(framesIdentical(frame(1, 2, 3, 255), frame(1, 2, 3, 0))).toBe(false);
  });

  it("is false for different lengths rather than comparing a prefix", () => {
    expect(framesIdentical(frame(1, 2, 3, 255), frame(1, 2, 3, 255, 1, 2, 3, 255))).toBe(false);
  });
});
