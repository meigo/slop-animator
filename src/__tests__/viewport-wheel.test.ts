import { describe, it, expect } from "vitest";
import { wheelPx, wheelZoomFactor } from "../core/viewport";

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

// Port of slop-paint 2acb7c8: the plain-wheel pan took deltas as pixels whatever deltaMode said.
describe("wheelPx", () => {
  it("converts lines and pages to pixels, leaves pixels alone", () => {
    expect(wheelPx(3, 1)).toBe(48); // one Firefox mouse-wheel notch
    expect(wheelPx(-1, 2)).toBe(-800);
    expect(wheelPx(100, 0)).toBe(100);
    expect(wheelPx(100)).toBe(100);
  });
});
