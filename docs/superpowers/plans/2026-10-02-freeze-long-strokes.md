# Freeze long strokes Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-02-freeze-long-strokes-design.md`. Executed inline (user: "go on, do not ask").

1. **Engines** — apply slop-paint `b89284d`'s `ink-brush.ts` / `calligraphy-brush.ts` hunks to
   `src/core/` (`git apply`, paths rewritten). Verify: `npx tsc --noEmit`, `npm test`. Commit.
2. **Canvas.svelte** — `frozenTo`, `frozenCanvas`, `FREEZE_STEP = 300`, `FREEZE_OVERLAP = 8`,
   `unfrozenFrom()`, `freezeSettled(points, kind, settings, sr)`, `restoreForRedraw()`; the Ink and
   Calligraphy branches call `freezeSettled`, restore via `restoreForRedraw`, and pass
   `unfrozenFrom()`; resets at stroke start, commit and discard. Verify: build 0/0; browser diff +
   timing (throwaway script, freeze on/off via `window.slopNoFreeze`), WebKit and Chromium; break on
   purpose (`to` ignored → frozen part drawn twice is invisible when opaque, so break by not
   restoring from `frozenCanvas` → the frozen part vanishes → diff large). Commit.
3. **Docs** — CHANGELOG, CLAUDE.md Current state / notes. Commit. Then final review (fresh, most
   capable model), fixes, merge `--no-ff`, push, deploy.
