# Layer Rename — Design

**Status:** Approved (design phase)
**Date:** 2026-06-15

## Goal

Let the user rename a layer by editing its name inline in the **LayerList panel**. The data model
already has `Layer.name` (drawing and reference layers both), defaulted to `Layer <id>` /
`Reference <id>` and persisted — only an edit affordance is missing.

## Scope

In scope:
- A pure `resolveLayerName(current, input)` helper in `src/anim/document.ts`, with unit tests.
- A `renameLayer(id, input)` store mutation in `src/state/appState.svelte.ts` (uses the helper).
- An inline-edit affordance in `src/lib/LayerList.svelte` rows (pencil icon → text input).

Out of scope (YAGNI):
- Renaming from the timeline rows (`Timeline.svelte`) — names there stay read-only.
- Making rename undoable (see Decision 2).
- Uniqueness/validation of names beyond trimming (duplicate names are allowed).
- Persistence migration (names are already serialized).

## Decisions

1. **Edit location: LayerList panel only.** The name lives at `LayerList.svelte:56`
   (`<span class="flex-1 text-xs truncate">{layer.name}</span>`) alongside the drag handle,
   visibility toggle, and opacity slider. The timeline's name button stays select-only.

2. **Rename is NOT undoable.** `restoreStructure` (`appState.svelte.ts:116-118`) deliberately keeps
   `visible/opacity/locked/name` from the live layer — these view-props are intentionally excluded
   from structural undo. So rename follows the existing view-prop pattern (direct mutation + `bump()`),
   exactly like the visibility toggle (`LayerList.svelte:50`) and opacity slider (`:57`). Wrapping it
   in `commitStructural` would be incorrect: undo would not restore the old name and would push a
   confusing no-op entry onto the history stack.

3. **Trigger: a pencil (✎) icon per row.** Click/tap the pencil to enter edit mode. Chosen over
   double-click because the app is used on iPad (touch), where `dblclick`/double-tap is unreliable.
   An explicit icon is discoverable and works identically across mouse and touch.

4. **Both layer kinds renameable.** Drawing and reference layers both have `name`; both get the pencil.

## Behavior

**Entering edit mode:**
- Click the pencil → the name `span` is replaced by an `<input type="text">` prefilled with the
  current `layer.name`, auto-focused with its text selected.
- Only one row edits at a time. A component-local `editingId: number | null` tracks which layer (if
  any) is in edit mode; the pencil sets it, commit/cancel clears it.

**Committing:**
- **Enter** key or **blur** (focus leaves the input) commits the input's current value via
  `renameLayer(layer.id, value)`, then clears `editingId`.
- An empty or whitespace-only value is treated as "no change" — `renameLayer` ignores it, so the
  layer keeps its previous name.

**Cancelling:**
- **Esc** key clears `editingId` without calling `renameLayer` — the name is unchanged.
- Esc must not also fire the blur-commit; the handler clears `editingId` first so the subsequent
  blur sees no active edit (guard: blur only commits when `editingId` still equals this layer).

**Event isolation:**
- The pencil button and the `<input>` call `e.stopPropagation()` on their click/pointer events so
  they don't trigger the row's `onclick={() => (state.activeLayerId = layer.id)}` (the same guard the
  opacity slider already uses at `LayerList.svelte:58`).

## Components & data flow

### `src/anim/document.ts` — `resolveLayerName` (pure)

The rename rule (trim; empty/whitespace → keep the old name) is the one piece of real logic worth
pinning, and the test suite runs in **Node** (no `jsdom` — see Testing), so it lives as a pure helper
in `document.ts` next to the layer factories where it is unit-testable without the store or a DOM:

```ts
/** The name to apply when renaming to `input`; falls back to `current` for empty/whitespace input. */
export function resolveLayerName(current: string, input: string): string {
  return input.trim() || current;
}
```

### `src/state/appState.svelte.ts` — `renameLayer`

```ts
/** Rename a layer in place. Not undoable (name is a view-prop, like visible/opacity). */
export function renameLayer(id: number, input: string) {
  const layer = state.project.layers.find((l) => l.id === id);
  if (!layer) return;
  layer.name = resolveLayerName(layer.name, input);
  bump();
}
```

- Finds the layer by id; no-op on unknown id.
- Delegates the trim/empty rule to `resolveLayerName`; mutates `layer.name` directly and calls
  `bump()` to refresh the view (same pattern as the visibility toggle and opacity slider).
- Not undoable, by design (Decision 2). This thin store wrapper is not unit-tested (the store can't
  be imported under Node — Testing); it is manual/integration-verified like its siblings
  `removeLayer`/`duplicateLayer`/`reorderLayers`.

### `src/lib/LayerList.svelte` — inline edit row

- Import `renameLayer` from the store and a `Pencil` icon from `@lucide/svelte`.
- Add component-local `let editingId: number | null = $state(null);` and a binding for the input
  value, plus an action/`bind:this` to focus + select the input when it mounts.
- Replace the name `span` with: when `editingId === layer.id`, render the `<input>`; otherwise render
  the existing name `span` followed by the pencil button.
- Pencil `onclick`: `e.stopPropagation(); editingId = layer.id;` (prefill the edit value with
  `layer.name`).
- Input handlers: `onkeydown` (Enter → commit; Esc → cancel), `onblur` (commit if still editing),
  `onclick`/`onpointerdown` → `stopPropagation`.

## Persistence

No change. `name` is already part of the serialized `Layer` shape (`src/persist/project-file.ts`),
and existing saves already contain names. No migration needed.

## Testing

The Vitest suite runs in the **Node** environment (`jsdom` is not a dependency), so no test imports
the store (`appState.svelte.ts` touches `window` and constructs `Playback`/`PressureCurve` at module
load). Unit coverage therefore targets the pure helper; the store wrapper and UI are manual-verified,
matching the existing convention (`removeLayer`/`duplicateLayer`/`reorderLayers` have no unit tests).

**Unit (`resolveLayerName`, in `document.test.ts`):**
- Returns the new name when non-empty.
- Trims surrounding whitespace.
- Returns the current name for empty input.
- Returns the current name for whitespace-only input.

**Manual (browser):**
- Pencil on a layer row enters edit mode with text selected; Enter commits; blur commits; Esc
  cancels; empty input keeps the old name.
- Editing does not change the active layer selection (event isolation works).
- Works for both a drawing layer and a reference layer.
- Renamed name survives save/reload (persistence).

## Self-review notes

- Single responsibility: one store mutation + one component's row markup. No new files.
- Follows existing view-prop pattern (visible/opacity) rather than inventing an undo path that the
  snapshot layer deliberately doesn't support.
- The Esc-vs-blur ordering is the one subtle interaction; the `editingId` guard on blur makes it
  deterministic.
