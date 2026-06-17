# Layer Groups (one-level, visual) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-level, collapsible layer groups with a non-destructive per-group visibility toggle, via a flat-array + `groupId` overlay (a group = a contiguous run, auto-dissolving when empty).

**Architecture:** `project.layers` stays flat; each layer gets `groupId: number | null`; `project.groups: LayerGroup[]`. The only render change is one `isLayerVisible` check in `buildFrameDrawList`. LayerList renders contiguous same-group runs under collapsible headers (nested SortableJS for in/out drag); the Timeline hides a collapsed group's rows. Persistence is additive.

**Tech Stack:** TypeScript, Svelte 5, SortableJS, Vitest (Node).

**Spec:** `docs/superpowers/specs/2026-06-17-layer-groups-design.md`

**Branch:** execute on a new branch `layer-groups` (off `main`).

**Key constraints (verified):**
- Compositing's only visibility check is `document.ts:106` `if (!layer.visible) continue;` in `buildFrameDrawList` — the single render touchpoint. **`onion.ts` is intentionally NOT changed** (it ghosts only the active layer's frames and already ignores `layer.visible`, so adding group-visibility there would be inconsistent).
- Adding required `groupId`/`groups` ripples to `Layer`/`Project` literals in `document.test.ts`, `persist.test.ts`, `timeline.test.ts`, `render.test.ts` — fix via tsc.
- A `groupId` matching no live group is treated as **ungrouped** (tolerant) — `groupOf` returns null.
- Group structure is **not** undoable (organizational); the drag reorder reuses the structural snapshot so reorder+membership is one undo step; emptied groups are pruned in that mutation.

---

### Task 1: model + pure helpers + draw-list gate

**Files:**
- Modify: `src/anim/document.ts`
- Test: `src/__tests__/document.test.ts`
- Ripple (tsc-guided): `render.test.ts`, `persist.test.ts`, `timeline.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/document.test.ts`, add `isLayerVisible, groupOf, nonEmptyGroups` to the `../anim/document` import. The existing `dlayer(id, cells, over?)` helper spreads `...over`, so pass `{ groupId }`. Append:

```ts
describe("layer groups", () => {
  const grp = (over = {}) => ({ id: 10, name: "G", collapsed: false, visible: true, ...over });
  it("ungrouped visible layer is visible", () => {
    expect(isLayerVisible(dlayer(1, [makeKey()]), [])).toBe(true);
  });
  it("layer in a visible group is visible", () => {
    expect(isLayerVisible(dlayer(1, [makeKey()], { groupId: 10 }), [grp()])).toBe(true);
  });
  it("layer in a hidden group is not visible", () => {
    expect(isLayerVisible(dlayer(1, [makeKey()], { groupId: 10 }), [grp({ visible: false })])).toBe(false);
  });
  it("a hidden layer is never visible", () => {
    expect(isLayerVisible(dlayer(1, [makeKey()], { visible: false }), [])).toBe(false);
  });
  it("dangling groupId → treated as ungrouped", () => {
    expect(groupOf(dlayer(1, [makeKey()], { groupId: 99 }), [grp()])).toBe(null);
    expect(isLayerVisible(dlayer(1, [makeKey()], { groupId: 99 }), [grp({ visible: false })])).toBe(true);
  });
  it("nonEmptyGroups drops member-less groups", () => {
    expect(nonEmptyGroups([grp({ id: 10 }), grp({ id: 11 })], [dlayer(1, [makeKey()], { groupId: 10 })]).map((g) => g.id))
      .toEqual([10]);
  });
});
```

