import { describe, it, expect } from "vitest";
import { computeAnchor } from "../core/selection-anchor";

const idScreen = (p: { x: number; y: number }) => p; // doc==screen for the test

describe("computeAnchor", () => {
  it("centers the panel horizontally over the bbox and places it above by margin", () => {
    const a = computeAnchor({
      bboxDoc: [
        { x: 100, y: 100 },
        { x: 200, y: 160 },
      ],
      docToScreen: idScreen,
      panelSize: { w: 40, h: 20 },
      viewport: { w: 1000, h: 1000 },
      margin: 10,
    });
    // centerX = 150 → x = 150 - 20 = 130; aboveY = 100 - 10 - 20 = 70
    expect(a).toEqual({ x: 130, y: 70 });
  });

  it("drops below the bbox when there is no room above", () => {
    const a = computeAnchor({
      bboxDoc: [
        { x: 100, y: 5 },
        { x: 200, y: 40 },
      ],
      docToScreen: idScreen,
      panelSize: { w: 40, h: 20 },
      viewport: { w: 1000, h: 1000 },
      margin: 10,
    });
    // aboveY = 5 - 10 - 20 = -25 < margin → belowY = 40 + 10 = 50
    expect(a.y).toBe(50);
  });

  it("clamps x within the viewport margins", () => {
    const a = computeAnchor({
      bboxDoc: [
        { x: 0, y: 100 },
        { x: 10, y: 120 },
      ],
      docToScreen: idScreen,
      panelSize: { w: 200, h: 20 },
      viewport: { w: 300, h: 1000 },
      margin: 10,
    });
    expect(a.x).toBe(10); // clamped to left margin
  });
});
