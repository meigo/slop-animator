import type { Tool, BrushKind, ToolSettings } from "../state/appState.svelte";
import type { CurvePoint } from "../core/pressure-curve";

export interface Preferences {
  tool: Tool;
  brush: ToolSettings;
  eraser: ToolSettings;
  fill: { tolerance: number; expand: number; gap: number; color: string; opacity: number };
  loop: boolean;
  timelineHeight?: number; // px height of the resizable timeline panel
  layerPanelWidth?: number; // px width of the resizable layer panel
  timelineLabelWidth?: number; // px width of the timeline gutter's name column
  timelineCellW?: number; // px width of a timeline frame column
  pressureCurve: { cp1: CurvePoint; cp2: CurvePoint };
  /** Ignored since 2026-09-08 — the app is dark-only. Kept on the type so a stored pref from an
   *  older version still parses; nothing reads it, so a user who last saved "light" simply gets
   *  the one theme rather than being stranded in a light UI with no toggle to leave it. */
  theme?: "dark" | "light";
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
