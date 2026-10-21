import { describe, it, expect } from "vitest";
import { blursOnCanvasPress, isCommitEnter, isTextEntry } from "../lib/text-entry";

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

// Review 2026-10-17 #30: a focused <select> kept focus through canvas presses, and the key
// handlers stand aside for a select, so every shortcut stayed dead (and typeahead retyped it).
describe("blursOnCanvasPress", () => {
  it("text fields and dropdowns give up focus to a canvas press", () => {
    expect(blursOnCanvasPress({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(blursOnCanvasPress({ tagName: "TEXTAREA" })).toBe(true);
    expect(blursOnCanvasPress({ tagName: "SELECT" })).toBe(true);
  });
  it("other controls keep it (they never block shortcuts)", () => {
    expect(blursOnCanvasPress({ tagName: "INPUT", type: "range" })).toBe(false);
    expect(blursOnCanvasPress({ tagName: "BUTTON" })).toBe(false);
    expect(blursOnCanvasPress(null)).toBe(false);
  });
});

// Port of slop-paint abc1b6d (the IME half): the layer / group rename and the marker label
// committed on the Enter that commits an input method's composition.
describe("isCommitEnter", () => {
  it("takes a plain Enter", () => {
    expect(isCommitEnter({ key: "Enter" })).toBe(true);
    expect(isCommitEnter({ key: "Enter", isComposing: false, keyCode: 13 })).toBe(true);
  });

  it("leaves the Enter that commits an input method's text", () => {
    expect(isCommitEnter({ key: "Enter", isComposing: true })).toBe(false);
    expect(isCommitEnter({ key: "Enter", keyCode: 229 })).toBe(false); // Safari
  });

  it("is only Enter", () => {
    expect(isCommitEnter({ key: "Escape" })).toBe(false);
  });
});
