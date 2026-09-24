# Outline from layer alpha — design

**Date:** 2026-09-24
**Status:** approved design, not yet implemented
**Requested as:** *"Outline based on layer alpha. For example you draw a solid text with brush and
you can turn it to outlined text with specific tool. The line could be adjustable - thickness,
randomness etc"*

## What it is

A tool that turns the current drawing's solid shapes into outlines: the silhouette's edge survives
as a line of adjustable thickness, everything further inside is erased. Solid brush-drawn text
becomes outlined text at the same size.

The line is not mechanical. Two noise-driven knobs vary it: **Wobble** moves the line in and out
across the true edge, **Variation** swells and thins it. Both were chosen by the user over the two
alternatives offered (gaps in the line, grainy edges), which are out of scope here.

## Decisions taken, and what they rule out

Four choices were made during brainstorming. Each closed off a direction worth recording, because
each is a reasonable thing to want later.

1. **Destructive, with a live preview** — the tool previews while you tune, then Apply bakes one
   undo step. Rejected: a live per-layer effect like line boil (applies to every frame, adjustable
   forever, but it would have to run in the 2D path, the WebGL boil path, onion skins, video/GIF/PSD
   export and persistence — a cross-cutting change), and a plain one-shot with no preview (simplest,
   but tuning two noise knobs blind is guesswork).
2. **Hollow it, line inside the edge** — the silhouette keeps the size you drew. Rejected: centred
   on the edge (grows the shape by half the thickness) and keyline (keeps the fill, adds a contour
   outside) — a different effect, not what was asked for. True only at Wobble 0: the signed field
   (decision 4) deliberately lets the band sit up to `WOBBLE_MAX` outside the original edge, since
   that outward reach is the whole point of Wobble.
3. **Wobble + Variation**, no gaps, no grain.
4. **Distance field + noise-modulated band**, over two alternatives:
   - *Morphology reusing `mask-ops`* (`mask minus erodeMask`): smallest possible version, built from
     tested code, but `erodeMask` is O(pixels × r²) and unseparated — the reason Fill's gap is capped
     at `MAX_GAP = 8` — and a single erode cannot vary its radius per pixel, so Variation would need
     several erodes blended by noise and Wobble cannot be expressed at all.
   - *Trace contours and stroke them with the app's own brush*: the most drawn-looking result, and it
     would build the marching-squares tracer the deferred "Layer to selection" roadmap item needs.
     Rejected for now as several times the code, with failure modes — self-intersection on thin
     features, dropped small detail — that land precisely on text. Revisit as a second mode once the
     tool exists and the look can be judged.

## The core operation

`src/core/outline.ts`, pure and node-testable:

```ts
export interface OutlineOptions {
  /** Band width in device px. Clamped to 0..24 by the function itself, because a `NumberField`
   *  writes `null` when emptied (see `clampGap` in `fill-holes.ts` for the same guard); 0 is a
   *  legal input and yields an empty result rather than a division or a runaway loop. */
  thickness: number;
  /** 0..1 — how far the line wanders across the true edge. */
  wobble: number;
  /** 0..1 — how much the width swells and thins. */
  variation: number;
  /** Any integer. The same seed and options give byte-identical output. */
  seed: number;
}

export function outlineMask(
  alpha: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  opts: OutlineOptions,
): Uint8ClampedArray;
```

It takes an alpha plane and returns alpha coverage. **The caller keeps the RGB**, so coloured art
keeps its colour and only the alpha changes. Plain arrays rather than `ImageData`, because Vitest
runs in node with no DOM — this is the whole reason the interesting logic sits behind this signature.

### 1. Signed distance field, sub-pixel at the boundary

`d(x, y)` is the distance to the shape's edge, **positive inside, negative outside**, by two-pass
chamfer (orthogonal step 1, diagonal √2 — about 4% error, under 1px at the maximum thickness).

Signed, not inside-only, and this is the detail that makes Wobble real: with an inside-only field
the band can never cross outside the silhouette, so an outward wobble gets clipped, and what is left
is one-sided — indistinguishable from Variation. The user asked for both knobs; they have to be two
different things.

Seeding is sub-pixel: a boundary pixel starts at `alpha/255 - 0.5` rather than at 0, so the field
carries the anti-aliasing the brush produced. Every downstream edge is then reconstructed from `d`
alone, with no special case for "inherit the source's alpha", and outlined text stays as crisp as
it was drawn.

Off-canvas counts as **outside**, matching `erodeMask`'s documented convention, so a shape running
off the edge of the canvas is outlined along that edge.

### 2. Noise fields

One seeded 2D value-noise function with smoothstep interpolation, sampled at two lattice offsets
(`seed` and `seed ^ 0x9E3779B9`) to give two independent fields in [-1, 1]:

- `nWobble(x, y)` — where the band sits.
- `nWidth(x, y)` — how wide it is.

Feature size is a constant ~24 device px, not exposed. It is what makes the variation read as hand
movement rather than as static, and a third dial for it would earn less than it costs.

### 3. The band

```
offset = WOBBLE_MAX * wobble * nWobble(x, y)          // WOBBLE_MAX = 3px
width  = max(MIN_WIDTH, thickness * (1 + VARIATION_MAX * variation * nWidth(x, y)))
                                                       // VARIATION_MAX = 0.6, MIN_WIDTH = 0.75px
coverage = clamp(min(d - offset, offset + width - d) + 0.5, 0, 1)
out      = round(coverage * 255)
```

