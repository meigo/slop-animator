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
- `npm test` — Vitest (node env, no DOM). Baseline **345 passing**. Canvas/DOM code isn't
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

**Layer lock toggle (2026-08-09):** the `locked` flag was fully enforced (draw/fill/lift/transform/
timeline all refuse locked layers; lock-mid-lift discards via the 2026-06-29 review work) but had NO
UI writer — `duplicateLayer` was the only code that ever set it. Added the missing Lock/LockOpen
button on draw-layer rows in `LayerList`, beside the eye (same in-place-mutate + `bump()` pattern as
visibility/audio/embed; not undoable, matching visibility). 15-line diff, no new enforcement.
**Owed:** an iPad tap check + confirming a locked layer visibly refuses strokes.
