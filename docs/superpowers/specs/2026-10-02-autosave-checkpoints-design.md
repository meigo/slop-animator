# Autosave checkpoints, a blank-layers guard, and a memory estimate — port from slop-paint

Date: 2026-10-02. Source: slop-paint `2c53625` (`persist/autosave-plan.ts`, `persist/autosave.ts`,
`lib/RestoreDialog.svelte`, App wiring). Roadmap item (12) in CLAUDE.md. The user asked for it and said
to go on without approval stops.

## Problem

An iPad reclaims a backgrounded page's image memory: in slop-paint a 40-layer document came back with
every layer listed and EMPTY, and the next autosave would have replaced the only stored copy. This app
has the same single `autosave` slot and more canvases (cells × layers), so the same risk.

## Goal

1. **Checkpoints:** beside the latest autosave, up to 3 older copies at least 5 minutes apart, plus a
   "kept" copy; each with a meta (time, project name, layer count, inked layer count). File ▸ Restore
   autosave… lists them (newest first) and restores one (asking first, like Open).
2. **Blank-layers guard:** before every autosave and when the page comes back (pageshow / visible),
   check which drawing layers have pixels against the last save; if more layers lost ALL their pixels
   than undo steps happened since (`looksBlanked`), pause autosave (sticky status) and open the restore
   dialog. "Keep the blank layers" first copies the latest to the kept slot, then resumes.
3. **Memory estimate** in the Document menu: the key cells' image memory; on iPad (`isAppleTouch`) a
   one-time warning above 600 MB.
4. A restored copy comes back whole, its reference media included.

## Design

- **Pure** `src/persist/autosave-plan.ts`: slop-paint's file (`planCheckpoint`, `looksBlanked`,
  `layerMemoryBytes`, `IPAD_MEMORY_WARN_BYTES`, `formatBytes`) with its tests; `AutosaveMeta` gains
  `mediaIds: string[]` (this app's addition, see Media).
- **Storage** `src/persist/autosave.ts`: keep this app's one-save-at-a-time queue and generation
  checks (`saveAutosave(project, meta)`); in `write`, after the latest blob, put `autosave-meta`, then
  `planCheckpoint` → put the checkpoint blob + `autosave-checkpoints` list. `loadAutosave(dpr, key?)`,
  `listAutosaves()`, `keepLatestAutosave()`; `clearAutosave()` (New) deletes only the latest + its meta.
  Keys as slop-paint (`autosave`, `autosave-meta`, `autosave-kept`, `autosave-kept-meta`,
  `autosave-checkpoints`, `autosave-cp-0…2`). A latest without meta (older app) lists without details.
- **History counter:** `History.changes` (or similar), incremented on push, undo, redo and clear —
  the guard's "undo steps since". A document replace resets the baseline (`markSaved`).
- **Probe:** a drawing layer counts as inked if any of its key cells has a pixel, read by drawing each
  key cell canvas into a 256-px-wide probe at high smoothing (a thin line still leaves alpha), stopping
  at the first inked cell per layer. Reference layers are not probed. Only when a save is about to
  run or the page returns; never with a lift open (autosave already waits for `liftGuard.isOpen`).
- **Media:** pruning (startup, Open) keeps media referenced by the current project OR by any stored
  copy's `meta.mediaIds`; New (SizeDialog) prunes the same way instead of `clearAllMedia`, so a
  checkpoint restored after New still has its references.
- **UI:** `src/lib/RestoreDialog.svelte` (port of slop-paint's, this app's dialog conventions:
  `modalOpen` must include it so shortcuts stand aside); File ▸ Restore autosave… in the File menu;
  the memory line in the Document menu. Status via `persistAlert` (sticky) for the pause.
- **Dev hook:** in dev builds `window.slopBlankLayers()` blanks every key cell canvas (as the iPad
  does), to try the guard on a desktop.

## Testing

- Unit: slop-paint's `autosave-plan` tests (+ `mediaIds` passthrough); `History` counter.
- Browser (throwaway + a `test:ipad` check): draw, wait for an autosave, `slopBlankLayers()`, trigger
  a save → autosave pauses, the dialog opens and lists copies; Restore brings the drawing back;
  "Keep the blank layers" resumes. A checkpoint appears after a save ≥ 5 min after the first (fake
  `Date.now` in the page).
- Build 0/0, `npm test`, `test:ipad`.
