import { describe, it, expect } from "vitest";
import { resolveExportRange, exportPixelSize } from "../export/export-range";

const opts = (rangeMode: "all" | "inout" | "custom", customStart = 0, customEnd = 0) => ({
  rangeMode,
  customStart,
  customEnd,
});

describe("resolveExportRange", () => {
  it("all: the whole animation, whatever the play range says", () => {
    expect(resolveExportRange(opts("all"), { in: 3, out: 5 }, 10)).toEqual({ start: 0, end: 9 });
  });

  it("inout: exactly the play range — today's behaviour, now explicit", () => {
    expect(resolveExportRange(opts("inout"), { in: 3, out: 5 }, 10)).toEqual({ start: 3, end: 5 });
  });

  it("inout with no range set, or an inverted one, is the whole animation", () => {
    expect(resolveExportRange(opts("inout"), null, 10)).toEqual({ start: 0, end: 9 });
    expect(resolveExportRange(opts("inout"), { in: 7, out: 2 }, 10)).toEqual({ start: 0, end: 9 });
  });

  it("custom: the typed pair, ignoring the play range", () => {
    expect(resolveExportRange(opts("custom", 2, 6), { in: 0, out: 1 }, 10)).toEqual({
      start: 2,
      end: 6,
    });
  });

  it("custom: a reversed pair exports that span rather than nothing", () => {
    expect(resolveExportRange(opts("custom", 6, 2), null, 10)).toEqual({ start: 2, end: 6 });
  });

  it("custom: clamps past either end of the document", () => {
    expect(resolveExportRange(opts("custom", -5, 999), null, 10)).toEqual({ start: 0, end: 9 });
  });

  it("a one-frame document exports that one frame in every mode", () => {
    for (const m of ["all", "inout", "custom"] as const) {
      expect(resolveExportRange(opts(m, 4, 8), { in: 2, out: 3 }, 1)).toEqual({ start: 0, end: 0 });
    }
  });
});

describe("exportPixelSize", () => {
  it("scales and rounds, never to zero", () => {
    expect(exportPixelSize(1280, 720, 1)).toEqual({ w: 1280, h: 720 });
    expect(exportPixelSize(1280, 720, 0.5)).toEqual({ w: 640, h: 360 });
    expect(exportPixelSize(1281, 721, 0.25)).toEqual({ w: 320, h: 180 });
    expect(exportPixelSize(3, 3, 0.25)).toEqual({ w: 1, h: 1 });
  });
});
