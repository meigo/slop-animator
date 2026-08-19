import { describe, it, expect } from "vitest";
import {
  videoClipLayout,
  offsetAfterClipDrag,
  rangeAfterSlide,
  rangeAfterTrim,
  trimDeltaToPlayhead,
  trimVideoHead,
  trimVideoTail,
  videoWantedTime,
  videoClipOriginOffset,
  VIDEO_MIN_TRIM_FRAMES,
} from "../anim/clip-layout";

describe("videoClipLayout", () => {
  it("offset 0, speed 1 → starts at 0, span is ceil(duration*fps)", () => {
    expect(videoClipLayout(0, 1, 2, 12)).toEqual({ startFrame: 0, spanFrames: 24 });
  });

  it("positive in-point shifts the block left (inverted vs audio)", () => {
    // 12 frames into the video at timeline 0, 1× → left edge at -12
    expect(videoClipLayout(12, 1, 2, 12).startFrame).toBe(-12);
  });

  it("negative offset starts the clip after frame 0", () => {
    expect(videoClipLayout(-24, 1, 2, 12).startFrame).toBe(24);
  });

  it("speed 2 halves the span and the start shift", () => {
    // offset 12 at 2× → start = round(-12/2) = -6; span = ceil(2*12/2) = 12
    expect(videoClipLayout(12, 2, 2, 12)).toEqual({ startFrame: -6, spanFrames: 12 });
  });

  it("speed <= 0 is treated as 1", () => {
    expect(videoClipLayout(0, 0, 1, 12).spanFrames).toBe(12);
    expect(videoClipLayout(0, -2, 1, 12).spanFrames).toBe(12);
  });

  it("zero duration → 0 span", () => {
    expect(videoClipLayout(0, 1, 0, 12).spanFrames).toBe(0);
  });

  it("absent trim leaves the untrimmed layout unchanged", () => {
    expect(videoClipLayout(0, 1, 2, 12, {})).toEqual(videoClipLayout(0, 1, 2, 12));
    expect(videoClipLayout(12, 2, 2, 12, {})).toEqual(videoClipLayout(12, 2, 2, 12));
  });

  it("a kept length shortens the span; start still comes from offset", () => {
    // 2s × 12fps = 24 source frames. Keep 12 at 1× → 12 project frames, start still 0.
    expect(videoClipLayout(0, 1, 2, 12, { trimInFrames: 0, trimLenFrames: 12 })).toEqual({
      startFrame: 0,
      spanFrames: 12,
    });
  });

  it("head-trimmed offset (moved with trimIn) places the kept start", () => {
    // trimIn 6, offset -6 (the pair trimVideoHead writes): start = 6, span = 12.
    expect(videoClipLayout(-6, 1, 2, 12, { trimInFrames: 6, trimLenFrames: 12 })).toEqual({
      startFrame: 6,
      spanFrames: 12,
    });
  });

  it("speed 2 halves a trimmed span too", () => {
    // 12 source frames at 2× → 6 project frames
    expect(videoClipLayout(0, 2, 2, 12, { trimInFrames: 0, trimLenFrames: 12 })).toEqual({
      startFrame: 0,
      spanFrames: 6,
    });
  });
});

describe("offsetAfterClipDrag", () => {
  it("dragging right increases start (lowers offset at 1×)", () => {
    expect(offsetAfterClipDrag(0, 10, 1)).toBe(-10);
  });

  it("scales by speed so one timeline frame stays one visual step", () => {
    expect(offsetAfterClipDrag(-6, 2, 2)).toBe(8); // start -4 at 2× → offset = 4*2
  });

  it("speed <= 0 is treated as 1", () => {
    expect(offsetAfterClipDrag(0, 5, 0)).toBe(-5);
  });

  // Documents why Timeline.clipMove must no-op when delta === 0: layout→offset
  // through startFrame is not an identity when offset is not a multiple of speed.
  it("zero-delta recompute is lossy when offset is not a multiple of speed", () => {
    const offset = 1;
    const speed = 1.5;
    const { startFrame } = videoClipLayout(offset, speed, 2, 12);
    // startFrame = round(-1/1.5) = -1; reverse: -(-1)*1.5 = 1.5 ≠ 1
    expect(offsetAfterClipDrag(startFrame, 0, speed)).not.toBe(offset);
    expect(offsetAfterClipDrag(startFrame, 0, speed)).toBe(1.5);
  });
});

