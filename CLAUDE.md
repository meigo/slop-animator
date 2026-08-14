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
- `npm test` — Vitest (node env, no DOM). Baseline **400 passing**. Canvas/DOM code isn't
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
- Commit message trailer used here: `Co-Authored-By: Claude ...`.
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
stops/rejoins the engine; `play()` also refuses muted as defense. Offset/mute are NOT undoable
(audio is outside `StructSnapshot`, like set/remove-track). **Owed a browser pass:** scrub audible
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
