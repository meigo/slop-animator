# Flash/Animate-style timeline — design

**Status:** draft for review · **Date:** 2026-09-09

## The ask

> "Thinking about trying to restyle it. Let's think adobe flash/animate. this and most other apps
> don't have full grid on timeline, only horizontal lines between tracks/layers. flash had much
> narrower frame marks, so more information would be visible on the screen. No hold keyframes
> marked, existing content would be represented by filled rectangle (like reference layers we have
> already)."

Four changes, which this spec treats as **three independently shippable phases**. Each is useful
alone and you can stop after any of them.

## What Flash actually draws

Worth stating precisely, because "no grid" overstates it:

- A **keyframe with content** is a filled dot at that frame; an **empty keyframe** is a hollow dot.
- The frames a keyframe holds over are a **filled span**, ending in a small hollow rectangle at the
  span's last frame.
- There is **no per-frame vertical rule**, but there IS a marker every 5 frames, and the lane is
  shaded in alternating 5-frame bands. That is what lets you count frames away from the ruler.
- Frames are narrow (~12px at default zoom), and the zoom is adjustable.

So keys stay individually marked; it is the **holds** that stop being marked one-by-one and become
a span. That matches the ask exactly.

## What we already have

**The data model is already Flash's.** `computeTimelineGlyphs` (`src/lib/timeline-glyphs.ts`, pure,
8 unit tests, memoized by `appState.version`) computes exactly four per-frame states:

| glyph | meaning | Flash equivalent |
| --- | --- | --- |
| `◆` | keyframe with ink | filled dot |
| `◇` | blank keyframe (a real boundary, no content) | hollow dot |
| `—` | hold continuing an inked key | the filled span |
| `""` | no key yet, or a hold after a blank key | empty lane |

A Flash span is precisely "a `◆` followed by its run of `—`", and the hollow end-cap is that run's
last frame. **Converting is a run-length pass over an array we already compute** — a rendering
change, not a model change. The part that would normally carry the risk is done and tested.

Reference layers already draw as filled rectangles using the `media-clip` / `media-clip-border`
roles, so phase 2 makes drawing layers and reference layers read as *the same kind of object*
rather than inventing a new idiom.

## Phase 1 — lose the grid, keep the count

**Change:** drop the per-frame vertical border from track cells. Keep a horizontal divider between
rows. Add a frame marker every 5, and/or a subtle alternating 5-frame band in the lane.

**Why the 5-marker is not optional.** Without any verticals you cannot tell which frame a mark sits
on once a row is far from the ruler, and for animating on 1s and 2s *the difference between a
3-frame and a 4-frame hold is the work itself*. Flash's 5-frame ticks are load-bearing for timing,
not decoration. This is the one place where "less grid" can go too far.

Consistent with `SLOP-TIMELINE-UI.md` §7, which already puts lanes on plain `ground` with the ticks
belonging to the ruler.

**Cost:** CSS only. No hit-testing touched, trivially reversible. **This phase alone will tell you
whether the denser look is what you want**, before anything risky is spent.

## Phase 2 — spans instead of per-frame cells

**Change:** render each inked key's hold run as one filled rect (`media-clip` fill,
`media-clip-border` edge) with a marker at the key and a hollow cap at the run's last frame. Blank
keys keep an outline marker; empty frames draw nothing.

**New pure function** `computeTimelineSpans(glyphs)` beside the existing one, taking the SAME array
and returning `{ startFrame, endFrame, blank }[]`. Pure, node-testable, and derived from the
existing tested function rather than re-deriving the model — the two cannot disagree about where a
span runs.

**The upside nobody asked for: this should be faster.** Today it is one DOM element per frame per
layer — a 500-frame × 10-layer project is **5,000 cells**, each with its own class bindings.
Spans collapse that to a handful of rects per row. This file's history makes that worth taking
seriously: the glyph memoization exists *because* per-cell work caused scrub jitter.

