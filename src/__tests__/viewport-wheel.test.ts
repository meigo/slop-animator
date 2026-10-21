import { describe, it, expect } from "vitest";
import { wheelZoomFactor } from "../core/viewport";

// Port of slop-paint 4bd2825: zoomAt zoomed a fixed 10% per wheel event whatever its deltaY.
describe("wheelZoomFactor", () => {
  it("follows a trackpad pinch's small deltas instead of 10% each", () => {
    // 30 Chrome pinch events of −2: e^0.6 ≈ 1.82 (a fixed 10% per event gave 17×)
    let z = 1;
    for (let i = 0; i < 30; i++) z *= wheelZoomFactor(-2);
    expect(z).toBeCloseTo(Math.exp(0.6), 5);
  });

  it("zooms a mouse notch about 10%, either way", () => {
    expect(wheelZoomFactor(-100)).toBeCloseTo(1.105, 3);
    expect(wheelZoomFactor(100)).toBeCloseTo(0.905, 3);
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(1.105, 3); // Firefox: 3 lines
  });

  it("zooms nothing for deltaY 0", () => {
    expect(wheelZoomFactor(0)).toBe(1);
  });
});
