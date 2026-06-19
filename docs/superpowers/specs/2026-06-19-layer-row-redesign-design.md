# Layer Row Redesign (compact + second row on select) — Design

**Status:** Approved (design phase)
**Date:** 2026-06-19

## Goal

Declutter the LayerList rows — especially reference layers, which currently cram a type chip, name,
rename, video-offset input, re-link, and opacity into a 224px panel. Make non-active rows compact and
reveal the detail controls only for the selected layer, on a second row. UI-only; no model/store/
persistence change.

## Current row (`layerRow` snippet in `src/lib/LayerList.svelte`)

A single flex row holds: drag handle · visibility eye · (ref: text chip `IMG`/`VID`/`VID?` + missing
re-link) · name (or inline rename input) · rename ✎ · (ref video: offset input) · opacity slider.
Reference rows are visibly cramped.

## Design

The `layerRow` becomes a vertical block (still one `data-layer-id` wrapper, so the SortableJS
drag/rebuild is unchanged):

**Row 1 — compact, every layer (always):**
`[⠿ drag handle] [👁 visibility] [type-icon — refs only] [name]`
- Clicking the block selects the layer (as today).
- Type icon replaces the text chip: `image` → `Image`, `video` → `Film`. A **missing** reference
  shows its `was` type icon (Image/Film) dimmed (`text-text-muted`) with a "Missing — re-link" title,
  so at a glance it reads as a missing image/video.
- The name truncates; no rename ✎, opacity, or offset in row 1.

**Row 2 — only the active layer** (`{#if layer.id === state.activeLayerId}`, auto-revealed on select;
no manual toggle):
- **opacity** slider (wider now) + its `%` value.
- **✎ rename** button → triggers the existing inline rename (the name in row 1 swaps to the editor via
  the current `editingId`/`startEdit` mechanism).
- Reference additions: **video-offset** number input (when the media is a live `video`), and a
  **🔗 re-link** button (when the media is `missing`).
- Row 2 is indented to align under the name and visually subordinate.

**Unchanged:** group header rows (their own chevron/name/eye/ungroup); the active-layer highlight
(`bg-surface-active`) now spans both rows of the block; the inline rename input still renders in row 1
(in place of the name) — only its trigger moves to row 2.

## Implementation notes (`src/lib/LayerList.svelte`)

- Add `Image, Film` to the `@lucide/svelte` import (Eye/EyeOff/GripVertical/Pencil/Link already present).
- Restructure the `layerRow` snippet: wrap row 1 + row 2 in the existing `data-layer-id` div as a
  `flex flex-col`. Row 1 is a `flex items-center` of handle/eye/type-icon/name. Row 2 is
  `{#if layer.id === state.activeLayerId}` with the detail controls; each control keeps its current
  handler and `e.stopPropagation()` so the row's select-onclick and the drag don't fire.
- The rename input branch (`{#if editingId === layer.id}`) stays in row 1, replacing the name span as
  it does now; the ✎ that calls `startEdit(layer)` moves to row 2.
- Move the opacity `<input type="range">` and the video-offset `<input type="number">` from row 1 into
  row 2; add a small `{layer.opacity}` readout beside the opacity slider.
- Keep all bindings identical (`bind:value={layer.opacity}`/`offsetFrames`, `oninput={bump}`,
  `relinkReference`, `startRelink`) — only their placement changes.

## Testing

No automated test (UI-only; Vitest has no DOM, and there's no layer-row test). Verified by build +
manual.

**Manual (browser):**
- Non-active rows show only handle · eye · (type icon for refs) · name — uncluttered, names have room.
- Selecting a layer reveals the second row with opacity (+%), rename, and — for refs — offset (video)
  / re-link (missing); deselecting hides it.
- Drawing, reference (image/video/missing) all render correctly in both states; reference rows are no
  longer cramped.
- Rename, opacity, video offset, and re-link all still work from the second row.
- Dragging by the handle still reorders (the whole block moves); group nesting + collapse unaffected.
- Missing reference reads as missing (dimmed type icon) even when not selected.

## Out of scope

- Group header restyle, multi-select, an always-visible opacity, or a per-row controls popover (the
  two alternatives we set aside).

## Self-review notes

- Pure presentation change to one snippet; no store/model/persistence/drag-logic edits, so risk is
  contained to layout + the `data-layer-id` wrapper staying intact for SortableJS.
- Reuses every existing handler/binding; only placement and the chip→icon swap change.
