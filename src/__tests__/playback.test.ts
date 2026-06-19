import { describe, it, expect } from "vitest";
import {
  advancePlayhead,
  Playback,
  effectiveRange,
  withRangeIn,
  withRangeOut,
  snapPlayheadToRange,
} from "../anim/playback";

describe("advancePlayhead", () => {
  it("advances to the next frame mid-range", () => {
    expect(advancePlayhead(1, 0, 4, true)).toEqual({ frame: 2, stop: false });
  });
  it("wraps to start at the end when looping", () => {
    expect(advancePlayhead(4, 0, 4, true)).toEqual({ frame: 0, stop: false });
  });
  it("stops at the end when not looping", () => {
    expect(advancePlayhead(4, 0, 4, false)).toEqual({ frame: 4, stop: true });
  });
  it("respects a non-zero start when wrapping", () => {
    expect(advancePlayhead(7, 2, 7, true)).toEqual({ frame: 2, stop: false });
  });
});

function harness(opts: {
  fps: number;
  frameCount: number;
  loop: boolean;
  start?: number;
  rangeStart?: number;
  rangeEnd?: number;
}) {
  let current = opts.start ?? 0;
  let playing = true;
  const pb = new Playback({
    getFps: () => opts.fps,
    getRangeStart: () => opts.rangeStart ?? 0,
    getRangeEnd: () => opts.rangeEnd ?? opts.frameCount - 1,
    getLoop: () => opts.loop,
    getCurrent: () => current,
    setFrame: (f) => {
      current = f;
    },
    onPlayingChange: (p) => {
      playing = p;
    },
  });
  return { pb, frame: () => current, playing: () => playing };
}

describe("Playback.step", () => {
  it("does not advance on the first step (establishes the time baseline)", () => {
    const h = harness({ fps: 10, frameCount: 5, loop: true });
    h.pb.step(0);
    expect(h.frame()).toBe(0);
  });

  it("advances one frame per fps interval of elapsed time", () => {
    const h = harness({ fps: 10, frameCount: 5, loop: true });
    h.pb.step(0);
    h.pb.step(100);
    expect(h.frame()).toBe(1);
    h.pb.step(250);
    expect(h.frame()).toBe(2);
  });

  it("advances multiple frames when a big time gap elapses", () => {
    const h = harness({ fps: 10, frameCount: 10, loop: true });
    h.pb.step(0);
    h.pb.step(300);
    expect(h.frame()).toBe(3);
  });

  it("loops past the end when looping is on", () => {
    const h = harness({ fps: 10, frameCount: 3, loop: true, start: 2 });
    h.pb.step(0);
    h.pb.step(100);
    expect(h.frame()).toBe(0);
  });

  it("stops at the last frame and reports playing=false when not looping", () => {
    const h = harness({ fps: 10, frameCount: 3, loop: false, start: 2 });
    h.pb.step(0);
    h.pb.step(100);
    expect(h.frame()).toBe(2);
    expect(h.playing()).toBe(false);
  });
});

describe("effectiveRange", () => {
  it("null range → full timeline", () => {
    expect(effectiveRange(null, 10)).toEqual({ start: 0, end: 9 });
  });
  it("clamps out past the last frame", () => {
    expect(effectiveRange({ in: 2, out: 99 }, 10)).toEqual({ start: 2, end: 9 });
  });
  it("invalid (in > out after clamp) → full timeline", () => {
    expect(effectiveRange({ in: 8, out: 3 }, 10)).toEqual({ start: 0, end: 9 });
  });
  it("passes a normal in-bounds range through", () => {
    expect(effectiveRange({ in: 3, out: 6 }, 10)).toEqual({ start: 3, end: 6 });
  });
});

describe("withRangeIn / withRangeOut", () => {
  it("setting in on a null range yields a single-frame range", () => {
    expect(withRangeIn(null, 4)).toEqual({ in: 4, out: 4 });
  });
  it("setting out on a null range yields a single-frame range", () => {
    expect(withRangeOut(null, 4)).toEqual({ in: 4, out: 4 });
  });
  it("setting in past out drags out along", () => {
    expect(withRangeIn({ in: 2, out: 5 }, 8)).toEqual({ in: 8, out: 8 });
  });
  it("setting out before in drags in along", () => {
    expect(withRangeOut({ in: 4, out: 9 }, 1)).toEqual({ in: 1, out: 1 });
  });
  it("normal set keeps the other bound", () => {
    expect(withRangeIn({ in: 2, out: 9 }, 4)).toEqual({ in: 4, out: 9 });
    expect(withRangeOut({ in: 2, out: 9 }, 6)).toEqual({ in: 2, out: 6 });
  });
});

describe("snapPlayheadToRange", () => {
  it("returns current when inside the range", () => {
    expect(snapPlayheadToRange(4, 3, 6)).toBe(4);
  });
  it("returns start when before the range", () => {
    expect(snapPlayheadToRange(1, 3, 6)).toBe(3);
  });
  it("returns start when after the range", () => {
    expect(snapPlayheadToRange(8, 3, 6)).toBe(3);
  });
});
