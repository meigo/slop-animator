import {
  groupOf,
  GROUP_TRACK_PROPS,
  TRACK_PROPS,
  type GroupTrackProp,
  type Layer,
  type LayerGroup,
  type TrackProp,
} from "./document";

// Re-exported so a row-building consumer can take the row order from the module that lays out rows.
// The list itself lives in `document.ts`: it is the canonical set of animatable properties, and
// non-UI code (the frame shifter, the "is this animated at all?" gates) has to loop it too.
export { GROUP_TRACK_PROPS, TRACK_PROPS, type GroupTrackProp, type TrackProp };

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
 * so there is nothing on it to select. A PROPERTY row is the same story: a track holds no cells
 * either, so it carries no layer identity in the DOM.
 */
export type TimelineRow =
  | { kind: "layer"; layer: Layer }
  | { kind: "group"; group: LayerGroup; hiddenCount: number }
  | { kind: "track"; layer: Layer; prop: TrackProp }
  | { kind: "grouptrack"; group: LayerGroup; prop: GroupTrackProp };

/** Push a layer row, and — directly under it — one row per track it actually carries. Shared by
 *  both branches of `timelineRows` so the two can't drift.
 *
 *  `tracksCollapsed` folds them all away. It is the LAYER-level twin of `LayerGroup.collapsed`,
 *  down to the chevron the timeline draws for it: one collapse idiom, not two. */
function pushLayer(rows: TimelineRow[], layer: Layer): void {
  rows.push({ kind: "layer", layer });
  if (layer.tracksCollapsed) return;
  for (const prop of TRACK_PROPS)
    if (layer.tracks?.[prop]) rows.push({ kind: "track", layer, prop });
}

/** Flatten segments into timeline rows, top-first. A collapsed group contributes only its own row,
 *  and reports how many layers it is standing in for. */
export function timelineRows(segments: Segment[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const seg of segments) {
    if ("layer" in seg) {
      pushLayer(rows, seg.layer);
      continue;
    }
    rows.push({
      kind: "group",
      group: seg.group,
      hiddenCount: seg.group.collapsed ? seg.layers.length : 0,
    });
    if (seg.group.collapsed) continue;
    // The group's OWN property rows sit directly under its header, above the members — a group
    // transform/opacity compose above its layers, so the rows read in the order they apply.
    // `collapsed` still hides members AND these rows. `tracksCollapsed` folds only the property
    // rows, the same extra fold a layer has — so a fade can sit as a header + members.
    if (!seg.group.tracksCollapsed) {
      for (const prop of GROUP_TRACK_PROPS)
        if (seg.group.tracks?.[prop]) rows.push({ kind: "grouptrack", group: seg.group, prop });
    }
    for (const layer of seg.layers) pushLayer(rows, layer);
  }
  return rows;
}
