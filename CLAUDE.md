# slop-animator — project guide for Claude

A browser-based, low-framerate, monochrome ink-outline, **frame-by-frame bitmap animation** app.
Used heavily on **iPad with Apple Pencil** (iPad-first; mouse/desktop also supported). Svelte 5 +
TypeScript + Vite + Tailwind 4 + Vitest.

> This file is the handoff/index. The **detailed design rationale lives in `docs/superpowers/specs/`
> and `docs/superpowers/plans/`** (one spec+plan per feature, dated) — read the relevant ones before
> changing a subsystem. This file captures conventions, hard-won gotchas, current state, and the
> roadmap so you can pick up cold.

## Commands

- `npm run dev` — Vite dev server (localhost, HTTP).
- `npm run dev:lan` — `HTTPS=1 vite --host` for iPad testing over LAN (Clipboard API + secure-context
  features need HTTPS; accept the self-signed cert once on the iPad). Note: corporate/guest Wi-Fi
  with client isolation can block iPad→Mac entirely — a tunnel (cloudflared/ngrok) is the fallback.
- `npm run build` — **`svelte-check && tsc --noEmit && vite build`**. The bar for every change is
  **0 errors, 0 warnings.**
- `npm test` — Vitest (node env, no DOM). Baseline ~**280 passing**. Canvas/DOM code isn't
  node-testable; only pure logic is unit-tested.
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
- Commit message trailer used here: `Co-Authored-By: Claude ...`.

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
  `fill.ts`, `input.ts`, `cell-ink.ts` (per-cell ink/`contentBounds` caches).
- `src/state/appState.svelte.ts` — the global `$state` store (`state`), all mutation actions,
  history/undo, preferences gather/apply. **The single source of truth.**
- `src/lib/*.svelte` — UI: `Canvas`, `Toolbar`, `LayerList`, `Timeline`, `Playbar`, `AudioLane`,
  `RefTransformGizmo`, `BrushCursor`, dialogs.
- `src/persist/` — `project-file.ts` (zip: project.json + PNG per key cell; autosave + export),
  `preferences.ts` (localStorage), `autosave.ts` (IndexedDB, ~3s debounce).

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
6. Gizmo _drags_ don't push undo (only Apply/Reset do) — matches existing behavior, intentional.
7. Mouse strokes report no pressure (`hasPressure:false`) → drawn at constant nominal width
   (`sizeRange` collapses to 1); only pen pressure widens.
8. **Undo snapshots SHARE cell/canvas object refs** (`cloneLayers` only `slice()`s the array). A
   structural mutation must **replace** a cell (`layer.cells[i] = {...}`), **never mutate in place**
   (`cell.transform = ...`) — in-place edits corrupt the before-snapshot and no-op undo. `restoreStructure`
   keeps the live layer only when `live.kind === snap.kind`, and restores `groupId` (structural).
9. **Tool lifts** (selection float / deform warp / pose mesh) capture `selCtx`/`selBefore` at lift time.
   Any state change that re-targets/destroys that canvas must bank or discard the lift first via the
   `Canvas` effects (`bankActiveEdits` on layer/frame switch) or the **`liftGuard.discard`** hook (call it
   before resize / replaceProject / set-hold / delete-frame, and route undo/redo through `undo()`/`redo()`).
10. **Any draggable surface needs `touch-action: none`** (element style or CSS), or on iPad the browser
    hijacks a Pencil/finger drag as a scroll/pan and cancels the pointer stream — the drag silently does
    nothing. Pointer events + `setPointerCapture` are NOT enough on their own. The canvas, timeline rows,
    ruler, resize grip all set it; the pressure-curve editor lacked it and didn't drag on iPad until fixed
    (`pressure-curve.ts`, `cvs.style.touchAction = "none"`). Add it to every new drag control.

## Current state (all shipped & merged to `main`)

Frame-by-frame drawing (smooth/ink/pencil/charcoal/airbrush brushes, separate brush vs eraser
settings, pressure curve, eyedropper, brush/eraser size cursor), fill, selection/lasso transform,
layers + visual groups (collapse/visibility/drag-reorder), onion skins, WebGL line-boil, timeline
(keyframe/hold, scrub — perf-tuned), playback, audio Phase 1, MP4/WebM export (mediabunny),
reference layers (image/video, transform gizmo, metadata-only persistence + re-link), clipboard
image paste + rasterize-to-drawing-layer, **per-layer free transform**, **per-cell (current-frame)
transform**, and **per-group transform** (3-way Frame/Layer/Group scope toggle on the Transform tool;
group transform composes above the layer for character-rig moves; Reset-only this phase, no Apply),
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

## Roadmap / deferred (wanted-later, not abandoned)

