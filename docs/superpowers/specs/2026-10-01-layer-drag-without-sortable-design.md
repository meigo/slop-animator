# Layer-panel drag without SortableJS — port from slop-vector-editor

Date: 2026-10-01. Source: the shared plan `../SLOP-LAYER-DRAG.md` (slop-vector-editor's reference
implementation; slop-spine ported first, `2f7a828`). Replaces CLAUDE.md gotcha #2.

## Problem

`LayerList.svelte` reorders layers with SortableJS: a root Sortable over the list and one per
group's `.group-members`, sharing a group. SortableJS moves DOM nodes Svelte owns, and `rebuild`
reads the new order back from the DOM. What that has cost here:

- A row dropped at the bottom lands past the `{#each}` end anchor and survives teardown as a
  duplicate: worked around with `evt.item.remove()` plus a `{#key dragNonce}` remount of the list.
- `onEnd` fires twice on a cross-list drop: a microtask latch (`dropHandled`).
- The DOM read-back once produced `Number(undefined) = NaN`, and layers vanished (silent data loss).
- The remount leaked an open undo bracket from LayerProps' opacity slider (fixed by
  `settleOnUnmount`).
- Its rules are the app's only through a `put` guard (no group inside a group).
- Browser automation could never drive the desktop drag (native HTML5 drag).

## Goal / success criteria

1. Reorder at the top level, into a group, out of a group, and a whole group, with mouse, Pencil
   and finger; the result is one undo step.
2. The panel and the timeline show the same order afterwards (both build from `row-layout`).
3. A tap, Escape, `pointercancel` or `lostpointercapture` changes nothing.
4. Nothing moves a DOM node: no `{#key}` remount, no latch, no `evt.item.remove()`.
5. The drop rule is a pure, unit-tested function; the drag is drivable by Playwright.

## Decisions

- **Collapsed group: a drop lands beside it**, never inside (upper half of its header = above the
  block, lower half = below). As today, where the hidden member list cannot take a drop. (User's
  choice, 2026-10-01.)
- **One row drags at a time** (this panel has no multi-select).
- **A group drags as one block with a one-row ghost and a one-row gap**; the block (header and
  visible members) dims in place. Rule 7 of the shared doc, as vector-editor does it.
- **Gap and ghost use the dragged row's measured height**, not a fixed 32px (spine's rows were
  ~29px; same likely here).
- **A dragged group lands only between top-level blocks.** Over another group's members it snaps
  to that group's edge, so it is never refused for passing over a group.
- **Locked and hidden groups still take drops**, as today. (vector-editor refuses them; not changed
  here unasked.)
- **Pressing a grip does not change the selection**, as today.

## Design

### Pure logic — `src/anim/layer-drop.ts` (new, tested)

```ts
type RowBox = { kind: "layer" | "group"; id: number; top: number; bottom: number };
type Drag = { kind: "layer"; id: number } | { kind: "group"; id: number };
type Drop = { order: { id: number; groupId: number | null }[]; line: number; into: number | null };
function dropTarget(layers: Layer[], groups: LayerGroup[], rows: RowBox[], y: number, drag: Drag): Drop | null;
function applyOrder(layers: Layer[], order: { id: number; groupId: number | null }[]): Layer[];
```

- `rows` are the VISIBLE rows in display order (top first) in the list's content coordinates,
  measured once at lift. A collapsed group's members are not rows. A row's group comes from the
  model (`layer.groupId`), not from the DOM.
- `order` is bottom-first — what `reorderLayersWithGroups` already takes. `line` is the content y
  where the gap opens. `into` is the group whose block gets the destination outline (null at the
  top level); it is what tells "end of a group" from "just below it", whose lines coincide.
- **Layer drag**, by the row under `y` (clamped to the first / last row):
  - top-level layer row: upper half → above it, lower half → below it (top level);
  - group header: upper half → above the whole block (top level); lower half → expanded: into the
    group at its top (`into` = the group); collapsed: below the block (top level);
  - member row: upper half → above it, lower half → below it, in that group (`into` = the group).
