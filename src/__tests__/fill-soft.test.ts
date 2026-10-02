import { describe, it, expect } from "vitest";
import {
  colourDistance,
  expandedCoverage,
  softCoverage,
  softStepIndex,
  SOFT_RANGE_PER_PX,
  SOFT_STEPS,
  floodFill,
  fillRegionBehind,
} from "../core/fill";
import { distanceToMask } from "../core/mask-ops";

const row = (bits: number[]) => Uint8Array.from(bits);
const cover = (dist: number[], region: number[], tol: number, soft: number) => [
  ...softCoverage(row(dist), dist.length, 1, row(region), tol, soft),
];

describe("softCoverage", () => {
  it("fades into a line's soft edge by how faint it is there", () => {
    // region | line edge getting darker | ridge | far side | empty
    const c = cover([0, 0, 40, 96, 200, 120, 0], [1, 1, 0, 0, 0, 0, 0], 32, 1);
    expect(c.slice(0, 2)).toEqual([255, 255]);
    expect(c[2]).toBe(Math.round(255 * (1 - 8 / SOFT_RANGE_PER_PX))); // faint: mostly filled
    expect(c[3]).toBe(0); // at tol + range: none
    expect(c.slice(4)).toEqual([0, 0, 0]);
  });

  it("follows sub-pixel position: a fainter edge pixel gets more fill", () => {
    const a = cover([0, 40], [1, 0], 32, 1)[1];
    const b = cover([0, 70], [1, 0], 32, 1)[1];
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0);
  });

  it("never passes the line's darkest pixel nor crosses a break", () => {
    // Falling side past the ridge is out, even when faint.
    expect(cover([0, 60, 50, 40], [1, 0, 0, 0], 32, 2).slice(2)).toEqual([0, 0]);
    expect(cover([0, 0, 0], [1, 0, 0], 32, 2)).toEqual([255, 0, 0]);
  });

  it("is the region alone at Soft 0, and reaches further at a higher Soft", () => {
    expect(cover([0, 40, 60], [1, 0, 0], 32, 0)).toEqual([255, 0, 0]);
    expect(cover([0, 40, 120], [1, 0, 0], 32, 1)[2]).toBe(0);
    expect(cover([0, 40, 120], [1, 0, 0], 32, 2)[2]).toBeGreaterThan(0);
  });
});

describe("colourDistance", () => {
  it("uses alpha alone from an empty seed, every channel otherwise", () => {
    const data = Uint8ClampedArray.from([255, 0, 0, 100, 0, 0, 0, 0]);
    expect([...colourDistance(data, 2, 1, { r: 0, g: 0, b: 0, a: 0 })]).toEqual([100, 0]);
    expect([...colourDistance(data, 2, 1, { r: 0, g: 0, b: 0, a: 255 })]).toEqual([255, 255]);
  });
});

describe("expandedCoverage / distanceToMask", () => {
  it("measures true distance to the mask", () => {
    const m = new Uint8Array(25);
    m[12] = 1; // the centre of 5×5
    const d = distanceToMask(m, 5, 5);
    expect(d[12]).toBe(0);
    expect(d[13]).toBeCloseTo(1);
    expect(d[18]).toBeCloseTo(Math.SQRT2);
    expect(d[24]).toBeCloseTo(2 * Math.SQRT2);
    expect(distanceToMask(new Uint8Array(4), 2, 2)[0]).toBe(Infinity);
  });

  it("grows solid to Expand px, then fades over the feather", () => {
    const m = row([1, 0, 0, 0, 0, 0, 0]);
    // Expand 2, Soft 0.5 (feather 1 px): solid to 2, half at 2.5 — pixel 3 is 3 away: 0.
    expect([...expandedCoverage(m, 7, 1, 2, 0.5)]).toEqual([255, 255, 255, 0, 0, 0, 0]);
    // Soft 1 (feather 2 px): pixel 3 → (2 + 2 − 3) / 2 = 0.5, pixel 4 → 0.
    expect([...expandedCoverage(m, 7, 1, 2, 1)]).toEqual([255, 255, 255, 128, 0, 0, 0]);
  });

  it("is the old whole-pixel dilation at Soft 0", () => {
    const m = row([1, 0, 0, 0]);
    expect([...expandedCoverage(m, 4, 1, 2, 0)]).toEqual([255, 255, 255, 0]);
  });
});

describe("SOFT_STEPS / softStepIndex", () => {
  it("snaps a value to the nearest stop, quarters up to 2 then coarser to 8", () => {
    expect(SOFT_STEPS[softStepIndex(0.5)]).toBe(0.5);
    expect(SOFT_STEPS[softStepIndex(2.2)]).toBe(2);
    expect(SOFT_STEPS[softStepIndex(7)]).toBe(6); // a tie goes to the lower stop
    expect(SOFT_STEPS[softStepIndex(99)]).toBe(8);
    expect(softStepIndex(0)).toBe(0);
  });
});

