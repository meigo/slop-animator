# Loop keys (Moho-style cycles) — design

**Status:** draft for review · **Date:** 2026-09-10 · **Branch:** `feat/loop-keys` (off
`feat/onion-respects-play-range`, which also touches `onion.ts` and `Canvas.svelte`'s recomposite)

## The ask

> "it could be great to have a real looping feature. In moho it's a specific key type that can jump
> back and loop from specific frame or relative backwards offset. Last one could be probably more
> flexible here. And some other type of key afterwards would end the loop. In moho it's visually
> represented as a red line with arrow head going back from loop key to the first frame of loop."

> "ghost of loop step could be displayed on track to easily determine later where the loop ends"

## Decisions (settled in brainstorming)

| Question | Answer |
|---|---|
| What repeats? | **Drawings only.** Transform/opacity tracks play straight through. |
| How is the target set? | **Relative offset**: "jump back N frames". Survives moving the loop. No absolute mode. |
| What ends a loop? | **The next key** (any `key` cell, inked or blank, or another loop). |
| Drawing on a repeated frame? | **Creates a key there** (a copy of what is on screen), which ends the loop at that frame. Undo restores it. |
| Where does the loop live? | **A new cell kind** (approach A), so every cell splice carries it. Layer-level markers (approach B) were rejected: ~15 cell-moving ops would each need marker-shifting code, and every miss is a silent drift. Baking repeats into real cells was rejected: no live, adjustable loop, and duplicated PNGs. |

## 1. Model

```ts
type Cell =
  | { kind: "key"; canvas; transform?; transformBox? }
  | { kind: "hold" }
  | { kind: "loop"; back: number }; // NEW. 1 <= back <= its own frame index
```

A `loop` cell at frame **L** means: *from L on, replay frames `[L−back, L−1]`*. Its **region** is L
plus the holds after it, and ends at the next non-hold cell (a key, blank key included, or another
loop). A trailing region runs to the document end, like a trailing hold.

- A loop may only be **placed** on a hold or past the layer's end, never on a key (that would
  discard a drawing). Frame 0 cannot hold a loop (nothing before it to repeat).
- A loop whose cycle precedes every key shows nothing, like a hold before the first key does.

### The display remap

One pure function in `src/anim/document.ts`:

```
displayFrame(cells, f):
  i = nearest index <= min(f, cells.length − 1) whose cell is not a hold   (none → return f)
  if cells[i] is a loop at L:
      return displayFrame(cells, L − back + ((f − L) mod back))
  return f
```

The recursion always lands strictly before L, so it terminates. A cycle that contains another
loop's region resolves through it, so nesting needs no special case.

`resolveDisplayKey(cells, f) = resolveKeyframeIndex(cells, displayFrame(cells, f))` answers
**"which drawing is on screen at f"**, with a `resolvedDisplayKeyCell(layer, f)` companion to the
existing `resolvedKeyCell`. `resolveKeyframeIndex` itself is unchanged and stays the raw, structural
answer (it already skips anything that is not `kind === "key"`).

Example: drawing on 2s with keys at 0/2/4/6, loop at 8 with `back = 8`. Frames 8–15 show 0–7,
16–23 show 0–7 again, and so on until the next key.

### Two kinds of reader

Every current `resolveKeyframeIndex`/`resolvedKeyCell` call site (≈40, in `document.ts`,
`onion.ts`, `timeline-block.ts`, `timeline.ts`, `psd-frame.ts`, `Canvas.svelte`,
`LayerBoundsHint.svelte`, `LayerList.svelte`, `RefTransformGizmo.svelte`, `Timeline.svelte`,
`cell-ink.ts`, `timeline-glyphs.ts`, `timeline-grid.ts`, `appState.svelte.ts`) and every direct
`kind` check (≈34 in 10 files) is classified as one of:

- **Display readers → go through the remap.** Render (2D and boil paths), onion, video export, PSD
  export, eyedropper, `contentBounds`/ink caches, layer thumbnails, the bounds hint, merge-down, the
  transform gizmo's Frame scope, and boil's holds-only **crisp** check (`isCrispFrame` asks whether
  the *remapped* frame is a key, so a key drawing is crisp on every pass, not only the first). Boil
  noise stays keyed to real time, so repeats keep boiling rather than replaying identical noise.
