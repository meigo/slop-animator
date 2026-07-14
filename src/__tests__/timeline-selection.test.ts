import { describe, it, expect } from "vitest";
import type { Cell, DrawingLayer, Layer, ReferenceLayer } from "../anim/document";
import { resolveSelectionRect } from "../anim/timeline-selection";

const key = (): Cell => ({ kind: "key", canvas: {} as unknown as HTMLCanvasElement });
function drawLayer(id: number): DrawingLayer {
  return {
    kind: "draw",
    id,
    name: `L${id}`,
    visible: true,
    locked: false,
    opacity: 100,
    boilStrength: 1,
    groupId: null,
    cells: [key()],
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  };
}
function refLayer(id: number): ReferenceLayer {
  return {
    kind: "ref",
    id,
    name: `R${id}`,
    visible: true,
    opacity: 100,
    offsetFrames: 0,
    speed: 1,
    audioEnabled: false,
    groupId: null,
    media: { type: "missing", was: "image", name: "x" },
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  };
}

describe("resolveSelectionRect", () => {
  it("orders frames and layers regardless of anchor/focus order (top-first display order)", () => {
    // stack bottom→top: 1,2,3 ; display top-first: 3,2,1
    const layers: Layer[] = [drawLayer(1), drawLayer(2), drawLayer(3)];
    const rect = resolveSelectionRect(layers, { layerId: 1, frame: 5 }, { layerId: 3, frame: 2 });
    expect(rect).toEqual({ layerIds: [3, 2, 1], startFrame: 2, endFrame: 5 });
  });

  it("includes only drawing layers within the span (skips a ref in the middle)", () => {
    const layers: Layer[] = [drawLayer(1), refLayer(2), drawLayer(3)];
    const rect = resolveSelectionRect(layers, { layerId: 3, frame: 0 }, { layerId: 1, frame: 0 });
    expect(rect?.layerIds).toEqual([3, 1]);
  });

  it("returns null when an endpoint layer is missing", () => {
    expect(
      resolveSelectionRect([drawLayer(1)], { layerId: 1, frame: 0 }, { layerId: 9, frame: 0 }),
    ).toBeNull();
  });

  it("returns null when the span contains no drawing layers", () => {
    const layers: Layer[] = [refLayer(1), refLayer(2)];
    expect(
      resolveSelectionRect(layers, { layerId: 1, frame: 0 }, { layerId: 2, frame: 0 }),
    ).toBeNull();
  });
});
