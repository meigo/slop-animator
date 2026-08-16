import { describe, it, expect } from "vitest";
import { edgeScrollDelta, EDGE_ZONE_PX, EDGE_MAX_PX } from "../anim/edge-scroll";

// A scroller occupying x = 100..500 on screen.
const L = 100;
const R = 500;

describe("edgeScrollDelta", () => {
  it("does not scroll in the safe middle", () => {
    expect(edgeScrollDelta(300, L, R)).toBe(0);
    expect(edgeScrollDelta(L + EDGE_ZONE_PX, L, R)).toBe(0); // exactly at the zone's inner edge
    expect(edgeScrollDelta(R - EDGE_ZONE_PX, L, R)).toBe(0);
  });

  it("scrolls LEFT (negative) inside the left zone, right inside the right zone", () => {
    expect(edgeScrollDelta(L + 1, L, R)).toBeLessThan(0);
    expect(edgeScrollDelta(R - 1, L, R)).toBeGreaterThan(0);
  });

  it("ramps with depth, so a small overshoot creeps and a big one races", () => {
    const shallow = edgeScrollDelta(R - EDGE_ZONE_PX + 4, L, R);
    const deep = edgeScrollDelta(R - 2, L, R);
    expect(shallow).toBeGreaterThan(0);
    expect(deep).toBeGreaterThan(shallow);
  });

  it("caps at the maximum, so flinging the pointer off-screen is no faster than the edge", () => {
    expect(edgeScrollDelta(R, L, R)).toBe(EDGE_MAX_PX);
    expect(edgeScrollDelta(R + 5000, L, R)).toBe(EDGE_MAX_PX); // steerable, not unbounded
    expect(edgeScrollDelta(L - 5000, L, R)).toBe(-EDGE_MAX_PX);
  });

  it("is symmetric about the two edges", () => {
    expect(edgeScrollDelta(L + 10, L, R)).toBe(-edgeScrollDelta(R - 10, L, R));
  });

  it("a zero-width zone disables scrolling rather than dividing by zero", () => {
    expect(edgeScrollDelta(R + 100, L, R, 0)).toBe(0);
  });
});
