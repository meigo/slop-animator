# Timeline iPad UX — sticky gutter, playhead follow, pen vs palm

**Date:** 2026-08-14
**Status:** Approved in session (prod-test follow-up)

## 1. Palm on the timeline while drawing

The canvas already treats `pointerType === "touch"` as navigate and `"pen"`/`"mouse"` as edit. The timeline only did that for cell-strip pan-vs-marquee. The ruler, audio lane, and layer-name buttons treated a resting palm as a real click.

**Rule:** the whole timeline grid is finger-navigates / Pencil-edits.

- `touch` → pan the scroller only. No seek, no audio offset, no layer activate, no select/move/resize, no mute/remove.
- `pen` / `mouse` → existing edit gestures.
- The layer *list* (side panel) stays finger-friendly.

No “pen-is-down-on-canvas” latch. Palm is `touch`; that is enough.

## 2. Sticky gutter slides off after ~one viewport of scroll

Each row is a block-level flex child of `overflow-auto`, so its containing block is the *visible* scroller width. `position: sticky` is trapped in that box.

**Fix:** `w-max` on the ruler, audio, and layer rows so the sticky box is the full frame strip.

## 3. Playhead follow

Page steps, not continuous tracking. While playing (not scrubbing): if the playhead walks off the right edge of the visible cell strip, jump `scrollLeft` so it sits just after the gutter. If it wraps backward (loop) and leaves the view, snap back. If the user has scrolled ahead of a still-advancing playhead, do not yank them back.

Pure helper: `playheadFollowScroll` in `timeline-layout.ts`.
