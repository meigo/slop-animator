# Reference layer visibility ranges — design

**Date:** 2026-08-15
**Status:** Implemented (2026-08-15)
**Builds on:** video-ref clip drag (`2026-08-14-video-ref-clip-drag-design.md`), timeline iPad
pointer rule (`2026-08-14-timeline-ipad-ux-design.md`), reference media persistence
(`2026-08-08-reference-media-persistence-design.md`).

## Goal

A reference layer draws only over a span of project frames, and that span is the clip block you
see and drag on its timeline row. Image references get a block for the first time; the video
block stops lying.

## The problem this fixes

Reported as "the image ref layer is the only one without a visible clip — should we add options,
maybe make it trimmable?" Investigation reframed it: the missing block is a symptom, not the
defect.

**Reference layers have no notion of a frame range at all.** `buildFrameDrawList`
(`src/anim/document.ts`) pushes a `ref` op for *every* frame unconditionally — there is no
per-frame gating for references anywhere in the app. Two consequences:

1. An image ref draws on every frame. A clip block for it would span the whole timeline, always,
   and convey nothing — which is exactly why it renders as a bare type label today.
2. **The video clip block already misrepresents behaviour.** It looks like a trim range, but
   outside it the video does not disappear: `syncReferenceVideos` clamps with
   `Math.max(0, Math.min(dur, wanted))`, so the element holds its first or last frame across
   those project frames. Drag a video clip to start at frame 20 and frames 0–19 show its frozen
   first frame rather than nothing.

So all three row types lack a range, and the video block is a positioning aid dressed as a trim
control. Adding a block to the image row without adding the concept would add a third
misleading rectangle.

## Requirements (user-confirmed)

1. **The clip is a visibility range.** A ref draws only inside its span; outside it, nothing.
   This is what gives an image block meaning and what makes the video block honest.
2. **One span, not two.** A video ref's range **is** its footage span — no separate
   place-in-project vs in-point-of-source model. Explicitly chosen over a two-span design, and
   the loss of the frozen-last-frame hold was accepted with it (see Migration).
3. **An untrimmed image means "always".** No stored range = visible for the whole project,
   however the project's length later changes. Trimming an edge converts it to a concrete span.
   Chosen so old projects and new imports render identically, and so lengthening the animation
   cannot silently strand an image ref at the old last frame.
4. **Trim and slide are undoable.** A deliberate divergence from the existing video clip drag —
   see Undo below.
5. **Strict visibility.** A ref outside its range is simply not drawn, in the editor as well as
   in export. No low-opacity editor ghost.

## Non-goals

Source in/out trimming (rejected with requirement 2); per-range opacity or fades; multiple
ranges per layer; filmstrip thumbnails; edge-trim on **video** clips (its span is its footage —
only the body slides, as today); making `offsetFrames` meaningful for images; ranges for drawing
layers (they already have per-frame cells); animating or keyframing a range.

## Model

`src/anim/document.ts`:

```ts
export interface ReferenceLayer {
  // …existing fields…
  /** Inclusive project-frame span this ref draws over. ABSENT = always visible (follows the
   *  project's length). Images only — a video's span is derived from its footage. */
  range?: { start: number; end: number };
}
```

The asymmetry — images store a range, videos derive one — is the design, not an oversight. A
ref's span is its footage; a still has no footage, so the artist supplies one.

### Resolver (pure, unit-tested)

```ts
/** The project-frame span a ref draws over, or null for "always". */
export function refVisibleSpan(
  layer: ReferenceLayer,
  fps: number,
): { start: number; end: number } | null;

export function isRefVisibleAtFrame(layer: ReferenceLayer, frame: number, fps: number): boolean;
```

Resolution order:

| media | span |
|---|---|
| `video`, finite `duration > 0` | derived via `videoClipLayout(offsetFrames, speed, duration, fps)` → `start = startFrame`, `end = startFrame + spanFrames - 1` |
| `video`, duration unknown / not yet loaded | `null` (always) — metadata is lazy (`preload="metadata"`), so a not-yet-loaded video must not blink out |
| `image` | `layer.range ?? null` |
| `missing` | `null` — nothing to draw either way; the row shows its re-link call to action |

`refVisibleSpan` deliberately ignores `layer.range` for videos rather than erroring: a range
written while the layer was an image survives a re-link to a video harmlessly, and re-linking
back restores it.

An *empty* derived span is unreachable, and deliberately so: the `dur <= 0` guard returns "always"
before anything is derived, and `videoClipLayout`'s `Math.ceil` of any positive duration is at
least 1. A sub-frame video therefore spans exactly one frame rather than none.

## Render gate

`buildFrameDrawList` skips the ref op when the frame is outside the span:

```ts
} else {
  if (!includeReference) continue;
  if (!isRefVisibleAtFrame(layer, frame, project.fps)) continue;
  ops.push({ kind: "ref", layerId: layer.id, opacity: layer.opacity });
}
```

`buildFrameDrawList` has exactly one production consumer (`render.ts:197`), so this single site
covers the editor, export and onion skins. No sweep, and no second code path that could drift.

## Video element sync

`syncReferenceVideos` (`src/anim/reference.ts`) skips a video whose current frame is outside its
span, and pauses it if it was playing. The `Math.max(0, Math.min(dur, wanted))` clamp is what
manufactured the frozen frame; with the gate above, out-of-span frames never composite, so the
clamp stops being reachable rather than being special-cased.

