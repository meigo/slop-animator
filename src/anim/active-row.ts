import type { Layer, LayerGroup } from "./document";

export type ActiveRow =
  | { kind: "layer"; id: number }
  | { kind: "audio" }
  | { kind: "group"; id: number }
  | { kind: "track"; owner: "layer"; id: number; prop: "transform" | "opacity" }
  | { kind: "track"; owner: "group"; id: number; prop: "transform" | "opacity" };

/** What the selected row is working on. A layer-owned track is its owner; a group-owned
 *  track is the group. Audio / group / group-track never fall through to leftover
 *  `activeLayerId` — that is memory, not the target. */
export type WorkingTarget =
  | { kind: "layer"; id: number }
  | { kind: "group"; id: number }
  | { kind: "audio" };

export function workingTarget(row: ActiveRow): WorkingTarget {
  if (row.kind === "audio") return { kind: "audio" };
  if (row.kind === "layer") return { kind: "layer", id: row.id };
  if (row.kind === "track" && row.owner === "layer") return { kind: "layer", id: row.id };
  return { kind: "group", id: row.id };
}

/** The layer a layer-scoped action (duplicate, merge, delete, new group) should hit.
 *  Null when the working target is audio or a group. */
export function targetLayerId(row: ActiveRow): number | null {
  const t = workingTarget(row);
  return t.kind === "layer" ? t.id : null;
}

export function layerRowSelected(row: ActiveRow, layerId: number): boolean {
  if (row.kind === "layer") return row.id === layerId;
  // A layer and its own track are one thing. A group track is not: lighting a member
  // (the gizmo's draw target) made that child look selected while you were on Transform.
  if (row.kind === "track" && row.owner === "layer") return row.id === layerId;
  return false;
}

export function trackRowSelected(
  row: ActiveRow,
  owner: "layer" | "group",
  id: number,
  prop: string,
): boolean {
  return row.kind === "track" && row.owner === owner && row.id === id && row.prop === prop;
}

export function audioRowSelected(row: ActiveRow): boolean {
  return row.kind === "audio";
}

export function groupRowSelected(row: ActiveRow, groupId: number): boolean {
  return row.kind === "group" && row.id === groupId;
}

/** Light the group header: the working target is this group (header or its own track), or
 *  it is folded and standing in for a hidden member. Expanded + a member selected lights
 *  only the member — two selected rows is the look we removed. A group track lights the
 *  header even when expanded: the layer panel has no track row, and a layer track already
 *  lights its owner the same way. */
export function groupHeaderSelected(
  row: ActiveRow,
  group: { id: number; collapsed?: boolean },
  layers: { id: number; groupId?: number | null }[],
): boolean {
  const wt = workingTarget(row);
  if (wt.kind === "group" && wt.id === group.id) return true;
  if (!group.collapsed) return false;
  return layers.some((l) => l.groupId === group.id && layerRowSelected(row, l.id));
}

/** May a Transform gesture act on `layer` while `row` is the selected row?
 *
 *  The CAPABILITY twin of the highlight predicates above, and it exists because the six highlight
 *  fixes converted what LIGHTS UP without converting what a drag is allowed to touch. A GROUP row
 *  is working on THAT group; `activeLayerId` under it is a remembered ANCHOR, not the target — so
 *  the gesture is only the lit row's while the scope really is "group" AND that anchor is a DRAW
 *  layer really inside it. Every other combination moved something the artist could not see was
 *  selected: layer scope moved the member's own transform, an anchor left over in another group
 *  moved THAT group, and a ref anchor fell through to the ref's own transform (only a draw layer
 *  reaches the group branch of `transformTarget`). Audio never transforms at all.
 *
 *  Both transform surfaces ask through here — `RefTransformGizmo.activeTransformLayer` (what draws
 *  handles) and `Canvas.onStroke`'s group branch (what a canvas drag may write). They must agree,
 *  exactly as the gizmo and `refPinned` must for a pinned reference: hiding the handles alone would
 *  leave the drag reachable with nothing on screen to explain it. */
export function rowAdmitsTransform(
  row: ActiveRow,
  scope: "frame" | "layer" | "group",
  layer: { kind: Layer["kind"]; groupId?: number | null },
): boolean {
  const wt = workingTarget(row);
  if (wt.kind === "audio") return false;
  if (wt.kind === "group")
    return scope === "group" && layer.kind === "draw" && (layer.groupId ?? null) === wt.id;
  return true;
}

export function resolveStaleTrackFocus(
  row: ActiveRow,
  doc: { layers: Layer[]; groups: LayerGroup[] },
  activeLayerId: number,
): ActiveRow {
  if (row.kind === "group") {
    return doc.groups.some((g) => g.id === row.id) ? row : { kind: "layer", id: activeLayerId };
  }
  if (row.kind !== "track") return row;
  if (row.owner === "layer") {
    const l = doc.layers.find((x) => x.id === row.id);
    if (l?.tracks?.[row.prop]) return row;
    return { kind: "layer", id: activeLayerId };
  }
  const g = doc.groups.find((x) => x.id === row.id);
  if (row.prop === "opacity" ? g?.tracks?.opacity : g?.tracks?.transform) return row;
  return { kind: "layer", id: activeLayerId };
}
