/** Zero-padded, 1-based PNG filename for frame `i` of `total`. */
export function frameFileName(i: number, total: number): string {
  const pad = Math.max(4, String(total).length);
  return `frame_${String(i + 1).padStart(pad, "0")}.png`;
}

/** Round dimensions down to even values (H.264 / many encoders require even width & height). */
export function evenDimensions(w: number, h: number): { w: number; h: number } {
  return { w: w - (w % 2), h: h - (h % 2) };
}