**The real cost is hit-testing, not painting.** `Timeline.svelte` is 2,935 lines carrying block
selection, marquee, drag-move, clip drag, video trim and range drag. The good news is that the
geometry is **already width-parametric**: `columnAtX(offsetX, cellW, count)` and
`planCellPointer(cells, offsetX, cellW, …)` in `timeline-grid.ts` take the width as an argument
rather than assuming it. What changes is that per-frame identity comes from arithmetic instead of a
`data-` attribute on a cell element. `layerIdAtPoint` resolves the ROW via
`elementFromPoint(...).closest('[data-layer-id]')` and keeps working; only the column lookup moves.

## Phase 3 — cell width as a persisted zoom

**Change:** `CELL_W` (currently a fixed `24`) becomes reactive and persisted, like `timelineHeight`
already is. There is family precedent: slop-video-compositor ships a px/s zoom on its timeline.

**Why a zoom rather than a smaller constant.** Flash's ~12px frames were mouse-driven; this app is
Pencil and finger. We made the brush size presets 24px squares on 2026-09-08 *because*
text-height targets were too small for a finger — narrowing timeline cells cuts the other way. A
Pencil is precise enough for 12px; a finger is not. A zoom refuses the false choice.

**HARD CONSTRAINT, already documented in the code** (`Timeline.svelte:1051`):

> `EDGE_PX` (resize hotspot, 5px) + `MOVE_CANCEL_PX` (6px) must stay < `CELL_W / 2`

At the current 24px: 5 + 6 = 11 < 12 — **it holds with 1px to spare.** At Flash's 12px:
`CELL_W / 2` is 6, and 11 > 6 — **the invariant breaks**, and a pending long-press could let a
resize cross a column boundary before it is cancelled.

So phase 3 is *not* "make the constant reactive". Either both thresholds scale with `cellW`
(`EDGE_PX = clamp(3, cellW * 0.2, 5)` and similar), or the span-resize interaction needs a
different affordance below ~22px. **This is the single hardest part of the whole idea and it is
why phase 3 is last.** It is also an argument for phase 2 first: with spans, the resize hotspot can
live on the span's rendered end-cap — a real target with its own size — rather than on an invisible
5px strip inside a cell.

## What is lost, stated honestly

Every frame is currently individually visible and clickable, and the `—` marks make a hold run
countable at a glance. Spans trade per-frame legibility *within* a run for density across the
project. The 5-frame ticks recover the counting; nothing recovers per-frame clickability inside a
run except the zoom.

## Non-goals

- Changing what any timeline gesture *does*. This is appearance and hit-testing geometry only.
- The audio lane and reference-layer clips, which already draw as spans and are the target style.
- Flash's 5-frame alternating band **and** ticks together, if one suffices — pick after phase 1.
- Per-file clip tinting (compositor's `clipColor.ts`); the shared doc explicitly warns against
  copying that into an app where clips are mostly one kind of thing.

## Testing

Phases 1 and 3 are CSS/constant changes with no node-testable surface; they are browser-verified.
Phase 2 adds `computeTimelineSpans` with unit tests: a lone key, a key plus holds, a blank key
ending a run, a run continuing past the stored track length (the existing glyph function has a
documented rule here), back-to-back keys, and an empty track. The existing 8 glyph tests and the
timeline-grid/-block/-selection suites must stay green throughout, since the model is unchanged.

## Open questions for you

1. **Ticks, bands, or both** for the 5-frame markers — decide by eye after phase 1.
2. **Zoom range and default.** Flash's default is ~12px; ours is 24. Suggest 12–32 with 24 as the
   default so nothing changes until you move it.
3. **Does the hollow end-cap earn its place**, or is the span's right edge enough on its own?
4. **Do you want phase 3 at all**, given the `EDGE_PX` constraint? Phases 1 and 2 deliver the Flash
   *look* without touching the interaction thresholds at all.