- **Group drag**, by the top-level block under `y` (a block spans its header and visible members):
  upper half → above the block, lower half → below it. Over its own block → no drop.
- **`null`** when the resulting order equals the current one (over the dragged row itself, or next
  to where it already is). Every non-null `order` keeps each group's members contiguous and holds
  every layer exactly once.
- `applyOrder` is the order-applying core of `reorderLayersWithGroups` (`appState.svelte.ts`),
  moved out so it is testable: it sets each layer's `groupId` and returns the layers in `order`,
  skipping unknown ids. The store action keeps its no-op guard, `nonEmptyGroups`, `bump` and its one
  structural undo step; only its SortableJS comment goes.

### Visual helpers — `src/lib/layer-drag-visual.ts` (copied from slop-spine)

Spine's copy of vector-editor's file: numeric ids, `ghostTop(y, grab, contentHeight, rowPx?)`.
`DRAG_THRESHOLD_PX` (3), `pastThreshold`, `shiftedRowIds(rows, line)`, `ghostTop`,
`autoScrollStep`. Its tests come with it.

### Panel — `src/lib/LayerList.svelte`

- The existing `.layer-drag-handle` grips (layer rows and group headers) take
  `onpointerdown/move/up/cancel` and `onlostpointercapture`, with `touch-action: none`;
  `setPointerCapture` in try/catch. Rows carry `data-row-kind` / `data-row-id`.
- Past 3px the press lifts: measure the rows once (content coordinates) and the dragged row's
  height; dim the dragged row (a group: its header and visible members); show a ghost (absolute in
  the list, `data-drag-ghost`) at the grab offset with the layer's name, or the group's name and a
  member-count badge; start the edge auto-scroll (rAF).
- Each move recomputes one `drop`; the gap (rows at or below `drop.line` slide down one row height,
  150ms), the `into` outline (`.ui-drop-target`) and the cursor classes on `<html>`
  (`layer-dragging`, `layer-drop-refused`) all read it.
- Release: clear every visual and the transition in the same tick, then
  `reorderLayersWithGroups(drop.order)`. A press that never lifted lands nothing.
- Escape (window capture phase, while dragging), `pointercancel`, `lostpointercapture` and unmount
  (`$effect` teardown) restore everything.
- Removed: `sortablejs` import and dependency, `membersSortable`, the `onMount` Sortable,
  `rebuild`, `dropHandled`, `evt.item.remove()`, `dragNonce` and the `{#key}`, the `.sortable-*`
  rules in `app.css` (and its comment naming `.group-members` a SortableJS container), and the
  eslint `svelte/no-dom-manipulating` override — unless another file still needs it, in which case
  that line gets its own disable comment (spine found one).
- Unchanged: the timeline (it follows the data); `settleOnUnmount` in LayerProps (it covers other
  causes too) — its comment loses the `dragNonce` cause.

## Testing

- Unit, first: `applyOrder`; `dropTarget` for top-level reorder, into a group (top, middle, end),
  out of a group (above, below), collapsed group (beside), group above / below blocks and over
  another group's members, no-op → `null`, contiguity of every result; spine's
  `layer-drag-visual` tests.
- Browser, real mouse (`page.mouse`, throwaway script): reorder, into, out of, group move; mid-drag
  ghost, gap, dim, outline; tap, Escape and a refused position change nothing; auto-scroll on a
  long list; panel and timeline order agree; one undo reverts; no page errors. Read the
  screenshots.
- `test:ipad`: a simulated finger drag of a layer row that checks the new order — and break the
  slide or commit on purpose to see it fail.
- Owed on the iPad: a real finger and Pencil drag.

## Docs

CLAUDE.md gotcha #2 marked superseded; CHANGELOG entry; README test count; `../SLOP-LAYER-DRAG.md`
status table and a "what it took" note for slop-paint.
