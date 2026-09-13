import { describe, it, expect } from "vitest";
import type { Marker } from "../anim/document";
import {
  markerAt,
  joinLabels,
  addMarker,
  removeMarker,
  renameMarker,
  moveMarker,
  shiftMarkers,
  truncateMarkers,
  nextMarkerFrame,
  prevMarkerFrame,
  sanitizeMarkers,
} from "../anim/markers";

const mk = (frame: number, label = ""): Marker => ({ frame, label });

describe("markerAt", () => {
  it("finds the marker on a frame, or undefined", () => {
    expect(markerAt([mk(1, "a")], 1)?.label).toBe("a");
    expect(markerAt([mk(1, "a")], 2)).toBeUndefined();
  });
});

describe("joinLabels", () => {
  it("joins non-empty labels, earlier first", () => {
    expect(joinLabels("a", "b")).toBe("a · b");
  });
  it("skips empty labels", () => {
    expect(joinLabels("", "b")).toBe("b");
    expect(joinLabels("a", "")).toBe("a");
    expect(joinLabels("", "")).toBe("");
  });
});

describe("addMarker", () => {
  it("inserts in frame order with a trimmed label", () => {
    expect(addMarker([mk(1), mk(5)], 3, "  mid ")).toEqual([mk(1), mk(3, "mid"), mk(5)]);
  });
  it("defaults to an empty label", () => {
    expect(addMarker([], 0)).toEqual([mk(0)]);
  });
  it("refuses an occupied frame and returns the same array", () => {
    const ms = [mk(2, "x")];
    expect(addMarker(ms, 2, "y")).toBe(ms);
  });
  it("refuses a negative or fractional frame", () => {
    const ms: Marker[] = [];
    expect(addMarker(ms, -1)).toBe(ms);
    expect(addMarker(ms, 1.5)).toBe(ms);
  });
  it("does not mutate the input", () => {
    const ms = [mk(1)];
    addMarker(ms, 0);
    expect(ms).toEqual([mk(1)]);
  });
});

describe("removeMarker", () => {
  it("removes the marker on a frame", () => {
    expect(removeMarker([mk(1), mk(4)], 1)).toEqual([mk(4)]);
  });
  it("returns the same array when the frame has no marker", () => {
    const ms = [mk(1)];
    expect(removeMarker(ms, 2)).toBe(ms);
  });
});

describe("renameMarker", () => {
  it("trims and replaces the marker object instead of mutating it", () => {
    const m = mk(1, "a");
    const next = renameMarker([m], 1, "  b ");
    expect(next).toEqual([mk(1, "b")]);
    expect(next[0]).not.toBe(m);
    expect(m.label).toBe("a");
  });
  it("returns the same array for an unchanged label or a missing marker", () => {
    const ms = [mk(1, "a")];
    expect(renameMarker(ms, 1, " a ")).toBe(ms);
    expect(renameMarker(ms, 3, "z")).toBe(ms);
  });
});

describe("moveMarker", () => {
  it("moves and re-sorts", () => {
    expect(moveMarker([mk(1, "a"), mk(4, "b")], 1, 6)).toEqual([mk(4, "b"), mk(6, "a")]);
  });
  it("refuses an occupied destination", () => {
    const ms = [mk(1, "a"), mk(4, "b")];
    expect(moveMarker(ms, 1, 4)).toBe(ms);
  });
  it("returns the same array for from === to or a missing source", () => {
    const ms = [mk(1)];
    expect(moveMarker(ms, 1, 1)).toBe(ms);
    expect(moveMarker(ms, 2, 5)).toBe(ms);
  });
  it("clamps a negative destination to frame 0", () => {
    expect(moveMarker([mk(3)], 3, -2)).toEqual([mk(0)]);
  });
});

