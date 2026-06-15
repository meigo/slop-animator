# Manual Animation Length — Design

**Status:** Approved (design phase)
**Date:** 2026-06-15

## Goal

Let the user set the animation's total length (in frames) explicitly, instead of it being purely
derived from the longest drawing layer. Extending holds each layer's last frame through the new
tail; shortening trims trailing cells (with confirmation when that drops keyframes).

## Context

Today `frameCount` is derived: `documentLength(project)` = the longest drawing layer's `cells.length`
(floor 1), recomputed by `refreshLength`. There is no way to set a target length — you only grow the
timeline by adding frames to a layer. A trailing **hold** cell freezes the most recent keyframe
(`resolveKeyframeIndex` scans backward); past a layer's own `cells` end the layer renders blank.

This feature is **independent** of the audio-track and play-range features discussed alongside it —
no shared code. It is the first of those three to be built.

## Scope

In scope:
- A pure `resizeCells(cells, n)` helper and a pure `countKeyframesPastLength(project, n)` helper in
  `src/anim/document.ts`, with unit tests.
- A `setAnimationLength(n)` structural store mutation in `src/state/appState.svelte.ts`.
- A "Length: [N] frames" numeric input in `src/lib/Playbar.svelte`, with the
  drop-keyframes confirmation.

Out of scope (YAGNI):
- "Fit to audio" (the user chose a manual field only; audio is a separate feature).
- Blank-tail extension (the chosen extend behavior is hold-last-frame).
- Per-layer length editing (this sets a single global length).
- Inserting/removing frames in the middle (existing timeline ops already do that).

## Decisions

1. **Extend = hold last frame.** Growing the length pads **every** drawing layer's `cells` with
   `{ kind: "hold" }` up to `n`, so each layer's last keyframe holds through the new frames. This
   normalizes all layers to length `n` (their previously-independent lengths are flattened — an
   accepted consequence of declaring a single global length).
2. **Shorten = trim trailing cells**, with **confirmation only when keyframes are dropped.** Trimming
   that removes no keyframes (only holds/empty tail) applies silently; trimming that would drop one
   or more keyframes prompts first.
3. **Confirmation lives in the UI, not the store.** `setAnimationLength(n)` applies the resize
   unconditionally; the Playbar decides whether to prompt (via `countKeyframesPastLength`) before
   calling it. This keeps the store mutation pure of UI concerns and easy to reason about.
4. **Undoable via the existing structural snapshot.** `setAnimationLength` runs inside
   `commitStructural`, which already snapshots `layers`/`cells`/`frameCount`. No new undo machinery.
5. **Bounds:** `n` is clamped to `[1, 9999]`. Floor 1 matches `documentLength`; 9999 is a sane upper
   guard against fat-finger input (no real project needs more, and it caps the hold-padding loop).

## Behavior

`setAnimationLength(n)`:
- Clamp `n` to `[1, 9999]`.
- If `n === project.frameCount` → no-op (no undo entry).
- Otherwise, for every drawing layer set `layer.cells = resizeCells(layer.cells, n)`:
  - `n > len`: append `(n - len)` `{ kind: "hold" }` cells.
  - `n < len`: slice to the first `n` cells.
- `refreshLength` then sets `frameCount = n` (every layer now has `n` cells, so `documentLength` = `n`).
  `commitStructural` calls `bump()`, which runs `refreshLength` and clamps the playhead into range.

The Playbar's commit handler:
1. Read the typed value; clamp to `[1, 9999]`.
2. If it would shorten and `countKeyframesPastLength(project, n) > 0`, show a confirm dialog
   ("Shorten to `n` frames? This removes `M` keyframe(s)."). If the user cancels, restore the input
   to the current `frameCount` and do nothing.
3. Call `setAnimationLength(n)`.

## Components & data flow

### `src/anim/document.ts` — pure helpers

