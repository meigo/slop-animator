# Timeline block copy/paste — design

**Date:** 2026-07-09
**Status:** Design (approved for planning)
**Feature:** Select a rectangular block of cells in the timeline (frames × layers), then
copy / cut / paste / delete it. Generalizes the existing adjacent-only "duplicate keyframe".

## Motivation

Today the timeline can only **duplicate a keyframe** — clone the resolved key's bitmap and splice a
new key *immediately after* the current frame on the *active* layer (`duplicateKeyframe` →
`insertKeyframe` in `src/anim/timeline.ts`). There is no way to:

- copy a drawing to a **non-adjacent** frame,
- copy a drawing to a **different layer**,
- move/copy a **run of frames** or a **2D block** across frames and layers at once.

Mature frame-by-frame tools (Adobe Animate, OpenToonz, Toon Boom Harmony, Krita, Blender GP) all
treat this as table-stakes: rectangular block selection in the dope-sheet/xsheet plus overwrite and
insert paste. On iPad, Callipeg is the closest reference (long-press → drag block selection → an
action panel with copy/paste). This feature brings that capability to slop-animator, fitted to its
`Cell[]` (KEY/HOLD) model.

Prior-art research summary lives in the conversation that produced this spec; the mechanics it
established are folded into the decisions below.

## Data-model fit and the two tensions it creates

slop-animator's cell model is already the Flash "frames/keyframes" + Toonz "exposure" model:

- A drawing layer is `cells: Cell[]` indexed by frame.
- `Cell` = `{ kind: "key", canvas, transform?, transformBox? }` | `{ kind: "hold" }`.
- A HOLD **repeats the previous KEY by position** (`resolveKeyframeIndex` walks left to the nearest
  key). Holds are **positional/implicit**, not numbered like Toonz drawing IDs.

Two consequences drive the design:

1. **A copied block is not self-contained if its top row is a HOLD.** The key a leading hold depends
   on may sit *above* the selection. **Fix (materialize-leading-key):** on copy, resolve each
   column's leading hold(s) to the key they depend on and clone that bitmap into a real KEY at the
   top of the column. Holds *interior* to the block that resolve to a key *inside* the block stay
   holds. This is the same resolve-and-clone `duplicateKeyframe`/`insertKeyframe` already perform.

2. **Overwrite-paste can retroactively change a *following* hold's picture.** Because a hold resolves
   to whatever key now precedes it, overwriting a key that a downstream HOLD depended on changes what
   that hold shows. This is usually the intended result ("I replaced the drawing; the hold follows"),
   so overwrite is the default (see Decisions), but the spec documents it as the sharpest edge and
   insert-paste is offered as the hold-safe alternative.

Per-cell `transform`/`transformBox` are plain data on the KEY; `transformBox` is frozen in
logical/doc space, so it stays valid when pasted to another frame/layer with **no coordinate
remapping** — copy just deep-clones it alongside the canvas.

## Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Scope / ambition | Full rectangular block (frames × layers), built up the phase ladder below. |
| D2 | Selection gesture | Non-modal: **long-press → drag** on touch/Pencil; **Shift-click** range on desktop. |
| D3 | Paste default | **Overwrite** (stamp in place). Both overwrite and insert always exist. |
| D4 | Cut / Delete | **Included.** Cut = Copy + Delete; Delete = replace selected cells with holds. |
| D5 | Insert-paste ripple | Ripples the **pasted layers only** (Flash "Paste and Insert Frames" convention). |
| D6 | Clipboard | **Internal app clipboard** (appState field). Cross-document deferred to Phase 4. |
| D7 | Copy of a HOLD cell | Copies its **resolved key** (never an empty hold), per D-materialize-leading-key. |
| D8 | Paste overflow | Overflow past the bottom layer is **ignored** — no auto-creating layers. |
| D9 | Layer kinds | **Drawing layers only** — reference layers are excluded from selection/copy/paste. |

## Architecture

Keep the split the timeline already uses: **pure, DOM-free block logic in `src/anim/timeline.ts`**
(unit-testable, injected `CanvasOps`), **state in `appState.svelte.ts`**, **interaction in
`Timeline.svelte`**.

### Clipboard shape

A block is a 2D array, columns = layers (top selected layer first), rows = frames (earliest first):

