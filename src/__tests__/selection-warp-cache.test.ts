import { describe, it, expect, beforeEach } from "vitest";
import { Selection } from "../core/selection";

// Review 2026-10-17 #28: an open Deform / Distort / Mesh lift re-rendered the whole warped bitmap
// (two clipped full-bitmap draws per grid cell) on every marching-ants frame, though only the ants
// moved. The warped picture is now cached and re-rendered only when the grid, the bitmap or the
// view changes.

let bitmapDraws = 0;
const pixels = { width: 40, height: 40 } as unknown as HTMLCanvasElement;
let viewE = 0;

/** A 2D context that does nothing but count how often the lifted bitmap is drawn. */
function ctx(canvas: { width: number; height: number }): unknown {
  return new Proxy(
    {},
    {
      get: (_t, k) => {
        if (k === "canvas") return canvas;
        if (k === "getTransform") return () => ({ a: 1, b: 0, c: 0, d: 1, e: viewE, f: 0 });
        if (k === "drawImage")
          return (img: unknown) => {
            if (img === pixels) bitmapDraws++;
          };
        return () => {};
      },
      set: () => true,
    },
  );
}
function canvas(w: number, h: number) {
  const c = { width: w, height: h, getContext: () => ctx(c) };
  return c;
}

let frames: (() => void)[] = [];
beforeEach(() => {
  bitmapDraws = 0;
  viewE = 0;
  frames = [];
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => frames.push(() => cb(0));
  globalThis.cancelAnimationFrame = () => {};
  (globalThis as { Path2D?: unknown }).Path2D = class {
    moveTo() {}
    lineTo() {}
    closePath() {}
  };
  (globalThis as { document?: unknown }).document = {
    createElement: () => canvas(0, 0),
  };
});
/** Run the queued marching-ants frames, `n` times. */
function tick(n: number) {
  for (let i = 0; i < n; i++) {
    const f = frames.splice(0);
    f.forEach((cb) => cb());
  }
}

function warp(): Selection {
  const s = new Selection(canvas(200, 200) as unknown as HTMLCanvasElement);
  s.rect = { x: 10, y: 10, w: 40, h: 40 };
  s.beginTransform(pixels);
  s.beginWarp(3, 3);
  return s;
}

describe("warped float cache", () => {
  it("idle frames do not re-render the warped bitmap", () => {
    warp();
    const after = bitmapDraws;
    expect(after).toBeGreaterThan(0); // entering the warp drew it
    tick(5);
    expect(bitmapDraws).toBe(after);
  });

  it("a grid drag re-renders it", () => {
    const s = warp();
    tick(1);
    const before = bitmapDraws;
    s.startDrag("move", 30, 30);
    s.updateDrag(35, 30);
    expect(bitmapDraws).toBeGreaterThan(before);
  });

  it("a view change (pan or zoom) re-renders it", () => {
    warp();
    tick(1);
    const before = bitmapDraws;
    viewE = 12;
    tick(1);
    expect(bitmapDraws).toBeGreaterThan(before);
  });

  it("a denser grid re-renders it", () => {
    const s = warp();
    tick(1);
    const before = bitmapDraws;
    s.densifyWarp(5, 5);
    expect(bitmapDraws).toBeGreaterThan(before);
  });
});
