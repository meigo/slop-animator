# Timeline selection-first interaction model — design

**Date:** 2026-07-10
**Status:** Design (approved for planning)
**Feature:** Rework the timeline track-body interaction into a coherent **selection-first** model, and
add the missing capability to **drag-move a selection** (single key or a frames×layers block).

## Motivation

The timeline's row gestures grew feature-by-feature and now overlap awkwardly. After block
copy/paste shipped, a selection can be copied/cut/deleted but **not moved** — the only move is
`moveKeyframe` (a single key, with odd *swap-on-collision* semantics). Meanwhile tap/drag are
overloaded (tap-empty seeks, drag-empty scrubs, drag-key moves one key, edge-drag resizes, long-press
selects), and selection is disconnected from manipulation. The chosen direction is the dope-sheet
standard: **the selection is the single source of truth; you click to select and drag to move the
selection.**

### Current model (for reference)

`rowDown/rowMove/rowUp` in `Timeline.svelte` drive `DragMode = none|seek|move|resize|select`:
tap-empty → seek; tap-key → seek; drag-empty → scrub; drag-key → move one key (swap if it lands on a
key); edge-drag → `setHoldSpan`; long-press → block select; shift-click → extend. Scrub also lives on
the ruler (`rulerDown/Move/Up`).

## Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Philosophy | **Selection-first** — click selects, drag moves the selection. |
| D2 | Move axes | **Frames only** (horizontal). Cross-layer (vertical) move deferred. |
| D3 | Move collision | **Overwrite** — moved keys win; their old cells become holds. |
| D4 | Seeking | **Ruler + draggable playhead line only.** The track body never seeks (removes the tap-vs-drag ambiguity). |
| D5 | Empty cell | tap → **deselect**; drag → **marquee** select. |
| D6 | Key cell | tap → **select 1×1 + seek to its frame**; drag → **move** (see D7). |
| D7 | Drag an unselected key | **Reselect to it (1×1), then move.** The selection always reflects what you manipulate. |
| D8 | Marquee start | drag-from-empty **and** long-press-then-drag (touch / over packed rows); shift/ctrl-click adds (desktop). |
| D9 | Move feedback | **Live ghost** at the current offset during the drag; commit `moveBlockFrames` once on release (one undo step). |
| D10 | Scope | **One feature** — the full selection-first model + move engine together (it's interlocking). |

## The unified gesture model

| Surface / gesture | Result |
|---|---|
| Ruler tap/drag | seek / scrub (unchanged) |
| Playhead line grab + drag (in body) | scrub (**new**) |
| Empty cell — tap | deselect (clear selection) |
| Empty cell — drag | marquee select (frames × layers) |
| Key ◆ — tap | select 1×1 + seek to its frame |
| Key ◆ — drag, key ∈ selection | move the whole selection (frames only) |
| Key ◆ — drag, key ∉ selection | reselect to it (1×1), then move |
| Long-press + drag (anywhere) | marquee (touch / packed rows) |
| Shift / Ctrl-click (desktop) | add / extend selection |
| Span right-edge drag (5 px) | resize hold span (unchanged) |
| Action bar / shortcuts | copy · cut · paste · insert · delete (unchanged) |

## Architecture

Pure move logic in `src/anim/timeline-block.ts` (extends the existing block module, node-unit-tested).
Gesture state machine rewritten in `src/lib/Timeline.svelte` (DOM — build + browser verified). Reuses
the existing selection state (`timelineSelection`, `resolveSelectionRect`) and the clone discipline
from copy/paste.

### Pure: `moveBlockFrames` (new, in `timeline-block.ts`)

```ts
/** Move the selected block by `delta` frames on its OWN layers (frames-only), overwriting the
 *  destination. Returns the delta actually applied after clamping (so the caller can follow the
 *  selection). Self-contained: leading holds in the range are materialized to keys before the move,
 *  the original range is blanked to holds, and the block is re-stamped at +delta. Clamped so the
 *  earliest moved frame never goes below 0; pads with holds past a layer's end. Replaces cells
 *  (never mutates in place); clones canvases so no source/clipboard ref is shared. */
export function moveBlockFrames(
  project: Project,
  layerIds: number[],
  startFrame: number,
  endFrame: number,
  delta: number,
  ops: CanvasOps,
): number;
```

Implementation sketch (reusing existing helpers):
1. `const applied = Math.max(delta, -startFrame);` — clamp so `startFrame + applied >= 0`. If
   `applied === 0` return 0 (no-op).
2. `const block = copyBlock(project, layerIds, startFrame, endFrame, ops);` — self-contained,
   per-layer columns (deep-cloned; leading hold → materialized key).
3. `deleteBlock(project, layerIds, startFrame, endFrame);` — original range → holds.
4. For each column `c`, stamp `block.columns[c]` onto **`layerIds[c]`** (its own layer, *not* the
   `drawingLayerIdsDown` remap that paste uses) starting at `startFrame + applied`, overwriting and
   padding past the end (same per-cell write as `pasteBlockOverwrite`). Factor the per-layer
   overwrite-write into a shared helper so paste and move don't duplicate it.
5. Return `applied`.

Because the block is cloned in step 2 before step 3 blanks the source, source/destination **overlap**
(small `delta`) is correct.

Unit tests (fake `CanvasOps`): move +2 with no collision; move onto an existing key overwrites it;
move that overlaps the source (delta 1) keeps the moved drawing and blanks only the vacated cells;
clamp at 0 (delta below start → applied stops at `-startFrame`); pad past end; multi-layer block moves
each column on its own layer; canvases are cloned (no shared refs).

### State/actions (`appState.svelte.ts`)

```ts
/** Move the current timeline selection by `delta` frames (frames-only, overwrite). Undoable;
 *  the selection follows to the new range. No-op if there's no selection or applied delta is 0. */
export function moveTimelineSelection(delta: number): void;
```
Reads `resolveSelectionRect`, calls `liftGuard.discard?.()`, wraps `moveBlockFrames` in
`commitStructural`, and updates `state.timelineSelection` anchor/focus frames by the *applied* delta
(so a clamped move keeps the highlight correct). `commitStructural` currently clears the selection —
`moveTimelineSelection` must **re-set** the selection to the moved range after the commit (the move is
the one structural edit that keeps its selection).

### Gesture rewrite (`Timeline.svelte`)

`DragMode` becomes `none | resize | marquee | moveblock`. Seek moves out of the body entirely.

- **`rowDown(e, layer)`** — classify the hit via `planCellPointer` + selection membership:
  - Shift/Ctrl-click with an existing selection → extend/add; done.
  - **Resize** (edge hot-zone) → unchanged (`setHoldSpan` live, commit on up).
  - **On a key:** if the key ∈ current `selRect` → `dragMode = "moveblock"`, record `grabFrame`.
    Else → set selection 1×1 at this key + seek to its frame (`go(frame)`) + `dragMode = "moveblock"`
    armed from the new 1×1 (a drag moves it; a tap leaves it selected+seeked).
  - **On empty:** arm a possible marquee/deselect — record the down cell; do **not** seek.
  - Always arm the long-press timer → marquee.
- **`rowMove`** — cancel long-press once travel exceeds `MOVE_CANCEL_PX`.
  - `moveblock`: `moveDelta = clamp(rowColumn(e) - grabFrame, …)`; render the highlight ghosted by
    `moveDelta` (visual only — no mutation yet).
  - `marquee`: extend the selection via `layerIdAtPoint` (as today).
  - If armed-from-empty and travel exceeds threshold → begin `marquee` from the down cell.
- **`rowUp`** —
  - `moveblock`: if `moveDelta !== 0` → `moveTimelineSelection(moveDelta)`; else it was a tap (the
    down-side already selected+seeked). Reset drag state.
  - `marquee`: finalize (selection already set live). Reset.
  - armed-from-empty with no drag → **deselect** (`clearTimelineSelection()`). Reset.

- **Playhead-line scrub (new):** add a thin interactive hit-area around the playhead line inside the
  wrapper (currently `pointer-events-none`) with its own `pointerdown/move/up` that scrubs
  (`go(rowColumn)`), pointer-captured, `touch-action:none`. It sits above cells (z) but only a few px
  wide so it doesn't block cell gestures elsewhere.

- **Highlight ghost:** when `dragMode === "moveblock"`, offset the selection-highlight class test by
  `moveDelta` so the block visibly slides; the action bar hides or follows during the drag (detail:
  hide it while `moveblock` is active to avoid a jumping bar).

## Removed / changed behavior

- **Removed:** body seek (tap-empty & drag-empty no longer seek/scrub → ruler + playhead line);
  **swap-on-collision** single-key move (→ overwrite move); tap-a-key-just-seeks (→ select+seek).
- **Repurposed:** long-press now starts a marquee (was the only selection path).
- **Kept unchanged:** ruler scrub, span-edge resize, the block copy/paste engine + action bar +
  keyboard shortcuts, `moveKeyframe` stays in the module for tests/back-compat but is no longer the
  body's move path.

## Testing

- **Unit (node):** `moveBlockFrames` — no-collision move, overwrite-on-collision, source/dest overlap,
  clamp-at-0, pad-past-end, multi-layer per-column, clone-not-shared. (`moveKeyframe`'s existing tests
  stay.)
- **Build:** `npm run build` 0/0; `npm test` baseline + new move tests.
- **Browser (verification debt — flag to user):** tap key selects+seeks; drag selected block moves it
  (overwrite, clamp at 0, past end); drag an unselected key reselects+moves; marquee via drag-empty
  and long-press-drag; shift/ctrl add; empty-tap deselects; ruler + playhead-line scrub; the action
  bar and highlight behave during a move; undo restores the pre-move state in one step; touch/Pencil
  parity on iPad.

## Non-goals / deferred

- **Cross-layer (vertical) move** — frames-only this pass (D2). The 2-D xsheet move is a later add.
- **Insert/ripple move** — overwrite only (D3).
- **Non-contiguous selection** — still a single rectangle.
- A **draggable transformation pivot / snapping** to keys — out of scope.
- Reworking the **ruler** or adding frame-zoom — unrelated.

## Open questions for spec review

None blocking. The live-ghost rendering detail (offset highlight; hide the action bar mid-move) and
the exact playhead-line hit-area width are easy to tune during the browser pass.
