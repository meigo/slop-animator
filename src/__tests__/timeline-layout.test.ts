import { describe, it, expect } from "vitest";
import {
  clampTimelineHeight,
  MIN_TIMELINE_HEIGHT,
  DEFAULT_TIMELINE_HEIGHT,
  playheadFollowScroll,
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

describe("playheadFollowScroll", () => {
  const gutter = 142;
  const pad = 8;
  const viewW = 400;
  // visible cell strip is [scroll+gutter+pad, scroll+viewW-pad]

  it("returns null when the playhead is already in the visible cell strip", () => {
    const scroll = 0;
    const playheadX = gutter + 50; // well inside
    expect(playheadFollowScroll(playheadX, scroll, viewW, gutter, pad, playheadX - 24)).toBeNull();
  });

  it("page-steps forward when the playhead leaves the right edge", () => {
    const scroll = 0;
    const playheadX = viewW + 10; // past the right
    const next = playheadFollowScroll(playheadX, scroll, viewW, gutter, pad, playheadX - 24);
    expect(next).toBe(playheadX - gutter - pad); // snap so playhead sits just after the gutter
  });

  it("does not jump back when the user has scrolled ahead of a still-advancing playhead", () => {
    const scroll = 2000; // looking at later frames
    const playheadX = gutter + 50; // playhead still on the left, off-screen
    expect(playheadFollowScroll(playheadX, scroll, viewW, gutter, pad, playheadX - 24)).toBeNull();
  });

  it("snaps back when the playhead wraps backward (loop) and leaves the view", () => {
    const scroll = 2000;
    const playheadX = gutter + 12; // back at frame 0
    const prevX = 2500; // was at the end
    const next = playheadFollowScroll(playheadX, scroll, viewW, gutter, pad, prevX);
    expect(next).toBe(Math.max(0, playheadX - gutter - pad));
  });
});
