import { describe, it, expect } from "vitest";
import { boundsOfPixels, contentBounds, groupContentBoxLogical } from "../lib/cell-ink";
import type { Project, LayerGroup, DrawingLayer } from "../anim/document";

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

function makeProject(layers: DrawingLayer[], groups: LayerGroup[], w = 10, h = 10): Project {
  return {
    width: w,
    height: h,
    fps: 12,
    bgColor: "#000",
    frameCount: 1,
    boil: { enabled: false, amount: 1, cols: 20, rate: 3, weight: 0.4, holdsOnly: true },
    groups,
    layers,
    audio: null,
  } as unknown as Project;
}

function drawLayerWith(
  id: number,
  groupId: number | null,
  opaque: { x: number; y: number; w: number; h: number } | null,
): DrawingLayer {
  const canvasW = opaque ? Math.max(10, opaque.x + opaque.w) : 10;
  const canvasH = opaque ? Math.max(10, opaque.y + opaque.h) : 10;
  return {
    kind: "draw",
    id,
    name: `L${id}`,
    visible: true,
    locked: false,
    opacity: 100,
    boilStrength: 1,
    groupId,
    cells: [{ kind: "key", canvas: stubCanvas(canvasW, canvasH, opaque) }],
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  };
}

describe("groupContentBoxLogical", () => {
  const g: LayerGroup = { id: 7, name: "G", collapsed: false, visible: true };

  it("returns full doc rect for an empty group", () => {
    const p = makeProject([], [g]);
    expect(groupContentBoxLogical(g, p, 0, 1, 1)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  it("returns the lone draw layer's bbox (logical = device/dpr)", () => {
    const p = makeProject([drawLayerWith(1, 7, { x: 2, y: 3, w: 4, h: 2 })], [g]);
    expect(groupContentBoxLogical(g, p, 0, 1, 1)).toEqual({ x: 2, y: 3, w: 4, h: 2 });
  });

  it("returns the union across two member draw layers", () => {
    const p = makeProject(
      [
        drawLayerWith(1, 7, { x: 1, y: 1, w: 2, h: 2 }), // → [1..2, 1..2]
        drawLayerWith(2, 7, { x: 6, y: 5, w: 3, h: 4 }), // → [6..8, 5..8]
      ],
      [g],
    );
    expect(groupContentBoxLogical(g, p, 0, 1, 1)).toEqual({ x: 1, y: 1, w: 8, h: 8 });
  });

  it("ignores layers belonging to other groups", () => {
    const p = makeProject(
      [
        drawLayerWith(1, 7, { x: 2, y: 3, w: 4, h: 2 }), // in our group
        drawLayerWith(2, 99, { x: 0, y: 0, w: 1, h: 1 }), // in some other group
      ],
      [g],
    );
    expect(groupContentBoxLogical(g, p, 0, 1, 1)).toEqual({ x: 2, y: 3, w: 4, h: 2 });
  });

  it("converts device px to logical via /dpr", () => {
    const p = makeProject([drawLayerWith(1, 7, { x: 4, y: 6, w: 8, h: 4 })], [g]);
    expect(groupContentBoxLogical(g, p, 0, 2, 1)).toEqual({ x: 2, y: 3, w: 4, h: 2 });
  });
});

/** An RGBA buffer from rows of "." (transparent) and "#" (opaque). */
function pixels(rows: string[]) {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === "#") data[(y * width + x) * 4 + 3] = 255;
    }),
  );
  return { data, width, height };
}
const bounds = (rows: string[]) => {
  const { data, width, height } = pixels(rows);
  return boundsOfPixels(data, width, height);
};

// The tight rect every PSD layer's channel data is sized from, and the reason a full-frame rect
// per layer (~8 MB before compression at 1920x1080) is not what ships. Never testable through
// `contentBounds`, which needs a canvas.
describe("boundsOfPixels", () => {
  it("is null when every pixel is transparent", () => {
    expect(bounds(["....", "....", "...."])).toBeNull();
  });

  it("wraps a single pixel in a 1x1 rect", () => {
    expect(bounds(["....", "..#.", "...."])).toEqual({ x: 2, y: 1, w: 1, h: 1 });
  });

  it("returns the whole buffer for full bleed", () => {
    expect(bounds(["####", "####"])).toEqual({ x: 0, y: 0, w: 4, h: 2 });
  });

  it("keeps a one-pixel-tall row one pixel tall", () => {
    expect(bounds([".....", ".###.", "....."])).toEqual({ x: 1, y: 1, w: 3, h: 1 });
  });

  it("does not transpose x and y on a non-square buffer", () => {
    // The ink sits at an x that is not a valid y, so an index swap cannot produce this answer.
    expect(bounds(["......", "....#.", "......"])).toEqual({ x: 4, y: 1, w: 1, h: 1 });
  });

  it("reads ALPHA only — an opaque-coloured but transparent pixel is not ink", () => {
    const { data, width, height } = pixels(["..", ".."]);
    data[0] = 255; // red, alpha still 0
    expect(boundsOfPixels(data, width, height)).toBeNull();
  });
});
