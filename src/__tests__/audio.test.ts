import { describe, it, expect } from "vitest";
import { computePeaks, audioFrameSpan, bufferOffsetForFrame } from "../audio/peaks";

describe("computePeaks", () => {
  it("returns exactly `columns` values", () => {
    expect(computePeaks(new Float32Array(1000), 50)).toHaveLength(50);
  });
  it("silence → all zeros", () => {
    expect(computePeaks(new Float32Array(1000), 10).every((v) => v === 0)).toBe(true);
  });
  it("full-scale block → peak ~1", () => {
    const ch = new Float32Array(1000).fill(1);
    expect(computePeaks(ch, 10).every((v) => Math.abs(v - 1) < 1e-6)).toBe(true);
  });
  it("values are within [0,1] (uses absolute amplitude)", () => {
    const ch = Float32Array.from({ length: 1000 }, (_, i) => (i % 2 ? -0.5 : 0.5));
    const peaks = computePeaks(ch, 20);
    expect(peaks.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(Math.max(...peaks)).toBeCloseTo(0.5, 5);
  });
});

describe("audioFrameSpan", () => {
  it("ceils duration*fps", () => {
    expect(audioFrameSpan(2.0, 12)).toBe(24);
    expect(audioFrameSpan(2.01, 12)).toBe(25);
  });
  it("zero duration → 0", () => {
    expect(audioFrameSpan(0, 12)).toBe(0);
  });
});

describe("bufferOffsetForFrame", () => {
  it("maps frame to seconds at fps", () => {
    expect(bufferOffsetForFrame(12, 0, 12)).toBe(1);
  });
  it("subtracts the offset", () => {
    expect(bufferOffsetForFrame(18, 12, 12)).toBeCloseTo(0.5, 6);
  });
  it("clamps to 0 before the offset", () => {
    expect(bufferOffsetForFrame(6, 12, 12)).toBe(0);
  });
});
