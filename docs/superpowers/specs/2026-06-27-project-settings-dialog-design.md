# Project Settings Dialog — Design

**Status:** Approved (design phase)
**Date:** 2026-06-27

## Context

Several per-project document properties have no UI home: `fps` and `bgColor` are unreachable, and
`transparentBg` is a lone toolbar toggle. (Only `width`/`height` have UI, via `SizeDialog`.) This adds a
dedicated **Project Settings** dialog for the document's *live, instantly-reversible* properties —
background color, transparent toggle, and fps — opened from a gear button. It deliberately does **not**
absorb `SizeDialog`: resizing is a destructive content transform (scale/crop + anchor), a different kind
of operation, so it stays its own flow and the settings dialog just links to it.

Confirmed decisions (from brainstorming):
- **Separate dialog** from New/Resize (`SizeDialog` unchanged); they cross-link via a "Resize…" button.
- **Live apply** — edits update the project immediately (canvas recolors, checker appears); no Apply
  button, just Close. **Not** pushed to undo (settings, like the theme toggle).
- Scope = `bgColor`, `transparentBg`, `fps`. **No** project name/title field (the model has none).
- The existing **toolbar transparency toggle stays** as a quick shortcut; the dialog also exposes it
  (both bind the same `state.project.transparentBg`).

## Architecture

Four small pieces. No new model fields — all three settings (`bgColor`, `transparentBg`, `fps`) already
exist on `Project` and are already persisted (project save + autosave).

### 1. Open/close state (`src/state/appState.svelte.ts`)
Add `settingsOpen: boolean` to the `AnimState` interface and initialize `false`, beside the existing
`exportOpen: boolean` / `sizeDialog`.

### 2. Trigger (`src/lib/Toolbar.svelte`)
A gear button (lucide `Settings`) in the right-hand cluster (near the theme + transparency toggles) that
sets `appState.settingsOpen = true`. Styled like the other icon buttons.

### 3. `src/lib/ProjectSettingsDialog.svelte` (new)
A modal mirroring `SizeDialog`'s shell (fixed dim overlay, centered card, click-outside + Close to
dismiss, `stopPropagation` on the card). Rendered when `appState.settingsOpen`. The component imports the
store as `state as appState` and `bump` (it uses no `$state` rune, so the alias is for consistency with
the other dialogs). Controls are **live-bound to the current project**:

- **Background**
  - Color input bound to `state.project.bgColor`; on input, set the value and call `bump()` so the
    canvas recolors live.
  - **Transparent** checkbox bound to `state.project.transparentBg`; on change, set + `bump()`.
  - Hint line: *"When transparent, this color flattens video exports."*
- **Playback**
  - fps number input (min 1, max 60). On input, `state.project.fps = clamp(1, 60, Math.round(value))`
    + `bump()`. The clamp guards against empty/NaN/out-of-range typed input (HTML min/max don't hard-clamp
    typed values).
- **Canvas**
  - Read-only `{state.project.width}×{state.project.height}`.
  - **Resize…** button → `appState.settingsOpen = false; appState.sizeDialog.mode = "resize";
    appState.sizeDialog.open = true;` (hands off to the existing resize flow).
- **Close** button (and click-outside) → `appState.settingsOpen = false`. No Apply (all live).

### 4. Mount (`src/App.svelte`)
Add `<ProjectSettingsDialog />` beside the existing `<ExportDialog />` / `<SizeDialog />`.

## Data flow

Gear → `settingsOpen = true` → dialog renders. Each control writes its `state.project.*` field directly
and calls `bump()`; the Canvas rAF tick recomposites on the version change, so background color and the
transparency checker update live behind the dimmed modal. fps is read live by playback. Nothing is pushed
to history (settings are not undoable); the project's save/autosave already persist all three fields.

## Testing

These are DOM-bound controls over existing model fields, so verification is **build + manual** (Vitest has
no DOM); no new pure logic is introduced (the only computed bit, the fps clamp, is an inline
`Math.max(1, Math.min(60, Math.round(v)))`).

**Pure (node):** none required (no new model/persistence — `bgColor`/`fps`/`transparentBg` round-trips are
already covered by existing tests). Optionally assert the new `settingsOpen` default is `false` if a
cheap state test fits, but it's not required.

**Manual (browser, `npm run dev`):**
- Gear opens the dialog; click-outside and Close dismiss it.
- Drag the color input → canvas background recolors live (when opaque). Toggle **Transparent** → checker
  appears/disappears live; the toolbar toggle reflects the same state.
- Change **fps** → playback speed changes; typing junk/out-of-range clamps to 1–60.
- **Resize…** closes settings and opens the resize dialog (scale/crop/anchor) unchanged.
- Save → reload preserves bgColor, transparentBg, and fps.

Build **0/0**, lint clean, existing test count unchanged.

## Out of scope
- Folding `SizeDialog` (new/resize) into this dialog — it stays separate.
- Project name/title field (no such model field); boil/onion settings (deferred); global app preferences;
  undo for settings; per-new-project default bg/fps (global preference) — current-project only.

## Self-review notes
- Reuses `SizeDialog`'s modal shell pattern and the existing `appState`-flag convention (`exportOpen`,
  `sizeDialog`); the only new file is the dialog component, and it binds existing project fields — zero
  model or persistence change.
- Live + non-undoable matches the established behavior of the theme and the current transparency toggle,
  keeping the mental model consistent.
- Keeping resize in its own flow (linked, not merged) preserves the responsibility split: `SizeDialog` =
  destructive dimensional operations; `ProjectSettingsDialog` = live document-property edits.
