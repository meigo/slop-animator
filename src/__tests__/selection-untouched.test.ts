import { describe, it, expect } from "vitest";
import { Selection } from "../core/selection";

globalThis.cancelAnimationFrame ??= () => {};
globalThis.requestAnimationFrame ??= () => 0;

function selection(): Selection {
  // Entering a warp draws the mesh: that reads the context's transform and canvas size.
  const ctx = new Proxy(
    {},
    {
      get: (_t, k) => {
        if (k === "getTransform") return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
        if (k === "canvas") return { width: 0, height: 0 };
        return () => {};
      },
    },
  );
  // …and caches the warped picture in a canvas of its own (review 2026-10-17 #28).
  (globalThis as { document?: unknown }).document ??= {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  };
  return new Selection({ getContext: () => ctx } as unknown as HTMLCanvasElement);
}
const pixels = {} as HTMLCanvasElement;

/** A lift of a 100×80 box at (10, 20), entered into a warp grid the way Deform does. */
function liftedWarp(rows = 4, cols = 4): Selection {
  const s = selection();
  s.rect = { x: 10, y: 20, w: 100, h: 80 };
  s.beginTransform(pixels);
  s.beginWarp(rows, cols);
  return s;
}

// Review 2026-10-17 #21: Enter / ✓ on an untouched Deform or Distort/Mesh re-rendered the cell
// through the mesh and pushed an undo step, which wiped the redo stack.
describe("Selection.untouchedLift for a warp", () => {
  it("a fresh warp grid is untouched", () => {
    expect(liftedWarp().untouchedLift).toBe(true);
  });

  it("a denser or coarser grid of an untouched warp is still untouched", () => {
    const s = liftedWarp(4, 4);
    s.densifyWarp(8, 8);
    expect(s.untouchedLift).toBe(true);
    s.densifyWarp(3, 5);
    expect(s.untouchedLift).toBe(true);
  });

  it("a moved grid point, or the whole grid moved, is an edit", () => {
    const s = liftedWarp(2, 2);
    expect(s.hitTest(10, 20)).toBe("grid");
    s.startDrag("grid", 10, 20);
    s.updateDrag(14, 22);
    s.endDrag();
    expect(s.untouchedLift).toBe(false);

    const m = liftedWarp(2, 2);
    m.startDrag("move", 50, 50);
    m.updateDrag(51, 50);
    m.endDrag();
    expect(m.untouchedLift).toBe(false);
  });

  it("a point dragged away and back is untouched again (the picture is the lift)", () => {
    const s = liftedWarp(2, 2);
    expect(s.hitTest(10, 20)).toBe("grid");
    s.startDrag("grid", 10, 20);
    s.updateDrag(30, 40);
    s.updateDrag(10, 20);
    s.endDrag();
    expect(s.untouchedLift).toBe(true);
  });

  it("a warp entered from a moved Free transform is an edit", () => {
    const s = selection();
    s.rect = { x: 10, y: 20, w: 100, h: 80 };
    s.beginTransform(pixels);
    s.startDrag("move", 50, 50);
    s.updateDrag(60, 50);
    s.endDrag();
    s.beginWarp(2, 2);
    expect(s.untouchedLift).toBe(false);
  });

  it("a pasted float is never untouched, warped or not", () => {
    const s = selection();
    s.pasteFloat(pixels, { x: 0, y: 0, w: 20, h: 20 });
    expect(s.untouchedLift).toBe(false);
    s.beginWarp(2, 2);
    expect(s.untouchedLift).toBe(false);
  });
});
