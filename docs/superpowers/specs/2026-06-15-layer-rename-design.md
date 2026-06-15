# Layer Rename — Design

**Status:** Approved (design phase)
**Date:** 2026-06-15

## Goal

Let the user rename a layer by editing its name inline in the **LayerList panel**. The data model
already has `Layer.name` (drawing and reference layers both), defaulted to `Layer <id>` /
`Reference <id>` and persisted — only an edit affordance is missing.

## Scope

In scope:
- An inline-edit affordance in `src/lib/LayerList.svelte` rows (pencil icon → text input).
- A `renameLayer(id, name)` store mutation in `src/state/appState.svelte.ts`.
- A unit test for `renameLayer`.

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

### `src/state/appState.svelte.ts` — `renameLayer`

```ts
/** Rename a layer in place. Not undoable (name is a view-prop, like visible/opacity). */
export function renameLayer(id: number, name: string) {
  const layer = state.project.layers.find((l) => l.id === id);
  if (!layer) return;
  const trimmed = name.trim();
  if (!trimmed) return; // ignore empty / whitespace-only — keep the old name
  layer.name = trimmed;
  bump();
}
```

- Finds the layer by id; no-op on unknown id.
- Trims surrounding whitespace; ignores empty.
- Mutates `layer.name` directly and calls `bump()` to refresh the view (same as visibility/opacity).
- Sets the trimmed name even when it equals the current name (a harmless no-op write); the
  empty-string guard is the only early return besides the id miss.

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

**Unit (`renameLayer`):**
- Renames the matching layer to the given (trimmed) value.
- Trims surrounding whitespace.
- Ignores an empty / whitespace-only value (layer keeps its old name).
- No-op on an unknown id (no throw, no change).

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
