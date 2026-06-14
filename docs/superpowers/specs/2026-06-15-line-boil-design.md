# Line Boil Design

**Status:** Approved (design phase)
**Date:** 2026-06-15

## Goal

Give held drawings a subtle hand-inked "boil" — the outlines wobble slightly frame-to-frame
during playback and export — so low-framerate holds don't read as dead-static. Configurable
per project, deterministic (so export matches playback), and cheap at playback.

## Background — what the prototype proved

The `boil-prototype` branch (live, unmerged) validated the look: a coarse deterministic
triangle-mesh warp of each drawing layer's keyframe, applied at composite time during
playback only, seeded by `(frame % rate, layerId)` so each layer boils on its own phase and
holds cycle `rate` warps. Tuned defaults the artist settled on: **amount 1px, grid 20 cols,
rate 3 ("on threes"), weight 0.5%**. It also added a uniform per-frame scale ("weight")
jitter and live value readouts.

The production version keeps that warp/seed model but: replaces the live per-frame warp with
**pre-baked variants** (smooth playback), replaces the uniform scale with **true line-weight
dilate/erode**, makes the config a **persisted per-project setting**, adds **holds-only** and
**per-layer strength**, and bakes boil into **export**.

## Decisions (locked)

1. **Holds-only by default.** A frame that is a layer's own keyframe (`cells[f].kind === "key"`)
   renders crisp; only held frames (a hold resolving to an earlier key) boil. Toggleable.
2. **Playback-scoped variant cache.** Variants are baked lazily during a play/export run and
   the whole cache is dropped on stop, on any document edit, or on a boil-config change. No
   cross-cutting per-keyframe invalidation hooks.
3. **Per-layer phase** via `layerId` in the seed; **rate cycling** via `frame % rate`.
4. **Weight** via baked **alpha dilate/erode** (true per-line thickening/thinning), replacing
   the prototype's uniform scale.
5. **Config persisted per-project** (in the project file); **per-layer strength** multiplier.

---

## Architecture

### Units

- `src/core/boil.ts` (exists, from prototype) — the pure warp + new weight bake.
  - `drawBoiled(...)` (exists) — the mesh displacement. Refactor so it can render to an
    offscreen canvas at full alpha (decoupled from layer opacity).
  - **New** `bakeBoilVariant(src, w, h, opts): HTMLCanvasElement` — produces one fully-baked
    variant: allocate an offscreen canvas, `drawBoiled` the displacement into it, then apply
    `dilateErodeAlpha` for weight. Deterministic from `opts.seed`.
  - **New** `dilateErodeAlpha(imageData, radiusPx)` — morphological dilate (`radiusPx > 0`,
    neighbourhood **max** of alpha → fatter lines) or erode (`radiusPx < 0`, **min** → thinner),
    with fractional radius blended toward identity. Operates on the alpha channel only; a 5×5
    disk neighbourhood covers the ≤1.5px range we need. Pure (takes/returns `ImageData`).
- `src/core/boil-cache.ts` (**new**) — `BoilCache` class: lazily bakes and stores `rate`
  variants per keyframe canvas.
  - `getVariant(src, residue, layerId, strength, config): HTMLCanvasElement` — returns the baked
    variant for `(src, residue)`, baking on miss; `layerId` feeds the seed (per-layer phase) and
    `strength` scales `amount`/`weight` for per-layer variance.
  - `clear()` — drop everything. Keyed by the keyframe `HTMLCanvasElement` (a `Map`/`WeakMap`),
    sub-keyed by `residue`. Re-bakes if the stored config hash differs.
- `src/anim/render.ts` (modify) — `compositeFrameLayers` takes an optional boil provider and
  selects crisp-vs-variant per frame.
- `src/lib/Canvas.svelte` (modify) — owns the `BoilCache`; clears it on playback stop / version
  change; passes a provider to the renderer during playback.

### Variant baking

Per keyframe canvas, bake `rate` variants (one per `residue ∈ [0, rate)`):

```
seed(residue, layerId) = residue * 100003 + layerId * 9176           // per-layer phase + cycle
variant = bakeBoilVariant(keyframeCanvas, w, h, {
  amount: config.amount * strength,    // displacement px
  cols:   config.cols,                 // grid resolution
  weight: config.weight * strength,    // dilate/erode px (signed by a hashed bit of seed)
  seed,
})
```

The variant is a full-alpha warped+weighted copy of the keyframe; the compositor blits it with
the layer's opacity (so opacity no longer interacts with the warp's seam-overlap — fixes the
prototype's `<100%`-opacity seam issue).

### Render integration

`compositeFrameLayers(ctx, project, frame, dpr, includeReference, boil?)` where
`boil = { config, getVariant(src, residue, strength) } | undefined`. For each drawing-layer op
at `frame`:

