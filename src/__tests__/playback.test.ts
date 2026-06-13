import { describe, it, expect } from "vitest";
import { advancePlayhead, Playback } from "../anim/playback";

describe("advancePlayhead", () => {
  it("advances to the next frame mid-timeline", () => {
    expect(advancePlayhead(1, 5, true)).toEqual({ frame: 2, stop: false });
  });
  it("wraps to 0 at the end when looping", () => {
    expect(advancePlayhead(4, 5, true)).toEqual({ frame: 0, stop: false });
  });
  it("stops at the end when not looping", () => {
    expect(advancePlayhead(4, 5, false)).toEqual({ frame: 4, stop: true });
  });
});

function harness(opts: { fps: number; frameCount: number; loop: boolean; start?: number }) {
  let current = opts.start ?? 0;
  let playing = true;
  const pb = new Playback({
    getFps: () => opts.fps,
    getFrameCount: () => opts.frameCount,
    getLoop: () => opts.loop,
    getCurrent: () => current,
    setFrame: (f) => { current = f; },
    onPlayingChange: (p) => { playing = p; },
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