`MIN_WIDTH` just under 1px is deliberate: the line must never break, because gaps were explicitly
not asked for. The `+ 0.5` centres a one-pixel anti-aliasing ramp on each side of the band.

### Behaviour that follows, and is tested rather than guarded against

- **A shape thinner than the thickness stays solid.** All of it is within the band. A hairline
  cannot be hollowed, and pretending otherwise would erase it.
- **With `wobble = variation = 0` the result is exactly `mask minus erodeMask(mask, thickness)`**,
  up to anti-aliasing. This is the cross-check against existing tested code.
- **Holes and counters outline too** (the inside of an 'o'), because the field is signed and the
  edge is an edge either way.

### Cost, and why the preview stays responsive

The field and the noise **do not depend on any knob except the seed**. Compute them once on entry
and once per re-roll; a knob change then costs one comparison pass over the bitmap. At 1280×720 that
is ~920k pixels of compare-and-ramp per preview, against four chamfer sweeps plus two noise
evaluations per pixel for the one-off. Budget: the one-off is the part to measure on iPad; if it is
too slow there, the fallback is to compute the field at half resolution and sample it bilinearly,
which costs a quarter of the work and blurs detail below 2px.

## The tool

**Entry.** A new `"outline"` member of `Tool` and a toolbar button. Selecting the tool snapshots the
active layer's key cell at the playhead (`getImageData`) and previews immediately at the current
settings. It refuses on a locked or hidden layer through the existing `whyNotEditable`, like every
other lift.

**The preview writes into the cell, not the overlay.** Each change re-derives it from the snapshot:
put the snapshot back, run `outlineMask`, write the result, recomposite — the idiom the smooth brush
already uses to redraw from its pre-stroke snapshot. Two reasons over Pose's overlay lift:

- It is what you will get: layer opacity, the layer/group transform, line boil and onion skins all
  apply, because the real compositor draws it.
- Killed mid-tune, the cell holds an outline — a plausible drawing. Pose's lift clears the cell and
  paints the overlay, so the same interruption leaves an empty one.

Recomputes coalesce to one animation frame (gotcha #17), so scrubbing the thickness field does not
run a pass per pointer event.

**The bar** is the standard on-canvas bar (`.ui-bar` / `.ui-bar-btn`, 2026-09-24), anchored to the
drawing's content bounds with the same `computeAnchor` the pose bar uses. The anchoring currently
inside `positionPoseBar` moves into one small helper both bars call — a third copy is how the two
bars drifted in the first place. Controls: **Thickness** (scrubbable `NumberField`), **Wobble** and
**Variation** as 0–100% fields, a **re-roll** button for the seed, then ✓ and ✗.

**Apply** bakes through `pixelCommand` with before/after `ImageData`, exactly as `applyPose` does,
including materialising a keyframe when the tool is used on a hold, so one undo takes back both the
pixels and the keyframe. **Cancel** puts the snapshot back.

**Leaving cancels, it does not bank.** Pose and Deform bank an in-progress edit on a layer or frame
switch; this tool cancels. Entering it already rewrites every pixel, so banking would mean a stray
tap on the tool button plus a frame step silently outlines a drawing. Re-entering costs nothing (the
knob values persist), so cancelling is the cheap direction. This is a deliberate divergence from the
two neighbouring tools and should be revisited if it annoys in use.

It registers with `liftGuard` like the other lifts, so undo, resize and project load restore the
snapshot rather than leaving a preview baked.

## Testing

**Unit** (node, on `outlineMask`):

- Equals `mask minus erodeMask(mask, thickness)` when wobble and variation are 0.
- A solid rectangle gives a ring of exactly the requested thickness, silhouette bbox unchanged,
  interior cleared.
- A shape thinner than the thickness stays solid.
- A ring (a shape with a hole) is outlined on both its outer and inner edges.
- Same seed → byte-identical output; a different seed → different output.
- Wobble is bounded: no pixel of the result lies further than `WOBBLE_MAX` from the reference band.
- Anti-aliasing: a partially transparent source edge yields a partially transparent outer edge,
  not a hard one.
- Empty input → empty output. Thickness 0 → empty output.

**Browser:** each knob updates the preview; Apply is one undo step; Cancel restores; a frame or
layer switch cancels; a locked layer refuses; the bar anchors to the ink and flips above/below.

**iPad:** owed, and unverifiable from the agent side — the knobs are `NumberField`s (gotcha #16) in a
bar inside the stage (gotchas #12 and #18).

## Out of scope, recorded so it is a decision rather than an omission

- **Clipping to a selection.** The tool acts on the whole drawing. The selection machinery could
  clip it later; nothing here forecloses that.
- **Apply to all frames.** One drawing at a time, like Pose. An "apply to every key cell in this
  layer" button is additive later.
- **Gaps and grain**, the two randomness kinds not chosen.
- **A live, non-destructive mode** — see decision 1.
- **The brush-stroked variant** (approach C) as a second mode, which would also build the contour
  tracer the deferred "Layer to selection" roadmap item needs.
