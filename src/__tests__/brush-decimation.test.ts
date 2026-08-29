import { describe, it, expect } from "vitest";
import getStroke from "perfect-freehand";
import { decimationSmoothing, widthRange } from "../core/brush";

/**
 * perfect-freehand's `smoothing` is a DECIMATION DISTANCE: an outline point is dropped
 * unless it is farther than `pfSize * smoothing` from the last kept one. pfSize is derived
 * from the stroke's MAXIMUM radius, so where the stroke is thin the spacing can exceed the
 * stroke's own width — both walls then bridge the thin run with a chord, the chords cross,
 * and the nonzero fill leaves a hole (CLAUDE.md 2026-08-29). Capping the distance at the
 * thinnest width the stroke actually reaches removed 89% of the gap cases in the sweep.
 */
describe("decimationSmoothing", () => {
  it("passes the artist's setting through when the stroke never gets thin", () => {
    // constant width: minWidth == 2 * pfSize, so the cap can never bite
    const { max } = widthRange(40, 1);
    expect(decimationSmoothing(0.9, max, max / 2)).toBeCloseTo(0.9, 6);
    expect(decimationSmoothing(0.5, max, max / 2)).toBeCloseTo(0.5, 6);
  });

  it("caps the spacing at the thinnest width the stroke reaches", () => {
    // size 40, Press 8x -> max 320, pfSize 160; a thin section only 20px wide
    const s = decimationSmoothing(0.9, 20, 160);
    expect(s * 160).toBeLessThanOrEqual(20 + 1e-9);
    expect(s).toBeCloseTo(20 / 160, 6);
  });

  it("only ever reduces — it can never smooth more than asked", () => {
    for (const user of [0, 0.1, 0.5, 0.9, 1]) {
      for (const minW of [0.5, 2, 20, 400]) {
        for (const pfSize of [1, 4, 80, 160]) {
          expect(decimationSmoothing(user, minW, pfSize)).toBeLessThanOrEqual(user + 1e-9);
        }
      }
    }
  });

  it("never returns a negative or non-finite spacing", () => {
    for (const [u, w, p] of [
      [0.5, 0, 160],
      [0.5, -3, 160],
      [0.5, 20, 0],
      [0, 20, 160],
    ]) {
      const s = decimationSmoothing(u, w, p);
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
    }
  });

  it("is a no-op at Press 1x for every size — constant-width strokes are untouched", () => {
    for (const size of [1, 6, 40, 150]) {
      const { min, max } = widthRange(size, 1);
      expect(min).toBeCloseTo(max, 6); // constant width, by definition
      expect(decimationSmoothing(1, min, max / 2)).toBeCloseTo(1, 6);
    }
  });

  it("tightens monotonically as the stroke reaches thinner widths", () => {
    const wide = decimationSmoothing(0.9, 80, 160);
    const thin = decimationSmoothing(0.9, 20, 160);
    const thinner = decimationSmoothing(0.9, 5, 160);
    expect(thin).toBeLessThan(wide);
    expect(thinner).toBeLessThan(thin);
  });
});

/**
 * The defect itself, not just the arithmetic. Reproduces the worst case from the sweep
 * (size 40, Press 8x, Smooth 90, Stream 0) and walks the pen's own centreline through the
 * filled path. The uncapped assertion is what keeps this test honest: if the harness ever
 * stopped detecting holes, the first expect would fail rather than the suite going quietly
 * green on a broken detector.
 */
