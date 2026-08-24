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

  it("stays on the image route across the keydown -> paste pair once a keystroke is declined", () => {
    // The pair `App.svelte` relies on, and the cell the table was missing. keydown asks first and
    // declines (no in-app route); the window `paste` event that follows asks again, from the same
    // state, and must still answer "image" — otherwise it swallows the image the user pasted.
    // That is the shape the old `cellPasteHandled` flag got wrong: it was written by the first
    // event and read by the second, and the preventDefault of a CONSUMED keystroke suppressed the
    // very event that would have cleared it.
    const atKeydown = ctx({ selectTool: true, pixelPasteReady: false, hasCellClipboard: false });
    expect(pasteRoute(atKeydown)).toBe("image");
    expect(pasteRoute({ ...atKeydown })).toBe("image"); // a fresh context, same state, same answer
  });
});
