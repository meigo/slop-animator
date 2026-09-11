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
- `npm test` — Vitest (node env, no DOM). Baseline **1286 passing**. Canvas/DOM code isn't
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

## Roadmap / deferred (wanted-later, not abandoned)

- **Flip in the Transform tool** (deferred 2026-09-11): Flip H / V for the Frame / Layer / Group scopes and reference layers — a whole layer or group across all frames. Selection flip shipped first (floating selection bar). This one needs a mirror in `RefTransform` (read by render, gizmo math, persistence and transform tracks, ~70 sites) and a decision on keyed vs static flip for animated transforms.
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
