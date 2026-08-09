# Project Name — Design

**Status:** Approved (2026-08-09)
**Date:** 2026-08-09

## Problem

Save and export filenames are hardcoded (`project.zip` in `Toolbar.svelte`, `animation.zip`/
`animation.<kind>` in `ExportDialog.svelte`). On iPad Safari the filename can't be chosen at
download time, so every save lands in Files as `project (n).zip` — anonymous and ever-incrementing.
`Project` has no name field.

## Design (user-approved)

1. **Model:** `Project.name: string`, default `"untitled"` in `createProject`. Not undoable
   (matches fps/bgColor settings behavior). Changing it marks autosave dirty via `bump()`.
2. **Persistence:** optional `name?: string` in `ProjectJson` (version stays 1). `projectToJson`
   writes it; `loadProjectBlob` reads `json.name ?? ""` — the empty string means "unknown", and the
   caller supplies the fallback: the Toolbar open path uses the picked file's basename
   (`walkcycle (3).zip` → `walkcycle (3)`), the autosave-restore path uses `"untitled"`.
3. **UI:** one text input at the top of the existing Project Settings dialog. No other surface.
4. **Filenames:** save → `<name>.zip`; PNG-sequence export → `<name>.zip`; video export →
   `<name>.mp4`/`.webm`. A pure `sanitizeFilename(name)` (in `project-file.ts`, unit-tested) strips
   `/ \ : * ? " < > |` and control chars, collapses the result, trims, and falls back to
   `"untitled"` when empty.

## Out of scope

Overwrite-in-place saving (needs File System Access, not on iPad Safari); a save-time rename
prompt; showing the name outside the settings dialog; per-save name history.

## Testing

Unit: `sanitizeFilename` cases; `name` round-trip through save/load; absent-name → `""`.
Browser pass owed: settings-dialog input on iPad (keyboard focus, `touch-action` not applicable —
it's a text field); save produces `<name>.zip` in Files; old-file open adopts the file's basename.