describe("rangeAfterSlide", () => {
  it("slides both edges, preserving length", () => {
    expect(rangeAfterSlide({ start: 4, end: 9 }, 3)).toEqual({ start: 7, end: 12 });
    expect(rangeAfterSlide({ start: 4, end: 9 }, -2)).toEqual({ start: 2, end: 7 });
  });

  it("clamps the start at frame 0 WITHOUT shrinking the span", () => {
    expect(rangeAfterSlide({ start: 2, end: 7 }, -10)).toEqual({ start: 0, end: 5 });
  });

  it("may slide past the last frame (the strip sizes for it)", () => {
    expect(rangeAfterSlide({ start: 0, end: 3 }, 1000)).toEqual({ start: 1000, end: 1003 });
  });
});

describe("rangeAfterTrim", () => {
  it("trims the start edge", () => {
    expect(rangeAfterTrim({ start: 4, end: 9 }, "start", 2)).toEqual({ start: 6, end: 9 });
  });

  it("trims the end edge", () => {
    expect(rangeAfterTrim({ start: 4, end: 9 }, "end", -3)).toEqual({ start: 4, end: 6 });
  });

  it("never shrinks below a single frame, from either edge", () => {
    expect(rangeAfterTrim({ start: 4, end: 9 }, "start", 99)).toEqual({ start: 9, end: 9 });
    expect(rangeAfterTrim({ start: 4, end: 9 }, "end", -99)).toEqual({ start: 4, end: 4 });
  });

  it("clamps the start edge at frame 0 but lets the end run past the project", () => {
    expect(rangeAfterTrim({ start: 4, end: 9 }, "start", -99)).toEqual({ start: 0, end: 9 });
    expect(rangeAfterTrim({ start: 4, end: 9 }, "end", 500)).toEqual({ start: 4, end: 509 });
  });
});

describe("trimDeltaToPlayhead", () => {
  // A clip occupying project frames 10..29 (start 10, length 20, so its inclusive end is 29).
  const clip = { startFrame: 10, lengthFrames: 20 };

  it("start: the delta moves the head onto the playhead", () => {
    expect(trimDeltaToPlayhead("start", 15, clip)).toBe(5); // 10 -> 15
    expect(trimDeltaToPlayhead("start", 4, clip)).toBe(-6); // dragging the head back out
    expect(trimDeltaToPlayhead("start", 10, clip)).toBe(0); // already there
  });

  it("end: the delta keeps the playhead's OWN frame — the end is inclusive", () => {
    // Trimming the end to frame 19 must leave frames 10..19, i.e. length 10, so delta = -10.
    expect(trimDeltaToPlayhead("end", 19, clip)).toBe(-10);
    // Trimming to the clip's existing last frame (29) must be a no-op, NOT a one-frame change.
    expect(trimDeltaToPlayhead("end", 29, clip)).toBe(0);
    expect(trimDeltaToPlayhead("end", 35, clip)).toBe(6); // extending the tail
  });

  it("end on a single-frame clip resolves to zero at its own frame", () => {
    expect(trimDeltaToPlayhead("end", 7, { startFrame: 7, lengthFrames: 1 })).toBe(0);
  });
});

