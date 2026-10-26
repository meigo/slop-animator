# Blend tool — design (2026-10-26)

A port of slop-paint's Blend tool (slop-paint `db26300`, `7c8e8e1`, `7449d2a`; its CLAUDE.md entry
"blend-brush.ts" describes it as it works now). Port the CURRENT state: a tool, not a brush type.

## Intent

A tool that moves the paint already in a drawing — blur, smudge, smear — and never lays down
colour. Used per frame: it changes only the drawing on the current frame of the active layer.
Blending alternates with painting, which is why it is a tool with its own size rather than a brush
type (slop-paint tried the brush type for a day: every switch was two trips to the type menu and a
resize).

## Goals

- **Blend tool**, toolbar button right after the Eraser, shortcut **J** (free here). Title:
  "Blend (J) — blur, smudge or smear the drawing". Icon: lucide `Droplet`, as slop-paint.
- **Its own settings**, separate from the brush and eraser, saved with the preferences:
  size (default 20), Strength (the opacity field, default 100), Press (`sizeRange`), Stream
  (`streamline`), **Smear** (0–100, default 30), **Tip** (Soft / Hard / Grain / Rough, default
  Soft), and its own pressure curve (default: a copy of the brush's until saved, as the eraser's
  was introduced).
- **Tool options row:** size + presets, Press, Strength, Smear on the bar; Tip, Stream and the
  pressure curve behind the gear. No brush-type menu, colour swatch, Draw behind, Wobble or other
  brush-only options. The row must stay one line in iPad portrait (the smoke test checks every
  tool).
- **Per frame:** acts on the active layer's drawing at the playhead, exactly where the brush would
  draw: on a hold it materialises a keyframe first (`ensureDrawableKeyframe`), so the held drawing
  and the frames that show it are untouched; refused on frames a loop plays (`onLoopFrame`), on a
  locked/hidden layer and on a reference layer, like the brush.
- **Alpha lock and selections** limit it as they limit the brush (the selection clip on the cell
  context; `source-atop` under alpha lock, in the engine).
- **Undo:** one stroke = one undo step, through the existing `commitOpenStroke` (a stroke that
  changes no pixel pushes nothing and takes back a materialised keyframe — already true there).
- **Brush cursor** shows the Blend size like the brush (solid, not the eraser's dashed ring); `[`/`]`
  change its size.
- **README:** the tool in Features, J in Keyboard, the test count.

## Non-goals

- Blending across frames (smear frames etc.): the user wants per frame only.
- A Colour/mix-in option (slop-paint dropped it: it made Blend a paint brush).
- Blend as a brush type, or slop-paint's `wasBlendType` settings migration (this app never had the
  type).
- Any render-time effect: afterwards the cell is ordinary pixels, so playback, onion skins and
  export cost nothing extra. Nothing in the render path changes.

## Anti-goals

- Paint loss or drift: a flat grey must stay its value after repeated passes (slop-paint measured
  exactly 128 after six). Keep its two WebKit traps:
  1. Never read the cell with `drawImage` — WebKit copies the whole changed source canvas per draw
     (5.8 ms a dab vs 0.7 ms with `getImageData` on a 2× layer). Read with `getImageData`.
  2. Never blur by shrinking and growing a canvas — WebKit lost 4–11% of the paint per dab and
     banded a straight stroke. Blur in JS (`boxBlur3` on premultiplied floats).
- Changing other frames, the held drawing, or another layer.

## The engine

Copy slop-paint's `src/blend-brush.ts` to `src/core/blend-brush.ts` and
`src/__tests__/blend-brush.test.ts` to this app's `src/__tests__/`, changing only imports
(`../core/...`) and what this app lacks:

- `releaseCanvas` does not exist here (this app's `dry-brush.ts` predates it): add slop-paint's
  helper (`dry-brush.ts` there: set the canvas to 0×0 so WebKit lets go of its pixels) where the
  engine can import it — in `blend-brush.ts` itself is fine.
- `blendTip()` and `BLEND_TIPS` go into this app's `src/core/brush-textures.ts` (it has the same
  four private tip functions: `softRoundTip`, `hardRoundTip`, `pencilTip`, `charcoalTip`).
- `BrushSettings` (`src/core/brush.ts`) gains the optional `blendSmear?: number` and
  `blendTip?: string` the engine reads.
- `widthRange`, `spaceStamps`, `mipIndex` already exist here with the same signatures.

