import { describe, it, expect } from "vitest";
import type { BrushSettings } from "../core/brush";
import {
  drawCalligraphyStroke,
  isCorner,
  nibSemiAxes,
  clampNibFlatness,
  nibSupport,
  nibSupportPoint,
  normals,
  MAX_NIB_FLATNESS,
} from "../core/calligraphy-brush";

describe("clampNibFlatness", () => {
  it("passes through values already in range", () => {
    expect(clampNibFlatness(0)).toBe(0);
    expect(clampNibFlatness(0.5)).toBe(0.5);
  });

  it("clamps below 0 up to 0", () => {
    expect(clampNibFlatness(-1)).toBe(0);
  });

  it("clamps above MAX_NIB_FLATNESS down to it", () => {
    expect(clampNibFlatness(1)).toBe(MAX_NIB_FLATNESS);
    expect(clampNibFlatness(100)).toBe(MAX_NIB_FLATNESS);
  });
});

describe("nibSemiAxes", () => {
  it("at flatness 0 the short axis equals the long axis (a circle)", () => {
    const { a, b } = nibSemiAxes(10, 0);
    expect(a).toBe(10);
    expect(b).toBe(10);
  });

  it("the long axis is always the full radius, regardless of flatness", () => {
    for (const f of [0, 0.35, 0.9, 1, 5]) {
      expect(nibSemiAxes(10, f).a).toBe(10);
    }
  });

  it("the short axis shrinks as flatness rises, but never reaches zero", () => {
    expect(nibSemiAxes(10, 0.5).b).toBeCloseTo(5, 6);
    expect(nibSemiAxes(10, MAX_NIB_FLATNESS).b).toBeCloseTo(10 * (1 - MAX_NIB_FLATNESS), 6);
    expect(nibSemiAxes(10, 0.9).b).toBeGreaterThan(0);
  });

  it("clamps an out-of-range flatness the same way clampNibFlatness does", () => {
    expect(nibSemiAxes(10, 1).b).toBeCloseTo(nibSemiAxes(10, MAX_NIB_FLATNESS).b, 6);
    expect(nibSemiAxes(10, -1).b).toBe(10);
  });
});

/**
 * The support function is where the calligraphic look actually comes from: how far the nib
 * reaches perpendicular to travel depends on how the travel direction meets the nib's fixed
 * angle. Sweeping across the nib's face is wide; sweeping along its edge is a hairline.
 */
describe("nibSupport", () => {
  const a = 10;
  const b = 2; // a flat nib: long axis 10, short axis 2

  it("reaches the full long axis when measured along the nib's own direction", () => {
    // nib at 0rad lies along +x, so measuring the reach along +x gives the long axis
    expect(nibSupport(a, b, 0, 1, 0)).toBeCloseTo(a, 6);
  });

  it("reaches only the short axis when measured across the nib", () => {
    expect(nibSupport(a, b, 0, 0, 1)).toBeCloseTo(b, 6);
  });

  it("follows the nib when the nib is rotated", () => {
    const q = Math.PI / 2; // nib now lies along +y
    expect(nibSupport(a, b, q, 0, 1)).toBeCloseTo(a, 6);
    expect(nibSupport(a, b, q, 1, 0)).toBeCloseTo(b, 6);
  });

  it("interpolates between the two axes at intermediate angles", () => {
    const mid = nibSupport(a, b, 0, Math.SQRT1_2, Math.SQRT1_2);
    expect(mid).toBeGreaterThan(b);
    expect(mid).toBeLessThan(a);
    // exact: sqrt((a/sqrt2)^2 + (b/sqrt2)^2)
    expect(mid).toBeCloseTo(Math.hypot(a / Math.SQRT2, b / Math.SQRT2), 6);
  });

  it("is symmetric under direction reversal — a nib has no front or back", () => {
    for (const [ux, uy] of [
      [1, 0],
      [0, 1],
      [Math.SQRT1_2, Math.SQRT1_2],
    ]) {
      expect(nibSupport(a, b, 0.7, ux, uy)).toBeCloseTo(nibSupport(a, b, 0.7, -ux, -uy), 6);
    }
  });

  it("is a circle's radius in every direction when the nib is not flattened", () => {
    for (const [ux, uy] of [
      [1, 0],
      [0, 1],
      [Math.SQRT1_2, Math.SQRT1_2],
    ]) {
      expect(nibSupport(7, 7, 1.1, ux, uy)).toBeCloseTo(7, 6);
    }
  });

  it("never returns zero at the flatness ceiling — the thinnest stroke still renders", () => {
    const { a: ca, b: cb } = nibSemiAxes(10, MAX_NIB_FLATNESS);
    expect(nibSupport(ca, cb, 0, 0, 1)).toBeGreaterThan(0);
  });
});