```
const cell = layer.cells[op.keyframeIndex];          // resolved key (kind === "key")
const ownKey = layer.cells[frame]?.kind === "key";   // is THIS frame the key's own frame?
if (!boil || (config.holdsOnly && ownKey)) {
  ctx.drawImage(cell.canvas, 0, 0);                  // crisp
} else {
  const residue = frame % Math.max(1, config.rate);
  ctx.drawImage(boil.getVariant(cell.canvas, residue, op.layerId, layer.boilStrength), 0, 0);
}
```

`boil.getVariant` is a closure over the `Canvas`-owned `BoilCache` (and the config); the seed
uses the passed `layerId`. The renderer itself stays free of global state.

### Cache lifecycle

`Canvas.svelte` holds one `BoilCache`. It is `clear()`-ed when:
- playback stops (`onPlayingChange(false)`),
- `state.version` changes (any edit — fires only while paused, so the cache is normally empty then),
- the boil config or any `layer.boilStrength` changes.

During a playback loop no edits occur, so the cache persists and the loop is smooth after the
first pass. Boil renders **only during playback** (paused/editing shows crisp frames), so a
dropped cache costs nothing until the next play.

### Determinism / export

Variant selection is `frame % rate` with a fixed per-`(residue, layerId)` seed, so playback and
export are pixel-identical and reproducible. Export builds its **own** `BoilCache` for the run,
reads `project.boil`, and bakes as it walks frames (`src/export/*` passes the provider into
`renderFrame`/`compositeFrameLayers`). Boil applies to drawing layers only; reference layers are
never boiled.

---

## Data model & persistence

- **`Project.boil: BoilConfig`** — moves out of UI state into the document model (saves with the
  project, like `fps`):
  ```ts
  interface BoilConfig {
    enabled: boolean;   // default false
    amount: number;     // displacement px,    default 1
    cols: number;       // grid columns,       default 20
    rate: number;       // cycle length,       default 3
    weight: number;     // dilate/erode px,    default 0.5
    holdsOnly: boolean; // default true
  }
  ```
- **`DrawingLayer.boilStrength: number`** — per-layer multiplier on `amount`/`weight`
  (default 1; 0 disables boil for that layer).
- **Persistence** (`src/persist/project-file.ts`): serialise `project.boil` and each drawing
  layer's `boilStrength`. On load, missing fields fall back to the defaults above
  (back-compatible with existing saves).

## UI

- **Timeline toolbar:** keep the **Waves toggle** (binds `project.boil.enabled`). Move the
  params behind a **cogwheel popover** next to it containing sliders with live value readouts:
  amount, grid, rate, weight, plus a **holds-only** checkbox. (Same popover pattern as the
  Playbar settings.)
- **Per-layer strength:** a small control in the layer row (a compact slider, like the existing
  opacity slider) bound to `layer.boilStrength`.
- All controls bind to the persisted `project.boil` / `layer.boilStrength`; changing any of them
  clears the `BoilCache` so the next play re-bakes with the new values.

## Testing

Pure logic is unit-tested (Vitest); the warp/weight *look*, cache hitch, and export output are
manual (browser / iPad), consistent with the rest of the app.

- **Variant selection:** `frame % rate` and the holds-only crisp-vs-boil decision over a given
  `cells[]` (which frames are crisp, which boil, edge cases: rate 1, single-frame keys).
- **Seed determinism:** same `(residue, layerId)` → same seed; different layer → different seed.
- **`dilateErodeAlpha`:** on a tiny fixture `ImageData` (e.g. a 7×7 with a 1-px opaque dot):
  positive radius grows the opaque region, negative shrinks it, radius 0 is identity, fractional
  radius blends.
- **Persistence round-trip:** a project with a non-default `boil` config and per-layer
  `boilStrength` saves and loads back equal; an old save (no boil fields) loads with defaults.

## Phasing → implementation plans

- **Phase 1 — config model + holds-only + settings UI.** Move `boil` into `Project` (+ `boilStrength`
  on `DrawingLayer`), persist both, port the prototype controls to a cogwheel popover with value
  readouts, and implement the **holds-only** selection (pure, tested). Keep the prototype's live
  warp as the renderer for now. Ships a persisted, holds-only boil.
- **Phase 2 — pre-baked variant cache.** Add `BoilCache` + `bakeBoilVariant`, swap the renderer
  from live warp to baked-variant blits, wire cache lifecycle, and apply **per-layer strength**.
  Ships smooth playback.
- **Phase 3 — true weight + export.** Add `dilateErodeAlpha`, replace the uniform-scale weight
  with baked dilate/erode, and thread boil through the **export** path. Ships the finished effect.

Each phase leaves working software and is its own plan.

## Out of scope (future)

- Per-region, noise-modulated weight (different parts of a line thicken/thin differently) — v1
  uses one signed dilate/erode amount per variant.
- Boil on reference layers.
- Real-time boil while paused/editing (boil stays a playback/export effect).
- Eager/persistent variant caching across edits.
