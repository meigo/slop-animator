import { groupOf, type Layer, type LayerGroup } from "./document";

/**
 * Display ordering for the layer stack, shared by the layer panel and the timeline.
 *
 * `project.layers` is stored bottom-first and `project.groups` is a PARALLEL array — membership is a
 * back-reference (`layer.groupId`), so neither array on its own describes what the artist sees.
 * Reconstructing that was panel-only, which is why the timeline had no group rows at all: it walked
 * `layers` directly and consulted groups solely to skip collapsed members. One source of ordering
 * means the two views cannot drift.
 */

/** A group block, or a layer with no group. Top-first, i.e. reversed from the data order. */
export type Segment = { layer: Layer } | { group: LayerGroup; layers: Layer[] };

/**
 * Group contiguous members into blocks, top-first.
 *
 * Contiguity is assumed rather than enforced: the panel's drag-reorder keeps a group's members
 * adjacent, and a group whose members were somehow split would render as two blocks rather than
 * throwing — a visible oddity beats a crash over a corrupt-but-openable project.
 */
export function buildSegments(layers: Layer[], groups: LayerGroup[]): Segment[] {
  const segs: Segment[] = [];
  for (const layer of [...layers].reverse()) {
    const g = groupOf(layer, groups);
    const last = segs[segs.length - 1];
    if (g && last && "group" in last && last.group.id === g.id) last.layers.push(layer);
    else if (g) segs.push({ group: g, layers: [layer] });
    else segs.push({ layer });
  }
  return segs;
}

/**
 * One timeline row. A group gets a row of its own — the panel draws a header for it, and without a
 * matching row a COLLAPSED group's content vanished from the timeline with nothing left to say it
 * existed.
 *
 * Group rows deliberately carry no layer identity. The timeline's selection axis resolves rows
 * through `data-layer-id` in the DOM, so a row without one is invisible to the marquee, to block
 * copy/paste/move, and to `resolveSelectionRect` — which is exactly right: a group holds no cells,
 * so there is nothing on it to select.
 */
export type TimelineRow =
  | { kind: "layer"; layer: Layer }
  | { kind: "group"; group: LayerGroup; hiddenCount: number };

/** Flatten segments into timeline rows, top-first. A collapsed group contributes only its own row,
 *  and reports how many layers it is standing in for. */
export function timelineRows(segments: Segment[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const seg of segments) {
    if ("layer" in seg) {
      rows.push({ kind: "layer", layer: seg.layer });
      continue;
    }
    rows.push({
      kind: "group",
      group: seg.group,
      hiddenCount: seg.group.collapsed ? seg.layers.length : 0,
    });
    if (!seg.group.collapsed) for (const layer of seg.layers) rows.push({ kind: "layer", layer });
  }
  return rows;
}
