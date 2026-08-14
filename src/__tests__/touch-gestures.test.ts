import { describe, it, expect } from "vitest";
import { SNAP_ANGLE, snappedRotation } from "../core/touch-gestures";

describe("snappedRotation", () => {
  it("snaps a tiny tilt back to 0", () => {
    expect(snappedRotation(SNAP_ANGLE * 0.5)).toBe(0);
    expect(snappedRotation(-SNAP_ANGLE * 0.5)).toBe(0);
  });

  it("leaves a small intentional rotate (above the snap window) alone", () => {
    const eightDeg = (8 * Math.PI) / 180;
    expect(eightDeg).toBeGreaterThan(SNAP_ANGLE);
    expect(snappedRotation(eightDeg)).toBeCloseTo(eightDeg);
  });

  it("snaps to the nearest 90° when close enough", () => {
    const almostRight = Math.PI / 2 - SNAP_ANGLE * 0.4;
    expect(snappedRotation(almostRight)).toBeCloseTo(Math.PI / 2);
  });
});
