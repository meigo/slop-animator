import { describe, expect, it } from "vitest";
import { pasteRoute, type PasteContext } from "../anim/paste-precedence";

const ctx = (o: Partial<PasteContext> = {}): PasteContext => ({
  selectTool: false,
  pixelPasteReady: false,
  hasCellClipboard: false,
  ...o,
});

describe("pasteRoute", () => {
  it("falls back to the image route when nothing in-app can take the paste", () => {
    expect(pasteRoute(ctx())).toBe("image");
  });

  it("pastes pixels when Select/Lasso is active and a writable target is ready", () => {
    expect(pasteRoute(ctx({ selectTool: true, pixelPasteReady: true }))).toBe("pixels");
  });

  it("ignores the pixel clipboard under a non-select tool", () => {
    expect(pasteRoute(ctx({ selectTool: false, pixelPasteReady: true }))).toBe("image");
  });

  it("does not claim the pixel route when the target cannot be written", () => {
    // Locked/hidden layer, a reference layer, or a non-layer working row: `pasteSelection()` would
    // decline, so the keystroke must fall through instead of being reported as consumed.
    expect(pasteRoute(ctx({ selectTool: true, pixelPasteReady: false }))).toBe("image");
  });

  it("pastes cells when there is no pixel route", () => {
    expect(pasteRoute(ctx({ hasCellClipboard: true }))).toBe("cells");
  });

  it("prefers pixels over cells when both are available", () => {
    expect(
      pasteRoute(ctx({ selectTool: true, pixelPasteReady: true, hasCellClipboard: true })),
    ).toBe("pixels");
  });

  it("falls through to cells when the pixel route is unavailable for either reason", () => {
    expect(pasteRoute(ctx({ selectTool: true, hasCellClipboard: true }))).toBe("cells");
    expect(pasteRoute(ctx({ pixelPasteReady: true, hasCellClipboard: true }))).toBe("cells");
  });

  it("is a pure function of the context — the same input never changes its answer", () => {
    // The whole point of the rewrite: the old flag was set by one event and read by another, so a
    // suppressed `paste` left it armed for the NEXT keystroke. Asking twice must answer the same.
    const c = ctx({ hasCellClipboard: true });
    expect(pasteRoute(c)).toBe("cells");
    expect(pasteRoute(c)).toBe("cells");
  });
});
