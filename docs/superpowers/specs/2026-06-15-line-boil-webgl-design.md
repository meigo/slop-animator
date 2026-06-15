# Line Boil — WebGL Renderer Design

**Status:** Approved (design phase)
**Date:** 2026-06-15
**Supersedes:** the variant-cache (Phase 2) and alpha dilate/erode (Phase 3) sections of
`2026-06-15-line-boil-design.md`. Phase 1 (config model, holds-only, settings UI — already
shipped) stays as-is. This document replaces the *renderer* for Phases 2–3.

## Goal

Render line boil with a **WebGL displacement pass** instead of the CPU mesh warp: every drawing
layer's outlines wobble (and breathe in weight) live during playback and export, fast enough for
≥6 fps on an iPad Pro, **memory-flat regardless of frame count**, and consistent across browsers/GPUs.

## Background — the spike proved it

The `boil-webgl-spike` branch validated the approach on macOS (Chrome + Safari) and iPad (Safari +
Chrome): a fragment-shader noise displacement, with **all drawing layers composited inside one GL
surface and read back exactly once per frame**, runs live with no skipping and no per-frame CPU
work or caching. The two gotchas it surfaced and fixed:
- **Per-layer `drawImage` from a WebGL canvas is unreliable** (stale/empty after the first read on
  some browsers) → composite everything in one GL surface, blit once.
- **The GLSL noise collapses** when fed large coordinates or `mediump` → use `highp` and map the
  seed to a **small bounded offset on the CPU** (float64) before passing it to the shader.

The spike lacks: line-weight (the `wt` slider is ignored), export, reference-layer z-ordering,
context-loss handling, and cleanup (the dead CPU warp, SPIKE scaffolding, `scale`→`weight` rename).
This spec productionizes it.

## Decisions (locked / recommended)

1. **One GL surface, one blit per frame.** All drawing layers accumulate (premultiplied,
   z-ordered, each displaced) into a single offscreen WebGL canvas; the 2D compositor blits it once.
2. **Cross-GPU-stable noise:** `precision highp float`; seed → small bounded offset computed on the
   CPU (the validated fix).
3. **Weight = in-shader line dilate/erode** (replaces the prototype uniform scale). Config field
   `scale` is renamed `weight`.
