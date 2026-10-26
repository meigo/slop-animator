import { describe, expect, it } from "vitest";
import {
  BLEND_SPACING,
  MAX_BLUR_SHARE,
  MAX_CARRY_WIDTHS,
  blendMix,
  blendStrength,
  blurPlan,
  boxBlur3,
  fromPremultiplied,
  shrinkPremultiplied,
  toPremultiplied,
} from "../core/blend-brush";

describe("blendMix", () => {
  it("picks up fresh paint every dab at Smear 0, and blurs most", () => {
    const m = blendMix(0, BLEND_SPACING);
    expect(m.keep).toBe(0);
    expect(m.blur).toBeCloseTo(MAX_BLUR_SHARE);
  });

  it("carries the load MAX_CARRY_WIDTHS widths at Smear 100, unblurred", () => {
    const m = blendMix(100, BLEND_SPACING);
    expect(m.blur).toBe(0);
    // After one carry length of dabs the load has fallen to 1/e.
    const dabs = MAX_CARRY_WIDTHS / BLEND_SPACING;
    expect(m.keep ** dabs).toBeCloseTo(Math.exp(-1));
  });

  it("carries further and blurs less as Smear rises", () => {
    let last = blendMix(0, BLEND_SPACING);
    for (const s of [10, 30, 50, 80, 100]) {
      const m = blendMix(s, BLEND_SPACING);
      expect(m.keep).toBeGreaterThan(last.keep);
      expect(m.blur).toBeLessThan(last.blur);
      last = m;
    }
  });

  it("carries as far along the page whatever the dab spacing", () => {
    const close = blendMix(60, BLEND_SPACING);
    const far = blendMix(60, BLEND_SPACING * 3);
    expect(far.keep).toBeCloseTo(close.keep ** 3);
  });

  it("clamps out-of-range settings", () => {
    expect(blendMix(-20, BLEND_SPACING)).toEqual(blendMix(0, BLEND_SPACING));
    expect(blendMix(300, BLEND_SPACING)).toEqual(blendMix(100, BLEND_SPACING));
  });
});

describe("blendStrength", () => {
  it("is Opacity for a mouse", () => {
    expect(blendStrength(60, 0, false)).toBeCloseTo(0.6);
  });

  it("follows pressure, with a floor for a light touch", () => {
    expect(blendStrength(100, 0, true)).toBeCloseTo(0.2);
    expect(blendStrength(100, 1, true)).toBeCloseTo(1);
    expect(blendStrength(50, 0.5, true)).toBeCloseTo(0.3);
  });
});

describe("the blur", () => {
  /** w×h RGBA bytes: transparent, with an opaque black bar across rows y0..y1, columns x0..x1. */
  const bar = (w: number, h: number, y0: number, y1: number, x0 = 0, x1 = w) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d[(y * w + x) * 4 + 3] = 255;
    return d;
  };
  const alphaSum = (f: ArrayLike<number>, n: number) => {
    let s = 0;
    for (let i = 3; i < n; i += 4) s += f[i];
    return s;
  };

  it("keeps all the paint when the region is padded by its reach", () => {
    const w = 40;
    const h = 60;
    const data = bar(w, h, 25, 35, 10, 30); // 3 passes of radius 3 reach 9 px
    const f = new Float32Array(w * h * 4);
    toPremultiplied(data, f);
    const before = alphaSum(f, f.length);
    boxBlur3(f, w, h, 3, new Float32Array(w * h * 4));
    expect(alphaSum(f, f.length)).toBeCloseTo(before, 0);
    // And it did spread: the bar's edge is softer.
    expect(f[(22 * w + 20) * 4 + 3]).toBeGreaterThan(0);
    expect(f[(30 * w + 20) * 4 + 3]).toBeLessThan(255);
  });

  it("leaves a flat colour as it is away from the edges", () => {
    const w = 30;
    const data = new Uint8ClampedArray(w * w * 4);
    for (let i = 0; i < data.length; i += 4) data.set([200, 100, 50, 128], i);
    const f = new Float32Array(data.length);
    toPremultiplied(data, f);
    boxBlur3(f, w, w, 2, new Float32Array(data.length));
    const out = new Uint8ClampedArray(data.length);
    fromPremultiplied(f, out);
    const mid = (15 * w + 15) * 4;
    expect([...out.slice(mid, mid + 4)]).toEqual([200, 100, 50, 128]);
  });

  it("doesn't darken paint next to transparent pixels (premultiplied)", () => {
    const w = 20;
    const data = new Uint8ClampedArray(w * w * 4);
    // Left half white and opaque, right half transparent black.
    for (let y = 0; y < w; y++)
      for (let x = 0; x < 10; x++) data.set([255, 255, 255, 255], (y * w + x) * 4);
    const f = new Float32Array(data.length);
    toPremultiplied(data, f);
    boxBlur3(f, w, w, 2, new Float32Array(data.length));
    const out = new Uint8ClampedArray(data.length);
    fromPremultiplied(f, out);
    const edge = (10 * w + 11) * 4;
    expect(out[edge + 3]).toBeGreaterThan(0);
    expect(out[edge]).toBe(255);
  });

  it("shrinks by block means, keeping the paint", () => {
    const data = bar(8, 8, 1, 3);
    const out = new Float32Array(4 * 4 * 4);
    shrinkPremultiplied(data, 8, 8, 2, out);
    expect(alphaSum(out, out.length) * 4).toBeCloseTo(alphaSum(data, data.length));
    expect(out[3]).toBeCloseTo(127.5); // the top-left block is half covered
  });

  it("plans no blur for a tiny one, and shrinks a large dab's copy", () => {
    expect(blurPlan(10, 0.05).radius).toBe(0);
    const small = blurPlan(40, 0.25);
    expect(small.k).toBe(1);
    expect(small.pad).toBe(3 * small.radius);
    const big = blurPlan(600, 0.25);
    expect(big.k).toBeGreaterThan(1);
    expect(big.size % big.k).toBe(0);
    expect(big.size).toBeGreaterThanOrEqual(600 + 2 * big.pad);
    // The reach stays near share × d either way.
    expect(big.radius * big.k * 3).toBeGreaterThan(600 * 0.25 * 0.8);
  });
});
