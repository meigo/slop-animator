import type { Tool, BrushKind, ToolSettings } from "../state/appState.svelte";
import type { CurvePoint } from "../core/pressure-curve";

export type CurvePrefs = { cp1: CurvePoint; cp2: CurvePoint };

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
  /** The BRUSH pressure curve (the key predates the eraser having its own). */
  pressureCurve: CurvePrefs;
  /** The eraser's own curve (2026-09-14). Absent in older prefs, where one curve drove both tools. */
  eraserPressureCurve?: CurvePrefs;
  /** Transform corners scale proportionally. Absent = on (the default), so older prefs keep it. */
  keepProportions?: boolean;
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

/** The stored Keep proportions setting; anything but an explicit boolean means the default, on. */
export function keepProportionsPref(p: Partial<Preferences>): boolean {
  return typeof p.keepProportions === "boolean" ? p.keepProportions : true;
}

export function savePreferences(p: Preferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* quota / unavailable — ignore */
  }
}

function isCurvePoint(v: unknown): v is CurvePoint {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as CurvePoint).x === "number" &&
    typeof (v as CurvePoint).y === "number"
  );
}

/** A stored curve's control points, keeping only the ones that are a numeric `{x, y}`. */
export function curvePointsPref(raw: unknown): Partial<CurvePrefs> {
  const out: Partial<CurvePrefs> = {};
  if (!raw || typeof raw !== "object") return out;
  const { cp1, cp2 } = raw as Partial<Record<"cp1" | "cp2", unknown>>;
  if (isCurvePoint(cp1)) out.cp1 = { x: cp1.x, y: cp1.y };
  if (isCurvePoint(cp2)) out.cp2 = { x: cp2.x, y: cp2.y };
  return out;
}

/** The eraser curve to apply: its own when stored, else the brush curve — before 2026-09-14 one
 *  curve drove both tools, and a tuned eraser feel must survive the split. */
export function eraserCurvePref(p: Partial<Preferences>): Partial<CurvePrefs> {
  return curvePointsPref(
    p.eraserPressureCurve && typeof p.eraserPressureCurve === "object"
      ? p.eraserPressureCurve
      : p.pressureCurve,
  );
}