/**
 * Regression guard for the defect that shipped twice: a flat nib turns tiny input jitter into
 * spikes the length of the nib, because the swept half-width is read off the travel direction.
 * The damper is the normal being taken over a DISTANCE baseline rather than from the adjacent
 * segment. These tests fail against a per-segment normal, which is the point of them.
 */
describe("normals (jitter damping)", () => {
  // a straight horizontal path with sub-pixel sample noise, the shape a Pencil actually delivers
  const jittery = (jit: number) => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2;
    return Array.from({ length: 200 }, (_, i) => ({ x: i * 2 + rnd() * jit, y: 50 + rnd() * jit }));
  };
  // worst angular deviation from the true perpendicular of a horizontal path, which is (0, ±1)
  const worstTiltDeg = (ns: { nx: number; ny: number }[]) =>
    Math.max(...ns.map((n) => Math.abs((Math.atan2(n.nx, Math.abs(n.ny)) * 180) / Math.PI)));

  it("holds the normal steady through jitter when the baseline is wide", () => {
    expect(worstTiltDeg(normals(jittery(1.2), 17))).toBeLessThan(12);
  });

  it("degrades as the baseline shrinks — this is what the old per-segment normal did", () => {
    // reach 0 clamps to the 2px floor, i.e. roughly one sample: the failure mode, kept as the
    // contrast that proves the assertion above is measuring something real.
    expect(worstTiltDeg(normals(jittery(1.2), 0))).toBeGreaterThan(30);
  });

  it("is the exact perpendicular for a clean straight path", () => {
    const straight = Array.from({ length: 50 }, (_, i) => ({ x: i * 3, y: 20 }));
    for (const n of normals(straight, 17)) {
      expect(Math.abs(n.nx)).toBeCloseTo(0, 6);
      expect(Math.abs(n.ny)).toBeCloseTo(1, 6);
    }
  });

  /**
   * The corner case the damper got wrong (reported 2026-09-24: "when drawing sharp angles without
   * lifting pen/mouse holes in corners appear"). The baseline walk spans a hairpin — back lands on
   * one leg, forward on the other — so the chord points ACROSS the turn and the normal comes out
   * near-PARALLEL to the travel. The ribbon then twists and leaves the apex uncovered. Measured on
   * the reported shape before the fix: the apex normal was 6° off the travel direction, where it
   * must be 90°.
   */
  it("stays perpendicular to the local travel through a hairpin", () => {
    const step = 3;
    const turnRad = (165 * Math.PI) / 180;
    const pts: { x: number; y: number }[] = [];
    let x = 0,
      y = 0;
    for (let i = 0; i < 25; i++) {
      pts.push({ x, y });
      y += step;
    }
    for (let i = 0; i < 25; i++) {
      x += step * Math.cos(Math.PI / 2 + turnRad);
      y += step * Math.sin(Math.PI / 2 + turnRad);
      pts.push({ x, y });
    }
    const ns = normals(pts, 13); // reach 13px, far longer than the 3px steps — spans the corner
    for (let i = 1; i < pts.length - 1; i++) {
      const dx = pts[i + 1].x - pts[i - 1].x;
      const dy = pts[i + 1].y - pts[i - 1].y;
      const len = Math.hypot(dx, dy);
      // CORNER vertices are skipped on purpose: no single normal describes one, which is why they
      // get the nib's footprint as a join instead. Using the engine's own predicate, so the set of
      // vertices this test excuses is exactly the set the renderer covers another way.
      if (isCorner(pts[i - 1], pts[i], pts[i + 1])) continue;
      // |cos| between the normal and the local travel: 0 is perpendicular, 1 is parallel.
      const alignment = Math.abs((dx / len) * ns[i].nx + (dy / len) * ns[i].ny);
      expect(alignment).toBeLessThan(0.35); // within ~20° of perpendicular
    }
  });

  it("returns unit vectors everywhere, including a fully coincident run", () => {
    const held = [
      ...Array.from({ length: 30 }, () => ({ x: 10, y: 10 })),
      ...Array.from({ length: 30 }, (_, i) => ({ x: 10 + i * 4, y: 10 })),
    ];
    for (const n of normals(held, 17)) expect(Math.hypot(n.nx, n.ny)).toBeCloseTo(1, 6);
  });

  it("survives a path of one single point", () => {
    expect(normals([{ x: 5, y: 5 }], 17)).toHaveLength(1);
    expect(Math.hypot(...Object.values(normals([{ x: 5, y: 5 }], 17)[0]))).toBeCloseTo(1, 6);
  });
});