```ts
/** Resize a cells array to exactly `n`: pad with holds when growing, slice when shrinking. */
export function resizeCells(cells: Cell[], n: number): Cell[] {
  if (n <= cells.length) return cells.slice(0, n);
  const pad: Cell[] = Array.from({ length: n - cells.length }, () => ({ kind: "hold" }));
  return cells.concat(pad);
}

/** Count keyframes that sit at index >= n across all drawing layers (i.e. would be dropped by a
 *  shorten-to-n). */
export function countKeyframesPastLength(project: Project, n: number): number {
  let count = 0;
  for (const layer of project.layers) {
    if (layer.kind !== "draw") continue;
    for (let i = n; i < layer.cells.length; i++) {
      if (layer.cells[i].kind === "key") count++;
    }
  }
  return count;
}
```

`resizeCells` returns a **new** array (the live `layer.cells` is replaced, not mutated in place),
matching the structural-undo requirement that cells be replaced so a stored snapshot can't be
corrupted.

### `src/state/appState.svelte.ts` — `setAnimationLength`

```ts
/** Set the animation's total length to `n` frames (clamped 1..9999). Extends layers by holding the
 *  last frame; shortens by trimming trailing cells. Undoable. */
export function setAnimationLength(n: number) {
  const target = Math.max(1, Math.min(9999, Math.floor(n)));
  if (target === state.project.frameCount) return;
  commitStructural(() => {
    for (const layer of state.project.layers) {
      if (layer.kind === "draw") layer.cells = resizeCells(layer.cells, target);
    }
  });
}
```

(`resizeCells` is imported from `../anim/document`; `state`/`commitStructural` are module-local.)

### `src/lib/Playbar.svelte` — length input

- Add a labelled numeric `<input>` ("Length") near the frame counter / fps presets.
- Its displayed value tracks `state.project.frameCount` (one-way), so undo/redo and other edits keep
  it correct. Use a local handler on `change` (not a two-way `bind:value`, which would fight the
  derived `frameCount`).
- On `change`: parse + clamp; if shorter and `countKeyframesPastLength(...) > 0`, `confirm(...)`
  first; then call `setAnimationLength(n)`; on cancel, reset the field to `frameCount`.

## Persistence & export

No changes. `frameCount` and per-cell `key`/`hold` kinds already serialize
(`src/persist/project-file.ts`); extending just lengthens the saved `cells` arrays with `hold`
entries. Export already iterates `frameCount`. No migration.

## Undo

Covered by `commitStructural` (snapshots `layers`/`cells`/`frameCount`). One undo step reverts a
length change — including a destructive trim (the dropped keyframe canvases live in the before
snapshot and are restored). No separate handling.

## Testing

The Vitest suite runs in **Node** (no jsdom; the store can't be imported). Unit coverage targets the
pure helpers; the store mutation and Playbar UI are build- + manual-verified, matching existing
convention.

**Unit (`resizeCells`, in `document.test.ts`):**
- Grows a short array by appending holds to the exact target length.
- Appended cells are `{ kind: "hold" }`.
- Shrinks a long array by slicing to the target length.
- Returns the same contents when `n` equals the current length.
- Does not mutate the input array (returns a new array).

**Unit (`countKeyframesPastLength`, in `document.test.ts`):**
- Counts keyframes at index `>= n` across multiple drawing layers.
- Returns 0 when all keyframes are within `[0, n)`.
- Ignores reference layers and trailing hold cells.

**Manual (browser):**
- Length field shows the current frame count and updates after timeline edits and undo/redo.
- Increasing it extends the timeline; the last drawing of each layer holds through the new frames.
- Decreasing it past keyframes prompts; confirming trims, cancelling leaves the animation unchanged.
- Decreasing into only-holds/empty tail trims with no prompt.
- Undo restores the previous length and any trimmed keyframes.

## Self-review notes

- One pure module (two helpers) + one store mutation + one input. No new files, no new deps.
- Reuses the structural-undo path rather than inventing length-specific undo.
- The one subtle interaction (confirm-before-destructive-trim) is isolated in the UI, with the count
  computed by a tested pure helper.
