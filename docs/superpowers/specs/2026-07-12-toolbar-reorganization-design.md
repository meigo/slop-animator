# Top toolbar reorganization (contextual tool-options) — design

**Date:** 2026-07-12
**Status:** Design (approved for planning)
**Feature:** Restructure the top toolbar from one flat wrapping list of ~30 controls into a **primary
bar** (tools + history + menus) plus a **contextual options bar** that shows only the active tool's
settings. Collapse File / Import-Export / View into dropdown menus. Move the pixel Copy/Cut/Paste/
Delete into the Select/Lasso contextual bar and remove the orphaned floating canvas paste button.

## Motivation

`Toolbar.svelte` is a single `flex flex-wrap` holding tools, all 11 brush/eraser settings, size
presets, history, import/export/media, file ops, and view/settings — **all always visible**. It wraps
into three cramped rows; the brush settings clutter the bar even when a non-drawing tool is active,
and the recently-added pixel paste had no home so it became a floating on-canvas button (which reads
as orphaned). The fix is the standard **contextual tool-options** model (Procreate/Photoshop): a small
persistent bar + a row that swaps to the active tool's controls.

## Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Model | **Contextual tool-options**: primary bar + a second bar showing only the active tool's options. |
| D2 | Menus | **Click-to-open dropdown popovers** (dismiss on outside-click) for **File**, **Import/Export**, **View**. |
| D3 | Selection pixel ops | **Copy/Cut/Paste/Delete on the contextual bar** when Select/Lasso is active. Removed from the near-selection floating bar (that keeps Transform/Distort/Mesh/Commit/Cancel). |
| D4 | Floating paste button | **Removed** (superseded by the contextual bar's Paste). |
| D5 | Undo/Redo | Stay on the **primary bar** (always available, tool-independent). |

## Layout

```
PRIMARY BAR (always):
  [Brush][Eraser][Fill][Eyedropper] │ [Select][Lasso] │ [Transform][Deform][Pose]      ↶ ↷      [File ▾] [Import/Export ▾] [View ▾]

CONTEXTUAL BAR (second row — swaps by appState.tool):
  brush/eraser → Size ●──  [presets 0.5 1 2 4 8 16 32 60]  Press ●  | type▾ Opacity● Smooth● Stream● □Taper □Behind ∿curve  ▮color
  fill         → Tolerance●  Expand●  ▮color
  select/lasso → [Copy][Cut][Paste][Delete]        (Paste enabled when clipboard has pixels; Copy/Cut/Delete when a marquee exists)
  transform    → [Frame │ Layer │ Group] scope  (+ existing warnings)
  deform       → [FFD │ Rigid]
  pose / eyedropper → (empty / a one-line hint)
```

The two bars are **fixed height** (no wrapping) — the app's top region becomes `PrimaryBar` +
`ToolOptionsBar`, replacing the single wrapping `Toolbar`.

### Menu contents (D2)

- **File ▾** — New, Open, Save, Resize canvas.
- **Import/Export ▾** — Add Image, Paste image from clipboard, Add Video, Import audio, Export video.
- **View ▾** — Theme (light/dark), Onion skin (toggle → its settings), Project settings (bg /
  transparent / fps), and any grid/checkerboard toggle currently on the bar.

All menu items reuse the **existing handlers** already in `Toolbar.svelte` (save/open/new/resize,
add-image/video/audio/export, theme/onion/settings) — this is markup relocation, not new logic.

## Architecture

Split the one component into three, keeping handlers where practical:

- **`src/lib/Toolbar.svelte`** — becomes the **primary bar**: the tool buttons + undo/redo + the three
  menu buttons. Owns the file/import/export/view handlers (unchanged) now invoked from menu items.
- **`src/lib/ToolOptions.svelte`** (new) — the **contextual bar**: `{#if appState.tool === …}` blocks
  for brush/eraser, fill, select/lasso, transform, deform. Moves the existing brush-settings /
  fill-settings / transform-scope markup out of Toolbar verbatim (same `bind:`s to `appState.brush`/
  `eraser`/`fill`/`transformScope`).
- **`src/lib/ToolbarMenu.svelte`** (new, small) — a reusable dropdown: a trigger button + a popover
  panel (open state + `clickOutside` to dismiss, mirroring the Timeline boil-settings popover). Used
  three times (File/Import-Export/View) with slotted items.
- **`src/App.svelte`** — renders `<Toolbar />` then `<ToolOptions />` (two stacked bars) where
  `<Toolbar />` was.

### Reactive flags for the contextual selection ops

The Select/Lasso contextual row's buttons need reactive enable-state (currently the selection state
lives in the `Selection` instance and is polled by `SelectionActions`). Expose two `$state` booleans
on `appState`, set by `Canvas.svelte`:

