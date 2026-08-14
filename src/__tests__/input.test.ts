import { describe, it, expect } from "vitest";
import { isStageChromeTarget } from "../core/input";

function node(closest: (sel: string) => unknown) {
  return { closest } as unknown as EventTarget;
}

describe("isStageChromeTarget", () => {
  it("is false for null / a target with no closest()", () => {
    expect(isStageChromeTarget(null)).toBe(false);
    expect(isStageChromeTarget({} as EventTarget)).toBe(false);
  });

  it("is true for the selection action bar (and nodes inside it)", () => {
    expect(
      isStageChromeTarget(node((sel) => (sel === ".selection-actions-panel" ? {} : null))),
    ).toBe(true);
  });

  it("is false for a click on the drawing surface", () => {
    expect(isStageChromeTarget(node(() => null))).toBe(false);
  });
});
