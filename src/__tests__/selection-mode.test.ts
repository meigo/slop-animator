import { describe, it, expect } from "vitest";
import { Selection } from "../core/selection";

// Node has no animation frames; the selection's cancel path clears a pending one.
globalThis.cancelAnimationFrame ??= () => {};

/** A Selection over a stub overlay: these tests read its state, never its drawing. */
function selection(): Selection {
  const ctx = new Proxy({}, { get: () => () => {} });
  return new Selection({ getContext: () => ctx } as unknown as HTMLCanvasElement);
}

describe("Selection.startCreate", () => {
  it("takes its shape from the tool that starts it, whatever the last float left", () => {
    // A paste (`pasteFloat`) leaves the mode "rect" while the Lasso tool stays active: the next
    // Lasso drag drew a rectangle (roadmap 13d, slop-paint's review).
    const s = selection();
    s.mode = "rect";
    s.startCreate(10, 10, "lasso");
    expect(s.mode).toBe("lasso");
    s.startCreate(10, 10, "rect");
    expect(s.mode).toBe("rect");
  });
});

// Review 2026-10-17 #14: a Rigid pin records where its point was pinned; a whole-grid move or an
// FFD drag of a pinned point moved the grid without it, so the next Rigid drag pulled every stale
// pin (and the art) back to where it had been.
describe("Rigid pins follow the grid", () => {
  globalThis.requestAnimationFrame ??= () => 0;
  function warping(): Selection {
    const s = selection();
    s.state = "warping";
    s.rect = { x: 0, y: 0, w: 100, h: 100 };
    s.warpRows = 2;
    s.warpCols = 2;
    s.warpGrid = [
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ],
    ];
    s.deformMode = "rigid";
    s.pinned.set(0, { x: 0, y: 0 });
    return s;
  }

  it("a whole-grid move carries the pins along", () => {
    const s = warping();
    s.startDrag("move", 50, 50);
    s.updateDrag(150, 60);
    s.endDrag();
    expect(s.pinned.get(0)).toEqual({ x: 100, y: 10 });
  });

  it("an FFD drag of a pinned point moves its pin", () => {
    const s = warping();
    s.setDeformMode("ffd");
    expect(s.pinned.get(0)).toEqual({ x: 0, y: 0 }); // pins survive the mode switch
    expect(s.hitTest(0, 0)).toBe("grid");
    s.startDrag("grid", 0, 0);
    s.updateDrag(-20, 5);
    s.endDrag();
    expect(s.pinned.get(0)).toEqual({ x: -20, y: 5 });
  });

  it("the next Rigid drag keeps the moved pin where it now is", () => {
    const s = warping();
    s.startDrag("move", 50, 50);
    s.updateDrag(150, 50);
    s.endDrag();
    expect(s.hitTest(200, 100)).toBe("grid");
    s.startDrag("grid", 200, 100);
    s.updateDrag(205, 100);
    expect(s.warpGrid[0][0].x).toBeCloseTo(100, 6); // was yanked back to 0
    expect(s.warpGrid[0][0].y).toBeCloseTo(0, 6);
  });
});
