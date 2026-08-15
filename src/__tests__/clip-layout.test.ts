import { describe, it, expect } from "vitest";
import {
  videoClipLayout,
  offsetAfterClipDrag,
  rangeAfterSlide,
  rangeAfterTrim,
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
