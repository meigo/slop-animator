import { describe, it, expect } from "vitest";
import { hexToRgba, floodFill, rgbToHex } from "../core/fill";

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

describe("floodFill with expand (the default is 2)", () => {
  // The ring is drawn from a temp canvas with destination-over. Fake just enough of it: the temp
  // records its pixels, and drawImage composites them BEHIND the target's, as the browser would.
  function withRing(w: number, h: number, init: (i: number) => [number, number, number, number]) {
    const g = gridCtx(w, h, init);
    let ring: Uint8ClampedArray | null = null;
    const temp = {
      width: w,
      height: h,
      getContext: () => ({
        createImageData: (cw: number, ch: number) => ({ data: new Uint8ClampedArray(cw * ch * 4) }),
        putImageData: (img: { data: Uint8ClampedArray }) => (ring = img.data),
      }),
    };
    (globalThis as { document?: unknown }).document = { createElement: () => temp };
    Object.assign(g.ctx, {
      save: () => {},
      restore: () => {},
      resetTransform: () => {},
      drawImage: () => {
        for (let i = 0; i < w * h; i++) {
          if (!ring || g.data[i * 4 + 3] !== 0) continue; // behind: only where the target is empty
          for (let k = 0; k < 4; k++) g.data[i * 4 + k] = ring[i * 4 + k];
        }
      },
    });
    return g;
  }
  const red: [number, number, number, number] = [255, 0, 0, 255];
  const line: [number, number, number, number] = [0, 0, 0, 255];
  const blue = { r: 0, g: 0, b: 255, a: 255 };

  it("recolours a painted area (it used to paint only behind it, changing nothing)", () => {
    // 5×1: red red LINE empty empty. Tap the red.
    const { ctx, data } = withRing(5, 1, (i) => (i < 2 ? red : i === 2 ? line : [0, 0, 0, 0]));
    floodFill(ctx, 0, 0, blue, { tolerance: 32, expand: 2 });
    expect(px(data, 0)).toEqual([0, 0, 255, 255]);
    expect(px(data, 1)).toEqual([0, 0, 255, 255]);
    expect(px(data, 2)).toEqual([0, 0, 0, 255]); // the line stays on top
    expect(px(data, 3)).toEqual([0, 0, 255, 255]); // the expand ring still goes behind (empty here)
    delete (globalThis as { document?: unknown }).document;
  });

  it("still fills an empty area behind, so a faint line pixel inside it stays on top", () => {
    const faint: [number, number, number, number] = [0, 0, 0, 20]; // within tolerance of empty
    const { ctx, data } = withRing(3, 1, (i) => (i === 1 ? faint : [0, 0, 0, 0]));
    floodFill(ctx, 0, 0, blue, { tolerance: 32, expand: 2 });
    expect(px(data, 0)).toEqual([0, 0, 255, 255]);
    expect(px(data, 1)).toEqual(faint); // behind it, not over it
    delete (globalThis as { document?: unknown }).document;
  });
});

describe("floodFill same-colour check", () => {
  it("fills black with a near-black (it was refused as 'already this color')", () => {
    const { ctx, data } = gridCtx(2, 1, () => [0, 0, 0, 255]);
    floodFill(ctx, 0, 0, { r: 26, g: 26, b: 26, a: 255 }, { tolerance: 32, expand: 0 });
    expect(px(data, 0)).toEqual([26, 26, 26, 255]);
  });

  it("does nothing on exactly the fill colour", () => {
    const { ctx, data } = gridCtx(2, 1, () => [26, 26, 26, 255]);
    floodFill(ctx, 0, 0, { r: 26, g: 26, b: 26, a: 255 }, { tolerance: 32, expand: 0 });
    expect(px(data, 0)).toEqual([26, 26, 26, 255]);
  });
});

describe("rgbToHex", () => {
  it("maps black and white", () => {
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
    expect(rgbToHex(255, 255, 255)).toBe("#ffffff");
  });
  it("maps a mid color", () => {
    expect(rgbToHex(26, 26, 26)).toBe("#1a1a1a");
  });
  it("rounds and clamps out-of-range/fractional inputs", () => {
    expect(rgbToHex(255.6, -3, 300)).toBe("#ff00ff");
  });
});
