import { describe, it, expect } from "vitest";
import { contentBounds } from "../lib/cell-ink";

// Minimal canvas stub: getContext→ctx with no-op draw + getImageData returning a known buffer.
function stubCanvas(
  w: number,
  h: number,
  opaque: { x: number; y: number; w: number; h: number } | null,
) {
  const data = new Uint8ClampedArray(w * h * 4);
  if (opaque) {
    for (let y = opaque.y; y < opaque.y + opaque.h; y++)
      for (let x = opaque.x; x < opaque.x + opaque.w; x++) data[(y * w + x) * 4 + 3] = 255;
  }
  return {
    width: w,
    height: h,
    getContext: () => ({
      clearRect() {},
      drawImage() {},
      getImageData: () => ({ data, width: w, height: h }),
      set imageSmoothingEnabled(_v: boolean) {},
      set imageSmoothingQuality(_v: string) {},
    }),
  } as unknown as HTMLCanvasElement;
}

describe("contentBounds", () => {
  it("null for an empty canvas", () => {
    expect(contentBounds(stubCanvas(10, 10, null), 1)).toBeNull();
  });
  it("tight bbox of the opaque region", () => {
    expect(contentBounds(stubCanvas(10, 10, { x: 2, y: 3, w: 4, h: 2 }), 1)).toEqual({
      x: 2,
      y: 3,
      w: 4,
      h: 2,
    });
  });
  it("returns the bbox value for a 1px region", () => {
    expect(contentBounds(stubCanvas(10, 10, { x: 1, y: 1, w: 1, h: 1 }), 5)).toEqual({
      x: 1,
      y: 1,
      w: 1,
      h: 1,
    });
  });
});
