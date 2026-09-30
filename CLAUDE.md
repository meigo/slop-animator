# slop-animator — project guide for Claude

A browser-based, low-framerate, monochrome ink-outline, **frame-by-frame bitmap animation** app.
Used heavily on **iPad with Apple Pencil** (iPad-first; mouse/desktop also supported). Svelte 5 +
TypeScript + Vite + Tailwind 4 + Vitest.

> This file is the handoff/index. The **detailed design rationale lives in `docs/superpowers/specs/`
> and `docs/superpowers/plans/`** (one spec+plan per feature, dated) — read the relevant ones before
> changing a subsystem. This file captures conventions, hard-won gotchas, current state, and the
> roadmap so you can pick up cold. **The full dated feature/fix history (append-only log) lives in
> `docs/superpowers/CHANGELOG.md`** — split out 2026-09-03 to keep this file small, since it loads
> into every session automatically and the changelog does not. Nothing was cut; it's a straight move.

## How to read this file

- **This applies to `docs/superpowers/CHANGELOG.md` too** — that file holds the dated feature/fix log
  this section used to end with; this file (`CLAUDE.md`) now holds only the evergreen material
  (commands, workflow, architecture map, gotchas, current-state summary, roadmap). Same append-only/
  supersession rules apply there.
- **It is an APPEND-ONLY LOG. Later entries supersede earlier ones.** Where two entries disagree, the
  later one is current — check the date on each before acting on either.
- **When the code and this file conflict, the code is more likely to be right.** Check `git log` for
  the change first: several commits converging on one answer, or a message that states the intent, is
  a DECISION — not drift for a reviewer to correct. Update this file instead of the code, and ask if
  you are unsure. (Reverting a deliberate decision because this file still described the old one has
  already happened once — see the entry `All three resize grips are bare edges` in CHANGELOG.md.)
- **When you supersede an entry, MARK THE OLD ONE** with a one-line `> **SUPERSEDED …**` blockquote
  pointing at the new one. An unmarked stale rule is indistinguishable from a live one, and an agent
  that greps and lands on it first will act on it.

## Commands

- `npm run dev` — Vite dev server (localhost, HTTP).
- `npm run dev:lan` — `HTTPS=1 vite --host` for iPad testing over LAN (Clipboard API + secure-context
  features need HTTPS; accept the self-signed cert once on the iPad). Note: corporate/guest Wi-Fi
  with client isolation can block iPad→Mac entirely — a tunnel (cloudflared/ngrok) is the fallback.
- `npm run build` — **`svelte-check && tsc --noEmit && vite build`**. The bar for every change is
  **0 errors, 0 warnings.**
- `npm test` — Vitest (node env, no DOM). Baseline **1519 passing**. Canvas/DOM code isn't
  node-testable; only pure logic is unit-tested.
- `npm run deploy` — build, then `wrangler deploy` to Cloudflare Workers static assets. Builds first
  on purpose, so the 0-errors/0-warnings gate always runs before anything ships. Config is
  `wrangler.jsonc`: **assets-only, no `main`/Worker script** — static-asset requests are free and
  unlimited on every plan, and only Worker invocations are billed, so adding a Worker would start
  metering traffic for no benefit. The deployed HTTPS URL is the practical way to test on iPad
  (real certificate — unlike `dev:lan`'s self-signed one, which iOS treats as a second-class secure
  context) and is what makes Add-to-Home-Screen behave. Git-connected builds (Workers Builds) would
  read the same `wrangler.jsonc` with no changes, but a CLI deploy uploads ~8 built files in seconds
  where a cold CI build takes minutes — hence CLI-first.
- `npm run lint` / `npm run format` — ESLint (incl. `eslint-plugin-svelte`, runes-aware) + Prettier.
- **Pre-commit hook** (husky + lint-staged) auto-runs `eslint --fix` + `prettier --write` on staged
  files — expect reformatting on commit; it's fine.

## Development workflow (IMPORTANT — this project uses the `superpowers` skills)

