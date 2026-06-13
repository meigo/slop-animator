import { describe, it, expect } from "vitest";
import { computeOnionFrames, ONION_BASE_OPACITY } from "../anim/onion";

describe("computeOnionFrames", () => {
  it("returns nothing when both counts are zero", () => {
    expect(computeOnionFrames(3, 10, 0, 0)).toEqual([]);
  });

  it("emits prev frames (farthest→nearest) then next frames (farthest→nearest)", () => {
    expect(computeOnionFrames(3, 10, 2, 2)).toEqual([
      { frame: 1, kind: "prev", opacity: ONION_BASE_OPACITY * 0.5 },
      { frame: 2, kind: "prev", opacity: ONION_BASE_OPACITY * 1.0 },
      { frame: 5, kind: "next", opacity: ONION_BASE_OPACITY * 0.5 },
      { frame: 4, kind: "next", opacity: ONION_BASE_OPACITY * 1.0 },
    ]);
  });

  it("clamps at the start of the timeline (no negative frames)", () => {
    expect(computeOnionFrames(0, 3, 2, 1)).toEqual([
      { frame: 1, kind: "next", opacity: ONION_BASE_OPACITY * 1.0 },
    ]);
  });

  it("clamps at the end of the timeline (no frames past the last)", () => {
    expect(computeOnionFrames(2, 3, 1, 2)).toEqual([
      { frame: 1, kind: "prev", opacity: ONION_BASE_OPACITY * 1.0 },
    ]);
  });

  it("with count 1 each, nearest neighbours at full base opacity", () => {
    expect(computeOnionFrames(5, 10, 1, 1)).toEqual([
      { frame: 4, kind: "prev", opacity: ONION_BASE_OPACITY },
      { frame: 6, kind: "next", opacity: ONION_BASE_OPACITY },
    ]);
  });
});
