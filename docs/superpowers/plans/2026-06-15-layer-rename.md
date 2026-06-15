# Layer Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user rename a layer by editing its name inline (pencil → text input) in the LayerList panel.

**Architecture:** A pure `resolveLayerName(current, input)` helper (trim; empty → keep old) holds the only testable logic and lives in `src/anim/document.ts`. A thin, non-undoable `renameLayer(id, input)` store mutation wraps it (direct `layer.name =` + `bump()`, matching the visibility/opacity view-prop pattern — `name` is deliberately excluded from structural undo). `LayerList.svelte` gains a per-row pencil that swaps the name span for an auto-focused input (Enter/blur commit, Esc cancels).

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest (Node environment — no jsdom), `@lucide/svelte` icons.

**Spec:** `docs/superpowers/specs/2026-06-15-layer-rename-design.md`

**Key constraints (verified against the codebase):**
- The Vitest suite runs in **Node**; `jsdom` is not installed. No test may import `appState.svelte.ts` (it touches `window` and constructs `Playback`/`PressureCurve` at module load). Unit tests target only the pure helper in `document.ts` (already test-covered by `document.test.ts`).
- `restoreStructure` (`appState.svelte.ts:115-118`) deliberately keeps `visible/opacity/locked/name` from the live layer, so `name` is **not** part of undo. Do **not** wrap `renameLayer` in `commitStructural`.
- Event-isolation precedent: the opacity slider at `LayerList.svelte:58` calls `e.stopPropagation()` so it doesn't trigger the row's select-layer `onclick`. The pencil and input must do the same.

---

### Task 1: `resolveLayerName` pure helper

