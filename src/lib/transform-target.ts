import {
  groupHasLockedLayer,
  groupOf,
  isLayerLocked,
  isLayerVisible,
  isRefVisibleAtFrame,
} from "../anim/document";
import type { Layer, LayerGroup } from "../anim/document";
import type { Tool } from "../state/appState.svelte";

/**
 * Whose transform an Animate control (or a transform drag) acts on, or null when none applies.
 *
 * A ref is animatable under ANY tool because its gizmo is always live — the same reason
 * Reset-to-fit sits outside the per-tool branches. A DRAW layer is only animatable under the
 * Transform tool at LAYER scope: at frame scope a drag writes the cell's transform and at group
 * scope the GROUP's, so neither writes a key on this layer. Group scope is not "no target" but a
 * different one — see `animateTargetGroup` below, which is what the Animate controls fall through
 * to there. A locked or hidden layer is never a target, and
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

/**
 * Which GROUP an Animate control (or a group-scope transform drag) acts on, or null when none.
 *
 * The group-scope twin of `animateTargetLayer` above, and the reason that one returns null at group
 * scope: there a drag writes the GROUP's transform, so the layer predicate is right to refuse and
 * this one is what says who the key belongs to. Same module deliberately — `ToolOptions` shows the
 * controls and `StatusBar` is the only thing talking at group scope, so a hand-written copy in a
 * component would break the one property this module exists to hold.
 *
 * Guarded on LOCK ONLY, not lock-plus-hidden, and that asymmetry with the layer predicate is
 * settled rather than accidental: `RefTransformGizmo.activeTransformLayer` returns its layer
 * unconditionally at group scope precisely so a hidden or locked ANCHOR cannot veto a group drag,
 * so a hidden group's transform is editable today — refusing to ANIMATE what you are still allowed
 * to DRAG would be the inconsistency. `groupHasLockedLayer` already reports a locked group itself,
 * so it needs no separate check for `group.locked`.
 */
export function animateTargetGroup(
  layer: Layer | null | undefined,
  groups: LayerGroup[],
  layers: Layer[],
  tool: Tool,
  scope: "frame" | "layer" | "group",
): LayerGroup | null {
  if (tool !== "transform" || scope !== "group") return null;
  if (!layer) return null;
  const group = groupOf(layer, groups);
  if (!group) return null;
  return groupHasLockedLayer(group, layers) ? null : group;
}