(Use whatever the file's key-cell factory is named — `makeKey()` per the current file.)

- [ ] **Step 2: Verify FAIL**

Run: `npx vitest run src/__tests__/document.test.ts` → FAIL (helpers not exported; `groupId` not a known field).

- [ ] **Step 3: Implement the model + helpers (`src/anim/document.ts`)**

Add the group interface:
```ts
export interface LayerGroup {
  id: number;
  name: string;
  collapsed: boolean;
  visible: boolean;
}
```
Add `groupId: number | null;` to BOTH `DrawingLayer` and `ReferenceLayer`. Add `groups: LayerGroup[];` to `Project`. In `createDrawingLayer` and `createReferenceLayer` returns, add `groupId: null,`. In `createProject` return, add `groups: [],`.

Add the helpers:
```ts
export function groupOf(layer: Layer, groups: LayerGroup[]): LayerGroup | null {
  if (layer.groupId == null) return null;
  return groups.find((g) => g.id === layer.groupId) ?? null;
}
export function isLayerVisible(layer: Layer, groups: LayerGroup[]): boolean {
  if (!layer.visible) return false;
  const g = groupOf(layer, groups);
  return !g || g.visible;
}
export function nonEmptyGroups(groups: LayerGroup[], layers: Layer[]): LayerGroup[] {
  const used = new Set(layers.map((l) => l.groupId).filter((id): id is number => id != null));
  return groups.filter((g) => used.has(g.id));
}
```

In `buildFrameDrawList`, change `if (!layer.visible) continue;` to:
```ts
    if (!isLayerVisible(layer, project.groups)) continue;
```

- [ ] **Step 4: Add a draw-list visibility test**

Append to `document.test.ts` (adapt to the file's `proj`/project fixture — it must now carry `groups`):
```ts
it("buildFrameDrawList omits layers in a hidden group", () => {
  const p = { groups: [{ id: 10, name: "G", collapsed: false, visible: false }],
    layers: [dlayer(1, [makeKey()], { groupId: 10 }), dlayer(2, [makeKey()])] } as unknown as Project;
  const ops = buildFrameDrawList(p, 0);
  expect(ops.map((o) => o.layerId)).toEqual([2]); // layer 1 hidden via its group
});
```

- [ ] **Step 5: Fix the ripple, verify, build**

Run `npm run build`; tsc flags `Project` literals missing `groups` and `Layer` literals missing `groupId` in the test files (and the `dlayer`/`rlayer` helpers). Add `groups: []` to project literals and `groupId: null` to layer literals/helpers as flagged.
Run: `npx vitest run src/__tests__/document.test.ts` → PASS.
Run: `npm run build` → 0 errors, 0 warnings. Run: `npm test` → all pass.

- [ ] **Step 6: Commit**

```bash
git add src/anim/document.ts src/__tests__/document.test.ts src/__tests__/render.test.ts src/__tests__/persist.test.ts src/__tests__/timeline.test.ts
git commit -m "feat: layer group model + visibility helpers (draw list honors group.visible)"
```

---

### Task 2: persistence

**Files:**
- Modify: `src/persist/project-file.ts`
- Test: `src/__tests__/persist.test.ts`

- [ ] **Step 1: Update tests (TDD)**

In `persist.test.ts`, the `projectToJson` test builds `p` with a drawing layer + reference. Add `groups: []` to `p` (Task 1's ripple already required this) and to the expected output add `groups: []`, plus `groupId: null` to the expected drawing-layer entry and the expected reference entry. (If the input layers have no group, both serialize `groupId: null`.) Run `npx vitest run src/__tests__/persist.test.ts` → FAIL (output lacks `groups`/`groupId`).

- [ ] **Step 2: Implement (`src/persist/project-file.ts`)**

- Add `groups: { id: number; name: string; collapsed: boolean; visible: boolean }[];` to `ProjectJson`.
- Add `groupId: number | null;` to `DrawingLayerJson` and to `ReferenceJson`.
- In `projectToJson`: add `groups: project.groups,` and add `groupId: l.groupId,` to both the drawing-layer map and the reference map.
- In `loadProjectBlob`:
  - drawing-layer rebuild: add `groupId: lj.groupId ?? null,` to the pushed layer.
  - reference rebuild: add `groupId: rj.groupId ?? null,` to the placeholder layer.
  - rebuild groups: `const groups = (json.groups ?? []).map((g) => ({ ...g }));` and include them on the project (`groups`), and fold group ids into `maxId`: `for (const g of groups) maxId = Math.max(maxId, g.id);` before `setMinLayerId`.
  - add `groups` to the constructed `project` literal.

- [ ] **Step 3: Verify + build + suite**

Run: `npx vitest run src/__tests__/persist.test.ts` → PASS. `npm run build` → clean. `npm test` → all pass.

- [ ] **Step 4: Commit**

```bash
git add src/persist/project-file.ts src/__tests__/persist.test.ts
git commit -m "feat: persist layer groups + per-layer groupId"
```

---

### Task 3: store actions

**Files:**
- Modify: `src/state/appState.svelte.ts`

No unit test (store). Verification = build + suite.

- [ ] **Step 1: Imports + group-id helper**

Groups must share the layer id space (Task 2's load folds group ids into `maxId`/`setMinLayerId`, so new groups and layers draw from one counter). `nextLayerId` is module-private in `document.ts`, so expose it: add `export function nextId(): number { return nextLayerId++; }` to `document.ts`. Then in `appState.svelte.ts` add `nextId` (and `type LayerGroup`, `nonEmptyGroups`) to the existing `../anim/document` import.

- [ ] **Step 2: Add the actions**

```ts
/** Create a group from the active layer (a run of one); removes it from any prior group. */
export function groupActiveLayer() {
  const layer = state.project.layers.find((l) => l.id === state.activeLayerId);
  if (!layer) return;
  const g: LayerGroup = { id: nextId(), name: `Group ${state.project.groups.length + 1}`, collapsed: false, visible: true };
  state.project.groups.push(g);
  layer.groupId = g.id;
  state.project.groups = nonEmptyGroups(state.project.groups, state.project.layers); // drop a group the layer just left, if now empty
  bump();
}
/** Ungroup: clear members' groupId, remove the group. */
export function ungroup(groupId: number) {
  for (const l of state.project.layers) if (l.groupId === groupId) l.groupId = null;
  state.project.groups = state.project.groups.filter((g) => g.id !== groupId);
  bump();
}
export function toggleGroupCollapsed(groupId: number) {
  const g = state.project.groups.find((x) => x.id === groupId); if (g) { g.collapsed = !g.collapsed; bump(); }
}
export function toggleGroupVisible(groupId: number) {
  const g = state.project.groups.find((x) => x.id === groupId); if (g) { g.visible = !g.visible; bump(); }
}
export function renameGroup(groupId: number, name: string) {
  const g = state.project.groups.find((x) => x.id === groupId);
  const n = name.trim(); if (g && n) { g.name = n; bump(); }
}
/** Apply a dragged display→data order with per-layer groupId, as one undoable step; prune empty groups. */
export function reorderLayersWithGroups(order: { id: number; groupId: number | null }[]) {
  const before = beginStructuralEdit();
  const byId = new Map(state.project.layers.map((l) => [l.id, l]));
  const next: Layer[] = [];
  for (const e of order) {
    const l = byId.get(e.id);
    if (l) { l.groupId = e.groupId; next.push(l); }
  }
  state.project.layers = next;
  state.project.groups = nonEmptyGroups(state.project.groups, state.project.layers);
  bump();
  commitStructuralEdit(before);
}
```

(`nextId()` (added to `document.ts` in Step 1) gives group ids from the shared layer-id counter, so they never collide with layer ids. `beginStructuralEdit`/`commitStructuralEdit` are already exported in this file.)

- [ ] **Step 3: Build + tests** → `npm run build` clean; `npm test` all pass.

- [ ] **Step 4: Commit**

```bash
git add src/state/appState.svelte.ts src/anim/document.ts
git commit -m "feat: layer group store actions (create/ungroup/collapse/visible/rename/reorder)"
```

---

### Task 4: LayerList — group headers, collapse, visibility, create, nested drag

**Files:**
- Modify: `src/lib/LayerList.svelte`

No automated test. Verification = build + the manual checklist.

This is the largest, riskiest task (nested SortableJS). Read the whole file first.

- [ ] **Step 1: Imports + state**

Add to imports: `groupActiveLayer, ungroup, toggleGroupCollapsed, toggleGroupVisible, renameGroup, reorderLayersWithGroups` from the store; `groupOf` from `../anim/document`; icons `FolderPlus, ChevronDown, ChevronRight, EyeOff?` (reuse existing `Eye/EyeOff`) and a `FolderMinus`/`Ungroup` icon from `@lucide/svelte`. Plain `let` (legacy reactive — this file imports `state`, so NO `$state`): a group-name edit state mirroring `editingId` (e.g. `editingGroupId`/`groupDraft`).

- [ ] **Step 2: "New group" button**

In the panel header (next to Add/Duplicate/Merge/Delete), add a button `title="New group"` calling `groupActiveLayer`, using `FolderPlus`.

- [ ] **Step 3: Render groups as blocks (display order, top-first)**

Replace the flat `{#each [...state.project.layers].reverse() as layer (layer.id)}` with a render that walks the reversed layers and emits, for each **maximal contiguous run of the same non-null groupId**, a group block, and for ungrouped layers a bare row. A clean way in Svelte: precompute display segments in the `<script>`:

```ts
// $: works in legacy mode; recompute when layers/groups change (read state.version too)
$: segments = (() => {
  void state.version;
  const segs: ({ group: LayerGroup; layers: Layer[] } | { layer: Layer })[] = [];
  for (const layer of [...state.project.layers].reverse()) {
    const g = groupOf(layer, state.project.groups);
    const last = segs[segs.length - 1];
    if (g && last && "group" in last && last.group.id === g.id) last.layers.push(layer);
    else if (g) segs.push({ group: g, layers: [layer] });
    else segs.push({ layer });
  }
  return segs;
})();
```

Then render:
- For a `{ layer }` segment → the existing layer row (extract the current row markup into a reusable snippet/block), with `data-layer-id`.
- For a `{ group }` segment → a `<div class="group-block" data-group-id={group.id}>` containing a **group header** (chevron → `toggleGroupCollapsed`; name with inline rename → `renameGroup`; an eye → `toggleGroupVisible`; an ungroup button → `ungroup`) and, when `!group.collapsed`, a `<div class="group-members">` holding the member layer rows (each `data-layer-id`, slightly indented).

(Keep each layer row's existing controls — visibility, opacity, rename, ref badge/relink, video offset — intact inside both contexts.)

- [ ] **Step 4: Nested SortableJS + rebuild**

In `onMount`, create a Sortable on `listEl` with `group: "layers"`, and on every render also ensure each `.group-members` container is a Sortable with the SAME `group: "layers"` (so rows move between root and groups). Because group containers come and go, (re)initialize them after each render — e.g. an action `use:sortableMembers` on each `.group-members` that creates a Sortable on mount and destroys on unmount, all sharing `{ group: "layers", handle: ".layer-drag-handle", animation: 150, onEnd: rebuild }`. The root Sortable also uses `onEnd: rebuild`.

`rebuild()` reads the nested DOM in display (top-first) order and applies it:
```ts
function rebuild() {
  const order: { id: number; groupId: number | null }[] = [];
  for (const child of listEl.children) {
    const el = child as HTMLElement;
    if (el.dataset.groupId != null) {
      const gid = Number(el.dataset.groupId);
      const members = el.querySelector(".group-members");
      if (members) for (const row of members.children) order.push({ id: Number((row as HTMLElement).dataset.layerId), groupId: gid });
    } else if (el.dataset.layerId != null) {
      order.push({ id: Number(el.dataset.layerId), groupId: null });
    }
  }
  reorderLayersWithGroups(order.reverse()); // display→data order; sets order + membership + prunes empties
}
```
Notes: a collapsed group has no `.group-members` in the DOM — its members can't be dragged while collapsed, which is fine (rebuild still emits them only if the container exists; **guard:** when a group is collapsed, do NOT lose its members — only run `rebuild` from containers that exist, and the collapsed group's block has no members container, so its layers wouldn't be enumerated → they'd be dropped from `order`!). **To avoid dropping collapsed-group members, always render the `.group-members` container even when collapsed, but hide it with CSS (`hidden`/`display:none`)** so its rows stay in the DOM for the rebuild. Use `class:hidden={group.collapsed}` on `.group-members`, not `{#if}`.

- [ ] **Step 5: Build**

Run: `npm run build` → 0 errors, 0 warnings (mind the legacy `$:`/`let` style; no `$state`).
Run: `npm test` → all pass.

- [ ] **Step 6: Manual verification (browser)** — see the combined checklist in Final verification.

- [ ] **Step 7: Commit**

```bash
git add src/lib/LayerList.svelte
git commit -m "feat: layer groups in the LayerList (headers, collapse, visibility, create, nested drag)"
```

---

### Task 5: Timeline — hide collapsed groups' rows

**Files:**
- Modify: `src/lib/Timeline.svelte`

- [ ] **Step 1: Import + gate the rows**

Add `groupOf` to a `../anim/document` import. In the layer-rows `{#each [...state.project.layers].reverse() as layer (layer.id)}`, wrap the row body in:
```svelte
      {#if !groupOf(layer, state.project.groups)?.collapsed}
        ... existing row ...
      {/if}
```
(Tolerant: ungrouped → `groupOf` null → `?.collapsed` undefined → shown.) No group header row in the timeline.

- [ ] **Step 2: Build + manual**

Run: `npm run build` → clean. `npm test` → all pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/Timeline.svelte
git commit -m "feat: hide collapsed groups' rows in the timeline"
```

---

## Final verification

- [ ] `npm run build` → 0 errors, 0 warnings.
- [ ] `npm test` → all pass (baseline + Task 1's group tests).
- [ ] **Manual (browser):**
  - "New group" makes a group from the active layer; drag layers into/out of the group's container; group auto-dissolves when emptied.
  - Collapse/expand hides/shows member rows in BOTH LayerList and Timeline; the canvas is unaffected by collapse.
  - The group eye hides all members on the canvas; individual layers' own visibility is preserved when the group is shown again.
  - Rename a group; ungroup flattens it back.
  - Reorder a layer out of a group, then undo → it returns (groupId rides the snapshot).
  - Save + reload: groups, membership, names, collapse + visibility persist; an old save (no groups) loads flat.
  - Collapsed group's members are NOT lost after a drag elsewhere (the hidden members container keeps them in the DOM).

## Self-Review (completed by plan author)

**Spec coverage:** model+helpers+draw-list gate (Task 1) ✅; persistence (Task 2) ✅; store actions incl. structural reorder+prune (Task 3) ✅; LayerList headers/collapse/visibility/create/nested-drag (Task 4) ✅; Timeline collapse-hide (Task 5) ✅. Onion intentionally untouched (documented). Out-of-scope nesting/opacity absent. ✅

**Placeholder scan:** No TBD/TODO; code in every step. The one subtle DOM trap (collapsed members must stay in the DOM via `class:hidden`, not `{#if}`, so the rebuild doesn't drop them) is called out explicitly. ✅

**Type consistency:** `LayerGroup`/`groupId`/`Project.groups` (Task 1) used by persistence (Task 2), store (Task 3), LayerList (Task 4), Timeline (Task 5). `isLayerVisible`/`groupOf`/`nonEmptyGroups` (Task 1) used in draw list (Task 1), store prune (Task 3), and the panels (Tasks 4–5). `reorderLayersWithGroups(order: {id, groupId}[])` defined Task 3, called Task 4's `rebuild`. ✅
