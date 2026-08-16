import { describe, it, expect } from "vitest";
import {
  flingVelocity,
  decayVelocity,
  flingSpent,
  stepFlingAxis,
  FLING_MIN_V,
  FLING_MAX_V,
  type PanSample,
} from "../anim/kinetic-scroll";

const s = (t: number, x: number, y = 0): PanSample => ({ t, x, y });

describe("flingVelocity", () => {
  it("measures a steady drag in px/ms", () => {
    // 60px over 60ms, moving left (scroll offsets go the other way, but this is raw pointer travel)
    const v = flingVelocity([s(0, 0), s(20, 20), s(40, 40), s(60, 60)], 60);
    expect(v.vx).toBeCloseTo(1, 5);
    expect(v.vy).toBe(0);
  });

  it("carries both axes", () => {
    const v = flingVelocity([s(0, 0, 0), s(40, 40, -20)], 40);
    expect(v.vx).toBeCloseTo(1, 5);
    expect(v.vy).toBeCloseTo(-0.5, 5);
  });

  // The property that decides how this FEELS: park the finger, lift, and nothing should be thrown.
  it("is zero when the finger rested before lifting", () => {
    const samples = [s(0, 0), s(20, 200), s(400, 200), s(440, 200), s(460, 200)];
    const v = flingVelocity(samples, 460); // the fast leg is far outside the window
    expect(v.vx).toBe(0);
  });

  it("ignores samples older than the window", () => {
    // A slow first leg then a fast one: only the fast leg is in the window, so it must not be
    // averaged down by the earlier travel.
    const v = flingVelocity([s(0, 0), s(300, 10), s(340, 50), s(380, 90)], 380);
    expect(v.vx).toBeCloseTo(1, 5); // 80px / 80ms, not 90px / 380ms
  });

  it("is zero with fewer than two recent samples", () => {
    expect(flingVelocity([s(0, 0)], 0)).toEqual({ vx: 0, vy: 0 });
    expect(flingVelocity([], 0)).toEqual({ vx: 0, vy: 0 });
    expect(flingVelocity([s(0, 0), s(10, 500)], 5000)).toEqual({ vx: 0, vy: 0 }); // all stale
  });

  it("is zero when two samples share a timestamp (no divide by zero)", () => {
    expect(flingVelocity([s(5, 0), s(5, 40)], 5)).toEqual({ vx: 0, vy: 0 });
  });

  it("caps an implausible flick", () => {
    const v = flingVelocity([s(0, 0), s(1, 9000)], 1);
    expect(v.vx).toBe(FLING_MAX_V);
  });
});

describe("decayVelocity / flingSpent", () => {
  it("slows over time and never reverses", () => {
    const a = decayVelocity(2, 100);
    const b = decayVelocity(2, 400);
    expect(a).toBeLessThan(2);
    expect(b).toBeLessThan(a);
    expect(b).toBeGreaterThan(0);
  });

  it("is frame-rate independent: one long step equals two short ones", () => {
    const oneStep = decayVelocity(2, 32);
    const twoSteps = decayVelocity(decayVelocity(2, 16), 16);
    expect(oneStep).toBeCloseTo(twoSteps, 10);
  });

  it("a fling comes to rest in about a second", () => {
    let v = 2;
    let ms = 0;
    while (!flingSpent(v, 0) && ms < 10_000) {
      v = decayVelocity(v, 16);
      ms += 16;
    }
    expect(ms).toBeGreaterThan(300); // long enough to read as a glide
    expect(ms).toBeLessThan(2000); // short enough not to feel out of control
  });

  it("keeps gliding while EITHER axis still carries speed", () => {
    expect(flingSpent(0, FLING_MIN_V * 2)).toBe(false);
    expect(flingSpent(FLING_MIN_V * 2, 0)).toBe(false);
    expect(flingSpent(FLING_MIN_V / 2, FLING_MIN_V / 2)).toBe(true);
  });
});

describe("stepFlingAxis", () => {
  it("moves opposite the pointer travel", () => {
    expect(stepFlingAxis(500, 1, 10, 2000).pos).toBe(490); // finger went right → scroll back
    expect(stepFlingAxis(500, -1, 10, 2000).pos).toBe(510);
  });

  it("keeps the velocity while inside the bounds", () => {
    expect(stepFlingAxis(500, 1, 10, 2000).v).toBe(1);
  });

  // The bug this function exists for: an `!==` test against the WRITTEN value fires on rounding,
  // not just at an edge, so the glide died on its first frame under WebKit's pixel snapping.
  // Sub-pixel steps must survive, and mid-range motion must never look like a bound.
  it("advances by a sub-pixel step instead of stalling", () => {
    const a = stepFlingAxis(500, 0.02, 16, 2000); // 0.32px
    expect(a.pos).toBeCloseTo(499.68, 5);
    expect(a.v).toBe(0.02); // still moving — NOT treated as an edge
  });

  it("zeroes the axis at the start bound", () => {
    const a = stepFlingAxis(5, 1, 100, 2000); // would land at -95
    expect(a.pos).toBe(0);
    expect(a.v).toBe(0);
  });

  it("zeroes the axis at the end bound", () => {
    const a = stepFlingAxis(1990, -1, 100, 2000); // would overshoot 2000
    expect(a.pos).toBe(2000);
    expect(a.v).toBe(0);
  });

  it("treats a non-scrollable axis as pinned at 0", () => {
    const a = stepFlingAxis(0, 1, 16, 0); // content fits: max is 0 (or negative)
    expect(a.pos).toBe(0);
    expect(a.v).toBe(0);
    expect(stepFlingAxis(0, -1, 16, -50).pos).toBe(0);
  });
});
