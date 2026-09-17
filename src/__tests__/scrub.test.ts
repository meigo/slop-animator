import { describe, it, expect } from "vitest";
import { scrubbedValue, stepDecimals, SCRUB_THRESHOLD_PX, FINE_FACTOR } from "../core/scrub";

const fps = { startValue: 24, step: 1, pxPerStep: 8, fine: false, min: 1, max: 60 };

describe("stepDecimals", () => {
  it("reads the precision from the step, so 0.1 steps display one decimal", () => {
    expect(stepDecimals(1)).toBe(0);
    expect(stepDecimals(0.5)).toBe(1);
    expect(stepDecimals(0.1)).toBe(1);
    expect(stepDecimals(8)).toBe(0);
  });
});

describe("scrubbedValue", () => {
  it("moves one step per pxPerStep of travel, to the right", () => {
    expect(scrubbedValue({ ...fps, dx: 8 })).toBe(25);
    expect(scrubbedValue({ ...fps, dx: 80 })).toBe(34);
  });
  it("moves down when dragged left", () => {
    expect(scrubbedValue({ ...fps, dx: -80 })).toBe(14);
  });
  it("lands on whole steps, rounding part-way travel", () => {
    expect(scrubbedValue({ ...fps, dx: 3 })).toBe(24); // under half a step
    expect(scrubbedValue({ ...fps, dx: 5 })).toBe(25); // over half a step
  });
  it("returns exactly the start value when dragged back to the press point", () => {
    expect(scrubbedValue({ ...fps, dx: 0 })).toBe(24);
  });
  it("is measured from the press, so a far excursion does not shift the origin", () => {
    // Out to the clamp and back to +1 step lands on 25, not on 60-something: each sample is
    // startValue + dx, never a running total of the moves before it.
    expect(scrubbedValue({ ...fps, dx: 800 })).toBe(60);
    expect(scrubbedValue({ ...fps, dx: 8 })).toBe(25);
  });
  it("clamps to min and max", () => {
    expect(scrubbedValue({ ...fps, dx: 10000 })).toBe(60);
    expect(scrubbedValue({ ...fps, dx: -10000 })).toBe(1);
  });
  it("fine mode needs FINE_FACTOR times the travel for one step", () => {
    expect(scrubbedValue({ ...fps, dx: 8, fine: true })).toBe(24);
    expect(scrubbedValue({ ...fps, dx: 8 * FINE_FACTOR, fine: true })).toBe(25);
  });
  it("snaps onto the step grid measured from min", () => {
    // Brush size: min 0.5, step 0.5 — an off-grid start value lands on the grid.
    expect(
      scrubbedValue({
        startValue: 3.7,
        dx: 4,
        step: 0.5,
        pxPerStep: 4,
        fine: false,
        min: 0.5,
        max: 60,
      }),
    ).toBe(4);
  });
  it("keeps 0.1 steps clean, with no float dust", () => {
    const speed = { startValue: 1, step: 0.1, pxPerStep: 8, fine: false, min: 0.1, max: 8 };
    expect(scrubbedValue({ ...speed, dx: 24 })).toBe(1.3);
    expect(scrubbedValue({ ...speed, dx: -24 })).toBe(0.7);
  });
  it("ignores a non-finite dx", () => {
    expect(scrubbedValue({ ...fps, dx: NaN })).toBe(24);
  });
  it("exposes a 3px threshold, so a tap is not a drag", () => {
    expect(SCRUB_THRESHOLD_PX).toBe(3);
  });
});
