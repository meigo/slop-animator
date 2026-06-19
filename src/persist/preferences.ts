import type { Tool, BrushKind } from "../state/appState.svelte";
import type { BrushSettings } from "../core/brush";
import type { CurvePoint } from "../core/pressure-curve";

export interface Preferences {
  tool: Tool;
  brush: BrushSettings;
  brushType: BrushKind;
  sizeRange: number;
  streamline: number;
  fill: { tolerance: number; expand: number };
  theme: "dark" | "light";
  loop: boolean;
  pressureCurve: { cp1: CurvePoint; cp2: CurvePoint };
}

const KEY = "slop-animator:prefs";

/** Pure parse: null/garbage → {}, a JSON object → its (partial) contents. */
export function parsePreferences(raw: string | null): Partial<Preferences> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Partial<Preferences>) : {};
  } catch {
    return {};
  }
}

export function loadPreferences(): Partial<Preferences> {
  try {
    return parsePreferences(localStorage.getItem(KEY));
  } catch {
    return {};
  }
}

export function savePreferences(p: Preferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* quota / unavailable — ignore */
  }
}
