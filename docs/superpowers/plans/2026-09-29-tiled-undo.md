# Tiled pixel undo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pixel undo steps keep only the 64-px tiles they changed.

**Architecture:** `changedTiles`/`cropPixels` (from slop-paint) in `src/anim/history.ts`; `pixelCommand(ctx, before, after, undo(put), redo(put))` crops at push time and writes tiles back at undo/redo; all nine call sites move to the new shape with `put()` where `putImageData(…, 0, 0)` was.

**Tech Stack:** TypeScript, Svelte 5, Vitest (node — no DOM, so `ImageData` and the 2D context are stubbed).

**Spec:** `docs/superpowers/specs/2026-09-29-tiled-undo-design.md`

## Global Constraints

- `npm run build` 0 errors, 0 warnings; `npm test` all passing.
- Undo/redo callbacks never reference the full `before`/`after` snapshots.
- Each call site keeps its restore order (undo: pixels first; redo: keyframe track first, then pixels).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A step with no changed tiles (materialised keyframe, pixels unchanged) must still undo its keyframe — `put` is a no-op, the callback still runs.
- Undo after a later step on the same canvas: tiles restore only their own rects; since every step records both sides of its own change, sequential undo stays exact. Covered by the multi-step round-trip test.
- Edge tiles on a canvas whose size is not a multiple of 64.
- Mismatched snapshot sizes fall back to whole-canvas writes.
- `markInkChanged` still fires on push, undo and redo.

---

### Task 1: `changedTiles`, `cropPixels`, tiled `pixelCommand` + tests

**Files:** Modify `src/anim/history.ts`; create `src/__tests__/history-bounds.test.ts`; modify `src/__tests__/history.test.ts` (ink-revision test to the new signature).

**Produces:** `PixelRect`, `UNDO_TILE`, `changedTiles(a, b, width, height, tile?)`, `cropPixels(data, width, r)`, `pixelCommand(ctx, before, after, undo(put), redo(put)): Command`.

- [ ] Write `history-bounds.test.ts`: slop-paint's `changedTiles`/`cropPixels` tests verbatim (import `../anim/history`), a budget test at 1920×1080 dpr 1 (thick diagonal stroke ≥ 50 steps; whole-canvas = 16 steps), and `pixelCommand` tests with `globalThis.ImageData` stubbed as `class { constructor(public data, public width, public height) {} }` and a stub ctx `{ canvas: {}, putImageData(img, x, y) }` that copies `img.data` into a backing buffer at (x, y): round trip over three sequential steps (undo ×3 → original, redo ×3 → final), bytes = tile bytes, empty-tile step still runs its callback, mismatched sizes → whole buffers at (0, 0).
- [ ] Run → FAIL. Implement in `history.ts`. Run → PASS. Update the ink-revision test.

### Task 2: move the nine call sites

**Files:** `src/lib/Canvas.svelte` (7 sites), `src/lib/Timeline.svelte` (1).

- [ ] For each: `pixelCommand(ctx, before, after, (put) => { put(); …; }, (put) => { …; put(); … })`, replacing the `putImageData(before|after, 0, 0)` lines; nothing else in the callbacks changes.
- [ ] `grep -n "putImageData(before, 0, 0)\|putImageData(after, 0, 0)"` in the two files returns nothing inside history callbacks.
- [ ] Build clean, tests pass; desktop-browser check of draw / fill / delete-selection / clear-frame undo/redo.
- [ ] Docs: CLAUDE.md roadmap (2) shipped + dpr correction, CHANGELOG entry, README test count. Commit.
