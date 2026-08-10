/**
 * Idle status-bar hint: the non-obvious gestures available right now. Pure (no DOM, no store) so it
 * is unit-testable; `StatusBar` shows `statusHint || contextHint(...)` so a real hover/press hint
 * always wins. Content rule (2026-08-11 spec): only what a first-time user CANNOT see — no
 * keyboard-shortcut lists, nothing that restates a visible button.
 */
export interface HintContext {
  tool: string;
  /** Active layer is a locked drawing layer → every content op silently refuses. */
  locked: boolean;
  /** Active layer is hidden → content ops refuse too (you can't see what you'd be editing). */
  hiddenLayer: boolean;
  /** Active draw layer carries a non-identity transform → select/lasso/deform/pose bail. */
  layerTransformed: boolean;
  /** A committed marquee exists (not lifted). */
  selectionActive: boolean;
  /** Pixels are lifted/floating — for the deform tool this also means "in the warp grid". */
  selectionFloating: boolean;
  /** The pose mesh is built. */
  poseActive: boolean;
}

const BLOCKED_BY_TRANSFORM = ["select", "lasso", "deform", "pose"];

export function contextHint(c: HintContext): string {
  // A hint for a gesture that currently does nothing is worse than no hint: explain the block first.
  if (c.locked) return "Layer locked — unlock it in the layer list to edit";
  if (c.hiddenLayer) return "Layer hidden — show it to edit";
  if (c.layerTransformed && BLOCKED_BY_TRANSFORM.includes(c.tool))
    return "Apply or reset the layer transform to use this tool";

  switch (c.tool) {
    case "select":
    case "lasso":
      if (c.selectionFloating) return "Drag to move · tap outside to bake · Deselect reverts";
      if (c.selectionActive) return "Drag inside to move · tap outside to deselect";
      return c.tool === "lasso" ? "Draw a loop to select" : "Drag to select an area";
    case "transform":
      return "Drag to move · corners scale · top handle rotates";
    case "deform":
      return c.selectionFloating
        ? "Drag a grid point to warp · leaving the tool bakes it"
        : "Tap the drawing to lift it into a warp grid";
    case "pose":
      return c.poseActive
        ? "Tap to add a handle · drag a handle to pose · drag its nub to rotate and set reach · leaving the tool bakes it"
        : "Tap the drawing to build the pose mesh";
    default:
      return ""; // brush/eraser/fill/eyedropper: drag-to-draw needs no teaching
  }
}
