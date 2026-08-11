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
    });
  });

  it("positive offset delays the clip inside the window (silence head)", () => {
    // Dragged 6 frames right = starts 0.5s into the export, from the top of the buffer.
    expect(audioExportPlan(clip({ offsetFrames: 6 }), FPS, FRAMES)).toEqual({
      windowS: 2,
      startAt: 0.5,
      sourceOffset: 0,
    });
  });

  it("negative offset starts partway into the buffer", () => {
    // Dragged 6 frames left = the export begins 0.5s into the clip.
    expect(audioExportPlan(clip({ offsetFrames: -6 }), FPS, FRAMES)).toEqual({
      windowS: 2,
      startAt: 0,
      sourceOffset: 0.5,
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
