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
- Fill every area an outline encloses in one press, behind the strokes — the animator's
  white-under-black-outline, without redrawing each region by hand
- Transparent background support with checkerboard view and a paint-behind toggle
- **iPad:** finger pans, Pencil edits (canvas and timeline). Two-finger pinch zooms, pans, and
  rotates; lift snaps to 90° if you are within ~3°

**Animation**

- Frame-by-frame timeline with keyframes and holds, scrubbing, and playback
- Animated properties get their own timeline rows under the layer or group they belong to —
  collapse them away when you are drawing, open them when you are timing (a group's header
  chevron still hides members; the Spline chevron folds only its tracks)
- A layer's **opacity can be animated** too: key it at any frame for a fade, or set a segment to
  hold for a hard cut
- A **group** can be faded as one thing as well — member opacity × group opacity. The **Group**
  slider sits on the group header in the layer panel (even when collapsed); Animate from a
  selected member on the timeline bar, same as Animate group transform
- Animate, add-key (current frame), easing, step, delete-key and stop live on the
  timeline bar and follow the selected row. Drawing frame tools hide while a
  property row is selected, so the two keying strips are never on screen together
- Playback and timeline tools share one bar above the ruler (play, In/Out, add/clear/delete
  frame on the left; onion, boil, and fps/length on the right)
- A drawing key is created by drawing on a hold. The timeline bar adds a frame
  (a hold on every layer, same as growing the length), blanks the current key,
  or deletes a frame — not insert / duplicate / hold
- A hold continues until a **blank key** (◇). Running out of cells on a layer
  does not stop it — Clear is how a drawing ends
- Onion skins — step by frames or by **keyframes** (holds don't use up a ghost)
- WebGL **line boil** (that hand-drawn wobble on held frames)
- Layers with visual groups (collapse, visibility, lock, drag-reorder) — lock or hide a group and every member follows, without disturbing their own settings; locked and hidden layers are read-only everywhere

**Transform & deform**

- Free transform at four scopes: selection, current-frame cell, whole layer, and layer group (transforms compose `group ∘ layer ∘ cell` at render)
- A layer's transform can be animated: keys at any frame, per-key easing (linear, hold, ease in/out),
  and a step setting so a move can land on 2s/3s like the drawings. Drag a key along its row to
  retime it. Starting the track is on the timeline bar, not the Transform tool
- A **group's** transform can be animated the same way, so a whole character rig moves as one thing
  over time while its layers keep their own animation
- Painting on a transformed layer shows its paintable edge as a hairline, so a scaled-down layer no longer cuts strokes off without warning
- **Deform tool** — FFD grid warp plus a rigid (MLS) mode
- **Pose tool** — silhouette triangulation + geodesic-weighted MLS with per-handle rotation/reach gizmos, for posing a character drawing without redrawing it
- Outline-only drawings pose as a body, not a thin web — space enclosed by the outline counts as part of the shape, with no change to the artwork

**Reference & audio**

- Reference layers (image/video) with a transform gizmo, lockable to pin them in place — images persist with the project; video is opt-in per clip and can play its own soundtrack
- A video reference is a **draggable clip** on the timeline (no filmstrip) — drag to place it in time; drag either edge to trim the source (the kept picture stays in sync); speed is set in the layer panel. Its clip is its (trimmed) footage span, so it no longer holds its last frame past the end of the video — those frames render empty
- An image reference can be trimmed to a range of frames — drag either edge of its timeline clip to set when it appears; untrimmed, it stays visible for the whole project
- Audio track: import, waveform, synced playback, **scrub-while-you-drag**, drag-to-offset, mute, trim either end of the clip from its lane handles, and muxed into the MP4/WebM export
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
npm test           # Vitest — pure-logic unit tests (879); canvas/DOM code isn't node-testable
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

Group-transform apply (pixel flatten), custom easing curves, a camera with per-layer parallax
depth, and tiled copy-on-write cell storage for an expandable canvas. See `CLAUDE.md` for the
detailed state and deferred-work list.

## Contributors

<table>
  <tr>
    <td align="center" width="140">
      <a href="https://github.com/meigo">
        <img src="https://github.com/meigo.png?size=100" width="100" height="100" alt="meigo" /><br />
        <sub><b>Meigo Kukk</b></sub>
      </a><br />
      <sub>owner</sub>
    </td>
    <td align="center" width="140">
      <a href="https://github.com/claude">
        <img src="https://github.com/claude.png?size=100" width="100" height="100" alt="Claude" /><br />
        <sub><b>Claude</b></sub>
      </a><br />
      <sub>Anthropic · co-author</sub>
    </td>
    <td align="center" width="140">
      <a href="https://x.ai/">
        <img
          src="https://www.google.com/s2/favicons?domain=x.ai&sz=128"
          width="100"
          height="100"
          alt="Grok / xAI"
        /><br />
        <sub><b>Grok</b></sub>
      </a><br />
      <sub>xAI · co-author</sub>
    </td>
  </tr>
</table>

Assisted by **[Claude](https://claude.ai/)** (Anthropic) and **[Grok](https://x.ai/)** (xAI).
GitHub lists Claude from `noreply@anthropic.com`. Grok’s
`noreply@x.ai` is not tied to a GitHub user, so it does not appear in the
sidebar. Commits may include:

```text
Co-Authored-By: Grok <noreply@x.ai>
```
