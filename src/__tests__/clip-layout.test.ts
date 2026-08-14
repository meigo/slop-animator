import { describe, it, expect } from "vitest";
import { videoClipLayout, offsetAfterClipDrag } from "../anim/clip-layout";

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
});