describe("shiftMarkers", () => {
  it("insert at a marker's frame pushes it later", () => {
    expect(shiftMarkers([mk(2, "a")], 2, 1)).toEqual([mk(3, "a")]);
  });
  it("insert before markers shifts them all", () => {
    expect(shiftMarkers([mk(2), mk(5)], 0, 1)).toEqual([mk(3), mk(6)]);
  });
  it("insert after every marker changes nothing (same array)", () => {
    const ms = [mk(2)];
    expect(shiftMarkers(ms, 3, 1)).toBe(ms);
  });
  it("delete before a marker pulls it earlier", () => {
    expect(shiftMarkers([mk(4)], 1, -1)).toEqual([mk(3)]);
  });
  it("delete ON a marker's frame leaves it on that frame (same array)", () => {
    const ms = [mk(2, "a")];
    expect(shiftMarkers(ms, 2, -1)).toBe(ms);
  });
  it("delete that lands two markers on one frame joins their labels, earlier first", () => {
    expect(shiftMarkers([mk(2, "a"), mk(3, "b"), mk(7, "c")], 2, -1)).toEqual([
      mk(2, "a · b"),
      mk(6, "c"),
    ]);
  });
  it("a collision with an unlabelled marker keeps the other label alone", () => {
    expect(shiftMarkers([mk(2), mk(3, "b")], 2, -1)).toEqual([mk(2, "b")]);
  });
  it("an empty list stays the same array", () => {
    const ms: Marker[] = [];
    expect(shiftMarkers(ms, 0, 1)).toBe(ms);
  });
});

describe("truncateMarkers", () => {
  it("drops markers at or past the frame count", () => {
    expect(truncateMarkers([mk(0), mk(4), mk(5)], 5)).toEqual([mk(0), mk(4)]);
  });
  it("returns the same array when nothing is cut", () => {
    const ms = [mk(0), mk(4)];
    expect(truncateMarkers(ms, 5)).toBe(ms);
  });
});

describe("nextMarkerFrame / prevMarkerFrame", () => {
  const ms = [mk(2), mk(6), mk(9)];
  it("finds the nearest marker strictly after, within the frame count", () => {
    expect(nextMarkerFrame(ms, 0, 10)).toBe(2);
    expect(nextMarkerFrame(ms, 2, 10)).toBe(6);
    expect(nextMarkerFrame(ms, 9, 10)).toBeNull();
    expect(nextMarkerFrame(ms, 6, 9)).toBeNull(); // frame 9 is past a 9-frame document
  });
  it("finds the nearest marker strictly before", () => {
    expect(prevMarkerFrame(ms, 7)).toBe(6);
    expect(prevMarkerFrame(ms, 6)).toBe(2);
    expect(prevMarkerFrame(ms, 2)).toBeNull();
  });
});

describe("sanitizeMarkers", () => {
  it("returns undefined for anything that is not an array", () => {
    expect(sanitizeMarkers(undefined, 10)).toBeUndefined();
    expect(sanitizeMarkers({}, 10)).toBeUndefined();
    expect(sanitizeMarkers("x", 10)).toBeUndefined();
  });
  it("drops entries with a bad or out-of-range frame", () => {
    const raw = [
      { frame: -1 },
      { frame: 1.5 },
      { frame: "2" },
      { frame: 10 },
      null,
      7,
      { frame: 3, label: " ok " },
    ];
    expect(sanitizeMarkers(raw, 10)).toEqual([mk(3, "ok")]);
  });
  it("turns a non-string label into an empty one", () => {
    expect(sanitizeMarkers([{ frame: 1, label: 5 }], 10)).toEqual([mk(1)]);
  });
  it("sorts by frame", () => {
    expect(sanitizeMarkers([{ frame: 5 }, { frame: 1 }], 10)).toEqual([mk(1), mk(5)]);
  });
  it("joins duplicate frames in file order", () => {
    const raw = [
      { frame: 2, label: "x" },
      { frame: 2, label: "y" },
    ];
    expect(sanitizeMarkers(raw, 10)).toEqual([mk(2, "x · y")]);
  });
  it("keeps labels longer than the 40-character input cap", () => {
    const long = "a".repeat(60);
    expect(sanitizeMarkers([{ frame: 0, label: long }], 1)).toEqual([mk(0, long)]);
  });
  it("returns undefined when nothing survives", () => {
    expect(sanitizeMarkers([{ frame: 99 }], 10)).toBeUndefined();
  });
});
