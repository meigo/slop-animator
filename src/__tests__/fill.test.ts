import { describe, it, expect } from "vitest";
import { hexToRgba, floodFill } from "../core/fill";

describe("hexToRgba", () => {
  it("parses black at full opacity", () => {
    expect(hexToRgba("#000000", 100)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
  });
  it("parses white at full opacity", () => {
    expect(hexToRgba("#ffffff", 100)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });
  it("parses red", () => {
    expect(hexToRgba("#ff0000", 100)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });
  it("handles half opacity", () => {
    expect(hexToRgba("#000000", 50).a).toBe(128);
  });
  it("handles zero opacity", () => {
    expect(hexToRgba("#ffffff", 0).a).toBe(0);
  });
  it("parses arbitrary hex", () => {
    const c = hexToRgba("#1a2b3c", 100);
    expect([c.r, c.g, c.b]).toEqual([0x1a, 0x2b, 0x3c]);
  });
});

function gridCtx(w: number, h: number, fill: (i: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b, a] = fill(i);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  const img = { data, width: w, height: h };
  const ctx = {
    canvas: { width: w, height: h },
    getImageData: () => img,
    putImageData: () => {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, data };
}

function px(data: Uint8ClampedArray, i: number): [number, number, number, number] {
  return [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];
}

describe("floodFill (expand:0)", () => {
  it("fills a fully-connected transparent region with the fill colour", () => {
    const { ctx, data } = gridCtx(2, 2, () => [0, 0, 0, 0]);
    floodFill(ctx, 0, 0, { r: 255, g: 0, b: 0, a: 255 }, { tolerance: 32, expand: 0 });
    for (let i = 0; i < 4; i++) expect(px(data, i)).toEqual([255, 0, 0, 255]);
  });

  it("stops at pixels that don't match the start colour (bounded fill)", () => {
    const { ctx, data } = gridCtx(3, 1, (i) => (i === 1 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
    floodFill(ctx, 0, 0, { r: 255, g: 0, b: 0, a: 255 }, { tolerance: 32, expand: 0 });
    expect(px(data, 0)).toEqual([255, 0, 0, 255]);
    expect(px(data, 1)).toEqual([0, 0, 0, 255]);
    expect(px(data, 2)).toEqual([0, 0, 0, 0]);
  });

  it("does nothing when the start pixel already matches the fill colour", () => {
    const { ctx, data } = gridCtx(2, 2, () => [255, 0, 0, 255]);
    floodFill(ctx, 0, 0, { r: 255, g: 0, b: 0, a: 255 }, { tolerance: 32, expand: 0 });
    for (let i = 0; i < 4; i++) expect(px(data, i)).toEqual([255, 0, 0, 255]);
  });
});
