import { describe, it, expect } from "vitest";
import {
  colourDistance,
  expandedCoverage,
  ridgeCoverage,
  softStepIndex,
  SOFT_STEPS,
  UNDER_LINE_MAX_PX,
  floodFill,
  fillRegionBehind,
} from "../core/fill";
import { distanceToMask } from "../core/mask-ops";

const row = (bits: number[]) => Uint8Array.from(bits);
/** One row: `region` 1s, then the line's strengths, then empty space beyond. */
const across = (line: number[], soft = 1, inside = 6, beyond = 10) => {
  const dist = [...Array(inside).fill(0), ...line, ...Array(beyond).fill(0)];
  const region = [...Array(inside).fill(1), ...Array(line.length + beyond).fill(0)];
  const c = [...ridgeCoverage(row(dist), dist.length, 1, row(region), 32, soft)];
  return c.slice(inside, inside + line.length + beyond);
};

// slop-paint c672ad3's tests, unchanged.
describe("ridgeCoverage", () => {
  it("runs under the line to its middle and stops there", () => {
    const c = across([60, 140, 230, 255, 255, 255, 230, 140, 60]);
    expect(c[0]).toBeGreaterThan(0); // the inner edge gets fill
    expect(c[2]).toBeGreaterThan(0);
    expect(c.slice(6)).toEqual(Array(c.length - 6).fill(0)); // the outer side: none
  });

  it("isn't stopped by grain: every pixel of the inner half gets some", () => {
    // A light pencil line whose strength goes up and down from pixel to pixel.
    const c = across([50, 110, 40, 130, 60, 140, 120, 140, 60, 130, 40, 110, 50]);
    for (let i = 0; i < 5; i++) expect(c[i]).toBeGreaterThan(0);
    expect(c.slice(9)).toEqual(Array(c.length - 9).fill(0));
  });

  it("fades toward 1 − the line's strongest value: a light line keeps more fill than a solid one", () => {
    const light = across([40, 70, 100, 100, 100, 70, 40]);
    const solid = across([100, 200, 255, 255, 255, 200, 100]);
    expect(light[2]).toBeGreaterThan(solid[2]);
    expect(light[0]).toBeGreaterThanOrEqual(light[2]); // fading from the region outward
  });

  it("is the region alone at Soft 0, and a softer cut at a higher Soft", () => {
    expect(across([60, 140, 230, 140, 60], 0)).toEqual(Array(15).fill(0));
    const hard = across([60, 140, 230, 255, 230, 140, 60], 0.25);
    const soft = across([60, 140, 230, 255, 230, 140, 60], 4);
    const last = (c: number[]) => c.findLastIndex((v) => v > 0);
    expect(last(soft)).toBeGreaterThanOrEqual(last(hard));
    // the soft cut steps down more gently at its end
    const step = (c: number[]) => c[last(c) - 1] - c[last(c)];
    expect(step(soft)).toBeLessThan(step(hard));
  });

  it("fills all of a line with no empty space beyond it within reach, and nothing out of reach", () => {
    // The region, then a solid band wider than the reach: fill under it up to the reach only.
    const band = Array(UNDER_LINE_MAX_PX + 8).fill(255);
    const c = across(band, 1, 4, 0);
    expect(c[0]).toBeGreaterThan(0);
    expect(c[UNDER_LINE_MAX_PX - 1]).toBeGreaterThan(0);
    expect(c[UNDER_LINE_MAX_PX + 2]).toBe(0);
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

// 2026-10-04 (ridgeCoverage port): a light grainy line — alpha up and down pixel to pixel, some
// grain holes fully empty — between an empty area and empty space beyond.
const GRAIN = [50, 110, 0, 130, 60, 140, 120, 140, 60, 130, 0, 110, 50];
const grainy = (i: number): Px =>
  i >= 6 && i < 6 + GRAIN.length ? [0, 0, 0, GRAIN[i - 6]] : [0, 0, 0, 0];
const GW = 6 + GRAIN.length + 10;

describe("floodFill with Soft, under a grainy line (ridgeCoverage)", () => {
  it("fills behind every pixel of the line's inner half, grain holes too, and nothing beyond", () => {
    const { ctx, data } = fakeCtx(GW, 1, grainy);
    floodFill(ctx, 0, 0, RED, { tolerance: 32, expand: 0, softEdge: 1 });
    for (let i = 6; i < 11; i++) expect(at(data, i)[0]).toBeGreaterThan(0);
    expect(at(data, 8)[3]).toBeGreaterThan(0); // the grain hole is not a white blotch
    for (let i = 6 + 9; i < GW; i++) expect(at(data, i)).toEqual(grainy(i));
  });

  it("recolouring a painted area leaves the empty space around it empty", () => {
    // A red shape, a black line, then empty layer: tap the red with blue at Soft 1.
    const blue = { r: 0, g: 0, b: 255, a: 255 };
    const init = (i: number): Px =>
      i < 4 ? [255, 0, 0, 255] : i === 4 ? [0, 0, 0, 255] : [0, 0, 0, 0];
    for (const expand of [0, 2]) {
      const { ctx, data } = fakeCtx(12, 1, init);
      floodFill(ctx, 0, 0, blue, { tolerance: 32, expand, softEdge: 1 });
      expect(at(data, 0)).toEqual([0, 0, 255, 255]);
      expect(at(data, 4)).toEqual([0, 0, 0, 255]);
      for (let i = expand ? 7 : 5; i < 12; i++) expect(at(data, i)).toEqual([0, 0, 0, 0]);
    }
  });

  it("with Expand, takes whichever reaches further: under the grainy line's inner half too", () => {
    const { ctx, data } = fakeCtx(GW, 1, grainy);
    floodFill(ctx, 0, 0, RED, { tolerance: 32, expand: 1, softEdge: 1 });
    for (let i = 6; i < 11; i++) expect(at(data, i)[0]).toBeGreaterThan(0);
    for (let i = 6 + 9; i < GW; i++) expect(at(data, i)).toEqual(grainy(i));
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

  it("runs under a grainy line to its middle, as the bucket", () => {
    const { ctx, data } = fakeCtx(GW, 1, grainy);
    const region = Uint8Array.from({ length: GW }, (_, i) => (i < 6 ? 1 : 0));
    fillRegionBehind(ctx, region, RED, 1, 0);
    for (let i = 6; i < 11; i++) expect(at(data, i)[0]).toBeGreaterThan(0);
    for (let i = 6 + 9; i < GW; i++) expect(at(data, i)).toEqual(grainy(i));
  });

  it("grows the region by Expand with a feathered edge", () => {
    const { ctx, data } = fakeCtx(7, 1, () => [0, 0, 0, 0]);
    fillRegionBehind(ctx, row([1, 0, 0, 0, 0, 0, 0]), RED, 1, 2);
    expect([...data].filter((_, k) => k % 4 === 3)).toEqual([255, 255, 255, 128, 0, 0, 0]);
  });
});
