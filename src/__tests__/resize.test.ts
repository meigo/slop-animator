import { describe, it, expect } from "vitest";
import { placeContent, type Anchor } from "../anim/resize";

const C: Anchor = { ax: 0.5, ay: 0.5 };
const TL: Anchor = { ax: 0, ay: 0 };
const BR: Anchor = { ax: 1, ay: 1 };

describe("placeContent", () => {
  it("scale, same aspect: fills the new canvas (factor = ratio)", () => {
    expect(placeContent(100, 100, 200, 200, "scale", C)).toEqual({ x: 0, y: 0, w: 200, h: 200 });
  });
  it("scale, different aspect: fits (no distortion) and the anchor positions the margin", () => {
    expect(placeContent(100, 50, 100, 100, "scale", C)).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    expect(placeContent(100, 50, 100, 100, "scale", TL)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(placeContent(100, 50, 100, 100, "scale", BR)).toEqual({ x: 0, y: 50, w: 100, h: 50 });
  });
  it("crop, bigger canvas: keeps pixel size, adds margin per anchor", () => {
    expect(placeContent(100, 100, 200, 200, "crop", C)).toEqual({ x: 50, y: 50, w: 100, h: 100 });
    expect(placeContent(100, 100, 200, 200, "crop", TL)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
  it("crop, smaller canvas: keeps pixel size, negative offset = crop", () => {
    expect(placeContent(200, 200, 100, 100, "crop", C)).toEqual({ x: -50, y: -50, w: 200, h: 200 });
  });
  it("degenerate empty source → identity rect filling the new canvas", () => {
    expect(placeContent(0, 0, 100, 80, "scale", C)).toEqual({ x: 0, y: 0, w: 100, h: 80 });
  });
});