How it works (unchanged): incremental dabs 0.1 of the width apart, at whole device pixels. Each
dab reads the cell under it (`getImageData`, padded for the blur), blurs it at low Smear, mixes it
into a carried `load` (`blendMix(smear, stepShare)`: Smear 0 = fresh pick-up each dab, i.e. a blur
in place; Smear 100 carries 4 widths to 1/e, unblurred), and writes it back as
cell × (1 − a·mask) + load × a·mask (`destination-out` + `lighter`), or `source-atop` under alpha
lock. `a` = `blendStrength(opacity, pressure, hasPressure)`. `resetBlendState()` at the press;
`done` at the release lets go of the scratch canvases.

## Wiring in this app (`src/lib/Canvas.svelte` and friends)

- `Tool` gains `"blend"` (`src/state/appState.svelte.ts`); `state.blend: ToolSettings` beside
  `state.brush`/`state.eraser` (its `brushType` is never read); `pressureCurves.blend`;
  `activeStroke()` and `activePressureCurve()` return Blend's for the Blend tool; preferences
  gather/apply carry `blend` and its curve (`src/persist/preferences.ts`, like `eraserCurvePref`).
- One helper, `isStrokeTool(tool)` (brush, eraser, blend), replaces the scattered
  `tool === "brush" || tool === "eraser"` checks that mean "a stroke tool": the cursor-none class
  in `Canvas.svelte` (:3130), the Stream option in `setupInput` (:2757), `BrushCursor.svelte`
  (:28), `ToolOptions.svelte`'s stroke block (:117), App's `[`/`]` (:279-280). Checks that mean
  "the eraser specifically" stay as they are.
- The wider tool LISTS get `"blend"` added — they are NOT `isStrokeTool` (they include fill,
  deform, pose, outline): `PIXEL_TOOLS` in `Canvas.svelte` (drives `toolBlocked`: locked layer,
  loop frame, wrong row) and `PAINT_TOOLS` in `LayerBoundsHint.svelte`.
- **Status-bar "can't draw here" hints** come from `src/lib/status-hint.ts`, which has its own tool
  lists (audio row, group row, not a drawing layer): add Blend to each, with tests in its test file.
- **Copied cells read fast too** (my call, from the builder check): `cloneCanvas`
  (`src/anim/document.ts`) creates its context without `willReadFrequently`, while
  `createCellCanvas` and loaded cells have it. `ensureDrawableKeyframe` clones on a hold, so a
  Blend stroke on a materialised keyframe would read back from the GPU every dab — the slowdown
  anti-goal 1 exists to avoid (the flag only counts at the first `getContext`). Give `cloneCanvas`
  `{ willReadFrequently: true }`, matching every other cell. It changes copies made by duplicate,
  draw-on-hold and the like to the CPU-backed kind the rest already are; owed an iPad look at
  playback with such copies.
- **The stroke's tool is pinned at the press.** `paintStroke`/`commitOpenStroke` take
  `asEraser` today because the tool can change under an open Pencil stroke; generalise that to the
  stroke tool that started it (brush / eraser / blend), so a tool switch mid-stroke commits a
  Blend stroke as Blend with Blend's settings and curve.
- **A Blend stroke dispatches to the engine** as an incremental branch like the stamp engine's (no
  snapshot restore; `setTransform(DPR…)`, `selection?.applyClip`, then
  `drawBlendStrokeIncremental(strokeCtx, curved, settings, sr, done)`), and calls
  `resetBlendState()` where the stamp engine's `resetStampState()` is called at the press. It reads
  and writes `strokeCtx` — the pinned cell's own context — so it can only touch that cell.
- Smooth (path averaging) does not apply to Blend; Stream does (through `input.ts`, as the brush).
- `StatusBar.svelte` names the tool "Blend".
- Status/caption text the brush shows when blocked (loop frame, locked layer, reference, audio or
  group row) shows for Blend too — through `PIXEL_TOOLS` and `status-hint.ts` above.

## Tests

- The engine's tests, ported (blendMix, blendStrength, premultiply round trip, boxBlur3 keeps paint,
  blurPlan).
- Unit tests for any pure helper added (`isStrokeTool`; preferences round trip of `blend` and its
  curve).
- `tools/ipad-smoke.mjs`: J/the Blend button selects Blend; a Blend stroke across a drawn stroke
  changes its pixels and is one undo step (undo restores them); the brush's size is untouched by
  Blend's; the brush-type menu is not shown for Blend; add "Blend (J)" to the portrait one-line
  tool-options check.
- `npm run build` 0 errors, 0 warnings; `npm test` all passing.

## Left to the builder

- Exact placement in `ToolOptions.svelte` and how the eraser/brush conditionals there are split.
- Whether `state.blend` reuses `ToolSettings` whole or a narrower type, as long as preferences
  round-trip it.
- Verification on iPad is owed after deploy (not measured on an iPad in slop-paint either): a long
  wide Blend stroke for lag, and the Smear range by feel.
