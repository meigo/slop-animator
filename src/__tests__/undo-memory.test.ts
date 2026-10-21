import { describe, it, expect, beforeAll, afterAll } from "vitest";
// @ts-expect-error Node's own module; the project has no @types/node
import v8 from "node:v8";
// @ts-expect-error as above
import vm from "node:vm";
import { pixelCommand, type Command } from "../anim/history";

// A pixel undo step must keep only its changed tiles. It kept BOTH whole-canvas snapshots alive
// through a closure scope it shared (slop-paint's 2026-10-17 review): checked with a forced
// collection.

const W = 512;
const H = 256;
let gc: () => void;
const real = globalThis.ImageData;

beforeAll(() => {
  v8.setFlagsFromString("--expose-gc");
  gc = vm.runInNewContext("gc");
  // Node has no ImageData; history.ts only constructs it and reads data/width/height.
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
afterAll(() => {
  globalThis.ImageData = real;
});

const image = (data: Uint8ClampedArray) => ({ data, width: W, height: H }) as ImageData;

const collect = async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise((r) => setTimeout(r, 0));
    gc();
  }
};

describe("pixel undo steps keep only their tiles", () => {
  it("pixelCommand drops the whole-canvas snapshots", async () => {
    const ctx = { canvas: {}, putImageData() {} } as unknown as CanvasRenderingContext2D;
    const befores: WeakRef<object>[] = [];
    const afters: WeakRef<object>[] = [];
    const steps: Command[] = [];
    // In a function of its own, so no local of this one still holds the last snapshot.
    const stroke = () => {
      const before = image(new Uint8ClampedArray(W * H * 4));
      const after = image(new Uint8ClampedArray(W * H * 4));
      after.data[3] = 255;
      befores.push(new WeakRef(before));
      afters.push(new WeakRef(after));
      steps.push(
        pixelCommand(
          ctx,
          before,
          after,
          (put) => put(),
          (put) => put(),
        ),
      );
    };
    for (let i = 0; i < 5; i++) stroke();
    await collect();
    expect(steps.length).toBe(5);
    expect(befores.filter((r) => r.deref()).length).toBe(0);
    expect(afters.filter((r) => r.deref()).length).toBe(0);
  });
});
