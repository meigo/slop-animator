import { describe, it, expect } from "vitest";
import {
  CATCH_UP_MS,
  PAUSE_MS,
  STILL_PX,
  ROPE_MAX_PX,
  SMOOTH_MAX_PX,
  pathSmoothRadius,
  pauseBreaks,
  ropeCatchUp,
  ropeLength,
  ropeStep,
  smoothPath,
} from "../core/stroke-smoothing";
import type { InputPoint } from "../core/input";

/** 300 px/s along x with a 3 px, 6 Hz hand wobble, sampled at `hz` (the old test case). */
function wobble(hz: number, seconds = 1.5) {
  return Array.from({ length: Math.round(hz * seconds) }, (_, i) => {
    const t = i / hz;
    return {
      x: 300 * t,
      y: 3 * Math.sin(2 * Math.PI * 6 * t),
      pressure: 0.5,
      hasPressure: true,
      timestamp: t,
    };
  });
}
const maxAbsY = (pts: { x: number; y: number }[]) => Math.max(...pts.map((p) => Math.abs(p.y)));

describe("ropeLength", () => {
  it("is 0 at 0, gentle at half, full at the top", () => {
    expect(ropeLength(0)).toBe(0);
    expect(ropeLength(0.5)).toBe(ROPE_MAX_PX / 4);
    expect(ropeLength(1)).toBe(ROPE_MAX_PX);
    expect(ropeLength(7)).toBe(ROPE_MAX_PX);
  });
});

describe("ropeStep", () => {
  it("stays put while the string is slack", () => {
    const b = { x: 0, y: 0 };
    expect(ropeStep(b, { x: 3, y: 4 }, 5)).toBe(b);
  });

  it("is pulled to exactly the string's length behind", () => {
    const b = ropeStep({ x: 0, y: 0 }, { x: 10, y: 0 }, 4);
    expect(b).toEqual({ x: 6, y: 0 });
  });

  it("follows the pen exactly with no string", () => {
    expect(ropeStep({ x: 0, y: 0 }, { x: 2, y: 1 }, 0)).toEqual({ x: 2, y: 1 });
  });

  it("takes out most of a hand wobble, whatever the event rate", () => {
    for (const hz of [60, 240]) {
      let b = { x: 0, y: 0 };
      const trail = wobble(hz).map((p) => (b = ropeStep(b, p, ropeLength(1))));
      // after the string has gone taut
      expect(maxAbsY(trail.slice(Math.round(hz * 0.5)))).toBeLessThan(0.6);
    }
  });
});

describe("pathSmoothRadius", () => {
  it("is a screen distance: bigger in document px when zoomed out", () => {
    expect(pathSmoothRadius(100, 1)).toBe(SMOOTH_MAX_PX);
    expect(pathSmoothRadius(100, 0.5)).toBe(SMOOTH_MAX_PX * 2);
    expect(pathSmoothRadius(50, 2)).toBe(SMOOTH_MAX_PX / 4);
    expect(pathSmoothRadius(0, 1)).toBe(0);
  });
});

