/** Downsample one channel to `columns` peak amplitudes in [0,1] (max |sample| per bucket). */
export function computePeaks(channel: Float32Array, columns: number): number[] {
  const n = channel.length;
  if (columns <= 0) return [];
  if (n === 0) return new Array(columns).fill(0);
  const bucket = n / columns;
  const peaks: number[] = [];
  for (let c = 0; c < columns; c++) {
    const start = Math.floor(c * bucket);
    const end = Math.min(n, Math.floor((c + 1) * bucket));
    let peak = 0;
    for (let i = start; i < end; i++) {
      const a = Math.abs(channel[i]);
      if (a > peak) peak = a;
    }
    peaks.push(Math.min(1, peak));
  }
  return peaks;
}

/** Number of frame columns the audio occupies at `fps`. */
export function audioFrameSpan(durationSec: number, fps: number): number {
  return Math.max(0, Math.ceil(durationSec * fps));
}

/** Buffer time (seconds) the audio should be at for animation `frame`; clamped >= 0. */
export function bufferOffsetForFrame(frame: number, offsetFrames: number, fps: number): number {
  return Math.max(0, (frame - offsetFrames) / fps);
}