- **Transform later**: animated/keyframed transforms — `LayerGroup.transform` and `Layer.transform`
  mirror each other in shape (per Phase B spec), ready for a `RefTransform → KeyframedTransform`
  migration. Cells stay static-only (they're already the frame-level keyframe).
- **Mesh-deform / Pose tool — SHIPPED** (FFD + Rigid Deform, and the geodesic-MLS Pose tool with the
  unified rotation+reach gizmo). Still deferred: **true Igarashi ARAP** (a real sparse solver, chosen
  against for now — geodesic-MLS is closed-form/no-solver); **outline-only drawings** pose as a thin
  web (the silhouette mesh needs a filled region) — a **manual** fill (not auto — the user declined
  auto fill-holes, see `prefers-manual-over-auto-altering-art` memory) or an opt-in fill-holes pass is
  the path; and **animated/keyframed** poses (per-frame + destructive only today).
- **Group transform Apply (full pixel flatten)**: deferred — Phase B is Reset-only. The math for a
  clean per-layer fold-down doesn't exist (group rotates about group bbox center, layers about doc
  center); only a full flatten of all member key cells is correct. Add when there's demand.
- **User-pickable group pivot** (Flash/Animate-style draggable transformation point) — additive,
  non-breaking. Useful when animated rotations land.
- **Audio Phase 2** (scrub, drag-offset clip, mute — fields exist in model/persistence) and **Phase 3**
  (mux audio into export). See `docs/.../2026-06-15-audio-track-phase1-design.md`.
- **Per-layer boil-strength UI slider** — data path complete (`DrawingLayer.boilStrength` honored +
  persisted), UI-only addition to the timeline layer row.
- **Onion-skin settings as a global preference** — extend `Preferences` + gather/applyPreferences.
- **Reference media auto-restore** — currently re-pick the file (no-bytes placeholders persist). True
  auto-restore needs File System Access (Chromium desktop) or a native wrapper; shelved.
- **Tiled + copy-on-write cell storage** — would cut RAM and enable an _expandable_ canvas (paint
  beyond the doc bounds for transformed layers); big cross-cutting change. See
  `memory`-derived notes / `future` discussion.
- **Tooltips on touch/pencil** — `title=` is mouse-only; needs a custom long-press (all touch) or
  pencil-hover (M2+ iPad only) tooltip. Not built.
- A `dev:tunnel` script (cloudflared/ngrok) for iPad-over-any-network — discussed, not added.

## Verification debt

Much canvas/DOM/touch/iPad code is build- + unit- + review-verified but **not browser-eyeballed**
(Vitest has no DOM). The transform features especially warrant an interactive `npm run dev` pass.
When you finish canvas/UI work, flag this to the user rather than claiming it's confirmed working.

**Owed a browser pass (2026-07):** the user eyeballed the Pose gizmo (rotation, reach) and the
layer-visibility fix, but the transparent-bg/paint-behind/settings-dialog UI and the code-review
**batch B/C** lifecycle fixes (bank/discard-on-context-change, lock-mid-lift, undo-mid-lift, resize
mid-lift) are build+review-verified only — worth an interactive pass. `appState.svelte.ts` isn't
node-importable (window/audio at module load), so its model/undo logic is build+reasoning-verified, not
unit-tested.

