import { describe, it, expect } from "vitest";
import { isDoubleTap, DOUBLE_TAP_MS, DOUBLE_TAP_PX, type Tap } from "../lib/double-tap";

const tap = (target: string, t: number, x = 100, y = 50): Tap => ({ target, t, x, y });

describe("isDoubleTap", () => {
  it("pairs two taps on the same target inside the window", () => {
    expect(isDoubleTap(tap("layer:1", 1000), tap("layer:1", 1200))).toBe(true);
    expect(isDoubleTap(tap("layer:1", 1000), tap("layer:1", 1000 + DOUBLE_TAP_MS))).toBe(true);
  });

  it("needs a first tap", () => {
    expect(isDoubleTap(null, tap("layer:1", 1000))).toBe(false);
  });

  it("never pairs taps on different targets", () => {
    expect(isDoubleTap(tap("layer:1", 1000), tap("layer:2", 1100))).toBe(false);
    expect(isDoubleTap(tap("layer:1", 1000), tap("group:1", 1100))).toBe(false);
  });

  it("is too slow past the window", () => {
    expect(isDoubleTap(tap("layer:1", 1000), tap("layer:1", 1001 + DOUBLE_TAP_MS))).toBe(false);
  });

  it("rejects a second tap that lands too far away, and a clock that went backwards", () => {
    expect(isDoubleTap(tap("layer:1", 1000), tap("layer:1", 1100, 100 + DOUBLE_TAP_PX, 50))).toBe(
      true,
    );
    expect(
      isDoubleTap(tap("layer:1", 1000), tap("layer:1", 1100, 100 + DOUBLE_TAP_PX + 1, 50)),
    ).toBe(false);
    expect(isDoubleTap(tap("layer:1", 1000), tap("layer:1", 900))).toBe(false);
  });
});
