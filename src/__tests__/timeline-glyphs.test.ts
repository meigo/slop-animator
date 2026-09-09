import { describe, it, expect } from "vitest";
import { computeTimelineGlyphs, resolveGlyphHolds } from "../lib/timeline-glyphs";
import type { Cell } from "../anim/document";

// A key cell carries a stub canvas tagged with whether it's "empty".
const key = (empty = false) =>
  ({ kind: "key", canvas: { empty } as unknown as HTMLCanvasElement }) as Cell;
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

  it("frames past an inked key keep holding (—), not blank", () => {
    expect(computeTimelineGlyphs([key()], 4, isEmpty)).toEqual(["◆", "—", "—", "—"]);
  });

  it("frames past a blank key stay blank — the blank key is what stops the hold", () => {
    expect(computeTimelineGlyphs([key(), key(true)], 5, isEmpty)).toEqual(["◆", "◇", "", "", ""]);
  });

  it("all holds (no key) → all blank", () => {
    expect(computeTimelineGlyphs([hold(), hold()], 2, isEmpty)).toEqual(["", ""]);
  });

  it("calls isEmpty once per key cell, never for holds", () => {
    let calls = 0;
    const probe = (c: HTMLCanvasElement) => {
      calls++;
      return isEmpty(c);
    };
    computeTimelineGlyphs([key(), hold(), key(true), hold(), hold()], 5, probe);
    expect(calls).toBe(2); // two key cells, regardless of the holds
  });
});

describe("resolveGlyphHolds", () => {
  // The block-drag preview patches glyphs cell by cell (`displayGlyph` in Timeline.svelte): the
  // moved range shows the glyph sliding into it, the vacated range is blanked. Blanking is wrong on
  // its own — a vacated cell inside a hold run still HOLDS the inked key before it, which is exactly
  // what `moveBlockFrames` produces on release (deleteBlock writes holds, and a hold after an inked
  // key renders "—"). Re-resolving the patched array is what makes the preview match the result.
  it("turns a stranded gap back into a hold when an inked key precedes it", () => {
    // key at 0 holding to 3, blank key at 4, dragged +2: the gap at 4–5 must hold, not blank.
    expect(resolveGlyphHolds(["◆", "—", "—", "—", "", "", "◇"])).toEqual([
      "◆",
      "—",
      "—",
      "—",
      "—",
      "—",
      "◇",
    ]);
  });

  it("keeps a gap blank when a BLANK key precedes it", () => {
    expect(resolveGlyphHolds(["◇", "", "—", ""])).toEqual(["◇", "", "", ""]);
  });

  it("leaves nothing before the first key", () => {
    expect(resolveGlyphHolds(["", "—", "◆", ""])).toEqual(["", "", "◆", "—"]);
  });

  it("is idempotent on well-formed glyphs", () => {
    const g = ["◆", "—", "◇", "", "◆", "—"];
    expect(resolveGlyphHolds(g)).toEqual(g);
    expect(resolveGlyphHolds(resolveGlyphHolds(g))).toEqual(g);
  });

  it("agrees with computeTimelineGlyphs on the arrays it produces", () => {
    // The invariant that makes this safe to apply unconditionally: re-resolving real glyph output
    // must be a no-op, or the preview would differ from the un-dragged render.
    const cells: Cell[] = [key(), hold(), key(true), hold(), key()];
    const g = computeTimelineGlyphs(cells, 7, isEmpty);
    expect(resolveGlyphHolds(g)).toEqual(g);
  });
});
