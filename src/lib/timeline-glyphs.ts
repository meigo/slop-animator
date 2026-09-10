import type { Cell } from "../anim/document";

/**
 * Per-frame timeline glyphs for one cell track, computed in a single O(frames) forward pass:
 *   "◆" = keyframe with ink · "◇" = blank keyframe · "—" = hold continuing an inked key · "" = blank
 *   · "↺" = loop key (its region is "", drawn as ghosts).
 *
 * Replaces a per-cell `resolveKeyframeIndex` backward scan (O(frames²) and, over a reactive
 * `$state` proxy, very expensive). Reads each cell once; `isEmpty` is called once per key cell.
 *
 * `frameCount` is the document length (≥ the track length). Past the track an inked key
 * keeps holding (`—`); a blank key (◇) is what stops the hold. `isEmpty(canvas)` reports
 * whether a key cell's canvas has no ink.
 */
export function computeTimelineGlyphs(
  cells: Cell[],
  frameCount: number,
  isEmpty: (canvas: HTMLCanvasElement) => boolean,
): string[] {
  const out: string[] = new Array(frameCount);
  let hasKey = false; // a key has been seen at or before this frame
  let inkedKey = false; // the current resolved key has ink
  for (let f = 0; f < frameCount; f++) {
    const cell = f < cells.length ? cells[f] : undefined;
    if (cell && cell.kind === "loop") {
      // A loop ends the run before it; the frames it plays are drawn as ghosts
      // (`computeLoopGhostSpans`), so the solid track is blank across them.
      hasKey = true;
      inkedKey = false;
      out[f] = "↺";
      continue;
    }
    if (cell && cell.kind === "key") {
      hasKey = true;
      inkedKey = !isEmpty(cell.canvas);
    }
    if (!hasKey) {
      out[f] = "";
      continue;
    }
    if (!cell) {
      out[f] = inkedKey ? "—" : "";
      continue;
    }
    const keyHere = cell.kind === "key";
    out[f] = inkedKey ? (keyHere ? "◆" : "—") : keyHere ? "◇" : "";
  }
  return out;
}

/**
 * Re-resolve a glyph array that has been PATCHED cell by cell, so holds mean what they would mean
 * after the edit lands.
 *
 * `Timeline.svelte`'s block-drag preview (`displayGlyph`) builds its array per cell: the moved range
 * shows the glyph sliding into it, the vacated range is blanked. Blanking is right only where nothing
 * follows — a vacated cell INSIDE a hold run still holds the inked key before it, which is exactly
 * what the drop produces (`moveBlockFrames` → `deleteBlock` writes holds, and a hold after an inked
 * key renders `—`). Without this pass, dragging a blank key RIGHT left `""` in the gap, so the span
 * did not grow to follow it until the pointer was released; dragging LEFT looked fine only because
 * shortening needs no re-resolution. Reported 2026-09-09.
 *
 * The rule is `computeTimelineGlyphs`' rule, applied to glyphs instead of cells: `◆` and `◇` are the
 * keys, everything else is a hold, and a hold shows `—` only while the resolved key is inked. Running
 * it on well-formed output is a NO-OP — asserted in the tests, and the reason it can be applied
 * unconditionally rather than only while dragging.
 */
export function resolveGlyphHolds(glyphs: string[]): string[] {
  const out: string[] = new Array(glyphs.length);
  let hasKey = false;
  let inkedKey = false;
  for (let f = 0; f < glyphs.length; f++) {
    const g = glyphs[f];
    if (g === "↺") {
      hasKey = true;
      inkedKey = false;
      out[f] = g;
      continue;
    }
    if (g === "◆" || g === "◇") {
      hasKey = true;
      inkedKey = g === "◆";
      out[f] = g;
      continue;
    }
    out[f] = hasKey && inkedKey ? "—" : "";
  }
  return out;
}