describe("drawCalligraphyStroke (corner holes)", () => {
  /** Records every subpath the engine emits, instead of rasterising it. */
  function recordRings(points: { x: number; y: number; pressure: number }[], nibAngle: number) {
    const rings: number[][][] = [];
    let cur: number[][] = [];
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      fill() {},
      moveTo: (x: number, y: number) => (cur = [[x, y]]),
      lineTo: (x: number, y: number) => cur.push([x, y]),
      closePath: () => rings.push(cur),
    } as unknown as CanvasRenderingContext2D;
    const settings = {
      size: 26,
      nibAngle,
      nibFlatness: 0.8,
      opacity: 100,
      color: "#000",
      isEraser: false,
    } as BrushSettings;
    drawCalligraphyStroke(ctx, points as never, settings, 1);
    return rings;
  }

  /** A ring whose turns go both ways crosses itself (a quad drawn as a bowtie). */
  function crossesItself(ring: number[][]): boolean {
    let left = false;
    let right = false;
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % ring.length];
      const [cx, cy] = ring[(i + 2) % ring.length];
      const turn = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
      if (turn > 1e-9) left = true;
      else if (turn < -1e-9) right = true;
    }
    return left && right;
  }

  /**
   * Reported 2026-09-24, after the normals fix, with a screenshot of a zigzag: holes still punched
   * through the ink at the corners. At a sharp turn the normal flips between two samples, so the
   * segment quad twists into a bowtie. Its two lobes wind in opposite directions — `addRing` can
   * make only one of them positive — and under nonzero fill the negative lobe CANCELS the ink of
   * the pieces it overlaps. Measured on a 120° zigzag: 12-18 bowties and up to ~84px² of holes.
   */
  it("never emits a self-crossing piece on a sharp zigzag", () => {
    const pts: { x: number; y: number; pressure: number }[] = [];
    let x = 0;
    let y = 0;
    let dir = -Math.PI / 2 + 0.3;
    for (let leg = 0; leg < 5; leg++) {
      for (let d = 0; d < 120; d += 2) {
        pts.push({ x, y, pressure: 0.3 + (0.6 * d) / 120 });
        x += 2 * Math.cos(dir);
        y += 2 * Math.sin(dir);
      }
      dir += ((leg % 2 ? -1 : 1) * 2 * Math.PI) / 3; // 120° turn, alternating
    }
    for (const angle of [0, 45, 90, 135]) {
      const bad = recordRings(pts, angle).filter(crossesItself);
      expect(bad.length, `nib angle ${angle}`).toBe(0);
    }
  });
});

describe("nibSupportPoint", () => {
  it("projects onto the direction by exactly nibSupport, so the ribbon's width is unchanged", () => {
    for (const deg of [0, 20, 45, 90, 133, 200, 300]) {
      const t = (deg * Math.PI) / 180;
      const ux = Math.cos(t);
      const uy = Math.sin(t);
      const s = nibSupportPoint(10, 1.5, Math.PI / 4, ux, uy);
      expect(s.x * ux + s.y * uy).toBeCloseTo(nibSupport(10, 1.5, Math.PI / 4, ux, uy), 9);
    }
  });

  it("lies on the nib's outline", () => {
    const angle = 0.7;
    const s = nibSupportPoint(10, 1.5, angle, 0.3, Math.sqrt(1 - 0.09));
    const u = s.x * Math.cos(angle) + s.y * Math.sin(angle);
    const v = -s.x * Math.sin(angle) + s.y * Math.cos(angle);
    expect((u / 10) ** 2 + (v / 1.5) ** 2).toBeCloseTo(1, 9);
  });

  /**
   * Reported 2026-09-24 with a screenshot: a vertical stroke under a 45° nib ended square across
   * instead of along the nib. The ribbon's edge used to sit at `n · nibSupport` — straight out
   * along the normal — which puts the end cut perpendicular to the travel whatever the nib angle.
   * A real nib touches the edge at its support point, out near the TIP of a flat nib, so the cut
   * between the two edges runs along the nib.
   */
  it("puts a flat nib's end cut along the nib, not square to the travel", () => {
    const angle = Math.PI / 4; // nib at 45°
    const s = nibSupportPoint(15, 1, angle, 1, 0); // travelling vertically: normal is (1, 0)
    // The cut runs from -s to +s; its direction should be the nib's, within a few degrees.
    const cut = Math.atan2(s.y, s.x);
    expect(Math.abs(cut - angle)).toBeLessThan((5 * Math.PI) / 180);
  });
});
