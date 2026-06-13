# slop-animator — MVP Design

**Date:** 2026-06-13
**Status:** Approved design, pre-implementation

## 1. Purpose

A browser-based, **bitmap** frame-by-frame character animation app for producing
**low-framerate, monochrome ink-outline** animation in the spirit of Wilhelm M.
Busch's pen drawings (loose, gestural, variable-width ink line; mostly black on
paper with optional accent colors).

It is built by **copying the drawing core of the existing `slop-paint` app**
(Svelte 5 + TypeScript + Vite + Canvas2D, using `perfect-freehand`) into a fresh
`slop-animator` project and adding an animation layer on top: a Flash-style
layered timeline, onion skin, playback, and export.

### North-star aesthetic
Reference: `temp/ref/w-m-busch-068-catal.jpg`, `temp/ref/w-m-busch-079-catal.jpg`
— Wilhelm M. Busch (1908–1987) Federzeichnungen. Expressive variable-width ink
strokes that pool into thick black marks and thin to dry scratchy tails; heavy
negative space; economical, confident linework. The `perfect-freehand`
pressure→width brush already in `slop-paint` is the primary vehicle for this look.

## 2. Scope

### In scope (MVP)
- Tools (ported from `slop-paint`): **ink brush** (perfect-freehand,
  pressure-sensitive width), **eraser**, **selection + transform**
  (rect/lasso select, move/scale/rotate), **bucket fill**.
- **Flash-style layered timeline**: multiple layers, each a track of frame cells;
  cells are **keyframes** (a drawing) or **holds** (repeat the prior keyframe).
  **No tweening.**
- **Reference layers** for rotoscoping: **image and video**, never drawn on,
  never exported, onion skin ignores them.
- **Onion skin**: configurable previous/next drawings, tinted.
- **Playback**: play/pause/loop, step, jump to ends, adjustable fps.
- **Export**: **PNG sequence (zip)** and **video (WebM/MP4)** via WebCodecs.
- **Project save/load** (`.zip` bundle) and **IndexedDB autosave**.

### Out of scope (explicitly deferred)
- Bones / skeleton layer (Moho/Spine/ToonSquid-style rigging). The copied
  `spine-tags.ts` and PSD group conventions leave a path open, but no rigging in MVP.
- "FPF" local-animation layer on top of bones.
- Tweening / interpolation, vector drawing, audio tracks, nested layer groups,
  mesh warp / perspective distort.

## 3. Architecture

```
slop-animator/
  src/
    core/    ← copied from slop-paint, minimal edits
      brush.ts, stamp-brush.ts, brush-textures.ts, pressure-curve.ts
      viewport.ts, input.ts, touch-gestures.ts
      selection.ts, selection-anchor.ts, fill.ts
    anim/    ← new
      document.ts   Project / Layer / Cell model + frame-resolution logic
      timeline.ts   keyframe/hold/layer operations
      render.ts     composite one frame across visible drawing layers
      onion.ts      tinted previous/next rendering
      playback.ts   requestAnimationFrame play loop at project fps
      history.ts    document-level undo/redo command stack
    export/
      png-sequence.ts   composite frames → numbered PNGs → zip (fflate)
      video.ts          WebCodecs VideoEncoder + webm-muxer / mp4-muxer
      project-file.ts   .zip save/load (project.json + frame PNGs + ref media)
    state/
      appState.svelte.ts
    lib/     Svelte components
      Canvas.svelte, Toolbar.svelte, BrushControls.svelte,
      Timeline.svelte, LayerList.svelte, Playbar.svelte,
      ExportDialog.svelte, NewDocDialog.svelte
    App.svelte, main.ts
```

**Key port change:** `slop-paint`'s undo/redo is **per-layer**. The animator needs
**document-level** undo covering both pixel edits and timeline operations
(insert/delete keyframe, add/remove/reorder layer, etc.), so `history.ts` becomes
a command stack rather than a per-layer pixel history.

## 4. Data model

```ts
Project {
  width: number; height: number;
  fps: number;            // default 12
  bgColor: string;        // default paper off-white ~ #f4efe2
  frameCount: number;
  layers: Layer[];        // layers[0] = bottom, composited first
}

type Layer = DrawingLayer | ReferenceLayer

DrawingLayer {
  kind: 'draw';
  id; name; visible; locked; opacity;
  cells: Cell[];          // cells.length === frameCount
}

ReferenceLayer {
  kind: 'ref';
  id; name; visible; opacity; locked: true;   // never drawn on
  media:
    | { type: 'image'; img: HTMLImageElement }
    | { type: 'video'; vid: HTMLVideoElement; offsetFrames: number };
  transform;               // position/scale/rotate to fit canvas (reuses core transform)
}

type Cell =
  | { kind: 'key'; canvas: HTMLCanvasElement }   // a drawing (canvas may be empty)
  | { kind: 'hold' };                            // repeats nearest 'key' at-or-before
```

