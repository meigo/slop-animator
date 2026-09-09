import { describe, it, expect } from "vitest";
import { computeTimelineSpans } from "../lib/timeline-spans";

describe("computeTimelineSpans", () => {
  it("an inked key with holds is one span covering all of them", () => {
    expect(computeTimelineSpans(["◆", "—", "—"])).toEqual([
      { startFrame: 0, endFrame: 2, blank: false, keyFrames: [0] },
    ]);
  });

  it("a lone key is a one-frame span", () => {
    expect(computeTimelineSpans(["◆"])).toEqual([
      { startFrame: 0, endFrame: 0, blank: false, keyFrames: [0] },
    ]);
  });

  // INVERTED on 2026-09-09. Adjacent inked keys used to break the run into one span each, so a
  // character drawn on 1s read as a row of disconnected blocks rather than as one animated thing.
  // Only a blank key (or running out of content) ends a run now; the keys inside it are marked, not
  // separated.
  it("back-to-back keys are ONE run, marked at each key", () => {
    expect(computeTimelineSpans(["◆", "◆", "—"])).toEqual([
      { startFrame: 0, endFrame: 2, blank: false, keyFrames: [0, 1] },
    ]);
  });

  it("keys separated by holds still merge into one run", () => {
    expect(computeTimelineSpans(["◆", "—", "◆", "—", "◆"])).toEqual([
      { startFrame: 0, endFrame: 4, blank: false, keyFrames: [0, 2, 4] },
    ]);
  });

  it("a blank key is its own one-frame span and ends the run before it", () => {
    // ◇ is a real keyframe boundary with no content: the ink stops here.
    expect(computeTimelineSpans(["◆", "—", "◇", ""])).toEqual([
      { startFrame: 0, endFrame: 1, blank: false, keyFrames: [0] },
      { startFrame: 2, endFrame: 2, blank: true, keyFrames: [] },
    ]);
  });

  // The only thing that splits a run. Without a blank key between them, the two groups of keys
  // would be one span — which is the whole point of the merge.
  it("a blank key SPLITS what would otherwise be one run", () => {
    expect(computeTimelineSpans(["◆", "◆", "◇", "◆", "◆"])).toEqual([
      { startFrame: 0, endFrame: 1, blank: false, keyFrames: [0, 1] },
      { startFrame: 2, endFrame: 2, blank: true, keyFrames: [] },
      { startFrame: 3, endFrame: 4, blank: false, keyFrames: [3, 4] },
    ]);
  });

  it("back-to-back blank keys stay separate one-frame spans", () => {
    expect(computeTimelineSpans(["◇", "◇"])).toEqual([
      { startFrame: 0, endFrame: 0, blank: true, keyFrames: [] },
      { startFrame: 1, endFrame: 1, blank: true, keyFrames: [] },
    ]);
  });

  it("leading blank frames produce no span", () => {
    expect(computeTimelineSpans(["", "", "◆", "—"])).toEqual([
      { startFrame: 2, endFrame: 3, blank: false, keyFrames: [2] },
    ]);
  });

  it("a run continuing past the stored track keeps holding", () => {
    expect(computeTimelineSpans(["◆", "—", "—", "—", "—"])).toEqual([
      { startFrame: 0, endFrame: 4, blank: false, keyFrames: [0] },
    ]);
  });

  it("an empty track has no spans", () => {
    expect(computeTimelineSpans([])).toEqual([]);
    expect(computeTimelineSpans(["", "", ""])).toEqual([]);
  });
});
