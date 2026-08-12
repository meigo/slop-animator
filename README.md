# slop-animator

A browser-based, low-framerate, frame-by-frame **bitmap animation** app with a monochrome
ink-outline aesthetic. Designed **iPad-first for Apple Pencil** (mouse/desktop also works).

**▶ Try it: [slop-animator.meigo.workers.dev](https://slop-animator.meigo.workers.dev)** — on an
iPad, use Share → Add to Home Screen for a full-screen app.

Built with **Svelte 5 (runes) + TypeScript + Vite + Tailwind 4**, tested with Vitest.

## Features (current state)

**Drawing**

- Multiple brush engines: smooth ([perfect-freehand](https://github.com/steveruizok/perfect-freehand)), ink, pencil, charcoal, airbrush — with pressure support, an adjustable pressure curve, and separate brush/eraser settings
- Fill tool, eyedropper, lasso selection with float/transform
- Transparent background support with checkerboard view and a paint-behind toggle

**Animation**

- Frame-by-frame timeline with keyframes and holds, scrubbing, and playback
- Onion skins — step by frames or by **keyframes** (holds don't use up a ghost)
- WebGL **line boil** (that hand-drawn wobble on held frames)
- Layers with visual groups (collapse, visibility, lock, drag-reorder) — lock or hide a group and every member follows, without disturbing their own settings; locked and hidden layers are read-only everywhere

**Transform & deform**

- Free transform at four scopes: selection, current-frame cell, whole layer, and layer group (transforms compose `group ∘ layer ∘ cell` at render)
- Painting on a transformed layer shows its paintable edge as a hairline, so a scaled-down layer no longer cuts strokes off without warning
- **Deform tool** — FFD grid warp plus a rigid (MLS) mode
- **Pose tool** — silhouette triangulation + geodesic-weighted MLS with per-handle rotation/reach gizmos, for posing a character drawing without redrawing it

**Reference & audio**

- Reference layers (image/video) with a transform gizmo, lockable to pin them in place — images persist with the project; video is opt-in per clip and can play its own soundtrack
- Audio track: import, waveform, synced playback, **scrub-while-you-drag**, drag-to-offset, mute, and muxed into the MP4/WebM export
- Clipboard image paste + rasterize to a drawing layer

**Files & export**

- Project files as zip (JSON + PNG per key cell, plus embedded reference media), autosave to IndexedDB, global preferences
- A project name drives the save and export filenames
- MP4/WebM export via [mediabunny](https://github.com/Vanilagy/mediabunny)

**Keyboard**

- `Space` tap = play/pause, `Space` hold = pan the canvas · `←/→` step a frame (`Shift` = 10) ·
  `Home`/`End` first/last · `↑/↓` change layer · `0` fit view
- `b` brush · `e` eraser · `g` fill · `s` select · `l` lasso · `[`/`]` brush size · `o` onion ·
  `⌘Z`/`⌘⇧Z` undo/redo

## Running it

```sh
npm install
npm run dev        # Vite dev server on localhost
npm run dev:lan    # HTTPS over LAN — for iPad testing (accept the self-signed cert once)
```

Other scripts:

```sh
npm run build      # svelte-check + tsc + vite build (0 errors, 0 warnings is the bar)
npm test           # Vitest — pure-logic unit tests (~400); canvas/DOM code isn't node-testable
npm run lint       # ESLint (runes-aware + Tailwind class conflicts) — Prettier runs via pre-commit hook
npm run deploy     # build, then wrangler deploy (Cloudflare Workers static assets)
```

## Code layout

- `src/anim/` — document model (projects, layers, cells, keyframe resolution), compositing/render, onion skins
- `src/core/` — brush engines, pressure curve, selection, fill, transform math, WebGL boil, triangulation/geodesic pose weights
- `src/state/appState.svelte.ts` — the global `$state` store: all mutations, undo history, preferences
- `src/lib/` — Svelte UI components (canvas, toolbar, timeline, layer list, gizmos, dialogs)
- `src/persist/` — project file (zip), preferences (localStorage), autosave (IndexedDB)
- `docs/superpowers/specs/` & `docs/superpowers/plans/` — dated design specs and implementation plans for each feature

## Roadmap (rough)

Animated/keyframed transforms, group-transform apply
(pixel flatten), tiled copy-on-write cell storage for an expandable canvas. See `CLAUDE.md`
for the detailed state and deferred-work list.
