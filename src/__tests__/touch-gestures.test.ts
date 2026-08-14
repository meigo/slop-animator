import { describe, it, expect } from "vitest";
import { PINCH_ROTATE_ENGAGE, pinchRotation } from "../core/touch-gestures";

describe("pinchRotation", () => {
  it("holds the start rotation until the twist exceeds the engage threshold", () => {
    const small = PINCH_ROTATE_ENGAGE * 0.4;
    const r = pinchRotation(0, small, false);
    expect(r.armed).toBe(false);
    expect(r.rotation).toBe(0);
  });

  it("arms and applies the full twist once the threshold is crossed", () => {
    const delta = PINCH_ROTATE_ENGAGE * 1.2;
    const r = pinchRotation(0, delta, false);
    expect(r.armed).toBe(true);
    expect(r.rotation).toBeCloseTo(delta);
  });

  it("stays armed after a later smaller twist so the gesture does not drop rotation mid-way", () => {
    const r = pinchRotation(0, 0.02, true);
    expect(r.armed).toBe(true);
    expect(r.rotation).toBeCloseTo(0.02);
  });
});