**Files:**
- Modify: `src/anim/document.ts` (add the exported helper; place it just after `createReferenceLayer`, near the other layer factories around line 185-193)
- Test: `src/__tests__/document.test.ts` (add a `describe` block)

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/document.test.ts`. First ensure `resolveLayerName` is in the import from `../anim/document` (add it to the existing import list). Then append:

```ts
describe("resolveLayerName", () => {
  it("returns the new name when non-empty", () => {
    expect(resolveLayerName("Old", "Hero")).toBe("Hero");
  });
  it("trims surrounding whitespace", () => {
    expect(resolveLayerName("Old", "  Hero  ")).toBe("Hero");
  });
  it("keeps the current name for empty input", () => {
    expect(resolveLayerName("Old", "")).toBe("Old");
  });
  it("keeps the current name for whitespace-only input", () => {
    expect(resolveLayerName("Old", "   ")).toBe("Old");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/document.test.ts`
Expected: FAIL — `resolveLayerName is not exported` / `is not a function`.

- [ ] **Step 3: Implement the helper**

In `src/anim/document.ts`, add:

```ts
/** The name to apply when renaming to `input`; falls back to `current` for empty/whitespace input. */
export function resolveLayerName(current: string, input: string): string {
  return input.trim() || current;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/document.test.ts`
Expected: PASS (4 new assertions green).

- [ ] **Step 5: Commit**

```bash
git add src/anim/document.ts src/__tests__/document.test.ts
git commit -m "feat: resolveLayerName helper (trim, empty keeps current)"
```

---

### Task 2: `renameLayer` store mutation

**Files:**
- Modify: `src/state/appState.svelte.ts` (add `resolveLayerName` to the import from `../anim/document`; add the `renameLayer` function next to the other layer mutations, e.g. after `duplicateLayer`/`mergeDown` around line 216-247)

No unit test (the store can't be imported under Node — see Key constraints). Verification is the type-check/build in Step 3 plus the manual pass in Task 3.

- [ ] **Step 1: Add the import**

In `src/state/appState.svelte.ts`, find the existing import from `../anim/document` and add `resolveLayerName` to it. For example, if the file imports:

```ts
import { createDrawingLayer } from "../anim/document";
```

change it to include the helper:

```ts
import { createDrawingLayer, resolveLayerName } from "../anim/document";
```

(If `createDrawingLayer` is imported elsewhere or the import list differs, just ensure `resolveLayerName` is imported from `../anim/document` — do not duplicate the import statement.)

- [ ] **Step 2: Add the `renameLayer` function**

In `src/state/appState.svelte.ts`, after the `duplicateLayer` / `mergeDown` block, add:

```ts
/** Rename a layer in place. Not undoable (name is a view-prop, like visible/opacity). */
export function renameLayer(id: number, input: string) {
  const layer = state.project.layers.find((l) => l.id === id);
  if (!layer) return;
  layer.name = resolveLayerName(layer.name, input);
  bump();
}
```

(`state` and `bump` are already module-local in this file — no new import for them.)

- [ ] **Step 3: Type-check + full build, and run tests**

Run: `npm run build`
Expected: GREEN — 0 errors, 0 warnings (svelte-check + tsc + vite).

Run: `npm test`
Expected: all tests pass (count = previous baseline + 4 from Task 1).

- [ ] **Step 4: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat: renameLayer store mutation (non-undoable view-prop)"
```

---

### Task 3: LayerList pencil + inline edit

**Files:**
- Modify: `src/lib/LayerList.svelte` (imports; add component-local edit state + a focus action; replace the name `span` at line 56 with the edit/display conditional)

No automated test (there are no Svelte component tests in this repo; jsdom is unavailable). Verification is the build plus the manual checklist in Step 5.

- [ ] **Step 1: Extend the imports**

In `src/lib/LayerList.svelte`, add `Pencil` to the existing `@lucide/svelte` import, and `renameLayer` to the existing store import. The current lines are:

```ts
  import { Plus, Copy, ArrowDownToLine, Trash2, Eye, EyeOff, GripVertical } from "@lucide/svelte";
  import { state, bump, addLayerToProject, removeLayer, duplicateLayer, mergeDown, reorderLayers } from "../state/appState.svelte";
```

Change them to:

```ts
  import { Plus, Copy, ArrowDownToLine, Trash2, Eye, EyeOff, GripVertical, Pencil } from "@lucide/svelte";
  import { state, bump, addLayerToProject, removeLayer, duplicateLayer, mergeDown, reorderLayers, renameLayer } from "../state/appState.svelte";
```

- [ ] **Step 2: Add edit state + a focus action**

In the `<script>` block of `src/lib/LayerList.svelte` (e.g. just after `let listEl: HTMLDivElement;`), add:

```ts
  let editingId: number | null = $state(null);
  let draft = $state("");

  function startEdit(layer: { id: number; name: string }) {
    draft = layer.name;
    editingId = layer.id;
  }
  function commitEdit(id: number) {
    if (editingId !== id) return; // already cancelled/committed (e.g. Esc then blur)
    renameLayer(id, draft);
    editingId = null;
  }
  // Focus + select the input as soon as it mounts.
  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
```

- [ ] **Step 3: Replace the name span with the edit/display conditional**

In `src/lib/LayerList.svelte`, the current name line (line 56) is:

```svelte
        <span class="flex-1 text-xs truncate">{layer.name}</span>
```

Replace it with:

```svelte
        {#if editingId === layer.id}
          <input class="flex-1 min-w-0 text-xs bg-surface border border-border px-1 text-text"
                 use:focusSelect bind:value={draft}
                 onclick={(e) => e.stopPropagation()}
                 onpointerdown={(e) => e.stopPropagation()}
                 onkeydown={(e) => {
                   if (e.key === "Enter") commitEdit(layer.id);
                   else if (e.key === "Escape") editingId = null;
                 }}
                 onblur={() => commitEdit(layer.id)} />
        {:else}
          <span class="flex-1 text-xs truncate">{layer.name}</span>
          <button class="text-text-muted hover:text-text-secondary" title="Rename layer"
                  onclick={(e) => { e.stopPropagation(); startEdit(layer); }}>
            <Pencil size={13} />
          </button>
        {/if}
```

Notes for the implementer:
- Esc sets `editingId = null`, which unmounts the input and fires `onblur`; `commitEdit` early-returns because `editingId !== id`, so Esc cannot accidentally commit. Enter calls `commitEdit` (which nulls `editingId`), so the subsequent blur is also a no-op.
- `stopPropagation` on the input and pencil prevents the row's `onclick={() => (state.activeLayerId = layer.id)}` from firing during edit (same guard the opacity slider already uses).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: GREEN — 0 errors, 0 warnings.

Run: `npm test`
Expected: all tests pass (unchanged from Task 2 — no new tests here).

- [ ] **Step 5: Manual verification (browser)**

Run: `npm run dev`, open the app, and confirm:
- Clicking the ✎ on a layer row swaps its name for a text input with the text pre-selected.
- Typing a new name and pressing **Enter** commits it; the input reverts to the name span showing the new name.
- Clicking elsewhere (**blur**) also commits.
- Pressing **Esc** discards the edit (name unchanged).
- Entering an empty / spaces-only value and committing keeps the previous name.
- Entering edit mode and committing does **not** change which layer is active/selected.
- Works for both a drawing layer and a reference layer.
- Reload the page (or save/reopen the project) and the renamed name persists.

- [ ] **Step 6: Commit**

```bash
git add src/lib/LayerList.svelte
git commit -m "feat: inline layer rename (pencil + input) in LayerList"
```

---

## Final verification

- [ ] `npm run build` → 0 errors, 0 warnings.
- [ ] `npm test` → all pass (baseline + 4 new).
- [ ] Manual checklist in Task 3 Step 5 all confirmed.

## Self-Review (completed by plan author)

**Spec coverage:**
- Pure `resolveLayerName` helper + tests → Task 1. ✅
- `renameLayer(id, input)` store mutation, non-undoable, uses helper → Task 2. ✅
- Pencil-triggered inline edit in LayerList, Enter/blur commit, Esc cancel, empty keeps old, event isolation, both layer kinds → Task 3. ✅
- Persistence (no migration; `name` already serialized) → no task needed; covered by Task 3 Step 5 manual reload check. ✅
- Decision 2 (not undoable; view-prop pattern) → enforced in Task 2 (no `commitStructural`). ✅

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code. ✅

**Type consistency:** `resolveLayerName(current: string, input: string): string` defined in Task 1 and called identically in Task 2; `renameLayer(id: number, input: string)` defined in Task 2 and called as `renameLayer(layer.id, draft)` / via `commitEdit` in Task 3. `editingId`/`draft`/`startEdit`/`commitEdit`/`focusSelect` all defined in Task 3 Step 2 and used in Step 3. ✅
