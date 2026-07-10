import { describe, it, expect } from "vitest";
import {
  clampTimelineHeight,
  MIN_TIMELINE_HEIGHT,
  DEFAULT_TIMELINE_HEIGHT,
} from "../anim/timeline-layout";

describe("clampTimelineHeight", () => {
  it("returns a value within range unchanged", () => {
    expect(clampTimelineHeight(300, 1000)).toBe(300); // 140 <= 300 <= 600
  });

  it("floors at MIN below the minimum", () => {
    expect(clampTimelineHeight(50, 1000)).toBe(MIN_TIMELINE_HEIGHT);
  });

  it("caps at 60% of the viewport above the maximum", () => {
    expect(clampTimelineHeight(900, 1000)).toBe(600); // 0.6 * 1000
  });

  it("keeps MIN even when 60% of a tiny viewport is below MIN", () => {
    expect(clampTimelineHeight(500, 100)).toBe(MIN_TIMELINE_HEIGHT); // 0.6*100=60 < 140 → MIN wins
  });

  it("rounds the max to a whole pixel", () => {
    expect(clampTimelineHeight(9999, 777)).toBe(Math.round(777 * 0.6)); // 466
  });

  it("DEFAULT is within the sane range", () => {
    expect(DEFAULT_TIMELINE_HEIGHT).toBeGreaterThanOrEqual(MIN_TIMELINE_HEIGHT);
  });
});
