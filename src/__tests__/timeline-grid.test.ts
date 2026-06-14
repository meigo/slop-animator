import { describe, it, expect } from "vitest";
import { columnAtX } from "../lib/timeline-grid";

describe("columnAtX", () => {
  const W = 24;

  it("maps an offset inside column 0 to 0", () => {
    expect(columnAtX(0, W, 10)).toBe(0);
    expect(columnAtX(23, W, 10)).toBe(0);
  });

  it("maps offsets to the column under the pointer (floor of offset/cellW)", () => {
    expect(columnAtX(24, W, 10)).toBe(1);
    expect(columnAtX(60, W, 10)).toBe(2); // 60/24 = 2.5 -> 2
  });

  it("clamps a negative offset to 0", () => {
    expect(columnAtX(-50, W, 10)).toBe(0);
  });

  it("clamps an offset past the end to the last column", () => {
    expect(columnAtX(10_000, W, 10)).toBe(9);
  });

  it("returns 0 when there are no columns", () => {
    expect(columnAtX(100, W, 0)).toBe(0);
  });
});
