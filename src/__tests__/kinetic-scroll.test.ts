import { describe, it, expect } from "vitest";
import {
  flingVelocity,
  decayVelocity,
  flingSpent,
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
