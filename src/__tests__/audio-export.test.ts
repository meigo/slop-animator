import { describe, it, expect } from "vitest";
import { audioExportPlan, type AudioExportInput } from "../export/audio-mix";

// 24 frames @ 12fps = a 2s export window.
const FPS = 12;
const FRAMES = 24;
const clip = (over: Partial<AudioExportInput> = {}): AudioExportInput => ({
  offsetFrames: 0,
  muted: false,
  durationS: 5,
  ...over,
});

describe("audioExportPlan — no audio track in the export", () => {
  it("returns null when there is no track", () => {
    expect(audioExportPlan(null, FPS, FRAMES)).toBeNull();
  });

  it("returns null for a muted track (muted = silent export)", () => {
    expect(audioExportPlan(clip({ muted: true }), FPS, FRAMES)).toBeNull();
  });

  it("returns null when the clip starts after the export ends", () => {
    // Offset 100 frames = 8.33s, past the 2s window.
    expect(audioExportPlan(clip({ offsetFrames: 100 }), FPS, FRAMES)).toBeNull();
  });

  it("returns null when the clip ends before frame 0", () => {
    // Offset -120 frames = the export starts 10s into a 5s clip.
    expect(audioExportPlan(clip({ offsetFrames: -120 }), FPS, FRAMES)).toBeNull();
  });

  it("returns null when the clip starts exactly at the window end (>= boundary, not >)", () => {
    // Offset 24 frames = 2s, which equals windowS (2s) exactly — startAt >= windowS is
    // deliberately exclusive of any audio, not just past it.
    expect(audioExportPlan(clip({ offsetFrames: 24 }), FPS, FRAMES)).toBeNull();
  });

  it("returns null when the clip starts exactly at its own end (>= boundary, not >)", () => {
    // Offset -60 frames = 5s into a 5s clip: sourceOffset equals durationS exactly — deliberately
    // treated as "nothing left to play", not just past it.
    expect(audioExportPlan(clip({ offsetFrames: -60, durationS: 5 }), FPS, FRAMES)).toBeNull();
  });
});

describe("audioExportPlan — placement", () => {
  it("zero offset: clip and export both start at 0", () => {
    expect(audioExportPlan(clip(), FPS, FRAMES)).toEqual({
      windowS: 2,
      startAt: 0,
      sourceOffset: 0,
      // Untrimmed, so the kept span is the whole 5s buffer; capped at the 2s window.
      sourceDuration: 2,
    });
  });

  it("positive offset delays the clip inside the window (silence head)", () => {
    // Dragged 6 frames right = starts 0.5s into the export, from the top of the buffer.
    expect(audioExportPlan(clip({ offsetFrames: 6 }), FPS, FRAMES)).toEqual({
      windowS: 2,
      startAt: 0.5,
      sourceOffset: 0,
      // Only 1.5s of window remains after the 0.5s of silence head.
      sourceDuration: 1.5,
    });
  });

  it("negative offset starts partway into the buffer", () => {
    // Dragged 6 frames left = the export begins 0.5s into the clip.
    expect(audioExportPlan(clip({ offsetFrames: -6 }), FPS, FRAMES)).toEqual({
      windowS: 2,
      startAt: 0,
      sourceOffset: 0.5,
      // Untrimmed 5s buffer easily covers the whole 2s window.
      sourceDuration: 2,
    });
  });

  it("windowS is the animation length, not the clip length", () => {
    // A clip shorter than the export and one longer than it both yield the same window;
    // truncation is the renderer's job, not the plan's.
    expect(audioExportPlan(clip({ durationS: 0.5 }), FPS, FRAMES)?.windowS).toBe(2);
    expect(audioExportPlan(clip({ durationS: 600 }), FPS, FRAMES)?.windowS).toBe(2);
  });

  it("never sets both startAt and sourceOffset", () => {
    for (const offsetFrames of [-6, -1, 0, 1, 6]) {
      const p = audioExportPlan(clip({ offsetFrames }), FPS, FRAMES)!;
      expect(Math.min(p.startAt, p.sourceOffset)).toBe(0);
    }
  });
});