// ---- This app's wiring (2026-10-02): the bucket and Fill enclosed take Soft through floodFill and
// fillRegionBehind. A fake 2D context: getImageData/putImageData on one buffer, and a temp canvas
// whose drawImage composites BEHIND the target (destination-over, non-premultiplied), as the
// browser would.
type Px = [number, number, number, number];
function fakeCtx(w: number, h: number, init: (i: number) => Px) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(init(i), i * 4);
  let temp: Uint8ClampedArray | null = null;
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({
      width: w,
      height: h,
      getContext: () => ({
        createImageData: (cw: number, ch: number) => ({ data: new Uint8ClampedArray(cw * ch * 4) }),
        putImageData: (img: { data: Uint8ClampedArray }) => (temp = img.data),
      }),
    }),
  };
  const ctx = {
    canvas: { width: w, height: h },
    getImageData: () => ({ data, width: w, height: h }),
    putImageData: () => {},
    save: () => {},
    restore: () => {},
    resetTransform: () => {},
    drawImage: () => {
      for (let i = 0; i < w * h; i++) {
        const p = i * 4;
        const sa = temp![p + 3] / 255;
        const da = data[p + 3] / 255;
        const oa = da + sa * (1 - da);
        if (oa <= 0) continue;
        for (let k = 0; k < 3; k++)
          data[p + k] = Math.round((data[p + k] * da + temp![p + k] * sa * (1 - da)) / oa);
        data[p + 3] = Math.round(oa * 255);
      }
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, data };
}
const at = (d: Uint8ClampedArray, i: number): Px => [
  d[i * 4],
  d[i * 4 + 1],
  d[i * 4 + 2],
  d[i * 4 + 3],
];
const RED = { r: 255, g: 0, b: 0, a: 255 };
// empty empty | a faint line edge (alpha 60, a wall at tolerance 32) | the line's solid middle
const edge = (i: number): Px => (i < 2 ? [0, 0, 0, 0] : i === 2 ? [0, 0, 0, 60] : [0, 0, 0, 255]);

describe("floodFill with Soft", () => {
  it("Soft 0 leaves a line's soft edge alone (the old hard edge)", () => {
    const { ctx, data } = fakeCtx(4, 1, edge);
    floodFill(ctx, 0, 0, RED, { tolerance: 32, expand: 0, softEdge: 0 });
    expect(at(data, 1)).toEqual([255, 0, 0, 255]);
    expect(at(data, 2)).toEqual([0, 0, 0, 60]);
  });

  it("Soft fills BEHIND the line's soft edge, never over its middle", () => {
    const { ctx, data } = fakeCtx(4, 1, edge);
    floodFill(ctx, 0, 0, RED, { tolerance: 32, expand: 0, softEdge: 1 });
    const [r, , , a] = at(data, 2);
    expect(a).toBeGreaterThan(60); // the fill shows behind it
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(255); // the line's black still on top
    expect(at(data, 3)).toEqual([0, 0, 0, 255]);
  });

  it("with Expand, still recolours a tapped painted area, the feathered ring behind", () => {
    const blue = { r: 0, g: 0, b: 255, a: 255 };
    const red: Px = [255, 0, 0, 255];
    const { ctx, data } = fakeCtx(7, 1, (i) =>
      i < 2 ? red : i === 2 ? [0, 0, 0, 255] : [0, 0, 0, 0],
    );
    floodFill(ctx, 0, 0, blue, { tolerance: 32, expand: 2, softEdge: 1 });
    expect(at(data, 0)).toEqual([0, 0, 255, 255]);
    expect(at(data, 1)).toEqual([0, 0, 255, 255]);
    expect(at(data, 2)).toEqual([0, 0, 0, 255]); // the line stays on top
    expect(at(data, 3)).toEqual([0, 0, 255, 255]); // 2 px from the region: solid
    expect(at(data, 4)[3]).toBe(128); // 3 px: half way through the 2 px feather
    expect(at(data, 5)).toEqual([0, 0, 0, 0]);
  });
});

describe("fillRegionBehind with Soft and Expand", () => {
  it("Soft 0, no Expand: the region alone, behind", () => {
    const { ctx, data } = fakeCtx(4, 1, edge);
    fillRegionBehind(ctx, row([1, 1, 0, 0]), RED, 0, 0);
    expect(at(data, 1)).toEqual([255, 0, 0, 255]);
    expect(at(data, 2)).toEqual([0, 0, 0, 60]);
  });

  it("Soft fades into the line's soft edge behind it", () => {
    const { ctx, data } = fakeCtx(4, 1, edge);
    fillRegionBehind(ctx, row([1, 1, 0, 0]), RED, 1, 0);
    expect(at(data, 2)[3]).toBeGreaterThan(60);
    expect(at(data, 3)).toEqual([0, 0, 0, 255]);
  });

  it("grows the region by Expand with a feathered edge", () => {
    const { ctx, data } = fakeCtx(7, 1, () => [0, 0, 0, 0]);
    fillRegionBehind(ctx, row([1, 0, 0, 0, 0, 0, 0]), RED, 1, 2);
    expect([...data].filter((_, k) => k % 4 === 3)).toEqual([255, 255, 255, 128, 0, 0, 0]);
  });
});
