# Timeline Redesign Design

**Status:** Approved (design phase)
**Date:** 2026-06-14

## Goal

Turn the timeline into a traditional frame grid: a numbered frame ruler with a draggable
playhead, per-layer cell strips, a delete-frame tool, current-frame-aware key insertion,
and direct manipulation of keyframes and hold durations by dragging — built on a new
**independent per-layer timeline** model (Flash / ToonSquid style).

## Background — current model (what changes)

Today every drawing layer's `cells` array is exactly `project.frameCount` long; frame
index = the same instant across all layers; `addFrame`/`deleteFrame` act on **all layers
at once**; `resolveKeyframeIndex` **clamps** past a layer's end (so a layer's last drawing
holds forever); `insertKeyframe` writes a key **in place** at the playhead.

```
Cell  = { kind: "key", canvas } | { kind: "hold" }
Layer (draw) = { …, cells: Cell[] }   // length === frameCount today
resolveKeyframeIndex(cells, f): walk back from min(f, len-1) to nearest key (clamps)
```

This redesign relaxes the equal-length invariant and makes timeline operations
per-layer by default.

## Decisions (locked)

1. **Independent per-layer timelines.** Each drawing layer has its own `cells` length.
   Document length = the longest drawing layer. Operations default to the **active
   layer**; explicit "all-layers" variants shift every layer together.
2. **Blank past a layer's end.** A layer contributes nothing on frames beyond its own last
   cell. `resolveKeyframeIndex` returns `null` past the end (instead of clamping).
3. **Phased delivery.** One spec, three implementation plans (model → grid UI → drag).

---

## Data model

### Per-layer lengths + derived document length

- `DrawingLayer.cells` keeps its own length, independent of other layers.
- `project.frameCount` becomes the **document length**, maintained as
  `max(1, ...drawingLayers.map(l => l.cells.length))`. A helper
  `documentLength(project)` computes it; timeline ops call it to refresh
  `project.frameCount` after mutating any layer. Reference layers do not contribute
  (they span the whole document, as today).
- Rationale for keeping `frameCount` as a stored-but-maintained field (vs. computing
  everywhere): minimises churn in consumers that already read `state.project.frameCount`
  (playback bounds, onion clamp, export loop, persistence). They keep working; the ops
  own the invariant.

### `resolveKeyframeIndex` — blank after end

```ts
export function resolveKeyframeIndex(cells: Cell[], frame: number): number | null {
  if (frame < 0 || frame >= cells.length) return null; // past this layer's end → blank
  for (let i = frame; i >= 0; i--) if (cells[i].kind === "key") return i;
  return null; // leading holds before the first key → blank
}
```

This is a behavior change: the existing Plan-1 test asserting "clamps past the end to the
last cell" is updated to assert `null`. `buildFrameDrawList` already skips layers whose
resolve is `null`, so the render path needs no change beyond this function.

### Drawing past a layer's end extends it

`ensureDrawableKeyframe(layer, frame, ops)` must handle `frame >= layer.cells.length`:
pad the layer with `{ kind: "hold" }` cells up to `frame - 1`, then place a fresh
`{ kind: "key", canvas }` at `frame`. If `frame` is within the layer and resolves to a
held span, it still splits/owns a key at `frame` (existing behavior). After extending,
the caller refreshes `project.frameCount`.

### New-layer length

`createDrawingLayer(length, name)` creates a layer of `length` holds (no keys → blank).
Callers (`addLayerToProject` path, `duplicateLayer`) pass the current document length so a
new empty layer spans the existing timeline but shows nothing until drawn on.

---

## Timeline operations (`src/anim/timeline.ts`)

All ops operate on a single `DrawingLayer` unless noted, and refresh `project.frameCount`
via a shared `refreshLength(project)` helper. "Current frame" = `state.playhead`, passed in
by the caller.

