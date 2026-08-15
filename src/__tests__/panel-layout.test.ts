import { describe, it, expect } from "vitest";
import {
  clampPanelWidth,
  MIN_PANEL_WIDTH,
  DEFAULT_PANEL_WIDTH,
  clampGutterLabelWidth,
  MIN_GUTTER_LABEL_WIDTH,
  DEFAULT_GUTTER_LABEL_WIDTH,
} from "../anim/panel-layout";

describe("clampPanelWidth", () => {
  it("returns a value within range unchanged", () => {
    expect(clampPanelWidth(300, 1400)).toBe(300); // 184 <= 300 <= 700
  });

  it("floors at MIN below the minimum", () => {
    expect(clampPanelWidth(50, 1400)).toBe(MIN_PANEL_WIDTH);
  });

  it("caps at 50% of the viewport above the maximum", () => {
    expect(clampPanelWidth(1200, 1400)).toBe(700); // 0.5 * 1400
  });

  it("keeps MIN even when 50% of a tiny viewport is below MIN", () => {
    // The panel would rather overflow a very narrow window than collapse to nothing.
    expect(clampPanelWidth(500, 200)).toBe(MIN_PANEL_WIDTH); // 0.5*200=100 < 184 → MIN wins
  });

  it("rounds the max to a whole pixel", () => {
    expect(clampPanelWidth(9999, 777)).toBe(Math.round(777 * 0.5)); // 389
  });

  it("DEFAULT is within the sane range and matches the old fixed w-56", () => {
    expect(DEFAULT_PANEL_WIDTH).toBeGreaterThanOrEqual(MIN_PANEL_WIDTH);
    expect(DEFAULT_PANEL_WIDTH).toBe(224); // Tailwind w-56 — first run must look unchanged
    // The floor is 180 of usable content plus the grip's reserved 4px strip.
    expect(MIN_PANEL_WIDTH).toBe(184);
    expect(clampPanelWidth(DEFAULT_PANEL_WIDTH, 1400)).toBe(DEFAULT_PANEL_WIDTH);
  });
});

describe("clampGutterLabelWidth", () => {
  it("returns a value within range unchanged", () => {
    expect(clampGutterLabelWidth(200, 1400)).toBe(200); // 80 <= 200 <= 560
  });

  it("floors at MIN below the minimum", () => {
    expect(clampGutterLabelWidth(10, 1400)).toBe(MIN_GUTTER_LABEL_WIDTH);
  });

  it("caps at 40% of the viewport — tighter than the panel's 50%, since it eats the frame strip", () => {
    expect(clampGutterLabelWidth(9999, 1400)).toBe(560);
  });

  it("keeps MIN even when 40% of a tiny viewport is below MIN", () => {
    expect(clampGutterLabelWidth(300, 100)).toBe(MIN_GUTTER_LABEL_WIDTH); // 0.4*100=40 < 80
  });

  it("DEFAULT matches the old fixed LABEL_W so nothing moves on first run", () => {
    expect(DEFAULT_GUTTER_LABEL_WIDTH).toBe(120);
    expect(clampGutterLabelWidth(DEFAULT_GUTTER_LABEL_WIDTH, 1400)).toBe(120);
  });
});
