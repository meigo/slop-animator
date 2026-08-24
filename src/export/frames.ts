/** Digit width to zero-pad a 1-based counter up to `total`, floored at 4 so a short run (e.g. a
 *  single-frame PSD) still reads as `frame_0001` rather than `frame_1`. Shared by the PNG sequence's
 *  own filenames and, since it is the exact same "1-based, padded to the project's frame count"
 *  rule, by the Export dialog's PSD filename. */
export function framePad(total: number): number {
  return Math.max(4, String(total).length);
}

/** Zero-padded, 1-based PNG filename for frame `i` of `total`. */
export function frameFileName(i: number, total: number): string {
  return `frame_${String(i + 1).padStart(framePad(total), "0")}.png`;
}

/**
 * Round dimensions UP to even (H.264 and most encoders require even width & height).
 *
 * Up, not down: rounding down CROPS the last row/column of artwork out of the video, silently and
 * permanently, while the PNG sequence — which has no even requirement and keeps the true document
 * size — still contains it. That mismatch is only reachable on an odd-sized project, which the 1×
 * document scale made possible. Padding costs at most one pixel of background on each axis and
 * loses nothing, so the two exports now agree on content.
 */
export function evenDimensions(w: number, h: number): { w: number; h: number } {
  return { w: w + (w % 2), h: h + (h % 2) };
}
