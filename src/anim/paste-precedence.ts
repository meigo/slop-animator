/** Which of the app's three paste handlers owns a Cmd+V.
 *
 *  The three are mutually exclusive and strictly ordered — pixel float, then timeline cells, then
 *  an image file from the OS clipboard (which becomes a new reference layer). The order is the
 *  specific-to-general one: pixels need the Select/Lasso tool AND a writable drawing target, cells
 *  need only an in-app cell copy, and the image route is the fallback that asks the system.
 *
 *  This exists as a PURE function because the answer is needed twice for the same keystroke — once
 *  in `keydown` (which performs the paste) and once in the window `paste` event (which must not
 *  also image-paste a keystroke the keydown already consumed). It used to be answered once and
 *  carried across the two events in a `cellPasteHandled` flag; that flag was cleared by the `paste`
 *  event, which a consumed keystroke's `preventDefault()` suppresses — so it survived its own
 *  keystroke and could swallow the NEXT Cmd+V, one the user meant as an image paste. Deriving the
 *  answer from clipboard state at each event has no such window. */
export type PasteRoute = "pixels" | "cells" | "image";

export interface PasteContext {
  /** Select or Lasso is active — the only tools that paste the pixel clipboard. */
  selectTool: boolean;
  /** The pixel clipboard has content AND the active row is a writable drawing layer, i.e.
   *  `Canvas.pasteSelection()` would actually succeed. Both halves matter: on a locked/hidden
   *  layer, a reference layer or a non-layer row the pixel paste declines, and the keystroke has to
   *  fall through to the routes below rather than being reported as consumed. */
  pixelPasteReady: boolean;
  /** The timeline cell clipboard has content. Note this route does NOT additionally require a
   *  writable destination: `pasteCells` does its own per-row skipping, and the keystroke is
   *  consumed either way — matching what the keyboard handler has always done. */
  hasCellClipboard: boolean;
}

export function pasteRoute(c: PasteContext): PasteRoute {
  if (c.selectTool && c.pixelPasteReady) return "pixels";
  if (c.hasCellClipboard) return "cells";
  return "image";
}
