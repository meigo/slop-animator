import { describe, it, expect } from "vitest";
import { computeTimelineGlyphs } from "../lib/timeline-glyphs";
import type { Cell } from "../anim/document";

// A key cell carries a stub canvas tagged with whether it's "empty".
const key = (empty = false) => ({ kind: "key", canvas: { empty } as unknown as HTMLCanvasElement }) as Cell;
const hold = () => ({ kind: "hold" }) as Cell;
const isEmpty = (c: HTMLCanvasElement) => (c as unknown as { empty: boolean }).empty;

describe("computeTimelineGlyphs", () => {
  it("inked key then holds → ◆ then —", () => {
    expect(computeTimelineGlyphs([key(), hold(), hold()], 3, isEmpty)).toEqual(["◆", "—", "—"]);
  });

  it("blank before a later key", () => {
    expect(computeTimelineGlyphs([hold(), key(), hold()], 3, isEmpty)).toEqual(["", "◆", "—"]);
  });

  it("empty keyframe → ◇, its holds stay blank", () => {
    expect(computeTimelineGlyphs([key(true), hold(), hold()], 3, isEmpty)).toEqual(["◇", "", ""]);
  });

  it("mixed: empty key, then inked key", () => {
    expect(computeTimelineGlyphs([key(true), key(), hold()], 3, isEmpty)).toEqual(["◇", "◆", "—"]);
  });

  it("frames past the track length render blank", () => {
    expect(computeTimelineGlyphs([key()], 4, isEmpty)).toEqual(["◆", "", "", ""]);
  });

  it("all holds (no key) → all blank", () => {
    expect(computeTimelineGlyphs([hold(), hold()], 2, isEmpty)).toEqual(["", ""]);
  });

  it("calls isEmpty once per key cell, never for holds", () => {
    let calls = 0;
    const probe = (c: HTMLCanvasElement) => { calls++; return isEmpty(c); };
    computeTimelineGlyphs([key(), hold(), key(true), hold(), hold()], 5, probe);
    expect(calls).toBe(2); // two key cells, regardless of the holds
  });
});
