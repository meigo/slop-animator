import { describe, it, expect } from "vitest";
import {
  PAUSE_MS,
  STILL_PX,
  ROPE_MAX_PX,
  SMOOTH_MAX_PX,
  pathSmoothRadius,
  pauseBreaks,
  catchUpPath,
  trailTimeAt,
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

  it("collapses a resting pen's repeat points, keeping the rest's first and last", () => {
    const at = (x: number, t: number): InputPoint => ({
      x,
      y: 0,
      pressure: 0.5,
      hasPressure: true,
      timestamp: t,
    });
    const line = Array.from({ length: 40 }, (_, i) => at(i * 2, i));
    const held = [
      ...line.slice(0, 20),
      ...Array.from({ length: 1000 }, (_, k) => at(38, 20 + k)),
      ...line.slice(20),
    ];
    const out = smoothPath(held, 10);
    expect(out.length).toBe(line.length + 1); // the rest's first and last, both at x = 38
    expect(out[0]).toEqual(held[0]);
    expect(out[out.length - 1]).toEqual(held[held.length - 1]);
    // Sharp corners still sees the pause: its span survives in the kept pair's timestamps.
    expect(pauseBreaks(out, 1).length).toBe(1);
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

  const tp = (x: number, y: number, t = 0, pressure = 0.5) => ({ x, y, t, pressure });

  it("catchUpPath runs a smooth curve from the brush to the pen, pen's pace and pressure", () => {
    // straight trail, brush on it behind the pen: the catch-up is the straight run, 2 px apart
    const trail = [0, 10, 20, 30, 40].map((x, i) => tp(x, 0, i * 10, 0.2 + i * 0.1));
    const { path, from } = catchUpPath(trail, { x: 20, y: 0 }, 100);
    expect(from).toEqual(trail[2]);
    expect(path.at(-1)).toMatchObject({ x: 40, y: 0, t: 40 }); // ends exactly at the pen
    expect(path.at(-1)!.pressure).toBeCloseTo(0.6, 9);
    for (const p of path) expect(Math.abs(p.y)).toBeLessThan(1e-9);
    for (let i = 1; i < path.length; i++) {
      expect(path[i].x - path[i - 1].x).toBeCloseTo(2, 5);
      expect(path[i].t).toBeGreaterThanOrEqual(path[i - 1].t);
    }
    expect(catchUpPath(trail, { x: 40, y: 0 }, 100).path).toEqual([]);
    expect(catchUpPath([], { x: 0, y: 0 }, 100)).toEqual({ path: [], from: null });
  });

  it("catchUpPath leaves heading at the pen and arrives the way the pen moved", () => {
    // Pen came down the y axis then turned along +x; brush lags up the y axis.
    const trail = [tp(0, -40), tp(0, -20), tp(0, 0), tp(10, 0), tp(20, 0)];
    const brush = { x: 0, y: -20 };
    const { path } = catchUpPath(trail, brush, 100);
    const dir = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
    };
    const first = dir(brush, path[0]);
    const toPen = dir(brush, { x: 20, y: 0 });
    expect(first.x * toPen.x + first.y * toPen.y).toBeGreaterThan(0.99); // no kink where it joins
    const last = dir(path.at(-2)!, path.at(-1)!);
    expect(last.x).toBeGreaterThan(0.95); // arrives along +x, as the pen did
  });

  it("catchUpPath doesn't keep the hand's wobble", () => {
    // a straight stroke with 1.5 px of hand jitter; the brush on the line 30 px behind
    const trail = Array.from({ length: 21 }, (_, i) => tp(i * 3, i % 2 ? 1.5 : -1.5, i * 5));
    trail[20] = tp(60, 0, 100);
    const { path } = catchUpPath(trail, { x: 30, y: 0 }, 100);
    // The trail swings ±1.5 px; the pen's last direction (read over 12 px) still tilts a little.
    expect(Math.max(...path.map((p) => Math.abs(p.y)))).toBeLessThan(1);
  });

  it("catchUpPath searches back only so far, so a small loop's older pass isn't taken", () => {
    // A loop: out along y=0, round, and back across the start — the brush sits on the late pass.
    const trail = [tp(0, 0), tp(10, 0), tp(20, 0), tp(20, 10), tp(10, 10), tp(10, 1), tp(10, -10)];
    // The brush, on the late pass, happens to be nearer the OLD pass's (10, 0): unbounded, that
    // would be taken as where the catch-up starts; bounded, it's out of reach.
    const brush = { x: 10, y: 0.2 };
    expect(catchUpPath(trail, brush, 1000).from).toEqual(trail[1]); // the wrong pass
    expect(catchUpPath(trail, brush, 15).from).toEqual(trail[5]);
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

  /** The rope as input.ts runs it: a step per pen event; a trail point each time the pen moves
   *  STILL_PX from the last; once still for PAUSE_MS, the line catches up along the trail. */
  function trailRope(pts: { x: number; y: number; timestamp: number }[], length: number) {
    let b = { x: pts[0].x, y: pts[0].y };
    let anchor = { x: pts[0].x, y: pts[0].y, t: pts[0].timestamp, pressure: 0.5 };
    let since = pts[0].timestamp;
    const trail = [anchor];
    const out = [b];
    for (const p of pts) {
      if (Math.hypot(p.x - anchor.x, p.y - anchor.y) > STILL_PX) {
        if (p.timestamp - since >= PAUSE_MS) {
          const { path } = catchUpPath(trail, b, 2 * length + 2 * STILL_PX);
          out.push(...path);
          if (path.length) b = path[path.length - 1];
        }
        anchor = { x: p.x, y: p.y, t: p.timestamp, pressure: 0.5 };
        since = p.timestamp;
        trail.push(anchor);
      }
      b = ropeStep(b, p, length);
      out.push(b);
    }
    return out;
  }

  it("Stream reaches the corner when the pen pauses, and cuts it when it doesn't", () => {
    expect(reach(trailRope(lStroke(150), ropeLength(1)))).toBeLessThan(1.5);
    expect(reach(trailRope(lStroke(0), ropeLength(1)))).toBeGreaterThan(10);
  });

  it("catching up on a curve follows the curve — no straight chord to the pen", () => {
    // A quarter circle, radius 100, then the pen stops — the case reported: a straight line from
    // the lagging line's end to the tip. The rope rides ~8 px inside the arc; the catch-up must
    // bend with it from there to the pen, where a chord would sag well inside.
    const r = 100;
    const arc = (a: number) => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
    const pts: { x: number; y: number; timestamp: number }[] = [];
    let t = 0;
    for (let i = 0; i <= 240; i++, t += 1000 / 240)
      pts.push({ ...arc((i / 240) * (Math.PI / 2)), timestamp: t });
    const tip = pts[240];
    // the rope's state just as the pen stops, then the catch-up as input.ts does it
    let b = { x: pts[0].x, y: pts[0].y };
    const trail = [{ x: pts[0].x, y: pts[0].y, t: 0, pressure: 0.5 }];
    for (const p of pts) {
      const last = trail[trail.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > STILL_PX)
        trail.push({ x: p.x, y: p.y, t: p.timestamp, pressure: 0.5 });
      b = ropeStep(b, p, ropeLength(1));
    }
    const { path } = catchUpPath(trail, b, 2 * ropeLength(1) + 2 * STILL_PX);
    expect(path.length).toBeGreaterThan(5);
    expect(Math.hypot(path.at(-1)!.x - tip.x, path.at(-1)!.y - tip.y)).toBeLessThan(
      STILL_PX + 1e-9,
    );
    // It bends: its points stand well off the straight line from where it starts to the tip —
    // the chord the old catch-up drew (that line's own points would stand at 0).
    const [sx, sy] = [b.x, b.y];
    const [dx, dy] = [tip.x - sx, tip.y - sy];
    const len = Math.hypot(dx, dy);
    const offLine = (p: { x: number; y: number }) =>
      Math.abs((p.x - sx) * dy - (p.y - sy) * dx) / len;
    expect(Math.max(...path.map(offLine))).toBeGreaterThan(1.5);
  });
});

describe("trailTimeAt", () => {
  const trail = [
    { x: 0, y: 0, t: 0 },
    { x: 10, y: 0, t: 100 },
    { x: 20, y: 0, t: 150 },
  ];

  it("interpolates the pen's time along the trail", () => {
    expect(trailTimeAt(trail, { x: 5, y: 1 }, 100)).toBeCloseTo(50, 9);
    expect(trailTimeAt(trail, { x: 15, y: -2 }, 100)).toBeCloseTo(125, 9);
    expect(trailTimeAt(trail, { x: 20, y: 0 }, 100)).toBe(150);
    expect(trailTimeAt([], { x: 0, y: 0 }, 100)).toBeNull();
  });

  it("puts the pen's slowdown where it happened, not a string's length early", () => {
    // The pen cruises at 1 px/ms, then slows over its last 40 px to a stop — the reported case:
    // stamped with the event's time, the lagging line slowed a string's length BEFORE the end,
    // and Ink's Pool swelled a knot there.
    const pen: { x: number; y: number; timestamp: number }[] = [];
    let x = 0;
    let t = 0;
    while (x < 260) pen.push({ x: (x += 1), y: 0, timestamp: (t += 1) }); // 1 px/ms
    while (x < 300) pen.push({ x: (x += 0.2), y: 0, timestamp: (t += 1) }); // 0.2 px/ms
    const L = ropeLength(1);
    let b = { x: 0, y: 0 };
    let anchor = { x: 0, y: 0, t: 0 };
    const trail = [anchor];
    const line: { x: number; t: number; tNow: number }[] = [];
    for (const p of pen) {
      if (Math.abs(p.x - anchor.x) > STILL_PX)
        trail.push((anchor = { x: p.x, y: 0, t: p.timestamp }));
      const next = ropeStep(b, p, L);
      if (next === b) continue;
      b = next;
      line.push({ x: b.x, t: trailTimeAt(trail, b, 2 * L + 2 * STILL_PX)!, tNow: p.timestamp });
    }
    // Speed over the line's stretch well before the pen's slowdown (x 100–200).
    const speed = (key: "t" | "tNow") => {
      const seg = line.filter((q) => q.x >= 100 && q.x <= 200);
      return (seg.at(-1)!.x - seg[0].x) / (seg.at(-1)![key] - seg[0][key]);
    };
    expect(speed("t")).toBeCloseTo(1, 1); // the pen's own 1 px/ms
    // Where the line reaches 220–260 the PEN was already crawling: stamped "now", that stretch
    // read as slow — the knot. Stamped with the pen's time, it's still cruising.
    const late = line.filter((q) => q.x >= 222 && q.x <= 258);
    const v = (key: "t" | "tNow") =>
      (late.at(-1)!.x - late[0].x) / (late.at(-1)![key] - late[0][key]);
    expect(v("t")).toBeGreaterThan(0.9);
    expect(v("tNow")).toBeLessThan(0.3);
  });
});
