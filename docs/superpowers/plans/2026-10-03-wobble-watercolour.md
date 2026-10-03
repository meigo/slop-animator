# Wobble and Watercolour Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-03-wobble-watercolour-design.md`. One implementer (dedicated agent), then a final review; merge/push/deploy after.

1. Wobble: `wobble.ts` + tests, `strokeSeed` move (dry-brush identical to slop-paint branch), Smooth and Calligraphy hooks, freeze compatibility, UI, settings.
2. Watercolour: `watercolor-brush.ts` + tests, brush.ts `outlineOfPath`/`steadySpacing`, Canvas branch, UI, settings.
3. Browser checks and a `test:ipad` check (broken on purpose).
4. Docs: README Features, CLAUDE.md, CHANGELOG.
