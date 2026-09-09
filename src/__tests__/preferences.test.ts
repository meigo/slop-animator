import { describe, it, expect } from "vitest";
import { parsePreferences } from "../persist/preferences";
import { clampTimelineCellW } from "../lib/timeline-grid";

describe("parsePreferences", () => {
  it("null → {}", () => {
    expect(parsePreferences(null)).toEqual({});
  });
  it("invalid JSON → {}", () => {
    expect(parsePreferences("not json")).toEqual({});
  });
  it("a JSON object → its contents", () => {
    expect(parsePreferences('{"theme":"light","sizeRange":2}')).toEqual({
      theme: "light",
      sizeRange: 2,
    });
  });
  it("valid JSON that isn't an object → {}", () => {
    expect(parsePreferences("5")).toEqual({});
  });
  it("a JSON array → {}", () => {
    expect(parsePreferences("[1,2]")).toEqual({});
  });
});

describe("timelineCellW", () => {
  it("round-trips through parsePreferences", () => {
    expect(parsePreferences('{"timelineCellW":16}')).toEqual({ timelineCellW: 16 });
  });

  it("clamps to the supported zoom range", () => {
    expect(clampTimelineCellW(4)).toBe(12);
    expect(clampTimelineCellW(99)).toBe(32);
    expect(clampTimelineCellW(24)).toBe(24);
  });
});