describe("trimVideoHead", () => {
  const EXTENT = 24; // 2s at 12fps

  it("at 1× moves offset opposite trimIn so the kept picture stays put", () => {
    // Drag the head 6 project frames right: skip 6 source frames, start later, same pixels at 6.
    const r = trimVideoHead(0, 0, 24, 6, 1, EXTENT);
    expect(r).toEqual({ offsetFrames: -6, trimInFrames: 6, trimLenFrames: 18 });
    expect(videoWantedTime(6, r.offsetFrames, 1, 12, r.trimInFrames)).toBe(
      videoWantedTime(6, 0, 1, 12, 0),
    );
  });

  it("at 2× converts a project-frame delta into speed-scaled source frames", () => {
    // 3 project frames at 2× = 6 source frames. offset -= 6, trimIn += 6.
    const r = trimVideoHead(0, 0, 24, 3, 2, EXTENT);
    expect(r).toEqual({ offsetFrames: -6, trimInFrames: 6, trimLenFrames: 18 });
    expect(videoClipLayout(r.offsetFrames, 2, 2, 12, r).startFrame).toBe(3);
  });

  it("clamps the SOURCE delta, not the two results independently", () => {
    // Dragging past the source start must not move offset without trimIn (that would re-sync).
    const r = trimVideoHead(-6, 6, 18, -99, 1, EXTENT);
    expect(r).toEqual({ offsetFrames: 0, trimInFrames: 0, trimLenFrames: 24 });
    expect(r.offsetFrames + r.trimInFrames).toBe(0);
  });

  it("cannot eat the last source frame", () => {
    const r = trimVideoHead(0, 0, 24, 999, 1, EXTENT);
    expect(r.trimLenFrames).toBe(VIDEO_MIN_TRIM_FRAMES);
    expect(r.trimInFrames + r.trimLenFrames).toBe(24);
  });

  it("a zero delta is a no-op, including on an untrimmed clip", () => {
    expect(trimVideoHead(0, undefined, undefined, 0, 1, EXTENT)).toEqual({
      offsetFrames: 0,
      trimInFrames: 0,
      trimLenFrames: 24,
    });
  });
});

describe("trimVideoTail", () => {
  const EXTENT = 24;

  it("shortens only the kept length", () => {
    expect(trimVideoTail(0, 24, -6, 1, EXTENT)).toEqual({
      trimInFrames: 0,
      trimLenFrames: 18,
    });
  });

  it("at 2× a project-frame delta is speed-scaled", () => {
    expect(trimVideoTail(0, 24, -3, 2, EXTENT)).toEqual({
      trimInFrames: 0,
      trimLenFrames: 18,
    });
  });

  it("cannot shrink below one source frame or grow past the source tail", () => {
    expect(trimVideoTail(0, 24, -999, 1, EXTENT).trimLenFrames).toBe(VIDEO_MIN_TRIM_FRAMES);
    expect(trimVideoTail(6, 12, 999, 1, EXTENT)).toEqual({
      trimInFrames: 6,
      trimLenFrames: 18,
    });
  });
});

describe("videoWantedTime", () => {
  it("untrimmed matches (offset + frame*speed) / fps", () => {
    expect(videoWantedTime(6, 0, 2, 12)).toBe(1);
    expect(videoWantedTime(6, 12, 2, 12)).toBe(2);
  });

  it("adds trimIn as source time so a head trim seeks into the file", () => {
    // After trimVideoHead(0,0,24,6,1,24): offset -6, trimIn 6. At project frame 6:
    // (6 + -6 + 6) / 12 = 0.5s — the same picture untrimmed frame 6 showed.
    expect(videoWantedTime(6, -6, 1, 12, 6)).toBe(0.5);
    expect(videoWantedTime(6, 0, 1, 12, 0)).toBe(0.5);
  });
});

describe("videoClipOriginOffset", () => {
  it("adds trimIn so source frame 0 stays at the pre-trim start", () => {
    // trimVideoHead by 6 at 1×: offset -6, trimIn 6 → origin 0, same as before the trim.
    expect(videoClipOriginOffset(-6, 6)).toBe(0);
    expect(videoClipOriginOffset(0, undefined)).toBe(0);
  });

  it("full-file layout after a head trim still starts where the untrimmed clip did", () => {
    const r = trimVideoHead(0, 0, 24, 6, 1, 24);
    const origin = videoClipOriginOffset(r.offsetFrames, r.trimInFrames);
    expect(videoClipLayout(origin, 1, 2, 12).startFrame).toBe(0);
    expect(videoClipLayout(r.offsetFrames, 1, 2, 12, r).startFrame).toBe(6);
  });
});
