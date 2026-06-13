import { describe, it, expect } from "vitest";
import { setMinLayerId, createDrawingLayer } from "../anim/document";
import { projectToJson, frameAssetPath } from "../persist/project-file";
import type { Project, Cell, DrawingLayer, ReferenceLayer } from "../anim/document";

function key(): Cell { return { kind: "key", canvas: {} as HTMLCanvasElement }; }
function hold(): Cell { return { kind: "hold" }; }
function dlayer(id: number, cells: Cell[]): DrawingLayer {
  return { kind: "draw", id, name: `L${id}`, visible: true, locked: false, opacity: 100, cells };
}
function rlayer(id: number): ReferenceLayer {
  return { kind: "ref", id, name: `R${id}`, visible: true, opacity: 60, offsetFrames: 0,
    media: { type: "image", el: {} as HTMLImageElement } };
}

describe("projectToJson", () => {
  it("serializes settings and drawing layers (cells as key/hold), excluding reference layers", () => {
    const p: Project = {
      width: 800, height: 600, fps: 8, bgColor: "#eee", frameCount: 2,
      layers: [dlayer(1, [key(), hold()]), rlayer(2)],
    };
    expect(projectToJson(p)).toEqual({
      version: 1,
      width: 800, height: 600, fps: 8, bgColor: "#eee", frameCount: 2,
      layers: [
        { id: 1, name: "L1", visible: true, locked: false, opacity: 100, cells: ["key", "hold"] },
      ],
    });
  });
});

describe("frameAssetPath", () => {
  it("builds frames/<layerId>/<frameIndex>.png", () => {
    expect(frameAssetPath(2, 5)).toBe("frames/2/5.png");
  });
});

describe("setMinLayerId", () => {
  it("ensures subsequent created layers get ids at or above the floor", () => {
    setMinLayerId(500);
    expect(createDrawingLayer(1).id).toBeGreaterThanOrEqual(500);
  });
  it("never lowers the counter", () => {
    setMinLayerId(500);
    const a = createDrawingLayer(1).id;
    setMinLayerId(10);
    const b = createDrawingLayer(1).id;
    expect(b).toBeGreaterThan(a);
  });
});
