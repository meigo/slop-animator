import { inverseChain, type ComposeStep, type Pt } from "./ref-transform";
import { isIdentityTransform } from "../anim/document";

function needsMap(steps: ComposeStep[]): boolean {
  return steps.some((s) => !isIdentityTransform(s.t));
}

export function mapDocPointToCell(steps: ComposeStep[], p: Pt): Pt {
  if (!needsMap(steps)) return p;
  return inverseChain(steps, p);
}

export function mapDocRectToCell(
  steps: ComposeStep[],
  r: { x: number; y: number; w: number; h: number },
): Pt[] {
  const corners = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  return mapDocPolyToCell(steps, corners);
}

export function mapDocPolyToCell(steps: ComposeStep[], pts: Pt[]): Pt[] {
  if (!needsMap(steps)) return pts.map((p) => ({ ...p }));
  return pts.map((p) => inverseChain(steps, p));
}
