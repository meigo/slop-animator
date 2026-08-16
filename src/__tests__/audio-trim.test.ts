import { describe, it, expect } from "vitest";
import { audioTrimSpan, trimHead, trimTail } from "../audio/trim";

// A 10s buffer at 12fps is 120 frames of extent.
const EXTENT = 120;

describe("audioTrimSpan", () => {
  it("an untrimmed track spans the whole buffer", () => {
    expect(audioTrimSpan(undefined, undefined, 10, 12)).toEqual({ inS: 0, lenS: 10 });
  });

  it("a head trim moves the in-point and shortens what is left", () => {
    // 24 frames at 12fps = 2s skipped, 8s remaining.
    expect(audioTrimSpan(24, undefined, 10, 12)).toEqual({ inS: 2, lenS: 8 });
  });

  it("an explicit length wins over the remaining buffer", () => {
    expect(audioTrimSpan(24, 48, 10, 12)).toEqual({ inS: 2, lenS: 4 });
  });

  it("never returns a negative length", () => {
    expect(audioTrimSpan(240, undefined, 10, 12).lenS).toBe(0);
  });
});

describe("trimTail", () => {
  it("shortens the kept span", () => {
    expect(trimTail(0, 120, -20, EXTENT)).toEqual({ trimInFrames: 0, trimLenFrames: 100 });
  });

  it("never shrinks below one frame", () => {
    expect(trimTail(0, 120, -999, EXTENT)).toEqual({ trimInFrames: 0, trimLenFrames: 1 });
  });

  it("stops at the source's extent when dragged back out", () => {
    expect(trimTail(0, 100, 999, EXTENT)).toEqual({ trimInFrames: 0, trimLenFrames: 120 });
  });

  it("accounts for an existing head trim when capping", () => {
    // 30 already skipped, so at most 90 frames remain.
    expect(trimTail(30, 60, 999, EXTENT)).toEqual({ trimInFrames: 30, trimLenFrames: 90 });
  });

  it("treats an absent length as the whole remaining buffer", () => {
    expect(trimTail(0, undefined, -20, EXTENT)).toEqual({ trimInFrames: 0, trimLenFrames: 100 });
  });
});

describe("trimHead", () => {
  it("moves offsetFrames and trimInFrames by the SAME delta", () => {
    const r = trimHead(10, 0, 120, 15, EXTENT);
    expect(r).toEqual({ offsetFrames: 25, trimInFrames: 15, trimLenFrames: 105 });
  });

  it("KEEPS THE AUDIO IN SYNC — the audible span still ends where it did", () => {
    // The property the two-coordinate-system bug would have broken, invisible in any single value.
    const before = { offsetFrames: 10, trimInFrames: 0, trimLenFrames: 120 };
    const endBefore = before.offsetFrames + before.trimLenFrames; // project frame the audio ends on

    const after = trimHead(
      before.offsetFrames,
      before.trimInFrames,
      before.trimLenFrames,
      15,
      EXTENT,
    );

    expect(after.offsetFrames).toBe(25); // starts where the handle was dropped
    expect(after.offsetFrames + after.trimLenFrames).toBe(endBefore); // and still ends where it did
    // The same source sample is still under the same project frame:
    expect(after.offsetFrames - after.trimInFrames).toBe(before.offsetFrames - before.trimInFrames);
  });

  it("clamps the in-point at 0 when dragged back past the source start", () => {
    const r = trimHead(25, 15, 105, -999, EXTENT);
    expect(r).toEqual({ offsetFrames: 10, trimInFrames: 0, trimLenFrames: 120 });
  });

  it("never shrinks below one frame", () => {
    const r = trimHead(10, 0, 120, 999, EXTENT);
    expect(r.trimLenFrames).toBe(1);
    // Sync still holds at the limit.
    expect(r.offsetFrames - r.trimInFrames).toBe(10);
  });

  it("treats an absent length as the whole remaining buffer", () => {
    const r = trimHead(0, undefined, undefined, 10, EXTENT);
    expect(r).toEqual({ offsetFrames: 10, trimInFrames: 10, trimLenFrames: 110 });
  });
});
