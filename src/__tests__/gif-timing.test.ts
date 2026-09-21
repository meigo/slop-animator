import { describe, it, expect } from "vitest";
import { appendGifDelay, gifFrameDelays, GIF_MAX_DELAY_CS } from "../export/gif-timing";

const total = (d: number[]) => d.reduce((a, b) => a + b, 0);

describe("appendGifDelay", () => {
  it("keeps a short run as one pending delay", () => {
    expect(appendGifDelay(8, 9)).toEqual({ write: [], pending: 17 });
  });
  it("splits a run that would overflow the 16-bit centisecond field", () => {
    expect(appendGifDelay(GIF_MAX_DELAY_CS - 5, 10)).toEqual({
      write: [GIF_MAX_DELAY_CS],
      pending: 5,
    });
  });
  it("emits several max-length frames for a very long hold", () => {
    expect(appendGifDelay(0, GIF_MAX_DELAY_CS * 2 + 3)).toEqual({
      write: [GIF_MAX_DELAY_CS, GIF_MAX_DELAY_CS],
      pending: 3,
    });
  });
});

describe("gifFrameDelays", () => {
  it("is exact when the fps divides 100 evenly", () => {
    expect(gifFrameDelays(5, 25)).toEqual([4, 4, 4, 4, 4]);
    expect(gifFrameDelays(5, 20)).toEqual([5, 5, 5, 5, 5]);
    expect(gifFrameDelays(3, 10)).toEqual([10, 10, 10]);
  });

  // The reason this function exists: one rounded delay for every frame makes a 12fps shot play 4%
  // fast (8 hundredths instead of 8.33), so five seconds becomes 4.8 and drifts against whatever
  // the artist is matching.
  it("keeps the TRUE duration at 12fps by alternating, not rounding every frame the same", () => {
    const d = gifFrameDelays(60, 12);
    expect(total(d)).toBe(500); // 60 frames at 12fps = exactly 5.00s
    expect(new Set(d)).toEqual(new Set([8, 9])); // only ever one hundredth apart
  });

  it("keeps the true duration at 24fps too", () => {
    expect(total(gifFrameDelays(48, 24))).toBe(200);
  });

  it("never drifts more than a hundredth from the ideal at any point", () => {
    for (const fps of [12, 24, 15, 30, 7]) {
      let run = 0;
      gifFrameDelays(40, fps).forEach((d, i) => {
        run += d;
        expect(Math.abs(run - ((i + 1) * 100) / fps)).toBeLessThanOrEqual(0.5);
      });
    }
  });

  // A 0 delay is not "as fast as possible": browsers treat 0 (and 1, historically) as "unspecified"
  // and substitute 10 hundredths, i.e. a 10fps crawl — the opposite of what the number says.
  it("never emits 0, however high the fps", () => {
    for (const d of gifFrameDelays(20, 200)) expect(d).toBeGreaterThanOrEqual(1);
  });

  it("handles a single frame and an empty range", () => {
    expect(gifFrameDelays(1, 12)).toEqual([8]);
    expect(gifFrameDelays(0, 12)).toEqual([]);
  });
});