```ts
/** A rectangular block of cells copied from the timeline. cols = layers (top-first),
 *  rows = frames (earliest-first). Every KEY canvas/transform is deep-cloned and self-contained:
 *  each column starts with a KEY (leading holds are materialized on copy). */
export interface CellBlock {
  cols: number;          // layer count
  rows: number;          // frame count
  columns: Cell[][];     // columns[c][r]; length cols, each length rows
}
```

Stored in `appState` as `cellClipboard: CellBlock | null` (module-level `$state`, mirrors how other
transient app state is held). Not persisted to autosave (transient, like an OS clipboard).

### Selection state

```ts
// in appState
timelineSelection: {
  anchor: { layerId: number; frame: number };
  focus:  { layerId: number; frame: number };
} | null
```

The rectangle is **derived**, not stored: frame extent = `[min,max]` of the two frames; layer extent
= the contiguous run of **drawing** layers between anchor and focus in **display order** (top-first,
matching the reversed render order in `Timeline.svelte`). A helper resolves the selection to the
ordered `{ layerIds: number[]; startFrame; endFrame }` used by copy/cut/delete.

Cleared (set to `null`) on: active-layer change via label click is **kept** (selection can span the
active layer); cleared on **structural edits** (insert/delete frame, move key, set-hold, layer
add/remove/reorder), **project replace/resize**, **tool switch away from timeline**, and an explicit
tap on an empty cell (which seeks). Exact list finalized in the plan; the guiding rule: any op that
can invalidate a stored `{layerId,frame}` clears the selection.

### Pure block functions (`src/anim/timeline.ts`)

```ts
// Extract a self-contained block. layerIds top-first; frames inclusive. Materializes each
// column's leading hold to a cloned KEY; deep-clones every KEY canvas + transform/transformBox.
copyBlock(project, layerIds, startFrame, endFrame, ops): CellBlock

// Overwrite-paste: stamp block at (targetLayerIds top-first aligned to columns, startFrame).
// Pads a column with holds if it lands past that layer's end. Overflow columns (past bottom
// layer) ignored. Replaces cells (never mutates in place). Deep-clones out of the clipboard so
// repeated pastes don't share canvas refs.
pasteBlockOverwrite(project, block, targetTopLayerId, startFrame, ops): void

// Insert-paste: for each pasted layer, splice its column's cells at startFrame, shifting later
// cells right (pasted layers only — D5). Same cloning/overflow rules.
pasteBlockInsert(project, block, targetTopLayerId, startFrame, ops): void

// Replace every cell in the block region with a hold (D4 Delete). Keeps ≥1 cell per layer.
deleteBlock(project, layerIds, startFrame, endFrame): void
```

Cloning uses the injected `CanvasOps.clone` (real `cloneCanvas` in the app; a fake in tests), and a
small `cloneCell` helper that deep-copies `transform`/`transformBox`. **Never share cell/canvas refs**
between clipboard and document, or between two pastes — required by undo-snapshot invariant #8.

### Interaction (`Timeline.svelte`)

The row already owns `pointerdown/move/up` for seek/move/resize (`DragMode`). Add a **`select`**
drag mode reached via **long-press** (a timer started on `pointerdown` over a cell; if the pointer
stays put ~400 ms it enters select mode, sets a 1×1 selection at that cell, and subsequent
`pointermove` extends `focus`). A normal quick press/drag keeps today's seek/move/resize behavior
unchanged. Desktop **Shift+click** sets/extends `focus` without the long-press timer.

**Action bar:** a small floating toolbar rendered when `timelineSelection` is non-null, anchored near
the selection rectangle, with buttons **Copy · Cut · Paste · Paste Insert · Delete**. Paste buttons
are enabled only when `cellClipboard` is non-null. All buttons call `appState` actions wrapped in
`commitStructural` (except Copy, which is non-mutating).

**Keyboard (desktop enhancement, in `App.svelte onKey`):**
`Cmd/Ctrl+C` copy, `Cmd/Ctrl+X` cut, `Cmd/Ctrl+V` paste (overwrite), `Cmd/Ctrl+Shift+V` paste-insert,
`Delete/Backspace` delete-block — **only when a `timelineSelection` exists and focus isn't an
INPUT/TEXTAREA**.

