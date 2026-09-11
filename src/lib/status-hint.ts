/**
 * Idle status-bar hint: the non-obvious gestures available right now. Pure (no DOM, no store) so it
 * is unit-testable; `StatusBar` shows `statusHint || contextHint(...)` so a real hover/press hint
 * always wins. Content rule (2026-08-11 spec): only what a first-time user CANNOT see — no
 * keyboard-shortcut lists, nothing that restates a visible button.
 */
import type { TransformRefusal } from "../anim/active-row";
import type { LayerEditBlock } from "../anim/document";

/** On-canvas / tool-options copy for a layer that refuses edits. General — paint and transform. */
export function editBlockLabel(block: LayerEditBlock): string {
  switch (block) {
    case "locked":
      return "Layer locked — unlock it to edit";
    case "hidden":
      return "Layer hidden — show it to edit";
    // Named separately because the FIX is a different control. Saying "Layer hidden" for a layer
    // whose own eye is already on sends you to toggle something that changes nothing.
    case "group-locked":
      return "Group locked — unlock the group to edit";
    case "group-hidden":
      return "Group hidden — show the group to edit";
    case "not-draw":
      return "Switch to a drawing layer to edit";
    case "not-layer-row":
      return "Select a layer row to edit";
  }
}

/** Canvas caption for a frame a loop key plays: read-only, and the frame to go to instead.
 *  Frames are 0-based in, 1-based out (the ruler's numbering). */
export function loopEditLabel(frame: number, source: number): string {
  return `Frame ${frame + 1} repeats frame ${source + 1} — edit it there`;
}

export interface HintContext {
  tool: string;
  /** Why the active layer refuses content ops, or null when it accepts them. ONE field rather than
   *  a `locked` and a `hiddenLayer` boolean: those two were computed here from `isLayerLocked` /
   *  `isLayerVisible`, which fold a group's flags into the layer's, so the hint could not tell a
   *  hidden layer from a hidden group and said "Layer hidden" for both. Passing the reason itself
   *  means the caller cannot re-derive it differently from `whyNotEditable`. */
  editBlock: LayerEditBlock | null;
  /** Active layer is a reference (or otherwise not a drawing). Pixel tools refuse; transform,
   *  select, and eyedropper still do something. */
  notDraw: boolean;
  /** Timeline audio row is selected. The remembered draw-target layer is not what you are
   *  working on — transform must not promise a leftover-layer drag. Blocked as `not-layer-row`,
   *  NOT `not-draw`: the active layer here is usually a perfectly good drawing layer. */
  audioRow: boolean;
  /** Group header or a group-owned track is the working target. Pixel tools refuse;
   *  transform aims at the group. */
  groupRow: boolean;
  /** Why a group row refuses the Transform tool RIGHT NOW, or null when it admits it. `groupRow`
   *  alone used to imply "transform works here", which stopped being true once
   *  `rowAdmitsTransform` gained its anchor term: a group of REFERENCES silently returns from the
   *  drag while the bar cheerfully described the gesture. That is precisely the failure this whole function exists to prevent. */
  groupTransformBlock: TransformRefusal | null;
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
      return editBlockLabel("not-layer-row");
  }
  if (c.groupRow) {
    if (
      c.tool === "brush" ||
      c.tool === "eraser" ||
      c.tool === "fill" ||
      c.tool === "deform" ||
      c.tool === "pose"
    )
      return editBlockLabel("not-layer-row");
    // Transform is the one tool a group row usually DOES admit, so it is excluded above — but only
    // usually: "no draw member" is not fixable at all for a group of references, and saying so beats
    // promising a drag.
    // Each value matched EXPLICITLY: `audio-row` cannot reach here (a row is one or the other), and
    // an `else` would have silently printed the group message for it if that ever changed.
    if (c.tool === "transform" && c.groupTransformBlock === "no-draw-member")
      return "This group has no drawing layer to transform";
  }
  if (c.editBlock && c.editBlock !== "not-draw" && c.editBlock !== "not-layer-row")
    return editBlockLabel(c.editBlock);
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
