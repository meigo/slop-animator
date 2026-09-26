import { describe, it, expect } from "vitest";
import { refFocusChange } from "../anim/ref-tool";

describe("refFocusChange", () => {
  it("selecting a reference switches to Transform and remembers the tool", () => {
    expect(refFocusChange(true, "brush", null, "brush")).toEqual({
      tool: "transform",
      before: "brush",
    });
    expect(refFocusChange(true, "fill", null, "brush")).toEqual({
      tool: "transform",
      before: "fill",
    });
  });

  it("selecting a reference while already on Transform owes nothing back", () => {
    expect(refFocusChange(true, "transform", null, "brush")).toEqual({
      tool: "transform",
      before: null,
    });
  });

  it("one-shot tools are not handed back to", () => {
    expect(refFocusChange(true, "eyedropper", null, "brush").before).toBe("brush");
    expect(refFocusChange(true, "outline", null, "brush").before).toBe("brush");
  });

  it("selecting away hands the remembered tool back", () => {
    expect(refFocusChange(false, "transform", "eraser", "brush")).toEqual({
      tool: "eraser",
      before: null,
    });
  });

  it("a tool picked while on the reference stays when selecting away", () => {
    expect(refFocusChange(false, "lasso", "brush", "brush")).toEqual({
      tool: "lasso",
      before: null,
    });
  });

  it("selecting away with nothing remembered changes nothing", () => {
    expect(refFocusChange(false, "transform", null, "brush")).toEqual({
      tool: "transform",
      before: null,
    });
  });
});
