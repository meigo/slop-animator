import { describe, it, expect } from "vitest";
import { resolveKeyframeIndex, type Cell } from "../anim/document";

const key = (): Cell => ({ kind: "key", canvas: {} as HTMLCanvasElement });
const hold = (): Cell => ({ kind: "hold" });

describe("resolveKeyframeIndex", () => {
  it("returns null when there is no keyframe at or before the frame", () => {
    expect(resolveKeyframeIndex([hold(), hold()], 1)).toBeNull();
    expect(resolveKeyframeIndex([], 0)).toBeNull();
  });

  it("returns the frame's own index when it is a keyframe", () => {
    expect(resolveKeyframeIndex([key(), hold()], 0)).toBe(0);
  });

  it("walks back to the nearest prior keyframe across holds", () => {
    expect(resolveKeyframeIndex([key(), hold(), hold()], 2)).toBe(0);
  });

  it("picks the most recent keyframe when several precede the frame", () => {
    expect(resolveKeyframeIndex([key(), hold(), key(), hold()], 3)).toBe(2);
  });

  it("clamps a frame index past the end to the last cell", () => {
    expect(resolveKeyframeIndex([key(), hold()], 5)).toBe(0);
  });
});