describe("audioExportPlan with a trimmed clip", () => {
  it("an untrimmed clip renders its whole buffer", () => {
    const p = audioExportPlan(
      {
        offsetFrames: 0,
        muted: false,
        durationS: 10,
        trimInFrames: undefined,
        trimLenFrames: undefined,
      },
      12,
      120,
    );
    expect(p).toEqual({ windowS: 10, startAt: 0, sourceOffset: 0, sourceDuration: 10 });
  });

  it("a tail trim shortens sourceDuration without moving the start", () => {
    const p = audioExportPlan(
      { offsetFrames: 0, muted: false, durationS: 10, trimInFrames: 0, trimLenFrames: 48 },
      12,
      120,
    );
    expect(p).toEqual({ windowS: 10, startAt: 0, sourceOffset: 0, sourceDuration: 4 });
  });

  it("a head trim starts further into the source", () => {
    // trimHead moved offsetFrames to 24 alongside trimInFrames, so the audio stays at frame 24.
    const p = audioExportPlan(
      { offsetFrames: 24, muted: false, durationS: 10, trimInFrames: 24, trimLenFrames: 96 },
      12,
      120,
    );
    expect(p).toEqual({ windowS: 10, startAt: 2, sourceOffset: 2, sourceDuration: 8 });
  });

  it("returns null when the TRIMMED span falls entirely outside the window", () => {
    // Kept span is one frame, dragged past the last frame: no audio track at all, not a silent one.
    expect(
      audioExportPlan(
        { offsetFrames: 240, muted: false, durationS: 10, trimInFrames: 0, trimLenFrames: 1 },
        12,
        120,
      ),
    ).toBeNull();
  });

  it("still returns null for a muted track", () => {
    expect(
      audioExportPlan(
        { offsetFrames: 0, muted: true, durationS: 10, trimInFrames: 0, trimLenFrames: 48 },
        12,
        120,
      ),
    ).toBeNull();
  });
});

// Export honours the play In/Out range, so the window can start partway into the timeline. The
// audio must begin from whatever is playing THERE — passing frame 0 would export the range's
// pictures against the animation's opening audio, which is the same kept-span/buffer-time confusion
// the trim work had to keep straight.
describe("audioExportPlan — In/Out range window", () => {
  it("starts the source at the range's first frame, not the timeline's", () => {
    // Window = frames 12..23 (1s in, at 12fps), clip aligned to frame 0.
    const plan = audioExportPlan(clip(), FPS, 12, 12)!;
    expect(plan.windowS).toBeCloseTo(1, 10);
    expect(plan.startAt).toBe(0); // already playing when the window opens
    expect(plan.sourceOffset).toBeCloseTo(1, 10); // 1s into the buffer
  });

  it("a clip that begins inside the window still starts late by the right amount", () => {
    // Clip starts at frame 18; window opens at 12 → 6 frames = 0.5s of leading silence.
    const plan = audioExportPlan(clip({ offsetFrames: 18 }), FPS, 12, 12)!;
    expect(plan.startAt).toBeCloseTo(0.5, 10);
    expect(plan.sourceOffset).toBe(0); // from the clip's own start
  });

  it("returns null when the clip ends before the range begins", () => {
    // A 5s clip at frame 0 is spent by frame 60; a window opening at frame 72 hears nothing.
    expect(audioExportPlan(clip(), FPS, 12, 72)).toBeNull();
  });

  it("truncates to the RANGE length, not the project length", () => {
    const plan = audioExportPlan(clip(), FPS, 6, 12)!;
    expect(plan.windowS).toBeCloseTo(0.5, 10);
    expect(plan.sourceDuration).toBeCloseTo(0.5, 10);
  });

  it("defaults to a whole-timeline window when no start is given", () => {
    expect(audioExportPlan(clip(), FPS, FRAMES)).toEqual(audioExportPlan(clip(), FPS, FRAMES, 0));
  });
});
