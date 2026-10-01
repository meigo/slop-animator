/**
 * Where a row dragged in the layer panel lands (2026-10-01, replacing SortableJS — see
 * `../SLOP-LAYER-DRAG.md` and the spec `docs/superpowers/specs/2026-10-01-layer-drag-without-sortable-design.md`).
 * Pure: the panel measures its rows once, passes them here with the pointer's y, draws what comes
 * back and commits `order` on release — so what is shown is what lands, and nothing moves a DOM node.
 *
 * The model is flat: `layers` bottom-first, a group is a run of consecutive layers sharing `groupId`,
 * one level deep. Every order this returns keeps each group's members one unbroken run.
 */
import { groupOf, type Layer, type LayerGroup } from "./document";
import { buildSegments } from "./row-layout";

/** One visible row, top first, in the list's content coordinates. `key` keeps a layer and a group
 *  with the same numeric id apart (older saves may have one). */
export type RowBox = {
  kind: "layer" | "group";
  id: number;
  key: string;
  top: number;
  bottom: number;
};
export type Drag = { kind: "layer"; id: number } | { kind: "group"; id: number };
export type OrderEntry = { id: number; groupId: number | null };
/** `order` is bottom-first, what `reorderLayersWithGroups` takes. `into` is the group whose header
 *  is marked as the destination — the end of a group and just below it look the same otherwise. */
export type Drop = { order: OrderEntry[]; into: number | null };

export function rowKey(kind: "layer" | "group", id: number): string {
  return kind === "layer" ? `l${id}` : `g${id}`;
}

/** The layers in `order`, each given its new group. Mutates `groupId` on the same objects, as the
 *  store action always has (`groupId` is restored by `restoreStructure` on undo). */
export function applyOrder(layers: Layer[], order: readonly OrderEntry[]): Layer[] {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const next: Layer[] = [];
  for (const e of order) {
    const l = byId.get(e.id);
    if (!l) continue;
    l.groupId = e.groupId;
    next.push(l);
  }
  return next;
}

const mid = (r: { top: number; bottom: number }) => (r.top + r.bottom) / 2;

/** The row (or block) under `y`: the first whose bottom is below it, else the last — so a y above
 *  the list, below it, or in a 1px border between blocks still picks a neighbour. */
function under<T extends { bottom: number }>(items: readonly T[], y: number): T {
  return items.find((r) => y < r.bottom) ?? items[items.length - 1];
}

type Placed = { display: OrderEntry[]; into: number | null };

export function dropTarget(
  layers: Layer[],
  groups: LayerGroup[],
  rows: readonly RowBox[],
  y: number,
  drag: Drag,
): Drop | null {
  if (rows.length === 0) return null;
  // Top first, each layer with the group it is DRAWN in (a dangling groupId draws as top-level).
  const display: OrderEntry[] = [...layers]
    .reverse()
    .map((l) => ({ id: l.id, groupId: groupOf(l, groups)?.id ?? null }));
  const placed =
    drag.kind === "layer"
      ? placeLayer(display, groups, rows, y, drag.id)
      : placeGroup(display, rows, y, drag.id);
  if (!placed) return null;
  const same = placed.display.every(
    (e, i) => e.id === display[i].id && e.groupId === display[i].groupId,
  );
  if (same) return null;
  return { order: [...placed.display].reverse(), into: placed.into };
}

/** The visible rows' keys, top first, as they will be after `drop` (2026-10-01, as slop-paint's
 *  `rowOrderAfter`): what the panel slides each row to while dragging, so the dragged row's own
 *  place moves to the slot and the rows it passes close up. Built by the panel's own segment rule
 *  on copies, so a collapsed group still shows only its header, and a group the drop empties —
 *  `reorderLayersWithGroups` removes it — has no row. The layers are not touched. */
export function rowOrderAfter(layers: Layer[], groups: LayerGroup[], drop: Drop): string[] {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const moved: Layer[] = [];
  for (const e of drop.order) {
    const l = byId.get(e.id);
    if (l) moved.push({ ...l, groupId: e.groupId } as Layer);
  }
  const keys: string[] = [];
  for (const seg of buildSegments(moved, groups)) {
    if ("layer" in seg) keys.push(rowKey("layer", seg.layer.id));
    else {
      keys.push(rowKey("group", seg.group.id));
      if (!seg.group.collapsed) for (const l of seg.layers) keys.push(rowKey("layer", l.id));
    }
  }
  return keys;
}

/** A layer goes by the row under the pointer: above or below a layer row in that row's group;
 *  above a group header = above the block; below it = into the group's top, or below the block
 *  when the group is collapsed (its members are not rows, and a drop never hides a layer).
 *  Past the last row = the end of the list at the top level: without it a layer could never land
 *  below an expanded group that ends the list (the clamp picks its last member = into it). */
function placeLayer(
  display: OrderEntry[],
  groups: LayerGroup[],
  rows: readonly RowBox[],
  y: number,
  id: number,
): Placed | null {
  const from = display.findIndex((e) => e.id === id);
  if (from < 0) return null;
  const end = rows[rows.length - 1].bottom;
  if (y >= end) {
    const next = display.filter((e) => e.id !== id);
    next.push({ id, groupId: null });
    return { display: next, into: null };
  }
  const row = under(rows, y);
  const upper = y < mid(row);
  let at: number;
  let groupId: number | null;
  if (row.kind === "layer") {
    const i = display.findIndex((e) => e.id === row.id);
    if (i < 0) return null;
    at = upper ? i : i + 1;
    groupId = display[i].groupId;
  } else {
    const g = groups.find((x) => x.id === row.id);
    const first = display.findIndex((e) => e.groupId === row.id);
    if (!g || first < 0) return null;
    let last = first;
    while (last + 1 < display.length && display[last + 1].groupId === row.id) last++;
    if (upper) [at, groupId] = [first, null];
    else if (g.collapsed) [at, groupId] = [last + 1, null];
    else [at, groupId] = [first, g.id];
  }
  const next = display.filter((e) => e.id !== id);
  next.splice(from < at ? at - 1 : at, 0, { id, groupId });
  return { display: next, into: groupId };
}

type Block = { kind: "layer" | "group"; id: number; top: number; bottom: number };

/** Top-level blocks: a group header with its visible members, or a layer outside any group. */
function blocks(rows: readonly RowBox[], display: OrderEntry[]): Block[] {
  const groupOfId = new Map(display.map((e) => [e.id, e.groupId]));
  const out: Block[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (r.kind === "layer" && last?.kind === "group" && groupOfId.get(r.id) === last.id)
      last.bottom = r.bottom;
    else out.push({ kind: r.kind, id: r.id, top: r.top, bottom: r.bottom });
  }
  return out;
}

/** A group goes by the top-level block under the pointer — above or below it, never into another
 *  group (a group in a group has no representation here). */
function placeGroup(
  display: OrderEntry[],
  rows: readonly RowBox[],
  y: number,
  id: number,
): Placed | null {
  const run = display.filter((e) => e.groupId === id);
  if (run.length === 0) return null;
  const block = under(blocks(rows, display), y);
  if (block.kind === "group" && block.id === id) return null;
  const upper = y < mid(block);
  const rest = display.filter((e) => e.groupId !== id);
  const inBlock = (e: OrderEntry) =>
    block.kind === "group" ? e.groupId === block.id : e.id === block.id && e.groupId === null;
  const first = rest.findIndex(inBlock);
  if (first < 0) return null;
  let last = first;
  while (last + 1 < rest.length && inBlock(rest[last + 1])) last++;
  rest.splice(upper ? first : last + 1, 0, ...run);
  return { display: rest, into: null };
}
