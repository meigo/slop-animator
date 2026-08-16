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
- `npm test` — Vitest (node env, no DOM). Baseline **493 passing**. Canvas/DOM code isn't
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
   direct mutation. Known gap, not fixed by this feature: `input.ts` still has no `pointercancel`
   listener, so an OS-cancelled pointer stream (e.g. iPad palm rejection) on the Canvas on-canvas drag
   path can leave `refDrag`/`refDragUndo`/`refDragFreeze` set. If that happens, the _next_ gesture's
   grab block sees `refDrag` already non-null and skips re-snapshotting, so the stale snapshot from the
   cancelled gesture gets committed at that next gesture's release — silently merging two separate
   drags into one undo entry. In practice this is rarely reachable: `input.ts` binds
   `pointerleave → onPointerUp`, and per the pointer-events spec a `pointercancel` is followed by
   `pointerout`/`pointerleave` at the capturing element, so `done: true` usually still arrives even on
   an OS cancel. The gizmo's own handle-drag path is unaffected either way, since it binds
   `pointercancel` itself on `window`.
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
  unified rotation+reach gizmo, plus fill-outlines — see the 2026-08-15 entry below). Still deferred:
  **true Igarashi ARAP** (a real sparse solver, chosen against for now — geodesic-MLS is
  closed-form/no-solver); and **animated/keyframed** poses (per-frame + destructive only today).
- **Group transform Apply (full pixel flatten)**: deferred — Phase B is Reset-only. The math for a
  clean per-layer fold-down doesn't exist (group rotates about group bbox center, layers about doc
  center); only a full flatten of all member key cells is correct. Add when there's demand.
- **User-pickable group pivot** (Flash/Animate-style draggable transformation point) — additive,
  non-breaking. Useful when animated rotations land.
- **Audio Phase 2** (scrub, drag-offset clip, mute — fields exist in model/persistence) and **Phase 3**
  (mux audio into export). See `docs/.../2026-06-15-audio-track-phase1-design.md`.
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

