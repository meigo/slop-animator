import { describe, it, expect } from "vitest";
import type { Project } from "../anim/document";
import { syncReferenceVideos } from "../anim/reference";

// Fake <video>: mutable currentTime/paused/duration + a play() spy.
function fakeVid(
  init: Partial<{ currentTime: number; paused: boolean; duration: number; seeking: boolean }> = {},
) {
  return {
    currentTime: init.currentTime ?? 0,
    paused: init.paused ?? true,
    duration: init.duration ?? 10,
    seeking: init.seeking ?? false,
    playCount: 0,
    play() {
      this.playCount++;
      this.paused = false;
      return Promise.resolve();
    },
  };
}
type FakeVid = ReturnType<typeof fakeVid>;
function vidLayer(el: FakeVid, offsetFrames = 0) {
  return { kind: "ref", id: 1, media: { type: "video", el }, offsetFrames } as unknown as never;
}
function proj(layers: unknown[]): Project {
  return { layers } as unknown as Project;
}

describe("syncReferenceVideos", () => {
  it("paused: exact-seeks to (frame+offset)/fps", () => {
    const v = fakeVid();
    syncReferenceVideos(proj([vidLayer(v)]), 12, 12, false); // 12/12 = 1s
    expect(v.currentTime).toBe(1);
  });

  it("paused: no seek when already within epsilon", () => {
    const v = fakeVid({ currentTime: 1 });
    syncReferenceVideos(proj([vidLayer(v)]), 12, 12, false);
    expect(v.currentTime).toBe(1);
    expect(v.playCount).toBe(0);
  });

  it("applies offsetFrames and clamps to [0, duration]", () => {
    const a = fakeVid({ duration: 5 });
    syncReferenceVideos(proj([vidLayer(a, 24)]), 12, 12, false); // (12+24)/12 = 3s
    expect(a.currentTime).toBe(3);
    const b = fakeVid({ duration: 2 });
    syncReferenceVideos(proj([vidLayer(b)]), 120, 12, false); // 10s clamped to 2
    expect(b.currentTime).toBe(2);
    const c = fakeVid();
    syncReferenceVideos(proj([vidLayer(c, -120)]), 12, 12, false); // -9s clamped to 0
    expect(c.currentTime).toBe(0);
  });

  it("playing + within drift: does NOT seek (lets it run)", () => {
    const v = fakeVid({ currentTime: 1.1, paused: false });
    syncReferenceVideos(proj([vidLayer(v)]), 12, 12, true); // wanted 1.0, drift 0.1 < 0.3
    expect(v.currentTime).toBe(1.1);
    expect(v.playCount).toBe(0);
  });

  it("playing + drift > 0.3: re-seeks", () => {
    const v = fakeVid({ currentTime: 5, paused: false });
    syncReferenceVideos(proj([vidLayer(v)]), 12, 12, true); // wanted 1.0, drift 4 > 0.3
    expect(v.currentTime).toBe(1);
  });

  it("playing + paused element: seeks and resumes play()", () => {
    const v = fakeVid({ currentTime: 0, paused: true });
    syncReferenceVideos(proj([vidLayer(v)]), 12, 12, true);
    expect(v.currentTime).toBe(1);
    expect(v.playCount).toBe(1);
    expect(v.paused).toBe(false);
  });

  it("skips non-video / missing layers without error", () => {
    const draw = { kind: "draw", id: 2, cells: [] } as unknown;
    const miss = {
      kind: "ref",
      id: 3,
      media: { type: "missing", was: "video", name: "x" },
      offsetFrames: 0,
    } as unknown;
    expect(() => syncReferenceVideos(proj([draw, miss]), 5, 12, true)).not.toThrow();
  });

  it("does not pile up seeks: skips a scrub seek while one is already in flight", () => {
    const v = fakeVid({ currentTime: 5, seeking: true }); // wants 1.0 but mid-seek
    syncReferenceVideos(proj([vidLayer(v)]), 12, 12, false);
    expect(v.currentTime).toBe(5); // unchanged — no new seek issued (coalesces to latest on seeked)
  });

  it("also skips a drifting playing element while it's mid-seek", () => {
    const v = fakeVid({ currentTime: 5, paused: false, seeking: true });
    syncReferenceVideos(proj([vidLayer(v)]), 12, 12, true);
    expect(v.currentTime).toBe(5);
    expect(v.playCount).toBe(0);
  });
});
