# Dry brush — port from slop-paint

Date: 2026-10-01. Source: slop-paint `src/dry-brush.ts` at `917f44f` (first `5bd8ba6`, then `955809f`,
`ae89e79`, `afa8b13`, `917f44f`). Asked for by the slop-paint session and approved by the user; port
note (17) on the unmerged branch `docs/port-portrait-options-row`. Depends on the Stream pressure fix
(note 16), merged `8a06723`.

## Goal / success criteria

1. A new brush type, **Dry brush**: a bristle brush running short of paint — parallel hair stripes
   along the stroke, broken where the hairs run dry, ragged edges, a splayed start and a frayed end.
   Light pressure lets only the middle hairs touch (the dry texture lives at light pressure).
2. Two settings behind the brush gear while it is chosen: **Dryness** (0–100, default 50) and
   **Taper** (0–100, default 10). Saved with the other brush settings; older saves load with the
   defaults.
3. The eraser can use it (the brush-type menu is shared).
4. It looks like slop-paint's: same engine, same defaults, same menu name.
5. A stroke never changes while it is drawn (deterministic per stroke).

## Decisions

- **Copy slop-paint's CURRENT engine file**, imports adapted, not a shared package (there is none
  between the slop apps; out of scope).
- **Menu order:** after Calligraphy, as slop-paint (`Dry brush`).
- **Brush cursor:** the plain round ring (no special case).
- Onion skins and line boil read finished cells, so they need nothing.
- The same line drawn on another frame gets its own hair pattern (seeded from the stroke's first
  point): hand-drawn variation, not a defect.

## Design

- **Engine** `src/core/dry-brush.ts` + `src/__tests__/dry-brush.test.ts`: copies of slop-paint's at
  `917f44f`. Imports become this app's: `InputPoint` from `./input`, `BrushSettings` and `widthRange`
  from `./brush` (same names and shapes here). Its module-level scratch canvas is document-sized,
  as Ink's compositing needs; `DPR` here is 1.
- **Model** (`src/core/brush.ts`, `src/state/appState.svelte.ts`): `BrushSettings` gains
  `dryness?: number` and `dryTaper?: number` (Dry only, like `dwellPool` for Ink); `BrushKind` gains
  `"dry"`; the brush and eraser defaults gain `dryness: 50, dryTaper: 10`. `applyPreferences`
  already merges saved settings over the defaults.
- **Drawing** (`src/lib/Canvas.svelte` `paintStroke`): a `kind === "dry"` branch beside Ink's — full
  redraw: `putImageData(beforeSnapshot)`, then `drawDryStroke(strokeCtx, curved, settings, sr)`
  inside `save` / `setTransform(DPR…)` / `selection?.applyClip` / `try…finally restore`. The stamp
  state reset at the stroke's start (`bt !== "smooth" && bt !== "calligraphy" && bt !== "ink"`)
  must also exclude `"dry"`, or the new kind falls through to the stamp engine.
- **UI** (`src/lib/ToolOptions.svelte`): `<option value="dry">Dry brush</option>` after Calligraphy;
  with Dry chosen, two gear rows built like Ink's Pool: **Dryness** (`stroke.dryness`, title "How dry
  the brush runs — higher breaks the hairs sooner") and **Taper** (`stroke.dryTaper`, title "How
  long each hair tapers at its ends").

## Testing

- slop-paint's engine tests, copied (they must pass unchanged but for imports).
- `test:ipad`: with the Dry brush, a Pencil stroke paints, and its texture is broken — along the
  stroke's middle line the Dry stroke leaves gaps (a run of unpainted pixels) where a Smooth stroke
  of the same size leaves none. Shown failing with the Dry branch drawing the Smooth stroke instead.
- Build 0/0, full `npm test`.
- Owed on the iPad: the feel with a real Pencil at light and heavy pressure.

## Docs

README Features (brush list) and test count; CHANGELOG entry; CLAUDE.md architecture map's
`src/core/*` brush list.