| Operation | Behavior |
|---|---|
| **Add frame** `addFrame(layer, after)` | Insert one `{kind:"hold"}` at index `after+1`, shifting later cells right. Extends the current held span by 1. |
| **Insert keyframe** `insertKeyframe(layer, after, ops)` | Insert a **new key at `after+1`** whose canvas is a clone of the drawing currently shown at `after` (the resolved key, or blank if none). Shifts later cells right. This is the "add after current" behavior. |
| **Insert blank keyframe** `insertBlankKeyframe(layer, after, ops)` | Same shift, but the new key's canvas is empty. |
| **Duplicate keyframe** `duplicateKeyframe(layer, frame, ops)` | Alias of insert-keyframe at `frame` (clone of the resolved key). |
| **Set hold** `setHold(layer, frame)` | Turn `cells[frame]` into `{kind:"hold"}` in place (clear keyframe). No shift. |
| **Delete frame** `deleteFrame(layer, frame)` | Remove `cells[frame]`, shifting later cells left. Guarded so a layer never drops below length 1 (a single `{kind:"hold"}` remains; document keeps ≥1 frame). |
| **Move keyframe** `moveKeyframe(layer, from, to)` | Move the key cell from `from` to `to` on the same layer. Source → `{kind:"hold"}`. If `to` currently holds (no key) → place the moved key there. If `to` is itself a key → **swap** the two key cells. `to` may be `== layer.cells.length` (append, extending the layer). |
| **Resize hold** `setHoldSpan(layer, keyFrame, span)` | `keyFrame` must be a key. `span` = number of frames the key occupies before the next key (≥1). Grows by inserting `{kind:"hold"}` cells right after the key (pushing following keyframes on this layer right); shrinks by removing trailing holds of this span (pulling following keys left). Never deletes another key. |
| **All-layers insert** `insertFrameAllLayers(project, at)` | Insert one `{kind:"hold"}` at `at` in **every** drawing layer (global shift). |
| **All-layers delete** `deleteFrameAllLayers(project, at)` | Remove index `at` from every drawing layer that has it (global shift), with the same ≥1 guard. |