**Per-video reference audio (unmute) + free-run playback (2026-07-14, merged & pushed):** a video
reference can play **its own soundtrack** during playback via a per-layer `ReferenceLayer.audioEnabled`
flag (default **off**). No separate audio track / no audio engine — `syncReferenceVideos` enforces
`vid.muted = !(audioEnabled ?? false)` (guarded, node-unit-tested), so speed-sync is **free** (same
element already at `playbackRate = clamp(speed)` → 2× plays higher-pitched, in sync). Per-video, and
**independent of layer visibility** (user's choice: hidden + 🔊 = audio-only) and of the project `audio`
track. Toggle is a 🔊/🔇 (`Volume2`/`VolumeX`) icon **beside the visibility eye** in `LayerList` (video
refs only). Persisted (`audioEnabled ?? false` on load; video bytes still re-link, flag re-applies via
sync). `removeLayer` now `pause()`s a removed video ref (audible-leak fix; `pause()` only — undo shares
the media object, gotcha #8). **Follow-up fix (same day):** sped-up audio stuttered because every
corrective re-seek flushes the element's audio pipeline (worse at high `playbackRate`, where the decoder
falls behind the frame clock). Fixed by making video refs **free-run** during playback — the drift
re-seek is now **directional** (`vid.currentTime - clamped > PLAY_DRIFT`), so it fires **only when the
element runs AHEAD** (loop-wrap / backward jump), never on forward drift. **This supersedes the
2026-07-12 ">0.3s drift" re-seek behavior above.** Trade: a video ref's frame may drift slightly per
pass, re-locking each loop — accepted for smooth audio. Sync/mute/free-run logic is unit-tested
(`reference.test.ts`, now 20 cases). **The user browser-confirmed** audio plays on speed-up and the
stutter is gone ("all good"). **Still owed a pass:** scrub silence; toggle-off mid-playback; 0.5× lower
pitch + sync; hidden+audio audio-only; two videos with audio at once; save/reload persistence + old-project
audio-off back-compat; delete-during-playback goes silent; loop re-sync at the wrap; iPad. Deferred (per
spec Non-goals): per-layer volume, audio-during-scrub, waveform, **muxing video-element audio into export**
(export still handles only the project `audio` track), and **extracting the video's audio into an editable
`project.audio` track with its own speed** (the heavier "independent audio" feature). Spec/plan:
`…/2026-07-14-video-reference-audio*.md`.

**1× document scale + Home Screen install (2026-07-28):** `DPR` is now the literal **1**, not
`devicePixelRatio` — cells, display/scratch canvases, hit-testing and export all render at document
resolution. On iPad that is **4× less RAM per key cell** (8.3 MB vs 33.2 MB at 1920×1080) and 4× less
autosave PNG encode work. **Export is now device-independent**: a 1920×1080 project exports
1920×1080 everywhere, where it previously produced 4K from a 2× display. Old projects downsample
once on open (the save format is scale-agnostic) — **one-way**, so keep a copy of anything whose
original pixels matter. The ~60 `* DPR` call sites were deliberately left in place (correct at 1).
Also: frame PNGs are now stored in the zip at level 0 (no wasted re-DEFLATE), and autosave flushes on
`pagehide`/`visibilitychange` so a killed tab doesn't cost the 3s debounce window; the flush is
gated on `autosaveReady` (set only after startup restore resolves, because an unguarded flush
mid-restore would overwrite the saved project with the blank startup document) and `autosaveDirty`
(so unchanged projects are not re-encoded) — the `autosaveReady` gate must not be removed. Plus a PWA
manifest + iOS meta tags + generated icons (`tools/make-icons.mjs`) for Add to Home Screen —
manifest-only, no service worker, so **no offline launch**. **`viewport-fit=cover` is deliberately
NOT set** (review caught it, spec D11a): it makes every `env(safe-area-inset-*)` non-zero — including
the **bottom**, the home-indicator strip on Face-ID iPads — while
`apple-mobile-web-app-status-bar-style: black` reserves only the **top**. Since the app does no
safe-area padding and pins its status bar and playbar to the bottom, `cover` would push them under the
swipe strip while buying nothing against an opaque bar. Add it back only together with
`env(safe-area-inset-*)` handling. Note an installed web app has its own
storage bucket: existing autosave does not carry over (save to Files, then Open inside the installed
app). **Owed a pass:** the scale change is a one-line diff with canvas-wide effect and no unit test
can cover it — drawing/brush-cursor width, fill, selection+lasso lift/cut/copy/paste, deform, pose
(incl. the reach dial), the transform gizmo at all three scopes, onion skins, the WebGL boil path,
export dimensions, and opening a 2×-era project all need eyeballing. **Three settings are denominated
in device px, so their _logical_ effect doubles on a device that was previously 2× — all three are the
intended consequence of a device-independent scale (they now match what a 1× display always did), but
none is caught by the checks above, so eyeball them explicitly:** line-boil `amount` (default 1,
persisted per project — the wobble is twice as wide in logical terms), fill `expand` (default 2 —
twice the reach), and `POSE_SPACING` (16 device px — the pose mesh is ~4× coarser, and faster). Also
newly reachable: `evenDimensions` rounds **down**, so a project with an **odd** width or height now
loses 1 px in **video** export (PNG sequence is unaffected); this could not fire at 2×. Unrelated
oddity worth knowing: `pressure-curve.ts` hardcodes its own 2× raster for the curve widget, so it is
now the only 2× surface in the app. Deferred: incremental
(dirty-cell-only) autosave encoding, and LRU cell eviction — revisit only if measurement shows the 4×
cut wasn't enough. Spec/plan: `…/2026-07-28-ipad-memory-and-pwa*.md`.

**Reference media persistence (2026-08-08, on branch):** reference layers now survive reload and
travel with the `.zip`. A write-once `ref-media` IndexedDB object store (DB bumped to **v2**,
`src/persist/db.ts`) holds `{blob, mime, name}` keyed by a stable `mediaId` minted at
import/relink — the ~3s autosave debounce never touches it (re-copying 100s of MB of video on every
edit was disqualifying). Images always persist; videos are opt-in per layer via a
`embedMedia` flag, toggled with a Save/SaveOff icon beside the existing 🔊 audio toggle in
`LayerList`. Zip entries are `media/<mediaId>` (no extension; `mediaMime` in `project.json` rebuilds
the Blob type) at compression level 0, written only for images + opted-in videos. Restore is
two-path: same-device autosave reload calls `hydrateFromStore` (`src/persist/media-store.ts`)
against the existing store; opening a `.zip` hydrates from the zip's `media/` entries **and** seeds
the store so the file keeps restoring on later reloads of that device. Orphan collection
(`pruneMedia`) runs **only at project-load boundaries** (`replaceProject`/open/startup restore, see
`App.svelte`) — never from `removeLayer`, which (per gotcha #8) must leave the store alone because
undo snapshots share layer objects; `relinkReference` mints a **new** `mediaId` rather than
overwriting, so an old undo snapshot's blob survives until the next load boundary. A quota/write
failure leaves the reference live for the session with a status-bar warning; it won't survive
reload. Pure logic (mediaId round-trip, orphan-set computation, embed-flag zip filtering) is
unit-tested; the IndexedDB/zip-embed paths are build+review-verified only (project convention — not
node-testable). **Owed a browser pass:** image import → reload → restore; opted-in video → reload →
restore; non-embedded video → placeholder; quota warning; opening an old (pre-media) zip; opening a
new zip on a second device; delete a persisted reference → undo → media still live; toggle-off →
reload → placeholder; toggle off → re-link → toggle on → reload shows the NEW video; New clears the
store; ⌘S save contains the media entries; iPad for all of it. The v1→v2 IndexedDB upgrade itself is
also untested in a real browser — note a stale pre-upgrade tab left open across the deploy hits an
IndexedDB `VersionError` on the bumped store and silently stops autosaving until the tab is reloaded.
Spec/plan: `…/2026-08-08-reference-media-persistence*.md`.

**Undoable transform drags (2026-08-09, on branch):** gizmo/canvas transform drags now push one undo
step per completed gesture instead of zero (see gotcha #6, rewritten). `isSameTransform` (new,
`document.ts`) does exact field equality to gate the commit; `restoreStructure` now restores
`Layer.transform` for reference layers too (previously draw-layer-only), so ref-layer drags are
undo-restorable; `resetLayerTransform` dropped its draw-only guard so Reset-to-fit works — and is
undoable — on refs as well. Both drag call sites (`Canvas.svelte` on-canvas frame/layer/group drag,
`RefTransformGizmo.svelte` handle drag) follow the same shape: `beginStructuralEdit()` at grab →
frame-scope cell clone (gotcha #8 ordering preserved) → freeze `transformBox` with `prevBox` captured
by **direct object ref** (`refDragFreeze`/`dragFreeze`, not re-resolved by `activeLayerId`/`playhead`
at release — a review-caught bug, fixed in `cde3b4a`) → `commitStructuralEdit()` or revert-the-freeze
at release depending on `isSameTransform`. Pure logic (`isSameTransform`) is unit-tested; the two
drag-lifecycle integrations are build+review-verified only (Canvas/gizmo are DOM-only, no unit
harness — project convention). Known gap, not fixed here: `input.ts` has no `pointercancel` listener,
so an OS-cancelled captured stream (iPad palm rejection) on the Canvas on-canvas drag path leaks
`refDragUndo`/`refDragFreeze` until the next gesture overwrites it; the gizmo's handle-drag path binds
`pointercancel` itself and is unaffected. **Owed a browser pass:** move → undo → back; scale/rotate →
undo; frame-scope drag → undo restores the cell transform; drag then undo an _earlier_ structural op
(the drag must not revert with it); click-without-move pushes nothing; Reset-to-fit → undo; ref-layer
drag → undo; redo for all of the above; mid-drag `pointercancel` (iPad palm rejection) still commits;
frame-scope drag _while playback runs_ (drag settles on the first playhead-crossing); ⌘Z during a held
drag (drag settles as its own undo entry, then the undo applies); iPad overall. Spec/plan:
`…/2026-08-09-undoable-transform-drags*.md`.

**Project name (2026-08-09, on branch):** `Project.name` (default `"untitled"`, editable at the top of
the Project Settings dialog, not undoable — matches fps/bg) is now the save and export filename via
`sanitizeFilename` (`project-file.ts`, unit-tested): save → `<name>.zip`, exports → `<name>.zip`/
`.mp4`/`.webm`. Fixes the iPad `project (n).zip` pile-up — Files still auto-increments on an exact
name collision, but the stem is now meaningful. Persisted as optional `ProjectJson.name` (version
stays 1); an old file opens with the picked file's basename as its name, an old autosave falls back
to `"untitled"`. **Owed a browser pass:** the settings-dialog text input on iPad (keyboard focus);
save lands in Files under the chosen name; old-zip open adopts the basename; export filenames.
Spec: `…/2026-08-09-project-name-design.md`.

**Layer lock toggle (2026-08-09):** the `locked` flag was enforced for draw/fill/lifts (lock-mid-lift
discards via the 2026-06-29 review work) — but NOT for transforms/timeline ops (closed same day, see
the next entry) — and had NO
UI writer — `duplicateLayer` was the only code that ever set it. Added the missing Lock/LockOpen
button on draw-layer rows in `LayerList`, beside the eye (same in-place-mutate + `bump()` pattern as
visibility/audio/embed; not undoable, matching visibility). 15-line diff, no new enforcement.
**Owed:** an iPad tap check + confirming a locked layer visibly refuses strokes.

**Lock enforcement completion (2026-08-09):** the lock toggle shipped with four holes — transform
drags (Canvas dispatch + gizmo `activeTransformLayer` never checked `locked`), Apply/Reset actions,
and timeline cell ops (only `clearFrame` checked). All closed: locked draw layers now refuse
transform drags on both surfaces (a mid-gesture lock settles the open undo bracket), Apply/Reset
(silent no-op, matching the drawing-refusal convention), the five frame tools + hold-span resize,
and **block ops treat locked rows as inert** — paste/delete/move skip them while consuming their
column so alignment holds (`timeline-block.ts`, unit-tested, incl. the moveBlockFrames
column-counter subtlety). **Group transforms are blocked when the group contains a locked member**
(`groupHasLockedLayer`, unit-tested) — drag, gizmo, and reset; Photoshop-style "locked member pins
the group". Layer _management_ (rename/reorder/visibility/opacity/boil/duplicate/delete) stays
allowed — locks protect content, not organization. Copy from a locked layer is allowed (read-only).
**Owed a browser pass:** transform drag refused on locked layer (all 3 scopes + ref-sibling group);
gizmo hidden when locked; paste/move across a locked row leaves it intact; hold-span resize refused;
lock mid-drag settles cleanly; iPad.

**Audio Phase 2 — scrub, drag-offset, mute (2026-08-09, on branch):** the P1-deferred trio, UI/engine
only (P1 pre-landed `offsetFrames`/`muted` in model + save format — zero migration). **Scrub:**
`AudioEngine.scrub(frame, fps)` plays a ~100 ms window (`src.stop(now + 0.1)`), replace-per-call so
fast drags self-coalesce; no-op when muted / while playback owns the output / past clip end; a
separate `scrubSource` keeps `syncTo`'s "only if playing" check honest. Routed via the new
`seekPlayhead(f)` action (clamps; scrubs only when paused AND the frame actually changed — no
pointer-jitter spam), now the single path for ruler drag/keys (`Timeline.go`), Playbar prev/next,
and `,`/`.` stepping. **Offset:** drag the waveform canvas (touch-action none, pointer capture);
`round(dx / cellW)` frames applied live + `bump()`; rendered as `margin-left` so negative offsets
(clip before frame 0) tuck under the sticky label; release re-`syncTo`s a running playback. No
clamp on the offset range (accepted). **Mute:** 🔊/🔇 beside Remove; toggling mid-playback
stops/rejoins the engine; `play()` also refuses muted as defense. ~~Offset/mute are NOT undoable
(audio is outside `StructSnapshot`, like set/remove-track).~~ **Superseded 2026-08-15: the OFFSET is
now undoable** (one entry per completed lane drag), **as are import and remove-track** — see the
audio-undo entries at the end of this file. As of the same date EVERY audio edit is undoable —
offset, import, remove and mute. **Owed a browser pass:** scrub audible
on drag + stepping, silent while playing/muted; offset drag incl. negative + save/reload (deep negative offsets scroll out of reach past the label width — eyeball whether that needs a clamp); iPad drag
(touch-action); mute mid-playback both ways; unmute-while-playing rejoins in sync. Phase 3 (export
muxing) still deferred. Spec: `…/2026-08-09-audio-phase2-design.md`.

**Deselect button + contextual status hints (2026-08-11):** two fixes for the same root problem —
the app's most useful gestures are invisible, and `title=` tooltips never fire on touch. (1) A
**Deselect** button in the Select/Lasso ToolOptions with **Escape semantics** (cancels, reverting an
in-progress move — tap-outside keeps its commit behavior). Needed a new `appState.selectionFloating`
flag because `selectionActive` deliberately excludes floats (Copy/Cut/Delete need a committed
marquee), so the button would have been disabled exactly when most wanted. (2) **`contextHint()`**
(`src/lib/status-hint.ts`, pure + unit-tested, 6 cases) fills the status bar's idle left half with
the current tool's non-obvious gestures; `statusHint || contextHint(...)` so a real hover always
wins. Precedence: locked layer > tool-blocked-by-layer-transform > tool/state hint — a hint for a
gesture that currently does nothing is worse than none, and both of those states fail _silently_
today. Content rule: no keyboard-shortcut lists, nothing restating a visible button. The
**Deform/Pose hints say "leaving the tool bakes it"** — on iPad a tool switch is the ONLY commit path
(Enter needs a keyboard) and nothing said so. New reactive `appState.poseActive` mirrors `meshPose`
at all 4 assignment sites (a plain `poseActions.active()` function isn't reactive). The Transform
tool's **on-canvas text label was deleted** (its Reset-to-fit button stays) — the bar carries it now
without covering artwork. **Owed a browser pass:** each tool's idle line incl. both precedence
overrides; hover still overrides; no Transform text on canvas; iPad.
Spec: `…/2026-08-11-contextual-status-hints-design.md`.

**Hidden layers are read-only + the marquee is UI (2026-08-11):** reported as "you can select on a
hidden layer but not see it; it appears when you activate a visible layer". Two causes. (1)
`Canvas.svelte` set `selection.hidden = !activeLayer().visible` and `selection.ts` used that to blank
the WHOLE overlay. The flag is right for **lifted content** (floating pixels / warp mesh must obey
visibility) but wrong for the **marquee**, which is UI chrome and document-level (survives layer
switches) — hence the invisible-then-reappearing selection. The `hidden` early-return now sits AFTER
the `selected`/`isCreating` marquee block: outline always drawn, lifted pixels still hidden. (2) The
bigger issue behind it: **nothing blocked editing a hidden layer at all** — strokes/fill/lift/deform/
pose/timeline tools only checked `locked`, so a full stroke could land invisibly in a hidden layer
(real pixels, undoable, saved, unseen). New `isLayerEditable(layer): layer is DrawingLayer`
(`document.ts`, unit-tested) = draw + unlocked + visible, and it replaced every `kind !== "draw" ||
locked` guard in Canvas/Timeline/appState/gizmo — it is a **type predicate** because those guards
were also doing the `DrawingLayer` narrowing. Status hint "Layer hidden — show it to edit" (ranks
just under locked; both are otherwise-silent refusals). Creating a marquee on a hidden layer is
still allowed (harmless UI, and now visible); lifting/moving it is not. **Two deliberate
non-changes:** a hidden member does NOT block a group transform (the visibility gate is
SCOPE-AWARE in both `Canvas.onStroke` and the gizmo's `activeTransformLayer` — a first pass gated
before the scope dispatch and silently killed group drags whose anchor layer was hidden; review
caught it), and timeline BLOCK ops (paste/
delete/move) still skip only _locked_ rows — hiding is a transient view state while lock is an
explicit "don't touch", so bulk ops keep honoring lock only. **Owed a browser pass:** marquee visible
on a hidden layer; strokes/fill/lift/deform/pose/frame-tools all refuse with the hint; unhide →
editing resumes; a lift in progress when you hide stays alive and hidden; iPad.

**Deselect from the on-canvas bar + the clipping hint (2026-08-11):** with a paint tool active there
was NO reachable way to drop a selection — ToolOptions' Deselect only renders for select/lasso,
tap-outside draws instead, and Esc needs a keyboard. `SelectionActions` (the near-selection floating
bar) is already visible for **any** tool whenever a selection exists, but rendered its ✕ only in
`transforming`/`warping` mode; it now also renders in `selected` mode, wired to the same
`selection.cancel()` (Escape semantics). This matters more than it looks: **a selection clips
brush/eraser/fill** (`Canvas.svelte` `applyClip` in the stroke + fill paths), so a forgotten marquee
reads as a broken brush — hence also a status hint for those three tools: "Painting is clipped to the
selection · ✕ on the selection bar deselects". Auto-clearing the selection on tool switch was
rejected for the same reason (painting inside a selection is a real technique). **Owed:** the ✕ on
iPad, and that it doesn't bleed a tap through to the canvas (it uses the bar's existing
`tap()` stopPropagation wrapper).

**Layer row de-crowding (2026-08-11):** a video reference row had FOUR icons before the name (grip,
eye, audio, embed, + type glyph), truncating the name to uselessness. The two video-only toggles
(audio 🔊, embed 💾) moved from Row 1 to **Row 2** — the detail strip that renders only for the
ACTIVE layer, where the other video-only controls (offset, speed, re-link) already live. The rule
this establishes: **Row 1 = state you scan ACROSS layers (visibility, lock, type); Row 2 = controls
for the layer you're working on.** Apply it to any future per-layer control. Row 1 is now at most
eye + lock + type before the name. Row 2 then **wraps** (`flex-wrap` + `gap-y-1`) rather than getting
a hand-partitioned third row: the panel is a fixed `w-56` (224px) and this row keeps gaining controls
(two were added on 2026-08-09 alone), so a fixed partition would need re-cutting each time while wrap
can never clip. Sliders slimmed to `w-12` / readouts `w-5` so a DRAW layer still fits one line and
only video refs flow onto a second; the offset+speed inputs sit in a nested flex so they stay
adjacent across the wrap. **Owed:** eyeball the wrap on iPad.

**Icon-button + contrast pass (2026-08-11):** the layer panel had TWO icon-button treatments —
`text-text-secondary` with no hover (6 buttons: eye, lock, audio, embed…) and
`text-text-muted hover:text-text-secondary` (7: rename, re-link, rasterize, transform…) — so icons
differed in both resting brightness and whether they responded at all. All 13 (+2 in `AudioLane`)
are now **`text-text-secondary hover:text-text`**; use that for any new icon button. Separately,
`--color-text-muted` failed WCAG's 3:1 minimum for UI text in BOTH themes (#999 on white ≈ 2.85:1,
#666 on #1e1e1e ≈ 2.8:1) — raised to **#6b6b6b / #8a8a8a** (≈5.3:1 / 4.7:1). That token is used in
~25 places (timeline glyphs, ruler ticks, layer readouts), so the whole app gets slightly more
legible secondary text; the ruler ticks in particular benefit, since they were separately reported
as barely visible. The layer detail row also went **all-12px** (`text-xs`): its slider readouts and
the offset/speed labels were 10px sitting next to 12px inputs, which read as faint rather than small;
readout spans widened `w-5` → `w-6` so "100" / "1.0" don't clip. A draw layer still fits one line
(~189px of ~196).

**Timeline lock enforcement, round 2 (2026-08-11):** the 2026-08-09 lock pass stopped locked rows
from being WRITTEN, but not from being _gestured at_: pressing a locked row still started a
move-block or hold-resize drag, the write was refused downstream, and the keys visibly snapped back —
which reads as a broken timeline, not a protected layer. `rowDown` now refuses to enter
`moveblock`/`resize` on a non-editable row (`isLayerEditable`, so hidden counts too); SELECTION is
still allowed because copying a locked row is a read. Correspondingly `TimelineSelectionBar` disables
Cut/Paste/Paste-insert/Delete when NO row in the selection is editable (they would silently skip
every row), keeping Copy and Clear; a mixed selection keeps them enabled and the block ops skip the
locked rows as before. The timeline gutter now shows a 🔒/EyeOff marker on read-only rows — the
layer panel had the only lock indicator, which is the wrong place when the refusal happens in the
timeline. **Owed:** press-drag a locked row (nothing moves, no ghost), the disabled bar states, and
the gutter marker's sticky position at `left: LABEL_W` while scrolling horizontally.

**Timeline gutter geometry (2026-08-11):** the gutter was one 80px column that every row filled
differently — layer rows put the read-only marker in a separate column AFTER it, while the audio
lane crammed its mute + ✕ INSIDE it, so nothing aligned and names truncated to "R…". Now three
constants in `Timeline.svelte`: `LABEL_W` (120, name), `MARKER_W` (22, read-only/hidden marker —
**always rendered, blank when editable**, which both aligns the rows and gives the frame cells a gap
after the name), and `GUTTER_W = LABEL_W + MARKER_W`, which is what the ruler spacer, both playhead
offsets and `TimelineSelectionBar`'s `labelW` now use. `AudioLane` takes `labelW` + `markerW` and
puts its ✕ in the marker column, so it lines up with the layer rows' lock/hidden icons. Anything new
in the gutter must pick a column rather than inventing its own offset. The gutter stays FIXED-width
(a drag-resizable one was considered and deferred: `LABEL_W` would have to become reactive state
threaded through four consumers plus prefs persistence). **Owed:** horizontal-scroll check that all
three sticky columns hold together, and the audio ✕ alignment on iPad.

**Live-counter jitter (2026-08-11):** any readout that updates while scrubbing needs BOTH fixes or
it shifts its neighbours. (1) `tabular-nums` — without it "1" is narrower than "2", so even
11 → 12 changes width (this was the Playbar's "Frame n/n", which pushed Length/In/Out sideways every
step). (2) **Reserved width** for the changing number (`inline-block text-right` +
`min-width: {digits}ch`, digits = `String(frameCount).length`) — tabular figures equalize digit
WIDTH, not digit COUNT, so 9 → 10 still shifted. The status bar's ambient readout and the Playbar
both do both now; apply the pair to any new live counter.

**Playback / navigation shortcuts (2026-08-11):** **Space** is now shared — a quick TAP (<300ms with
no pan drag) toggles playback, HOLDING it still grab-pans as before. Implemented in `Canvas.svelte`
(it owns `spaceHeld`/`panning`): keydown stamps the time, `startPan` sets `spacePanned`, keyup
toggles only if neither disqualifies it — so abandoning a pan (hold, don't drag, release) doesn't
start playback. Also global in `App.svelte`, after its INPUT/TEXTAREA guard so typing is unaffected:
**←/→** step a frame (**Shift** = 10), **Home/End** first/last frame, **↑/↓** move the ACTIVE LAYER
up/down the stack (note `project.layers` is bottom-first, so Up = +1 index). `k`/`Enter` and `,`/`.`
still work. Gotcha found while wiring this: the ruler's own `rulerKey` handles the same arrows for
its `role="slider"` contract, and window-level handlers fire on bubble too — it now
`stopPropagation()`s, or a focused ruler stepped TWO frames per press. **Owed:** the Space tap/hold
split by feel (is 300ms right?), and that arrows don't fight any iPad external-keyboard behavior.

**Bar visual language (2026-08-11):** the playbar and the timeline tool bar sit stacked but looked
like different design systems — the timeline's `toolBtn` was literally the playbar's `btn` plus
`border border-border`, so only its controls read as buttons. The playbar now uses the same bordered
button, a `textBtn` variant (`h-7 px-2`) for text labels like In/Out (a fixed `w-7` clips "Out"), and
the timeline's separator (`w-px h-5 bg-border mx-1`) between groups: transport | frame+length |
range | settings. Keep new bars on this language rather than inventing a third.

**Onion controls → popover + keyframe stepping (2026-08-11):** the onion params were three inline
labels and the only `text-xs` text in a `text-sm` bar — wide and visually off. They now live in a
settings popover mirroring **line boil** one divider away (toggle button + gear + popover); keep new
per-feature params on that pattern instead of inlining them. New **`onion.byKeyframes`**: ghosts step
to neighbouring KEYFRAMES rather than neighbouring frames, so holds don't burn an onion slot — on a
hold, "prev" is the key it holds. Implemented as an optional `keyframes` argument to the pure
`computeOnionFrames` (6 unit tests incl. hold-start and end-of-track). The keyframe list always comes
from the **active layer** (those are the drawings being worked on) even when `allLayers` is on —
that flag only decides WHAT is drawn at the chosen frames; the popover says so inline. Note onion
config is still not persisted (pre-existing roadmap item), so this resets on reload like the rest.

**Focus-ring policy (2026-08-11):** the app had NO focus CSS, so every focusable element painted the
browser default — including on pointer clicks, which is why scrubbing the timeline ruler left a blue
ring around it (it is a `div[role="slider"][tabindex="0"]`, so a click focuses it). Now in
`app.css`: `:focus:not(:focus-visible) { outline: none }` plus one themed `:focus-visible` ring
(2px `--color-selection`). The ruler itself then went `tabindex="0"` → **`-1`**: once ←/→/Home/End became global
(App.svelte), focusing it granted no capability, so it was only a stray tab stop plus a click ring.
`role="slider"` + `aria-valuenow` stay so AT can read it in browse mode (a role with pointer
handlers also keeps Svelte's a11y lint quiet, which stripping the ARIA would not). The
gizmo handles (`tabindex="-1"`) aren't tab-reachable at all, so their ring was always noise. Don't
add per-component `outline: none` — the global rule already scopes rings to keyboard use.

**Tailwind class linting (2026-08-11):** conflicting utility classes (two classes setting the same
CSS property) were only visible in the IDE's Tailwind IntelliSense — `npm run lint` never saw them,
so `relative sticky` shipped on the ruler. Added **`eslint-plugin-better-tailwindcss`** with exactly
two rules: `no-conflicting-classes` (error) and `no-duplicate-classes` (warn). Tailwind 4 is
CSS-first, so the plugin needs `settings["better-tailwindcss"].entryPoint = "src/app.css"` to resolve
the theme — without it the rules silently pass. Also on: `enforce-canonical-classes`
(warn, AUTO-FIXABLE — it caught 59 spots: `w-8 h-8`→`size-8`, `px-1 py-1`→`p-1`, `top-0 bottom-0`→
`inset-y-0`, `text-xs leading-6`→`text-xs/6`, `w-[3.25rem]`→`w-13`) plus `no-unnecessary-whitespace`,
which is REQUIRED alongside it — collapsing a pair leaves a double space that nothing else cleans up.
Deliberately NOT enabled: class-ORDER rules (`prettier-plugin-tailwindcss` already sorts, they would
fight) and `no-unregistered-classes` (this codebase has real custom classes — `layer-drag-handle`,
`selection-actions-panel`, `curve-popup`).
Since the pre-commit hook runs `eslint --fix`, conflicts now fail before they can be committed.
Verify a rule actually fires after config changes (re-introduce a conflict and see it error) — a
misconfigured plugin passes silently and looks exactly like a clean codebase.

**Native control theming (2026-08-11):** the app styles range sliders heavily (~40 lines of
per-engine pseudo-elements in `app.css`) but left checkboxes, number spinners, the color swatch and
scrollbars completely vanilla — and with no `color-scheme` declared, the browser drew all of them in
its LIGHT palette even in dark mode (that bright blue system checkbox in the onion bar). Fixed with
two properties on `:root`/`.dark`, not new markup: `color-scheme: light|dark` (every native control
follows the theme) and `accent-color: var(--color-selection)` (tints checkboxes/radios). Note these
belong on `:root`/`.dark`, NOT in `@theme` — that block only declares tokens. Reach for these before
hand-building a custom checkbox.

**Read-only state signalling (2026-08-11):** locked and hidden layers now render their icon in
**amber** (`text-amber-500`) in BOTH the layer list and the timeline gutter marker; normal states sit
at `text-text-muted`. Rationale: `Lock`/`LockOpen` differ only by a shackle offset — identical weight,
unreadable at 15px — so state must be carried by colour, not glyph shape. Amber, not red: these are
deliberate states, not errors, and it matches the existing `text-amber-500` "Apply layer transform to
select" note in ToolOptions; red stays reserved for destructive/error. This is the same signal the
status hint gives ("Layer locked/hidden — …"), so a layer that silently refuses edits now says so in
three places. NOTE these two buttons deviate from the standard
`text-text-secondary hover:text-text` icon-button class ON PURPOSE — they convey state, not just
affordance.

**Reference layers can be locked (2026-08-11):** `locked` was `DrawingLayer`-only; refs now have
`locked?: boolean` (persisted, defaults false, old saves load unlocked — 2 round-trip tests). It is
arguably MORE needed here than on draw layers: the ref gizmo is live under **every** tool (unlike
draw layers, which need the Transform tool), so any stray canvas drag could nudge an aligned
reference. Scope mirrors what lock means for drawing layers — it protects CONTENT, not management:
blocked = the transform (gizmo hidden via `activeTransformLayer`, drag refused in `Canvas.onStroke`'s
ref branch); still allowed = visibility, opacity, rename, reorder, delete, re-link, and the video
offset/speed/audio toggles (deliberate panel acts, not accidental canvas ones). NOTE
`isLayerEditable` stays draw-only — it is a `layer is DrawingLayer` type predicate gating pixel ops;
the ref lock is checked directly at those two transform sites. The amber icon, timeline gutter marker
and status hint all had `kind === "draw"` guards that were widened to plain `layer.locked`.

**Group lock — DERIVED, never cascaded (2026-08-11):** `LayerGroup.locked` locks every member, but
the members' own `locked` flags are NEVER touched: the effective state is computed at read time by
`isLayerLocked(layer, groups)`, mirroring the `isLayerVisible(layer, groups)` contract that group
visibility has always used. This is the answer to "should we save and restore the children's state?"
— there is nothing to save: unlocking the group reveals each member's own lock automatically, and the
stale-state cases (child unlocked while the group is locked, layer dragged out of a locked group,
undo across a toggle) simply cannot arise. `isLayerEditable(layer, groups)` now takes the groups list
— the signature change surfaced all 27 call sites through the compiler, which is how it caught a
LATENT BUG: it previously checked `layer.visible` only, so a layer inside a HIDDEN GROUP was still
editable (the "editing what you can't see" problem, still reachable via groups). `groupHasLockedLayer`
also returns true for a locked group itself, pinning its own transform. UI: a padlock on the group
header beside the eye; a member row shows amber and "Locked by its group" when locked that way;
timeline gutter marker and status hint use the effective state too. Persisted (optional, old saves
load unlocked).

**Group-derived state audit (2026-08-11):** after group lock shipped, a grep for RAW `.locked` /
`.visible` checks (i.e. ones bypassing `isLayerLocked`/`isLayerVisible`) found four more of the same
bug family, one of them data-integrity: **`timeline-block.ts` paste/delete/move skipped only
OWN-locked rows, so a group-locked layer could still be written to** (now group-aware + unit-tested);
the ref gizmo let a ref inside a hidden/locked GROUP stay draggable; `Canvas`'s pose overlay and
`selection.hidden` used raw visibility, so a group-hidden layer kept painting its lift; the timeline
gutter's hidden marker ignored group visibility. **The lesson: any new group-level state creates a
whole class of "checked the raw flag" bugs, and the grep `\.locked|\.visible` minus the helpers finds
them in seconds.** Re-run that audit whenever group state is extended. Legitimate raw uses that stay:
the toggle buttons themselves (they set/report a layer's OWN flag) and `duplicateLayer`/`rasterize`
copying flags.

**High-effort review fixes (2026-08-11):** a 27-agent review of the session's 68 commits confirmed 10
defects with two root causes; all fixed. **(a) Derived-vs-raw state** (the family the grep audit only
partly caught): the lift-discard effect read raw `al.locked`, so locking a layer's GROUP left a
pose/selection lift alive to bake into it later — reading `isLayerLocked` there also makes the group
flag a tracked dependency, which the raw read never was; `mergeDown` had NO lock/hidden guard at all
and replaced a locked layer's whole cell track; block ops skipped locked rows but still wrote HIDDEN
ones (now `isLayerEditable`, i.e. draw+unlocked+visible, matching the row gestures and the selection
bar); the canvas ref-drag path and `groupHasLockedLayer` ignored group/ref locks; the gutter marker
drew its glyph from the raw flag while its tooltip used the derived one. **(b) Transform-drag bracket
lifecycle:** only FRAME scope guarded against mid-gesture retargeting, so an active-layer switch
(newly easy via the global ↑/↓ keys) applied layer A's grab-time transform to layer B — there is now
a grab-time `layerId`/`groupId` identity check for all scopes; a tool OR scope switch mid-drag never
settled the bracket (the tool `$effect` now calls `transformDragGuard.settle`, reading the scope so it
is a dependency); the gizmo's WINDOW listeners survived its own SVG unmounting, so a mid-drag lock
kept transforming the pinned layer; and settling with no readable end transform committed an EMPTY
undo entry that the same undo popped (undo appeared dead) — brackets now track a `dirty` flag and
commit only if the gesture actually wrote. **Standing lesson: a new global keyboard shortcut widens
what "mid-gesture" means for every pointer gesture in the app.**

**Not-allowed cursor on a read-only layer (2026-08-11):** a locked/hidden active layer silently
swallowed strokes — the guards refused the write but the UI still showed a brush ring, i.e. it
promised a stroke it would not make. `Canvas` now derives `toolBlocked` (a WRITING tool +
`!isLayerEditable`) and swaps in `cursor-not-allowed`, and `BrushCursor` hides its ring in the same
condition. WRITING_TOOLS is deliberately brush/eraser/fill/deform/pose/transform only: the
**eyedropper samples the composite** and **select/lasso can still COPY** from a locked layer, so
flagging those would be a worse lie than showing nothing. Pan (space/middle-drag) keeps its grab
cursor, since panning works regardless. Together with the amber icons and the status hint, a
read-only layer now announces itself in four places.

**iOS file-picker `accept` quirk (2026-08-11):** "Import audio…" set `accept="audio/*"` — correct per
spec, but on iPad the audio files sat GREYED OUT in the picker while video looked selectable. iOS
resolves `accept` MIME globs to UTIs and does it badly for `audio/*`; explicit EXTENSIONS are matched
reliably, so the audio accept is now
`audio/*,.mp3,.m4a,.aac,.wav,.aif,.aiff,.caf,.flac,.opus,.ogg`. This affects **every browser on
iPad** — Chrome/Firefox there are WebKit wrappers using the same system document picker — so don't
dismiss it as Safari-only. `image/*` and `video/*` map fine and are left alone. If a future picker
misbehaves on iPad, widen it with extensions before suspecting app logic.

## iPad verification pass — 2026-08-11 (ALL PASSED)

A full device pass on iPad (Chrome — note every iPad browser is a WebKit wrapper) against the
deployed build. **Everything checked passed**, so the "owed a browser pass" notes in the entries
below are SUPERSEDED for these items — do not re-litigate them:

- **Lock/hidden enforcement:** locked layer refuses strokes; no gizmo under Transform; timeline keys
  don't move (no snap-back); group lock shows amber + "Locked by its group" on member rows and the
  timeline gutter; merge-down onto a locked layer refused; locked reference doesn't shift on drag.
- **Undo around transform drags:** drag → undo restores; press-and-hold without moving → undo hits
  the PREVIOUS action (no empty entry).
- **Reference media persistence:** image restores after a full app restart with no re-pick; video
  embed toggle restores; non-embedded video returns as a re-link placeholder.
- **Audio Phase 2:** scrub audible on ruler drag; waveform drag-to-offset works on touch
  (`touch-action`); a right-dragged clip stays silent until the playhead reaches it; mute works.
- **Layout/UI:** layer detail-row wrap, offset/speed labels, timeline gutter + playhead badge +
  range brackets, playbar has no counter jitter across 9→10→99, onion popover incl. step-by-keyframes,
  project name → save filename.
- **iOS picker fix** (`accept` + explicit audio extensions) confirmed working.

**Still unverified — do NOT treat the above as blanket coverage:**

1. **Desktop-only paths**, untested throughout: space-drag pan / middle-mouse autoscroll / ⌘Ctrl+scroll
   zoom (2026-07-10 entry), and the keyboard-driven mid-gesture cases from the review fixes (⌘Z during
   a grab, tool/scope switch mid-drag, ↑/↓ layer switch mid-drag).
2. **Pre-2026-08 iPad debt** not on this pass: timeline block copy/paste gestures (long-press,
   overwrite-vs-insert), toolbar menu reachability, transparent-bg/paint-behind, pose gizmo detail,
   status-hint-on-tap for every control.
3. Anything added AFTER this date.

**Finger-pan the timeline (2026-08-11):** on iPad a long timeline could only be scrolled by dragging
REF rows or empty space — drawing rows set `touch-action: none` for their own gestures, which also
disables the browser's scrolling, and every other row area consumed the drag for selection. Fixed by
panning `gridWrapper` ourselves when a FINGER drags outside the current selection (`touchPan` in
`Timeline.svelte`), which matches the canvas convention already documented at `Canvas.svelte`'s
`setupTouchGestures`: **finger navigates, Pencil edits.** Deliberately narrow — pen/mouse behaviour is
untouched, and with a finger the tap-to-select, long-press-marquee, hold-span resize and move-block
gestures all still work; only the "outside the selection" drag (most of a row's area) becomes a pan.
The pan is checked BEFORE the marquee branch so a scroll can never turn into a selection, and it
clears `armedOutside` so the release isn't treated as a tap.

**Eyedropper commits on RELEASE (2026-08-11):** it used to apply on pointer-DOWN
(`points.length === 1`), so you got whatever pixel you happened to land on. Now the pick is taken
from the LAST point when `done`, so you can drag to slide the sample point and lift to take it —
the `BrushCursor` swatch previews the colour under the pointer throughout the drag. This also
removed the `pickingGesture` latch: that existed only because `applyEyedropper` switches the tool
back MID-gesture, letting the rest of the gesture fall through and draw a stray dab — committing on
release closes that window entirely.
**The eyedropper is Pencil/mouse-only, by design (corrected 2026-08-11).** An earlier note here
claimed a finger pick worked but was "blind" (no preview swatch) and wanted a loupe above the touch
point. That was wrong: a finger never picks at all. `input.ts`'s `shouldDraw` admits only
`mouse`/`pen`, so a touch never reaches `onStroke`, and `touch-gestures.ts` claims a one-finger drag
as a canvas pan under EVERY tool — the app-wide **finger navigates, Pencil edits** convention. The
`BrushCursor` finger skip is therefore consistent, not a gap. Making the eyedropper an exception
(finger-drag picks + offset loupe, pan via two fingers) was considered on 2026-08-11 and
**declined** — the convention is worth more than a tool that is transient anyway. Don't "fix" the
`pointerType` filter in `BrushCursor` without changing `shouldDraw` too; on its own it would do
nothing.

**Real favicon + icons from the "slop" artwork (2026-08-14):** the app had NO `<link rel="icon">` at
all — only a manifest and an apple-touch-icon — so every browser tab showed the default globe, and
the PWA icons were a placeholder squiggle drawn analytically. Both replaced with the real hand-drawn
mark. **Two sources on purpose, and they must stay in sync:** `public/icon.svg` is the full "slop"
logotype (four letters of hand lettering — reads beautifully at 180px+, turns to an indistinct blob
at 32), and `public/favicon.svg` is the **star glyph alone**, which is what the browser tab gets.
Declaring BOTH `rel="icon"` forms (SVG + a 32px PNG) means no browser ever falls back to requesting
`/favicon.ico`, so no `.ico` is needed. White plate, black ink (`#fff`/`#000`) — chosen over the old
dark-plate icons because a white square reads on any tab bar; note `manifest.webmanifest` still
declares a dark `background_color`/`theme_color`, which is right for the app's dark UI but does mean
the PWA splash is dark behind a white icon. `tools/make-icons.mjs` was rewritten to RASTERIZE those
SVGs rather than draw its own mark: it stays dependency-free (the project installs no SVG
rasterizer), parsing the path, flattening cubics, and scanline-filling with the **even-odd** rule at
4× supersampling — even-odd matters, it is what keeps the counters of "o" and "p" hollow. Only `M`,
`c` and `z` are supported, and an unknown command THROWS rather than silently dropping part of the
mark; widen it if the art ever needs more. The fit is computed from the flattened path's own ink
bounds, so new artwork centres itself with no hand-tuned numbers (an earlier hand-guessed bounding
box put the star wildly off-canvas — let the code measure it). Regenerate with
`node tools/make-icons.mjs`; outputs are committed and not wired into the build.
**Verified 2026-08-14:** the star shows in the browser tab. The installed Home Screen icon is NOT
confirmed — iOS snapshots it at install time, so seeing the new logotype there needs a
remove-and-re-add of the Home Screen app, not just a reload.

**The selection marquee is screen-constant (2026-08-14):** asked as "the marquee scales with zoom —
is that intended?" It wasn't; it was half-done. `Selection.screenScale` was maintained on every
viewport change (`Canvas.svelte`'s `viewport.onChange`) but consumed at exactly ONE place —
hit-testing — so the GRAB TARGET was zoom-independent while the DRAWING was not. The overlay canvas
is document-sized and sits inside the zoom-transformed wrapper, so `lineWidth = 1`,
`setLineDash([4,4])` and the 8px handles all scaled: at 400% the ants were 4 screen px thick with
16px dashes, at 25% a sub-pixel line and 2px handles that were still grabbable within 12 screen px —
**you could grab a handle you could barely see**. That mismatch, not the aesthetics, was the actual
defect. Fixed with a private `get px() { return 1 / this.screenScale }` — one SCREEN pixel in
document units — applied to every cosmetic size: marquee width/dashes, the `lineDashOffset`
(so the ants' crawl SPEED is screen-constant too — `marchOffset` cycles 0..8 in screen px), the
rotate tether, the warp grid lines, and `HANDLE_SIZE`. Selection GEOMETRY stays document-space;
only chrome is compensated, which is why no selection math or test changed. **One deliberate
behaviour change beyond cosmetics:** `hitTolerance` lost its `Math.max(HANDLE_SIZE + 2, …)` floor.
That floor was a DOCUMENT-space number that matched the old document-space handle; with handles now
drawn at a constant 8 screen px it would have grabbed from 5× the handle's width at 4× zoom. It is
now plainly `MIN_HIT_PX * px` = 12 screen px at every zoom, i.e. a constant 4px of forgiveness
around the 8px handle. Net effect: grabbing is TIGHTER at high zoom than before (12 screen px where
it used to be 40) and identical at 100% and below. **The rule this sets:** the overlay canvas is
document-space, so anything cosmetic drawn on it must be multiplied by `px`; every other overlay in
the app (transform gizmo, brush cursor, the paintable-edge hairline) is already screen-space by
construction. **Owed a browser pass:** marquee at 25% / 100% / 400% (constant weight, constant dash
size, constant crawl speed); handles the same size at every zoom; grabbing a corner handle at high
zoom still feels right with the tighter tolerance; lasso outline; the warp/deform grid; iPad pinch
zoom mid-selection.

**Marquee crumbs at high zoom (2026-08-14):** `px` made the _intended_ size one screen pixel, but
the overlay was still document-sized inside the CSS zoom — at 4×, `lineWidth = 0.25` canvas px
rasterized to crumbs, then blown up. Overlay is now **stage-sized** (sibling of the zoomed wrapper);
`applyView` puts pan/rotate/zoom on the 2D context so the stroke is rasterized after scale.
Hit-testing resets the transform so `isPointInPath` stays in cell space. The overlay is
`z-10` above the CSS-transformed display wrapper (WebKit can composite a transformed
sibling on top). The tool `$effect` only banks a float when the tool actually changes —
re-running it on `hasFloating` used to commit+clear a lift started from the on-canvas bar.

**Fit to view is reachable without a keyboard (2026-08-14):** `fitView` had exactly ONE caller —
the `0` key in `Canvas.svelte` — and no UI route at all, which meant that on iPad (no keyboard) a
canvas flung off-screen by a stray two-finger pan could only be recovered by RELOADING the page.
The viewport is not persisted, which is the only reason that escape hatch existed. Added
"Fit to view (0)" as the first item of the **View** menu, reaching the Canvas-owned `Viewport`
through a new `viewActions.fitView` registry in `appState` — the same register-on-mount /
null-on-teardown pattern as `selectionActions`/`poseActions`/`liftGuard`, because `Viewport` is a
Canvas-local object and nothing outside Canvas can hold it directly. The label carries the shortcut
so desktop users learn the key. Placement was chosen over a permanent status-bar button (rejected
for now as chrome for a rare action, though it is the better answer if getting lost turns out to be
common — the menu is three taps deep exactly when you are lost). **Owed:** confirm on iPad that the
menu item recentres a lost canvas.

**Transformed layers show their paintable edge (2026-08-12):** reported as "when I draw on a
moved/scaled layer the drawing just cuts off suddenly, with no hint where the edge is". Cause, worth
stating plainly because it is structural: **a cell canvas is exactly document-sized**, so a layer's
paintable area is the DOC RECT pushed through `group ∘ layer ∘ cell` — scale a layer down and your
strokes stop landing part way across the screen. The real cure is the deferred **tiled +
copy-on-write cell storage** roadmap item (an expandable canvas); this is the honest cheap
mitigation — it shows you the wall rather than removing it. New `LayerBoundsHint.svelte` traces that
boundary as a hairline: doc-rect corners through `forwardChain` over the inner-to-outer step list
(cell, layer, group — the same compose order the render uses, gotcha #4), mapped to SCREEN space
like the gizmo, because a 1px line drawn on the document-space overlay canvas would thicken with
zoom. Shown only for tools that write pixels (brush/eraser/fill/deform/pose) and **never for
`transform`**, whose gizmo already draws that exact rect — two outlines on one rect read as a bug.
Also skipped when every step is identity (the bound IS the document edge, already visible) and when
the layer is locked/hidden (the stroke is refused outright and says so, so there is no edge to warn
about). Styled as white-solid-under / black-dashed-over, the marquee's trick from `selection.ts`, so
it stays legible over both ink and paper; the dashes never animate, since this is passive chrome and
not a selection. It is a SEPARATE component rather than part of `RefTransformGizmo` on purpose: the
gizmo's chain is SCOPE-dependent (what you are editing) while this one is always the full
composition (what you can paint into), so they share only `forwardChain`. **Verified 2026-08-12:**
the user manipulated all three transform levels (frame/cell, layer, group) and the paintable area
was correctly indicated throughout — which is the compose-order risk, the one that mattered. Still
unconfirmed: the line staying 1px across zoom levels, no double outline when switching to the
Transform tool, and iPad.

**A `disabled` button can never explain itself (2026-08-12):** reported as "with a hidden or locked
layer selected, only Copy looks active in the timeline selection bar — is that right?" The
enable-states were right and stay: writes (Cut/Paste/Paste-insert/Delete) are refused when NO row in
the selection is editable, Copy and ✕ stay live because **reading** a locked row is fine. Three
alternatives were considered and rejected: disable everything (blocks a harmless read and makes the
bar look broken), enable everything (defeats the lock, and re-opens the "editing what you can't see"
bug the 2026-08-11 review closed), and **hide hidden layers from the timeline entirely** — the
tempting one, and the worst: visibility is a TRANSIENT VIEW STATE while the timeline is the
document's STRUCTURAL view, so rows would shift under you on an eye-toggle, block selections
spanning layers would destabilise, and the layer panel and timeline would disagree about what
exists. The real defect was that nothing said WHY: the reason was already in each button's `title=`,
but **a `disabled` button dispatches no pointer events, so `App.svelte`'s delegated
`pointerover`/`pointerdown` status-hint listener can never read it** — the control most needing to
explain its refusal was the only one structurally unable to. Fixed by using **`aria-disabled` +
guarded handlers** instead of `disabled` (`TimelineSelectionBar.svelte`), with
`aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-transparent` keeping
the identical dimmed, inert look; the button stays pointer- and keyboard-reachable, so it speaks on
hover AND on an iPad tap. Paste also now distinguishes its two refusals ("nothing copied yet" vs the
read-only reason, read-only first — the harder block, matching status-hint precedence). **The
general rule: if a control's `title=`/hint explains why it is unavailable, it must be `aria-disabled`,
not `disabled`.** `ToolOptions.svelte` was converted the same day: the five select/lasso ops
(Copy/Cut/Paste/Delete/Deselect) now append the PRECONDITION to their shortcut titles ("select an
area first" / "nothing copied yet" / "nothing selected") instead of only naming the shortcut, and
the Transform tool's **Group** scope button — which already carried the real explanation "Active
layer is not in a group" that nobody could ever read — now delivers it. There are no known
`disabled` controls left whose title explains a refusal; `ExportDialog`'s buttons keep plain
`disabled` on purpose, since that dialog states its own reason in a separate line of body text.
**Verified 2026-08-12 on BOTH iPad and desktop:** a dimmed bar button reports its reason in the
status bar. Nothing owed.

**Audio Phase 3 — export muxing (2026-08-11):** the project audio track is now muxed into the
MP4/WebM export, closing the audio roadmap (P1 import/playback, P2 scrub/offset/mute, P3 export).
Alignment reuses the PLAYBACK rule rather than restating it: `audioExportPlan`
(`src/export/audio-mix.ts`, pure + unit-tested, 11 cases) calls the same `bufferOffsetForFrame` that
`AudioEngine.play` does, so the two cannot drift apart; it returns null — meaning **no audio track
in the file at all**, never a silent one — for no track, a **muted** track (mute means silent
export, WYSIWYG), or a clip dragged entirely outside the export window (including the two
deliberate `>=` boundaries: a clip starting exactly at the window end, or exactly at its own end).
`buildExportAudio` applies the plan with ONE `OfflineAudioContext` render, which does placement,
truncation at the window end and **resampling to 48 kHz** (accepted by both AAC and Opus, so a
44.1 kHz import needs no special case) in a single step. `exportVideo` now returns
`{ blob, warning? }` instead of a bare Blob: audio is decided before `output.start()` (mediabunny
cannot add a track later) and **any audio failure drops the audio, never the render** — a
multi-minute encode must not be lost to a missing encoder. The codec probe passes
`getFirstEncodableAudioCodec` only the ONE codec the container actually needs (`aac` for MP4,
`opus` for WebM), not `outputFormat.getSupportedAudioCodecs()`'s full list — that list also
contains PCM, which mediabunny's `canEncodeAudio` reports as always encodable, so probing it can
never return null and would silently mask a missing AAC/Opus encoder. `@mediabunny/aac-encoder`
was deliberately NOT added: every browser with the WebCodecs VideoEncoder this export already
requires also encodes AAC natively. No UI control — a track that exists and is not muted is
included, and mute is already the control for excluding it. Two real failure outcomes, not one: a
**synchronous** `add()` failure (before any packet is encoded) leaves the track with no data at
all, so `finalize()` — which only iterates tracks that received a packet — skips it, and the
export **succeeds** with a warning and no audio track; an **asynchronous** encoder failure instead
throws from `output.finalize()` and produces **no file**. `audioSource.close()` is now called
immediately after `add()` (same try block) so that flush starts before the frame loop rather than
only at `finalize()` — this doesn't save the file on an async failure, but shrinks the time to
finding out from "after a multi-minute render" towards "within seconds". Reference-video
soundtracks (`audioEnabled`) are still preview-only. **Confirmed working in the browser on
2026-08-12** — the user exported and got audio. That covers the main path (a track exports, plays,
and is not silent); the enumerated edge cases below were NOT individually walked, so treat them as
still owed rather than as covered by that confirmation. **Owed a browser pass:** MP4 and WebM both
carry audio and stay in sync; a positive offset starts the audio late by that amount; a negative
offset starts partway into the clip; a muted track exports silent; audio longer than the animation
is cut at the video's end; a clip dragged entirely past the last frame exports with no audio track
and still succeeds; PNG-sequence export unaffected; a mono import (channel-count path); a 44.1 kHz
source (exercises the resample — iPad/Safari is the one to watch); a long project (the whole
window is materialised as one 48 kHz buffer, ~23 MB/minute stereo, so memory is the risk and it
degrades to a warning rather than a crash); and iPad for at least the MP4 path. Spec/plan:
`…/2026-08-11-audio-phase3-export-muxing*.md`.

**Review-fix batch (2026-08-14, on `fix/review-batch-1`):** second-opinion review of `main` found
seam bugs (later features not threaded through older paths). Fixed, with tests where the logic is
pure (~409):

- `ensureDrawableKeyframe` copies the held key's `transform`/`transformBox` (draw-on-hold no longer
  jumps a cell-transformed drawing to identity).
- `audioPlayPlan` + `AudioEngine.play` stay silent at/past clip end (`start(0, at)` threw and could
  freeze transport). `syncReferenceVideos` freezes an ended video instead of `play()`-restarting
  from 0. Play-start no longer seeks/plays refs itself (one policy, the Canvas tick).
- `undo()`/`redo()` `bump()` after a successful pop so pixel undo dirties autosave and invalidates
  glyph/bounds caches (structural restore already bumped).
- `groupActiveLayer`/`ungroup` go through `commitStructural` (`groupId` was snapshot-restored but
  the actions never pushed).
- Transform-drag `dirty` is `!isSameTransform(startT, getT())` after apply, not "handle was hit" —
  ⌘Z on a no-move grab no longer pushes an empty entry.
- `liftGuard.discard` before `mergeDown` / `applyLayerTransform` / `applyCellTransform` / `clearFrame`.
- Timeline gutter padlock uses `isLayerLocked` (group lock was invisible). Keyboard Cut/Delete
  no-op when `anyEditableLayer` is false (no empty undo). Move-ghost skips inert rows.
- `seekPlayhead` `syncTo`s project audio while playing. Export pauses playback (shared boil GL).
- `idbDo` resolves on `tx.oncomplete` / rejects on abort (and always closes). Persist generation
  drops a stale autosave put and aborts a prune after New/Open.
- Finger Reset-to-fit + pose bar reuse `.selection-actions-panel` so touch-pan does not steal them.
- `input.ts` binds `pointercancel` (same path as up/leave). Not a full abort-restore.

**Still open from that review:** none of the original high-severity items.

**Review leftovers (2026-08-14, on `fix/review-leftovers`):** the narrower items left after the
high-severity batch. (1) `resolveSelectionRect` skips collapsed-group members (they have no
timeline row; a spanning marquee no longer rewrites hidden art). (2) A mid-stroke layer/frame
switch (`↑/↓` / `←/→`) commits the open stroke with its grab-time compose and drops the rest of
that pointer — it no longer paints the old cell through the new inverse. (3) Timeline Paste
enablement follows the paste dest (`anyEditablePasteTarget` = writable draw layer at/below the
active layer), not the selection. (4) Locked-row hover cursor was already default (prior batch).
(5) `moveBlockFrames` keeps leading holds as holds so a mid-span drag does not duplicate the
resolved key (copy/paste still materializes).

**persistTick vs version + pixel-undo byte budget (2026-08-14):** `bump()` now increments
`persistTick` as well as `version`; `repaint()` is version-only (play/stop, onion, layer
switch, media hydrate). Autosave watches `persistTick`, so a play/stop no longer schedules
a full PNG encode. Pixel undos carry a `bytes` cost (`pixelCommand`); History evicts the
oldest commands past 256 MB (~15 full-frame 1920×1080 strokes) while still keeping at
least one, and still caps at 50 commands.

**Scaled-down layer looks pixelated (2026-08-14):** the display canvas was document-sized
and the viewport zoomed it in CSS, so a layer at 0.3 then zoomed to work on it was a
handful of display pixels blown up. `drawCellComposed`/`drawTransformed` now use
`imageSmoothingQuality: high`, and the display backing store supersamples by
`min(zoom, 2)` (export stays 1×). Cells stay DPR=1. Zoom past 2× can still soften;
a full screen-space camera is the next step if that shows up.

**Two-finger rotate is live again, snap window tightened (2026-08-14):** a 15° engage
floor blocked small intentional rotates. Restored Procreate-style live twist during the
pinch; on lift, snap to 90° only inside ~3° (`snappedRotation`, unit-tested) so a 2° pan
tilt pops back and an 8° rotate stays. Snap still runs only after a two-finger pinch. Snap now rotates about
the last pinch midpoint (`panKeepingScreenPoint`) so it does not jump around the CSS
top-left origin.

**Select/deform/pose under transforms + stage input (2026-08-14):** paint/fill already
inverse-mapped `group ∘ layer ∘ cell`; select/lasso/deform/pose now do the same (`toCellSpace`)
so a transformed layer is editable where its ink appears. The layer-transform
"Apply first" gate and status hint are gone. `setupInput` listens on `stage` (not the
document-sized display) and no longer treats `pointerleave` as stroke-end — capture +
`pointercancel` end the gesture, so a translated/scaled layer is paintable outside the paper.
**Amended 2026-08-15 — the OVERLAY is no longer uniformly composed.** Which chrome carries the
compose is decided by the LIFT's space, via `Selection.cellSpaceLift`, never by `state`
(a selection warp and a deform warp are both `"warping"`): **deform** lifts the cell's content
rect and keeps `toCellSpace` pointers, so its overlay applies `applyCompose` and its
`screenScale` includes `composeScaleOf`; **pose** paints its own overlay (`posePaint` composes
directly, and computes its own `hitPx`), so it needs no flag; **select/lasso** geometry and
paper-crop floats are document space and must NOT be composed (gotcha #13).

**Timeline iPad UX (2026-08-14):** three prod-test findings. (1) Sticky gutter: row
containing-blocks were only as wide as the visible scroller, so `position: sticky` unstuck after
~one viewport of horizontal scroll — `w-max` on ruler/audio/layer rows. (2) Playhead page-follow
during play (`playheadFollowScroll`, unit-tested): jump when it leaves the right edge so it sits
just after the gutter; snap back on loop wrap; do not yank if the user scrolled ahead. (3) Palm
on the timeline while drawing: the whole grid now uses the canvas rule — `touch` pans only,
`pen`/`mouse` edit. Layer _list_ stays finger-friendly. Spec:
`docs/superpowers/specs/2026-08-14-timeline-ipad-ux-design.md`.

**Timeline hold-span / move-block settle (2026-08-14):** hold-span resize opens a structural
bracket at grab and used to leave it dangling — ⌘Z mid-resize undid the _previous_ command, then
`rowUp` committed the pre-resize snapshot and re-did it. Registers `transformDragGuard.settle` at
grab (same hook undo/tool-switch already call). A dirty resize commits so the following undo pops
it; a no-op drops. An in-flight move-block has not written yet, so settle just cancels the ghost.

**Video-ref clip drag (2026-08-14):** a linked video reference draws as a draggable block on its
timeline row (`videoClipLayout` — inverted offset mapping so dragging the clip right advances
start later in the project). Missing media shows a **re-link BUTTON** that opens the file picker
directly (2026-08-15 — this reverses the original "no file picker on the row" non-goal below; it was
a maintenance argument, not a correctness one, and the label was a call to action pointing somewhere
else). It mirrors LayerList's picker rather than sharing a component — ~12 lines each, two call
sites. Plain `onclick`, never `onpointerdown` + `stopPropagation`, so the window-level status-hint
listener still reads its title on press; and `startRelink` bails when the gesture actually PANNED
(`panEndedWithMovement`, latched in `touchPanUp`), because a click still fires when a finger scroll
ends on the button — selecting a layer that way is harmless, opening a file picker is not.
Image / unknown-duration refs keep a type label only. The LayerList offset number is gone; speed
stays. Audio lane got a matching clip fill under the waveform. No filmstrip, trim, or model
change; drag is not undoable (same as the old number field). Every row shares
`timelineStripFrames` (doc length or the furthest clip tail) as `min-width` so sticky
gutters stay pinned when a clip hangs past the last frame — sticky is trapped in the
row's own box. A full-height sticky gutter plate (z-15) sits between the playhead
line (z-10) and the name labels (z-20) so the line cannot leak through empty space
below the last track. Spec:
`docs/superpowers/specs/2026-08-14-video-ref-clip-drag-design.md`. **Owed an iPad pass:** drag
incl. negative start and speed ≠ 1; speed changes width; missing says re-link; image has no
block; audio rectangle; finger pans; save/reload.

**Undo/redo grey out at the ends of the stack (2026-08-15):** the toolbar buttons always looked
live, so pressing Undo on a fresh project did nothing with no explanation. They now dim, and their
`title` says _why_ ("Undo — nothing to undo"), which per the 2026-08-12 rule means **`aria-disabled`
rather than `disabled`** — a disabled button dispatches no pointer events, so the status bar's
delegated hint could never read that title. Handlers are guarded to match; `undo()`/`redo()` keep
their own guards, so the keyboard path is unaffected.
**The reactive bridge is the part worth knowing.** `history` is a plain class, so `history.canUndo`
is a getter, NOT a `$state` dependency — a button bound straight to it would never re-render. Rather
than notify at every `history.push` site (they are spread across `Canvas.svelte` and the appState
actions), `History` gained one `onChange` hook fired after any change to either stack, and
`appState` wires it to mirror both flags into `state.canUndo`/`canRedo`. Same shape as `poseActive`
mirroring `meshPose`, and one writer instead of N. The hook deliberately does NOT fire when
`undo()`/`redo()` find their stack empty — nothing changed. It IS unit-tested (`history.test.ts`,
3 cases incl. push-clears-the-redo-stack), because the whole feature silently stops working if the
hook stops firing and nothing else would catch that.

**Reset to fit moved to the bar, and only when it does something (2026-08-15):** the gizmo's
on-canvas "Reset to fit" panel rendered whenever the gizmo was visible — offering an action that was
a no-op most of the time, on top of the artwork. Now it lives in **ToolOptions** beside the
Frame/Layer/Group scope toggle, completing the 2026-08-11 move that took the Transform tool's
on-canvas TEXT to the status bar; the gizmo now paints nothing but handles. Two things worth
knowing if this is touched again. (1) **The button is rendered OUTSIDE the per-tool branches on
purpose** — a reference layer's gizmo is live under EVERY tool, so gating it on
`tool === "transform"` would leave a nudged reference unresettable without switching tools. (2) The
logic stayed in the gizmo: `transformActions.reset` (registry, like `viewActions.fitView`) plus a
reactive `state.canResetTransform` mirrored from the gizmo's rAF tick — the same shape as
`poseActive` mirroring `meshPose`, and for the same reason: the scope dispatch it derives from is
gizmo-local, and a plain function isn't reactive. Duplicating that dispatch in `appState` would have
created exactly the derived-vs-raw divergence this codebase keeps getting bitten by. Assigning the
same boolean per frame is a no-op for `$state` dependents, so the tick write is free. This also
fixes a review finding: the old button used `onpointerdown`, so Enter/Space did nothing on the
gizmo's only tab-reachable control — it is a plain `onclick` now. **Owed:** eyeball that the button
appears only after a transform exists, that it works for a reference layer under a paint tool, and
an iPad tap.

**Independent review of the 35 Grok commits (2026-08-15):** five parallel reviewers, one per
subsystem (timeline / input+viewport / selection+transform chrome / persistence+undo / canvas+render
+audio), over `684c6ef..000aeec` — 2,900 insertions across 54 files that had had only a self-review.
**No Criticals; seven Important findings, all confirmed against the code and all fixed.** Two
recurring shapes, worth knowing because both will recur: **"applied everywhere except here"** (a
split or guard rolled out to most call sites) and **"an invariant that used to hold for free"**
(CSS or a framework used to maintain it; a refactor made it explicit and nobody noticed).

1. **`discardActiveEdits` ignored an in-progress stroke** while its sibling `bankActiveEdits`
   handled it ten lines above. It is `liftGuard.discard`, so it runs before resize / replaceProject
   / undo / redo — and on iPad the Pencil draws while fingers gesture independently, so
   draw-plus-two-finger-undo left the stroke painting into a canvas the undo had replaced. Now
   reverts from the captured `beforeSnapshot` (no history entry), cancels the queued `drawRaf`
   FIRST (a pending `paintStroke` would have repainted over the revert), and sets
   `dropStrokeUntilUp`.
2. **Moving a hold across a keyframe silently substituted content.** `moveBlockFrames` passed
   `materializeLeading: false` unconditionally — right for a mid-span drag, wrong across a key,
   because `writeColumn` writes a bare hold and `resolveKeyframeIndex` scans BACKWARD, so it
   resolved to whatever key preceded it at the DESTINATION. The marquee moved, the drawing did not,
   and the hold glyph looks identical either way. Now materializes only when the resolved key
   differs, compared **post-delete** (a pre-delete comparison over-materializes when the moved block
   itself contains a key). Unit-tested — this was the one node-testable finding of the seven.
3. **A lifted pose mesh never repainted on pan/zoom/resize.** Fallout from the overlay leaving the
   CSS-transformed wrapper: the view transform is now baked into the bitmap at paint time, so every
   viewport change needs an explicit repaint. Selection self-heals via its marching-ants rAF;
   `posePaint` is only called from pose interactions. `repaintPoseOverlay` (rAF-coalesced, since the
   touch path fires both viewport hooks per raw pointermove) now runs wherever the selection overlay
   is repainted.
4. **A cancelled finger mid-pinch wedged the gesture machine.** `onPointerCancel` never reset the
   new `pinchActive` and, unlike `onPointerUp`, never restarted pan for the surviving finger — that
   finger went dead, and lifting it later fired `snapRotation()` on stale frozen values. Same
   state-survives-a-cancelled-pointer family as gotcha #6.
5. **The deform action bar was anchored in cell space.** `getScreenBounds` returns raw
   `warpGrid`/`rect`, which for a `cellSpaceLift` is cell space, and `SelectionActions` mapped it
   through `canvasToScreen` alone. New `boundsToDoc` hook (the point-wise twin of
   `applyOverlayCompose`), gated on `cellSpaceLift` so a selection-originated warp is untouched.
6. **Pinch-zoom reallocated the display backing store every touchmove.** `displayOutputScale()` was
   CONTINUOUS on [1,2] despite a comment claiming discrete steps, and `touch-gestures.ts` has no
   rAF anywhere — so `recomposite()` → `sizeDisplay()` reallocated the canvas and re-composited every
   layer per raw pointer sample, through the most common zoom range. Now genuinely quantised
   (`[2, 1.5, 1]`), making the comment true: a pinch sweep costs at most two reallocations.
   `outputScale` only ever reaches a `setTransform` supersampling multiplier — nothing compares it
   against zoom or uses it for hit-testing — so quantising is hit-free.
7. **The `persistTick` split was ~90% applied**: three video-`seeked` callbacks still called
   `bump()` (`Toolbar` ×2, `LayerList`), and `reference.ts` registers that callback as a PERMANENT
   `seeked` listener, so paused scrubbing over a video ref re-armed the 3s autosave debounce every
   frame and re-encoded every key cell — the iPad rotoscoping path, and exactly the workload the
   split existed to remove.

Verified sound by the reviews, worth not re-litigating: the History byte accounting (traced through
push/undo/redo interleavings — it cannot drift, and eviction only shifts from the front so the
surviving stack is always a contiguous suffix), the rotate-snap pivot math, export staying decoupled
at 1× from display supersampling, and the palm-vs-Pencil routing (stricter than the canvas path —
every timeline drag surface wires `pointercancel`). **Owed a browser pass** for all seven fixes
(only #2 has a unit test): Pencil-draw + two-finger undo; drag a hold across a key; pan/pinch with a
pose lifted, and resize mid-pose; cancel one finger of a pinch (OS edge-swipe); the deform bar on a
transformed layer; pinch-zoom smoothness and the quality step at zoom 1.0/1.5/2.0; scrubbing a video
ref without an autosave storm. Two known minors: undo with an EMPTY history now discards an
in-flight stroke and undoes nothing; a stroke discarded on a hold leaves the materialized keyframe
behind (app-wide, pre-existing).

**Document-space selection (2026-08-15):** the select/lasso marquee is a region of the **paper**,
not the active layer. Switching layers keeps the ants put; viewport pan/zoom/rotate still apply
via `applyView`. Overlay must not `applyCompose` the ants. Pixel ops (clip/lift/copy/commit)
inverse-map through `selection.composeSteps` (`group ∘ layer ∘ cell`). A live lift still banks
on layer/frame switch (gotcha #9). Deform/Pose stay cell-local — and stay COMPOSED, via
`Selection.cellSpaceLift` (see the amended 2026-08-14 entry above; a whole-branch review caught
that the blanket `applyCompose = null` had knocked the deform overlay off its ink).
`composeSteps` has ONE writer, `Canvas.syncComposeSteps()`, which refuses to touch a live lift and
is called on version / playhead / dims / active-layer change and at gesture start — never every
frame (`cellComposeSteps` can trigger a full-resolution `contentBounds` scan on a cache miss).
The hand-written inverse lives in the pure, unit-tested `inverseComposeMatrix` (`selection-map.ts`),
asserted against `inverseChain` over a rotated 3-step chain. Spec/plan:
`docs/superpowers/{specs,plans}/2026-08-15-document-space-selection*.md`.

**Known cost of this design — a lift on a transformed layer is a LOSSY double resample.** The
crop is rasterized at DOCUMENT resolution through the compose (`cropComposedSelection`) and the
commit stamps it back through the inverse (`applyInverseCompose`), so a layer at scale 0.3 yields
a 0.3×-resolution crop blown up 1/0.3 into the cell — permanently. It is not gated on the user
doing anything: the first grab inside a marquee lifts immediately and a click-outside commits, so
a tap-and-release on a scaled-down layer destroys detail where the old cell-space path was a
lossless no-op. Identity layers are unaffected (the identity branch is a straight cell blit).
Accepted, not mitigated — a lossless path would have to keep the float in cell space, which is
exactly the coupling this feature removed.

**Verified 2026-08-15:** a selection made on one layer stays put across switches to layers carrying
different transforms — the feature's headline property, and the one the whole doc-space model exists
for. The rest of the list below was NOT walked and stays owed; in particular the Deform item is a
different code path (the review-caught regression), not covered by this check.

**Owed a browser pass:** Free transform lifts what you see and commits through inverse compose; identity-layer
lift/copy/commit unchanged; **Deform on a moved/scaled/rotated layer** (grid, handles and warped
bitmap sit on the ink, and a handle drag tracks the pointer 1:1 — the regression above);
**lift → commit without moving on a scaled-down layer** (how much detail the double resample
actually costs); a **2-point lasso flick** on a transformed layer (falls back to the rect, does
not clip everything away); **delete / cut of a ROTATED marquee** (the mapped AABB + clip path).

**Pose: fill outlines (2026-08-15):** closes the roadmap item above. The "web" was two failures, and
only the second was obvious: an outline-only drawing's alpha clears the inside-threshold only ON the
ink, so `triangulateSilhouette` finds no interior and keeps only a thin ribbon of triangles along the
strokes — but the worse part is that **geodesic weighting then travels ALONG that ribbon**: moving a
hand propagates down the arm outline, around the shoulder, and can drag the far side of the head,
because that is the shortest path through the mesh. "Far away" stopped meaning what the artist
expected. The fix (`src/core/fill-holes.ts`, `fillEnclosed`) **changes no pixels** — it reads the
lifted bitmap's alpha and returns a
`mask`/`inkArea`/`grownArea`/`insideArea`/`inkBBoxArea`/`enclosedArea`, and `MeshPose.fromLift`
(`src/core/mesh-pose.ts`) builds its `inside` predicate from that mask instead of raw alpha when
`fillHoles` is on; the artwork, the saved cell and the lift are untouched. The morphology
(`dilateMask`/`erodeMask`, moved to shared `src/core/mask-ops.ts` — the Fill tool's `expand` uses the
same functions) runs in a **load-bearing order**: dilate the ink → flood-fill the outside → erode the
solid filled result. The intuitive order — close the ink itself (dilate → erode) — was tried and
**measured to fail**: it cannot bridge a break in a 1px line at any radius, because the erosion eats
the join straight back out (the joint is never thicker than the structuring element); only eroding the
already-solid flood-filled mask survives. The bitmap is padded by `gap + 1` on every side before any
of this, because the pose lift is a TIGHT content bbox — ink routinely touches all four edges, and
without a guaranteed clear ring the border flood has nowhere to start and everything reads as inside.
Net effect: **`gap: r` bridges a break of roughly `2r` px** (the dilated discs on either side of the
gap have to meet). `gap` is **clamped to `0..MAX_GAP` (8) inside `fillEnclosed`**, not at the widget:
the input's `max="8"` is advisory (a browser takes a typed `50`), the morphology is O(pixels × r²) and
unseparated, and by the time it runs the pose lift has ALREADY cleared the cell's pixels and bumped
`persistTick` — so a minutes-long freeze there is a force-quit away from losing the artwork, and the
guarantee must not depend on the caller. **The failure report was redesigned on 2026-08-15 after
review; do not restore the original criterion.** It was `insideArea < grownArea * 1.1`, and that
compares quantities measured in different units — `grownArea` counts dilation bloat that the erode
then removes, so it exceeds even a SUCCESSFUL fill on a small shape: a **closed** ring at `gap: 2`
fills perfectly (121 px, identical to `gap: 0`) yet measured `121 < 188 × 1.1`, i.e. the very remedy
the message recommends reported itself as failing. It also fired on any art with **nothing** to fill
(a filled silhouette, a single stroke, an open "C" all measure `mask == ink`), where "raise Gap, or
fill the shape" is wrong and unactionable. The criterion is now `outlineFillFailed` (pure, in
`fill-holes.ts`, unit-tested), two conditions that must BOTH hold: (1) the ink is **sparse within its
own bounding box** — `inkArea < 0.4 * inkBBoxArea`, which is what separates an outline (~0.33) from a
body (~1.0), i.e. "failed to fill" from "nothing to fill"; and (2) the flood **enclosed nothing at
all** — `enclosedArea === 0`, where `enclosedArea` is `mask \ grown`, the area gained beyond ink AND
bridging. A leak drives it to a structural zero (the flood reaches the interior, so `filled == grown`
exactly), so unlike the old ratio there is no constant to tune and it cannot fire on a fill that
achieved anything. Deliberately conservative — a PARTIAL fill does not warn, because a false alarm is
the worse error here (it is sticky on iPad and displaces the pose bar's own guidance). `grownArea`
survives as a **diagnostic only**; it and the regression test that pins the old criterion's failure
(`"does NOT report a fill that SUCCEEDED because the gap was raised"`, which asserts
`insideArea < grownArea * 1.1` is true first) must be removed together or not at all — the test is
what stops the comparison being reintroduced. `state.pose = { fillHoles: true,
gap: 0 }` is **session-only, not persisted** — same convention as `onion`. The two pose-bar controls
and the density buttons now share one `rebuildPoseMesh()` (extracted from what was `poseDensity`'s
body) so every mesh-changing setting resets `poseDrag`/`activeHandle`/`poseAdjusting` the same way —
vertex indices change on any rebuild, so stale handle indices must be dropped every time, not just on
density changes. The message is carried by a dedicated **`appState.poseFillWarning`**, rendered in the
**pose bar beside the Gap control** that remedies it, and set OR cleared by `reportPoseFill()` on every
mesh build plus apply/cancel/teardown. It deliberately does NOT go through `statusHint`: that field
means "the hovered/pressed control's `title=`" and has a window-level `pointerdown` writer in
`App.svelte`, so the very press that builds the mesh overwrote the warning microseconds after
`enterPose` set it (each density button clobbered it with its own title too) — the spec's primary
scenario showed nothing at all. Clearing on every rebuild is equally load-bearing: iPad has no hover
to replace a stale message, and `StatusBar` renders `statusHint || idleHint`, so a stuck warning also
suppressed the pose context hint, including "leaving the tool bakes it" — the only commit path without
a keyboard. **Any new per-tool warning wants its own field for the same reason; `statusHint` is
title-only.** `fillEnclosed` and the mask ops are unit-tested (pure, node-testable); the
`fromLift` wiring and the bar controls are canvas/DOM and are build+review-verified only, per project
convention. **Owed a browser pass:** an outline-only drawing meshing as a body rather than a web; a
handle drag falling off through the shape instead of along the lines; a **donut** with the checkbox
OFF keeping its hole; a deliberately gapped outline producing the warning **in the pose bar** and
raising Gap until it fills CLEARING it (as do the checkbox, Apply and Cancel); a filled drawing warning
at NO gap setting; typing `50` into Gap snapping to 8 without a freeze; a filled drawing unchanged
throughout; and a very thin appendage (thinner than the gap radius) surviving — the reason Gap
defaults to 0. Spec/plan: `…/2026-08-15-pose-fill-outlines*.md`.

**Fill: paint every enclosed region (2026-08-15):** the Fill tool options (`src/lib/ToolOptions.svelte`,
fill branch ~:159-184) gained a **Gap** range control (same shape as Tolerance/Expand beside it,
`bind:value={appState.fill.gap}`, `max={MAX_GAP}` — a `<input type="range">` cannot exceed its own
`max`, so no clamp handler is needed the way a number input would) and a **Fill enclosed** button,
wired to `fillActions.allEnclosed?.()` (Task 3's `fillAllEnclosedOnCell` in `Canvas.svelte`, which owns
the keyframe materialisation, undo bracket, `isLayerEditable` guard and selection clip). This **PAINTS**
the current cell — real pixels, undoable, saved — where the Pose entry directly above only ever built a
read-only `inside` **mask** for its own triangulation; the two features share
`fillEnclosed`/`enclosedRegion` (`fill-holes.ts`) but do opposite things with the result. This is NOT
the auto-fill the user declined in June (`prefers-manual-over-auto-altering-art`): the tool finds
candidate regions on request, but nothing paints until the artist presses the button, and the result is
ordinary undoable pixels the artist can paint back over — not a standing "fill holes" mode. Its
fail-safe property is that a leaky outline can only ever paint NOTHING, never bleed color across the
canvas — but **that holds only because the region is gated on GENUINELY ENCLOSED space, and it did
not hold before that gate** (fixed 2026-08-15, same day): the border flood is fail-safe, but
`fillEnclosed`'s `mask` is `erode(dilate(ink))` — the morphological **CLOSING** — and a closing fills
a narrow channel between two OPEN strokes exactly as readily as a real pocket (two parallel 1px
strokes 3px apart, open at both ends, closed 37 px at `gap 2`). So at `gap >= 1` a leaky outline
painted a fringe hugging the inside of its own strokes and reported success — and the advertised
remedy for "Nothing enclosed" is to **raise Gap**, i.e. the advice made it worse. `enclosedRegion`
now returns empty unless something is genuinely enclosed, measured two ways because neither alone is
sufficient: `enclosedArea` (what the flood found BEYOND the dilation's reach) goes blind on a hole
narrower than `2×gap` — a **closed** 9×9 interior measures 0 from `gap 5` up — so `fillEnclosed` also
reports `rawEnclosedArea`, the same flood with no dilation at all (equal to `enclosedArea` at `gap 0`,
so the default path pays nothing). **Do not "simplify" the region back to `mask \ ink`, and do not
drop `rawEnclosedArea` as redundant** — the parallel-channel and closed-small-ring cases are pinned in
`fill-holes.test.ts`. Known conservative edge, deliberate: art that encloses nothing until a gap
bridges it AND whose every pocket is narrower than `2×gap` is suppressed — at that radius it only
"fills" as closing bloat anyway, and lowering Gap is the same remedy the message already asks for.
**`gap` and `expand` are deliberately separate
knobs, not one fudge factor**: `gap` acts BEFORE the flood, bridging small breaks in the ink so the
outline reads as closed (`fill-holes.ts`'s dilate → flood → erode order); `expand` acts AFTER, growing
the already-computed region so it tucks under the ink's anti-aliased fringe. Raising one is not a
substitute for the other — a clean, closed outline needs `expand` alone; a sketchy line with breaks
needs `gap` too. `fillRegionBehind` (`src/core/fill.ts`) always composites `destination-over`, unlike
`floodFill`, whose destination-over path is conditional on `expand > 0`: painting BEHIND the ink is
this feature's entire point, not a side effect of growing the mask, so there is no "expand 0" branch
that paints on top. `appState.fill` (now `{ tolerance, expand, gap }`) is persisted through the
existing `gatherPreferences`/`applyPreferences` spread-merge, so `gap` rides along in new saves for
free, and an OLD stored preference missing the key leaves `state.fill`'s own default (`gap: 0`)
untouched — checked directly in both functions, not assumed: object spread never writes an `undefined`
for an absent key. An empty result (`area === 0`) sets `appState.statusHint` and returns rather than
silently no-op'ing, because a no-op and a successful fill of an already-white interior are
pixel-identical — there is no other way for the artist to tell "nothing happened" from "it worked,
there was nothing to fill." **That early return is why the region is computed FIRST, from
`resolvedKeyCell` (read-only, same pixels), and `ensureDrawableKeyframe` runs only once `area > 0`**
— hence the `enclosedFillRegion` / `fillRegionBehind` split in `fill.ts` (one used to do both).
Materialising first left the no-op path mutating the model with no `bump()`: past a layer's end
`ensureDrawableKeyframe` APPENDS holds and a blank keyframe, so `refreshLength` never ran
(`project.frameCount` stale against a track that just grew) and autosave never saw the change; on a
hold it also stamped a ·→◆ keyframe for a press that painted nothing. **Any new "measure, then maybe
paint" action must keep that order.** The button is wired with **`onclick`, not `onpointerdown`**:
`App.svelte` binds a window-level `pointerdown` listener that overwrites `statusHint` from the
target's `title=` in the bubble phase, which runs AFTER a button's own `pointerdown` handler and would
wipe a "nothing enclosed" message microseconds after it was set — the exact trap the Pose bar's
`poseFillWarning` field (entry above) was carved out to dodge. A plain click fires after
`pointerdown`/`pointerup`, so this write is the last one and sticks. Build+review verified only, per
project convention (Vitest is node-only; this is Svelte markup with no node-testable surface).
**Owed a browser pass:** an outline drawing filling behind its strokes with no halo at `expand ≥ 1`;
the strokes themselves unmodified; undo restoring in one step; a gapped outline reporting rather than
silently doing nothing, then filling once Gap is raised; **an outline that is open at both ends (a
parallel-stroke channel) still reporting "nothing enclosed" at a HIGH Gap rather than painting a
fringe** — the fixed bug; a solid drawing reporting "nothing enclosed"; filling on a HOLD materialising
a keyframe, and a "nothing enclosed" press on a hold leaving the ·/◆ marker ALONE; a selection
clipping the fill; a locked or hidden layer
refusing; and the Pose tool then meshing that drawing as a body with **Fill outlines OFF** — the
end-to-end point of the feature. Spec/plan: `…/2026-08-15-fill-all-enclosed*.md`.

**Reference layer visibility ranges (2026-08-15):** reported as "the image ref layer is the only
one without a visible clip — should we add options, maybe make it trimmable?" Investigation
reframed the ask: **no reference layer had a notion of a frame range at all.**
`buildFrameDrawList` pushed a `ref` op for every frame unconditionally, so an image block would
have spanned the whole timeline always and conveyed nothing — and **the existing video clip block
already misrepresented behaviour**, looking like a trim range while `syncReferenceVideos`'s
`Math.max(0, Math.min(dur, wanted))` clamp held the video's first/last frame across every frame
outside it. Adding a block to the image row without adding the underlying concept would have
shipped a third misleading rectangle. New optional `ReferenceLayer.range?: { start, end }`
(inclusive project frames) plus pure `refVisibleSpan`/`isRefVisibleAtFrame` (`document.ts`,
unit-tested). **One span, not two:** a video's range **is** its footage span
(`videoClipLayout`-derived) — there is no separate place-in-project vs in-point-of-source model,
so `refVisibleSpan` ignores any stored `range` on a video layer rather than erroring (a range
written while the layer was an image survives a re-link to video harmlessly and comes back on a
re-link to image). Images store a range because a still has no footage to derive one from; a
not-yet-loaded video (`preload="metadata"`) resolves to "always" so it never blinks out before its
duration is known, and a missing-media ref resolves to "always" too (nothing to draw either way —
the row shows its re-link CTA instead). **Absent means "always visible, follows the project's
length"** — deliberately, so an untrimmed image renders identically before and after this feature
and so lengthening the animation later cannot silently strand an image ref at the project's old
last frame. Trimming either edge is what converts "always" into a concrete stored span. **One
gate:** `buildFrameDrawList` skips the `ref` op when `!isRefVisibleAtFrame(...)`, and it has
exactly one production consumer (`render.ts`) — so editor and export are both covered by that
single `continue`, with no second code path that could drift from it. (Onion-skin ghosts never
drew reference layers before this feature either — `onion.ts` composites ghosts with
`includeReference: false` — so this gate has no effect on onion one way or the other; there is no
onion behaviour here to verify.)
`syncReferenceVideos` now skips-and-pauses a video outside its span instead of clamping into it,
which is also why the old clamp was lying. Image ref rows render a clip block (reusing the
`media-clip` timeline tokens): **dashed + default cursor while untrimmed** (it spans everything by
definition, so its edges aren't real positions and its body has nothing to slide), **solid +
grab-cursor once trimmed**, with edge handles that trim and a body that slides. Trim/slide push one
undo entry per completed gesture via the same `beginStructuralEdit`/`commitStructuralEdit` +
`transformDragGuard.settle` bracket the hold-span resize uses — **deliberately diverging from the
video and audio clip drags, which stay non-undoable** (inherited from the numeric fields they
replaced): those move where a reference _sits_, this changes **what renders**, and a mis-drag that
silently blanks frames is exactly the loss undo exists for. `cloneLayers` deep-copies `range` the
same way it already deep-copies `transform` (gotcha #8 — snapshots share refs, so the drag replaces
`layer.range` wholesale rather than writing `.start`/`.end` in place), and `restoreStructure` copies
`range` as a structural field alongside `transform`, not left as a view-prop.

Two decisions made mid-implementation, worth recording since neither is obvious from the spec: (1)
a zero-delta **tap** on an untrimmed block's edge handle used to materialise a concrete range while
correctly pushing no undo entry — an unrecoverable mutation with no undo to recover it. Fixed with
a `wasAbsent` flag captured at grab, reverting `range` back to `undefined` on the
unchanged-and-was-absent path. (2) the untrimmed block deliberately renders `0..frameCount-1`, NOT
the full width of the shared `stripFrames` (which can be wider when a neighbouring row's video clip
hangs past the project end) — so the display always matches exactly what an edge drag would
materialise, and the two can never drift apart.

**Migration — the one behaviour change to existing projects, and it is silent:** a video reference
shorter than the animation used to hold its final frame across the remaining frames; it now renders
those frames empty. The project opens fine and simply renders differently past the clip end — there
is no dialog, no warning, nothing in the file format changes (format version stays 1, `range` is
optional and absent on every old save). Documented in README.md and here on purpose, since nothing
in the app itself surfaces it.

Pure logic (`refVisibleSpan`, `isRefVisibleAtFrame`, the trim-clamp helper) is unit-tested; the
timeline block/handles/drag lifecycle are Svelte/DOM with no node harness — build+review verified
only, per project convention.

**Fix wave from the final whole-branch review (2026-08-15, same day, no Critical/Important
findings):** four Minor issues, all fixed except one left as documented-but-unchanged. `rangeDown`
used `stopPropagation()` to stop an edge handle's press from also starting a body slide, which had
the side effect of suppressing `App.svelte`'s status-hint listener for every Pencil/mouse press on
the block or a handle — replaced with `if (rangeDrag) return` as the first line of `rangeDown`,
relying on Svelte 5 delegating a child element's handler before its parent's (confirmed against the
markup, not assumed: the edge-handle `<div>`s are DOM descendants of the body `<div>`, all wired via
`onpointerdown`, so the handle's own `rangeDown` call sets `rangeDrag` before the bubbled call on the
body sees it). A zero-delta press on an untrimmed edge handle wrote then reverted the implicit
range, costing two `bump()`s and scheduling a full autosave re-encode for a tap that changed nothing
— `rangeMove` now early-returns on `delta === 0`, matching `clipMove`'s existing guard; the
`wasAbsent` revert in `settleRangeDrag` is unchanged and still covers drag-out-and-back.
`rangeMove`/`rangeUp` still fire twice per event during a handle drag (pointer-capture retarget plus
bubble) — left as-is, since every write derives from the frozen `rangeDrag.from` and is therefore
idempotent, but now commented in place warning against switching to incremental deltas (that would
silently double-apply). A fourth issue found in the same pass: `refVisibleSpan` returns a trimmed
image's `range` **by reference**, so `rangeDrag.from` aliased the live `layer.range` object at grab
— safe only as long as every writer replaces the whole object; `rangeDown` now copies it
(`span ? { ...span } : …`) so an in-place write anywhere else could never make the grab-time
baseline track the live value.

**Rasterize reproduces the range (fixed 2026-08-15, was gap 1 of four).** `rasterizeReference` wrote
one key at frame 0 and left every other cell a hold, so `resolveKeyframeIndex` resolved every later
frame back to it: an image ref trimmed to 0–10 in a 48-frame project reappeared on frames 11–47,
where it had been trimmed away. The keyframes now reproduce the ref's VISIBILITY, using structure the
app already has rather than a new concept — pure `rasterizeKeyframePlan` (`document.ts`, unit-tested,
8 cases) returns where the image key goes and where a BLANK key ends the run. Frames before the range
need nothing at all: a leading hold with no key at or before it already resolves to null and draws
nothing, which is the same mechanism that blanks a drawing layer before its first keyframe. The blank
key at `end + 1` is the existing ◇ glyph, so the timeline reads correctly too. An untrimmed ref still
gets a lone key at frame 0 (unchanged). Edge cases pinned by tests: a range reaching or passing the
last frame writes no blank key; a range starting past the project yields an all-holds layer (correct
— it was visible on no existing frame); a negative start clamps rather than writing out of bounds.

**A ref is unmovable outside its span (fixed 2026-08-15, was gap 2 of four).** The gizmo used to
stay live on frames where the ref draws nothing — trim to 0–10, scrub to 30, and the handles
rendered over blank canvas, where a drag undoably committed a move to something invisible. Both
guards now also require `isRefVisibleAtFrame`: `activeTransformLayer` (`RefTransformGizmo.svelte`)
hides the handles, and `refPinned` (`Canvas.svelte`) refuses the drag. **Both were required.** Fixing
only the gizmo would have been worse than the bug: the ref gizmo is live under EVERY tool, so
`refPinned` is the guard that stops a stray canvas drag nudging a reference — hiding the handles
alone would have left an invisible layer draggable with nothing on screen to explain it. That is the
same two-site pattern lock enforcement uses, and the comment at each site says they must agree.
Cost, accepted: repositioning a trimmed ref now means scrubbing inside its span first. Untrimmed refs
are unaffected — `isRefVisibleAtFrame` is true everywhere when there is no range.

**Ripple insert/delete (2026-08-15, closes gap 3 — but the reported premise was wrong).** The review
said "frame insert/delete does not shift ranges". Checking first showed there was **no document-wide
frame op at all**: every frame tool acts on the ACTIVE LAYER only (`Timeline.svelte`'s
`frameTool`/`keyTool`/`dupTool`/`deleteTool`), and `insertFrameAllLayers`/`deleteFrameAllLayers` had
existed in `timeline.ts` with **zero production callers** — tests only. So "shift the range by the
inserted count" was unimplementable as stated: when layer A gains a frame and layer B does not, a
document-space range has no single correct shift, and moving it would sync the ref to A while
desyncing it from B. **The real gap was the missing operation**, so that is what was built. Those two
functions are now wired to a pair of timeline-bar buttons and extended to ripple everything living in
document-frame space: image ref ranges, video clip offsets, and the audio track. Per-layer tools are
untouched.
The shift math is pure and unit-tested (`shiftSpan`, `shiftStartFrame`). **The straddle rule is the
part worth knowing:** a span containing the inserted frame GROWS rather than moving — insert a
breakdown mid-action and the reference should cover it, not slide off it — while a span entirely
after the frame moves and one entirely before is untouched. Delete mirrors it, flooring a span at one
frame rather than inverting it. Audio and video have no `end` to grow, so a clip STRADDLING the
frame is left alone: a video's length is its footage and cannot absorb a frame, so it will drift if
you insert mid-clip. That is honest rather than fixable.
**`StructSnapshot` gained `audioOffsetFrames`, and that widening is load-bearing.** Audio is
otherwise deliberately outside undo (set/remove-track, mute and the waveform drag are all
non-undoable, matching opacity), but this is the first operation that moves audio _programmatically_
— without the field, undoing a ripple would restore every layer and range and leave the audio
shifted, which is worse than never shifting it. `restoreStructure` applies it only when the track
still exists AND the snapshot had one. (Set/remove-track and mute later became undoable too, so the
snapshot now carries the track and both its flags — see the audio-undo entries below.) The ripple ops are **not** gated on the active layer being
editable, unlike the per-layer tools: this is a document op, and skipping locked rows would destroy
the very alignment it exists to preserve (same treatment a document resize gives them).

**`replaceProject` settles in-flight drags (2026-08-15, closes gap 4).** It called
`liftGuard.discard?.()` but never `transformDragGuard.settle?.()`, so a drag surviving an Open/New
would, on release, push `restoreStructure(before)` — a snapshot of the OUTGOING document — into the
incoming one's history. Pre-existing and practically unreachable (Open requires releasing the
pointer first); the range drag had just become its second client. **The placement is the whole
fix and must not be "tidied":** the settle sits above `history.clear()`, because settling COMMITS,
and the clear immediately after is what makes that commit harmless. Moved below the clear, it would
create precisely the stale entry it exists to prevent. Note both guards are declared _below_
`replaceProject` in the file and read only at call time — an established pattern here, not an
oversight.

**All four review gaps from this feature are now closed.** The only thing deliberately left alone is
that the PER-LAYER frame tools do not shift reference ranges — which is correct, not a gap: a
per-layer op has no single right answer for a document-space span (see the ripple entry above).
Recorded so the question is not re-opened from scratch.

**Owed a browser pass:** an image ref shows a dashed block spanning `0..frameCount-1` while
untrimmed; trimming an edge converts it to a solid block and the image disappears outside the span
while scrubbing; slide and both edge trims; trim → undo → redo; ⌘Z mid-drag; a range dragged past the
last frame (gutters stay pinned); a short video going blank past its footage instead of holding; a
not-yet-loaded video not blinking out on first paint; export honouring the range; save → reload
preserving a trimmed range; an old project opening unchanged; iPad for the handles (`touch-action`,
`pointercancel`, finger-pan vs pen-edit, and that a handle press no longer suppresses the status
hint). Spec/plan: `…/2026-08-15-reference-layer-ranges*.md`.

**Audio offset is undoable (2026-08-15) — and the reason is an invariant worth keeping.** The ripple
work put `audioOffsetFrames` into `StructSnapshot` so a ripple insert/delete could move audio
undoably. That silently broke the lane drag: `restoreStructure` writes the offset on EVERY structural
undo, so a drag (which pushed no command) followed by any unrelated structural edit followed by undo
snapped the audio back to its pre-drag position. **Once a field is in the undo snapshot, every writer
of that field must push a command** — otherwise unrelated undos revert the writes that don't. So the
lane drag now brackets with `beginStructuralEdit`/`commitStructuralEdit`, commits only if the offset
actually moved (a click without a drag pushes nothing, or the next undo looks dead), and registers
`transformDragGuard.settle` so a mid-drag undo or Open cannot leave the bracket open — the same shape
as the reference range drag and the hold-span resize. (Mute and set/remove-track were still outside
the snapshot at this point; both were brought in shortly after — see below.)
Also fixed alongside it: `undo`/`redo` now call `resyncAudioAfterHistory()`, because a structural
restore can move the offset while playback has ALREADY scheduled its buffer — without it the number
changed but the sound kept playing at the old position until the next seek. Reachable from both
writers, so it belongs in the history path rather than at either call site.
**Owed a browser pass:** drag the clip → undo → it returns; drag → make an unrelated edit → undo once
(the edit reverts, the drag survives); a click on the waveform with no movement pushes nothing; undo
an offset change mid-playback and hear it reposition; ⌘Z during a held lane drag.

**Import and remove audio track are undoable (2026-08-15).** `StructSnapshot` gained
`audio: AudioTrack | null`, held **by REFERENCE, never copied** — a copy would clone the decoded PCM
into every snapshot, while a reference costs one pointer, exactly as `layers` already references
canvases. Keeping the track alive after a remove is the whole point: undo hands the same decoded
buffer back, with no re-decode and nothing stashed elsewhere. The earlier concern that "the track
holds decoded PCM, so this is a larger call" was wrong for that reason — copying was never required.
Both writers push a command, per the invariant in the entry above: adding it to the snapshot without
making `setAudioTrack` undoable would have made an unrelated undo silently revert an import.
**Why the snapshot keeps BOTH `audio` and `audioOffsetFrames`, which looks redundant:** the lane drag
writes `audio.offsetFrames` IN PLACE on the shared object, so `snap.audio.offsetFrames` tracks the
live value and cannot serve as a before-state (gotcha #8). The separate number is the immutable
capture that actually restores. `muted` is captured separately for exactly the same reason (added
with the mute entry below). Do not "simplify" any of the three away into `snap.audio`.
`restoreStructure` re-points the engine **only when the track identity changed**: `setTrack()` stops
playback, so calling it on every undo would kill playback on unrelated edits. It hands over the
$state proxy read back after assignment, never the snapshot's raw object (gotcha #11).
Memory note: a removed track stays alive as long as a snapshot referencing it is in history (capped
at 50 commands), and `replaceProject`'s `history.clear()` releases it on Open/New.
**Owed a browser pass:** remove the track → undo → it returns, plays, and keeps its offset; import →
undo → gone; remove → redo; remove mid-playback → undo; import, then an unrelated edit, then one undo
(the edit reverts, the import survives); mute → unrelated undo (mute must NOT revert).

**Mute is undoable (2026-08-15) — audio is now fully under undo.** The last non-undoable audio edit.
`StructSnapshot` gained `audioMuted`, captured as a separate boolean for the same reason the offset
is: the toggle writes `muted` IN PLACE on the shared track object, so `snap.audio.muted` tracks the
live value and cannot be a before-state (gotcha #8). `toggleAudioMute` now pushes a command like
every other writer of a captured field.
**The restore had to mirror the toggle's ENGINE behaviour, not just the flag** — mute gates the
output, so restoring the boolean alone would flip the icon while the sound carried on. On a mute it
calls `audioEngine.stop()`; on an un-mute during playback it calls `play()`. `resyncAudioAfterHistory`
cannot cover this: `syncTo` is `if (this.source) this.play(...)`, so it only repositions an EXISTING
source and can never restart one the mute stopped.
Together with the offset, import and remove-track entries above, this closes the audio/undo work:
**every audio edit now pushes exactly one command per gesture**, and the invariant that started it
("once a field is in the undo snapshot, every writer of it must push a command") is now satisfied
across the whole track rather than field by field. Any future audio field must arrive with its writer
already bracketed.
**Owed a browser pass:** mute → undo → it unmutes AND becomes audible again mid-playback; unmute →
undo → it goes silent immediately; mute, then an unrelated edit, then one undo (the edit reverts, the
mute stays); mute → remove track → undo → undo (the track returns still muted).

**Reference layers say they are guides (2026-08-16).** Reported as "nothing tells you image/video
layers are references and not rendered". Confirmed: both exporters hardcode `includeReference: false`
(`png-sequence.ts`, `video.ts`), so a reference is visible at 60% opacity while you work and silently
absent from every output, and nothing anywhere said so.
**Chosen: tell, don't render** — over a per-layer "include in export" flag and over extending
Rasterize to video. Rendering references would contradict what the name and the 60% default opacity
already promise, and a per-layer export flag pushes this app toward being a compositor, which
CLAUDE.md's own scope note puts in slop-video-compositor instead. The app ALREADY has the "I want
this in the output" answer for images: `rasterizeReference` converts a ref into a real drawing layer.
So the gap was purely discoverability, and it is closed in two places: the **Export dialog** shows a
line whenever the project has references (counted regardless of visibility — a hidden ref is equally
absent, and the point is "these are guides"), naming “Rasterize to drawing layer” exactly as its
tooltip reads so it is findable; and the **type glyph** in both the layer panel and the timeline
gutter carries it in its `title`, which costs no layout and reads out in the status bar on an iPad
tap, where tooltips never fire.
**Known and deliberately left:** a VIDEO reference cannot reach the export by any route —
`rasterizeReference` is image-only. Baking a video would mean decoding N frames into N full-size cell
canvases (~8.3 MB each at 1920×1080), which is exactly the memory the 1× document-scale work went to
some length to avoid. If it is ever wanted, that memory profile is the thing to weigh first.

**The layer panel is drag-resizable (2026-08-16).** Mirrors the timeline's height grip rather than
inventing anything: pure `clampPanelWidth` (`src/anim/panel-layout.ts`, unit-tested) clamps to
[`MIN_PANEL_WIDTH` 180, 50% of the viewport] with MIN always winning, `state.layerPanelWidth` rides
the existing `gatherPreferences`/`applyPreferences` pair exactly as `timelineHeight` does, and a
window-resize handler re-clamps so a shrunk window cannot strand the panel wider than the screen.
`DEFAULT_PANEL_WIDTH` is **224 — Tailwind `w-56`, the width it had when fixed** — so first run and
every existing preferences blob look identical; the test pins that number for the same reason.
**The grip is on the LEFT edge because the panel is docked right**, so dragging left WIDENS —
`gripStartW + (gripStartX - e.clientX)`, the same inversion the timeline uses for drag-up-to-grow.
It carries the same `touch-action: none` + pointer-capture + `pointercancel` trio every drag surface
here needs. **It RESERVES a 12px strip rather than overlaying the rows** (corrected 2026-08-16 from a
screenshot): overlaying put it directly on top of each row's `layer-drag-handle`, so the two
grab targets sat on the same pixels. The strip comes from `pl-2` on the panel's TWO direct children,
not on the root — padding the root would inset the header's bottom border and leave it short of the
left edge. It was briefly 12px, trimmed to **8px** once the grip lost its visual bar: with no mark to
sit in, the strip only has to stop the grip colliding with the drag handles. `MIN_PANEL_WIDTH` is
180 of usable content PLUS that strip = **188**, since the floor is a guarantee about CONTENT width
and the reserve has to be added on top of it. `DEFAULT_PANEL_WIDTH` stays 224 so the
panel's overall width is unchanged; that costs stored preferences 12px of content, which the row's
`flex-wrap` absorbs and the drag itself remedies.
This is only safe because the layer detail row is already `flex-wrap` (the 2026-08-11 de-crowding
work): a narrower panel wraps to more lines rather than clipping, and a wider one un-wraps. Any
future per-layer control must keep that property or the minimum width becomes a real constraint.
Not done, and previously deferred for its own reasons: the **timeline gutter** width, which would
need `LABEL_W` to become reactive state threaded through four consumers plus persistence.
**Owed a browser pass:** drag wider/narrower and watch the detail row wrap and un-wrap; the canvas
re-fits as the panel changes; reload keeps the width; shrink the window past 2× the panel width and
see it re-clamp; iPad drag (touch-action).

**The timeline gutter's name column is drag-resizable (2026-08-16) — the deferral is closed.** It was
put off once because "`LABEL_W` would have to become reactive state threaded through four consumers
plus prefs persistence". That is exactly what happened, and it was the whole job: `LABEL_W` and
`GUTTER_W` went from module consts to `$derived`, after which every consumer — the ruler spacer, both
playhead offsets, the full-height sticky plate, `stripMinW`, `AudioLane`'s `labelW` prop and
`TimelineSelectionBar`'s `labelW` — follows for free, because they already read those two names
rather than hardcoding 120. **That is why the earlier gutter-geometry work mattered:** collapsing the
three ad-hoc offsets into `LABEL_W`/`MARKER_W`/`GUTTER_W` is what made this a two-line change instead
of a hunt. Anything new in the gutter must keep reading them.
`MARKER_W` stays FIXED at 22 — it holds one 11px glyph and has nothing to gain from resizing; only
the name column moves. `clampGutterLabelWidth` (pure, unit-tested) clamps to [80, **40%** of the
viewport], tighter than the layer panel's 50% because this column eats horizontally into the frame
strip, which is the timeline's actual content. `DEFAULT_GUTTER_LABEL_WIDTH` is 120, the old constant,
so nothing moves on first run; persisted as `timelineLabelWidth` through the existing prefs pair.
**The grip's z-index is the non-obvious part:** it is `z-25`, above the PER-ROW sticky labels at
z-20. At z-15 (beside the plate) or lower, whichever row you pressed would swallow the gesture with
its own label. It straddles the divider (`left: GUTTER_W - 3`, 6px wide), is sticky so it rides that
edge through horizontal scroll, and is pulled out of flow with the same negative margin the plate
uses so it adds no height. Dragging RIGHT widens — not inverted, unlike the layer panel's grip, whose
panel is docked on the other side.
**Two follow-ups from a screenshot (2026-08-16).** (1) The divider stopped level with the last row:
the per-row `border-r` only covers its own row, and the full-height plate that hides the playhead
below the last track had no border of its own — it now carries `border-r border-text-muted`, so the
line runs the full height and the two coincide at the same x. (2) The grip was invisible, briefly grew a
bar at the top, and then LOST it again the same day along with the layer panel's — see the next
paragraph.
**Owed a browser pass:** drag the divider and watch names, marker column, ruler, playhead, clips and
the selection bar all stay aligned; scroll horizontally while narrow (the grip and gutter stay
pinned); reload keeps the width; a very narrow name column still truncates cleanly; iPad drag.

**The two VERTICAL resize grips are bare edges (2026-08-16).** The layer panel's grip drew a short vertical bar
centred in its full-height strip, which floated at whatever the panel's mid-height happened to be and
read as an object rather than an edge; the gutter's drew one at the top. Both marks are gone. The
affordance is now the divider line that was already there, plus `hover:bg-text/10` on the hit strip,
so the edge tints under the pointer instead of carrying permanent chrome. Rationale: dragging a panel
edge is a learned convention that needs no badge, and two resize edges in one app must look alike —
a bare edge on one and a mark on the other was the actual inconsistency.
The timeline's height grip briefly lost its bar too, then had it restored — see the paragraph above
for why that one is the exception. Worth keeping from that detour: its hit area was ALREADY the same
8px as the other two (`h-2` vs `w-2`), so the "wider grab area" it appeared to have was purely the
bar. Measure before resizing a hit area; the difference was chrome.
**All three are 8px** (briefly 12px on 2026-08-16, reverted the same day — thicker read as heavy).
The LAYER PANEL's grip abuts the drag-handle icon exactly: 4px reserved (`pl-1` on the list, the
header's own `p-1`) plus each row's 4px `p-1` puts the icon at 8px, where the grip ends — abutting,
with nothing wasted between. Note the reservation lives on the panel's TWO direct children, never on
its root, or the header's bottom border gets inset and stops short of the left edge.
The GUTTER's grip is deliberately ASYMMETRIC — `left: GUTTER_W - 6` with width 8, so 6 of its 8px
fall inside the gutter and only 2 reach the first frame cell, which is interactive and only 24px
wide. Do not "centre" it.
**Both vertical grips use the same split: 8px HIT area, 4px visible TINT.** For the panel the tint
covers exactly the 4px it reserves; for the gutter it is offset 2px so it lands just inside the
divider and never over a frame cell (the grip itself is biased 6-in/2-out for the same reason).
The panel's rule, which the gutter now follows:
tinting the full 8px painted over the rows' own background (the grip overlays their left 4px), which
read as a mismatched notch against the active/hover row colour. Hit area and tint are separate
concerns on any overlay grip — size them separately.
**`MARKER_W` is 28**, widened from 22 so the lock/hidden glyph is not crowded against the divider.

**The TIMELINE's height grip keeps a visual bar and takes NO background tint; the two vertical ones
are the reverse.** The tint is area-sensitive: this grip spans the full width, so the same
`bg-text/10` that is a subtle 8px sliver on a vertical edge became a loud full-width band. The bar
brightening on hover is all the feedback it needs, and the vertical grips have no bar, so the tint
is all THEY have. Do not unify them.
Why it keeps the bar at all: Not an oversight —
they sit on a panel EDGE, where drag-to-resize is a learned convention that needs no badge, while the
height grip is an INTERIOR divider between the canvas and the timeline, so nothing about its position
suggests it can be dragged at all. Edge → bare; interior → hinted.
**Known trade, accepted:** hover does not exist on iPad, so there is no visual affordance there at
all; the edges are discoverable only by trying them. Both still carry `title=`, which the status bar
surfaces on tap, so the hint route survives even though the tint does not.
