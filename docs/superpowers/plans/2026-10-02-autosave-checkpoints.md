# Autosave checkpoints Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-02-autosave-checkpoints-design.md`. Source: slop-paint `2c53625`
(read its `git show`). Executed by one implementer, then a final review; the user said go on without stops.

1. **Pure plan + history counter** — copy `autosave-plan.ts` and its test (adapt imports, add
   `mediaIds`); add the `History` change counter with a test. `npm test`. Commit.
2. **Storage** — `autosave.ts` keys, meta, checkpoints, kept, list, load-by-key, clear-latest-only; keep
   the one-at-a-time queue and generation checks. Media pruning keeps stored copies' `mediaIds` (startup,
   Open, New). Build 0/0. Commit.
3. **Guard + dialog + menu + memory** — App wiring (probe, `markSaved` after restore/replace/save,
   check before save and on return, pause + sticky status, dev `slopBlankLayers`), `RestoreDialog.svelte`,
   File ▸ Restore autosave…, Document-menu memory line, `modalOpen`. Browser check (throwaway) + a
   `test:ipad` check (blank → paused + dialog; Restore brings ink back). Break on purpose. Commit.
4. **Docs** — README (feature), CLAUDE.md (current state, roadmap 12 SHIPPED), CHANGELOG. Commit.
