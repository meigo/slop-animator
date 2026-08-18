import { isLayerLocked, isLayerVisible, isRefVisibleAtFrame } from "../anim/document";
import type { Layer, LayerGroup } from "../anim/document";
import type { Tool } from "../state/appState.svelte";

/**
 * Whose transform an Animate control (or a transform drag) acts on, or null when none applies.
 *
 * A ref is animatable under ANY tool because its gizmo is always live — the same reason
 * Reset-to-fit sits outside the per-tool branches. A DRAW layer is only animatable under the
 * Transform tool at LAYER scope: at frame scope a drag writes the cell's transform and at group
 * scope the group's, so neither touches a key. A locked or hidden layer is never a target, and
 * neither is a ref outside its own frame span — `RefTransformGizmo.activeTransformLayer` and
 * `Canvas.refPinned` gate the same way (hiding the handles / refusing the drag) and say they must
 * agree; this is a third site offering the same authoring affordance, so it must agree too.
 *
 * Its own module (rather than a component's script) so BOTH `ToolOptions` and `StatusBar` import
 * the one predicate — the bar is the only thing talking at frame/group scope, where these controls
 * vanish, so a second hand-written copy promising a key would be wrong in the one place nothing
 * else could correct it. Being plain TypeScript also makes it node-testable; `status-hint.ts` is
 * the same pattern for the same reason.
 */
export function animateTargetLayer(
  layer: Layer | null | undefined,
  groups: LayerGroup[],
  tool: Tool,
  scope: "frame" | "layer" | "group",
  playhead: number,
  fps: number,
): Layer | null {
  if (!layer) return null;
  if (isLayerLocked(layer, groups)) return null;
  if (!isLayerVisible(layer, groups)) return null;
  if (layer.kind === "ref") return isRefVisibleAtFrame(layer, playhead, fps) ? layer : null;
  return tool === "transform" && scope === "layer" ? layer : null;
}
