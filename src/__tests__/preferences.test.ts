import { describe, it, expect } from "vitest";
import { parsePreferences, keepProportionsPref } from "../persist/preferences";
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

describe("keepProportions", () => {
  it("absent means on", () => {
    expect(keepProportionsPref({})).toBe(true);
    expect(keepProportionsPref(parsePreferences(null))).toBe(true);
  });
  it("round-trips an explicit off", () => {
    expect(keepProportionsPref(parsePreferences(JSON.stringify({ keepProportions: false })))).toBe(
      false,
    );
  });
  it("ignores a non-boolean", () => {
    expect(keepProportionsPref(parsePreferences(JSON.stringify({ keepProportions: "no" })))).toBe(
      true,
    );
  });
});

import { curvePointsPref, eraserCurvePref } from "../persist/preferences";

describe("pressure curve prefs", () => {
  const brush = { cp1: { x: 0.1, y: 0.4 }, cp2: { x: 0.6, y: 0.9 } };
  const eraser = { cp1: { x: 0.5, y: 0.1 }, cp2: { x: 0.9, y: 0.5 } };

  it("keeps only numeric {x, y} control points", () => {
    expect(curvePointsPref(brush)).toEqual(brush);
    expect(curvePointsPref({ cp1: { x: "0.1", y: 0.4 }, cp2: { x: 0.6, y: 0.9 } })).toEqual({
      cp2: { x: 0.6, y: 0.9 },
    });
    expect(curvePointsPref(null)).toEqual({});
    expect(curvePointsPref("curve")).toEqual({});
  });

  it("the eraser uses its own stored curve", () => {
    const p = parsePreferences(
      JSON.stringify({ pressureCurve: brush, eraserPressureCurve: eraser }),
    );
    expect(eraserCurvePref(p)).toEqual(eraser);
  });

  // Before 2026-09-14 one curve drove both tools. A user who tuned it must not find the eraser
  // suddenly linear, so an older pref without an eraser curve starts the eraser as a copy.
  it("an older pref without an eraser curve gives the eraser the brush curve", () => {
    expect(eraserCurvePref(parsePreferences(JSON.stringify({ pressureCurve: brush })))).toEqual(
      brush,
    );
  });

  it("no stored curve at all applies nothing", () => {
    expect(eraserCurvePref({})).toEqual({});
  });
});
