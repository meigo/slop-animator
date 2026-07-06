# slop-animator

> ⚠️ **Work in progress.** This is an actively developed personal project — expect rough edges,
> missing features, and breaking changes to the project file format.

A browser-based, low-framerate, frame-by-frame **bitmap animation** app with a monochrome
ink-outline aesthetic. Designed **iPad-first for Apple Pencil** (mouse/desktop also works).

Built with **Svelte 5 (runes) + TypeScript + Vite + Tailwind 4**, tested with Vitest.

## Features (current state)

**Drawing**

- Multiple brush engines: smooth ([perfect-freehand](https://github.com/steveruizok/perfect-freehand)), ink, pencil, charcoal, airbrush — with pressure support, an adjustable pressure curve, and separate brush/eraser settings
- Fill tool, eyedropper, lasso selection with float/transform
- Transparent background support with checkerboard view and a paint-behind toggle

**Animation**

- Frame-by-frame timeline with keyframes and holds, scrubbing, and playback
- Onion skins
- WebGL **line boil** (that hand-drawn wobble on held frames)
- Layers with visual groups (collapse, visibility, lock, drag-reorder)

**Transform & deform**

- Free transform at four scopes: selection, current-frame cell, whole layer, and layer group (transforms compose `group ∘ layer ∘ cell` at render)
- **Deform tool** — FFD grid warp plus a rigid (MLS) mode
- **Pose tool** — silhouette triangulation + geodesic-weighted MLS with per-handle rotation/reach gizmos, for posing a character drawing without redrawing it

**Reference & audio**

- Reference layers (image/video) with a transform gizmo
- Audio track (phase 1): import, waveform display, synced playback
- Clipboard image paste + rasterize to a drawing layer

**Files & export**

- Project files as zip (JSON + PNG per key cell), autosave to IndexedDB, global preferences
- MP4/WebM export via [mediabunny](https://github.com/Vanilagy/mediabunny)

## Running it

```sh
npm install
npm run dev        # Vite dev server on localhost
npm run dev:lan    # HTTPS over LAN — for iPad testing (accept the self-signed cert once)
```

Other scripts:

```sh
npm run build      # svelte-check + tsc + vite build (0 errors, 0 warnings is the bar)
npm test           # Vitest — pure-logic unit tests (~280); canvas/DOM code isn't node-testable
npm run lint       # ESLint (runes-aware) — Prettier runs via pre-commit hook
```

## Code layout

- `src/anim/` — document model (projects, layers, cells, keyframe resolution), compositing/render, onion skins
- `src/core/` — brush engines, pressure curve, selection, fill, transform math, WebGL boil, triangulation/geodesic pose weights
- `src/state/appState.svelte.ts` — the global `$state` store: all mutations, undo history, preferences
- `src/lib/` — Svelte UI components (canvas, toolbar, timeline, layer list, gizmos, dialogs)
- `src/persist/` — project file (zip), preferences (localStorage), autosave (IndexedDB)
- `docs/superpowers/specs/` & `docs/superpowers/plans/` — dated design specs and implementation plans for each feature

## Roadmap (rough)

Animated/keyframed transforms, audio scrubbing + export muxing, group-transform apply
(pixel flatten), per-layer boil-strength UI, tiled copy-on-write cell storage for an
expandable canvas. See `CLAUDE.md` for the detailed state and deferred-work list.