**Integration with existing image paste (`onPaste`):** `Cmd+V` also fires the window `paste` event,
which today creates an image-reference layer from clipboard image files. Disambiguation rule:
- If `cellClipboard` is non-null **and** a `timelineSelection` (or a valid paste target) exists,
  the keydown handler performs a **cell paste and `preventDefault()`s**, and `onPaste` early-returns
  when it sees no image file (its existing behavior) — so no double-handling.
- If the OS clipboard carries an image file, `onPaste` still handles it (unchanged). Cell paste is an
  app-internal clipboard and does not populate the OS clipboard, so the two never contend for the
  same payload; only the keystroke is shared, and the keydown path wins when a cell paste applies.

This is the one genuinely fiddly integration point; the plan will add a focused check and, if needed,
a guard flag so exactly one path acts per `Cmd+V`.

### Paste target and cross-layer mapping

- Anchor: block top-left → **(active layer, playhead)**. `targetTopLayerId = activeLayerId`,
  `startFrame = playhead`.
- Fill **downward by display order** from the active layer; column *c* maps to the *c*-th drawing
  layer at/below the active layer.
- Overflow (block taller in layers than the layers remaining below the active layer): **ignore extra
  columns** (D8).
- A column landing past its target layer's current length is padded with holds up to `startFrame`
  before writing (overwrite) or spliced at the clamped index (insert), reusing the clamp/pad idioms
  already in `timeline.ts`.

## Phasing

Each phase builds on the shared engine above and is independently shippable.

- **Phase 0 — selection foundation.** `timelineSelection` state + derived-rect helper + highlight
  rendering + long-press/Shift-click gesture + clear-triggers. No clipboard yet. Verifies the gesture
  and highlight in isolation.
- **Phase 1 — single cell (1×1).** Full clipboard + `copyBlock`/`pasteBlockOverwrite`/
  `pasteBlockInsert`/`deleteBlock` exercised at 1×1; action bar + keyboard shortcuts + the `onPaste`
  disambiguation. Immediately useful; generalizes `duplicateKeyframe`.
- **Phase 2 — single-layer range (N×1).** Frame-axis selection drag; the materialize-leading-key
  rule now matters (a range starting on a hold). Overwrite + insert over a run of frames.
- **Phase 3 — rectangular block (N×M).** Layer-axis selection drag; cross-layer anchor mapping +
  overflow handling; insert ripples pasted layers only.
- **Phase 4 — cross-document clipboard (deferred).** Serialize `CellBlock` to PNG-per-key like
  `persist/project-file.ts` so blocks survive across projects/tabs. Purely additive; not in initial
  scope.

## Testing

Pure block functions are node-unit-testable with a fake `CanvasOps` (as `timeline.test.ts` already
does for `insertKeyframe`/`duplicateKeyframe`/`setHoldSpan`). Cover:

- `copyBlock`: materialize-leading-key (top row is a hold → cloned key); interior holds preserved;
  deep-clone (mutating a clipboard canvas doesn't touch the source); transform/transformBox cloned.
- `pasteBlockOverwrite`: in-place stamp; length unchanged; landing past end pads with holds; trailing
  hold now resolves to the pasted key; overflow columns ignored; repeated paste doesn't share refs.
- `pasteBlockInsert`: later cells shifted right on pasted layers only; length grows; non-pasted layers
  untouched.
- `deleteBlock`: region becomes holds; ≥1 cell per layer preserved.
- Selection rect derivation: anchor/focus in any order; layer run in display order; reference layers
  excluded.

Canvas/DOM/gesture/iPad parts (long-press timing, action-bar anchoring, highlight) are **not**
node-testable and are build- + review- + browser-verified, per the project's verification-debt note.

## Non-goals / deferred

- Cross-document / cross-tab clipboard (Phase 4).
- Non-contiguous (Ctrl-click multi-cell) selection — contiguous rectangle only.
- Auto-creating layers on paste overflow.
- Linked/reference paste (Krita clone-frame / Toonz shared-drawing semantics) — every paste is an
  independent deep copy.
- Populating the OS clipboard with cell data.

## Open questions for spec review

None blocking. The `onPaste` vs `Cmd+V` disambiguation and the exact selection clear-trigger list are
the two areas to watch during planning; both have a stated default above.