Skipping (rather than seeking to the boundary) also avoids waking the decoder for a frame that
will not be drawn — the same reasoning that made scrubbing over a video ref cheap in the
`persistTick` split.

## Timeline UI

Image ref rows render a clip block using the `media-clip` tokens introduced for the audio/video
clips, in two visual states:

- **Untrimmed ("always")** — a block spanning the whole project (`0..frameCount-1`) with a
  **dashed** border and the default cursor. It must not read as a block someone happened to drag
  to full width; it spans everything by definition, and its edges are not meaningful positions.
  It deliberately does NOT span the full `stripFrames` width: the strip is wider only when a
  neighbouring row's video clip hangs past the last frame, which is a shared-strip layout
  artifact rather than a fact about this image — and rendering to it would claim visibility over
  frames that do not exist. The rendered end mirrors what an edge drag materialises, so display
  and materialisation cannot drift apart (amended during implementation, 2026-08-15).
- **Trimmed** — a concrete block, solid border, body drags to slide, **edge handles trim**.

Video blocks keep their current geometry and body-slide gesture, now truthful. They are **not**
edge-trimmable.

### Interaction

| gesture | image (always) | image (trimmed) | video |
|---|---|---|---|
| body drag | — (nothing to slide; it spans everything) | slides the span | slides `offsetFrames` (unchanged) |
| edge drag | trims that edge, converting to a concrete span | trims that edge | — |

An untrimmed block therefore shows its edge handles (that is how you trim it) but keeps the
default cursor on its body. Trimming is the only way "always" becomes concrete; there is no
separate mode switch.

Trimming clamps to a minimum of 1 frame; a range may extend past the last frame (the row strip
already sizes to `timelineStripFrames` for exactly this).

Per the project's hard-won drag rules, the new edge handles need `touch-action: none`
(gotcha #10), a bound `pointercancel` (the 2026-08-15 pinch-cancel finding), and the timeline's
finger-pans / pen-edits routing (`2026-08-14-timeline-ipad-ux-design.md`).

## Undo

Trim and slide push one undo entry per completed gesture, via the existing
`beginStructuralEdit` / `commitStructuralEdit` bracket and `transformDragGuard.settle`
registration that hold-span resize already uses — so a mid-gesture ⌘Z settles cleanly instead of
undoing the previous command. A no-op drag commits nothing.

**This diverges from the existing video clip drag and the audio clip drag, which are deliberately
not undoable** (they inherited that from the numeric offset fields they replaced). The divergence
is intentional and worth the inconsistency: those drags move where a reference *sits*, while a
range change alters **what renders** — a mis-drag silently blanks frames, and blanked frames are
exactly the kind of loss undo exists for. Left open: whether the video/audio clip slide should
later join this bracket for consistency. Not in scope here.

Two snapshot sites need `range`, and the reason is the in-place-mutation family from gotcha #8.
`cloneLayers` shallow-clones each layer and **deep-copies `transform`** precisely so a later
in-place field write cannot corrupt an in-flight snapshot; `range` is the same kind of nested
object and joins it (`range: l.range ? { ...l.range } : undefined` on the ref branch). The drag
must also **replace** `layer.range` with a new object rather than writing `layer.range.start`,
matching the cell-replacement discipline.

`restoreStructure` needs an explicit `range` copy. Its live-layer path deliberately keeps the
existing layer object and copies only `groupId`, `cells` and `transform` from the snapshot —
everything else (visible/opacity/locked/name) is a view-prop kept live on purpose. `range` is
structural, not a view-prop, so it must join the `transform` line, the same way ref transform
restore was added on 2026-08-09. Without that, an undo would restore the layer but leave the
range where the drag left it.

## Persistence

An optional `range` on the ref JSON, exactly like `speed?` / `audioEnabled?`. **Format version
stays 1** — an old file has no `range`, loads as "always", and renders identically.

## Migration / behaviour change

**A video shorter than the animation stops holding its last frame.** Today those trailing frames
show the frozen final frame; after this change they render empty. This is the accepted cost of
the one-span model (requirement 2) and is the only way an existing project's output changes.

It must be called out in `README.md` and `CLAUDE.md`, because it is silent: the project opens
fine and simply renders differently past the clip.

## Testing

Pure and node-testable, so unit-tested: `refVisibleSpan` (all four media cases, the
unknown-duration guard, the empty-span case, and that a video ignores a stored `range`),
`isRefVisibleAtFrame` (inside / on both boundaries / outside / always), and the trim-clamp
helper (minimum 1 frame, past-the-end allowed).

The timeline block, handles and drag lifecycle are Svelte/DOM with no node harness — build +
review verified, per project convention, and owed a browser pass.

## Owed a browser pass

Image ref shows a dashed full-strip block; trimming it converts to a solid block and the image
disappears outside the span while scrubbing; slide and both edge trims; trim → undo → redo;
⌘Z mid-drag; a range dragged past the last frame; a short video now going blank past its footage
instead of holding; a not-yet-loaded video not blinking out on first paint; export honouring the
range; onion skins honouring it; save → reload preserving a trimmed range; an old project opening
unchanged; iPad for the handles (touch-action, pointercancel, finger-pan vs pen-edit).
