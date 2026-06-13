import { describe, it, expect } from "vitest";
import { resolveKeyframeIndex, type Cell } from "../anim/document";
import { buildFrameDrawList, type Project, type DrawingLayer } from "../anim/document";

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

function layer(id: number, cells: Cell[], over: Partial<DrawingLayer> = {}): DrawingLayer {
  return { kind: "draw", id, name: `L${id}`, visible: true, locked: false, opacity: 100, cells, ...over };
}
function proj(layers: DrawingLayer[], frameCount: number): Project {
  return { width: 100, height: 100, fps: 12, bgColor: "#fff", frameCount, layers };
}

describe("buildFrameDrawList", () => {
  it("emits one op per visible layer that has a resolved keyframe, bottom to top", () => {
    const p = proj([layer(1, [key(), hold()]), layer(2, [hold(), key()])], 2);
    expect(buildFrameDrawList(p, 1)).toEqual([
      { layerId: 1, keyframeIndex: 0, opacity: 100 },
      { layerId: 2, keyframeIndex: 1, opacity: 100 },
    ]);
  });

  it("skips invisible layers", () => {
    const p = proj([layer(1, [key()], { visible: false }), layer(2, [key()])], 1);
    expect(buildFrameDrawList(p, 0)).toEqual([{ layerId: 2, keyframeIndex: 0, opacity: 100 }]);
  });

  it("skips layers with no keyframe yet at this frame", () => {
    const p = proj([layer(1, [hold(), key()])], 2);
    expect(buildFrameDrawList(p, 0)).toEqual([]);
  });
});
