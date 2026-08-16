/** Zero-padded, 1-based PNG filename for frame `i` of `total`. */
export function frameFileName(i: number, total: number): string {
  const pad = Math.max(4, String(total).length);
  return `frame_${String(i + 1).padStart(pad, "0")}.png`;
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