describe("the dashing gap, end to end", () => {
  const T = (streamPct: number) => 1 - (streamPct / 100) * 0.88;

  type P = { x: number; y: number; pressure: number };

  function strokePoints(streamPct: number): P[] {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2;
    const raw: P[] = [];
    for (let d = 0; d <= 400; d += 6) {
      const u = d / 400;
      const ang = Math.sin(u * Math.PI * 3) * 0.5;
      raw.push({
        x: 200 + d * Math.cos(ang) + rnd() * 3,
        y: 200 + d * Math.sin(ang) * 0.9 + Math.sin(d / 30) * 15 + rnd() * 3,
        pressure: 0.05 + 0.95 * Math.pow(Math.abs(Math.sin(u * Math.PI * 2.4)), 2),
      });
    }
    // input.ts: exponential streamline, then interpolate any gap over 4px
    const t = T(streamPct);
    const out: P[] = [];
    let last: P | null = null;
    for (const r of raw) {
      const pt: P = last
        ? {
            x: last.x + (r.x - last.x) * t,
            y: last.y + (r.y - last.y) * t,
            pressure: last.pressure + (r.pressure - last.pressure) * t,
          }
        : { ...r };
      last = pt;
      if (out.length) {
        const p = out[out.length - 1];
        const dx = pt.x - p.x,
          dy = pt.y - p.y,
          d = Math.hypot(dx, dy);
        if (d > 4) {
          const steps = Math.ceil(d / 4);
          for (let i = 1; i < steps; i++) {
            const u = i / steps;
            out.push({
              x: p.x + dx * u,
              y: p.y + dy * u,
              pressure: p.pressure + (pt.pressure - p.pressure) * u,
            });
          }
        }
      }
      out.push(pt);
    }
    return out;
  }

  // getSvgPathFromStroke builds quadratics through midpoints; the FILL is that curve, not the
  // raw polygon — testing the polygon shows 0% dropout and misses the bug entirely.
  function flattenQuadPath(pts: number[][], seg = 10): number[][] {
    if (!pts.length) return [];
    const max = pts.length - 1;
    const out: number[][] = [[pts[0][0], pts[0][1]]];
    let cur = out[0];
    for (let i = 1; i < pts.length; i++) {
      const c = pts[i];
      const n = pts[Math.min(i + 1, max)];
      const e = [(c[0] + n[0]) / 2, (c[1] + n[1]) / 2];
      for (let k = 1; k <= seg; k++) {
        const t = k / seg,
          u = 1 - t;
        out.push([
          u * u * cur[0] + 2 * u * t * c[0] + t * t * e[0],
          u * u * cur[1] + 2 * u * t * c[1] + t * t * e[1],
        ]);
      }
      cur = e;
    }
    return out;
  }

  function windingAt(poly: number[][], x: number, y: number): number {
    let w = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      if (y1 <= y) {
        if (y2 > y && (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) > 0) w++;
      } else if (y2 <= y && (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) < 0) w--;
    }
    return w;
  }

  function holesOnCentreline(smoothing: number) {
    const pts = strokePoints(0);
    const { min, max } = widthRange(40, 8);
    const pfSize = max / 2;
    const widths = pts.map((p) => min + p.pressure * (max - min));
    const used = smoothing === null ? 0.9 : smoothing;
    const input = pts.map((p) => [p.x, p.y, (min + p.pressure * (max - min)) / max]);
    const outline = getStroke(input, {
      size: pfSize,
      thinning: 1,
      smoothing: used,
      streamline: 0.3,
      start: { taper: false, cap: true },
      end: { taper: false, cap: true },
      last: true,
      simulatePressure: false,
    });
    const flat = flattenQuadPath(outline as number[][]);
    let holes = 0;
    for (const p of pts) if (windingAt(flat, p.x, p.y) === 0) holes++;
    return { holes, minWidth: Math.min(...widths), pfSize };
  }

  it("gaps without the cap, and does not gap with it", () => {
    const { minWidth, pfSize } = holesOnCentreline(0.9);

    // the bug, as shipped before the cap: spacing far exceeds the stroke's own width there
    expect(0.9 * pfSize).toBeGreaterThan(minWidth * 5);
    expect(holesOnCentreline(0.9).holes).toBeGreaterThan(0);

    // and with the cap applied, the pen's own path is covered everywhere
    const capped = decimationSmoothing(0.9, minWidth, pfSize);
    expect(capped).toBeLessThan(0.9);
    expect(holesOnCentreline(capped).holes).toBe(0);
  });
});
