import { describe, it, expect } from "vitest";
import { computeTimelineSpans } from "../lib/timeline-spans";

describe("computeTimelineSpans", () => {
  it("an inked key with holds is one span covering all of them", () => {
    expect(computeTimelineSpans(["◆", "—", "—"])).toEqual([
      { startFrame: 0, endFrame: 2, blank: false },
    ]);
  });

  it("a lone key with no holds is a one-frame span", () => {
    expect(computeTimelineSpans(["◆"])).toEqual([{ startFrame: 0, endFrame: 0, blank: false }]);
  });

  it("back-to-back keys are separate spans, not one run", () => {
    expect(computeTimelineSpans(["◆", "◆", "—"])).toEqual([
      { startFrame: 0, endFrame: 0, blank: false },
      { startFrame: 1, endFrame: 2, blank: false },
    ]);
  });

  it("a blank key is its own one-frame span and ends the run before it", () => {
    // ◇ is a real keyframe boundary with no content: the ink stops here.
    expect(computeTimelineSpans(["◆", "—", "◇", ""])).toEqual([
      { startFrame: 0, endFrame: 1, blank: false },
      { startFrame: 2, endFrame: 2, blank: true },
    ]);
  });

  it("leading blank frames produce no span", () => {
    expect(computeTimelineSpans(["", "", "◆", "—"])).toEqual([
      { startFrame: 2, endFrame: 3, blank: false },
    ]);
  });

  it("a run continuing past the stored track is one span to the end", () => {
    // computeTimelineGlyphs emits — past the track for an inked key; a span must not stop early.
    expect(computeTimelineSpans(["◆", "—", "—", "—", "—"])).toEqual([
      { startFrame: 0, endFrame: 4, blank: false },
    ]);
  });

  it("an empty track produces no spans", () => {
    expect(computeTimelineSpans([])).toEqual([]);
    expect(computeTimelineSpans(["", "", ""])).toEqual([]);
  });
});
