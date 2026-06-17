# Layer Groups (one-level, visual) — Design

**Status:** Approved (design phase)
**Date:** 2026-06-17

## Goal

Let the artist organize layers into **one-level, collapsible/expandable groups** for tidiness, with a
per-group **visibility toggle** that hides the whole group's layers non-destructively. Groups are an
organizational overlay; they do not change how frames composite beyond honoring group visibility.

## Scope

In scope:
- A `LayerGroup` (`id`, `name`, `collapsed`, `visible`) and a `groupId` on each layer.
- A group is a **contiguous run** of layers in `project.layers`, always **non-empty** (auto-dissolves
  when its last member leaves).
- LayerList: group headers (chevron collapse, name, visibility eye, ungroup), create via a button,
  drag layers in/out (nested SortableJS), per-group collapse.
- Timeline: hide a collapsed group's layer rows (mirrors LayerList; rendering unaffected).
- Compositing/onion honor `group.visible` (skip a layer whose group is hidden).
- Persistence of the group structure + membership.

Out of scope (YAGNI): **nested groups**, **group opacity**, multi-select-then-group (no layer
multi-select exists), and group reordering UI beyond what drag provides.

## Decisions

1. **Flat array + overlay.** `project.layers` stays a flat ordered array; groups are metadata
   (`groupId` per layer + a `project.groups` list). A group = a contiguous run. This keeps compositing,
   the draw list, the timeline cell-tracks, and pixel persistence working on the flat array unchanged,
   except for the single group-visibility check.
2. **Create from the active layer.** A "New group" button makes a new group containing the active layer
   (a run of one), removing it from any prior group (which dissolves if emptied). Drag more layers in.
3. **Visibility is a non-destructive `group.visible` flag** honored in the draw list (a layer renders
   only if `layer.visible && group.visible`). Toggling a group does **not** touch children's own
   `visible`, so un-hiding restores their individual states.
4. **Collapse is pure UI.** Collapsing hides the group's layer rows in both the LayerList and the
   Timeline; it never affects rendering.
5. **Group structure is not undoable in v1** (organizational). Create/dissolve/collapse/visible/rename
   are direct mutations + `bump()`. Layer reordering stays undoable as today; `groupId` is a layer
   field so it rides the existing structural snapshot. A `groupId` that matches no live group is
   treated as **ungrouped** (tolerant of any dangling ref).
6. **One id space.** Group ids come from the same `nextLayerId` counter as layers (load updates
   `setMinLayerId` from both).

## Data model — `src/anim/document.ts`

```ts
export interface LayerGroup {
  id: number;
  name: string;
  collapsed: boolean;
  visible: boolean;
}
// DrawingLayer & ReferenceLayer each gain:
//   groupId: number | null;   // the LayerGroup.id this layer belongs to, or null
// Project gains:
//   groups: LayerGroup[];
```
`createDrawingLayer`/`createReferenceLayer` default `groupId: null`; `createProject` sets `groups: []`.
(Required-field ripple: add `groupId: null` to the `DrawingLayer`/`ReferenceLayer` literals in tests.)

**Pure helpers (Node-testable):**
```ts
/** A layer renders only if it is visible AND its group (if any, and still present) is visible. */
export function isLayerVisible(layer: Layer, groups: LayerGroup[]): boolean;
/** The group a layer belongs to, or null (null groupId, or a dangling id). */
export function groupOf(layer: Layer, groups: LayerGroup[]): LayerGroup | null;
/** Groups that still have ≥1 member among `layers` (used to drop emptied groups). */
export function nonEmptyGroups(groups: LayerGroup[], layers: Layer[]): LayerGroup[];
```

## Compositing & onion

- `buildFrameDrawList` (`document.ts`): change the existing `if (!layer.visible) continue;` to
  `if (!isLayerVisible(layer, project.groups)) continue;`. Everything else (z-order, keyframe
  resolution, op list) is unchanged.
- `onion.ts`: wherever it iterates layers for ghosts, apply the same `isLayerVisible` gate so a hidden
  group's layers don't ghost either.

## LayerList — `src/lib/LayerList.svelte`

- **Header button "New group"** → `groupActiveLayer()` (store action): create a `LayerGroup`
  (`name: "Group N"`, `collapsed: false`, `visible: true`), set the active layer's `groupId` to it
  (clearing/ dissolving any prior group). The layer keeps its position; it's a run of one.
