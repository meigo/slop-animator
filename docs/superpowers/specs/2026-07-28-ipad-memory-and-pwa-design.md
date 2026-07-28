# iPad memory reduction + home-screen install — design

**Date:** 2026-07-28
**Status:** Design (approved for planning)
**Feature:** Two independent, iPad-facing changes: (1) drop the document raster scale from the device
pixel ratio to a fixed **1×**, cutting cell RAM and autosave encode cost 4× on iPad and making export
resolution device-independent; (2) add **PWA manifest metadata** so the app installs to the iPad Home
Screen as a standalone window with storage that isn't subject to Safari's unused-site-data eviction.

## Motivation

The app is used primarily on iPad, where `window.devicePixelRatio` is 2. Three consequences:

**RAM.** Every key cell is a full document-sized canvas allocated at `width × dpr` by
`createCellCanvas` (`document.ts:260`). At the default 1920×1080 preset that is 3840×2160×4 bytes =
**33.2 MB per key cell**. Thirty keyframes on one layer is ~1 GB. iPadOS kills tabs under memory
pressure, and a killed tab costs everything since the last autosave.

**Autosave cost.** `saveAutosave` → `saveProjectBlob` PNG-encodes *every* key cell in the project
(`project-file.ts:209-215`) on a 3s debounce after any change. The per-cell pixel count therefore
sets a recurring encode stall, not just a memory ceiling. `zipSync` then DEFLATEs those
already-compressed PNG bytes, a second wasted pass.

**Export is non-deterministic across devices.** `exportPngSequence`/`exportVideo` size their output
as `project.width * dpr` (`png-sequence.ts:12`, `video.ts:32`). A "1920×1080" project therefore
exports at 3840×2160 from iPad and 1920×1080 from a 1× display. The nominal project size does not
describe the output.

