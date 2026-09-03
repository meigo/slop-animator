import { describe, it, expect } from "vitest";
import {
  nibSemiAxes,
  clampNibFlatness,
  nibSupport,
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