4. **`grid` → `detail`** in the UI (it's noise frequency now). The config field can keep the name
   `cols` internally or rename to `detail`; the *spec* uses `detail`.
5. **Reference layers composite below the boiled drawing stack** (the rotoscope case) for v1.
   Proper interleaving of references *between* drawing layers is out of scope (noted below).
6. **Export includes boil**, deterministic by frame so it matches the preview.
7. **The CPU mesh warp (`src/core/boil.ts`) is deleted** — WebGL replaces it.

---

## Architecture

### `src/core/boil-gl.ts` (productionized from the spike)

A module-singleton WebGL surface + program. Public API (frame-scoped, the validated shape):

- `boilBegin(w, h): boolean` — lazy-init / resize / clear the GL surface; returns false if WebGL
  is unavailable (caller falls back to plain compositing).
- `boilLayer(src, opacity, amount, detail, weight, seed)` — composite one drawing layer into the
  surface: upload `src` as a (premultiplied) texture, displace by `amount` px using noise at
  frequency `detail` offset by the (CPU-reduced) `seed`, apply the `weight` line dilate/erode, blend
  premultiplied "over" at `opacity`.
- `boilBlit(dstCtx)` — `drawImage` the surface onto the 2D composite once.
- `resetBoilGL()` — drop the GL state (used on context loss).

**Shader.** `precision highp float`. Displacement: a 1–2 octave value-noise offset (the spike's
`vnoise`), windowed to 0 at the borders so the canvas edge can't gap. **Weight:** a small
neighbourhood **min/max on the sampled alpha** (a few taps) — dilate (fatten) or erode (thin) by a
sub-pixel radius whose sign/magnitude comes from `weight` and a per-frame jitter, giving the
line-weight "breathing." Output is premultiplied × `opacity`.

**Seed.** Caller passes `seed = (frame % rate) * 100003 + layerId * 9176`; `boilLayer` maps it to a
small bounded `uSeed` on the CPU (float64) before uploading — the cross-GPU fix.

**Context loss.** On the GL canvas, listen for `webglcontextlost` (call `preventDefault`) and
`webglcontextrestored` (`resetBoilGL()` so the next `boilBegin` re-inits). A lost context mid-frame
makes `boilBegin` return false → that frame composites un-boiled rather than throwing.

### `src/anim/render.ts` — `compositeFrameLayers`

When `boil` is present and `boilBegin(w,h)` succeeds:
1. Draw reference layers in 2D (below the stack).
2. For each drawing-layer op in z-order, `boilLayer(cell.canvas, opacity, crisp ? 0 : amount*strength, detail, crisp ? 0 : weight*strength, seed)` where `crisp = isCrispFrame(cells, frame, holdsOnly) || strength<=0 || amount<=0` (a crisp layer still composites through GL with 0 displacement/weight, preserving z-order).
3. `boilBlit(ctx)` once; return.
Otherwise (no boil, or WebGL unavailable) → the existing per-op 2D path (drawImage).

### Export

`src/export/*` already render each frame via `renderFrame` to a 2D canvas. Pass `project.boil`
(when enabled) into the export render so the GL path runs during export — it works on the main
thread where WebGL is available, and is deterministic (seed by frame), so exported video/PNG matches
playback. Export still excludes reference layers (`includeReference: false`) as today.

---

## Data model & persistence

- **Rename `BoilConfig.scale` → `weight`** (px line dilate/erode, default tuned during the spike —
  start ~0.5). Optionally rename `cols` → `detail`; either way the UI label is "detail".
- **Migration:** on load, `weight = json.boil.weight ?? json.boil.scale ?? default` (boil shipped
  only recently, so few saves carry the old `scale`; this keeps them valid). `defaultBoilConfig()`
  emits `weight`.
- `DrawingLayer.boilStrength` is unchanged.

## UI

The settings popover stays. Relabel **grid → detail** and **wt → weight**; the **weight** slider now
visibly fattens/thins lines. amt / detail / rate / holds-only / enabled keep their behaviour. Add
the **per-layer strength** control (still pending from the original Phase 2) as a compact slider in
the layer row.

## Testing

- **Pure:** the seed→bounded-offset mapping is deterministic and bounded (unit-test it directly so a
  regression can't reintroduce the noise collapse). `isCrispFrame` already tested. Config
  persistence round-trip incl. `weight` + the `scale`→`weight` migration.
- **Manual (browser + iPad):** boil renders on all drawing layers in z-order; warp varies each frame
  with no obvious repeat; weight visibly breathes; holds-only keeps keyframes crisp; export output
  matches playback; resize/undo still composite; context-loss (simulate via the lose-context
  extension) recovers.

## Phasing → implementation plan

One plan (the spike is the starting point on `boil-webgl-spike`):
1. Productionize `boil-gl.ts`: clean up the SPIKE scaffolding, add **weight** (shader dilate/erode),
   add **context-loss** handling + `resetBoilGL`; extract & unit-test the seed→offset mapping.
2. Config: rename `scale`→`weight` (+ `cols`→`detail` if chosen), `defaultBoilConfig`, persistence
   migration, UI relabel + wire weight.
3. Export: thread `project.boil` into the export render path.
4. Per-layer strength UI (the layer-row control).
5. Delete the dead CPU warp `src/core/boil.ts`; final cross-browser/iPad manual pass.

## Out of scope (future)

- Reference layers interleaved *between* drawing layers (v1 = references below the boiled stack).
- A full-GL composite (bg + references + drawing layers all in the GL surface) — only needed if the
  reference-interleave case becomes important.
- Texture-upload caching (skip re-uploading an unchanged keyframe) — an optimization; the per-frame
  upload is already fast enough.
- Multi-octave / art-directed noise beyond the 1–2 octave value noise.
