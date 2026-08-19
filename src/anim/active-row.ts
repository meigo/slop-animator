import type { Layer, LayerGroup } from "./document";

export type ActiveRow =
  | { kind: "layer"; id: number }
  | { kind: "audio" }
  | { kind: "group"; id: number }
  | { kind: "track"; owner: "layer"; id: number; prop: "transform" | "opacity" }
  | { kind: "track"; owner: "group"; id: number; prop: "transform" | "opacity" };

/** The layer a layer-scoped action (duplicate, merge, delete, new group) should hit.
 *  Audio / group / a group-owned track have none — `activeLayerId` is leftover memory, not
 *  the working target. A layer-owned track is the same target as its owner. */
export function targetLayerId(row: ActiveRow): number | null {
  if (row.kind === "layer") return row.id;
  if (row.kind === "track" && row.owner === "layer") return row.id;
  return null;
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

/** Light the group header: the group row itself is selected, or it is folded and standing in
 *  for a hidden member / this group's own track. Expanded + a member selected lights only
 *  the member — two selected rows is the look we removed. */
export function groupHeaderSelected(
  row: ActiveRow,
  group: { id: number; collapsed?: boolean },
  layers: { id: number; groupId?: number | null }[],
): boolean {
  if (row.kind === "group" && row.id === group.id) return true;
  if (!group.collapsed) return false;
  if (row.kind === "track" && row.owner === "group" && row.id === group.id) return true;
  return layers.some((l) => l.groupId === group.id && layerRowSelected(row, l.id));
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