The app is a low-framerate, monochrome ink-outline tool. High-resolution output is explicitly not a
target (user: *"this is 'slop' and hires is not a target. Medium resolution and quality is totally
ok."*), so the resolution being paid for is not being used.

Separately, `index.html` carries no PWA metadata at all. In a Safari tab the app donates vertical
space to the browser toolbars — costly for a canvas + timeline layout — and its IndexedDB autosave
falls under WebKit's eviction of storage for sites not visited in ~7 days.

## Decisions (locked during brainstorming)

| #   | Decision                     | Choice                                                                                                                                                                                                                 |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Memory approach              | **Fixed 1× document scale.** Chosen over LRU cell eviction and over "measure first": it is a one-line change with a 4× win, and hi-res is a non-goal. Eviction stays available if measurement later shows it's still needed. |
| D2  | Implementation shape         | Set the existing `DPR` constant to `1`. Do **not** strip the ~60 `* DPR` / `setTransform(DPR, …)` call sites — they collapse correctly at 1, and removing them is a large refactor with zero runtime benefit.               |
| D3  | Constant name                | **Keep the name `DPR`** (avoids churning ~60 call sites) and replace its comment to state it is a fixed document scale, no longer the device ratio.                                                                          |
| D4  | Display scale                | **Not decoupled.** Keeping the display canvas at 2× while cells are 1× would need `renderFrame` to carry two scales and would only upscale 1× source art. Rejected.                                                          |
| D5  | Existing projects            | Old 2× art **downsamples once on open**, no migration code. The save format is scale-agnostic: PNGs store at whatever the canvas was, and `loadProjectBlob(blob, dpr)` redraws them into a canvas at the current scale.      |
| D6  | Export behavior change       | Accepted and documented: a 1920×1080 project now exports 1920×1080 on every device instead of 4K from iPad.                                                                                                                  |
| D7  | Autosave — zip level         | Store frame PNG entries at **level 0**, matching the existing treatment of audio (`project-file.ts:218`). Removes a DEFLATE pass over already-compressed bytes.                                                              |
| D8  | Autosave — flush             | Flush the pending autosave on `pagehide` / `visibilitychange → hidden`, so a tab kill costs nothing rather than up to 3s.                                                                                                    |
| D9  | Incremental encoding         | **Deferred.** Only re-encoding dirty cells needs a dirty flag threaded through every mutation site. Revisit after measuring with the 4× reduction in place.                                                                  |
| D10 | Offline                      | **Manifest-only, no service worker.** Gets the standalone window and storage benefits with zero dependencies. Offline launch is additive later via `vite-plugin-pwa`.                                                        |
| D11 | Status bar style             | **Opaque** (`black`), so iOS reserves the status bar and no `env(safe-area-inset-*)` layout work is needed. The translucent style reclaims ~20px but adds iPad-only inset risk.                                              |
| D11a | `viewport-fit` (revised during review) | **Omitted.** D11 originally paired the opaque status bar with `viewport-fit=cover`, reasoning only about the top. Review caught that `cover` makes **every** inset non-zero — including the **bottom**, the home-indicator strip on Face-ID iPads — while the opaque status bar reserves only the top. The app does no safe-area padding and pins its status bar and playbar to the bottom, so `cover` risks putting them under the swipe strip while buying nothing with an opaque bar. Add it back only together with `env(safe-area-inset-*)` handling. |
| D12 | Icons                        | **Generated**, not hand-drawn: a committed Node script rasterizes a simple ink-stroke mark directly to PNG. No new dependency (no rasterizer is installed and none is added).                                                |
| D13 | Storage bucket migration     | **Documented, not coded.** An installed web app gets its own storage bucket; existing autosave will not appear inside it. The user saves to Files, then Opens once inside the installed app.                                 |

## Architecture

### Part 1 — document scale

**`src/state/appState.svelte.ts:163`**

```ts
// was: export const DPR = Math.max(1, Math.floor(window.devicePixelRatio || 1));
export const DPR = 1;
```

The comment above it is replaced to explain that this is the **document raster scale** (device pixels
per logical pixel in cell canvases, the display canvas, scratch buffers, and export), deliberately
fixed at 1 — not read from `devicePixelRatio` — because hi-res is a non-goal and the constant sets
per-cell RAM, autosave encode cost, and export dimensions.

Nothing else changes. `DPR` is a single exported constant consumed consistently as a device-px-per-
logical-px factor by cell allocation (`appState` `create`/`createCellCanvas`), the display and scratch
canvases (`Canvas.svelte:185`, `961`, `1002`), hit-testing and fill (`Canvas.svelte:242-252`,
`339-340`), selection/pose lifts (`Canvas.svelte:530-531`, `761-781`, `878-886`), gizmo box math
(`RefTransformGizmo.svelte`, `contentBoxLogical`/`groupBoxLogical`), and export (`ExportDialog.svelte`).
Every one of those expressions is correct at 1.

`cell-ink.ts`'s `probeEmpty` derives its downscale ratio from `canvas.width`, so a smaller source
canvas is probed at a proportionally less extreme downscale (e.g. a 2px-wide stroke into a 30:1 probe
at half scale, vs. a 4px-wide stroke into a 60:1 probe at the old scale, both bounded by
`MAX_PROBE = 64`). The effect on detection is **neutral**: the stroke's coverage fraction of a probe
pixel is unchanged, so thin-stroke detection behaves the same as before — this is not extra safety
margin, and `MAX_PROBE` should not be tightened on the strength of it.

### Part 2 — autosave

**`src/persist/project-file.ts`** — `saveProjectBlob` writes frame entries as
`[bytes, { level: 0 }]` instead of bare `bytes`, mirroring the audio entry. PNG is already
DEFLATE-compressed internally; re-deflating it costs CPU and saves ~nothing.

**`src/App.svelte`** — the existing 3s-debounced autosave effect gains a companion listener: on
`pagehide`, and on `visibilitychange` when `document.visibilityState === "hidden"`, clear the
pending timer and run `saveAutosave(state.project)` immediately. Both the debounce and the flush
are gated by two flags: `autosaveReady` (set only after the startup restore settles, because
`state.project` is a blank `createProject()` until then, and an unguarded flush during restore
would overwrite the saved slot with an empty document) and `autosaveDirty` (to avoid re-encoding
an unchanged project on every app switch). The write is async and may not complete if the tab is
killed mid-write, so this reduces the loss window rather than eliminating it — an acceptable,
strictly-better-than-today guarantee.

### Part 3 — PWA metadata

**`index.html`** — the existing viewport meta is left **unchanged** (see D11a — `viewport-fit=cover`
was dropped during review); new tags:

```html
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black" />
<meta name="apple-mobile-web-app-title" content="slop" />
<meta name="theme-color" content="#1e1e1e" />
```

**`public/manifest.webmanifest`** (new; creates `public/`, which Vite serves from the root):

```json
{
  "name": "slop-animator",
  "short_name": "slop",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#1e1e1e",
  "theme_color": "#1e1e1e",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Colors match the dark theme (`app.css` `.dark` `--color-surface: #1e1e1e`), which is the default —
`index.html` sets `class="dark"` on `<html>`. Paths are root-absolute, matching the `<link>` hrefs
and the default Vite `base` — a subpath deploy would need `base` and these updated together.
`orientation: "any"` because an iPad drawing app must rotate.

**`tools/make-icons.mjs`** (new) — a dependency-free Node script that writes the four PNGs into
`public/`. No SVG rasterizer is installed (`magick`, `convert`, `rsvg-convert` all absent) and the
design adds none, so the script rasterizes analytically and encodes PNG with Node's built-in `zlib`:

- Mark: a single tapered diagonal ink stroke — light (`#e0e0e0`) on the dark surface (`#1e1e1e`),
  matching the app's monochrome ink identity.
- Rasterized from a signed distance to a line segment with a linearly varying radius, giving
  antialiased edges without any drawing library.
- Encoder: RGBA8 IHDR + a single zlib-deflated IDAT of filter-0 scanlines + IEND, with CRC32.
- The maskable variant redraws the same mark inset to ~60% of the canvas so Android's safe-zone crop
  cannot clip it.

Outputs are **committed** to `public/`; the script exists so they can be regenerated, and is not
wired into the build.

## Non-goals

- **Service worker / offline launch.** Deferred (D10).
- **LRU cell eviction and tiled cell storage.** The roadmap's tiling item is untouched; eviction is
  reconsidered only if measurement after this change shows a remaining problem (D1, D9).
- **Incremental / dirty-cell autosave encoding.** Deferred (D9).
- **A project library / multi-slot autosave.** Discussed during brainstorming as the third iPad
  candidate; explicitly out of scope here.
- **Desktop File System Access** (save-in-place, reference auto-relink). Ruled out earlier in the same
  session: the API is absent from WebKit, so it cannot work on iPad at all.
- **Any change to reference re-linking.** Unchanged; still a manual re-pick.
- **A user-facing resolution setting.** The scale is a constant, not a preference.

## Testing & verification

- `npm run build` — **0 errors, 0 warnings** (the project bar).
- `npm test` — the ~280 baseline must still pass. Note the existing tests fix their own `dpr`
  arguments and are largely independent of the constant; they will not, on their own, prove Part 1 is
  correct.
- **Manifest:** validate `manifest.webmanifest` parses and Chrome DevTools → Application → Manifest
  reports no errors; confirm all four icon files resolve.
- **Browser/iPad pass — required before this is called done.** Per the project's verification-debt
  rule, canvas/DOM behavior is not node-testable. Part 1 has a one-line diff but a codebase-wide
  effect, so the pass must cover:
  - drawing alignment for every brush (smooth / ink / pencil / charcoal / airbrush) and the eraser
  - brush cursor size matching the actual stroke width
  - fill (`floodFill` takes `pt * DPR` coordinates)
  - selection + lasso lift / move / commit, and cut/copy/paste of pixels
  - deform and pose lift/bake, and the pose handle reach dial
  - transform gizmo box alignment at all three scopes (frame / layer / group)
  - onion skins and the WebGL boil path
  - export: confirm a 1920×1080 project produces a 1920×1080 MP4/WebM and PNG sequence
  - opening a project saved at 2× — art downsamples cleanly, nothing misaligns
  - memory: confirm the drop in practice on a multi-keyframe project
- **iPad install pass:** Add to Home Screen; confirm it launches standalone with no Safari chrome,
  rotates, shows the icon and title, and that a project saved to Files opens inside the installed app.

## Risks

- **Part 1's blast radius is disproportionate to its diff.** Any latent place that assumed `DPR > 1`
  — or that accidentally cancelled a stray factor of 2 — will surface as misaligned strokes or boxes,
  and unit tests will not catch it. This is the reason the browser pass above is exhaustive rather
  than a spot-check. Mitigation if something is wrong: the change is trivially revertible.
- **Softer lines past 100% zoom** on the iPad's Retina display. Accepted (D1).
- **Downsampling is one-way.** Opening an existing 2× project at 1× and saving replaces the stored
  PNGs at the lower resolution. Anyone wanting the original pixels must keep the old file. Worth
  telling the user before they open their existing work.
- **`pagehide` is not a guarantee.** iOS may kill a backgrounded tab before an async IndexedDB write
  lands (D8). Strictly better than today, not a promise.
- **Installed-app storage is a separate bucket** (D13). If this is missed it reads as "the install
  lost my project."

## Files touched

| File                                | Change                                                        |
| ----------------------------------- | ------------------------------------------------------------- |
| `src/state/appState.svelte.ts`      | `DPR = 1` + replacement comment                               |
| `src/persist/project-file.ts`       | frame PNG zip entries at `level: 0`                           |
| `src/App.svelte`                    | flush autosave on `pagehide` / `visibilitychange → hidden`    |
| `index.html`                        | manifest / apple-touch / iOS meta tags (viewport meta unchanged — D11a) |
| `public/manifest.webmanifest`       | new                                                           |
| `public/icon-180.png`               | new (generated, committed)                                    |
| `public/icon-192.png`               | new (generated, committed)                                    |
| `public/icon-512.png`               | new (generated, committed)                                    |
| `public/icon-512-maskable.png`      | new (generated, committed)                                    |
| `tools/make-icons.mjs`              | new — dependency-free PNG generator                           |
