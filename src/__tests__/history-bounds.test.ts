import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_BYTES,
  UNDO_TILE,
  changedTiles,
  cropPixels,
  pixelCommand,
} from "../anim/history";

const W = 20;
const H = 10;
const blank = (w = W, h = H) => new Uint8ClampedArray(w * h * 4);
function paint(buf: Uint8ClampedArray, x: number, y: number, w = W) {
  buf[(y * w + x) * 4 + 3] = 255;
}

describe("changedTiles", () => {
  it("is empty for identical buffers", () => {
    expect(changedTiles(blank(), blank(), W, H, 8)).toEqual([]);
  });

  it("finds the tile of a single pixel", () => {
    const b = blank();
    paint(b, 9, 3);
    expect(changedTiles(blank(), b, W, H, 8)).toEqual([{ x: 8, y: 0, w: 8, h: 8 }]);
  });

  it("clips the edge tiles to the buffer", () => {
    const b = blank();
    paint(b, 19, 9);
    expect(changedTiles(blank(), b, W, H, 8)).toEqual([{ x: 16, y: 8, w: 4, h: 2 }]);
  });

  it("lists only the tiles touched, in row order", () => {
    const b = blank();
    paint(b, 1, 1);
    paint(b, 17, 2);
    paint(b, 10, 9);
    expect(changedTiles(blank(), b, W, H, 8)).toEqual([
      { x: 0, y: 0, w: 8, h: 8 },
      { x: 16, y: 0, w: 4, h: 8 },
      { x: 8, y: 8, w: 8, h: 2 },
    ]);
  });

  it("sees a change in any channel", () => {
    const b = blank();
    b[(4 * W + 9) * 4 + 1] = 1; // green of (9, 4)
    expect(changedTiles(blank(), b, W, H, 8)).toEqual([{ x: 8, y: 0, w: 8, h: 8 }]);
  });
});

describe("cropPixels", () => {
  it("copies the rectangle row by row", () => {
    const src = new Uint8ClampedArray(W * H * 4).map((_, i) => i % 251);
    const r = { x: 3, y: 2, w: 4, h: 3 };
    const out = cropPixels(src, W, r);
    expect(out.length).toBe(4 * 3 * 4);
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w * 4; x++)
        expect(out[y * r.w * 4 + x]).toBe(src[((r.y + y) * W + r.x) * 4 + x]);
  });
});

describe("the budget with tiled steps", () => {
  it("holds 50 page-crossing strokes on a 1920×1080 doc (DPR 1), against 16 whole-canvas steps", () => {
    // A 16 px line corner to corner.
    const w = 1920;
    const h = 1080;
    const a = blank(w, h);
    const b = blank(w, h);
    for (let i = 0; i < 4000; i++) {
      const x = Math.round((i / 4000) * (w - 17));
      const y = Math.round((i / 4000) * (h - 17));
      for (let d = 0; d < 16; d++) paint(b, x + d, y + d, w);
    }
    const tiles = changedTiles(a, b, w, h);
    const perStroke = tiles.reduce((s, r) => s + r.w * r.h * 4 * 2, 0);
    expect(Math.floor(DEFAULT_HISTORY_BYTES / perStroke)).toBeGreaterThanOrEqual(50);
    // what a whole-canvas step costs
    expect(Math.floor(DEFAULT_HISTORY_BYTES / (w * h * 4 * 2))).toBe(16);
    expect(UNDO_TILE).toBe(64);
  });
});

/** A node stand-in for a 2D context: a `width`-wide RGBA buffer that `putImageData` writes into. */
function stubCtx(width: number, height: number, pixels = blank(width, height)) {
  const puts: { x: number; y: number; w: number; h: number }[] = [];
  const ctx = {
    canvas: {} as HTMLCanvasElement,
    pixels,
    puts,
    putImageData(img: ImageData, x: number, y: number) {
      puts.push({ x, y, w: img.width, h: img.height });
      for (let r = 0; r < img.height; r++) {
        const from = r * img.width * 4;
        pixels.set(img.data.subarray(from, from + img.width * 4), ((y + r) * width + x) * 4);
      }
    },
  };
  return ctx;
}
const img = (data: Uint8ClampedArray, w: number, h: number) =>
  new ImageData(data as Uint8ClampedArray<ArrayBuffer>, w, h);

describe("pixelCommand keeps only the changed tiles", () => {
  const real = globalThis.ImageData;
  beforeEach(() => {
    globalThis.ImageData = class {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    } as unknown as typeof ImageData;
  });
  afterEach(() => {
    globalThis.ImageData = real;
  });

  const w = 150; // not a multiple of the tile: the edge tiles are clipped
  const h = 70;

  it("undoes and redoes three steps exactly, in order", () => {
    const states = [blank(w, h)];
    const marks = [
      [3, 3],
      [140, 65],
      [70, 10],
    ];
    for (const [x, y] of marks) {
      const next = states[states.length - 1].slice();
      paint(next, x, y, w);
      paint(next, x + 1, y, w);
      states.push(next);
    }
    const ctx = stubCtx(w, h, states[3].slice());
    const cmds = [0, 1, 2].map((i) =>
      pixelCommand(
        ctx as unknown as CanvasRenderingContext2D,
        img(states[i], w, h),
        img(states[i + 1], w, h),
        (put) => put(),
        (put) => put(),
      ),
    );
    for (let i = 2; i >= 0; i--) {
      cmds[i].undo();
      expect(ctx.pixels).toEqual(states[i]);
    }
    for (let i = 0; i < 3; i++) {
      cmds[i].redo();
      expect(ctx.pixels).toEqual(states[i + 1]);
    }
  });

  it("counts only the tiles' bytes, and writes only them", () => {
    const a = blank(w, h);
    const b = a.slice();
    paint(b, 140, 65, w); // the clipped corner tile: 22 × 6
    const ctx = stubCtx(w, h, b.slice());
    const cmd = pixelCommand(
      ctx as unknown as CanvasRenderingContext2D,
      img(a, w, h),
      img(b, w, h),
      (put) => put(),
      (put) => put(),
    );
    expect(cmd.bytes).toBe(22 * 6 * 4 * 2);
    cmd.undo();
    expect(ctx.puts).toEqual([{ x: 128, y: 64, w: 22, h: 6 }]);
  });

  it("still runs the callbacks when no pixel changed, in the caller's order", () => {
    const ctx = stubCtx(w, h);
    const log: string[] = [];
    const cmd = pixelCommand(
      ctx as unknown as CanvasRenderingContext2D,
      img(blank(w, h), w, h),
      img(blank(w, h), w, h),
      (put) => {
        put();
        log.push("undo:track");
      },
      (put) => {
        log.push("redo:track");
        put();
      },
    );
    expect(cmd.bytes).toBe(0);
    cmd.undo();
    cmd.redo();
    expect(log).toEqual(["undo:track", "redo:track"]);
    expect(ctx.puts).toEqual([]);
  });

  it("keeps both whole when the sizes differ", () => {
    const ctx = stubCtx(w, h);
    const before = img(blank(10, 10), 10, 10);
    const after = img(blank(w, h), w, h);
    const cmd = pixelCommand(
      ctx as unknown as CanvasRenderingContext2D,
      before,
      after,
      (put) => put(),
      (put) => put(),
    );
    expect(cmd.bytes).toBe(10 * 10 * 4 + w * h * 4);
    cmd.undo();
    expect(ctx.puts).toEqual([{ x: 0, y: 0, w: 10, h: 10 }]);
  });
});
