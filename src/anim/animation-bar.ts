import type { ActiveRow } from "./active-row";
import {
  groupHasLockedLayer,
  isLayerLocked,
  isLayerVisible,
  layerAcceptsPropertyTracks,
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
}): AnimationBar {
  const { activeRow, layers, groups } = args;

  if (activeRow.kind === "audio") return { kind: "empty" };

  if (activeRow.kind === "group") {
    const g = groups.find((x) => x.id === activeRow.id);
    if (!g) return { kind: "empty" };
    const items: AnimationStartItem[] = [];
    if (!g.tracks?.transform) {
      items.push({
        action: "animate-group",
        groupId: g.id,
        blocked: groupAnimateBlocked(g, layers),
      });
    }
    if (!g.tracks?.opacity) {
      items.push({
        action: "animate-group-opacity",
        groupId: g.id,
        blocked: groupAnimateBlocked(g, layers),
      });
    }
    return items.length === 0 ? { kind: "empty" } : { kind: "start", items };
  }

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

  // `layerAcceptsPropertyTracks` is `kind === "draw"`, so a REFERENCE never reaches either item.
  // That is what retired the old "the reference is outside its visible range" reason: it could no
  // longer fire, and a dead branch here reads as "references still animate, just not right now".
  if (layerAcceptsPropertyTracks(layer) && !layer.tracks?.transform) {
    items.push({
      action: "animate-transform",
      layerId: layer.id,
      blocked: layerBlocked(layer, groups),
    });
  }

  if (layerAcceptsPropertyTracks(layer) && !layer.tracks?.opacity) {
    items.push({
      action: "animate-opacity",
      layerId: layer.id,
      blocked: layerBlocked(layer, groups),
    });
  }

  // NO fall-through to the layer's GROUP: a member row offers the layer's own actions only, and a
  // fully animated member row goes empty rather than offering its group's. Until group headers were
  // selectable a member row was the only route to Animate group — the 2026-08-18 spec lists
  // "Selecting the group header" as a non-goal and says the control "hangs off a member layer" —
  // but the group branch above serves the group's own row now, so the route survives one tap away.
  // Two reasons it had to go once that existed. (1) Since the Transform tool's scope became
  // row-derived (2026-09-11) `transformScopeOf` reads "layer" on a member row, so the canvas drag,
  // the gizmo and `animateTargetGroup` all decline to touch the group there; this bar was the last
  // control still acting on a row the user had not selected. (2) It rendered FOUR buttons of which
  // two were the same glyph (layer and group opacity are both `Blend`), separated only by `title` —
  // and on iPad a tap IS the activation, so the title cannot be read first. `animateTargetGroup`
  // had already refused a duplicated double-set for exactly that reason on a ref member.
  return items.length === 0 ? { kind: "empty" } : { kind: "start", items };
}
