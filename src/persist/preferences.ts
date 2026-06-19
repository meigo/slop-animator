import type { Tool, BrushKind, ToolSettings } from "../state/appState.svelte";
import type { CurvePoint } from "../core/pressure-curve";

export interface Preferences {
  tool: Tool;
  brush: ToolSettings;
  eraser: ToolSettings;
  fill: { tolerance: number; expand: number };
  theme: "dark" | "light";
  loop: boolean;
  pressureCurve: { cp1: CurvePoint; cp2: CurvePoint };
  // Legacy (read-only back-compat; older versions wrote these at the top level).
  brushType?: BrushKind;
  sizeRange?: number;
  streamline?: number;
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
