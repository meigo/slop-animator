/**
 * Per-frame delays for an animated GIF, in whole hundredths of a second.
 *
 * GIF has no sub-hundredth timing, so 12fps (8.33) and 24fps (4.17) cannot be expressed exactly.
 * Rounding every frame identically compounds the error: 60 frames at 12fps would total 4.80s instead
 * of 5.00s — 4% fast, and visibly adrift from any reference the artist is matching.
 *
 * So the delays are derived from the RUNNING TOTAL rather than from one rounded step: each frame gets
 * whatever is left between where the previous frame ended and where this one should end. At 12fps
 * that gives 8, 9, 8, 8, 9, … — never more than half a hundredth from the ideal at any point, and
 * exactly right at the end. Where the fps divides 100 evenly (25, 20, 10) every delay is identical,
 * because the arithmetic says so and not because of a special case.
 */
export function gifFrameDelays(frameCount: number, fps: number): number[] {
  const rate = fps > 0 ? fps : 1;
  const out: number[] = [];
  let emitted = 0; // hundredths already spent by earlier frames
  for (let i = 1; i <= frameCount; i++) {
    const target = Math.round((i * 100) / rate); // where frame `i` should END
    // Floored at 1: a 0 delay does NOT mean "as fast as possible" — browsers read it as unspecified
    // and substitute 10 hundredths, turning a fast GIF into a 10fps one.
    out.push(Math.max(1, target - emitted));
    emitted = target;
  }
  return out;
}