- **Group header row** (rendered before a group's run): chevron (collapse/expand toggles
  `group.collapsed`), the group name (inline-rename, mirroring the layer rename pattern), a visibility
  **eye** (toggles `group.visible`), and an **ungroup** button (clears `groupId` on all members,
  removes the group). Indent the group's member rows slightly.
- **Collapse:** when `group.collapsed`, render the header but not its member rows.
- **Drag (nested SortableJS):** one Sortable for the root list plus one per group's members container,
  all sharing `group: "layers"`, so a row can be dragged between the root and any group container. On
  drop, rebuild from the DOM: walk the root in order — a bare layer row → that layer with
  `groupId: null`; a group block → its child rows in order with that group's id. This yields the new
  flat `project.layers` order **and** each layer's `groupId` with contiguity guaranteed by structure.
  Apply via the existing structural reorder so it's one undo step; then drop any now-empty groups
  (`nonEmptyGroups`).
- The existing per-layer rows (visibility, opacity, rename, ref badge/relink, video offset) are
  unchanged; they just may render nested under a group header.

## Timeline — `src/lib/Timeline.svelte`

In the layer-rows `{#each}`, skip a layer whose group is collapsed:
`{#if !groupOf(layer, state.project.groups)?.collapsed}` (a tolerant lookup). No group header row in
the timeline (the LayerList is the management surface); rows just hide/show. Frame-column geometry is
per-row, so hiding rows doesn't disturb alignment.

## Persistence — `src/persist/project-file.ts`

- `ProjectJson` gains `groups: { id, name, collapsed, visible }[]`.
- Each serialized layer (drawing layer JSON and the reference JSON) gains `groupId: number | null`.
- `projectToJson`: emit `project.groups` and each layer's `groupId`.
- `loadProjectBlob`: rebuild `project.groups`; set each layer's `groupId` from JSON (default `null` for
  old saves); include group ids when computing `maxId` for `setMinLayerId`. `groups: []` and absent
  `groupId` keep old saves loading unchanged.

## Store actions — `src/state/appState.svelte.ts`

All direct-mutate + `bump()` (not undoable), except the drag-reorder which uses the structural path:
- `groupActiveLayer()` — create a group from the active layer (see LayerList).
- `ungroup(groupId)` — clear `groupId` on members, remove the group.
- `toggleGroupCollapsed(groupId)`, `toggleGroupVisible(groupId)`, `renameGroup(groupId, name)`.
- The drag rebuild reuses the structural reorder (begin/commit snapshot) so reorder+membership is one
  undo step; emptied groups are pruned with `nonEmptyGroups` inside the same mutation.

## Testing

Vitest is **Node**. Unit-test the pure helpers + the draw-list gate; the SortableJS drag, the panels,
and persistence blob are manual-verified.

**Unit:**
- `isLayerVisible`: visible layer, no group → true; layer in a visible group → true; layer in a hidden
  group → false; hidden layer → false; dangling `groupId` (no matching group) → treated as ungrouped.
- `groupOf` / `nonEmptyGroups`: correct lookups; dangling id → null; a group with no members is excluded.
- `buildFrameDrawList`: a layer in a hidden group is omitted from the op list; unaffected when no groups.
- `projectToJson`/load round-trip of `groups` + `groupId` (the pure JSON parts, as with references).

**Manual (browser):**
- New group from the active layer; drag layers in/out; group auto-dissolves when emptied.
- Collapse/expand hides/shows member rows in both the LayerList and the Timeline; canvas unaffected.
- Group visibility eye hides all members on canvas; individual layer visibility states are preserved
  when the group is shown again.
- Rename a group; ungroup restores flat layers.
- Reorder a layer out of a group → undo restores it (groupId rides the snapshot).
- Save + reload: groups, membership, names, collapse/visibility persist; old saves load groupless.

## Self-review notes

- The overlay keeps the render pipeline almost untouched — one `isLayerVisible` swap in the draw list
  (+ onion). The risk is concentrated in the nested-SortableJS drag rebuild and keeping the two panels'
  collapse views consistent (both read `project.groups`).
- Non-destructive `group.visible` + dangling-tolerant `groupId` avoid the two classic group bugs
  (clobbered child state, stale references after undo).
- Undo is deliberately partial (reorder/membership yes; group create/dissolve/collapse/visible/name no)
  to avoid putting `project.groups` into the structural snapshot for a v1 organizational feature.
