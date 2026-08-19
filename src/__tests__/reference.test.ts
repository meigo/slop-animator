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
    playbackRate: 1,
    muted: true,
    playCount: 0,
    play() {
      this.playCount++;
      this.paused = false;
      return Promise.resolve();
    },
    pauseCount: 0,
    pause() {
      this.pauseCount++;
      this.paused = true;
    },
  };
}
type FakeVid = ReturnType<typeof fakeVid>;
function vidLayer(
  el: FakeVid,
  offsetFrames = 0,
  speed = 1,
  audioEnabled = false,
  trim: { trimInFrames?: number; trimLenFrames?: number } = {},
) {
  return {
    kind: "ref",
    id: 1,
    media: { type: "video", el },
    offsetFrames,
    speed,
    audioEnabled,
    ...trim,
  } as unknown as never;
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
    // 10s is past the derived span (dur 2s) — Task 3 leaves it untouched rather than clamping to the
    // last frame; see "out-of-span videos" below for the dedicated coverage.
    syncReferenceVideos(proj([vidLayer(b)]), 120, 12, false);
    expect(b.currentTime).toBe(0);
    const c = fakeVid();
    // offset -120 pushes this video's derived span to start at frame 120 (10s of lead-in before the
    // clip's own frame 0 becomes visible), so frame 12 is BEFORE the span, not a negative-wanted
    // clamp — it hits the out-of-span skip and is left untouched (already 0 from fakeVid's default).
    syncReferenceVideos(proj([vidLayer(c, -120)]), 12, 12, false);
    expect(c.currentTime).toBe(0);
  });

  it("playing + within drift: does NOT seek (lets it run)", () => {
    const v = fakeVid({ currentTime: 1.1, paused: false });
    syncReferenceVideos(proj([vidLayer(v)]), 12, 12, true); // wanted 1.0, drift 0.1 < 0.3
    expect(v.currentTime).toBe(1.1);
    expect(v.playCount).toBe(0);
  });

  it("playing + element AHEAD > 0.3 (loop-wrap): re-seeks back", () => {
    const v = fakeVid({ currentTime: 5, paused: false });
    syncReferenceVideos(proj([vidLayer(v)]), 12, 12, true); // wanted 1.0; element 4s ahead → wrap → seek
    expect(v.currentTime).toBe(1);
  });

  it("playing + element BEHIND (forward drift): does NOT seek — free-runs", () => {
    const v = fakeVid({ currentTime: 1, paused: false });
    syncReferenceVideos(proj([vidLayer(v)]), 60, 12, true); // wanted 5.0; element 4s behind → let it run
    expect(v.currentTime).toBe(1); // no corrective seek; smooth audio
    expect(v.playCount).toBe(0);
  });

  it("playing + paused element: seeks and resumes play()", () => {
    const v = fakeVid({ currentTime: 0, paused: true });
    syncReferenceVideos(proj([vidLayer(v)]), 12, 12, true);
    expect(v.currentTime).toBe(1);
    expect(v.playCount).toBe(1);
    expect(v.paused).toBe(false);
  });

  it("playing + past a KNOWN-duration clip's span: out-of-span skip leaves it untouched", () => {
    // Frame 120 (10s) is past this clip's derived span (dur 2s -> frames 0..23), so this now hits
    // the out-of-span skip before ever reaching the wanted>=dur freeze branch below — it passes only
    // because the fixture already sits at (currentTime 2, paused true), which the skip doesn't touch.
    // The freeze branch (finite-duration case) is rare but not unreachable — rounding in
    // startFrame = round(-off/spd) can leave `wanted` a hair past `dur` at the last in-span frame;
    // see the next test for the path that reaches it reliably (duration not yet known).
    const v = fakeVid({ currentTime: 2, paused: true, duration: 2 });
    syncReferenceVideos(proj([vidLayer(v)]), 120, 12, true);
    expect(v.currentTime).toBe(2);
    expect(v.playCount).toBe(0);
    expect(v.paused).toBe(true);
  });

  it("playing + duration not yet known: freezes at the wanted time, does not play()", () => {
    // With duration NaN (preload="metadata" hasn't resolved it yet), refVisibleSpan returns null
    // ("always visible"), so the out-of-span skip does not fire; `dur` then falls back to `wanted`
    // itself, making `wanted >= dur` trivially true. This is the one remaining path that reaches the
    // freeze branch — also exercises `!vid.paused` -> pause(), since play() on an ended element
    // seeks to 0 and must not be called once frozen.
    const v = fakeVid({ currentTime: 3, paused: false, duration: NaN });
    syncReferenceVideos(proj([vidLayer(v)]), 120, 12, true); // wanted 10s; dur === wanted (10) -> freeze
    expect(v.currentTime).toBe(10);
    expect(v.playCount).toBe(0);
    expect(v.paused).toBe(true);
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

  it("speed > 1 advances the video faster (frame × speed)", () => {
    const v = fakeVid();
    syncReferenceVideos(proj([vidLayer(v, 0, 2)]), 6, 12, false); // (0 + 6*2)/12 = 1.0s (not 0.5)
    expect(v.currentTime).toBe(1);
  });

  it("speed < 1 advances the video slower", () => {
    const v = fakeVid();
    syncReferenceVideos(proj([vidLayer(v, 0, 0.5)]), 12, 12, false); // (0 + 12*0.5)/12 = 0.5s
    expect(v.currentTime).toBe(0.5);
  });

  it("applies offset additively with speed", () => {
    const v = fakeVid();
    syncReferenceVideos(proj([vidLayer(v, 12, 2)]), 6, 12, false); // (12 + 12)/12 = 2.0s
    expect(v.currentTime).toBe(2);
  });

  it("a head trim seeks into the file without moving the kept picture", () => {
    // trimVideoHead at 1× by 6 frames: offset -6, trimIn 6. Project frame 6 must show
    // source 0.5s — the same picture untrimmed frame 6 showed.
    const v = fakeVid({ duration: 2 });
    syncReferenceVideos(
      proj([vidLayer(v, -6, 1, false, { trimInFrames: 6, trimLenFrames: 18 })]),
      6,
      12,
      false,
    );
    expect(v.currentTime).toBe(0.5);
  });

  it("a tail trim blanks frames past the kept span", () => {
    // Keep 12 source frames at 1× starting at 0 → visible 0..11. Frame 12 is out of span.
    const v = fakeVid({ duration: 2, currentTime: 0 });
    syncReferenceVideos(
      proj([vidLayer(v, 0, 1, false, { trimInFrames: 0, trimLenFrames: 12 })]),
      12,
      12,
      false,
    );
    expect(v.currentTime).toBe(0); // skip leaves it untouched
    expect(v.pauseCount).toBe(0); // already paused
  });

  it("sets playbackRate from speed (clamped to [0.0625, 16])", () => {
    const v = fakeVid();
    syncReferenceVideos(proj([vidLayer(v, 0, 2)]), 0, 12, false);
    expect(v.playbackRate).toBe(2);
    const fast = fakeVid();
    syncReferenceVideos(proj([vidLayer(fast, 0, 100)]), 0, 12, false);
    expect(fast.playbackRate).toBe(16);
    const slow = fakeVid();
    syncReferenceVideos(proj([vidLayer(slow, 0, 0.01)]), 0, 12, false);
    expect(slow.playbackRate).toBe(0.0625);
  });

  it("treats missing/zero/negative speed as 1", () => {
    const a = fakeVid();
    syncReferenceVideos(proj([vidLayer(a, 0, 0)]), 12, 12, false); // speed 0 → 1 → wanted 1.0
    expect(a.currentTime).toBe(1);
    expect(a.playbackRate).toBe(1);
    const b = fakeVid();
    syncReferenceVideos(proj([vidLayer(b, 0, -3)]), 12, 12, false); // negative → 1
    expect(b.currentTime).toBe(1);
  });

  it("audioEnabled true → unmutes the element", () => {
    const v = fakeVid(); // muted: true initially
    syncReferenceVideos(proj([vidLayer(v, 0, 1, true)]), 0, 12, false);
    expect(v.muted).toBe(false);
  });

  it("audioEnabled false → keeps the element muted", () => {
    const v = fakeVid();
    v.muted = false; // prove sync re-mutes it
    syncReferenceVideos(proj([vidLayer(v, 0, 1, false)]), 0, 12, false);
    expect(v.muted).toBe(true);
  });

  it("missing audioEnabled → treated as muted", () => {
    const v = fakeVid();
    v.muted = false;
    // layer without audioEnabled (simulates old in-memory/project data)
    const layer = {
      kind: "ref",
      id: 1,
      media: { type: "video", el: v },
      offsetFrames: 0,
      speed: 1,
    };
    syncReferenceVideos(proj([layer as unknown as never]), 0, 12, false);
    expect(v.muted).toBe(true);
  });

  it("toggling audioEnabled between syncs flips muted", () => {
    const v = fakeVid();
    syncReferenceVideos(proj([vidLayer(v, 0, 1, true)]), 0, 12, false);
    expect(v.muted).toBe(false);
    syncReferenceVideos(proj([vidLayer(v, 0, 1, false)]), 0, 12, false);
    expect(v.muted).toBe(true);
  });

  it("mute enforcement does not disturb currentTime", () => {
    const v = fakeVid();
    syncReferenceVideos(proj([vidLayer(v, 0, 1, true)]), 12, 12, false); // wanted 1.0s
    expect(v.currentTime).toBe(1);
    expect(v.muted).toBe(false);
  });
});

describe("out-of-span videos", () => {
  it("does not seek a video whose frame is past its footage", () => {
    const v = fakeVid({ duration: 2, currentTime: 0 }); // 2s @ 12fps -> frames 0..23
    syncReferenceVideos(proj([vidLayer(v)]), 100, 12);
    expect(v.currentTime).toBe(0); // untouched, NOT clamped to the last frame
  });

  it("pauses a running video that leaves its span", () => {
    const v = fakeVid({ duration: 2, paused: false, currentTime: 1.9 });
    syncReferenceVideos(proj([vidLayer(v)]), 100, 12, true);
    expect(v.paused).toBe(true);
  });

  it("still syncs normally inside the span", () => {
    const v = fakeVid({ duration: 2, currentTime: 0 });
    syncReferenceVideos(proj([vidLayer(v)]), 12, 12);
    expect(v.currentTime).toBeCloseTo(1);
  });

  it("a video with no duration is never treated as out of span", () => {
    const v = fakeVid({ duration: NaN, currentTime: 0 });
    syncReferenceVideos(proj([vidLayer(v)]), 50, 12);
    expect(v.currentTime).toBeCloseTo(50 / 12);
  });
});
