import { describe, expect, it } from "vitest";
import { capScaleToArea, fitsCanvasArea, MAX_CANVAS_AREA } from "../core/canvas-area";

const area = (w: number, h: number, s: number) => Math.round(w * s) * Math.round(h * s);

describe("capScaleToArea", () => {
  it("leaves a scale that fits alone (desktop-sized documents are unchanged)", () => {
    expect(capScaleToArea(2, 1920, 1080)).toBe(2);
    expect(capScaleToArea(1.5, 2048, 2048)).toBe(1.5);
    expect(capScaleToArea(1, 3840, 2160)).toBe(1);
  });

  it("lowers the scale of a 4K document so the backing store fits (the review's 150 % case)", () => {
    for (const s of [1.5, 2]) {
      const c = capScaleToArea(s, 3840, 2160);
      expect(c).toBeLessThan(1.5);
      expect(c).toBeGreaterThan(1.4); // as sharp as the limit allows, not dropped to 1
      expect(area(3840, 2160, c)).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    }
  });

  it("fits exactly at the limit for awkward sizes", () => {
    for (const [w, h] of [
      [2732, 2732],
      [4095, 4097],
      [3001, 2999],
      [8192, 1024],
    ]) {
      const c = capScaleToArea(2, w, h);
      expect(area(w, h, c)).toBeLessThanOrEqual(MAX_CANVAS_AREA);
      expect(area(w, h, c + 2 / Math.max(w, h))).toBeGreaterThan(MAX_CANVAS_AREA);
    }
  });

  it("never goes below 1, even for a document already over the limit", () => {
    expect(capScaleToArea(2, 8192, 8192)).toBe(1);
  });
});

describe("fitsCanvasArea", () => {
  it("allows up to 16,777,216 px", () => {
    expect(fitsCanvasArea(4096, 4096)).toBe(true);
    expect(fitsCanvasArea(4097, 4096)).toBe(false);
    expect(fitsCanvasArea(8192, 2048)).toBe(true);
    expect(fitsCanvasArea(8192, 2049)).toBe(false);
  });
});
