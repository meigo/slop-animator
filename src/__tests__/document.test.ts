import { describe, it, expect } from "vitest";
import { resolveKeyframeIndex, buildFrameDrawList, containRect, createReferenceLayer, type Cell, type Project, type DrawingLayer, type ReferenceMedia, type ReferenceLayer } from "../anim/document";

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

  it("returns null past the end of the track (blank after end)", () => {
    expect(resolveKeyframeIndex([key(), hold()], 5)).toBeNull();
    expect(resolveKeyframeIndex([key(), hold()], 2)).toBeNull();
  });
});

function layer(id: number, cells: Cell[], over: Partial<DrawingLayer> = {}): DrawingLayer {
  return { kind: "draw", id, name: `L${id}`, visible: true, locked: false, opacity: 100, cells, ...over };
}
function proj(layers: DrawingLayer[], frameCount: number): Project {
  return { width: 100, height: 100, fps: 12, bgColor: "#fff", frameCount, layers };
}

function refLayer(id: number, over: Partial<ReferenceLayer> = {}): ReferenceLayer {
  const media: ReferenceMedia = { type: "image", el: {} as HTMLImageElement };
  return { kind: "ref", id, name: `R${id}`, visible: true, opacity: 60, offsetFrames: 0, media, ...over };
}

describe("buildFrameDrawList", () => {
  it("emits a draw op per visible drawing layer with a resolved keyframe, bottom→top", () => {
    const p = proj([layer(1, [key(), hold()]), layer(2, [hold(), key()])], 2);
    expect(buildFrameDrawList(p, 1)).toEqual([
      { kind: "draw", layerId: 1, keyframeIndex: 0, opacity: 100 },
      { kind: "draw", layerId: 2, keyframeIndex: 1, opacity: 100 },
    ]);
  });

  it("skips invisible layers", () => {
    const p = proj([layer(1, [key()], { visible: false }), layer(2, [key()])], 1);
    expect(buildFrameDrawList(p, 0)).toEqual([{ kind: "draw", layerId: 2, keyframeIndex: 0, opacity: 100 }]);
  });

  it("skips drawing layers with no keyframe yet at this frame", () => {
    const p = proj([layer(1, [hold(), key()])], 2);
    expect(buildFrameDrawList(p, 0)).toEqual([]);
  });

  it("emits a ref op for visible reference layers, in z-order with drawing layers", () => {
    const p: Project = {
      width: 10, height: 10, fps: 12, bgColor: "#fff", frameCount: 1,
      layers: [refLayer(1), layer(2, [key()], { id: 2 })],
    };
    expect(buildFrameDrawList(p, 0)).toEqual([
      { kind: "ref", layerId: 1, opacity: 60 },
      { kind: "draw", layerId: 2, keyframeIndex: 0, opacity: 100 },
    ]);
  });

  it("excludes reference layers when includeReference is false", () => {
    const p: Project = {
      width: 10, height: 10, fps: 12, bgColor: "#fff", frameCount: 1,
      layers: [refLayer(1), layer(2, [key()], { id: 2 })],
    };
    expect(buildFrameDrawList(p, 0, false)).toEqual([
      { kind: "draw", layerId: 2, keyframeIndex: 0, opacity: 100 },
    ]);
  });
});

describe("containRect", () => {
  it("centres a wide source inside a square box (letterboxed top/bottom)", () => {
    expect(containRect(200, 100, 100, 100)).toEqual({ x: 0, y: 25, w: 100, h: 50 });
  });
  it("centres a tall source inside a square box (pillarboxed left/right)", () => {
    expect(containRect(100, 200, 100, 100)).toEqual({ x: 25, y: 0, w: 50, h: 100 });
  });
  it("fills exactly when aspect ratios match", () => {
    expect(containRect(50, 25, 100, 50)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });
  it("returns the full box for a zero-sized source", () => {
    expect(containRect(0, 0, 100, 80)).toEqual({ x: 0, y: 0, w: 100, h: 80 });
  });
});

describe("createReferenceLayer", () => {
  it("creates a faint, visible ref layer with the given media", () => {
    const media: ReferenceMedia = { type: "image", el: {} as HTMLImageElement };
    const r = createReferenceLayer(media, "bg.png");
    expect(r.kind).toBe("ref");
    expect(r.visible).toBe(true);
    expect(r.opacity).toBe(60);
    expect(r.offsetFrames).toBe(0);
    expect(r.name).toBe("bg.png");
    expect(r.media).toBe(media);
  });
});