Non-trivial work follows: **brainstorming → write spec (`docs/superpowers/specs/YYYY-MM-DD-*.md`) →
writing-plans (`docs/superpowers/plans/`) → subagent-driven-development (fresh subagent per task,
spec + code-quality review between) → finishing-a-development-branch.** Bug fixes use
**systematic-debugging** (find root cause before fixing — instrument/measure, don't guess).

- Branch off `main`; merge with `git merge --no-ff` only when the user says so. One commit per task.
- The user reviews/approves the spec before the plan, and the plan before implementation.
- After a feature, the design rationale is preserved in its spec/plan — link to them.
- Commit message trailer used here: `Co-Authored-By: Grok <noreply@x.ai>` (Claude-era commits used
  `Co-Authored-By: Claude <noreply@anthropic.com>`).
- **Keep `README.md` current as part of the change, not later.** It is the public face of a public
  repo, so a feature that changes what the app DOES (not how it's built) is not finished until the
  README says so. Check these specifically, since each has gone stale before: the **Features** bullets
  (a shipped phase still described as "phase 1"), the **test count** in the scripts block (run
  `npm test` — don't guess), the **Roadmap** paragraph (delete what shipped), and the **Keyboard**
  section (any new shortcut). CLAUDE.md is the detailed internal log; the README is the short user-
  facing summary — don't paste internal detail into it.

## Architecture map

- `src/anim/document.ts` — core model: `Project`, `DrawingLayer`/`ReferenceLayer` (`Layer`), `Cell`
  (`key`{canvas, optional transform/transformBox} | `hold`), `LayerGroup`, `RefTransform`,
  `transformBaseRect`, `cellTransform`/`resolvedKeyCell`, keyframe resolution.
- `src/anim/render.ts` — `compositeFrameLayers`/`renderFrame`; `drawTransformed` (refs),
  `drawCellComposed` (draw cells, composes `layer ∘ cell`); 2D path + WebGL **boil** path.
- `src/anim/onion.ts` — onion-skin ghosts. `src/core/boil-gl.ts` — WebGL line-boil.
- `src/core/brush.ts` (perfect-freehand "smooth"), `ink-brush.ts`, `stamp-brush.ts`
  (pencil/charcoal/airbrush), `pressure-curve.ts`, `ref-transform.ts` (gizmo math:
  `inverseTransformPoint`/`forwardTransformPoint`/`applyMove|Scale|Rotate`), `selection.ts`,
  `fill.ts`, `input.ts`. `src/lib/cell-ink.ts` — per-cell ink/`contentBounds` caches.
- `src/state/appState.svelte.ts` — the global `$state` store (`state`), all mutation actions,
  history/undo, preferences gather/apply. **The single source of truth.**
- `src/lib/*.svelte` — UI: `Canvas`, `Toolbar`, `LayerList` (one-line rows) + `LayerProps` (the selected
  row's properties strip above it), `Timeline`, `Playbar`, `AudioLane`,
  `RefTransformGizmo`, `BrushCursor`, dialogs.
- `src/persist/` — `project-file.ts` (zip: project.json + PNG per key cell; autosave + export),
  `preferences.ts` (localStorage), `autosave.ts` (IndexedDB, ~3s debounce).
- `public/favicon.svg` — the slop mark in the family blue `#667fff`; `node tools/make-icons.mjs`
  regenerates the PNG icons from it. Each slop app has its own colour, listed in
  `../SLOP-FAVICON-COLOURS.md`.

## Gotchas (each cost real debugging — don't relearn them)

1. **Svelte `$state` import-alias rule.** All components are runes mode now (`svelte.config.js` sets
   `compilerOptions.runes: true`). A component that uses the **`$state` rune** CANNOT
   `import { state } from appState.svelte` — it trips `store_rune_conflict` (compiler can't tell the
   rune from `$`-subscribing a store named `state`). **Fix: `import { state as appState }`** and use
   `appState.`. `$effect`/`$derived`/`$props` do NOT collide (those files may keep `{ state }`).
2. **SortableJS layer reorder** (`LayerList.svelte`): SortableJS and Svelte both author the DOM. After
   a drop, read the new order from the DOM → update store → bump `dragNonce` wrapped by
   `{#key dragNonce}` for a full rebuild, **AND** `evt.item.remove()` the relocated node (a
   bottom-drop lands past the `{#each}` end-anchor so the keyed teardown misses it → duplicate row).
   Guard with a one-shot latch — SortableJS fires `onEnd` twice on cross-list drops.
3. **perfect-freehand `size` is a RADIUS basis**, not diameter: with `thinning:1` the rendered
   diameter is `2×size`. `brush.ts` passes `maxSize/2` so smooth strokes match the stamp/ink engines
   and the brush cursor. Don't "fix" it back.
4. **Transform compose model** (read `docs/superpowers/specs/2026-06-22-per-cell-transform-design.md`
   and `docs/superpowers/specs/2026-06-23-group-transform-design.md`):
   transforms nest **`group ∘ layer ∘ cell`** at render. Forward render = `drawCellComposed` (takes
   optional outer group args); the draw-through inverse must be `cell⁻¹(layer⁻¹(group⁻¹(point)))`
   (outermost first), and the gizmo's `outer: ComposeStep[]` (inner-to-outer) pushes corners through
   `forwardChain` and pointer through `inverseChain`. **Units:** render/bake = DEVICE px (`×dpr`);
   gizmo/inverse/`contentBoxLogical`/`groupBoxLogical` = LOGICAL. A stray dpr factor or wrong
   compose order = strokes land wrong (won't show in tests — verify in browser).
5. **`transformBox` is frozen on gizmo grab** (per cell/layer/group) to avoid the moving-pivot jump
   when you draw more on a transformed target. Group bbox = union of member draw-layer
   `contentBounds` at the current frame (refs excluded; empty group → full-doc).
6. **Transform drags push one undo step per completed gesture** (2026-08-09; supersedes the old "gizmo
   drags don't push undo" note — that's no longer true). Both drag paths — `Canvas.svelte`'s on-canvas
   frame/layer/group drag and `RefTransformGizmo.svelte`'s handle drag — snapshot via
   `beginStructuralEdit()` at grab, **before** the frame-scope cell replacement (`dl.cells[i] =
{...cell}`, per gotcha #8, so the snapshot captures the old shared cell), then commit via
   `commitStructuralEdit()` at release **iff** `isSameTransform(startT, endT)` says the transform
   actually changed — a click-without-move (or any no-op drag) pushes nothing. On a no-op, the
   `transformBox` freeze taken at grab is reverted through **direct object refs held from grab time**
   (`refDragFreeze`/`dragFreeze: { cell, group, prevBox }` in each file), never re-resolved via
   `activeLayerId`/`playhead` at release — re-resolving was a real review-caught bug (a mid-gesture
   layer/frame change could stomp an unrelated cell's box), fixed in `cde3b4a`. Ref-layer transforms
   are now restored by `restoreStructure` (transform restore moved out of the draw-only branch), so
   ref-layer drags are undoable too. The gizmo's "Reset to fit" button routes through the same
   undoable `resetCellTransform`/`resetGroupTransform`/`resetLayerTransform` actions rather than a
   direct mutation. **CLOSED 2026-08-14 — `input.ts` binds `pointercancel` (`input.ts:201`, routed to
   the same `onPointerUp` as up/leave), so an OS-cancelled stream (iPad palm rejection) ends the
   gesture instead of leaving `refDrag`/`refDragUndo`/`refDragFreeze` set** for the next gesture's
   grab block to skip re-snapshotting and then commit as one merged undo entry. That was the gap this
   feature shipped with; it is not a live hazard. The binding is not a full abort-restore — the
   cancelled gesture SETTLES rather than reverting. The gizmo's own handle-drag path was never
   affected either way, since it binds `pointercancel` itself on `window`.
7. Mouse strokes report no pressure (`hasPressure:false`) → drawn at constant nominal width
   (`sizeRange` collapses to 1); only pen pressure widens.
8. **Undo snapshots SHARE cell/canvas object refs** (`cloneLayers` only `slice()`s the array). A
   structural mutation must **replace** a cell (`layer.cells[i] = {...}`), **never mutate in place**
   (`cell.transform = ...`) — in-place edits corrupt the before-snapshot and no-op undo. `restoreStructure`
   keeps the live layer only when `live.kind === snap.kind`, and restores `groupId` (structural).
9. **Tool lifts** (selection float / deform warp / pose mesh) capture `selCtx`/`selBefore` at lift time.
   Any state change that re-targets/destroys that canvas must bank or discard the lift first via the
   `Canvas` effects (`bankActiveEdits` on layer/frame switch) or the **`liftGuard`** hooks: **`bank`**
   (apply — before merge / bake / flip / resize / layer and timeline edits / paste, since 2026-09-29)
   or **`discard`** (cancel — only replaceProject, undo/redo via `undo()`/`redo()`, and export). New
   canvas-recreating ops call `bank` unless applying is meaningless there.
10. **Any draggable surface needs `touch-action: none`** (element style or CSS), or on iPad the browser
    hijacks a Pencil/finger drag as a scroll/pan and cancels the pointer stream — the drag silently does
    nothing. Pointer events + `setPointerCapture` are NOT enough on their own. The canvas, timeline rows,
    ruler, resize grip all set it; the pressure-curve editor lacked it and didn't drag on iPad until fixed
    (`pressure-curve.ts`, `cvs.style.touchAction = "none"`). Add it to every new drag control.
11. **$state proxy identity — never hand a RAW model object to a non-reactive reader.** Assigning
    `state.project.audio = track` then `audioEngine.setTrack(track)` gave the engine the raw object;
    every later UI write (`state.project.audio.offsetFrames = …`) goes through the $state proxy and
    the raw target never sees it — the engine read offset 0 forever (audio P2 bug, 2026-08-09). Pass
    the proxy read back AFTER assignment (`setTrack(state.project.audio)`). Applies to any
    singleton/module that caches model objects outside the store.
12. **Svelte 5 delegates `pointerdown`.** A child's `onpointerdown` + `stopPropagation` runs at the
    _document_, AFTER a native bubble listener on an ancestor. The selection action bar lives inside
    `stage`, so `setupInput`'s listener treated a tap on Free transform / Distort / Mesh as "click
    outside → cancel + start a new marquee" — selection vanished, no gizmos. `stopPropagation` in
    the button is too late. Filter `.selection-actions-panel` in `setupInput` (pen/mouse) the same
    way `touch-gestures.ts` already did for fingers. Any new chrome inside the stage needs the same
    class (or an explicit `setupInput` ignore).
13. **Selection geometry is DOCUMENT space (the paper).** Viewport pan/zoom still apply;
    group ∘ layer ∘ cell does not. Overlay must not applyCompose the ants. Pixel ops
    (clip/lift/copy/commit) map through inverseChain via selection.composeSteps.
    Switching layers keeps the ants put; a live lift still banks (gotcha #9).
14. **iOS WebKit paints a full-height opaque `sticky` overlay OVER higher-z sticky siblings.** The
    timeline's gutter plate (out of flow, `top-0 left-0 z-15`, opaque) covered the z-20 name labels and
    the z-35 ruler on every iPad browser whenever the rows did not fill the panel, while desktop Chrome
    and desktop WebKit drew it correctly — so neither can reproduce it. Proved by a `?tl=` bisect build
    on the device, after a first guess (a min-height floor) failed. Don't layer an opaque sticky box
    BEHIND sticky content; make it occupy only the space where nothing else is (Timeline's gutter
    filler below the last row). See the 2026-09-11 changelog entries.
15. **Chrome for iPad leaves the app shifted up after ANY on-screen keyboard — a Chrome bug, accepted
    (2026-09-14).** It is not caused by where the field sits (a layer rename at the top triggers it too), and
    Safari is fine. Measured on the device: after the keyboard closes, `visualViewport.height` stays 813
    on an 892px screen. The app shows pushed up about 79px, toolbars hidden, with a blank band below.
    That survives a reload and only a new tab clears it. With every page measurement back at 0 (window
    scroll, `#app` rect, every element's `scrollTop`), the picture stays shifted, so the offset is in
    Chrome's native view, out of the page's reach. Tried and failed: moving the marker editor to the
    top, resetting page scroll, sizing the app to `visualViewport.height` (made a permanent blank
    band), and `touch-action: none` on html/body. Don't retry those. Still true, and why inputs stay
    in dialogs, the layer panel or the top bar: `#app` is `position: fixed`, so iOS cannot scroll a
    field above the keyboard. Desktop browsers reproduce none of this.
16. **A `type="number"` input owns pointer gestures for its own spinner, so a numeric field that
    needs to be press-and-drag-scrubbable (2026-09-18, `NumberField.svelte`) must be
    `type="text" inputmode="decimal"` instead** — a `type="number"` field never sees the pointermove
    that would drive the drag. It still needs `touch-action: none` (gotcha #10) and stays an
    `<input>` so `App.svelte`'s INPUT/TEXTAREA guard keeps single-key tool shortcuts out while it's
    focused.
17. **Never re-render the document from a pointermove handler.** `Selection.updateDrag` fires
    `onChange` on every move; wiring that straight to `recomposite()` re-rendered every layer, every
    onion ghost and every reference-video frame 120-240 times a second on iPad (Pencil event rate).
    Invisible on desktop and with plain layers — crippling with onion skins or a reference video, and
    it shipped that way from the first selection commit until 2026-09-18. Coalesce to one animation
    frame (`scheduleRecomposite`, the treatment `drawRaf` gives stroke painting), or skip it entirely
    where the display cannot have changed — during a selection drag the dragged pixels are on the
    overlay and the cell's hole is already composited. See the 2026-09-18 changelog entry.

18. **`preventDefault()` on `touchstart` kills NATIVE activation inside the stage's floating
    panels.** `touch-gestures.ts` blanket-prevented every touch on the workspace so a finger pans
    instead of scrolling; on iOS that also suppresses the click WebKit synthesises, so the pose bar's
    "Fill outlines" CHECKBOX could not be toggled and a tap could not focus its Gap field — while
    every button beside them worked, because those act on `pointerdown` and never needed the click.
    Exempt `.selection-actions-panel` (`shouldPreventTouchDefault`), exactly as the pointerdown
    handler already did — gotcha #12 is the same class, for the same panels, one layer up. A control
    inside the stage that relies on native activation needs this; one that handles `pointerdown`
    itself does not. Desktop reproduces NEITHER (no touch events).

## Current state (all shipped & merged to `main`)

Frame-by-frame drawing (smooth/ink/pencil/charcoal/airbrush brushes, separate brush vs eraser
settings, pressure curve, eyedropper, brush/eraser size cursor), fill, selection/lasso transform,
layers + visual groups (collapse/visibility/drag-reorder), onion skins, WebGL line-boil, timeline
(keyframe/hold, scrub — perf-tuned), playback, audio Phase 1, MP4/WebM export (mediabunny), animated
GIF export (gifenc), reference layers (image/video, transform gizmo, metadata-only persistence + re-link), clipboard
image paste + rasterize-to-drawing-layer, **per-layer free transform**, **per-cell (current-frame)
transform**, and **per-group transform** (group transform composes above the layer for
character-rig moves; Reset-only this phase, no Apply). **As of 2026-09-11 the Transform tool has no
scope toggle: it acts on the selected row** (layer / reference → that layer, group → the group); per-cell
transforms can no longer be created, only baked or cleared where saved projects still carry them,
autosave + global preferences. Whole codebase is Svelte 5 **runes**; Prettier + ESLint + pre-commit
hooks in place.

Shipped since (2026-06 → 07): **Deform tool** (FFD grid-warp reusing the selection warp engine +
**Rigid/MLS** mode); the **Pose tool** — silhouette triangulation (`triangulate.ts`, `delaunator`) →
geodesic-weighted MLS (`geodesic.ts` `poseWeights`/`mesh-pose.ts`), lift/pin/bake, with a **unified
per-handle gizmo** (one nub: direction = rotation, distance = geodesic **reach** with a dial circle +
affected-region tint; context-aware default reach); **transparent background** (`Project.transparentBg`)

- checkerboard editor view + **paint-behind** toggle; a **Project Settings dialog** (bg color / transparent
  / fps, gear button); and a **tool-lifecycle cleanup pass** (bank/discard in-progress lifts on tool /
  layer / frame switch, layer visibility & lock, and before canvas-recreating ops / undo via `liftGuard`).
  A 2026-06-29 **multi-agent code review** fixed 8 undo/data-loss + lifecycle bugs (batches A/B/C). Test
  baseline ~**280**. See `undo-snapshot-and-lift-lifecycle-invariants` memory for the two hardened invariants.

Shipped 2026-09-10: **Loop keys** — a Moho-style loop cell replays the frames before it until the
next key (blank key, another loop, or document end), shown on the timeline as a teal back-arrow
with ghosted repeats, a Loop toolbar button, and a draggable arrowhead to resize the cycle. Frames
a loop plays are read-only on the canvas (draw/erase/fill/lift tools blocked, captioned with the
source frame); property tracks (transform/opacity) play straight through the remap. See the
2026-09-10 changelog entry for the save-format and merge-down details.

Transforms are per-axis (scaleX/scaleY; negative = mirrored): side handles stretch, corners keep
proportions (toggle), Flip H/V in the Transform bar (2026-09-11).

Shipped 2026-09-13: **Timeline markers** — `Project.markers?` (`{frame, label}`, sorted, one per
frame, pure ops in `src/anim/markers.ts`) in a `MarkerStrip.svelte` row under the ruler. They ripple
in `rippleDocumentFrames` (a delete joins two labels onto one frame), are cut by
`applyAnimationLength`, sit in `StructSnapshot` by reference (never mutate the array), and save as an
optional `markers` field. `n` adds, `<`/`>` jump. See the 2026-09-13 changelog entry.

Shipped 2026-09-18: **Drag-to-change number fields** — all nine numeric inputs (brush size, fps ×2,
Length, canvas W/H, pose gap, video speed, track step) are `NumberField.svelte` + `core/scrub.ts`:
press and drag sideways to scrub the value (Shift = finer steps), or tap to type as before. See the
2026-09-18 changelog entry for the per-field step table and the two undo-commit shapes.

Shipped 2026-09-29: **Stream as a rope, Smooth smooths the path** (port from slop-paint) — Stream trails the line
on a string of up to 40 screen px (`src/core/stroke-smoothing.ts`, run in `input.ts`), the same at any
pointer rate, pulling in to a corner where the pen pauses; Smooth averages the Smooth brush's path in
document space in `Canvas.svelte` `paintStroke`, with an optional **Sharp corners** checkbox. See the
2026-09-29 changelog entry.

Shipped 2026-09-24: **Outline tool** — turn a solid drawing into an outline by a signed distance field
built from alpha, seeded sub-pixel to carry anti-aliasing, with a noise-modulated band: **Thickness**
(1-24px), **Wobble** (the line wanders inward/outward), **Variation** (it swells and thins), re-roll button,
preview live then Apply or Cancel. Distinct from Pose/Deform: cancels on tool/layer/frame switch, lock,
undo, resize. See the spec and plan in `docs/superpowers/`.

## Roadmap / deferred (wanted-later, not abandoned)

- **Port from slop-paint: stroke smoothing + tiled undo** (queued 2026-09-28, "port to animator later"). Both were found and fixed in slop-paint first; this app has the same code. (1) **Stream / Smooth** — **SHIPPED 2026-09-29** with slop-paint `2b7f465` folded in; see the CHANGELOG entry for where it differs from slop-paint (the rest of this item is the pre-port analysis) (slop-paint `0ad830e`, `c13ed06`; `src/stroke-smoothing.ts`, `input.ts`, `brush.ts` there): our `src/core/input.ts` Stream is a per-EVENT average (`t = 1 − 0.88v`), so it weakens as pointer rate rises — at 100% a 240 Hz Pencil kept 1.9 of a 3 px wobble; slop-paint replaced it with a screen-space rope (lazy brush, up to 40 px, squared curve) that pulls in to where the pen came to rest after a 50 ms pause, so corners are kept. Our `src/core/brush.ts` feeds the Smooth slider to perfect-freehand's `smoothing`, which is only outline point spacing and is capped by `decimationSmoothing` (≤ 22% has any effect at Press 3); slop-paint made Smooth average the path both sides by arc length (no lag, ends pinned), with an optional "Sharp corners where you pause" (off by default — the rounded corner is liked). (2) **Undo budget** — **SHIPPED 2026-09-29**; see the CHANGELOG entry. **Correction:** the "dpr 2 … 66 MB … ~4 steps" below is slop-paint's arithmetic; this app's `DPR` is fixed at 1, so a 1920×1080 step was 16.6 MB and the budget held 16 (4 only at 4K) (slop-paint `610d67d`): our `src/anim/history.ts` `pixelCommand`s hold whole snapshots against a 256 MB budget — at dpr 2 a 1920×1080 canvas is 66 MB a step, ~4 steps. slop-paint keeps only the changed 64-px tiles (`changedTiles` / `cropPixels`). Check this app's cell canvas sizes first to confirm, and keep `src/lib/cell-ink.ts`'s ink-changed marking working (it relies on `pixelCommand`). Callers: `src/lib/Canvas.svelte`, `src/lib/Timeline.svelte`. (3) **Layer switch mid-transform — a consistency choice, not a bug** (added 2026-09-29) — **structural-op half SHIPPED 2026-09-29** (`liftGuard.bank`; see the CHANGELOG entry); the layer-switch half already applied here: slop-paint `847f7ee` fixed Apply landing a float on whichever layer was active by then. This app never had that bug — `selCtx` / `selLayer` pin the lifted cell, so Apply and Cancel act on it whatever is active — but `setActiveLayer` leaves the float open, its handles showing over another layer. slop-paint instead APPLIES it to its own layer on the switch, with a status message ("Applied the transform to … — undo to take it back"): leaving a float without Apply/Cancel applies it because Apply is undoable and Cancel isn't. Note that this app's `liftGuard.discard` CANCELS a live lift before structural ops (merge, bake, document swap …), which can't be undone; consider applying where the target canvas survives. (4) **Autosave during a stroke — not observed here, a precaution** (added 2026-09-29) — **SHIPPED 2026-09-29** as the same wait (`App.svelte` `autosaveWhenQuiet`; see the CHANGELOG entry): slop-paint `4064b59` found its autosave froze the page 0.5–0.9 s (Mac; more on iPad) and pen events arriving meanwhile were lost, so the stroke drew a straight chord across the gap — and the 3 s debounce counts from a stroke's END, so it fired about two seconds into the NEXT stroke. slop-paint now holds the timed save while any pointer is pressed and until 1.5 s after the last lifts (pointers tracked by id; one silent for 5 s counts as lifted). This app's timer (`App.svelte`, `persistTick` + 3 s) is the same shape, but `saveProjectBlob` is mostly async (`canvas.toBlob` per key cell, yielding between them; `zipSync` at level 0), so no single long freeze — yet each cell's pixel readback, and possibly WebKit's PNG encode, still runs on the main thread, so a save mid-stroke could cause several small hitches. Port the same wait if chords ever show up (or to keep the apps alike). (5) **Save / Save as to a real file in Chrome and Edge** (added 2026-09-29): slop-paint `89f810f` (`src/file-access.ts`) uses the File System Access API where it exists (Chrome/Edge desktop; `fileAccessAvailable()`): the document keeps the file it was saved to or opened from (session only), Save writes back to it and asks only the first time, Save as (Ctrl+Shift+S) always asks and moves the document to the new file, Open uses the same dialog so an opened file saves back to itself; a dismissed dialog is silent, a failed write aborts. This app's Save (`saveProject` in `src/lib/Toolbar.svelte`) still downloads everywhere, like slop-paint did. Opening here was NOT affected by slop-paint's Safari bug (`313496d`: `accept=".psd"` alone greyed PSDs out on iPad) — this app's picker already lists `.zip,application/zip` and reports a failed open. (6) **Layer blend modes** (added 2026-09-29): slop-paint `91eede8` added Normal, Multiply, Screen, Overlay and Add (Photoshop's Linear Dodge) per LAYER (`src/blend.ts`: stored by Photoshop name, `canvasOp` maps to `globalCompositeOperation` — Add is `lighter`; a PSD's other modes are kept and drawn when the canvas has them). Normal/Multiply/Screen/Add are also Spine's slot blend modes. Groups there have none (their members blend straight through, Photoshop's "pass through"); here groups carry transforms and opacity, so check how they're composited before deciding. Porting means: the layer model field, every compositing path (display, export frames/video/GIF, the PSD frame's merged composite — slop-paint unified its three into `LayerManager.drawTree` and found the export paths were ignoring group visibility and opacity, worth checking here too), onion skins (probably drawn Normal), merge down in the mode, undo, the project JSON, and this app's OWN PSD writer (`src/export/psd.ts`, not ag-psd): the blend key in each layer record (`norm`, `mul `, `scrn`, `over`, `lddg`). **Include the lifted selection** (slop-paint `f15dbf6`): there the overlay drew a float above every layer, always Normal, until Apply — so with blend modes a transform showed wrong until released. Its compositor now draws the float INSIDE its layer (`LayerManager.floatPreview`: layer + float on a reused scratch canvas, drawn in the layer's place with its opacity and mode), and the overlay keeps only handles, ants and grid. Check where this app draws `selCtx`'s float; Apply/Cancel must drop the preview before redrawing (slop-paint drew it twice for a frame at Apply). UI: a menu beside opacity in the layer strip (in slop-paint the slider shrinks and its number hides in the narrowest panel so it fits). (6) **Layer opacity slider rebuilds the layer list per step — MEASURED 2026-09-29, not worth porting yet:** 13 layers, 1280×720, desktop Chrome on the Mac: a slider step (input + Svelte `flushSync`) took 3.5 ms median, 5 ms p90, against slop-paint's 15 ms; revisit if the iPad feels it. Original note (added 2026-09-29): slop-paint `72564fa` found each slider step bumped `layerVersion`, rebuilding every row and thumbnail (~15 ms a step on a Mac, several times that on iPad, against 0.3 ms for the recomposite); it now repaints only the canvas and the readout during the drag and bumps once at release. Here `onOpacityInput` (`src/lib/LayerProps.svelte`) calls `bump()` per step on a static opacity, which bumps `state.version` and `persistTick`, and `LayerList.svelte` rows re-read `isCellEmpty(…, appState.version)`. Profile a slider drag on a many-layer document before porting. (7) **Ctrl+G for New group** (added 2026-09-29): slop-paint `809ec79` changed its New group to what this app's already does — put the selected layer into a new group (`groupActiveLayer`), the layer staying active — so only the SHORTCUT is new: Ctrl/Cmd+G runs the same action as the button (Photoshop's Group Layers; the button's title names it). Here `src/App.svelte` maps plain `g` to Fill; Ctrl+G must be checked before it, `preventDefault`ed (Cmd+G is the browser's Find next), and respect the button's disabled case (no layer row selected). slop-paint also wraps a selected GROUP (nesting); this app's groups are one level, so leave that out. (8) **Save in the Home Screen app** (added 2026-09-29, from slop-paint `af06e1d`; found by reading this app's code, not seen on an iPad): iOS can't download from a Home Screen (standalone) web app — the link does nothing. This app's exports already go to the share sheet on iPad (`deliverToFiles`), but File ▸ Save (`saveProject()` in `src/lib/Toolbar.svelte`) always downloads, so in the Home Screen app it silently does nothing; the ready dialog (`src/lib/ShareReadyDialog.svelte`) still offers "Download instead" there; and `deliver-file.ts` downloads a file the sheet won't take, which fails the same way. slop-paint added `isStandalone()` (`src/share.ts`: `matchMedia("(display-mode: standalone)")` or `navigator.standalone`): with `saveToFilesAvailable() && isStandalone()` Save takes the Save to Files path, and the dialog hides the download button. Browser and desktop unchanged. (9) **Bridge for the bucket** (added 2026-09-29, slop-paint `ccd6bd1`): here the fill options' Gap slider (`appState.fill.gap`, `src/lib/ToolOptions.svelte`) only reaches Fill enclosed; a bucket tap (`floodFill` in `src/lib/Canvas.svelte`, two calls) leaks through any break. slop-paint made one setting (renamed "Bridge") serve both: `fillMask` in its `src/fill.ts` (pure, tested) thickens the walls — pixels outside the tap's colour tolerance — by the gap (`dilateMask`), floods what's left from the tap, then grows the region back `gap` 8-connected steps over fillable pixels only (`growWithin`). Two traps its tests caught: growing back with a ROUND dilation leaves the inside corners of a box unfilled (~0.4×gap), and a diagonal step between two wall pixels slips through a 1px diagonal line — refuse it. A tap inside walls that the thickening swallows (a pocket narrower than 2×gap) floods without bridging. ~30 ms at 0, ~85 ms at 8 on 3840×2160 with thin lines. Also: this app's `src/core/fill.ts` still carries the old `alphaThreshold` option ("gap close") that slop-paint removed. Nothing here passes it, so it's dead code, but it's misleading. In slop-paint it did nothing above 32 (the tolerance already stops there) and refused a tap on a coloured area at any value above 0. (10) **Select the whole text on focus** (added 2026-09-29, slop-paint `085d9af`): there a text field's whole value is selected when it gains focus (layer rename, the brush size box, the project name), so typing replaces it and a second tap places the caret. It's a Svelte action (`src/lib/select-on-focus.ts`, ~30 lines): `setSelectionRange(0, length)` rather than `select()` (iOS ignores `select()` in some cases), and it cancels the focusing click's `mouseup`, which would collapse the selection again in Chrome and Safari (a keyboard focus has no mouseup, so the flag clears after 500 ms). Not on multi-line fields, where one key would wipe several lines. Here, layer rename (`focusSelect` in `src/lib/LayerList.svelte`) and the marker editor already open with the name selected, since they focus the field themselves when it appears. The ones that don't: the project name (`src/lib/ProjectSettingsDialog.svelte`) and the nine `NumberField`s (tap to type puts the caret where you tapped). In `NumberField.svelte` the action must not disturb press-and-drag scrubbing (gotcha #16): only a tap that ends without a drag should select. (11) **Paste says why it can't read the clipboard, and fetches an image copied only as its address** (added 2026-09-29, slop-paint `f388495`, `b5e837b`, `284059b`): (a) there a refused `navigator.clipboard.read()` (Chrome: its Clipboard permission blocked, or the prompt dismissed) now puts the browser's reason (`e.name: e.message`) in the status bar for 10 s, with a hint ("Allow Clipboard for this site, or use Cmd/Ctrl+V"; the `paste` event needs no permission). Before, it fell back silently, so an image copied in Chrome came out as "Nothing to paste". Here `pasteImage()` (`src/lib/Toolbar.svelte`, the Edit menu / button paste) swallows the error into a generic `alert("Couldn't read the clipboard (permission denied or unsupported).")`, and its other two outcomes are `alert()`s as well. Report the real reason, and prefer `statusHint` to `alert()` (an alert blocks the page). (b) When the clipboard holds no image the page can read, slop-paint looks for the image's ADDRESS (`imageUrlFromClipboard` in its `src/paste.ts`, pure and tested: an `<img>` src from `text/html`, else a `text/uri-list` or plain-text http(s) URL whose path ends in an image extension, so a copied page link fetches nothing) and fetches it (`cors`, no credentials; works only where the server allows cross-origin reads). A clipboard with no readable image names the types it does hold, so the next report says which case it is. **Caveat:** it was built for "Copy image" on Midjourney in Chrome on iPad and did NOT fix that case: the read showed no types at all, so the image sits in a pasteboard type WebKit doesn't expose to pages (perhaps WebP), with no address. Workaround there: save the image to Photos, then import it or copy it from Photos. It's kept for sites that copy only a link or an `<img>`. Here the result is a reference layer (`pasteImageReference`), and the Cmd+V path (`onPaste` in `src/App.svelte`) takes only `file` items, so it would need the same fallback. (12) **Autosave copies, a blank-layers guard, layer memory** (added 2026-09-30, slop-paint `2c53625`): on iPad a backgrounded 40-layer slop-paint document came back with every layer listed and EMPTY — iOS reclaimed the page's image memory — and the next autosave would have replaced the only stored copy. This app's autosave (`src/persist/autosave.ts`) is the same single `autosave` slot, with more canvases per project (cells × layers), so the same risk. slop-paint: (a) checkpoints — up to 3 older copies at least 5 min apart beside the latest, each with a meta (time, name, layer counts), plus a `autosave-kept` copy, listed in File ▸ Restore autosave… (`persist/autosave.ts`, pure `persist/autosave-plan.ts` `planCheckpoint`, `lib/RestoreDialog.svelte`); (b) a guard before every autosave and on `pageshow` / return to visible: which layers have pixels (each drawn into a 256-px probe at high smoothing) vs the last save; more layers emptied than undo steps since (`looksBlanked`) pauses autosave and opens the restore dialog, whose "Keep the blank layers" first copies the latest to the kept slot; (c) the Document menu shows the layers' image memory and warns on iPad above 600 MB (a guess). Here the probe would go over cells (key cells per layer), and the undo count is the history's own. Dev builds there expose `window.slopBlankLayers()` to test it. (13) **Engine bugs from slop-paint's code review** (added 2026-09-30): the shared engine files here carry the same bugs slop-paint's review found (2026-09-30, slop-paint `64952cd`, `5a408f3`): (a) `core/stamp-brush.ts` resets its leftover distance on every call (`let dist = 0` … `let pos = -dist`), so there is at least one stamp per input segment whatever the size — slow strokes far denser, a big soft brush 12–24× slower; slop-paint's `spaceStamps` carries `sinceLastStamp` across segments and calls (reset in `resetStampState`), tested. (b) The eraser's Opacity does nothing for Smooth, Ink and Calligraphy: `core/brush.ts` and `core/calligraphy-brush.ts` set `globalAlpha = 1` for the eraser, `core/ink-brush.ts:271` uses `isEraser ? 1`; use `settings.opacity / 100`. (c) Mouse stamps draw at half opacity: the stamp alpha is `opacity × (0.5 + p × 0.5)` and a mouse reports pressure 0; use 1 when `hasPressure` is false. (d) `core/selection.ts` `pasteFloat` sets `this.mode = "rect"`, so after a reference's handles (or a reload, if the tool is restored without `setTool`) a Lasso drag can make rectangles; slop-paint sets the mode from the tool at `startCreate`. (e) `core/touch-gestures.ts` pans/pinches/taps on a finger that lands mid-stroke (a resting hand moves the view, so the line jumps; a two-finger tap undoes under the open stroke); slop-paint added an `isDrawing` callback and ignores that whole gesture until the fingers lift, and ignores undo/redo while a stroke is open. Also check (not verified here): whether a stroke re-reads the active layer/cell on every event — slop-paint's did, so switching layers mid-stroke copied the first layer's pre-stroke pixels onto the new one (it now pins `strokeLayer` at pen-down); and whether saves or exports can capture a live Outline preview (slop-paint's `withPendingResolved`). (14) **More from slop-paint's code review** (added 2026-09-30, slop-paint `1c8b5fd`): (a) `core/selection.ts` `copyPixels` copies whole device pixels (`Math.round(r.x * dpr)`…) but leaves the selection rect fractional, so clearRegion clears and renderFloatingTo redraws off-grid: a marquee with fractional edges (zoom, Pencil) blurs the art on every move-and-Apply — slop-paint sets `this.rect` to the snapped pixels there (verified: move 10 px and back was identical with it, changed without). Check too (these depend on each app's own code): (b) a structural undo step pushed when nothing changed (merge with nothing below, deleting the last layer) wipes redo — slop-paint skips it (`sameStructure`) and says why; (c) deleted/merged layers kept alive by undo but not counted in the memory budget (`detachedLayerBytes`); (d) opening a project that fails partway should leave the open document untouched (build aside, swap at the end); (e) Space-to-pan re-activates the last clicked button in Chrome unless Space's default is claimed; (f) a canvas press that prevents default never blurs a focused text field — on iPad the keyboard stays up.
- **Layer to selection** (deferred 2026-09-11, "when we'll need it later"): select the current drawing's pixels as a selection. Selections here are rect/lasso Path2D clips, so it needs an outline TRACER (marching squares with holes → even-odd multi-subpath path; Pose's `boundaryPoints` only samples unordered edge pixels, not usable) and a lasso that can hold several subpaths — then clip/lift/transform/flip/copy all work unchanged. Differs from alpha lock (shipped the same day): hard-edged at a threshold, but movable and keepable across layers.
- ~~**Flip in the Transform tool** (deferred 2026-09-11): Flip H / V for the Frame / Layer / Group scopes and reference layers — a whole layer or group across all frames. Selection flip shipped first (floating selection bar). This one needs a mirror in `RefTransform` (read by render, gizmo math, persistence and transform tracks, ~70 sites) and a decision on keyed vs static flip for animated transforms.~~ — **SHIPPED 2026-09-11** as per-axis scaleX/scaleY (negative = mirrored): Flip H/V in the Transform bar mirrors a layer, reference or group in place, every key of an animated one included. See the 2026-09-11 **Transform stretch & flip** changelog entry.
- ~~**Transform later**: animated/keyframed transforms~~ — **SHIPPED 2026-08-18** and NOT via the
  `RefTransform → KeyframedTransform` migration sketched here. See the **Layer transform track** and
  **Multi-property animation rows** entries below: an optional `tracks` bag (`LayerTracks`
  `{ transform?, opacity? }` / `GroupTracks` `{ transform?, opacity? }`) beside the static field,
  additive, save-format version unmoved. Cells stay static-only (they're already the frame-level
  keyframe) — that half still holds.
- **Mesh-deform / Pose tool — SHIPPED** (FFD + Rigid Deform, and the geodesic-MLS Pose tool with the
  unified rotation+reach gizmo, plus fill-outlines — see the 2026-08-15 entry below). Still deferred:
  **true Igarashi ARAP** (a real sparse solver, chosen against for now — geodesic-MLS is
  closed-form/no-solver); and **animated/keyframed** poses (per-frame + destructive only today).
- **Group transform Apply (full pixel flatten)**: deferred — Phase B is Reset-only. The math for a
  clean per-layer fold-down doesn't exist (group rotates about group bbox center, layers about doc
  center); only a full flatten of all member key cells is correct. Add when there's demand.
- **User-pickable group pivot** (Flash/Animate-style draggable transformation point) — additive,
  non-breaking. Useful when animated rotations land.
- ~~**Audio Phase 2** (scrub, drag-offset clip, mute) and **Phase 3** (mux audio into export)~~ —
  BOTH SHIPPED: P2 on 2026-08-09, P3 on 2026-08-11, with clip trim on 2026-08-16 and every audio
  edit undoable by 2026-08-15. See those entries below; the audio roadmap is closed.
  Background: `docs/.../2026-06-15-audio-track-phase1-design.md`.
- ~~Per-layer boil-strength UI slider~~ — SHIPPED 2026-08-09: a 0–1 (step 0.05) slider beside
  opacity in the LayerList Row 2 (draw layers only, `bind` + `bump`, not undoable — matches
  opacity). Data path was already complete. Owed the usual iPad eyeball.
- **Noise-matte line weight (variable thickness / erosion)** — deferred 2026-07-28 as not worth the
  effort _yet_; the analysis is the part worth keeping. Two independent axes, don't conflate them:
  (1) **the matte** — what modulates the weight. Today `uWeight` is a global scalar. Making it
  spatial is ~1 extra `vnoise()` eval, which the shader already has (`boil-gl.ts:39`):
  `float wn = vnoise(vUv * uWeightFreq + uWeightSeed) * 2.0 - 1.0;`. Cheap, no perf risk.
  (2) **the operator** — what the modulation does, and the reason a matte alone won't give you
  thickness. The current operator is `a = a0 + uWeight * a0*(1-a0)*4` (`boil-gl.ts:54`), and
  `a0*(1-a0)*4` is **zero wherever alpha is 0 or 1** — it can only touch the anti-aliased fringe,
  never the solid core. A noise matte on it buys spatially-varying _edge softness_ (ink density /
  dry-brush), which is a real look but is **not** variable line weight. Genuine swelling/thinning
  needs a **morphological dilate/erode**: sample alpha at a ring of offsets, `max` to fatten / `min`
  to thin, lerp on the signed weight — that moves the actual edge, so ±1–2px is reachable. Cost is
  4–8 extra `texture2D` per pixel **per layer** (tens of millions of samples/frame at 1920×1080 with
  several layers) — measure on iPad before committing; the low framerate and the 1× scale both help.
  Open design questions if picked up: does the noise vary _along_ a stroke (organic ink) or _across
  the frame_ (bolder regions)? — different frequencies. Must stay render-time/non-destructive, per
  `prefers-manual-over-auto-altering-art`.
- **Onion-skin settings as a global preference** — extend `Preferences` + gather/applyPreferences.
- **Reference media auto-restore** — mostly SHIPPED 2026-08-08 (see the reference-media-persistence
  entry): IMAGES always persist and restore, and videos do too once `embedMedia` is opted in. What
  remains deferred is the NON-embedded video, which still comes back as a re-link placeholder;
  restoring that without copying the bytes needs File System Access (Chromium desktop) or a native
  wrapper, so it stays shelved.
- **Tiled + copy-on-write cell storage** — would cut RAM and enable an _expandable_ canvas (paint
  beyond the doc bounds for transformed layers); big cross-cutting change. See
  `memory`-derived notes / `future` discussion.
- **Tooltips on touch/pencil** — `title=` is mouse-only; needs a custom long-press (all touch) or
  pencil-hover (M2+ iPad only) tooltip. Not built.
- A `dev:tunnel` script (cloudflared/ngrok) for iPad-over-any-network — discussed, not added.

## Verification debt

Much canvas/DOM/touch/iPad code is build- + unit- + review-verified but **not browser-eyeballed**
(Vitest has no DOM). When you finish canvas/UI work, flag this to the user rather than claiming it's
confirmed working. The per-feature "owed a browser pass" / "verified in the browser" log — what's
been eyeballed and what hasn't, feature by feature — moved to `docs/superpowers/CHANGELOG.md` on
2026-09-03; check there before assuming a given surface is unverified or confirmed.

## Change history

The dated, append-only log of every feature/fix shipped on this project — the "why", not just the
"what", with the gotchas each one cost — lives in **`docs/superpowers/CHANGELOG.md`**. It is not
loaded automatically; open it when working on a subsystem it covers, when a gotcha or roadmap item
above points at a dated entry, or when you want the full rationale behind something.
