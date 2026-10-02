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

import { fillSoftPref, fillExpandPref } from "../persist/preferences";

describe("fillSoftPref (2026-10-02)", () => {
  it("defaults to 1 when absent (older prefs) or not a number", () => {
    expect(fillSoftPref({})).toBe(1);
    expect(fillSoftPref(parsePreferences(JSON.stringify({ fill: { tolerance: 32 } })))).toBe(1);
    expect(fillSoftPref(parsePreferences(JSON.stringify({ fill: { soft: "x" } })))).toBe(1);
  });
  it("keeps a saved stop, 0 included", () => {
    expect(fillSoftPref(parsePreferences(JSON.stringify({ fill: { soft: 0 } })))).toBe(0);
    expect(fillSoftPref(parsePreferences(JSON.stringify({ fill: { soft: 0.5 } })))).toBe(0.5);
  });
  it("snaps a value between stops, and clamps one past the top", () => {
    expect(fillSoftPref(parsePreferences(JSON.stringify({ fill: { soft: 2.2 } })))).toBe(2);
    expect(fillSoftPref(parsePreferences(JSON.stringify({ fill: { soft: 99 } })))).toBe(8);
    expect(fillSoftPref(parsePreferences(JSON.stringify({ fill: { soft: -3 } })))).toBe(0);
  });
});

describe("fillExpandPref", () => {
  // Expand's default went 2 → 0 with Soft (2026-10-02). A fill setting saved before Soft existed and
  // still at the OLD default loads as 0 — otherwise every existing user kept 2 and the fringe the
  // change removed. A value the user chose (anything else, or any setting saved with Soft) stays.
  it("migrates the old default saved before Soft existed", () => {
    expect(
      fillExpandPref({
        fill: { tolerance: 32, expand: 2, gap: 0, color: "#000", opacity: 100 } as never,
      }),
    ).toBe(0);
  });
  it("keeps a chosen Expand, and anything saved with Soft", () => {
    expect(fillExpandPref({ fill: { expand: 3 } as never })).toBe(3);
    expect(fillExpandPref({ fill: { expand: 2, soft: 1 } as never })).toBe(2);
    expect(fillExpandPref({ fill: { expand: 0 } as never })).toBe(0);
  });
  it("is undefined when nothing was saved (the default applies)", () => {
    expect(fillExpandPref({})).toBeUndefined();
  });
});
