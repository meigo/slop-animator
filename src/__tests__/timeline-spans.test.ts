import { describe, it, expect } from "vitest";
import { computeTimelineSpans } from "../lib/timeline-spans";
import { resolveGlyphHolds } from "../lib/timeline-glyphs";

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

  // `computeTimelineGlyphs` emits — past the end of the STORED track for an inked key (it keeps
  // holding to the document length), so a span must not stop early at `cells.length`. Not
  // redundant with the first test: that one pins the merge, this one pins the producer's rule.
  it("a run continuing past the stored track keeps holding", () => {
    expect(computeTimelineSpans(["◆", "—", "—", "—", "—"])).toEqual([
      { startFrame: 0, endFrame: 4, blank: false, keyFrames: [0] },
    ]);
  });

  // NOT reachable from `computeTimelineGlyphs`, but very much reachable from `Timeline.svelte`'s
  // block-drag preview (`displayGlyph`), which blanks the vacated source range and leaves the holds
  // that followed the dragged key stranded. Without the `if (run)` guard in the — branch this throws
  // `Cannot set properties of null` inside a render function, mid-gesture. This test is what stops
  // that guard being deleted as unreachable — it is not.
  it("a stranded hold with no key before it produces no span (drag-preview glyphs)", () => {
    expect(computeTimelineSpans(["—", "—"])).toEqual([]);
    expect(computeTimelineSpans(["", "—", "◆", "—"])).toEqual([
      { startFrame: 2, endFrame: 3, blank: false, keyFrames: [2] },
    ]);
  });

  // The block-drag preview, end to end. A key at 0 holding to 3 with a blank key at 4, dragged +2:
  // `displayGlyph` blanks the vacated cell and leaves the one after it empty, so the raw preview
  // stops the span at 3 — the span visibly refused to follow the key until the pointer was released
  // (reported 2026-09-09). Re-resolved, the gap holds and the span reaches the moved key.
  it("a dragged blank key drags the span with it (preview)", () => {
    const rawPreview = ["◆", "—", "—", "—", "", "", "◇"];
    expect(computeTimelineSpans(rawPreview)).toEqual([
      { startFrame: 0, endFrame: 3, blank: false, keyFrames: [0] },
      { startFrame: 6, endFrame: 6, blank: true, keyFrames: [] },
    ]);
    expect(computeTimelineSpans(resolveGlyphHolds(rawPreview))).toEqual([
      { startFrame: 0, endFrame: 5, blank: false, keyFrames: [0] },
      { startFrame: 6, endFrame: 6, blank: true, keyFrames: [] },
    ]);
  });

  it("an empty track has no spans", () => {
    expect(computeTimelineSpans([])).toEqual([]);
    expect(computeTimelineSpans(["", "", ""])).toEqual([]);
  });
});
