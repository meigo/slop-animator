# Layer-panel drag without SortableJS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SortableJS in the layer panel with a pointer-event drag drawn over a pure, tested drop rule, so nothing ever moves a DOM node Svelte owns.

**Architecture:** A pure `dropTarget` (`src/anim/layer-drop.ts`) turns the measured rows and the pointer's y into the bottom-first `{ id, groupId }[]` order that the existing store action `reorderLayersWithGroups` already takes, plus where to draw the gap and which group to outline. `LayerList.svelte` only draws that result (ghost, gap, dim, outline) and commits it once on release. Visual helpers are copied from slop-spine.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest (node env, no DOM), Playwright WebKit for browser checks.

**Spec:** `docs/superpowers/specs/2026-10-01-layer-drag-without-sortable-design.md` (and the shared plan `../SLOP-LAYER-DRAG.md`).

## Global Constraints

- `npm run build` = `svelte-check && tsc --noEmit && vite build`: **0 errors, 0 warnings**.
- `npm test` baseline **1580 passing**; it only grows.
- Branch `feat/layer-drag` (exists, spec committed). One commit per task. Commit trailer:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- A collapsed group takes a drop BESIDE it, never inside (user's choice).
- One row drags at a time. A group drags as one block with a ONE-ROW ghost and a ONE-ROW gap.
- Gap and ghost height = the dragged row's measured height (not 32px).
- Locked and hidden groups still take drops. Pressing a grip does not change the selection; a tap
  on a grip behaves as today (the click reaches the row).
- Any draggable surface needs `touch-action: none` (CLAUDE.md gotcha #10).
- Components importing the store use `import { state as appState }` (gotcha #1); LayerList already
  does.
- `test:ipad` and the browser check need local port binding: run them outside the sandbox.

## Review Focus

1. **The list is scrolled when the drag starts** — the drop must land where the gap shows (rows are
   in content coordinates). Pinned in Task 3's browser script ("scrolled list").
2. **The pointer is released outside the list** (over the canvas, past the panel's edge) — the drop
   lands at the clamped first/last position, every layer exactly once, no error. Task 3 ("release
   outside").
3. **Tap vs drag on a grip** — a tap still selects the row (as today); a completed drag does NOT
   change the selection. Task 3 ("tap selects, drag does not").
4. **Dragging a group's only member out empties the group** — the group disappears, and ONE undo
   brings it and the order back. Task 1 (order without the group) and Task 3 ("undo restores an
   emptied group").
5. **An OS-cancelled drag** (`pointercancel` mid-drag, iPad palm rejection) — order unchanged, the
   `<html>` cursor classes and the ghost gone. Task 3 ("pointercancel").

---

### Task 1: Pure drop rule and `applyOrder`

**Files:**
- Create: `src/anim/layer-drop.ts`
- Create: `src/__tests__/layer-drop.test.ts`
- Modify: `src/state/appState.svelte.ts` (`reorderLayersWithGroups`, ≈ line 1773)

**Interfaces:**
- Consumes: `Layer`, `LayerGroup`, `groupOf(layer, groups)` from `src/anim/document.ts`.
- Produces (exact):
  ```ts
  export type RowBox = { kind: "layer" | "group"; id: number; key: string; top: number; bottom: number };
  export type Drag = { kind: "layer"; id: number } | { kind: "group"; id: number };
  export type OrderEntry = { id: number; groupId: number | null };
  export type Drop = { order: OrderEntry[]; line: number; into: number | null };
  export function rowKey(kind: "layer" | "group", id: number): string; // "l12" / "g3"
  export function applyOrder(layers: Layer[], order: readonly OrderEntry[]): Layer[];
  export function dropTarget(layers: Layer[], groups: LayerGroup[], rows: readonly RowBox[], y: number, drag: Drag): Drop | null;
  ```
  `order` is BOTTOM-first (data order). `rows` are visible rows, TOP-first, content coordinates.

- [ ] **Step 1: Write the failing tests** — `src/__tests__/layer-drop.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyOrder, dropTarget, rowKey, type Drop, type RowBox } from "../anim/layer-drop";
import type { Layer, LayerGroup } from "../anim/document";

const layer = (id: number, groupId: number | null = null) =>
  ({ kind: "draw", id, name: `L${id}`, groupId }) as Layer;
const group = (id: number, collapsed = false) =>
  ({ id, name: `G${id}`, collapsed, visible: true }) as LayerGroup;
/** Row `i` of a 28px-row list, top first. */
const R = (kind: "layer" | "group", id: number, i: number): RowBox => ({
  kind,
  id,
  key: rowKey(kind, id),
  top: i * 28,
  bottom: (i + 1) * 28,
});
/** A drop's order in DISPLAY order (top first): "L4 L1 L2@10" = L2 is in group 10. */
const show = (d: Drop | null) =>
  d &&
  [...d.order]
    .reverse()
    .map((e) => (e.groupId == null ? `L${e.id}` : `L${e.id}@${e.groupId}`))
    .join(" ");

// Fixture A, top first: L1, G10 [L2, L3], L4. Data order is bottom-first.
const layersA = () => [layer(4), layer(3, 10), layer(2, 10), layer(1)];
const groupsA = [group(10)];
// L1 0-28, G10 28-56, L2 56-84, L3 84-112, L4 112-140
const rowsA = [R("layer", 1, 0), R("group", 10, 1), R("layer", 2, 2), R("layer", 3, 3), R("layer", 4, 4)];
const dropA = (id: number, y: number, kind: "layer" | "group" = "layer") =>
  dropTarget(layersA(), groupsA, rowsA, y, { kind, id });

describe("rowKey", () => {
  it("keeps layer and group ids apart", () => {
    expect(rowKey("layer", 3)).toBe("l3");
    expect(rowKey("group", 3)).toBe("g3");
  });
});

describe("applyOrder", () => {
  it("returns the layers in the given order with their new groups", () => {
    const ls = layersA();
    const out = applyOrder(ls, [
      { id: 1, groupId: 10 },
      { id: 4, groupId: null },
      { id: 2, groupId: null },
      { id: 3, groupId: 10 },
    ]);
    expect(out.map((l) => l.id)).toEqual([1, 4, 2, 3]);
    expect(out.map((l) => l.groupId)).toEqual([10, null, null, 10]);
    expect(out[0]).toBe(ls[3]); // the same layer objects, not copies
  });
  it("skips ids it does not know", () => {
    const out = applyOrder(layersA(), [{ id: 99, groupId: null }, { id: 1, groupId: null }]);
    expect(out.map((l) => l.id)).toEqual([1]);
  });
});

describe("dropTarget — a layer", () => {
  it("reorders at the top level", () => {
    expect(dropA(4, 5)).toEqual({ order: expect.any(Array), line: 0, into: null });
    expect(show(dropA(4, 5))).toBe("L4 L1 L2@10 L3@10");
    expect(show(dropA(1, 130))).toBe("L2@10 L3@10 L4 L1");
    expect(dropA(1, 130)?.line).toBe(140);
  });
  it("drops into an expanded group at the top, middle and end", () => {
    const top = dropA(4, 50); // lower half of the header
    expect(show(top)).toBe("L1 L4@10 L2@10 L3@10");
    expect(top?.line).toBe(56);
    expect(top?.into).toBe(10);
    const middle = dropA(4, 90); // upper half of L3
    expect(show(middle)).toBe("L1 L2@10 L4@10 L3@10");
    expect(middle?.line).toBe(84);
    expect(middle?.into).toBe(10);
    const end = dropA(1, 105); // lower half of the last member
    expect(show(end)).toBe("L2@10 L3@10 L1@10 L4");
    expect(end?.line).toBe(112);
    expect(end?.into).toBe(10);
  });
  it("drops out of a group above and below it", () => {
    const above = dropA(2, 30); // upper half of the header
    expect(show(above)).toBe("L1 L2 L3@10 L4");
    expect(above?.line).toBe(28);
    expect(above?.into).toBe(null);
    const below = dropA(3, 115); // upper half of L4
    expect(show(below)).toBe("L1 L2@10 L3 L4");
    expect(below?.into).toBe(null);
  });
  it("lands beside a collapsed group, never inside", () => {
    const groups = [group(10, true)];
    const rows = [R("layer", 1, 0), R("group", 10, 1), R("layer", 4, 2)]; // members hidden
    const lower = dropTarget(layersA(), groups, rows, 50, { kind: "layer", id: 1 });
    expect(show(lower)).toBe("L2@10 L3@10 L1 L4");
    expect(lower?.line).toBe(56);
    expect(lower?.into).toBe(null);
    const upper = dropTarget(layersA(), groups, rows, 30, { kind: "layer", id: 4 });
    expect(show(upper)).toBe("L1 L4 L2@10 L3@10");
  });
  it("is null where nothing would change", () => {
    expect(dropA(1, 10)).toBeNull(); // its own row, upper half
    expect(dropA(1, 20)).toBeNull(); // its own row, lower half
    expect(dropA(1, 30)).toBeNull(); // just above the group = where it is
    expect(dropA(2, 60)).toBeNull();
    expect(dropA(2, 50)).toBeNull(); // top of its own group = where it is
  });
  it("clamps a pointer above or below the list to the first or last row", () => {
    expect(show(dropA(4, -20))).toBe("L4 L1 L2@10 L3@10");
    expect(show(dropA(1, 500))).toBe("L2@10 L3@10 L4 L1");
  });
  it("takes the only member out, leaving no layer in the group", () => {
    const layers = [layer(2, 10), layer(1)];
    const rows = [R("layer", 1, 0), R("group", 10, 1), R("layer", 2, 2)];
    const d = dropTarget(layers, [group(10)], rows, 5, { kind: "layer", id: 2 });
    expect(show(d)).toBe("L2 L1");
    expect(d?.order.some((e) => e.groupId === 10)).toBe(false);
  });
  it("is null for an empty list", () => {
    expect(dropTarget(layersA(), groupsA, [], 10, { kind: "layer", id: 1 })).toBeNull();
  });
});

describe("dropTarget — a group", () => {
  it("moves the whole block above or below another block", () => {
    const above = dropA(10, 5, "group");
    expect(show(above)).toBe("L2@10 L3@10 L1 L4");
    expect(above?.line).toBe(0);
    expect(above?.into).toBe(null);
    const below = dropA(10, 130, "group");
    expect(show(below)).toBe("L1 L4 L2@10 L3@10");
    expect(below?.line).toBe(140);
  });
  it("is null over its own block or next to where it is", () => {
    expect(dropA(10, 70, "group")).toBeNull();
    expect(dropA(10, 20, "group")).toBeNull();
    expect(dropA(10, 120, "group")).toBeNull();
  });
  it("snaps to another group's edge instead of entering it", () => {
    // Fixture B, top first: G10 [L2, L3], L1, G20 [L5, L6].
    const layers = [layer(6, 20), layer(5, 20), layer(1), layer(3, 10), layer(2, 10)];
    const groups = [group(10), group(20)];
    const rows = [
      R("group", 10, 0), R("layer", 2, 1), R("layer", 3, 2), R("layer", 1, 3),
      R("group", 20, 4), R("layer", 5, 5), R("layer", 6, 6),
    ];
    // G20's block spans 112-196 (middle 154).
    const upper = dropTarget(layers, groups, rows, 150, { kind: "group", id: 10 });
    expect(show(upper)).toBe("L1 L2@10 L3@10 L5@20 L6@20");
    expect(upper?.line).toBe(112);
    const lower = dropTarget(layers, groups, rows, 190, { kind: "group", id: 10 });
    expect(show(lower)).toBe("L1 L5@20 L6@20 L2@10 L3@10");
    expect(lower?.line).toBe(196);
  });
});

describe("dropTarget — every result", () => {
  /** Each layer once, and each group's members one unbroken run. */
  const valid = (order: { id: number; groupId: number | null }[], ids: number[]) => {
    expect([...order.map((e) => e.id)].sort()).toEqual([...ids].sort());
    const seen = new Set<number>();
    let prev: number | null = null;
    for (const e of order) {
      if (e.groupId != null && e.groupId !== prev) {
        expect(seen.has(e.groupId)).toBe(false);
        seen.add(e.groupId);
      }
      prev = e.groupId;
    }
  };
  it("keeps groups contiguous for any pointer position and any drag", () => {
    const drags = [1, 2, 3, 4].map((id) => ({ kind: "layer" as const, id }));
    for (const drag of [...drags, { kind: "group" as const, id: 10 }])
      for (let y = -10; y <= 160; y += 2) {
        const d = dropTarget(layersA(), groupsA, rowsA, y, drag);
        if (d) valid(d.order, [1, 2, 3, 4]);
      }
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/__tests__/layer-drop.test.ts`
Expected: FAIL, "Failed to resolve import ../anim/layer-drop".

- [ ] **Step 3: Write `src/anim/layer-drop.ts`**

```ts
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

/** One visible row, top first, in the list's content coordinates. `key` keeps a layer and a group
 *  with the same numeric id apart (older saves may have one). */
export type RowBox = { kind: "layer" | "group"; id: number; key: string; top: number; bottom: number };
export type Drag = { kind: "layer"; id: number } | { kind: "group"; id: number };
export type OrderEntry = { id: number; groupId: number | null };
/** `order` is bottom-first, what `reorderLayersWithGroups` takes. `line` is where the gap opens.
 *  `into` is the group to outline — the end of a group and just below it share a line. */
export type Drop = { order: OrderEntry[]; line: number; into: number | null };

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

type Placed = { display: OrderEntry[]; line: number; into: number | null };

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
  return { order: [...placed.display].reverse(), line: placed.line, into: placed.into };
}

/** A layer goes by the row under the pointer: above or below a layer row in that row's group;
 *  above a group header = above the block; below it = into the group's top, or below the block
 *  when the group is collapsed (its members are not rows, and a drop never hides a layer). */
function placeLayer(
  display: OrderEntry[],
  groups: LayerGroup[],
  rows: readonly RowBox[],
  y: number,
  id: number,
): Placed | null {
  const from = display.findIndex((e) => e.id === id);
  if (from < 0) return null;
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
  return { display: next, line: upper ? row.top : row.bottom, into: groupId };
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
  return { display: rest, line: upper ? block.top : block.bottom, into: null };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/__tests__/layer-drop.test.ts`
Expected: PASS (all). If a fixture expectation fails, the expectation was derived by hand in the
spec review — re-derive it from the rules in the spec before touching the code.

- [ ] **Step 5: Make the store action use `applyOrder`** — in `src/state/appState.svelte.ts`,
replace the body of `reorderLayersWithGroups` from `const before = beginStructuralEdit();` to
`state.project.layers = next;` and the SortableJS comment:

```ts
export function reorderLayersWithGroups(order: { id: number; groupId: number | null }[]) {
  // No-op guard: an unchanged order pushes no undo step (the panel's `dropTarget` already returns
  // no drop for one, so this is a backstop).
  const cur = state.project.layers;
  if (
    order.length === cur.length &&
    order.every((e, i) => cur[i].id === e.id && cur[i].groupId === e.groupId)
  )
    return;
  const before = beginStructuralEdit();
  state.project.layers = applyOrder(state.project.layers, order);
  state.project.groups = nonEmptyGroups(state.project.groups, state.project.layers);
  bump();
  commitStructuralEdit(before);
}
```

and add `import { applyOrder } from "../anim/layer-drop";` beside the other `../anim/` imports.

- [ ] **Step 6: Verify and commit**

Run: `npm test` → all pass (1580 + the new ones). `npm run build` → 0 errors, 0 warnings.

```bash
git add src/anim/layer-drop.ts src/__tests__/layer-drop.test.ts src/state/appState.svelte.ts
git commit -m "feat(layers): a pure, tested drop rule for the layer panel drag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Drag visual helpers (copied from slop-spine)

**Files:**
- Create: `src/lib/layer-drag-visual.ts` (from `../slop-spine/src/lib/layer-drag-visual.ts`)
- Create: `src/__tests__/layer-drag-visual.test.ts` (from `../slop-spine/src/lib/__tests__/layer-drag-visual.test.ts`)

**Interfaces:**
- Consumes: `RowBox` from `src/anim/layer-drop.ts` (Task 1) — rows carry `key: string`.
- Produces: `DRAG_THRESHOLD_PX` (3), `ROW_PX` (32), `SCROLL_EDGE_PX`, `SCROLL_MAX_PX`,
  `pastThreshold(dx, dy): boolean`, `shiftedRowIds(rows, line: number | null): Set<string>` (row
  KEYS), `ghostTop(y, grab, contentHeight, rowPx = ROW_PX): number`,
  `autoScrollStep(y, top, bottom): number`.

- [ ] **Step 1: Copy the test and adapt it to keys** — copy spine's test to
`src/__tests__/layer-drag-visual.test.ts`, then change the import paths and the fixture:

```ts
import {
  autoScrollStep,
  DRAG_THRESHOLD_PX,
  ghostTop,
  pastThreshold,
  ROW_PX,
  SCROLL_MAX_PX,
  shiftedRowIds,
} from "../lib/layer-drag-visual";
import type { RowBox } from "../anim/layer-drop";

const rows: RowBox[] = [
  { kind: "layer", id: 4, key: "l4", top: 0, bottom: 32 },
  { kind: "group", id: 3, key: "g3", top: 32, bottom: 64 },
  { kind: "layer", id: 2, key: "l2", top: 64, bottom: 96 },
  { kind: "layer", id: 3, key: "l3", top: 96, bottom: 128 },
];
```

and its slide test to keys (a layer and a group share id 3 here on purpose):

```ts
  it("slides every row at or below the drop line, and none without a drop", () => {
    expect([...shiftedRowIds(rows, 64)]).toEqual(["l2", "l3"]);
    expect([...shiftedRowIds(rows, 0)]).toEqual(["l4", "g3", "l2", "l3"]);
    expect([...shiftedRowIds(rows, 128)]).toEqual([]);
    expect(shiftedRowIds(rows, null).size).toBe(0);
  });
```

The threshold, `ghostTop` and `autoScrollStep` tests stay exactly as in spine.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/__tests__/layer-drag-visual.test.ts`
Expected: FAIL, cannot resolve `../lib/layer-drag-visual`.

- [ ] **Step 3: Copy the module and key it** — copy spine's file to `src/lib/layer-drag-visual.ts`.
Change its import to `import type { RowBox } from "../anim/layer-drop";`, its header's "here ids
are numbers" sentence to "here rows are keyed (`l12` / `g3`: layer and group ids can collide) and
the row height is passed in", and `shiftedRowIds` to:

```ts
export function shiftedRowIds(rows: readonly RowBox[], line: number | null): Set<string> {
  if (line === null) return new Set();
  return new Set(rows.filter((r) => r.top >= line - 0.5).map((r) => r.key));
}
```

Everything else is byte-for-byte spine's.

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run src/__tests__/layer-drag-visual.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/layer-drag-visual.ts src/__tests__/layer-drag-visual.test.ts
git commit -m "feat(layers): drag visual helpers, from slop-spine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The panel drags without SortableJS

**Files:**
- Modify: `src/lib/LayerList.svelte` (imports ≈1-60; `rebuild`/`membersSortable`/`onMount` ≈177-235;
  `layerRow` snippet ≈245-275; `<svelte:window>` ≈404; list ≈509-612)
- Modify: `src/app.css` (≈281 comment; ≈291-298 `.sortable-*`)
- Modify: `src/lib/LayerProps.svelte` (≈238 comment only)
- Modify: `eslint.config.js` (≈42-44), `package.json` / `package-lock.json` (drop `sortablejs`,
  `@types/sortablejs` if present)
- Throwaway (not committed): `tools/.layer-drag-check.mjs`

**Interfaces:**
- Consumes: `dropTarget`, `rowKey`, `Drag`, `Drop`, `RowBox` (Task 1);
  `autoScrollStep`, `ghostTop`, `pastThreshold`, `shiftedRowIds` (Task 2);
  `reorderLayersWithGroups(order)` (store).
- Produces (DOM contract used by Task 4 and the check script): the scroller has
  `data-layer-list`; each layer row's outer div and each group HEADER div carry
  `data-row-kind` (`layer` | `group`), `data-row-id`, `data-row-key`; the grip inside each is
  `.layer-drag-handle`; the ghost is `[data-drag-ghost]`; a dragged row has `.opacity-40`; the
  outlined group block has `.ui-drop-target`; `<html>` gets `layer-dragging` /
  `layer-drop-refused`.

- [ ] **Step 1: Replace the SortableJS script code.** In `LayerList.svelte`: delete
`import Sortable from "sortablejs";`, `dragNonce`, `dropHandled`, the comment + `function rebuild`,
`function membersSortable` and the `onMount(() => { const sortable = … })` block (drop `onMount`
from the svelte import if nothing else uses it). Add the imports:

```ts
  import { dropTarget, rowKey, type Drag, type Drop, type RowBox } from "../anim/layer-drop";
  import { autoScrollStep, ghostTop, pastThreshold, shiftedRowIds } from "./layer-drag-visual";
```

and, where `rebuild` was:

```ts
  // ── Row drag (2026-10-01, replacing SortableJS — `../SLOP-LAYER-DRAG.md`). `dropTarget` alone
  // decides where a drop lands; this only draws its answer and commits it once, on release, so
  // nothing here ever moves a DOM node Svelte owns. ──
  type Dragging = {
    drag: Drag;
    pointerId: number;
    row: HTMLElement;
    label: string;
    count: number;
    startX: number;
    startY: number;
    clientY: number;
    live: boolean;
    boxes: RowBox[];
    grab: number;
    rowPx: number;
    contentHeight: number;
  };
  let dragging: Dragging | null = null;
  let drop = $state<Drop | null>(null);
  let ghost = $state<{ top: number; label: string; count: number; height: number } | null>(null);
  let shifted = $state(new Set<string>());
  let dimmed = $state(new Set<string>());
  let scrollFrame = 0;
  /** A drag just ended on the grip: swallow the click that follows, so a drag never selects. */
  let swallowClick = false;

  /** Every VISIBLE row, top first, in the list's content coordinates (a collapsed group's members
   *  are in the DOM under `hidden`, with an empty rect). */
  function measureRows(): RowBox[] {
    const off = listEl.scrollTop - listEl.getBoundingClientRect().top;
    const out: RowBox[] = [];
    for (const el of listEl.querySelectorAll<HTMLElement>("[data-row-key]")) {
      const r = el.getBoundingClientRect();
      if (r.height === 0) continue;
      out.push({
        kind: el.dataset.rowKind === "group" ? "group" : "layer",
        id: Number(el.dataset.rowId),
        key: el.dataset.rowKey ?? "",
        top: r.top + off,
        bottom: r.bottom + off,
      });
    }
    return out;
  }

  function startDrag(e: PointerEvent, drag: Drag, label: string, count: number) {
    if (e.button !== 0) return;
    const row = (e.currentTarget as Element | null)?.closest<HTMLElement>("[data-row-key]");
    if (!row) return;
    e.preventDefault();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // Capture is a convenience; moves still arrive while the pointer stays on the grip.
    }
    swallowClick = false; // a leftover from a drag whose click landed elsewhere
    dragging = {
      drag,
      pointerId: e.pointerId,
      row,
      label,
      count,
      startX: e.clientX,
      startY: e.clientY,
      clientY: e.clientY,
      live: false,
      boxes: [],
      grab: 0,
      rowPx: 0,
      contentHeight: 0,
    };
    drop = null;
  }

  /** The press became a drag: measure the rows ONCE (sliding rows must not move the targets they
   *  are measured against), dim what moves, lift the copy, start the edge scroll. */
  function lift(d: Dragging) {
    d.live = true;
    d.boxes = measureRows();
    const rect = d.row.getBoundingClientRect();
    d.grab = d.startY - rect.top;
    d.rowPx = rect.height;
    d.contentHeight = listEl.scrollHeight;
    const drag = d.drag;
    dimmed = new Set(
      drag.kind === "layer"
        ? [rowKey("layer", drag.id)]
        : [
            rowKey("group", drag.id),
            ...appState.project.layers
              .filter((l) => l.groupId === drag.id)
              .map((l) => rowKey("layer", l.id)),
          ],
    );
    ghost = { top: 0, label: d.label, count: d.count, height: d.rowPx };
    document.documentElement.classList.add("layer-dragging");
    scrollFrame = requestAnimationFrame(edgeScroll);
  }

  function update(d: Dragging) {
    if (!ghost) return;
    const y = d.clientY - listEl.getBoundingClientRect().top + listEl.scrollTop;
    drop = dropTarget(appState.project.layers, appState.project.groups, d.boxes, y, d.drag);
    shifted = shiftedRowIds(d.boxes, drop?.line ?? null);
    ghost = { ...ghost, top: ghostTop(y, d.grab, d.contentHeight, d.rowPx) };
    document.documentElement.classList.toggle("layer-drop-refused", drop === null);
  }

  /** Near the list's top or bottom edge, scroll it — once a frame while the drag lasts. */
  function edgeScroll() {
    const d = dragging;
    if (!d) return;
    if (!listEl) return finishDrag(); // the panel went away under the drag
    const view = listEl.getBoundingClientRect();
    const step = autoScrollStep(d.clientY, view.top, view.bottom);
    const max = Math.max(d.contentHeight - listEl.clientHeight, 0);
    const next = Math.min(Math.max(listEl.scrollTop + step, 0), max);
    if (next !== listEl.scrollTop) {
      listEl.scrollTop = next;
      update(d);
    }
    scrollFrame = requestAnimationFrame(edgeScroll);
  }

  // The cursor classes sit on <html>, outside this component: never leave them behind.
  $effect(() => () => finishDrag());

  /** Puts everything back as it was before the press. */
  function finishDrag() {
    cancelAnimationFrame(scrollFrame);
    dragging = null;
    drop = null;
    ghost = null;
    shifted = new Set();
    dimmed = new Set();
    document.documentElement.classList.remove("layer-dragging", "layer-drop-refused");
  }

  function moveDrag(e: PointerEvent) {
    const d = dragging;
    if (!d || e.pointerId !== d.pointerId) return;
    d.clientY = e.clientY;
    if (!d.live) {
      if (!pastThreshold(e.clientX - d.startX, e.clientY - d.startY)) return;
      lift(d);
    }
    update(d);
  }

  function endDrag(e: PointerEvent, apply: boolean) {
    const d = dragging;
    if (!d || e.pointerId !== d.pointerId) return;
    d.clientY = e.clientY;
    if (apply && d.live) update(d);
    const target = apply && d.live ? drop : null;
    swallowClick = d.live;
    // Clear the slides AND their transition in the same tick as the commit, or the re-ordered rows
    // animate back from the gap.
    finishDrag();
    if (target) reorderLayersWithGroups(target.order);
  }

  /** A press on a grip that became a drag is not a tap on its row. */
  function gripClick(e: MouseEvent) {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
  }

  const slide = (key: string) => (shifted.has(key) && ghost ? `translateY(${ghost.height}px)` : null);
  const slideTransition = $derived(ghost ? "transform 150ms ease" : null);
```

- [ ] **Step 2: Wire the rows.** In the `layerRow` snippet, on the outer `<div data-layer-id={layer.id} …>`
add:

```svelte
    data-row-kind="layer"
    data-row-id={layer.id}
    data-row-key={rowKey("layer", layer.id)}
    class:opacity-40={dimmed.has(rowKey("layer", layer.id))}
    style:transform={slide(rowKey("layer", layer.id))}
    style:transition={slideTransition}
```

and replace its grip span with:

```svelte
      <span
        class="layer-drag-handle cursor-grab text-text-muted"
        style="touch-action: none"
        title="Drag to reorder"
        role="presentation"
        onpointerdown={(e) => startDrag(e, { kind: "layer", id: layer.id }, layer.name, 1)}
        onpointermove={moveDrag}
        onpointerup={(e) => endDrag(e, true)}
        onpointercancel={(e) => endDrag(e, false)}
        onlostpointercapture={(e) => endDrag(e, false)}
        onclick={gripClick}><GripVertical size={14} /></span
      >
```

On the group HEADER div (`<div class="group-rail flex items-center gap-1 py-1 pr-[6px] pl-2 …">`)
add the same attributes keyed `rowKey("group", seg.group.id)` with `data-row-kind="group"` and
`data-row-id={seg.group.id}`, and replace its grip span (and the comment above it, which describes
the root Sortable) with:

```svelte
              <!-- The block's grip: it drags the header and its members as one (a one-row ghost and
                   gap, the block dimmed in place — SLOP-LAYER-DRAG.md rule 7). -->
              <span
                class="layer-drag-handle cursor-grab text-text-muted"
                style="touch-action: none"
                title="Drag to reorder"
                role="presentation"
                onpointerdown={(e) =>
                  startDrag(
                    e,
                    { kind: "group", id: seg.group.id },
                    seg.group.name,
                    seg.layers.length,
                  )}
                onpointermove={moveDrag}
                onpointerup={(e) => endDrag(e, true)}
                onpointercancel={(e) => endDrag(e, false)}
                onlostpointercapture={(e) => endDrag(e, false)}
                onclick={gripClick}><GripVertical size={14} /></span
              >
```

On the `.group-block` div add `class:ui-drop-target={drop?.into === seg.group.id}`. On the
`.group-members` div remove `use:membersSortable`.

- [ ] **Step 3: The list, the ghost and Escape.** Change the scroller to
`<div bind:this={listEl} data-layer-list class="relative flex-1 overflow-y-auto">`, remove the
`{#key dragNonce}` and its `{/key}` (keep the `{#each}`), and after the `{/each}` add:

```svelte
    {#if ghost}
      <!-- The grabbed row, following the pointer; a group carries its member count. -->
      <div
        data-drag-ghost
        class="pointer-events-none absolute inset-x-0 z-10 flex items-center gap-1 rounded bg-surface pl-2 pr-[6px] text-sm text-text shadow-lg ring-1 ring-accent"
        style="top: {ghost.top}px; height: {ghost.height}px"
      >
        <span class="text-text-muted"><GripVertical size={14} /></span>
        <span class="min-w-0 flex-1 truncate">{ghost.label}</span>
        {#if ghost.count > 1}
          <span class="rounded bg-accent px-1.5 text-[10px] text-accent-text">{ghost.count}</span>
        {/if}
      </div>
    {/if}
```

Change `<svelte:window onresize={onWindowResize} />` to:

```svelte
<svelte:window
  onresize={onWindowResize}
  onkeydowncapture={(e) => {
    // Escape cancels a drag, and only the drag: captured so the app's own Escape doesn't also run.
    if (e.key !== "Escape" || !dragging) return;
    finishDrag();
    e.preventDefault();
    e.stopPropagation();
  }}
/>
```

- [ ] **Step 4: CSS, comments, eslint, dependency.**
In `src/app.css` replace the `.sortable-ghost` / `.sortable-chosen` rules and their comment with:

```css
/* Layer panel drag (2026-10-01): the group a drop lands in, and the cursor for the whole page while
   a row is dragged (classes on <html>, cleared by the panel's finishDrag). */
.ui-drop-target {
  outline: 1px solid var(--color-accent);
  outline-offset: -1px;
}
html.layer-dragging,
html.layer-dragging * {
  cursor: grabbing !important;
}
html.layer-drop-refused,
html.layer-drop-refused * {
  cursor: not-allowed !important;
}
```

and in the `.group-rail` comment change "`.group-members` is a SortableJS container and a stray
child would be treated as a draggable row (gotcha #2)" to "a stray child of `.group-members` would
be measured as a row by the drag (`[data-row-key]` aside, it would still take space)".
In `LayerProps.svelte`'s `settleOnUnmount` comment delete "the list's `{#key dragNonce}` REBUILD
after any SortableJS reorder drop — which leaves `activeRow` untouched, so watching selection could
not see it — and" (keep the rest). Run `npm uninstall sortablejs @types/sortablejs` (ignore "not
installed" for the types). In `eslint.config.js` delete the `"svelte/no-dom-manipulating": "off"`
line and its comment, then run `npx eslint src`; if it reports `svelte/no-dom-manipulating` in
another file, put `// eslint-disable-next-line svelte/no-dom-manipulating -- <why>` on that line
(spine found one in a curve editor) instead of restoring the override.

- [ ] **Step 5: Build and unit tests**

Run: `npm run build` → 0 errors, 0 warnings. `npm test` → all pass. `grep -rn -i sortable src
eslint.config.js package.json` → nothing.

- [ ] **Step 6: Browser check with real mouse drags (throwaway).** Write
`tools/.layer-drag-check.mjs`:

```js
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webkit } from "playwright";
import { createServer } from "vite";

const server = await createServer({ server: { port: 0 }, logLevel: "error" });
await server.listen();
const profile = mkdtempSync(join(tmpdir(), "layer-drag-"));
const ctx = await webkit.launchPersistentContext(profile, { viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const fails = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};
await page.goto(server.resolvedUrls.local[0]);
await page.waitForSelector("[data-layer-list]");
await page.waitForTimeout(500);

const order = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-layer-list] [data-row-key]")]
      .filter((el) => el.getBoundingClientRect().height > 0)
      .map((el) => el.dataset.rowKey),
  );
const timelineOrder = () =>
  page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll(".timeline-grid [data-layer-id]")) {
      const k = "l" + el.dataset.layerId;
      if (!out.includes(k)) out.push(k);
    }
    return out;
  });
const sel = (key) => `[data-layer-list] [data-row-key="${key}"]`;
const htmlClasses = () => page.evaluate(() => document.documentElement.className);
/** Real mouse drag of `from`'s grip to `where` (0..1) down `to`'s row. */
async function drag(from, to, where, { during, escape, cancel } = {}) {
  const g = await page.locator(`${sel(from)} .layer-drag-handle`).first().boundingBox();
  const t = await page.locator(sel(to)).first().boundingBox();
  const x = g.x + g.width / 2;
  await page.mouse.move(x, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, g.y + g.height / 2 + 6, { steps: 2 });
  await page.mouse.move(x, t.y + t.height * where, { steps: 8 });
  await page.waitForTimeout(200);
  if (during) await during();
  if (escape) await page.keyboard.press("Escape");
  if (cancel)
    await page.evaluate(
      (s) =>
        document.querySelector(s).dispatchEvent(
          new PointerEvent("pointercancel", { bubbles: true, pointerId: 1, pointerType: "mouse" }),
        ),
      `${sel(from)} .layer-drag-handle`,
    );
  await page.mouse.up();
  await page.waitForTimeout(300);
}
const add = async (n) => {
  for (let i = 0; i < n; i++) await page.locator('button[title="Add layer"]').click();
  await page.waitForTimeout(200);
};

await add(3);
let o = await order(); // 4 layers, top first
check(o.length === 4 && o.every((k) => k.startsWith("l")), `4 layer rows (${o})`);
const [a, b, c, d] = o;

// Reorder, with the mid-drag state.
let mid = {};
await drag(d, a, 0.2, {
  during: async () => {
    mid = await page.evaluate(() => ({
      ghost: !!document.querySelector("[data-drag-ghost]"),
      slid: [...document.querySelectorAll("[data-layer-list] [data-row-key]")].some((el) =>
        el.style.transform.includes("translateY"),
      ),
      dim: !!document.querySelector("[data-layer-list] [data-row-key].opacity-40"),
      cls: document.documentElement.className,
    }));
    await page.screenshot({ path: "test-results/layer-drag-mid.png" });
  },
});
check(mid.ghost && mid.slid && mid.dim && /layer-dragging/.test(mid.cls), `mid-drag ghost, gap, dim, cursor (${JSON.stringify(mid)})`);
check(JSON.stringify(await order()) === JSON.stringify([d, a, b, c]), "drag the bottom row to the top");
check(!/layer-drag/.test(await htmlClasses()), "cursor classes cleared after a drop");
check((await page.locator("[data-drag-ghost]").count()) === 0, "ghost gone after a drop");
check(JSON.stringify(await timelineOrder()) === JSON.stringify(await order()), "timeline order matches the panel");

// Undo is one step.
await page.keyboard.press("Meta+z");
await page.waitForTimeout(200);
check(JSON.stringify(await order()) === JSON.stringify([a, b, c, d]), "one undo reverts the drag");

// Tap selects, drag does not.
await page.locator(sel(a)).first().click({ position: { x: 150, y: 10 } }); // select a
await page.locator(`${sel(c)} .layer-drag-handle`).first().click(); // tap c's grip
check(await page.locator(sel(c)).first().evaluate((el) => el.classList.contains("ui-selected")), "a tap on a grip selects its row");
await page.locator(sel(a)).first().click({ position: { x: 150, y: 10 } });
await drag(c, a, 0.2);
check(await page.locator(sel(a)).first().evaluate((el) => el.classList.contains("ui-selected")), "a drag does not change the selection");
await page.keyboard.press("Meta+z");

// Escape and pointercancel put everything back.
await drag(d, a, 0.2, { escape: true });
check(JSON.stringify(await order()) === JSON.stringify([a, b, c, d]) && !/layer-drag/.test(await htmlClasses()), "Escape cancels a drag");
await drag(d, a, 0.2, { cancel: true });
check(JSON.stringify(await order()) === JSON.stringify([a, b, c, d]) && !/layer-drag/.test(await htmlClasses()), "pointercancel cancels a drag");

// A refused position: over the row itself.
let refused = "";
await drag(b, b, 0.5, { during: async () => (refused = await htmlClasses()) });
check(/layer-drop-refused/.test(refused) && JSON.stringify(await order()) === JSON.stringify([a, b, c, d]), "dropping on itself is refused and changes nothing");

// Groups: put b in a new group, drag c into it, then out, then move the group.
await page.locator(sel(b)).first().click({ position: { x: 150, y: 10 } });
await page.locator('button[title^="New group"]').click();
await page.waitForTimeout(200);
o = await order();
const g = o.find((k) => k.startsWith("g"));
check(JSON.stringify(o) === JSON.stringify([a, g, b, c, d]), `New group wraps b (${o})`);
let into = "";
// Lower half of the header: into the group's top, with the group outlined mid-drag.
await drag(d, g, 0.8, {
  during: async () => (into = String(await page.locator(".group-block.ui-drop-target").count())),
});
o = await order();
check(JSON.stringify(o) === JSON.stringify([a, g, d, b, c]) && into === "1", `drag into a group, outlined (${o}; outlined ${into})`);
await drag(d, g, 0.2);
check(JSON.stringify(await order()) === JSON.stringify([a, d, g, b, c]), "drag out of a group, above it");
await drag(g, c, 0.9, {
  during: async () => (into = String(await page.locator("[data-row-key].opacity-40").count())),
});
check(JSON.stringify(await order()) === JSON.stringify([a, d, c, g, b]) && into === "2", `move a group below a layer (dimmed rows: ${into})`);
check(JSON.stringify(await timelineOrder()) === JSON.stringify((await order()).filter((k) => k.startsWith("l"))), "timeline order matches after group moves");

// Emptying a group by dragging its only member out removes it; one undo restores both.
await drag(b, a, 0.2);
check(!(await order()).includes(g), "dragging the only member out removes the group");
await page.keyboard.press("Meta+z");
await page.waitForTimeout(200);
check(JSON.stringify(await order()) === JSON.stringify([a, d, c, g, b]), "one undo restores the emptied group");

// Release outside the list: lands at a clamped position, every layer once.
{
  const h = await page.locator(`${sel(a)} .layer-drag-handle`).first().boundingBox();
  await page.mouse.move(h.x + 4, h.y + 4);
  await page.mouse.down();
  await page.mouse.move(h.x + 4, h.y + 20, { steps: 2 });
  await page.mouse.move(200, 880, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  o = await order();
  check(o.length === 5 && new Set(o).size === 5 && !/layer-drag/.test(await htmlClasses()), `release outside the list (${o})`);
}

// Long, scrolled list: auto-scroll, and a drop where the gap shows.
await add(30);
const list = page.locator("[data-layer-list]");
await list.evaluate((el) => (el.scrollTop = el.scrollHeight / 2));
await page.waitForTimeout(100);
o = await order();
const vis = await page.evaluate(() => {
  const l = document.querySelector("[data-layer-list]").getBoundingClientRect();
  return [...document.querySelectorAll("[data-layer-list] [data-row-key]")]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      // Top-level layers only: a group member or header follows other rules.
      return (
        r.height > 0 && r.top >= l.top + 40 && r.bottom <= l.bottom - 40 &&
        el.dataset.rowKind === "layer" && !el.classList.contains("group-rail")
      );
    })
    .map((el) => el.dataset.rowKey);
});
// Three top-level layers in a row, so "two rows up" means the same thing in the model.
const i3 = vis.findIndex((k, i) => i + 2 < vis.length && o.indexOf(vis[i + 2]) === o.indexOf(k) + 2);
check(i3 >= 0, "found three consecutive top-level rows in view");
const [v0, , v2] = vis.slice(i3);
await drag(v2, v0, 0.2);
const after = await order();
check(after.indexOf(v2) === o.indexOf(v0) && after.indexOf(v0) === o.indexOf(v0) + 1, "drop in a scrolled list lands where the gap showed");
{
  await list.evaluate((el) => (el.scrollTop = 0));
  const top = (await order())[0];
  const h = await page.locator(`${sel(top)} .layer-drag-handle`).first().boundingBox();
  const lb = await list.boundingBox();
  await page.mouse.move(h.x + 4, h.y + 4);
  await page.mouse.down();
  await page.mouse.move(h.x + 4, h.y + 20, { steps: 2 });
  await page.mouse.move(h.x + 4, lb.y + lb.height - 4, { steps: 10 });
  await page.waitForTimeout(1000);
  const scrolled = await list.evaluate((el) => el.scrollTop);
  await page.mouse.up();
  await page.waitForTimeout(300);
  check(scrolled > 0 && (await order()).indexOf(top) > 5, `auto-scroll near the bottom edge (scrollTop ${scrolled})`);
}

check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await ctx.close();
rmSync(profile, { recursive: true, force: true });
await server.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
```

Run (outside the sandbox): `node tools/.layer-drag-check.mjs`
Expected: every line `ok`, "all passed". Open `test-results/layer-drag-mid.png` and confirm the
ghost, the gap and the dimmed row are visible. If a check fails, fix the panel (or, if the check's
expectation is wrong, say why in the report) — do not weaken a check to pass.

Then break the slide on purpose (`slide` returns `null` always), re-run: the mid-drag check must
FAIL. Restore it, re-run: all pass. Delete `tools/.layer-drag-check.mjs` (keep a copy in the
scratchpad for Task 4's reviewer if useful).

- [ ] **Step 7: Commit**

```bash
git add -A src eslint.config.js package.json package-lock.json
git status --short   # no tools/.layer-drag-check.mjs
git commit -m "feat(layers): the layer panel drags without SortableJS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: A finger drag in the iPad smoke check

**Files:**
- Modify: `tools/ipad-smoke.mjs` (a new block just before `// A real finger tap on a toolbar menu.`;
  the header comment's list)

**Interfaces:**
- Consumes: the DOM contract from Task 3 (`[data-layer-list]`, `[data-row-key]`,
  `.layer-drag-handle`), the script's `check`, `page`, `OUT`.

- [ ] **Step 1: Add the check** — before `// A real finger tap on a toolbar menu.`:

```js
  // A finger drag of a layer row (2026-10-01, the drag that replaced SortableJS): the bottom row
  // to the top, and the gap open mid-drag. Simulated pointers are not live, so capture fails (the
  // init script lets it fail quietly) and every event goes to the grip, as a captured stream would.
  await page.locator('button[title="Add layer"]').click();
  await page.waitForTimeout(200);
  const rowOrder = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-layer-list] [data-row-key]")]
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => el.dataset.rowKey),
    );
  const rowsBefore = await rowOrder();
  const fingerDrag = await page.evaluate(async (keys) => {
    const from = keys[keys.length - 1];
    const grip = document.querySelector(
      `[data-layer-list] [data-row-key="${from}"] .layer-drag-handle`,
    );
    const to = document
      .querySelector(`[data-layer-list] [data-row-key="${keys[0]}"]`)
      .getBoundingClientRect();
    const g = grip.getBoundingClientRect();
    const x = g.left + g.width / 2;
    const fire = (type, y) =>
      grip.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 31,
          pointerType: "touch",
          isPrimary: true,
          button: 0,
          buttons: type === "pointerup" || type === "pointerout" || type === "pointerleave" ? 0 : 1,
          clientX: x,
          clientY: y,
        }),
      );
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    let y = g.top + g.height / 2;
    for (const t of ["pointerover", "pointerenter", "pointerdown"]) fire(t, y);
    const target = to.top + to.height * 0.2;
    for (let i = 1; i <= 8; i++) {
      fire("pointermove", y + ((target - y) * i) / 8);
      await frame();
    }
    const slid = [...document.querySelectorAll("[data-layer-list] [data-row-key]")].some((el) =>
      el.style.transform.includes("translateY"),
    );
    for (const t of ["pointerup", "pointerout", "pointerleave"]) fire(t, target);
    await frame();
    return { slid };
  }, rowsBefore);
  await page.waitForTimeout(300);
  const rowsAfter = await rowOrder();
  check(
    fingerDrag.slid &&
      rowsAfter[0] === rowsBefore[rowsBefore.length - 1] &&
      rowsAfter.length === rowsBefore.length,
    `a finger drag moves a layer row, with the gap open mid-drag (${rowsBefore} → ${rowsAfter})`,
  );
```

and add "a finger drag of a layer row" to the header comment's review-fix list.

- [ ] **Step 2: Run** (outside the sandbox): `npm run test:ipad` → all pass.

- [ ] **Step 3: Break it on purpose** — make `endDrag` skip the commit (`if (target && false)`),
run: this check FAILS. Restore, then make `slide` return `null`, run: it FAILS. Restore, run: all
pass.

- [ ] **Step 4: Commit**

```bash
git add tools/ipad-smoke.mjs
git commit -m "test(ipad): a finger drag of a layer row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Docs

**Files:**
- Modify: `CLAUDE.md` (gotcha #2; the `test:ipad` checks list; Architecture map's `LayerList` line)
- Modify: `docs/superpowers/CHANGELOG.md` (append)
- Modify: `README.md` (test count in the scripts block)
- Modify (outside the repo, no commit — `../` is not a git repo): `../SLOP-LAYER-DRAG.md`

- [ ] **Step 1: CLAUDE.md.** Above gotcha #2 add
`> **SUPERSEDED 2026-10-01** — SortableJS is gone: the layer panel drags with pointer events over the pure \`dropTarget\` (\`src/anim/layer-drop.ts\`); see the CHANGELOG entry "Layer drag without SortableJS". Nothing moves a DOM node, so none of the below applies.`
In the `test:ipad` paragraph add "a finger drag of a layer row" to the checks. In the Architecture
map's `src/lib/*.svelte` line, after `LayerList` (one-line rows), add "dragged by
`anim/layer-drop.ts` + `lib/layer-drag-visual.ts`".

- [ ] **Step 2: CHANGELOG.** Append an entry headed
`**Layer drag without SortableJS (2026-10-01, branch \`feat/layer-drag\`, ../SLOP-LAYER-DRAG.md).**`
with: why (the costs listed in the spec's Problem); the rule (layer by the row under the pointer,
group by the top-level block, collapsed group beside, `null` = no change, `into` outline, one-row
ghost/gap at the measured height); what was removed (Sortable, latch, `evt.item.remove()`,
`{#key dragNonce}`, `.sortable-*`, the eslint override — and any line that got its own disable
comment); the tests (counts) and the browser/iPad checks with what failed when broken on purpose;
**Owed on the iPad:** a real finger and Pencil drag, into and out of a group.

- [ ] **Step 3: README.** Run `npm test`, put the new count in the scripts block.

- [ ] **Step 4: `../SLOP-LAYER-DRAG.md`.** Status row for slop-animator:
`Done 2026-10-01 (<merge sha once merged; the branch tip until then>); iPad finger drag owed`.
Under `### slop-animator`, a "Done 2026-10-01. What it took, for slop-paint:" list: rows keyed
`l<id>`/`g<id>` (layer and group ids can collide) and `shiftedRowIds` returns keys; the drop rule
returns the store's whole order rather than an index; a group drag targets top-level BLOCKS so it
never needs refusing; a collapsed group takes no drop (beside it); the tap-vs-drag click swallow
(`gripClick`); what the eslint override was covering here; the `test:ipad` finger-drag check.

- [ ] **Step 5: Verify and commit**

Run: `npm run build` (0/0), `npm test` (count matches README), `npx prettier --check CLAUDE.md
README.md docs/superpowers/CHANGELOG.md`.

```bash
git add CLAUDE.md README.md docs/superpowers/CHANGELOG.md
git commit -m "docs: layer drag without SortableJS — changelog, gotcha #2 superseded, test count

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
