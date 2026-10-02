import { describe, it, expect } from "vitest";
import { halvingSteps, linkedSize, MAX_DOC_PX } from "../anim/resize";

describe("linkedSize", () => {
  it("keeps the document's ratio", () => {
    expect(linkedSize(960, 1920, 1080)).toBe(540); // width → height
    expect(linkedSize(1080, 1080, 1920)).toBe(1920); // height → width
    expect(linkedSize(1000, 1920, 1080)).toBe(563); // rounded
  });

  it("clamps to 1…8192", () => {
    expect(linkedSize(1, 1920, 1080)).toBe(1);
    expect(linkedSize(8192, 1080, 1920)).toBe(MAX_DOC_PX);
  });

  it("falls back to the other side for a bad input", () => {
    expect(linkedSize(Number.NaN, 1920, 1080)).toBe(1080);
    expect(linkedSize(500, 0, 1080)).toBe(1080);
  });
});

describe("halvingSteps", () => {
  it("halves down to a large shrink, then lands on the target", () => {
    expect(halvingSteps(4000, 2000, 500, 250)).toEqual([
      { w: 2000, h: 1000 },
      { w: 1000, h: 500 },
      { w: 500, h: 250 },
    ]);
    expect(halvingSteps(1920, 1080, 300, 200)).toEqual([
      { w: 960, h: 540 },
      { w: 480, h: 270 },
      { w: 300, h: 200 },
    ]);
  });

  it("is one step for growing or a shrink under 2×", () => {
    expect(halvingSteps(800, 600, 1600, 1200)).toEqual([{ w: 1600, h: 1200 }]);
    expect(halvingSteps(800, 600, 500, 400)).toEqual([{ w: 500, h: 400 }]);
  });

  it("never shrinks a side below its target, when only one side shrinks a lot", () => {
    const steps = halvingSteps(4000, 1000, 500, 900);
    for (const s of steps) {
      expect(s.w).toBeGreaterThanOrEqual(500);
      expect(s.h).toBeGreaterThanOrEqual(900);
    }
    expect(steps.at(-1)).toEqual({ w: 500, h: 900 });
  });
});
