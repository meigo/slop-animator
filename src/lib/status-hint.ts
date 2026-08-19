/**
 * Idle status-bar hint: the non-obvious gestures available right now. Pure (no DOM, no store) so it
 * is unit-testable; `StatusBar` shows `statusHint || contextHint(...)` so a real hover/press hint
 * always wins. Content rule (2026-08-11 spec): only what a first-time user CANNOT see — no
 * keyboard-shortcut lists, nothing that restates a visible button.
 */
import type { LayerEditBlock } from "../anim/document";

/** On-canvas / tool-options copy for a layer that refuses edits. General — paint and transform. */
export function editBlockLabel(block: LayerEditBlock): string {
  switch (block) {
    case "locked":
      return "Layer locked — unlock it to edit";
    case "hidden":
      return "Layer hidden — show it to edit";
    case "not-draw":
      return "Switch to a drawing layer to edit";
  }
}

export interface HintContext {
  tool: string;
  /** Active layer is a locked drawing layer → every content op silently refuses. */
  locked: boolean;
  /** Active layer is hidden → content ops refuse too (you can't see what you'd be editing). */
  hiddenLayer: boolean;
  /** Active layer is a reference (or otherwise not a drawing). Pixel tools refuse; transform,
   *  select, and eyedropper still do something. */
  notDraw: boolean;
  /** Timeline audio row is selected. The remembered draw-target layer is not what you are
   *  working on — transform must not promise a leftover-layer drag. */
  audioRow: boolean;
  /** Group header is the selected row. Pixel tools refuse; transform aims at the group. */
  groupRow: boolean;
  /** A committed marquee exists (not lifted). */
  selectionActive: boolean;
  /** Pixels are lifted/floating — for the deform tool this also means "in the warp grid". */
  selectionFloating: boolean;
  /** The pose mesh is built. */
  poseActive: boolean;
  /** The playhead frame when the active layer has a transform track, else null. ZERO-based, like
   *  every frame number in the model; the hint renders it +1 because every number the artist sees
   *  (the f n/n readout, the ruler, a key's tooltip) is 1-based. A drag will write
   *  a key THERE, and saying so is the mitigation for auto-key's one hazard. */
  animatedFrame: number | null;
}

export function contextHint(c: HintContext): string {
  // A hint for a gesture that currently does nothing is worse than no hint: explain the block first.
  if (c.audioRow) {
    if (
      c.tool === "brush" ||
      c.tool === "eraser" ||
      c.tool === "fill" ||
      c.tool === "deform" ||
      c.tool === "pose" ||
      c.tool === "transform"
    )
      return editBlockLabel("not-draw");
  }
  if (c.groupRow) {
    if (
      c.tool === "brush" ||
      c.tool === "eraser" ||
      c.tool === "fill" ||
      c.tool === "deform" ||
      c.tool === "pose"
    )
      return editBlockLabel("not-draw");
  }
  if (c.locked) return editBlockLabel("locked");
  if (c.hiddenLayer) return editBlockLabel("hidden");
  if (
    c.notDraw &&
    (c.tool === "brush" ||
      c.tool === "eraser" ||
      c.tool === "fill" ||
      c.tool === "deform" ||
      c.tool === "pose")
  )
    return editBlockLabel("not-draw");

  switch (c.tool) {
    case "select":
    case "lasso":
      if (c.selectionFloating) return "Drag to move · tap outside to bake · Deselect reverts";
      if (c.selectionActive) return "Drag inside to move · tap outside to deselect";
      return c.tool === "lasso" ? "Draw a loop to select" : "Drag to select an area";
    case "transform":
      if (c.animatedFrame !== null)
        return `Animated — a drag keys frame ${c.animatedFrame + 1} · corners scale · top handle rotates`;
      return "Drag to move · corners scale · top handle rotates";
    case "deform":
      return c.selectionFloating
        ? "Drag a grid point to warp · leaving the tool bakes it"
        : "Tap the drawing to lift it into a warp grid";
    case "pose":
      return c.poseActive
        ? "Tap to add a handle · drag a handle to pose · drag its nub to rotate and set reach · leaving the tool bakes it"
        : "Tap the drawing to build the pose mesh";
    case "brush":
    case "eraser":
    case "fill":
      // A selection clips these tools, and with a paint tool active the on-canvas bar's ✕ is the
      // only reachable deselect — worth saying, since a forgotten marquee looks like a broken brush.
      return c.selectionActive || c.selectionFloating
        ? "Painting is clipped to the selection · ✕ on the selection bar deselects"
        : "";
    default:
      return ""; // eyedropper etc.: drag-to-draw needs no teaching
  }
}