- **Structural readers → raw cells.** Timeline hit-testing, span resize, key move, `holdSpanEnd`
  (which already stops at any non-hold, so a key's span ends at a loop), splice ops.

The implementation plan carries the full per-site classification. A `kind === "hold"` or
`kind !== "key"` test that meets a loop cell is the main correctness risk, because TypeScript does
not flag it; each one gets looked at.

Property tracks are unaffected. A per-cell transform comes along with whichever key is resolved.

### Default `back`

When a loop is added at L: back to the start of the content run containing L−1, i.e. that span's
`startFrame` from `computeTimelineSpans`, so `back = L − startFrame`. On 1s or 2s this is "loop
everything since the last blank key", usually the cycle just drawn. If L−1 is not in a content
span (blank or empty), `back = 1`.

## 2. Timeline

```
frame   0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16
            ◀━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓                          red, 1px
track  [◆━━━━━━━◆━━━━━━━◆━━━━━━━◆━━━━━━━]↺ [◇·······◇·······◇·······◇···]◆━━━
       └──────── the cycle ───────────┘ │  └─ ghost repeats (faded) ──┘ │
                                      loop key                     next key ends it
```

- **Loop key mark.** A red lucide `Repeat` icon (12px) on frame L, in the diamond's slot.
  `computeTimelineGlyphs` emits a new glyph `"↺"` for a loop cell.
- **Arrow.** A 1px `--color-danger` line along the top edge of the drawing layer's track row, from
  frame L back to the left edge of frame `L − back`, ending in a small arrowhead. It uses the
  playhead's red, so it reads as "time jumps". It is drawn on that row only (not on property rows,
  other layers or group rows).
- **Ghost repeats.** Across the loop's region after L, the track draws what the remap shows at
  ~35% opacity: a faded span where the cycle shows ink, faded diamonds where the replayed frame is
  a key, faded hollow diamonds for replayed blank keys. Implemented as spans carrying
  `ghost: true` (a new field on `TimelineSpan`), derived from glyphs of the remapped frames.
  Ghosts are **not interactive**: pointer on a ghost seeks, like an empty frame. The solid span
  resumes at the key that ends the loop, so the loop's end is visible at a glance.

### Interactions

- **Loop button.** A lucide `Repeat` button in the timeline toolbar acts on the active drawing
  layer at the playhead:

  | Cell at the playhead | Button |
  |---|---|
  | hold, or past the layer's end | adds a loop with the default `back` |
  | loop | removes it (becomes a hold) |
  | key | disabled; tooltip "Loops go on a held frame — a key's drawing would be replaced" |
  | locked layer / reference layer / frame 0 | disabled |

  Each add/remove is one undo step.