```ts
// appState
selectionActive: boolean;    // a committed marquee exists (active && !hasFloating)
hasPixelClipboard: boolean;  // the pixel clipboard has content
```

- `Canvas.svelte` sets `appState.selectionActive` from `selection.onStateChange` (`selection.active &&
  !selection.hasFloating`), and resets it on teardown.
- `Canvas.svelte` sets `appState.hasPixelClipboard = true` in `copySelection`/`cutSelection` (and keeps
  the pixel clipboard as today); it stays true for the session (clipboard persists). `pasteSelection`
  reads the same clipboard.

`ToolOptions.svelte` (Select/Lasso block): **Copy/Cut/Delete** `disabled={!appState.selectionActive}`,
**Paste** `disabled={!appState.hasPixelClipboard}`, each calling `selectionActions.copy/cut/del/paste`.

### Remove the floating paste button (D4)

Delete the `{#if selectionClipboard && select|lasso}` floating `<button>` in `Canvas.svelte` (added as
an interim). Paste now lives in the contextual bar. Keep `selectionClipboard`/`pasteSelection` and the
`selectionActions` registry — only the on-canvas button is removed; `hasPixelClipboard` drives the new
button's state.

### Near-selection floating bar (D3)

`SelectionActions.svelte` — **remove** the Copy/Cut/Delete buttons added earlier (they move to the
contextual bar). Keep Free-transform / Distort / Mesh / density / Commit / Cancel. Drop the now-unused
`onCopy`/`onCut`/`onDelete` props + the Canvas wiring for them.

## Interaction / details

- **Tool switch** swaps the contextual bar instantly (it's a reactive `{#if appState.tool}`).
- **Menus** close on outside-click and on selecting an item; only one open at a time is fine (each is
  independent; clicking another trigger closes the first via its own outside-click).
- **Contextual bar height** is reserved even for tools with a minimal/empty row (eyedropper/pose), so
  the canvas doesn't jump when switching tools — the bar stays present (shows a hint or is empty).
- **Color** stays inline in the brush/fill contextual rows (it's a per-tool setting), not a menu.
- Keyboard tool shortcuts (b/e/g/s/l/…) and all existing behavior are unchanged — only the UI moves.

## Testing

`Toolbar`/`ToolOptions`/`ToolbarMenu`/`Canvas` are DOM components — not node-testable (Vitest has no
DOM). Verification:
- **Build:** `npm run build` 0/0; `npm test` baseline (**319**) unaffected (no logic changes to tested
  code; the moved markup keeps the same `bind:`s/handlers).
- **Reasoning:** control moves are verbatim relocations preserving `bind:value`/`onclick`; the two new
  `appState` flags are simple mirrors.
- **Browser (verification debt — flag to user):** every control still works after relocation (draw
  settings, fill, presets, color, undo/redo); each menu opens/dismisses and its items act; the
  contextual bar swaps per tool with no layout jump; Select/Lasso Copy/Cut/Paste/Delete with correct
  enable-states drive the same ops; the floating canvas paste button is gone; iPad reachability of
  everything (no keyboard needed).

## Non-goals / deferred

- **Left vertical tool rail** (option C) — deferred; top-bar contextual only.
- **Customizable/reorderable toolbar**, overflow "more" menus, per-tool preset saving — not now.
- **Restyling** individual controls (sliders/swatches) beyond relocation — keep current styles.
- Changing tool behavior, shortcuts, or the near-selection transform bar's transform functions.