describe("smoothPath", () => {
  it("does nothing at radius 0", () => {
    const pts = wobble(120);
    expect(smoothPath(pts, 0)).toBe(pts);
  });

  it("keeps both ends exactly", () => {
    const pts = wobble(240);
    const out = smoothPath(pts, SMOOTH_MAX_PX);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("rounds out a wobble away from the ends", () => {
    const out = smoothPath(wobble(240), SMOOTH_MAX_PX);
    const middle = out.filter((p) => p.x > 60 && p.x < 390);
    expect(maxAbsY(middle)).toBeLessThan(0.75);
  });

  it("leaves a straight, evenly drawn line where it is", () => {
    const line = Array.from({ length: 50 }, (_, i) => ({
      x: i * 3,
      y: 2 * i,
      pressure: 0.4,
      hasPressure: true,
      timestamp: i,
    }));
    smoothPath(line, 20).forEach((p, i) => {
      expect(p.x).toBeCloseTo(line[i].x, 9);
      expect(p.y).toBeCloseTo(line[i].y, 9);
      expect(p.pressure).toBeCloseTo(0.4, 9);
    });
  });

  it("isn't thrown by uneven spacing (a slow stretch, then a fast one)", () => {
    const pts = [
      ...Array.from({ length: 40 }, (_, i) => ({
        x: i * 0.25,
        y: 0,
        pressure: 1,
        hasPressure: true,
        timestamp: i,
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        x: 10 + i * 5,
        y: 0,
        pressure: 1,
        hasPressure: true,
        timestamp: 40 + i,
      })),
    ];
    const out = smoothPath(pts, 10);
    for (let i = 1; i < out.length; i++) expect(out[i].x).toBeGreaterThanOrEqual(out[i - 1].x);
  });
});

describe("corners", () => {
  /** An L: right 300 px, then down 300 px, `pauseMs` still at the corner (300 px/s, 240 Hz). */
  function lStroke(pauseMs: number) {
    const pts: InputPoint[] = [];
    let t = 0;
    for (let i = 0; i <= 240; i++, t += 1000 / 240)
      pts.push({ x: i * 1.25, y: 0, pressure: 0.5, hasPressure: true, timestamp: t });
    for (let k = 0; k < (pauseMs * 240) / 1000; k++, t += 1000 / 240)
      pts.push({ x: 300 + (k % 2) * 0.5, y: 0, pressure: 0.5, hasPressure: true, timestamp: t }); // a trembling hold
    for (let i = 1; i <= 240; i++, t += 1000 / 240)
      pts.push({ x: 300, y: i * 1.25, pressure: 0.5, hasPressure: true, timestamp: t });
    return pts;
  }
  /** How close the path comes to the corner (300, 0). */
  const reach = (pts: { x: number; y: number }[]) =>
    Math.min(...pts.map((p) => Math.hypot(p.x - 300, p.y)));

  it("ropeCatchUp glides to the pen and snaps when close", () => {
    const pen = { x: 10, y: 0 };
    const a = ropeCatchUp({ x: 0, y: 0 }, pen, CATCH_UP_MS);
    expect(a.x).toBeCloseTo(10 * (1 - Math.exp(-1)), 6);
    expect(ropeCatchUp({ x: 9.7, y: 0 }, pen, 1)).toBe(pen);
    const still = { x: 0, y: 0 };
    expect(ropeCatchUp(still, pen, 0)).toBe(still);
  });

  it("pauseBreaks finds a hold, and a still gap with no events between", () => {
    expect(pauseBreaks(lStroke(150), 3).length).toBe(1);
    expect(pauseBreaks(lStroke(0), 3)).toEqual([]);
    const gap = [
      { x: 0, y: 0, pressure: 1, hasPressure: true, timestamp: 0 },
      { x: 5, y: 0, pressure: 1, hasPressure: true, timestamp: 4 },
      { x: 6, y: 0, pressure: 1, hasPressure: true, timestamp: 200 }, // a mouse sends nothing while still
      { x: 6, y: 5, pressure: 1, hasPressure: true, timestamp: 204 },
    ];
    expect(pauseBreaks(gap, 3)).toEqual([2]);
  });

  it("Smooth keeps a paused corner only with Sharp corners, and rounds an unpaused one", () => {
    const r = SMOOTH_MAX_PX;
    expect(reach(smoothPath(lStroke(150), r, true))).toBeLessThan(1);
    expect(reach(smoothPath(lStroke(0), r, true))).toBeGreaterThan(5);
    // Off (the default): rounded even where the pen paused — a little tighter than without the
    // pause, as the points bunched at the corner weigh in, but not pinned to it.
    const off = reach(smoothPath(lStroke(150), r));
    expect(off).toBeGreaterThan(reach(smoothPath(lStroke(150), r, true)) + 1);
    expect(off).toBeLessThan(reach(smoothPath(lStroke(0), r)));
  });

  it("Stream reaches the corner when the pen pauses, and cuts it when it doesn't", () => {
    // The rope as input.ts runs it: a step per pen event, catch-up once still for PAUSE_MS.
    function trail(pts: ReturnType<typeof lStroke>) {
      let b = { x: pts[0].x, y: pts[0].y };
      let anchor = b;
      let since = 0;
      const out = [b];
      for (const p of pts) {
        if (Math.hypot(p.x - anchor.x, p.y - anchor.y) > STILL_PX) {
          anchor = p;
          since = p.timestamp;
        }
        b = ropeStep(b, p, ropeLength(1));
        if (p.timestamp - since >= PAUSE_MS) b = ropeCatchUp(b, p, 1000 / 240);
        out.push(b);
      }
      return out;
    }
    expect(reach(trail(lStroke(150)))).toBeLessThan(1.5);
    expect(reach(trail(lStroke(0)))).toBeGreaterThan(10);
  });
});
