import { describe, it, expect } from "vitest";
import { contentRectLogical, clampDensity } from "../core/deform";

describe("contentRectLogical", () => {
  it("scales device bounds to logical by 1/dpr", () => {
    expect(contentRectLogical({ x: 20, y: 40, w: 60, h: 80 }, 2)).toEqual({
      x: 10,
      y: 20,
      w: 30,
      h: 40,
    });
  });
  it("passes through at dpr 1", () => {
    expect(contentRectLogical({ x: 3, y: 4, w: 5, h: 6 }, 1)).toEqual({ x: 3, y: 4, w: 5, h: 6 });
  });
  it("returns null for null bounds (empty cell)", () => {
    expect(contentRectLogical(null, 2)).toBeNull();
  });
});

describe("clampDensity", () => {
  it("never goes below 2", () => {
    expect(clampDensity(1)).toBe(2);
    expect(clampDensity(2)).toBe(2);
    expect(clampDensity(0)).toBe(2);
  });
  it("rounds and keeps higher values", () => {
    expect(clampDensity(4)).toBe(4);
    expect(clampDensity(6.4)).toBe(6);
  });
});