Cross-layer sync answer (the user's open question): **resize-hold, move, insert, and
delete default to the active layer only.** Following keyframes *on that same layer* shift;
other layers keep their timing. The all-layers variants exist for deliberate global shifts.

---

## Timeline UI (`src/lib/Timeline.svelte`)

A traditional grid:

```
            1  2  3  4  5  6  7  8  9  10        ← numbered frame ruler
            │        ▼ (draggable playhead)
 Sketch     ◆ —  ◆  —  —  ◆  —  —  ·  ·          ← per-layer cell strip (own length)
 Ink        ◆ —  —  ◆  —  —  —  —  —  —
 [ref]      (reference label, no strip)
```

- **Frame ruler:** a row of numbered columns spanning `1..documentLength`, fixed cell
  width (e.g. 24px). Clicking a ruler column moves the playhead there.
- **Playhead:** a vertical marker over the active column. Phase 2 makes it **draggable**
  (pointer down on the ruler/playhead → drag scrubs `state.playhead`, snapping to columns,
  clamped to `0..documentLength-1`).
- **Cell strips:** one row per layer. Each cell rendered by kind:
  `◆` keyframe, `—` hold (part of a key's span), `·`/empty past the layer's end. The
  active layer's row is highlighted. Clicking a cell moves the playhead and selects.
- **Tool buttons** (existing icon bar) rewired to the new ops, all current-frame-aware:
  Add frame, Insert keyframe (after current), Duplicate, Hold, and a new **Delete frame**
  (Trash2 icon). A modifier or secondary control exposes the all-layers insert/delete.

### Svelte 5 `state` footgun

`Timeline.svelte` imports the binding named `state`, so the `$state` rune misparses there.
The drag interactions use plain pointer handlers writing to the imported `state` proxy
(which is already reactive); any component-local reactive flags use a `writable` store or
rAF-polled getters, consistent with how `Canvas.svelte` and `Toolbar.svelte` already cope.

---

## Drag interactions (Phase 3)

Pointer-based, on top of the Phase-1 ops. All snap to frame columns.

- **Playhead drag** (Phase 2, listed here for completeness): scrub the current frame.
- **Keyframe drag:** pointer-down on a `◆` cell → drag horizontally → on release call
  `moveKeyframe(activeLayer, from, droppedColumn)`. A drag ghost/highlight shows the target
  column. Dropping on another key swaps; dropping past the end extends.
- **Hold-span resize:** pointer-down on the **right edge** of a key's span → drag → call
  `setHoldSpan(activeLayer, keyFrame, newSpan)` live (throttled) so the following keys on
  that layer shift as you drag. Cursor changes to a horizontal resize affordance over the
  edge hotspot.

---

## Consumers to update

- `document.ts`: `resolveKeyframeIndex` (blank-after); add `documentLength()`;
  `createDrawingLayer` fills holds to a given length.
- `timeline.ts`: the operation set above + `refreshLength`; `ensureDrawableKeyframe`
  extends past-end.
- `onion.ts`: still uses `resolveKeyframeIndex` (benefits automatically) and
  `frameCount` for the next-clamp (unchanged — `frameCount` stays maintained).
- `appState.svelte.ts`: `duplicateLayer` (clone respects per-layer length — already maps
  cells 1:1, fine); `mergeDown` loops `0..frameCount` and uses `resolveKeyframeIndex` /
  `ensureDrawableKeyframe` — with blank-after, frames where the upper layer is blank are
  skipped (correct); keep but verify the loop bound uses `documentLength`. `createProject`
  unaffected (single layer at default length).
- `persist/project-file.ts`: already serialises per-layer `cells`; on load, call
  `refreshLength` instead of trusting a single global `frameCount`. Older saved files
  (all-equal lengths) load unchanged.
- `playback.ts` / `Playbar.svelte`: `getFrameCount` keeps returning `frameCount`
  (= documentLength). Unchanged.
- `export/*`: loops `0..frameCount`; unchanged. Layers blank on trailing frames simply
  contribute nothing (matches on-canvas rendering).
- `Timeline.svelte`: full rewrite to the grid (Phases 1–3).

## Testing

Pure-logic ops are unit-tested (Vitest), TDD:

- `resolveKeyframeIndex`: blank past end, blank before first key, resolves held spans.
- `documentLength` / `refreshLength`: max across drawing layers; ignores reference layers; floor of 1.
- `insertKeyframe` after current clones the resolved drawing and shifts; on a blank frame inserts blank.
- `addFrame` extends a held span; `deleteFrame` shifts left and respects the ≥1 guard.
- `moveKeyframe`: move to hold cell, swap with key, append past end (extends length).
- `setHoldSpan`: grow inserts holds and pushes following keys; shrink removes holds and pulls them back; never crosses/deletes the next key; clamps span ≥1.
- `insertFrameAllLayers` / `deleteFrameAllLayers`: every drawing layer shifts; reference layers untouched.
- `ensureDrawableKeyframe`: drawing past a layer's end pads holds + adds a key + grows length.

Drag/UI interactions are verified manually in-browser (pointer-driven; the user tests on
iPad via `npm run dev:lan`), consistent with prior phases.

## Phasing → implementation plans

- **Phase 1 — model + ops + wiring.** Data-model changes, the full operation set with unit
  tests, `ensureDrawableKeyframe` extension, consumer updates, and a minimal
  `Timeline.svelte` update: per-layer strips at their own lengths + rewire the icon buttons
  to the new current-frame-aware ops + the Delete-frame tool. Leaves a working app.
- **Phase 2 — grid UI.** Numbered frame ruler + draggable playhead + polished
  keyframe/hold/blank cell rendering and active-layer highlight.
- **Phase 3 — drag interactions.** Drag keyframes (`moveKeyframe`) and drag hold-span edges
  (`setHoldSpan`), with throttled live updates and drop affordances.

## Out of scope (future)

- Independent **document length** longer than the longest layer (trailing global blank
  frames) — would need a stored project length separate from the derived max.
- Multi-frame range selection / copy-paste across the timeline.
- Per-frame labels, markers, or audio track.
