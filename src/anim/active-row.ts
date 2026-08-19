import type { Layer, LayerGroup } from "./document";

export type ActiveRow =
  | { kind: "layer"; id: number }
  | { kind: "audio" }
  | { kind: "track"; owner: "layer"; id: number; prop: "transform" | "opacity" }
  | { kind: "track"; owner: "group"; id: number; prop: "transform" | "opacity" };

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

/** The group header stands in for a selection you cannot see: folded, and either a member
 *  (or its track) is selected, or this group's own track is focused. Expanded groups never
 *  light the header — that would be two selected rows. */
export function collapsedGroupSelected(
  row: ActiveRow,
  group: { id: number; collapsed?: boolean },
  layers: { id: number; groupId?: number | null }[],
): boolean {
  if (!group.collapsed) return false;
  if (row.kind === "track" && row.owner === "group" && row.id === group.id) return true;
  return layers.some((l) => l.groupId === group.id && layerRowSelected(row, l.id));
}

export function resolveStaleTrackFocus(
  row: ActiveRow,
  doc: { layers: Layer[]; groups: LayerGroup[] },
  activeLayerId: number,
): ActiveRow {
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
