import type { ActiveRow } from "./active-row";
import {
  groupHasLockedLayer,
  groupOf,
  isLayerLocked,
  isLayerVisible,
  isRefVisibleAtFrame,
  type Layer,
  type LayerGroup,
  type TrackRef,
} from "./document";

export type AnimationStartItem =
  | { action: "animate-transform"; layerId: number; blocked: string | null }
  | { action: "animate-opacity"; layerId: number; blocked: string | null }
  | { action: "animate-group"; groupId: number; blocked: string | null }
  | { action: "animate-group-opacity"; groupId: number; blocked: string | null };

export type AnimationBar =
  | { kind: "start"; items: AnimationStartItem[] }
  | {
      kind: "keys";
      track: TrackRef;
      blocked: string | null;
    }
  | { kind: "empty" };

function layerBlocked(layer: Layer, groups: LayerGroup[]): string | null {
  if (isLayerLocked(layer, groups)) return "the layer is locked";
  if (!isLayerVisible(layer, groups)) return "the layer is hidden";
  return null;
}

function transformStartBlocked(
  layer: Layer,
  groups: LayerGroup[],
  playhead: number,
  fps: number,
): string | null {
  const base = layerBlocked(layer, groups);
  if (base) return base;
  if (layer.kind === "ref" && !isRefVisibleAtFrame(layer, playhead, fps)) {
    return "the reference is outside its visible range";
  }
  return null;
}

function groupAnimateBlocked(group: LayerGroup, layers: Layer[]): string | null {
  if (groupHasLockedLayer(group, layers)) return "a locked member pins the group";
  return null;
}

/** Same lookup shape as `trackForRef`, without needing a full Project. */
function trackExists(layers: Layer[], groups: LayerGroup[], ref: TrackRef): boolean {
  if (ref.owner === "group") {
    const g = groups.find((x) => x.id === ref.id);
    return !!g?.tracks?.[ref.prop];
  }
  const l = layers.find((x) => x.id === ref.id);
  if (!l?.tracks) return false;
  return !!l.tracks[ref.prop];
}

function keysBlocked(ref: TrackRef, layers: Layer[], groups: LayerGroup[]): string | null {
  if (ref.owner === "group") {
    const g = groups.find((x) => x.id === ref.id);
    if (!g) return null;
    return groupAnimateBlocked(g, layers);
  }
  const l = layers.find((x) => x.id === ref.id);
  if (!l) return null;
  return layerBlocked(l, groups);
}

export function animationBar(args: {
  activeRow: ActiveRow;
  layers: Layer[];
  groups: LayerGroup[];
  playhead: number;
  fps: number;
}): AnimationBar {
  const { activeRow, layers, groups, playhead, fps } = args;

  if (activeRow.kind === "audio") return { kind: "empty" };

  if (activeRow.kind === "track") {
    const track: TrackRef =
      activeRow.owner === "group"
        ? { owner: "group", id: activeRow.id, prop: activeRow.prop }
        : { owner: "layer", id: activeRow.id, prop: activeRow.prop };
    if (!trackExists(layers, groups, track)) return { kind: "empty" };
    return {
      kind: "keys",
      track,
      blocked: keysBlocked(track, layers, groups),
    };
  }

  const layer = layers.find((l) => l.id === activeRow.id);
  if (!layer) return { kind: "empty" };

  const items: AnimationStartItem[] = [];

  if (!layer.tracks?.transform) {
    items.push({
      action: "animate-transform",
      layerId: layer.id,
      blocked: transformStartBlocked(layer, groups, playhead, fps),
    });
  }

  if (!layer.tracks?.opacity) {
    items.push({
      action: "animate-opacity",
      layerId: layer.id,
      blocked: layerBlocked(layer, groups),
    });
  }

  const g = groupOf(layer, groups);
  if (g && !g.tracks?.transform) {
    items.push({
      action: "animate-group",
      groupId: g.id,
      blocked: groupAnimateBlocked(g, layers),
    });
  }
  if (g && !g.tracks?.opacity) {
    items.push({
      action: "animate-group-opacity",
      groupId: g.id,
      blocked: groupAnimateBlocked(g, layers),
    });
  }

  return items.length === 0 ? { kind: "empty" } : { kind: "start", items };
}