- **Arrowhead drag** sets `back`: snaps to frame columns, clamps to `1…L`, and shows a red badge
  "↺ N" while dragging. One undo step per gesture, none for a no-move tap; `touch-action: none`;
  binds `pointercancel` (gotcha #10, and the settle-on-cancel rule from gotcha #6).
- **Moving a loop key** works like moving a key (`moveKeyframe` and `planCellPointer`'s "move"
  accept `loop` as well as `key`). `back` is unchanged, re-clamped to `1…newL`; a move to frame 0 is
  refused. **Resizing** a loop's trailing edge sets its region length exactly as a key's hold span
  (`setHoldSpan` accepts `loop` too).
- **Block move, copy, paste, frame insert/delete** carry loop cells because they splice cells.
- No keyboard shortcut in this phase (`L` is free if one is wanted later).

## 3. Editing, frame tools, onion

**Editing on a repeat frame** (any frame in a loop's region, the loop frame included):

- Draw, erase, fill, paste and the selection/deform/pose lifts all go through
  `ensureDrawableKeyframe`, which on a repeat frame materialises a key **cloned from
  `resolveDisplayKey`** (with its transform). That key ends the loop there. The cell change rides
  in the stroke's undo entry, as today.
- On the loop frame itself this replaces the loop cell, so the loop is removed entirely (zero
  repeats, the new key then holds). Undo restores it.
- Eyedropper reads the displayed drawing.
- **Transform, Frame scope** on a repeat frame edits the **source** key's transform, the same thing
  Frame scope does on any hold: every frame showing that drawing moves together. It does not create
  a key.

**Frame tools on a repeat frame:**

| Tool | Behaviour |
|---|---|
| Insert keyframe (F6) / Duplicate | clones the displayed drawing into a new key after the frame |
| Clear frame | no-op if the frame shows nothing (`clearFrameIsNoOp` checks the displayed key); otherwise materialises a blank key (ends the loop into blank) |
| Set hold on the loop key | removes the loop |
| Insert hold / Delete frame in the region | makes the region one frame longer / shorter |

**Structural edits inside a cycle adjust `back`.** After cells are inserted or removed, a loop
whose cycle `[L−back, L−1]` the edit fell inside gets `back` changed to the cycle's new length
(floor 1), so the arrow keeps pointing at the same drawing. Precisely, for a loop originally at L
with cycle start `s = L − back`:

- **insert k cells at index `at`:** if `s < at <= L`, then `back += k`. (Inserting at `s` puts the
  new frames before the cycle; inserting at L puts them at its end, inside.)
- **delete cells `[at, at+k)`** where the loop itself survives (`L >= at + k`): `back −=` the size
  of the overlap of `[at, at+k)` with `[s, L)`, floored at 1.

This mirrors the existing rule for reference/play-range spans (`shiftSpan`: a span that straddles
an edit grows or shrinks instead of moving). One helper, `rippleLoopBacks`, is called by every op
that inserts or removes cells: `addFrame`, `insertKeyframe`, `insertBlankKeyframe`, `deleteFrame`,
`insertFrameAllLayers`, `deleteFrameAllLayers`, `setHoldSpan`, `pasteBlockInsert`, `deleteBlock`.
Block move and key move only overwrite cells, so they don't call it. The cells it changes are
**replaced**, never mutated (gotcha #8).

**Onion skins.**

- Frame mode: the ghost of f±k shows `resolveDisplayKey`, so repeats ghost correctly.
- Keyframe mode: its key list becomes **frames where the displayed drawing changes** (identical to
  raw keys outside loops; inside a loop, the replayed keys), so you see the cycle's poses.
- Play-range bounds and the loop-seam wrap are untouched. The play range decides which frames
  play; loop keys decide which drawing each frame shows. They are independent.

## 4. Save, export, undo, copy/merge

**Save format** — version stays 1, additive like `cellTransforms`:

- `cells: ("key" | "hold" | "loop")[]`, plus an optional per-layer `loopBacks: { [frame]: back }`.
- Load: `"loop"` → `{ kind: "loop", back }`, `back` defaulting to 1 when absent and clamped to
  `1…i`. A loop at frame 0 loads as a hold.
- Autosave shares the serializer.
- A pre-loop build reads `"loop"` as a key with no PNG, i.e. a blank key: degraded, not a crash.
  The deployed app is always current, so this is accepted.

**Export.** Video (MP4/WebM) goes through render; PSD's `psd-frame.ts` switches to
`resolveDisplayKey`. Both show loops.

**Undo.** Add/remove, arrowhead drag and loop-key move are structural edits through the existing
`beginStructuralEdit`/`commitStructuralEdit` pair, replacing cells rather than mutating them.
`restoreStructure` already restores whole cell arrays.

**Copy / paste / merge.**

- `copyBlock`'s leading-cell materialisation resolves through the remap: a block starting on a
  repeat frame copies the displayed drawing as its first key.
- Loop cells inside a copied block stay loops. `back` is relative, so they keep their offset at the
  destination, re-clamped to `1…L`.
- `planMergeDown` plans from displayed keys, so merging a looping layer **bakes** the repeats into
  real keys. The layer below does not loop, so this is the only correct result.

## Testing

Pure logic, Vitest (node):

- `displayFrame` / `resolveDisplayKey`: basic cycle; trailing loop to the document end; frames
  past the stored track; region ended by a key, a blank key, a second loop; nested cycles; loop
  before any key; `back` equal to L.
- `rippleLoopBacks`: insert/delete before, inside, at `s`, at L, and after the cycle; multi-cell
  splices; floor at 1; loop deleted by the splice.
- Glyphs/spans: `"↺"` glyph; ghost spans and diamonds; blank keys replayed; the solid span resuming
  at the ending key.
- Editing ops on repeat frames: `ensureDrawableKeyframe` clones the displayed drawing and ends the
  loop; drawing on L removes the loop; `insertKeyframe`; `clearFrameIsNoOp`; `moveKeyframe` and
  `setHoldSpan` with loop cells; default `back`.
- Onion keyframe list inside a loop.
- `copyBlock` with a leading repeat frame; `planMergeDown` baking a loop.
- Save round trip via the serializer's encode/decode path, as far as it runs in node.

Owed after tests: a browser and iPad pass on the arrow, ghosts, arrowhead drag, Loop button,
editing on repeat frames, onion inside a loop, and an export containing a loop.

## Out of scope

Absolute "jump to frame X" mode; a fixed repeat count ("loop 3 times"); ping-pong; loops on
property tracks, groups or reference layers; a keyboard shortcut.

## Docs

README (Features bullet, test count), `docs/superpowers/CHANGELOG.md` entry, CLAUDE.md
current-state paragraph and test count — in the same change.