**Timeline block copy/paste (2026-07-09, merged):** rectangular block selection (frames × layers) +
copy/cut/paste(overwrite & insert)/delete. Pure block+selection logic is unit-tested (`timeline-block.ts`,
`timeline-selection.ts`); the whole gesture/UI/keyboard surface is build+review-verified only. The user
eyeballed the **action-bar positioning** (top row, last track, spanning — flip+clamp inside the vertically-
clipping grid wrapper). **Still owed a browser pass:** long-press + shift-click selection & highlight;
overwrite-vs-insert paste; cross-layer paste + **overflow** (block taller than the draw layers at/below the
active one → extra columns ignored, no layer auto-create); **undo/redo across a paste** and the
**resize↔undo↔paste** sequence (clipboard is dropped on a size-changing undo/redo so a stale wrong-sized
canvas can't be pasted); `Cmd+V` cells vs the image-file paste handler. Two known edge cases deferred: (1)
copying while a selection/pose **lift is active** captures the holed under-canvas (copy doesn't bank the
float); (2) pasting onto a **reference active layer** now no-ops (guarded). Spec + plan:
`docs/superpowers/{specs,plans}/2026-07-09-timeline-block-copy-paste*.md`.

**Status bar + resizable/scrollable timeline (2026-07-10, merged):** a bottom status bar (left =
instant hover/press hint sourced from every `title=` via a delegated `pointerover`+`pointerdown`
window listener — works on iPad tap; right = frame/tool/layer readout) and a bounded, drag-resizable
(top grip, persisted `timelineHeight`), vertically-scrollable timeline (`overflow-auto` + sticky
ruler). Pure `clampTimelineHeight` is unit-tested; the rest is build+review-verified. The user
eyeballed the **grip resize**. **Still owed:** the status hint on iPad tap; vertical track scroll with
the pinned ruler/gutter; window-shrink re-clamp. Spec/plan: `…/2026-07-10-status-bar-and-resizable-timeline*.md`.

**Selection-first timeline interaction (2026-07-10, merged):** click-select, drag-move (single key or
frames×layers block, overwrite, live ◆ glyph ghost via `displayGlyph`, selection follows), marquee
from **any** unselected cell (inside=move / outside=select), tap-empty deselect, seek on the ruler
only (body scrub removed). Pure `moveBlockFrames` (+ shared `writeColumn`) is unit-tested; gestures
are build+review-verified. **The user browser-tested this heavily** (marquee-below-tracks clamp, the
frame-0 collapse bug, marquee-from-key, whole-selection drag were all found + fixed in-session), so
most of it is eyeballed — but a fresh pass on undo/redo-across-move and iPad parity is still worth it.
A **high-effort multi-agent code review** ran on the merged timeline work and its 4 findings were
fixed (ruler-only scrub, frame-0 collapse, DRY, gutter map). Spec/plan:
`…/2026-07-10-timeline-selection-first-interaction*.md`. The **ruler** now has a distinct shade +
divider (cosmetic; eyeballed).

**Desktop canvas pan + fit-view (2026-07-10, merged):** space-drag / middle-mouse / plain-scroll pan,
⌘Ctrl+scroll & pinch zoom, `0` = fit-to-view. Pure `computeFitTransform` is unit-tested;
`Viewport.panBy/fitView` + the `Canvas.svelte` wiring (capture-phase pan preempts drawing; touch/iPad
unchanged) are build+review-verified — **NOT browser-eyeballed yet.** **Owed a desktop pass:** all
pan/zoom gestures, `0` centering, that a space-drag never draws, and **middle-mouse browser
autoscroll** (may need a `mousedown`/`auxclick` preventDefault for button 1 — the one unverified
risk). Deferred minor: `fitView` pan/zoom desync only at pathological canvas sizes. Note:
`Canvas.svelte` now imports the store as `state as appState` (runes gotcha #1, forced by new `$state`
runes). Spec/plan: `…/2026-07-10-desktop-canvas-pan*.md`.

**Canvas selection cut/copy/delete/paste (2026-07-11, merged):** cut/copy/delete the selected pixels;
paste as a movable float (reposition → Enter commits). Internal `{canvas, rect}` pixel clipboard;
reuses the lift/commit machinery (`Selection.copyPixels`/`clearRegion`/`pasteFloat`, split from
`liftPixels`). `⌘C/X/V`/Del gated on the Select/Lasso tool; ops on the ToolOptions bar (see toolbar
below). Copy reads the resolved key (no keyframe materialized on a hold); delete/paste materialize.
All canvas-coupled → build+review-verified, **not browser-eyeballed.** **Owed a pass:** copy→paste
float/reposition/Enter/undo; cut; delete+undo; **lasso-shaped** copy/delete; copy on one frame → paste
on a different layer/frame; `⌘V` priority (pixels vs timeline cells vs OS image); iPad. Known (app-wide,
not new): delete/paste on a **hold** frame materializes a keyframe; undo restores pixels but the ·→◆
marker stays. Spec/plan: `…/2026-07-11-selection-cut-copy-paste*.md`.

**Toolbar reorganization (2026-07-12, merged):** the flat wrapping bar → a **primary bar**
(`Toolbar.svelte`: tools + undo/redo + **File/Import-Export/View** dropdown menus via new
`ToolbarMenu.svelte`) + a **contextual `ToolOptions.svelte`** bar showing only the active tool's
controls (brush settings + pressure curve; fill tolerance/expand/color; Select/Lasso
Copy/Cut/Paste/Delete gated on new `appState.selectionActive`/`hasPixelClipboard`; transform scope).
Floating on-canvas paste button removed; near-selection bar keeps only transform ops. All DOM →
build+review-verified. **Two review-caught bugs fixed** (curve-editor re-attach when the brush branch
remounts; the curve popup was clipped by the bar's `overflow-x-auto` → made `.curve-popup`
`position:fixed`). **Owed a pass** (this is the look/behavior the user set out to fix): **confirm the
pressure-curve popup shows** (the fix); each menu opens/dismisses/acts; per-tool contextual swap has no
canvas jump; selection ops enable-states; iPad reachability of the right-aligned menus. Minor deferred:
primary bar dropped `flex-wrap` w/o an overflow fallback (menus could clip on a very narrow viewport).
Spec/plan: `…/2026-07-12-toolbar-reorganization*.md`.

**Video reference memory + playback (2026-07-12, merged):** fixed the blob-URL leak + seek-per-frame
playback. `releaseReferenceMedia` (revoke blob + `pause()`+`removeAttribute("src")`+`load()`) called on
`relinkReference`/`replaceProject` — **NOT `removeLayer`** (undo snapshots share the media object).
`preload="metadata"`. `syncReferenceVideos(…, playing)` now `play()`s the element rate-matched and
re-seeks only on >0.3s drift / loop-wrap (paused = exact seek); a `vid.seeking` guard coalesces
fast-scrub seeks. That seek/drift/coalesce logic **is unit-tested** (`reference.test.ts`, 9 cases). The
user confirmed it "works ok" in the browser. Review caught + fixed a blank-first-frame regression from
lazy preload (`loadeddata`→repaint). **Still worth a pass:** playback smoothness on a long clip;
memory not climbing across repeated import→relink. Deferred: **#5 WebCodecs `VideoDecoder`** frame-exact
decode (big; iPad-Safari support is the blocker → would need a fallback). Spec/plan:
`…/2026-07-12-video-reference-perf*.md`.
