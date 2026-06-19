import { describe, it, expect } from "vitest";
import { setMinLayerId, createDrawingLayer, defaultBoilConfig } from "../anim/document";
import { projectToJson, frameAssetPath, migrateBoil, insertReferencesByIndex } from "../persist/project-file";
import type { Project, Cell, DrawingLayer, ReferenceLayer } from "../anim/document";

function key(): Cell { return { kind: "key", canvas: {} as HTMLCanvasElement }; }
function hold(): Cell { return { kind: "hold" }; }
function dlayer(id: number, cells: Cell[]): DrawingLayer {
  return { kind: "draw", id, name: `L${id}`, visible: true, locked: false, opacity: 100, boilStrength: 1, groupId: null, cells, transform: { dx: 0, dy: 0, scale: 1, rotation: 0 } };
}
function rlayer(id: number): ReferenceLayer {
  return { kind: "ref", id, name: `R${id}`, visible: true, opacity: 60, offsetFrames: 0, groupId: null,
    media: { type: "image", el: {} as HTMLImageElement },
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 } };
}

describe("projectToJson", () => {
  it("serializes settings (incl. boil) and drawing layers, excluding reference layers", () => {
    const p: Project = {
      width: 800, height: 600, fps: 8, bgColor: "#eee", frameCount: 2,
      boil: { enabled: true, amount: 2, cols: 16, rate: 2, weight: 0.4, holdsOnly: true },
      groups: [],
      layers: [dlayer(1, [key(), hold()]), rlayer(2)],
      audio: null,
    };
    expect(projectToJson(p)).toEqual({
      version: 1,
      width: 800, height: 600, fps: 8, bgColor: "#eee", frameCount: 2,
      boil: { enabled: true, amount: 2, cols: 16, rate: 2, weight: 0.4, holdsOnly: true },
      groups: [],
      layers: [
        { id: 1, name: "L1", visible: true, locked: false, opacity: 100, boilStrength: 1, groupId: null, cells: ["key", "hold"] },
      ],
      references: [
        { index: 1, id: 2, name: "R2", visible: true, opacity: 60, offsetFrames: 0, groupId: null, was: "image",
          transform: { dx: 0, dy: 0, scale: 1, rotation: 0 } },
      ],
      audio: null,
    });
  });

  it("uses defaultBoilConfig() shape", () => {
    expect(Object.keys(defaultBoilConfig()).sort()).toEqual(
      ["amount", "cols", "enabled", "holdsOnly", "rate", "weight"]
    );
  });
});

describe("migrateBoil", () => {
  it("an old save with `scale` loads with a default weight (scale dropped)", () => {
    const m = migrateBoil({ enabled: true, amount: 2, cols: 16, rate: 2, scale: 0.005, holdsOnly: true });
    expect(m.weight).toBe(0.4);
    expect("scale" in m).toBe(false);
    expect(m.amount).toBe(2);
  });
  it("a save with weight keeps it; missing boil → full default", () => {
    expect(migrateBoil({ enabled: true, amount: 3, cols: 8, rate: 1, weight: 0.7, holdsOnly: false }).weight).toBe(0.7);
    expect(migrateBoil(undefined).enabled).toBe(false);
  });
});

describe("insertReferencesByIndex", () => {
  it("splices a reference into the middle", () => {
    expect(insertReferencesByIndex(["a", "b", "c"], [{ index: 1, value: "R" }])).toEqual(["a", "R", "b", "c"]);
  });
  it("reconstructs interleaved order (ascending index)", () => {
    expect(insertReferencesByIndex(["a", "b"], [{ index: 2, value: "R2" }, { index: 0, value: "R0" }]))
      .toEqual(["R0", "a", "R2", "b"]);
  });
  it("clamps an out-of-range index to the end", () => {
    expect(insertReferencesByIndex(["a"], [{ index: 9, value: "R" }])).toEqual(["a", "R"]);
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
