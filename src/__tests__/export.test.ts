import { describe, it, expect } from "vitest";
import { frameFileName, evenDimensions } from "../export/frames";

describe("frameFileName", () => {
  it("zero-pads to at least 4 digits, 1-based", () => {
    expect(frameFileName(0, 3)).toBe("frame_0001.png");
    expect(frameFileName(9, 3)).toBe("frame_0010.png");
  });
  it("widens padding for large frame counts", () => {
    expect(frameFileName(0, 20000)).toBe("frame_00001.png");
  });
});

describe("evenDimensions", () => {
  it("rounds odd dimensions down to even (required by H.264)", () => {
    expect(evenDimensions(1281, 721)).toEqual({ w: 1280, h: 720 });
  });
  it("leaves even dimensions unchanged", () => {
    expect(evenDimensions(1280, 720)).toEqual({ w: 1280, h: 720 });
  });
});
