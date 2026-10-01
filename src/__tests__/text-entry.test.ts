import { describe, it, expect } from "vitest";
import { isTextEntry } from "../lib/text-entry";

describe("isTextEntry", () => {
  it("is true for fields that take typed text", () => {
    expect(isTextEntry({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isTextEntry({ tagName: "INPUT", type: "number" })).toBe(true);
    expect(isTextEntry({ tagName: "INPUT" })).toBe(true); // no type = text
    expect(isTextEntry({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextEntry({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("is false for controls that take no text, so shortcuts keep working after using them", () => {
    // A slider keeps focus after a drag (the canvas prevents the focus change on press), and
    // treating it as a text field left Ctrl+Z and every tool key dead until a button was clicked.
    expect(isTextEntry({ tagName: "INPUT", type: "range" })).toBe(false);
    expect(isTextEntry({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isTextEntry({ tagName: "INPUT", type: "color" })).toBe(false);
    expect(isTextEntry({ tagName: "INPUT", type: "file" })).toBe(false);
    expect(isTextEntry({ tagName: "BUTTON" })).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});
