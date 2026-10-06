import { describe, it, expect } from "vitest";
import type { BrushSettings } from "../core/brush";
import { drawCalligraphyStroke } from "../core/calligraphy-brush";
import { noise2, wobbleAmp, wobbleOutline, wobbleScale } from "../core/wobble";

// slop-paint 4d24cde's wobble.test.ts; its holdRestPressure half is already in
// stroke-smoothing.test.ts (ported with the resting-tip fix, a952778).

describe("wobble", () => {
  it("noise2 is smooth, in 0–1, and the same for the same key", () => {
    for (let i = 0; i < 200; i++) {
      const v = noise2(7, i * 0.37, i * 0.11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(noise2(7, i * 0.37, i * 0.11)).toBe(v);
      expect(Math.abs(noise2(7, i * 0.37 + 0.01, i * 0.11) - v)).toBeLessThan(0.05);
    }
    expect(noise2(7, 3.5, 2.5)).not.toBe(noise2(8, 3.5, 2.5));
  });

  it("wobble moves a point by its page position alone, at most the amplitude", () => {
    const pts = [
      [10, 20, 0.5],
      [40.5, 33, 0.5],
    ];
    const a = wobbleOutline(pts, 3, 4, 10);
    // the same point in another outline lands in the same place
    const b = wobbleOutline([[0, 0, 0.5], ...pts.slice(1)], 3, 4, 10);
    expect(b[1]).toEqual(a[1]);
    for (let i = 0; i < pts.length; i++) {
      expect(Math.hypot(a[i][0] - pts[i][0], a[i][1] - pts[i][1])).toBeLessThanOrEqual(
        4 * Math.SQRT2,
      );
    }
    expect(wobbleOutline(pts, 3, 0, 10)).toBe(pts);
    expect(wobbleAmp(100, 0)).toBe(0);
    expect(wobbleAmp(100, 100)).toBeCloseTo(20);
  });

  it("without the fine octave it moves as far at most, and differs from with it", () => {
    const pts = Array.from({ length: 60 }, (_, i) => [i * 1.7, 40 + i * 0.9]);
    const soft = wobbleOutline(pts, 5, 4, 10, false);
    const both = wobbleOutline(pts, 5, 4, 10);
    let moved = 0;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(soft[i][0] - pts[i][0], soft[i][1] - pts[i][1]);
      expect(d).toBeLessThanOrEqual(4 * Math.SQRT2);
      moved = Math.max(moved, d);
    }
    expect(moved).toBeGreaterThan(1);
    expect(soft).not.toEqual(both);
    // less jagged: the second differences of the displacement are smaller
    const jag = (out: number[][]) => {
      let sum = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        for (const k of [0, 1]) {
          const d = (j: number) => out[j][k] - pts[j][k];
          sum += Math.abs(d(i - 1) - 2 * d(i) + d(i + 1));
        }
      }
      return sum;
    };
    expect(jag(soft)).toBeLessThan(jag(both) * 0.7);
  });

  it("bumps are a third of the width across, at least 3 px", () => {
    expect(wobbleScale(30)).toBeCloseTo(10.5);
    expect(wobbleScale(2)).toBe(3);
  });
});

describe("Calligraphy wobble and the freeze", () => {
  /** Every ring the engine emits for `from`–`to`, instead of rasterising it. */
  function rings(points: unknown[], nibWobble: number, from = 0, to = Infinity) {
    const out: string[] = [];
    let cur: number[][] = [];
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      fill() {},
      moveTo: (x: number, y: number) => (cur = [[x, y]]),
      lineTo: (x: number, y: number) => cur.push([x, y]),
      closePath: () => out.push(JSON.stringify(cur)),
    } as unknown as CanvasRenderingContext2D;
    const settings = {
      size: 12,
      nibAngle: 30,
      nibFlatness: 0.6,
      nibWobble,
      opacity: 100,
      color: "#000",
      isEraser: false,
    } as BrushSettings;
    drawCalligraphyStroke(ctx, points as never, settings, 3, from, to);
    return out;
  }
  const pts = Array.from({ length: 400 }, (_, i) => ({
    x: 50 + i * 1.5,
    y: 120 + 50 * Math.sin(i / 25),
    pressure: 0.3 + 0.6 * Math.abs(Math.sin(i / 40)),
    hasPressure: true,
    timestamp: 1000 + i * 8,
  }));

  it("a frozen range draws the very pieces a full redraw draws there", () => {
    const whole = rings(pts, 60);
    // the freeze's split: a settled part, then the rest from 8 points early (FREEZE_OVERLAP)
    const head = rings(pts.slice(0, 300), 60, 0, 200);
    const tail = rings(pts, 60, 192);
    for (const r of head) expect(whole).toContain(r);
    for (const r of tail) expect(whole).toContain(r);
    expect(new Set([...head, ...tail])).toEqual(new Set(whole));
  });

  it("moves the ribbon at Wobble > 0 and leaves it alone at 0", () => {
    expect(rings(pts, 60)).not.toEqual(rings(pts, 0));
  });
});
