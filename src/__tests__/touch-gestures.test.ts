import { describe, it, expect } from "vitest";
import { SNAP_ANGLE, snappedRotation, shouldPreventTouchDefault } from "../core/touch-gestures";

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

describe("shouldPreventTouchDefault", () => {
  // A fake element whose `closest` matches by a class list, the way the real DOM one does.
  const el = (...classes: string[]) =>
    ({
      closest: (sel: string) => (classes.includes(sel.slice(1)) ? {} : null),
    }) as unknown as EventTarget;

  it("prevents the default touch behaviour over the canvas, so a finger pans instead of scrolling", () => {
    expect(shouldPreventTouchDefault(el("stage"))).toBe(true);
  });

  it("LEAVES the default alone on the floating panels, so their checkboxes and fields still work", () => {
    // preventDefault() on touchstart suppresses the click WebKit synthesises, which is why the pose
    // bar's "Fill outlines" checkbox could not be unchecked on iPad (2026-09-18).
    expect(shouldPreventTouchDefault(el("selection-actions-panel"))).toBe(false);
  });

  it("treats a missing target as canvas", () => {
    expect(shouldPreventTouchDefault(null)).toBe(true);
  });
});