### Resolution & compositing
- **Display at (layer, frame f):** for a drawing layer, walk back from `f` to the
  nearest `key` cell and use its canvas. For a reference layer, render its media
  (image: always; video: the frame at `videoTime = (f + offsetFrames) / fps`,
  awaiting the `seeked` event before compositing).
- **Composite for display/export:** for each visible layer bottom→top, draw its
  resolved content at the layer's opacity. **Export excludes reference layers.**

### Editing behavior
- The resolved `key` canvas of the **active drawing layer at the playhead** is the
  live surface the ported tools (brush/eraser/fill/selection) write to — so the
  tools work unchanged.
- **Draw-on-hold:** drawing on a `hold` cell auto-converts it to a `key` whose
  canvas is a **clone of the currently-held drawing**, so the artist draws on top
  (ToonSquid-style; friendlier than Flash's manual keyframe insertion).
- Empty drawing on a fresh keyframe is allowed (intentional blank).

## 5. Timeline, onion skin, playback

### Timeline (bottom panel)
A layers×frames grid. Rows = layers; columns = frames.
- Keyframe cell = filled dot; hold = hollow/extended bar (Flash convention).
- Playhead column highlighted.
- Cell ops: insert keyframe, insert hold, duplicate keyframe, delete frame,
  clear cell.
- Layer ops: add/delete/reorder/rename; toggle visible/locked; per-layer opacity.
- Reference rows show a media chip rather than drawable cells.

### Onion skin (playbar toggle)
- Configurable **1–3 previous** (warm/red tint) and **1–3 next** (cool/blue tint)
  resolved drawings at reduced opacity.
- Default: **1 before + 1 after, current-layer-only**, with a toggle for
  "all layers." Reference layers are always excluded.

### Playback (playbar)
- play/pause/loop, step ±1 frame, jump to start/end, current-frame readout, **fps**
  field (default **12**; presets 6/8/12/24). `requestAnimationFrame`-driven.

## 6. Tools & shortcuts

Ported toolbar: ink brush, eraser, rect/lasso select + move/scale/rotate, bucket
fill. Brush controls: size, opacity, smoothing, size-range, taper, pressure curve,
color.

Carried-over shortcuts: `B` brush, `E` eraser, `G` bucket, `S` rect-select,
`L` lasso, `[`/`]` size, `Ctrl+Z`/`Ctrl+Shift+Z` undo/redo, `Space`-drag pan,
`Ctrl+0`/`Ctrl±` zoom, `Enter`/`Esc` commit/cancel selection.

Animation keys: `,`/`.` step frames; **`K` (and `Enter` when no selection is
active) = play/pause** — Space stays reserved for pan.

## 7. Export & persistence

### Export (dialog)
- **PNG sequence:** composite each frame (visible drawing layers only) → numbered
  PNG → zip via `fflate`.
- **Video (WebM/MP4):** frame-accurate via **WebCodecs `VideoEncoder`** +
  `webm-muxer` / `mp4-muxer`. Feature-detected; if WebCodecs is unavailable
  (older Safari), fall back to PNG-sequence export with a notice.

### Project save/load
- `.zip` bundle: `project.json` (model + cell metadata) + `frames/<layer>/<n>.png`
  + embedded reference media.
- **IndexedDB autosave** so work survives a refresh.
- UI settings persisted to `localStorage` (as `slop-paint` already does).

### Document defaults
- Paper off-white background (~`#f4efe2`), black ink default color.
- Default size via a ported New-Doc dialog (e.g. 1280×720).
- Monochrome-first; full color picker retained for accent colors.

## 8. Tech stack
Svelte 5 + TypeScript + Vite + Tailwind 4; `perfect-freehand` (brush), `fflate`
(zip), `webm-muxer` / `mp4-muxer` (video), `lucide-svelte` (icons). Vitest for tests.

## 9. Testing strategy (TDD)
Unit tests on the pure logic, written before implementation:
- `document.ts`: frame resolution (hold → nearest prior keyframe; empty timeline;
  reference video time mapping).
- `timeline.ts`: insert/delete/duplicate keyframe, hold↔key conversion,
  draw-on-hold clone, layer add/remove/reorder, frameCount invariants
  (`cells.length === frameCount` for every drawing layer).
- `render.ts`: composite order (bottom→top), visibility/opacity, reference
  exclusion on export.
- `onion.ts`: previous/next range selection and clamping at timeline ends.
- `history.ts`: undo/redo of both a pixel edit and a timeline op.
- `png-sequence.ts`: frame count and ordering of exported PNGs.

## 10. Risks / open notes
- **Video reference sync:** per-frame `<video>` seeking + `seeked` await is the
  fiddliest MVP item; playback may need to throttle/pre-seek.
- **WebCodecs availability:** primary target is Chromium/Edge and Safari 16.4+;
  PNG-sequence fallback covers the rest.
- **Memory:** many keyframe canvases at large doc sizes can grow heap usage;
  acceptable for MVP, revisit with bitmap pooling / `ImageBitmap` if needed.
- The copied `core/` may **drift** from `slop-paint` over time (chosen tradeoff:
  isolation over shared package).
