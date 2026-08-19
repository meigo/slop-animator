import type { Cell } from "../anim/document";

/**
 * Per-frame timeline glyphs for one cell track, computed in a single O(frames) forward pass:
 *   "◆" = keyframe with ink · "◇" = blank keyframe · "—" = hold continuing an inked key · "" = blank.
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
