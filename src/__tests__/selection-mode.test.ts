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
