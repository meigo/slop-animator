# slop-animator — change history

This is the append-only feature/fix log for slop-animator, split out of `CLAUDE.md` on 2026-09-03
purely to keep `CLAUDE.md` (which loads into every session's context automatically) small. Nothing
was rewritten or trimmed in the move — every entry below is verbatim from `CLAUDE.md`.

**Read this file when:** you're touching a subsystem and want the full history/rationale behind it,
or CLAUDE.md's gotchas/roadmap point you here for detail. It is not auto-loaded — open it explicitly.

Same conventions as `CLAUDE.md` (see its "How to read this file" section): append-only, later entries
supersede earlier ones, mark a superseded entry with a `> **SUPERSEDED …**` blockquote rather than
deleting it, and when the code and this file disagree, check `git log` before assuming the file is
right.

---

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
harness — project convention). Known gap at the time, **CLOSED 2026-08-14**: `input.ts` had no
`pointercancel` listener, so an OS-cancelled captured stream (iPad palm rejection) on the Canvas
on-canvas drag path leaked `refDragUndo`/`refDragFreeze` until the next gesture overwrote it. It
binds one now (`input.ts:201`, same handler as up/leave); the gizmo's handle-drag path always bound
`pointercancel` itself and was unaffected. **Owed a browser pass:** move → undo → back; scale/rotate →
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
wins. Precedence AS SHIPPED: locked layer > tool-blocked-by-layer-transform > tool/state hint — a
hint for a gesture that currently does nothing is worse than none, and both of those states fail
_silently_ today. **The ORDER has since grown and the layer-transform gate is gone** (removed
2026-08-14 with `toCellSpace`, when a transformed layer became editable in place): `contextHint` now
reads audio row > group row (its own `TransformRefusal` reasons) > locked > hidden > not-draw >
tool/state hint. The principle is what survives, not the list — read `src/lib/status-hint.ts`. Content rule: no keyboard-shortcut lists, nothing restating a visible button. The
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
explicit "don't touch", so bulk ops keep honoring lock only.

> **SUPERSEDED for the block-ops half — see the 2026-08-11 high-effort review fixes entry below.**
> Block ops now skip on `isLayerEditable` (draw + unlocked + VISIBLE), so a hidden row is inert too,
> matching the row gestures and the selection bar. The group-transform non-change above still holds.
> Do not restore lock-only from this paragraph; it is the older of the two.

**Owed a browser pass:** marquee visible
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
a hand-partitioned third row: the panel was a fixed `w-56` (224px) at the time and this row keeps
gaining controls (two were added on 2026-08-09 alone), so a fixed partition would need re-cutting
each time while wrap can never clip. **The panel is DRAG-RESIZABLE since 2026-08-16**
(`panel-layout.ts`, `state.layerPanelWidth`, default still 224) — which only strengthens the rule:
wrap is what makes the resize safe, so any new per-layer control must keep that property. Sliders slimmed to `w-12` / readouts `w-5` so a DRAW layer still fits one line and
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
constants in `Timeline.svelte`: `LABEL_W` (120 then, name), `MARKER_W` (22 then / **28 now**,
read-only/hidden marker —
**always rendered, blank when editable**, which both aligns the rows and gives the frame cells a gap
after the name), and `GUTTER_W = LABEL_W + MARKER_W`, which is what the ruler spacer, both playhead
offsets and `TimelineSelectionBar`'s `labelW` now use. `AudioLane` takes `labelW` + `markerW` and
puts its ✕ in the marker column, so it lines up with the layer rows' lock/hidden icons. Anything new
in the gutter must pick a column rather than inventing its own offset. The gutter stays FIXED-width
(a drag-resizable one was considered and deferred: `LABEL_W` would have to become reactive state
threaded through four consumers plus prefs persistence).

> **SUPERSEDED 2026-08-16 — see "The timeline gutter's name column is drag-resizable" below.**
> `LABEL_W`/`GUTTER_W` ARE reactive `$derived` state now, persisted as `timelineLabelWidth`, and the
> deferral above is exactly what got done. `MARKER_W` is 28 and stays fixed. The three-column
> geometry rule is what survives here — and it is why the resize was a two-line change.

**Owed:** horizontal-scroll check that all
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
condition. The list is deliberately brush/eraser/fill/deform/pose — the **eyedropper samples the
composite** and **select/lasso can still COPY** from a locked layer, so flagging those would be a
worse lie than showing nothing. (The identifier is `PIXEL_TOOLS` in `Canvas.svelte`, not
`WRITING_TOOLS`, and **`transform` was deliberately SPLIT OUT of it**: transform is blocked on a
non-editable DRAWING layer and on the audio row, but a REFERENCE layer's gizmo is live under every
tool, so folding transform back into the flat list showed a not-allowed cursor and a "switch to a
drawing layer" caption over something you can actually move. Don't re-merge them.) Pan (space/middle-drag) keeps its grab
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
at 32), and `public/favicon.svg` is what the browser tab gets. (**Superseded 2026-08-24** — the
favicon was the star glyph alone; it is now the shared slop mark, and is theme-following rather than
a white plate. See the note at the end of this entry.)
Declaring BOTH `rel="icon"` forms (SVG + a 32px PNG) means no browser ever falls back to requesting
`/favicon.ico`, so no `.ico` is needed. White plate, black ink (`#fff`/`#000`) — chosen over the old
dark-plate icons because a white square reads on any tab bar; note `manifest.webmanifest` still
declares a dark `background_color`/`theme_color`, which is right for the app's dark UI but does mean
the PWA splash is dark behind a white icon. `tools/make-icons.mjs` was rewritten to RASTERIZE those
SVGs rather than draw its own mark: it stays dependency-free (the project installs no SVG
rasterizer), parsing the path, flattening cubics, and scanline-filling with the **even-odd** rule at
4× supersampling — even-odd matters, it is what keeps the counters of "o" and "p" hollow. Only `M`, `L`,
`c`, `C` and `z` are supported, and an unknown command THROWS rather than silently dropping part of the
mark; widen it if the art ever needs more. The fit is computed from the flattened path's own ink
bounds, so new artwork centres itself with no hand-tuned numbers (an earlier hand-guessed bounding
box put the star wildly off-canvas — let the code measure it). Regenerate with
`node tools/make-icons.mjs`; outputs are committed and not wired into the build.
**Verified 2026-08-14:** the star shows in the browser tab. The installed Home Screen icon is NOT
confirmed — iOS snapshots it at install time, so seeing the new logotype there needs a
remove-and-re-add of the Home Screen app, not just a reload.

**The tab icon is the shared slop mark, not the star (2026-08-24).** `public/favicon.svg` is now a
verbatim copy of `slop-spine`'s, so the family of slop-\* apps carries one mark; keep it verbatim, or
a later diff between the two projects stops being meaningful. Three consequences worth knowing.
(1) **It is theme-following** — transparent ground, `.icon { fill: #111 }` with a
`prefers-color-scheme: dark` override to `#fff` — where the star was a white plate with black ink.
That supersedes the "white plate reads on any tab bar" reasoning above rather than contradicting it:
the plate existed to beat the OLD dark-plate icons, and a mark that follows the tab bar beats both.
(2) **The PNG fallback cannot follow a media query**, so `favicon-32.png` stays an opaque white plate
with black ink (`BG`/`INK` in the generator). The split is deliberate: the SVG adapts for every
browser that supports it, and the one raster fallback stays legible everywhere rather than betting on
a theme. (3) **The generator grew absolute cubics.** The mark is exported with uppercase `C`, so
`flattenPath` gained a `C` branch beside `c` — the "widen it if the art ever needs more" case above,
arriving. Both branches stay: converting art to one convention by hand is how a coordinate gets
mistyped. (4) **Same day: the mark went EVERYWHERE**, tab and Home Screen alike, so the slop-\* apps
look like one family at every size. There is now effectively ONE source — `make-icons.mjs` sets
`logotype = favicon` — which retires the "two sources on purpose, and they must stay in sync" rule
above along with its drift hazard. The hand-lettered logotype moved to **`tools/icon.svg`** — out of
`public/`, because dormant art should not deploy and a file sitting in `public/` reads as a live
source. `load(file, dir)` grew a directory argument for it, and the generator names the way back at
the assignment: `load("icon.svg", artDir)` restores the logotype for the PWA / apple-touch sizes.
**That escape hatch is tested, not assumed** — flipping the line regenerates `icon-180.png` at
exactly its former 4620 bytes. Worth knowing the star favicon that preceded all this was literally
this file's FINAL SUB-PATH, extracted (the two path strings hash identically), which is why the
wordmark is the thing to keep: it contains the star, not the other way round. Keeping the art rather than
deleting it is the point — the logotype reads well at 180px+ and only blurs around 32px, which is
why the tab never used it. Verified by rendering: the mark fills the 0.86 fit cleanly and still sits
inside Android's tighter 0.55 maskable safe zone. **Owed:** the installed Home Screen icon, which iOS
snapshots at install time — seeing it needs a remove-and-re-add, not a reload.

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
`min(zoom, 2)` (export stays 1×) — **superseded a few entries below: that factor is QUANTISED to
`[2, 1.5, 1]` (`OUTPUT_SCALE_STEPS`), because a continuous one reallocated the backing store on
every pinch `pointermove`.** Cells stay DPR=1. Zoom past 2× can still soften;
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
change; drag was not undoable at the time (same as the old number field) — **it IS now: the body
slide brackets `beginStructuralEdit`/`commitStructuralEdit` via `settleClipDrag`, and the video clip
gained trim handles on the same bracket.** Every row shares
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
`composeSteps` has FIVE writers — `Canvas.syncComposeSteps()` plus the four lift entry points, which
install their own chain for the lift's lifetime. **What makes that split safe is the fact worth
stating: `syncComposeSteps` BAILS on a live lift**, so it can never overwrite a chain a lift owns.
It is called on version / playhead / dims / active-layer change and at gesture start — never every
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
`transformDragGuard.settle` bracket the hold-span resize uses — at the time **deliberately diverging
from the video and audio clip drags, which were non-undoable** (inherited from the numeric fields
they replaced): those move where a reference _sits_, this changes **what renders**, and a mis-drag
that silently blanks frames is exactly the loss undo exists for. **That CONTRAST is gone — the audio
offset drag became undoable on 2026-08-15 and the video clip slide in the fix wave after it, so all
of them now bracket one undo entry per gesture. Do not strip this drag's bracket to "restore the
symmetry"; the symmetry was restored the other way.** `cloneLayers` deep-copies `range` the
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
frame op at all**: every frame tool acted on the ACTIVE LAYER only at the time (`Timeline.svelte`'s
`frameTool`/`keyTool`/`dupTool`/`deleteTool`), and `insertFrameAllLayers`/`deleteFrameAllLayers` had
existed in `timeline.ts` with **zero production callers** — tests only. So "shift the range by the
inserted count" was unimplementable as stated: when layer A gains a frame and layer B does not, a
document-space range has no single correct shift, and moving it would sync the ref to A while
desyncing it from B. **The real gap was the missing operation**, so that is what was built. Those two
functions are now wired to a pair of timeline-bar buttons and extended to ripple everything living in
document-frame space: image ref ranges, video clip offsets, and the audio track. Per-layer tools were
untouched by THIS change.

> **SUPERSEDED — the frame tools are no longer per-layer.** `frameTool` (Add frame) and `deleteTool`
> (Delete frame) ARE the document-wide ripple ops now: they call `insertFrameAllLayers`/
> `deleteFrameAllLayers` directly, deliberately ungated on the active layer (skipping a locked row
> would break the alignment). Insert-keyframe, Duplicate and Hold left the bar entirely; **`clearFrame`
> is the only per-layer frame tool left.** The straddle/shift reasoning below is unchanged and still
> current — only the "per-layer tools are untouched" framing is stale.
> The shift math is pure and unit-tested (`shiftSpan`, `shiftStartFrame`). **The straddle rule is the
> part worth knowing:** a span containing the inserted frame GROWS rather than moving — insert a
> breakdown mid-action and the reference should cover it, not slide off it — while a span entirely
> after the frame moves and one entirely before is untouched. Delete mirrors it, flooring a span at one
> frame rather than inverting it. Audio and video have no `end` to grow, so a clip STRADDLING the
> frame is left alone: a video's length is its footage and cannot absorb a frame, so it will drift if
> you insert mid-clip. That is honest rather than fixable.
> **`StructSnapshot` gained `audioOffsetFrames`, and that widening is load-bearing.** Audio is
> otherwise deliberately outside undo (set/remove-track, mute and the waveform drag are all
> non-undoable, matching opacity), but this is the first operation that moves audio _programmatically_
> — without the field, undoing a ripple would restore every layer and range and leave the audio
> shifted, which is worse than never shifting it. `restoreStructure` applies it only when the track
> still exists AND the snapshot had one. (Set/remove-track and mute later became undoable too, so the
> snapshot now carries the track and both its flags — see the audio-undo entries below.) The ripple ops are **not** gated on the active layer being
> editable, unlike the per-layer tools: this is a document op, and skipping locked rows would destroy
> the very alignment it exists to preserve (same treatment a document resize gives them). (Add and
> Delete frame ARE these ripple ops now, so that ungated treatment is the bar's behaviour, not just
> these two functions' — see the superseded note above.)

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
Recorded so the question is not re-opened from scratch. **Read this as a rule about per-layer ops in
general, NOT as a description of today's bar: Add and Delete frame became the document-wide ripple
ops, and Insert-keyframe/Duplicate/Hold left the bar. `clearFrame` is the last per-layer frame tool,
and it changes no frame numbering, so nothing there has a range to shift. Do not "restore" a
per-layer Add or Delete on the strength of this paragraph.**

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
grab targets sat on the same pixels. The strip comes from padding on the panel's TWO direct children,
not on the root — padding the root would inset the header's bottom border and leave it short of the
left edge. **CURRENT VALUES (this paragraph's `pl-2` / 12px / 8px / `MIN_PANEL_WIDTH` 188 are all
superseded — see "All three are 8px" below, which is the settled version): the reservation is `pl-1`
= 4px, and `MIN_PANEL_WIDTH` is 184** (180 of usable content plus that 4px reserve — the floor is a
guarantee about CONTENT width, so the reserve is added on top of it; a test pins the number).
`DEFAULT_PANEL_WIDTH` stays 224 so the panel's overall width is unchanged; that costs stored
preferences a few px of content, which the row's `flex-wrap` absorbs and the drag itself remedies.
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
`MARKER_W` stays FIXED — 22 when this was written, **28 since** (widened so the lock/hidden glyph is
not crowded against the divider; see the end of this entry). It holds one 11px glyph and has nothing
to gain from resizing; only the name column moves. `clampGutterLabelWidth` (pure, unit-tested) clamps to [80, **40%** of the
viewport], tighter than the layer panel's 50% because this column eats horizontally into the frame
strip, which is the timeline's actual content. `DEFAULT_GUTTER_LABEL_WIDTH` is 120, the old constant,
so nothing moves on first run; persisted as `timelineLabelWidth` through the existing prefs pair.
**The grip's z-index is the non-obvious part:** it must sit above the PER-ROW sticky labels at z-20 —
at z-15 (beside the plate) or lower, whichever row you pressed would swallow the gesture with its own
label. It was `z-25` here; it is **`z-40` now**, because it also crosses the ruler row (z-35) and has
to stay grabbable through it — see the z-index ladder entry. It straddles the divider (`left:
GUTTER_W - 3`, 6px wide **— superseded: `GUTTER_W - 6`, 8px wide and deliberately asymmetric, see
"The GUTTER's grip" below**), is sticky so it rides that edge through horizontal scroll, and is
pulled out of flow with the same negative margin the plate uses so it adds no height. Dragging RIGHT widens — not inverted, unlike the layer panel's grip, whose
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
The timeline's height grip briefly lost its bar too, then had it restored — see the paragraph below
for why that one was the exception.
**SUPERSEDED 2026-08-19 — it is NOT an exception any more.** All three grips are bare edges with the
same 8px hit / 4px hover tint; see the closing entry, `All three resize grips are bare edges`. **This
sentence is the one a reviewer read as drift and "corrected" back, reverting a deliberate decision —
do not restore the bar from it.** Worth keeping from that detour: its hit area was ALREADY the same
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

> **SUPERSEDED 2026-08-19 — see the 2026-08-20 note at the end of this file.** The timeline's height
> grip is now a BARE EDGE with a hover tint, exactly like the two vertical ones. The paragraph below
> is kept for its reasoning about tint area, which still holds, and as the record of a rule that was
> reverted deliberately rather than drifted away from.

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

**Audio clip trim (2026-08-16):** the audio lane's clip can be trimmed at either end, so a long take
can be cut to the shot without re-importing. `AudioTrack` gains `trimInFrames?`/`trimLenFrames?` —
SOURCE frames, both optional, matching `offsetFrames`'s framing rather than seconds. **Absent means
untrimmed**, the same convention as `ReferenceLayer.range`: an old project loads playing the whole
buffer and the save format version does not move. The pure arithmetic lives in `src/audio/trim.ts`
(`audioTrimSpan`, `trimHead`, `trimTail`, `AUDIO_MIN_TRIM_FRAMES`), unit-tested (14 cases).
**Two coordinate systems, and conflating them was the bug the spec's own self-review caught before
any code existed.** `audioPlayPlan` reasons in KEPT-SPAN time (0 = the first kept sample);
`AudioBufferSourceNode.start()` needs BUFFER time (0 = the first sample of the file). The in-point
(`trimInFrames / fps`) is the conversion between the two, and it is added **only at the `start()`
call**. Folding it into the value passed to `audioPlayPlan` while still passing the trimmed length as
its `duration` compares the two systems against each other and silently cuts every trimmed clip short
by exactly the in-point — the failure mode is not a crash, it is a slightly-too-short clip that looks
like a rounding error. **`audioPlayPlan` needed no signature change at all**: passing it the trimmed
length (`lenS`) instead of the buffer's raw duration makes its existing `at >= duration → silence`
guard cover the trimmed tail for free — the only new tests assert that a smaller `duration` moves that
existing boundary, not a new code path. `trimHead` **clamps the DELTA, not the two results**:
`offsetFrames` and `trimInFrames` must move by exactly the same amount so the kept audio stays under
the same project frames — clamping the two results independently could clamp them by different
amounts and re-sync the clip, which is precisely the thing trimming must not do (the reason to trim is
usually that the sync is already right). Export's existing single `OfflineAudioContext` render in
`buildExportAudio` gains one field on `AudioExportPlan`, `sourceDuration`, passed as `start()`'s third
argument — no second render pass; a trim that puts the clip's span entirely outside the export window
still returns null (no audio track, not a silent one), extending an existing case rather than adding
one. **The undo snapshot holds the trim as SCALARS** (`audioTrimInFrames`/`audioTrimLenFrames` on
`StructSnapshot`), not read off `snap.audio` by reference — the same reason `audioOffsetFrames`/
`audioMuted` are scalars: these fields are written IN PLACE on the shared track object, so a
by-reference snapshot would alias the live value and undo would restore nothing. `restoreStructure`
assigns them **unconditionally**, not guarded by `!== null` the way the offset restore is — `null`
means "was untrimmed", and restoring that has to actively CLEAR the fields, so copying the offset's
guard would leave a trim in place after undoing past it. `setAudioTrim(trimInFrames, trimLenFrames,
offsetFrames)` writes the trim and the offset together so a head-trim gesture's paired write lands in
one undo entry. The stored `bytes` are never touched — trimming is non-destructive, so widening a
handle back out after a save-and-reload recovers the audio. Lane UI: the canvas still draws the whole
buffer, with the trimmed head/tail dimmed the same way the past-the-last-frame tail already is; two
8px edge handles carrying the video-ref clip's two 1px `pointer-events-none` grip bars (the grips are
the ONLY marking — `cursor-ew-resize` does nothing on iPad), undo bracketed per completed gesture via
`transformDragGuard.settle`, the same shape the offset drag already uses.
**The lane's origin is `offsetFrames - trimInFrames`, not `offsetFrames`** (fixed 2026-08-16, a
whole-branch review's one Critical). The trim model anchors the FIRST KEPT sample at `offsetFrames`
— `bufferOffsetForFrame` yields kept-span time and `trimHead` moves `offsetFrames`/`trimInFrames` by
the same delta — so BUFFER frame 0 sits `trimInFrames` earlier. The wrapper's `margin-left` still
placed buffer frame 0 at `offsetFrames`, which was right before the branch: the kept body then drew
`trimIn` columns right of where it PLAYS, and, because the handles' `left` is measured from that
wrapper edge, the head handle travelled at 2× the pointer and hit the minimum-length clamp after half
its expected travel. Three places share that origin and must move together: the wrapper `margin-left`,
the `docEndX` term in the `waveform` action, and `Timeline.svelte`'s `stripFrames` (that last one only
costs surplus scroll width, but coherence beats a second convention).
**Four Minor findings deferred, deliberately, not fixed** (a fifth, the handles' `z-20`, WAS fixed —
it tied them with the sticky gutter's label/marker, and with a negative `offsetFrames` the invisible
head handle overlaid the mute/✕ buttons and stole their presses; the handles are `absolute` inside a
`relative` wrapper, so they paint above the canvas with no z-index at all): (1)
`setPointerCapture` in `trimDown` runs before the `if (trimDrag) return` guard, so a second
simultaneous pen/mouse pointer on the other handle could drive the move off the first gesture's
origin. (2) The `laneDown` trim guard is unreachable by construction (the handles are DOM siblings of
the canvas, not descendants) — noted so nobody later treats it as the load-bearing thing preventing a
double gesture. (3) An out-and-back drag on a never-trimmed clip leaves the optional fields
materialised as an explicit 0/extent with no undo entry — behaviourally identical to untrimmed, but it
re-arms autosave for a gesture that changed nothing. (4) `trimUp` skips its settle on the touch
branch, where the body drag's `laneUp` settles unconditionally.
`AudioEngine.scrub` passes `Math.min(SCRUB_WINDOW_S, lenS - at)` as `start()`'s duration: its
`at >= lenS` guard only covers starting OUTSIDE the kept span, so scrubbing the last kept frame of a
tail-trimmed clip used to play up to 100 ms of the material the trim removed. **Owed a browser pass** (Tasks 5/6
have no unit tests and playback is audible, so none of this is verified beyond build+review): trim
head and tail and hear the result match the waveform; a head trim leaves the kept audio at the same
project frame (the sync-preserving property — check this first); drag a handle back out and recover
the audio; trim → undo → redo; ⌘Z mid-drag; a trimmed clip exports with exactly the kept span; a trim
that puts the clip entirely outside the export window exports with no audio track and still succeeds;
scrub inside and outside the trimmed span; mute unchanged; save → reload preserves the trim and the
bytes; an old project opens untrimmed; iPad for the handles (`touch-action`, finger-pan vs pen-trim).
Plus the 2026-08-16 fix wave: a head trim leaves the solid body drawn at the frame it plays and the
head handle under the pointer 1:1 the whole drag; the grips are visible on both handles on iPad; a
negative-offset clip's head handle no longer swallows the mute/✕ presses; scrubbing the last kept
frame of a tail-trimmed clip is silent past the out-point.
Spec/plan: `docs/superpowers/{specs,plans}/2026-08-16-audio-clip-trim*.md`.

**Trim to playhead (2026-08-16).** Reported as: with a long audio clip you must scroll to its end and
drag the handle back through many pages. Two buttons in the timeline tool bar, after the ripple pair,
put the resolved clip's start or end on the playhead instead. Pure `trimToPlayheadTarget` /
`trimDeltaToPlayhead` (`clip-layout.ts`, unit-tested) feed the SAME `trimHead`/`trimTail`/
`rangeAfterTrim` the drags use, so there is no second trim path to keep in sync, and no guard is
needed for a playhead outside the clip — those helpers already clamp to the 1-frame minimum and the
source's extent.
**The target follows the SELECTED ROW — no precedence, no fallback.** The first version used a
precedence rule (active image ref, else the audio track) to avoid new state; in use it was confusing,
and correctly so: image refs followed SELECTION while audio was a FALLBACK, so the same two buttons
acted on audio whenever a drawing layer was selected, for reasons invisible on screen.

**`state.activeRow` models WHICH ROW IS SELECTED — and that is the whole lesson here.** The first fix
added a boolean `audioLaneActive` beside `activeLayerId`, which meant every view that draws a
selection had to spell out `id === activeLayerId && !audioLaneActive` by hand. Forgetting the second
term is not hypothetical: it shipped twice, once as a double highlight in the gutter and once as a
layer panel disagreeing with it. `activeRow` became a discriminated union, and the rule is: **no view
may COMBINE it with `activeLayerId`-derived state.** Ask an accessor for selection; read
`activeLayerId` for the draw target; never both in one expression. The two remain separate fields on
purpose — `activeLayerId` must survive selecting the audio lane, because it is still what a stroke
lands on — but they answer different questions and no longer meet in a conjunction anyone can forget.
**That rule is the load-bearing half and still holds exactly as written** (it is echoed in two code
comments, and it has shipped as a bug twice).

**The UNION HAS GROWN — it started as `layer | audio`, and it is FIVE cases now** (`src/anim/
active-row.ts`): `{ kind: "layer"; id }` | `{ kind: "audio" }` | `{ kind: "group"; id }` |
`{ kind: "track"; owner: "layer"; id; prop }` | `{ kind: "track"; owner: "group"; id; prop }`.
The accessor set is correspondingly bigger: `isRowSelected(id)`, `isAudioRowSelected()`,
`isGroupRowSelected(id?)`, `isGroupDetailShown(id)`, `isTrackSelected(owner, id, prop)`,
`drawingRowLayerId()`, `pixelToolsBlock()`, and the two pure primitives `workingTarget(row)` /
`targetLayerId(row)` that the rest are defined in terms of. Public writers are `setActiveLayer`,
`selectAudioLane`, `selectGroup` and `selectTrack` (plus `restoreStructure`/`commitStructural`/
`refocusFoldedRow` internally, which re-point a stale row rather than moving the selection between
row kinds). **A view that answers a question about the union by comparing `.kind` itself is exactly
how two views came to disagree — go through `active-row.ts`.**
This was chosen over making audio a real LAYER, which is the correct long-term model and was measured
first: 64 explicit `kind === "draw"/"ref"` checks a compiler sweep would catch, but **29 sites written
as `kind !== "draw"` / `!== "ref"` that today MEAN "is a reference" and would silently start catching
audio** — plus a persistence migration and turning the engine's single `source`/`track` into many. It
also buys multi-track audio, which is a current non-goal. Revisit only if multi-track is actually
wanted; the accessor rule above is what made the workarounds unnecessary in the meantime.
**Audio stays OUT of the layer panel (decided 2026-08-16).** Asked once the audio lane became
selectable; the answer follows from the same fork. The panel's rows are dense with things audio does
not have — visibility, lock, opacity, boil strength, transform apply/reset, drag-reorder, grouping,
merge-down — and audio has no z-order relationship with layers at all, so it is neither above nor
below anything. A row there would be mostly empty and would advertise layer-hood it does not possess
(drag it into a group? why no opacity?), and it would put mute and remove in two places. Either audio
becomes a REAL layer, with the 29-silent-branch cost measured above, or it lives in the timeline where
a clip belongs and where all its controls already are. The panel showing no selection while the audio
lane is selected is now TRUE rather than a glitch, and the status bar still names the draw target.
If the itch turns out to be "I cannot tell from the panel whether the project has audio", the cheap
answers are a 🔊 in the panel header or the menu item reading "Replace audio…" once a track exists —
not a fake row.
**`end` is INCLUSIVE for both clip kinds, but they store different things** — a reference range holds
an inclusive `end`, audio holds a LENGTH — so the same user-visible meaning needs different
arithmetic, hence the `+ 1` in `trimDeltaToPlayhead`'s tail branch. Getting it wrong is silent: the
clip just ends one frame off. There is a test pinning that trimming the end to a clip's existing last
frame is a NO-OP rather than a one-frame change.
An untrimmed image ref materialises its implicit whole-project range first, the same range an edge
drag materialises. `aria-disabled`, not `disabled`, so the dimmed state can explain itself.
**Owed a browser pass:** trim start/end to playhead on an audio clip and on an image ref; the title
naming the right target as the active layer changes; both dim with a reason when neither applies;
undo restores in one step; a playhead outside the clip clamping instead of inverting; iPad tap.

**Clip palette is NEUTRAL, separated by value (2026-08-16, replaces the blue-grey).** The tint existed
because the greys BETWEEN `surface` and `border` are too close to read as a separate object under the
ruler — true, so the new values sit OUTSIDE that range instead of inside it: `#d6d6d6` light (well
below the ruler's `#ebebeb`) and `#474747` dark (well above its `#333`). Staying neutral keeps clips
from competing with the selection blue or the amber locked/hidden state, and leaves the waveform the
loudest thing in the lane.
`-dim` moved much further from `-clip` (`#f6f6f6` / `#242424`, roughly five steps) so a trimmed head
or tail reads as OFF rather than merely different — the old half-step was the actual complaint.
**Knock-on that had to move with it:** the video-ref clip's label was `text-text-secondary`, which on
the darker plate falls to ~4.0:1 — under the 4.5 floor the 2026-08-11 contrast pass set for this
codebase. It is `text-text` now (~10.8:1 light, ~6.7:1 dark). Any future change to `--color-media-clip`
must re-check that label; the waveform peaks are a graphic and only need 3:1, so they are unaffected.

**Loop moved out of the settings popover onto the playbar (2026-08-16).** Asked as "is hiding loop
playback in settings a good idea?" — no, and the app's own convention already said so. **Loop is a
transport MODE, not a project parameter:** it is flipped constantly while working (loop a section to
judge timing, then play through), where fps is set once. The pattern to copy was already here — the
onion skin and line boil each have a VISIBLE TOGGLE on the bar plus a gear for their PARAMS. Putting
loop behind the gear flattened that distinction. It also pairs with In/Out, which was already visible,
so looping a range meant setting the range on the bar and then opening a popover to act on it.
It is now a `Repeat` toggle as the LAST item of the playbar's transport group — where media players
put it, and where it reads as part of "how playback runs" rather than as a range operation (it was
briefly grouped with In/Out, on the reasoning that looping a range is one workflow; sitting with
transport felt more natural in use, and loop applies with or without a range). Same
`bg-surface-active` on-state as the other toggles, with `aria-pressed` and a title that states the
CURRENT mode rather than naming the control. fps stays in the popover, which is now coherently "project settings" rather than a mixed
bag. **The rule this sets: a popover is for parameters you set and forget; anything you toggle during
playback belongs on the bar.**

**Playbar slimmed; length is dragged on the ruler (2026-08-16).** Three changes from one review of the
bar. (1) **"Frame n/n" removed** — it duplicated the STATUS BAR's `f n/n · tool · layer` readout, and
the timeline's playhead badge shows the current frame as well; three places for one number. (2)
**Length moved into the playbar's gear popover**, beside fps: both are timing PARAMS you set, not
transport you flip — the same rule that moved loop the other way. (3) **The ruler's right edge is a
drag handle for the animation's length**, the direct manipulation the clip trim handles established;
the popover field is now the type-an-exact-number path.
**Three bugs in the first version of this drag, all found by asking "does the warning actually
fire?" (2026-08-16, fixed same day).** Worth reading before writing another live drag over
destructive state:

1. **The warning could never fire.** It counted dropped keyframes against the LIVE project — but the
   drag had already applied the shrink, and `resizeCells` SLICES, so the cells were gone and the
   count was always 0. Both the live hint and the release confirm were dead code. Counting must use
   the grab-time SNAPSHOT (`countKeyframesPastLengthIn(undo.layers, n)`), which still holds them.
2. **The history was flooded.** `setAnimationLength` wraps itself in `commitStructural`, so calling
   it per `pointermove` pushed one undo entry per frame of travel. Split out `applyAnimationLength`
   (mutation + `bump`, no history) for gestures that bracket themselves.
3. **Declining the confirm did not undo the damage.** It called `setAnimationLength(startLen)`, which
   only pads holds back — the sliced keyframes were already lost. It now calls `revertStructural`,
   restoring the grab-time snapshot, which is the only thing that still has them.
   **The general rule: a live drag over destructive state must measure against the snapshot, mutate
   without committing, and abandon by restoring — not by re-applying the old value.**

**The confirm is the interesting part.** Shortening past a keyframe asks "removes N keyframe(s)?" —
a drag CANNOT ask per-frame, that is a modal per `pointermove`. So the drag writes the length live and
defers the question to RELEASE, warning in the STATUS BAR throughout ("Length 20 — releasing here
removes 3 keyframe(s)") so the prompt is never a surprise at the end. Declining restores the starting
length rather than leaving the drag half-applied. Any future destructive drag wants this shape: warn
continuously, ask once, revert cleanly on "no".
The handle sits INSIDE the ruler row so it scrolls with the frames it measures, is absolutely
positioned so it adds no column, and carries the usual `touch-action: none` + `pointercancel` +
finger-pans/pen-edits trio. **Being a child of the ruler means the ruler's own scrub had to bail:**
`rulerDown`/`rulerMove` return early when `lenDrag` is set, or pressing the handle ALSO scrubs and the
playhead jumps in front of the thing you just grabbed (reported immediately after the first deploy).
The handle deliberately does not `stopPropagation` — that would suppress the window-level status-hint
listener for the very pointer performing the drag. This is the third control to need the
parent-bails-on-child-state shape (clip body vs trim handle, lane body vs trim handle, ruler vs length
handle); reach for it, not for stopPropagation. `frameDigits` went with the removed readout — it had no other reader.
**Owed a browser pass:** drag to lengthen and shorten; shorten past keyframes and see the live warning
then the single prompt; decline it and confirm the length snaps back; undo after a length drag; the
handle staying at the ruler's end while scrolling horizontally; iPad.

**Edge auto-scroll while dragging (2026-08-16).** Reported as: dragging the playhead or a trim edge
past the viewport does nothing, so you must stop, scroll by hand, and resume. **Every HORIZONTAL
timeline drag** now scrolls when the pointer nears an edge; the authoritative list is the set of
`startEdgeScroll(apply, owner)` call sites, each tagged with its owner string, and it has grown since
(ruler scrub, animation length, audio offset, audio trim, image-ref range, video clip slide, video
trim, transform-key move, the timeline row drag). The two panel-resize grips deliberately do NOT:
scrolling the content while sizing a panel would be wrong.
**A screen-space drag origin must be corrected by the scroll, or auto-scroll does nothing useful.**
Five of the drags stored the pointer x at grab and computed `round((clientX - x) / CELL_W)`. Scrolling
does not change either term, so re-applying with a still pointer produced the SAME delta while the
content moved — the dragged edge sat at its frame and scrolled away, then resumed following the
pointer carrying that offset for good (reported straight after the first deploy). Each now records
`sx = scrollX()` at grab and adds `(scrollX() - sx)` to the delta, which also covers the user
scrolling by any other means mid-drag. The RULER SCRUB and the ROW DRAG needed nothing: they measure
from an element INSIDE the scroller, whose rect shifts with it, so they self-correct. `AudioLane`
takes a `getScrollLeft` prop for the same reason it takes the scroll controller — it does not own the
scroller.
**The tick RE-APPLIES the active drag, and that is the whole design.** While the pointer sits still
past the edge there are no `pointermove` events, so a helper that only scrolled would slide the
content out from under a trim edge that never followed — you would scroll but not trim. Each drag
therefore splits into an event handler (pointer-type guards, capture checks) and a plain
`xMoveAt(clientX)` the rAF tick calls with the last known pointer x. Do not "simplify" a drag back
into a single event handler without removing it from the autoscroll registry.
`edgeScrollDelta` (`src/anim/edge-scroll.ts`, pure, unit-tested) is PROPORTIONAL to how far into the
40px zone the pointer is, capped at 24px/tick — a small overshoot creeps so an edge can be placed
precisely, a large one races, and deflection past the edge counts as full speed rather than growing
without bound, or the scroll becomes impossible to steer. The tick also skips re-applying when
`scrollLeft` did not actually move, so sitting at either end costs nothing.
**The timeline ROW drag joins them (marquee, move-block and hold-span resize).** All three live in
one handler, so wiring `rowDown` covers the set. Two things it needed that the other six did not:
the apply callback grew a Y (the marquee hit-tests which TRACK the pointer is over, via
`layerIdAtPoint`), and the column maths had to lose its dependence on `e.currentTarget` — `rowOffset`
measured the row element from the event, which a re-applied call does not have. `dragRowEl` is
captured at grab and `rowColumnAt`/`rowBoundaryAt` measure from it; every row shares the strip's
horizontal geometry, so any one of them is the right ruler.
The IDLE HOVER tail of `rowMove` deliberately stayed on the event path as `rowHover`: it measures
`currentTarget` and there is no drag to re-apply when nothing is being dragged.
**The LEFT trigger is measured from the gutter's inner edge (`r.left + GUTTER_W`), not the
scroller's.** The name column and marker are STICKY, so they cover the scroller's left edge — a zone
measured from there sits underneath them, and you have to drag the pointer behind the gutter before
scrolling starts. The right side needs no inset, since nothing overlays it. Add the same term to any
future left-edge geometry in this scroller; the sticky gutter has caught this several times now.
`AudioLane` does not own the scroller, so Timeline passes it `onEdgeScrollStart/Stop/PointerX`
alongside the existing touch-pan callbacks. Every start is paired with a stop on the settle path, not
on `pointerup` alone — the settles are also what undo/Open call through `transformDragGuard`.
**Owed a browser pass:** drag each registered owner past both edges and back; a marquee extending across pages while the tracks scroll; that a trim edge keeps
following while the content scrolls; that it stops at either end without spinning; release outside
the viewport; ⌘Z mid-autoscroll; iPad with a Pencil.

**The timeline's z-index ladder, written down (2026-08-16).** Layer names leaked across the RULER
while scrolling the tracks vertically: the ruler row and the per-row gutter labels were both `z-20`,
and the labels come later in DOM order, so at equal z they won. The ruler is the thing rows scroll
UNDER, so it has to outrank them. The full ladder now, bottom to top — check a new overlay against it
rather than picking a number:
| z | what | why |
|---|---|---|
| 10 | playhead line, playhead badge | visual only; must not cover the ◆ you are grabbing |
| 15 | full-height gutter plate | hides the playhead line in empty space below the last row |
| 10 | clip trim handles, the ruler's length handle | must scroll UNDER the gutter, so they stay below 20 — and above their clip's own z-10 label by DOM order |
| 20 | per-row sticky name labels and markers | above the plate, below everything structural |
| 35 | the sticky RULER row | rows scroll under it; the playhead badge is its child and rides along |
| 40 | gutter resize grip | crosses the whole height including the ruler, so it must stay grabbable there |
| 45 | selection bar (`TimelineSelectionBar`) | a floating TOOLBAR: it must be clickable wherever it lands, so it outranks everything it can be placed over |
**The selection bar was `z-30` until 2026-08-16 and that was a regression from this very table**:
raising the ruler to `z-35` put the bar UNDER it, and the ruler has no `pointer-events: none`, so it
also swallowed the bar's taps — pressing Copy/Cut/Paste/Delete scrubbed the playhead. It is reachable
immediately whenever a selection is taller than the viewport, since the bar's fallback placement is
`viewTop + 2`, i.e. exactly the ruler's band. The lesson generalises: when a ladder rung moves, every
FLOATING thing that can be positioned over it has to be re-checked, because a float has no fixed
neighbour to compare against.
**Both clip trim handles and the ruler's length handle were z-20 and had to drop to z-10
(2026-08-18).** At 20 they tied with the sticky gutter — the per-row label for the clip handles, the
ruler's own spacer for the length handle — and came later in the DOM, so instead of sliding under the
gutter they painted OVER the layer names. Reported from a screenshot. Anything that lives in the
scrolling strip and must disappear behind the gutter belongs at 10, not 20; 20 is the gutter's own
band. This is the third time this exact tie has produced a bug (audio trim handles stealing the
mute/✕ presses, layer names leaking over the ruler, now these).

**Equal z plus later DOM order is a win, not a tie** — that is what made this a bug rather than a
coin flip, and it is the same mechanism behind the audio trim handles stealing gutter presses at
z-20. When two things must not overlap, give them different numbers, not the same one.

**The playhead tip needed its own gutter mask (2026-08-16).** Everything in the ruler row hides behind
the sticky gutter spacer when you scroll right — EXCEPT the badge's downward tip, which is positioned
at `top: 24px`, i.e. 6px BELOW the row, where the spacer (only as tall as the ruler) does not reach.
Scrolled right, it painted over the layer names. It cannot be hidden by the full-height gutter plate
either: the plate is z-15 in the OUTER context while the ruler row is z-35, so anything inside the row
outranks it.
The mask is an ABSOLUTE child of the STICKY spacer, `top-full`, 6px tall, carrying the divider border.
Both halves of that are load-bearing: an absolute box in the ROW would be positioned from the row's
left edge, which scrolls away, and simply making the spacer taller would push every track down by 6px
(a taller flex item grows the row). Being a child of the sticky element gets sticky's horizontal
tracking with absolute's freedom from layout.

**Two rules for live drags, learned the expensive way (2026-08-16).** The ruler's length handle broke
both at once and each cost real keyframes; a five-reviewer pass found them. Check any NEW drag against
both before shipping it.

**1. A drag over DESTRUCTIVE state settles by REVERT-then-REAPPLY, never by comparing endpoints.**
`applyAnimationLength` → `resizeCells` SLICES, so every intermediate shrink permanently drops the cells
past it and dragging back only pads `{kind:"hold"}` — the grab-time snapshot is the only thing still
holding the originals. `settleLenDrag` used to open with `if (end === startLen) return;`, discarding
that snapshot — so an overshoot-left-then-correct (the normal shape of a drag) destroyed every keyframe
past the deepest dip, silently, with no undo entry to get them back. The endpoint comparison is only
sound when the intermediate states are non-destructive, which is exactly what a "does the value differ?"
check cannot tell you. `settleLenDrag` now ALWAYS `revertStructural(undo)` first — restoring the
grab-time document — and then re-applies the released length inside the same bracket
(`applyAnimationLength(end)` + `commitStructuralEdit(undo)`), so out-and-back is a true no-op with the
cells intact and one undo entry is pushed per gesture that changed anything. It also fixes the confirm,
which counted and gated on the RELEASE length against ALREADY-TRUNCATED cells: dip to 5 and release at
60 and it never asked though everything past 5 was gone. Counting after the revert is counting against
unmutated state. A `dirty` flag skips the revert entirely for a grab-and-release that never wrote
(otherwise a click on the handle re-dirties autosave for nothing).

**2. A drag whose value CHANGES THE CONTENT WIDTH must not use a screen-space origin plus a scroll
correction.** The other five timeline drags store `x`/`sx` at grab and add `scrollX() - sx`, which is
right for them — auto-scroll moves the content while the dragged edge would otherwise stay put. The
length drag's value sizes the content (`min-width: GUTTER_W + stripFrames*CELL_W`), so shrinking
shrinks `scrollWidth`, the browser clamps `scrollLeft` down, and the correction term fed the drag's own
output back in: `n_new = n_cur + round(dx/CELL_W)`, i.e. the cumulative delta re-applied EVERY
pointermove, collapsing the length toward 1 under a stationary pointer. Now measured absolutely, from
`rulerEl`'s rect (an element INSIDE the scroller, so its left edge moves with the scroll — the same
basis the ruler scrub and row drag use), via the pure `lengthAtX` (unit-tested; ROUNDS and is 1-based,
because the handle sits on a column BOUNDARY, unlike `columnAtX`). `sx` is deleted from `lenDrag`.
**An absolute measure is necessary but NOT sufficient here**, which is the subtle half: at the far right
`scrollLeft` sits at its maximum, so a shrink still makes the browser clamp it, the content slides right
under a stationary pointer and the measurement walks down a frame per event — the same feedback, slower.
`lenDragFloor` (a `$state` holding the grab-time length, pushed into `stripFrames`) pins the row width
for the whole gesture so `scrollWidth` never DECREASES and `scrollLeft` is never clamped; growing past
it is fine, since widening never clamps, and that is what lets edge auto-scroll extend past the viewport.

**Same wave, smaller (all 2026-08-16).** `revertStructural` now `bump()`s: the abandoned gesture had
already bumped `persistTick` on every live step, so the ~3s autosave debounce could have written the
MUTATED document, and a memory-only revert then lost the restore on reload (`undo()`/`redo()` bump after
a pop for this reason). `applyAnimationLength` calls `liftGuard.discard?.()` — it resplices every cell
array, so a lifted pose/selection would bank into a canvas no longer in the document; it is guarded
inside the action rather than at its two call sites so no future caller can miss it. `restoreStructure`
resets `activeRow` only when a LAYER row is selected — undo is not allowed to move the selection BETWEEN
rows, and it was silently dropping an audio-lane selection on any unrelated undo. `trimToPlayhead`
computes its delta FIRST and returns before `commitStructural` when the write would change nothing:
unconditional, it pushed an empty undo entry AND materialised implicit state (an untrimmed ref's
"always visible" became a fixed range), comparing against EFFECTIVE values the way `AudioLane.trimMoveAt`
already did. Edge auto-scroll grew two guards: the tick re-applies only once the pointer has TRAVELLED
more than `MOVE_CANCEL_PX` from where the tick was armed (a press-and-hold inside the left trigger zone
was dragging on its own — and `clipMoveAt` writes `offsetFrames` with no undo bracket at all, so it slid
a video's in-point unrecoverably), and the row drag arms it only once `dragMode` really becomes a drag.
The tick is ONE shared resource, so `startEdgeScroll`/`stopEdgeScroll` now take an `owner` string and a
stop is ignored unless that drag armed it; `resetRowDrag` clears `transformDragGuard.settle` only when it
still holds its own hook. Four `ref.id !== activeLayerId` comparisons in the clip rows were left behind
by the `activeRow` refactor and now use `isRowSelected` (selecting the audio lane left a reference row's
gutter label dim while its clip body stayed lit).

**Data-loss audit wave (2026-08-16, `fix/audit-wave`):** a three-subsystem audit (export /
persistence / undo-lifecycle) found three CRITICAL data-loss paths and eight smaller ones. All
fixed in one commit. The three criticals share a shape worth naming: **an operation that reads the
document across an `await`, while something else is allowed to change it** — an uncommitted lift, a
blank startup document, a live `$state` array.

1. **Export never banked or discarded an active lift, so it encoded HOLES.** `liftPixels` CLEARS the
   region from the cell canvas — the pixels live only on the overlay, which `renderFrame` never
   composites (`Canvas.svelte` literally comments "show the hole where the content lifted out").
   ~19 call sites in the app call `liftGuard.discard?.()` for exactly this hazard; the export path
   had none, so marquee-a-head-and-drag-it → Export MP4 wrote a head-shaped hole into every frame
   resolving to that key, and a POSE lift (whole content bbox) blanked the layer for the hold span.
   `ExportDialog.run()` now discards beside the existing `playbackController.pause()`. **Discard,
   not bank:** an export must not silently commit an edit the artist hasn't.
2. **A failed startup restore silently armed autosave over the BLANK document.** `App.svelte`'s
   restore was `try { … } finally { autosaveReady = true }` with no `catch`, so anything throwing
   inside (a truncated blob, an OOM decoding a large project on iPad, an IndexedDB open that never
   settled — see #6) left `state.project` as the empty `createProject()` **and opened the autosave
   gate anyway**. First stroke → 3s debounce → the blank project overwrote the single autosave slot.
   Total, irrecoverable loss. Now: `catch` → **leave `autosaveReady` false for the session** (the
   `finally` is gone; arming is the last statement of the success path) + a sticky warning. The
   inversion is the point — a restore that failed is exactly when autosave must NOT run.
3. **`saveProjectBlob` raced concurrent edits and wrote a structurally inconsistent zip.**
   `projectToJson` snapshots each layer's cell KINDS synchronously, then the PNG loop `await`ed
   `canvasToPngBytes` once per key cell **while walking the live `$state` arrays** — hundreds of
   yield points over seconds, with input unblocked. Delete a frame mid-autosave and the JSON
   described 10 cells while the loop walked 9: on restore, frames shifted onto the wrong drawings
   and the last key had no PNG (indistinguishable from a deliberately blank key). Deleting a LAYER
   the loop hadn't reached yet was worse — JSON keeps it, no PNGs, restores blank. Hits explicit
   "Save Project" too, i.e. the backup. Fixed by capturing **everything in one tick**: new exported
   `collectFrameAssets(project)` → `{path, canvas}[]`, plus the audio bytes and a `{path, src}` media
   list, all before the first `await`; nothing below that line reads `project` again. **Keep that
   boundary comment** — the whole defect is one model read vs. many. Canvases are shared objects, so
   a later stroke landing in an already-captured canvas is accepted and out of scope; the STRUCTURAL
   mismatch was the bug. Two regression tests drive a fake canvas whose `toBlob` deletes a frame /
   a not-yet-encoded layer mid-encode; both were confirmed to FAIL against the old interleaved walk.
4. **`restoreStructure` never restored a ref's `offsetFrames`** — the third member of the
   `range`/`audioOffsetFrames` trio, and missed for the same reason both of those were added:
   `rippleDocumentFrames` shifts it INSIDE `commitStructural`, so ripple-insert + ⌘Z reverted cells,
   range and audio while the video clip stayed one frame late, drifting silently on repeat.
5. **Three ops cloned a cell canvas with a lift's hole punched in it.** `Timeline.keyTool`/`dupTool`
   (`insertKeyframe`/`duplicateKeyframe` clone the resolved key, then `playhead += 1` banks the lift
   into the ORIGINAL → the new key keeps the hole permanently), `duplicateLayer` (clones every key,
   then `setActiveLayer(dup.id)` banks into the SOURCE → the copy is missing the floating art), and
   `removeLayer` (banks AFTER the structural command → undo twice brings the layer back holed). All
   now `liftGuard.discard?.()` first, matching `mergeDown`/`applyLayerTransform`/`clearFrame`.
6. **`openDb` could hang forever, silently disabling autosave for the whole session.** It handled
   `onupgradeneeded`/`onsuccess`/`onerror` only — a v2 upgrade BLOCKED by another open tab fires
   none of them, so the promise never settled: at startup the restore `await` hung, `autosaveReady`
   never flipped, and the app looked completely normal on a blank canvas with saving off. Now
   `onblocked` rejects with a readable message and a **10s timeout guarantees the promise settles**;
   a success arriving after the timeout closes its connection rather than leaking it (piled-up
   connections eventually make WebKit refuse new opens). Startup surfaces it through #2.
7. **Every autosave failure was completely silent** (`.catch(() => (autosaveDirty = true))`) — so a
   DETERMINISTIC failure (iPad quota, or the documented stale-tab `VersionError` after a deploy)
   let the user work for hours believing they were saved. Now reported; a later successful write
   retires the message.
8. **A failed audio decode destroyed the stored audio bytes.** The loader set `project.audio = null`
   on a decode throw, discarding the encoded `bytes` — so a project saved on desktop Chrome and
   opened on iPad (WebKit can't decode that format) lost its audio, and ONE edit + autosave removed
   it from the only copy. Of the two fixes offered, the **save path preserves it**: new
   `Project.audioUndecoded` (`UndecodedAudio` = `AudioTrack` minus `buffer`) holds name/bytes/offset/
   mute/trim, `projectToJson` writes that metadata when there is no decoded track and
   `saveProjectBlob` re-writes the bytes unchanged. Chosen over making `AudioTrack.buffer` nullable,
   which would have rippled into the engine, `audio-mix` and `AudioLane` and put a track with no
   buffer inside every playback/export invariant. `audio` and `audioUndecoded` are **never both
   set** — `setAudioTrack`/`removeAudioTrack` clear it. A missing `audio/track` ZIP ENTRY still just
   drops the track: there are no bytes to preserve.
9. **Save and Open had no error handling at all** — a corrupt zip or an OOM in `saveProjectBlob` was
   an unhandled rejection with ZERO feedback: no file appeared and nothing said why, which is
   exactly the state in which someone closes the tab believing they're saved. Both wrapped; Save
   also reports success by name (and latches the embed-failure callback instead of writing it
   straight to the hint, so the success line can't stomp the warning).
10. **Global shortcuts stayed live during a multi-minute export.** `ExportDialog`'s backdrop blocks
    POINTERS only, and the frame loop `await`s per frame while `renderFrame` re-reads the LIVE
    project each iteration — so ⌘Z 90 seconds into a 300-frame render spliced pre-edit and post-edit
    art into one file, and Space/Enter/k restarted playback onto the shared boil GL surface that the
    existing `pause()` exists to keep clear. New `state.exportBusy` (set for the WHOLE render, not
    just while the dialog is open) makes `App.svelte`'s `onKey` return immediately — placed above
    the ⌘Z branch, which sits above the INPUT/TEXTAREA guard.
11. **One bad frame discarded the whole render with no clue which frame.** Export is the only code
    that renders EVERY frame, so a defect firing on frame 240 is invisible while authoring and costs
    a multi-minute encode (a concrete reachable one: `render.ts` does `scaleRect(cell.transformBox!,
dpr)` while the save format allows a non-identity `transform` with `transformBox: null`). Both
    exporters now catch per frame and rethrow naming the frame (with `cause`). Deliberately NOT
    skip-and-continue: a quietly short file looks finished.
12. `download.ts` revoked the object URL in the same tick as `a.click()`. The browser only has to
    have STARTED the fetch by then, and this is the lifeline path for a large zip on iPad — revoke
    is now deferred 60s.
13. `setAnimationLength` and `rasterizeReference` pushed EMPTY undo entries: their no-op guards sat
    INSIDE the `commitStructural` callback, where returning early still leaves identical before/after
    snapshots pushed (a ⌘Z that visibly does nothing). Guards moved above the commit. **General
    rule: a `commitStructural` callback must never be the place a no-op is decided.**

**New `state.persistAlert` (from 2, 7, 9).** A STICKY data-safety condition ("autosave is OFF",
"autosave is failing", "save failed"), rendered amber in its own slot in the status bar. It is not
`statusHint` for the reason `poseFillWarning` isn't either: `App.svelte` has a window-level
`pointerover`/`pointerdown` writer that overwrites `statusHint` from the hovered element's `title=`,
so the most important message in the app would vanish on the next pointer move. Cleared only by a
subsequent success (an autosave that lands, or an explicit Save). **Any future message that
describes a CONDITION rather than a control needs its own field.**

**iPad verification of this wave (2026-08-17) — four of the thirteen confirmed on device.**
**(1)** Exporting with an uncommitted selection float or pose lift produces complete frames, no hole
— including the deliberate part, that the lift is DISCARDED rather than baked, so an in-progress move
reverts. **(5)** Insert-keyframe, duplicate-frame and duplicate-layer while a lift is live all copy
the complete drawing instead of a holed canvas. **(13)** A no-op set-length and a repeat rasterize
push no undo entry — one undo reaches the previous real edit. **(4)** Ripple insert then undo returns
a video reference clip exactly where it was, with no per-repetition drift.
**Still unverified: (3) the `saveProjectBlob` race** — the test is to Save a large project and delete
a frame or layer while it is still writing, then reopen the file; the failure is silent (frames on
the wrong drawings, or a blank final key), not an error. The remaining findings — the failed-restore
autosave lock, the `openDb` timeout, autosave-failure reporting, Save/Open error handling and the
per-frame export error — are failure paths that cannot be triggered by hand without a forced-failure
debug hook, and are unit-tested where the logic is testable.

**Re-review follow-ups (2026-08-16, same branch).** The scoped re-review confirmed all 13 and found
four more, all fixed here.

- **`audioUndecoded` was not in `StructSnapshot`, while both writers that clear it are inside
  `commitStructural`.** Open a project whose audio this device can't decode → import a new track →
  ⌘Z: `restoreStructure` set `audio` back to null and left `audioUndecoded` null too, so the next
  autosave wrote a project with no audio at all — the preserved bytes destroyed by the very undo
  meant to bring them back. It is captured **by reference**, exactly like `audio`, and for the same
  reason (it holds the only copy of those bytes). Unlike the decoded track it needs no companion
  scalars, because nothing writes its fields in place — it has no UI. **This is the same invariant
  the audio-undo work established, read in the other direction: a field cleared inside a structural
  bracket must be captured by the snapshot, or undo silently destroys it.**
- **`Canvas.svelte` binds its OWN window key handlers, which the new `exportBusy` gate missed.** A
  Space tap during a multi-minute export restarted playback onto the boil GL surface the export
  shares — precisely the hazard `App.svelte`'s gate exists to close. Both handlers now check it. In
  `onViewKeyUp` the gate sits **after** `spaceHeld = false`: a space held when the export began was
  latched by an ungated keydown, and returning first would leave grab-pan stuck on for good.
- **A manual Save retired the "autosave is OFF" warning**, which a save does not fix — the work to
  that point is on disk, everything drawn afterwards is still unprotected. New `state.autosaveOff`
  (written once, by the restore catch) makes that one alert outlive a save while the transient ones
  still clear.
- **The undecoded-audio notice used `statusHint`**, so the title writer wiped it on the next pointer
  move — the exact trap `persistAlert` was carved out to dodge, walked into two lines below the
  carve-out. It is the only announcement an undecoded track gets (the lane renders a decoded track
  only), so it is now sticky.

Known and left: an undecoded track has no UI at all — it cannot be seen, muted or removed, only
preserved. Adding one means deciding what a track you cannot hear should look like; not this wave.

**Materialising a keyframe is now part of the undo entry that caused it (2026-08-16).** This was the
one finding the audit wave deliberately left, because every fix changes what a single ⌘Z means. It
surfaced as the plain question "I draw on a hold, undo, and the drawing goes but the ◆ stays — should
the key go too?" It should, and making it go also closes the data-loss path.

**What was wrong.** `ensureDrawableKeyframe` converts `{kind:"hold"}` into a real key (or extends the
track past the layer's end) and returned only a canvas. The tool that called it then recorded a PIXEL
command. So the structural half was captured by NOTHING. Two consequences, one cosmetic and one not:
undo reverted the pixels and stranded a blank ◆; and undoing an EARLIER structural entry restored the
layer's pre-materialisation `cells`, deleting the cell out from under the pixel command that owned its
canvas — so redo painted into an orphan and the drawing was gone with no way back.

**The fix.** `ensureDrawableKeyframe` now returns `{ canvas, materialized }`, where `materialized` is
a `CellTrackChange { before, after }` — whole-track arrays, `null` when the frame was already a key.
The return type CHANGED rather than a second function being added, so the compiler names every call
site; there were **eight**, not the three a truncated grep first showed. Each folds the restore into
the undo/redo closures it already pushes, so one stroke stays one ⌘Z: undo takes the pixels **and**
the ◆, redo puts both back.

- **Whole-track copies, not a per-shape diff.** The two shapes (hold→key, and extend-past-the-end)
  collapse into one, and a few hundred REFERENCES cost nothing beside the two ImageDatas the same
  command already retains. `restoreCellTrack` copies on the way in, so a later in-place splice on the
  live array cannot reach back and corrupt the record.
- **Redo installs the track BEFORE the pixels.** The canvas a pixel command writes into only belongs
  to the document once its cell is back in the track.
- **The four LIFT entry points** (paper crop, paste, deform, pose) hold it in `selLayer`/
  `selMaterialized` beside `selCtx`/`selBefore`, for the same span — a new `clearLiftTarget()` drops
  all four together, since clearing three of them was exactly how a stale record could outlive its
  lift. In `enterDeform`/`enterPose` they must be set **after** `selection.cancel()`, which clears
  them.
- **Every abandon path reverts too**, and there are more of them than the happy path: a discarded
  stroke (`discardActiveEdits`), a cancelled lift or pose, a crop that finds nothing, deform/pose on
  an empty cell, and a pose whose mesh fails to build. All of those previously left a ◆ behind for a
  gesture that did nothing. The discard also `bump()`s, because the stroke's start already bumped and
  a revert past the layer's end SHRINKS the track, so `frameCount` has to be recomputed.

**Three things a review caught, all of them the rider's blast radius rather than its idea.**

1. **`enterDeform`/`enterPose` materialised BEFORE `selection.cancel()` — a Critical the rider
   created.** `cancel()` now reverts the cell track, so it could remove the very cell whose canvas
   the tool had just taken: the pose then lifted from, and baked into, a detached canvas and the
   work vanished silently. Reachable via marquee on a hold → Free transform → press with Pose. Both
   functions now **tear down the previous lift first, then materialise** — the ordering
   `pasteSelection` already had. It also means the content bounds are measured on a canvas without
   the old lift's hole punched in it.
2. **The rider is a WHOLE-TRACK snapshot spanning the whole gesture**, so a structural track edit
   landing between materialise and commit gets reverted along with the stroke. Every timeline op
   that splices a track already called `liftGuard.discard?.()` first — except **Add frame**, which
   on iPad a finger can tap mid-Pencil-stroke. Added there. (A targeted rider — revert only
   `cells[frame]` — would be structurally immune, but that is a larger change than this needs.)
3. **A captured layer OBJECT goes stale.** `restoreStructure` mutates the live layer in place only
   while it still exists with the same kind; otherwise it installs a FRESH object (reachable via
   rasterize, which keeps the id, and via delete-then-undo). A deferred closure holding the old one
   writes outside the document — the same orphan failure one branch over. Every DEFERRED restore
   (the undo/redo closures) now resolves the layer **by id at restore time** via
   `restoreTrackById`; the IMMEDIATE reverts (abandon/cancel/discard paths, same tick or same
   teardown flow) keep the object, which is provably live there.

Pure logic is unit-tested (9 cases, incl. canvas IDENTITY across a before→after round trip — the
property that keeps redo pointing at a cell that is actually in the document — that `after` is
copied too, since it is what redo installs, and that the record survives a later in-place edit). The
eight call sites are DOM-coupled and are build+review verified.
**Verified on iPad 2026-08-16: drawing on a hold and undoing behaves correctly** — the headline
case, and the one the whole rider exists for. NOT individually walked, so still owed: redo restoring
both halves; draw on a hold then undo an EARLIER structural edit then redo forward (the data-loss
sequence); fill / clear-frame / delete / paste / deform / pose each on a hold, undone; drawing past
the layer's end → undo → the track shrinks and the timeline length with it; a stroke discarded
mid-gesture by a two-finger undo leaving no ◆.

**Deform and Pose lift on ARRIVAL, not on the first press (2026-08-16).** Reported as "selecting the
deform tool doesn't create the grid handles — they appear after clicking on the canvas". By design,
not a regression: `enterDeform`/`enterPose` fired from `onStroke` on `points.length === 1 && !done`.
Two costs, and the second is the one that mattered — the tool looked INERT until you guessed that a
tap would do something (no grid, no handles, nothing said so), and that first press was consumed
ENTIRELY by the lift (both branches `return` straight after entering), so summoning the grid and
grabbing a handle could never be the same gesture. Every deform was tap-then-press-drag. Entry now
happens in the tool `$effect`, so the first press lands on a handle.

Three things this needed, none of them obvious:

- **The press-time entry STAYS as a fallback.** A layer or frame switch banks the lift
  (`bankActiveEdits`) without the tool changing, so the effect will not re-fire — without the
  fallback the tool would go permanently inert after one frame step. It is now a safety net rather
  than the main path.
- **Entry is gated on `toolEntryPrimed`, and that guard is load-bearing.** The tool is PERSISTED, so
  the effect's first run always reports a change from the hardcoded `"brush"` to whatever was
  restored. Without the gate, launching the app with Deform selected would lift — and on a hold
  MATERIALISE A KEYFRAME — with no gesture behind it, possibly before the project has finished
  restoring. Arriving with the tool already selected therefore still waits for one press.
- **An untouched lift now CANCELS instead of baking** (`deformDirty`/`poseDirty`, set only when a
  grid point or pose handle actually MOVES — adding a handle changes the mesh, not the picture).
  Baking one pushes an undo entry that changes nothing, and since a lift→re-render round trip is a
  resample, "nothing" is not even guaranteed to be pixel-identical. This was already reachable by
  tapping the canvas with Deform selected and switching away; making entry automatic would have made
  it the COMMON case, including one junk entry per frame step while scrubbing with Deform active.
  Both bake sites (the tool switch and `bankActiveEdits`) check it.

**Two more the re-review caught, both created by moving entry to the tool switch.** (a) `enterPose`
ended with `bump()`, so merely SELECTING the tool armed the 3s autosave debounce over a cell whose
content `liftPixels` had punched out — the float lives on the overlay, which autosave never sees, so
a tab killed inside that window reloaded to an empty keyframe. It is `repaint()` now (version only):
**a lift is not a document edit**, and the pose bar only ever needed `version`. Same in `cancelPose`.
(b) The tool `$effect` does not commit an open stroke the way `bankActiveEdits` does, so on iPad a
finger tapping the tool button mid-Pencil-stroke would capture `selBefore` and punch the hole while
`paintStroke` kept writing the same ctx — entry is gated on `!strokeCanvas`, and the press-time
fallback picks it up once the stroke ends. Also: the hold-span resize was the LAST track-splicing op
without a `liftGuard.discard` (it must sit above `beginStructuralEdit`, since the discard's revert
belongs in the before-state), and a pose mesh rebuild resets `poseDirty` — it drops every handle, so
the picture is back at rest.

**Deliberately NOT done: re-entering after a frame or layer step.** `bankActiveEdits` cancels the
untouched lift and nothing re-enters, so scrubbing with Deform selected leaves the grid gone until
the next press. Auto-re-entry would mean every frame step lifts — and on a hold, MATERIALISES a
keyframe — turning a scrub into a document-wide mutation. The press fallback keeps it usable; revisit
only if the missing grid actually bites.

**Verified on iPad 2026-08-16: the grid is there on arrival for both tools and the first press grabs
a handle.** Still owed, since none of these were walked: an empty cell or a locked/hidden layer
entering nothing; select Deform then switch away untouched (no undo entry — ⌘Z should hit the edit
BEFORE it); stepping a frame with Deform active (the grid goes, by design — see above); reloading
with Deform as the saved tool (no lift until you press, and no ◆ on a hold).

**The timeline's finger pan has momentum (2026-08-16).** Reported as "iPad timeline scrolling is
kinetic only when initiated from empty areas". Exactly right, and the cause is structural rather
than a bug: the rows set `touch-action: none` so a Pencil drag EDITS instead of scrolling
(gotcha #10) — which also switches off the browser's own scrolling, and its inertia, for fingers.
So `touchPan` hand-rolls the pan by writing `scrollLeft`/`scrollTop` per pointermove, which is 1:1
and stops dead, while a drag starting on empty space still fell through to native scrolling and
glided. One surface, two behaviours.

Native scrolling cannot be handed back (that is what would break Pencil editing), so the fling is
now ours: `src/anim/kinetic-scroll.ts` (pure, unit-tested, 11 cases) plus a small rAF loop in
`Timeline.svelte`. Three things worth knowing.

- **Release velocity is measured over a WINDOW (80 ms), not the last two events.** That is what
  makes a hold-then-release stop dead: if the finger rested before lifting, every sample in the
  window sits at the same place, so the velocity is zero and nothing is thrown. Sampling the final
  pair would divide a one-pixel jitter by a couple of milliseconds and fling hard — the classic
  "it flew off when I let go" bug. A speed cap covers the same hazard from the other end.
- **Decay is exponential in ELAPSED TIME (`exp(-k·dt)`), not a per-frame multiplier**, so a dropped
  frame lengthens the step instead of shortening the glide. Unit-tested as "one 32 ms step equals
  two 16 ms steps".
- **Everything else that drives the scroller stops it**, or two things fight over `scrollLeft`: a
  pointerdown anywhere in the timeline (one CAPTURE-phase listener on the wrapper, rather than a
  `stopFling()` in each of the six gesture entry points — and a Pencil press counts, or you would
  start drawing while the view slides), edge auto-scroll arming, the playback playhead-follow, and
  teardown. Hitting a scroll bound kills that axis rather than coasting against the clamp.

**A cancelled pointer does not fling.** `touchPanUp` is bound to BOTH `pointerup` and
`pointercancel`, so it reads `e?.type` to tell them apart — the artist never released on a cancel
(OS edge swipe, palm rejection), so there is no throw to honour. Note the binding passes the event
positionally: a `cancelled = false` boolean parameter would have been silently true on the
`pointerup` path too. `AudioLane` routes through the same three functions and gets the momentum for
free.

**The first version shipped with no inertia at all on iPad, and the cause is worth remembering.**
The edge test was `if (el.scrollLeft !== written) v = 0;` — i.e. "if the scroller didn't land where
I put it, I must have hit an end". **`scrollLeft` is not a faithful round trip:** WebKit snaps it to
whole device pixels, so a written 123.4 reads back 123 and the test fired on the FIRST frame from
rounding alone, killing every fling. Desktop Chrome keeps scroll offsets fractional, so it worked
there — a difference no amount of local testing would have surfaced. Two rules came out of it, both
now in the pure, unit-tested `stepFlingAxis`: **compare against the BOUND, never against the value
you wrote**, and **carry the animation's own float position** rather than re-reading `scrollLeft`
each frame (the readback drops the fraction, so a slow glide whose per-frame step is under a pixel
stalls outright).

**The page itself must not scroll, and that is a separate fix in `app.css`.** Reported as "the app
window is scrollable up from the layer panel and top toolbars, hiding the toolbar and revealing
empty space under the UI". Two causes, both needed: (1) nothing set `overflow: hidden` on
`html, body`, so once anything overflowed, the DOCUMENT was scrollable — and a drag on the layer
panel or a toolbar, neither of which sets `touch-action`, pans the whole app. `overscroll-behavior`
does NOT cover this: it governs chaining and rubber-banding, not a document with somewhere real to
scroll to. (2) `height: 100%` resolves against iOS's LAYOUT viewport, which is taller than the
visible area while Safari's dynamic toolbars show — that surplus is the "empty space under the UI".
`100dvh` (behind `@supports`) is the visible area, and it is stable here precisely BECAUSE the page
can no longer scroll, so the toolbars never hide and show underneath us. **Neither was enough on
their own, and a screenshot proved it:** `overflow: hidden` on the document is only a HINT on iOS —
WebKit still pans the app when its content exceeds the viewport. The actual lock is taking the root
OUT OF FLOW (`#app { position: fixed; inset: 0 }`): a fixed element has no scrollable overflow to
give, so there is nothing to drag. Keep all three — the document rules stop a desktop scrollbar, the
fixed root stops the iPad pan. Accepted trade: iOS can no longer scroll a focused input above the
keyboard, which is fine only while no input sits at the very bottom of the window (today they are in
centred dialogs and the layer panel). **Reach for the fixed root FIRST next time; `overflow: hidden`
on `html, body` looks like the answer and costs a deploy to disprove.** The timeline scroller also
got `overscroll-contain`, so reaching either end cannot hand the gesture to an ancestor — chaining
is one way iOS decides the gesture belongs to the page and fires `pointercancel` at us mid-pan,
which aborts the custom pan and (correctly) suppresses its fling. The layer list already had its own
`overflow-y-auto`, so locking the page does not make a long list unreachable.

**Verified on iPad 2026-08-16: inertia works.** That covers the headline behaviour — a flick from a
drawing row now glides. NOT individually walked, so still owed: a slow drag ending stationary stops
dead rather than throwing; a press mid-glide catches it; the glide stops at both ends without
juddering; a Pencil press mid-glide stops it instead of drawing on a moving view; the audio lane
behaves the same; and scrubbing / edge auto-scroll / playback-follow never fight it.
**The page lock is CONFIRMED on iPad (2026-08-16):** the app no longer pans, the toolbars stay put
and the blank space under the status bar is gone. Do not re-litigate it — and note it took the
fixed root to get there, not the document `overflow` rules.

**Layer names come from the PROJECT, not the layer id (2026-08-17).** Reported as "the layer index
keeps incrementing even in a new project" — a fresh document's second layer could be "Layer 23".
`nextLayerId` is a session-wide monotonic counter, and `setMinLayerId` deliberately advances it past
every id in a LOADED project so ids can never collide with a saved file's or an undo snapshot's.
That is right for IDENTITY and wrong for a LABEL, and `createDrawingLayer`'s default name was
`Layer ${id}` — so the number the artist sees inherited a counter that must never reset.
New pure `nextLayerName(layers, prefix)` (unit-tested) numbers within the project instead: **MAX + 1
over names matching `<prefix> N`**, so deleting "Layer 2" of three and adding one gives "Layer 4" —
a name just in use is never immediately recycled onto different content — and renamed layers simply
drop out of the series. The `name` parameter on `createDrawingLayer`/`createReferenceLayer` is now
**REQUIRED**: those functions see no project and so cannot know a good default, and making it
required is what stops the id leaking back into the UI through a future caller. Only one production
site relied on the default (LayerList's add button); every other already passed a real name.
**Verified in the browser 2026-08-17.**

**Groups have timeline rows, and the row ordering is shared (2026-08-18).** Groundwork for
transform tweening, but it stands on its own: `project.layers` is bottom-first and `project.groups`
is a PARALLEL array (membership is the back-reference `layer.groupId`), so neither describes what the
artist sees. The panel reconstructed that itself, which is why the timeline had no group rows at all
— it walked `layers` directly and consulted groups only to skip collapsed members. So **collapsing a
group removed its content from the timeline with nothing left to say it existed.**
`buildSegments` moved out of `LayerList.svelte` into pure `src/anim/row-layout.ts`, joined by
`timelineRows` (unit-tested, 10 cases). Both views build from the same function, so they cannot drift
on ordering or on which layers a collapsed group is hiding.

**The group row carries NO `data-layer-id`, and that one omission is what keeps it out of the
selection axis for free.** `layerIdAtPoint` resolves rows through that attribute via
`elementFromPoint` (with a nearest-row fallback) rather than by index arithmetic — so the marquee,
block copy/paste/move and `resolveSelectionRect` all ignore group rows without a line of new
guarding. Correct as well as cheap: a group holds no cells, so there is nothing on it to select. A
marquee dragged ACROSS a group row still spans the layers either side, via that same fallback.
Anything added to the timeline later that is not a layer should follow this rule rather than adding
guards.

Group MEMBERS are indented **16px** in the gutter, matching where the panel puts them — with a group
row now present, an un-indented member reads as the group's sibling rather than its child. **The two
surfaces use DIFFERENT CLASSES to reach the same position, which is the non-obvious part and reads
as a mismatch until you trace it:** the gutter row is `pl-4` (16px) with no list padding under it,
while the panel's `.group-members` is `pl-3` (12px) sitting on top of the list container's own `pl-1`
(4px) — 12 + 4 = 16 either way. Compare the RESULTING OFFSET, never the class value. This is the one
deliberate exception to the rule that every row starts its name at the same x; the marker column is a
separate sticky element pinned at `LABEL_W`, so it stays aligned regardless. Note the gutter's name
column can be dragged down to 80px, where 16px is a real bite out of a truncating name — accepted,
because the panel sets the convention and two views disagreeing about hierarchy is worse.

The row is a collapse toggle (chevron + name + hidden-member count), so a collapsed group is finally
visible and expandable from the timeline. Its frame strip is deliberately empty — that is where a
transform track will live. `onclick` is guarded by `panEndedWithMovement`, the same latch the ref
row's re-link button uses, so a finger scroll that happens to end on the row does not toggle it.

**Transform keys are editable, and read as the layer's own (2026-08-18).** Follow-up to the track
itself. Four changes, three of them about telling a tween apart from a drawing at a glance.
**Indent + an empty type slot:** the row mirrors its owner's indent AND reserves the same `w-3.5`
glyph slot the layer rows do — without the slot its name started 18px left of the layer's and read
as a sibling rather than as something belonging to it. **Keys are circles in the selection colour**
against the layer rows' white ◆: confusable at a glance is the only way these two ever get confused.
**The line between keys is continuous, not dashed** — a tween genuinely interpolates between its
keys, where a hold's dashes mark frames repeating one drawing; different meaning, different mark.
Both the line and the keys are ABSOLUTE over an empty cell grid, because a per-cell glyph cannot
produce an unbroken line (every cell carries its own 1px border, so adjacent segments never meet) —
and absolute positioning is also what makes a key a real hit target.
**Retiming:** drag a key to another frame (pure `withMovedTransformKey`, unit-tested). It OVERWRITES
a key at the destination, matching how a timeline block move treats the cells it lands on, and it is
one undo away. The move is always computed from the GRAB-TIME track, so dragging across another key
does not eat it in passing — only where you release. Same bracket as every other undoable drag here:
snapshot at grab, write live, commit only if the frame actually changed, `transformDragGuard.settle`
registered so an undo mid-drag cannot leave it open. `prevTrack` is a valid snapshot on its own,
because tracks are always replaced and never mutated. Finger pans, Pencil edits, per the app rule.
**Deleting** is a tap then the timeline-bar Delete key control: a tap on a key SEEKS to it, which is
exactly what "Delete key" is gated on. No new gesture, and it works with a Pencil where a hover-only
✕ would not.
**Interpolation is PER KEY, describing the segment that starts at it (2026-08-18).** It began on the
track; the artist's framing — "this move eases out" is about one stretch of it — is per segment, and
a real track wants different segments to differ: ease out of rest, hold, ease into a stop is three
segments and one track. So `TransformKey.interp?: KeyInterp` ("linear" | "hold" | "ease-in" |
"ease-out" | "ease-in-out"), absent = linear, and `TransformTrack.interp` is GONE. `sampleEvery`
stays on the track, because it is the rhythm the whole move is cut to rather than a property of one
segment. The model changed rather than gaining a second level because the branch had not shipped —
had it, this would have been a migration and a "key overrides track" rule to explain forever.

**The eases are quadratic and closed-form, deliberately.** The pressure-curve widget IS a cubic
bezier with two control points, so reusing it as a custom easing editor is tempting and genuinely a
good fit for the STORAGE. What stops it is evaluation: an easing needs `y` for a given `x`, a bezier
gives both in terms of `t`, so you either solve per sample or build a lookup table — and
`transformAt` is a pure function called once per layer per frame, so a LUT would need a cache keyed
on curve identity. Presets cost nothing and cover the workhorse cases. A custom curve can arrive as
one more `KeyInterp` member plus a stored control pair; an unknown value read from a newer file
already degrades to linear.

**The key's SHAPE says how its segment behaves** — square = hold, circle = eased, diamond = linear —
so timing is readable without selecting anything. Ease-in and ease-out share the circle on purpose:
at 8px a half-filled disc is a smudge, and the Ease control names which.

**The connecting line is drawn PER SEGMENT: solid where the value interpolates, DASHED where it
holds** — deliberately the same distinction the layer rows already draw, because it is the same
fact. A drawing hold repeats one drawing across those frames; a transform hold repeats one
transform. An earlier version omitted the line on a hold and justified it as "three marks for three
meanings"; that was wrong, and reusing the existing dash concept is both simpler and one less thing
to learn. There are two marks meaning two things.

**The key drag gained edge auto-scroll (2026-08-18)**, joining the other seven horizontal timeline
drags. Two things it needed, both established by that earlier work: the move had to SPLIT into an
event handler and a positional `keyMoveAt(clientX)` the tick can re-apply — while the pointer sits
still past an edge there are no pointermove events, so without the split the view would scroll while
the key stayed put — and `stopEdgeScroll` is paired on the SETTLE path, not on pointerup, since undo
and Open reach the settle through `transformDragGuard`. It needs NO grab-time scroll correction,
unlike the five drags that store a screen-space origin: it measures absolutely from the scroller's
rect plus its `scrollLeft`, so the measurement already moves with the content.

**Copy/paste a transform key (2026-08-18).** The key's VALUE and its segment's CURVE travel
together — pasting reproduces both, which is why `withPastedTransformKey` exists rather than reusing
`withTransformKey`: that one deliberately PRESERVES the destination's curve, because a drag rewrites
a value and not a curve. Opposite intents, so opposite functions.
Cross-layer paste is the point (matching two parallax plates to the same move), and the stored value
is layer-relative — `dx`/`dy` from the fit-centre, `scale`, `rotation` — so it transfers meaningfully
between layers of different sizes. Copy is allowed on a LOCKED or hidden layer, since a lock protects
content from being changed and copying changes nothing; paste refuses both. A paste onto a layer with
NO track is refused rather than creating one: silently starting an animation is a bigger act than the
button implies, and Animate is right there. The clipboard is session-only, like the cell and pixel
clipboards.

**Selecting the transform row selects its LAYER and sets the Transform scope to layer (2026-08-18).**
The two things you always want next, and the only reason to click that row. It deliberately does NOT
switch the TOOL: being yanked out of the brush mid-drawing to glance at a track would cost more than
it saves, and the scope is persisted state that simply takes effect the moment you do reach for
Transform. Highlight follows the OWNER (`isRowSelected(tl.id)`) rather than introducing a selection
state of its own — a layer and its track are one thing, so both rows light together. `activeRow` was
a two-case union when this was written; it is **FIVE cases now** (layer / audio / group /
layer-owned track / group-owned track — see the accessor-rule entry above for the full list and the
accessor set). The rule that matters is unchanged and still absolute: **no view may combine
`activeRow` with `activeLayerId`-derived state**; go through `active-row.ts` rather than comparing
`.kind` in a view.

**A keyed `{#each}` cannot hold a pointer capture (2026-08-18).** Reported as "I can move the key by
only 1 frame, then it stops". The markers live in `{#each keys as k (k.frame)}`, so the instant the
key changed frame Svelte destroyed the element under the pointer and built a new one — and per the
Pointer Events spec, removing the capture target from the document implicitly RELEASES the capture.
The drag went deaf after exactly one column. Worse than it looked: with a 24px cell and a 16px hit
box, the 4px either side of every column boundary is bare cell, so once capture was lost no handler
could ever see the boundary crossing — and a release on bare cell never reached the marker's
`pointerup` at all, leaving the undo bracket OPEN. A later ⌘Z would then settle that stale bracket
and roll back everything drawn since. Fixed by moving move/up/cancel to WINDOW listeners for the
duration of the drag, which is what `RefTransformGizmo`'s handle drag has always done and for
exactly this reason. **Any drag whose own target can be re-rendered by the drag must listen on
window; `setPointerCapture` is not enough.**

**Owed a browser pass:** the indent lining up with the owner; keys distinguishable from drawing keys;
the line unbroken across cell borders; drag a key onto another (the far one is replaced, one undo
restores both); drag across a third key without eating it; tap a key seeks; undo mid-drag; iPad with
a Pencil, and that a finger still pans the row.

**Deferred by this wave — decided, not forgotten:**

- ~~`ensureDrawableKeyframe` performs an UNCAPTURED structural mutation.~~ **FIXED 2026-08-16** —
  the pixel command carries the structural rider; see the entry above. The product question this was
  parked on ("does drawing on a hold now cost two undo steps?") answered itself: it costs one, and
  the ◆ goes with the drawing.
- **Export progress + cancel — SHIPPED 2026-08-17. Streaming was DECLINED, and the reasoning is the
  point.** The item was logged as one thing; a design pass split it and killed two thirds. At this
  project's scale (low hundreds of frames — the stated ceiling) a 1920×1080 line-art PNG sequence is
  ~30MB, doubling while `zipSync` builds its copy; the video path is the same order. Nowhere near a
  limit on either device, and nothing had ever failed — it was logged preventively. True streaming
  also needs somewhere to stream TO: `mediabunny.StreamTarget` and fflate's streaming `Zip` both
  exist, but the sink would be the File System Access API, which **iPad Safari does not have** — so
  the machinery would help only on desktop Chromium, i.e. not on the device this app is for.
  Revisit only if projects reach the high hundreds AND memory actually bites; the note above is the
  measurement to redo first.
  What DID ship is worth having at any length, since a 300-frame MP4 is still tens of seconds of
  apparently-frozen app: both exporters take `{ signal, onProgress }` (`src/export/progress.ts`), the
  dialog shows `Frame n of m` with a bar, and Cancel / Escape / ✕ all abort. Three details that are
  load-bearing rather than decorative:
  **(a) The loop must YIELD A MACROTASK per frame or none of it works.** Awaiting a promise that
  settles on a microtask never lets the browser paint or deliver a click, so the bar would jump
  0→100 at the end and Cancel could not be pressed. `setTimeout`'s ~4ms clamp is small beside the
  tens of ms a frame costs, and unlike a rAF yield it does not scale with refresh rate.
  **(b) The abort check sits OUTSIDE each exporter's per-frame `try`.** Inside, a deliberate cancel
  would be caught and re-thrown as "frame 42 could not be encoded" — a user action reported as a
  defect. `isAbort(e)` then lets the dialog say "Cancelled", never "Failed".
  **(c) Cancel is refused once finalising**, and the phase is NAMED in the UI. `output.finalize()`
  (and `zipSync`) is where the container is assembled; interrupting it can only produce a file we
  would discard, and without the label the bar sits at 100% looking stalled. The video path calls
  `output.cancel()` — mediabunny's own teardown, which releases the encoder and writes no file —
  never `finalize()`.
  Escape needs its OWN listener because `App.svelte`'s global handler returns immediately while
  `exportBusy` is set (the gate that stops a shortcut editing the project mid-render), which would
  otherwise swallow it. **The bar and Cancel were verified in the browser 2026-08-17.** Build+review verified — canvas, encoder and DOM throughout, with no
  node-testable surface worth inventing tests for.
- ~~"New" has no confirmation.~~ **FIXED 2026-08-17.** It was the last irreversible action reachable
  in one tap, and worse than it looked: `replaceProject` clears history, `clearAutosave` drops the
  only restorable copy and `clearAllMedia` discards the stored reference bytes, so there is nothing
  left to undo it WITH. The dialog read as a size picker — Create looked as harmless as Resize's
  button. Now `SizeDialog` forewarns inline in `new` mode and gates Create behind a native
  `confirm`, which is the pattern the destructive length-shorten already uses (Playbar/Timeline)
  rather than a second one. Declining leaves the dialog OPEN: cancelling the guard must not also
  cancel the intent. Deliberately UNCONDITIONAL — suppressing it on an "empty" project needs an
  emptiness test, and the only safe one has to inspect cell INK (a restored single blank-looking
  keyframe can still hold a drawing with no undo history behind it), which is more machinery than a
  rare action warrants and fails in the dangerous direction if it is wrong.
- ~~The play In/Out range is ignored by export.~~ **FIXED 2026-08-17.** Both exporters take an
  inclusive `range` and the dialog states it whenever it is narrower than the project — a range set
  and forgotten would otherwise silently shorten the file, so the fix is not complete without the
  line of text. **The audio was the subtle half:** `audioExportPlan` hardcoded
  `bufferOffsetForFrame(0, …)`, i.e. "the window starts at frame 0". It now takes the window's FIRST
  frame, or a range export would carry the range's pictures against the animation's OPENING audio.
  Same kept-span-vs-buffer-time care the trim work needed; 5 new tests pin it, including that
  omitting the start argument reproduces the old whole-timeline plan exactly. Output timestamps and
  PNG filenames both restart at zero/one, since an exported range is an ordinary clip, not a file
  with a hole at its head. **Verified in the browser 2026-08-17**, audio alignment included.
- ~~`evenDimensions` crops video but not PNG.~~ **FIXED 2026-08-17 — and it was worse than a
  disagreement.** Rounding DOWN silently cropped the last row/column of ARTWORK out of the video
  while the PNG sequence (no even requirement, true document size) kept it. It rounds UP now, so the
  video is padded by at most one pixel per axis and loses nothing. That padding needs a fill:
  `renderFrame` only clears and fills the DOCUMENT rect, so the pad strip would otherwise encode as
  garbage — `exportVideo` paints `bgColor` across the whole surface before each frame.
  **Verified in the browser 2026-08-17.**

**Layer transform track — animated layer transforms (2026-08-18, merged).** A drawing or reference
layer's transform can now vary over time instead of being one static value, closing the
"Transform later: animated/keyframed transforms" roadmap item. `Layer.transformTrack?: TransformTrack`
(`{ keys: TransformKey[] (sorted, never empty), interp: "linear" | "hold", sampleEvery?: number, box:
{...} | null }`) is **optional and additive** — absent means "static, behaves exactly as before",
so every existing project loads unaffected and the save-format version does not move (still `1`); an
old build opening a new save simply never reads a field it doesn't know about, and `projectToJson`/
`projectFromJson` pass it through like any other optional layer field.

> **SUPERSEDED the NEXT DAY by "Multi-property animation rows" (2026-08-18) — the TYPE SIGNATURE
> above is three ways out of date.** The field is `Layer.tracks?: LayerTracks` (a typed bag, not a
> lone `transformTrack`); `interp` moved from the TRACK onto each KEY (`TransformKey.interp?:
KeyInterp`, five presets, absent = linear) and `TransformTrack.interp` is gone; and reads go
> through the gated accessor / `resolveTrack`, not the raw field. Everything else in this entry —
> `box`, absolute rotation, the `sampleEvery` grid anchor, the `getT`/`setT` keying, the optional/
> additive persistence story — is unchanged and still current.
> **`track.box` is stored NULL for a layer track, never a frozen `transformBaseRect`.** This deliberately
> diverges from the cell/group freeze-the-pivot convention (gotcha #5): that rule exists for
> CONTENT-DERIVED boxes, which drift as you draw more: a layer's base rect is the document rect (or a
> reference's media contain-fit), and neither drifts from drawing — `resizeProject` never touches
> `transform`/`transformTrack`, so a box frozen at track-creation time would silently describe the OLD
> document size after a later resize. The gizmo instead recomputes `base` LIVE every frame via
> `transformBaseRect`, the same call the static (non-animated) path already made — animating a layer
> changes what feeds the pivot maths not at all. `box` stays a field on `TransformTrack` for a future
> group-level track, where the box genuinely would be content-derived and the freeze rule would apply.
> **Rotation interpolates ABSOLUTELY, with no shortest-path normalisation.** `lerpTransform` does plain
> `a + (b - a) * u` on `rotation` (radians), not an angle-wrapped slerp — the gizmo already accumulates
> rotation past ±360° for the static case (spin the handle twice, get 4π), and a track key just captures
> whatever that accumulated value is. Two keys 2π apart therefore hold a full visible spin between them
> rather than snapping to the "shorter" zero-rotation path a wrapped interpolation would silently
> substitute — the animator asked for two turns, not none.
> **`sampleEvery` quantises time GLOBALLY, then evaluates.** `transformAt` computes `q =
quantiseFrame(frame, first.frame, sampleEvery)` — floored onto a grid anchored at the FIRST key's
> frame, never at the segment's own start — before doing the linear lerp between whichever two keys
> bracket `q`. Anchoring per-segment would make the held step change size/phase at every key (the same
> class of bug the drawing-side "step on 2s/3s" logic already avoids); anchoring once at the track's
> first key keeps the stepping rhythm constant across the whole track regardless of where keys land.
> `interp: "hold"` skips quantisation entirely (it already reads as a step function) and MAX_SAMPLE_EVERY
> (12) is clamped in the store, not just the widget's `max=`, per the established `MAX_GAP` pattern —
> a browser accepts a typed value past a number input's advisory max.
> **Keying rides inside the gizmo's existing `getT`/`setT` pair, so no drag lifecycle changed.** The
> Frame/Layer/Group scope dispatch in `Canvas.svelte`/`RefTransformGizmo.svelte` already reads/writes
> the active transform through one `getT`/`setT` closure per scope (gotcha #6); the "layer" branch's
> `setT` now checks `layer.transformTrack` and, when present, calls `withTransformKey(track, playhead,
nt)` instead of writing `layer.transform` directly — auto-key is therefore not a new gesture or a new
> undo path, it is what the SAME drag already did, now landing in a different field. This is also why
> Apply/Reset had to gain their own guard in this task: those two actions bypass the gizmo entirely and
> write straight to `layer.transform`/bake the cells, which means nothing once a track exists — there is
> no single "the" transform to bake or reset.
> **A no-op gesture's transient key is reverted by restoring the grab-time track reference, not by
> diffing.** Both drag sites freeze `{ layer, prevTrack: layer.transformTrack }` at grab
> (`refTrackFreeze`/`trackFreeze`) the same way the existing `transformBox` freeze already captures a
> direct object ref rather than re-resolving by id at release (gotcha #6's documented reasoning applies
> unchanged: re-resolving risks a mid-gesture retarget stomping an unrelated layer's track). On an
> `isSameTransform` no-op the settle branch reassigns `layer.transformTrack = prevTrack`, discarding
> whatever key `setT` wrote mid-drag before any key even existed for the pointer-down frame — a
> click-without-move on an animated layer must not silently plant a key, matching the pre-existing
> "click-without-move pushes nothing" contract for static transforms.
> **The transform row carries no `data-layer-id`, which is what keeps it out of the timeline's
> selection/gutter axes for free.** Every layer-row gesture (marquee hit-testing, block move, the
> lock/hidden gutter marker, `TimelineSelectionBar`'s row lookup) keys off `[data-layer-id]` elements;
> the transform row is a read-only ◆-per-key strip with nothing to select or paste (a track holds no
> cells), so simply never emitting the attribute means none of that machinery has to learn a new row
> kind or a new exclusion — the row is inert to selection by omission, the same trick the group-header
> row already uses for the same reason.
> **Owed a browser pass** (Tasks 1-8 are build+review-verified per project convention; canvas/DOM has no
> node harness): Animate on a static layer starts a track at frame 0 and a first drag elsewhere tweens
> cleanly; **[SUPERSEDED 2026-09-09 — tracks now seed at the PLAYHEAD, not frame 0. See `Animating a
> property seeds its first key at the playhead` at the end of this file.]** scrubbing between keys shows the interpolated pose; Stop animating bakes the ON-SCREEN value
> (not the pre-animation one); Delete key on the last remaining key is a no-op; Hold vs Linear and
> `sampleEvery` visibly change playback; Apply/Reset on an animated layer refuse with the "Layer is
> animated" hint and leave the track untouched; the status bar names the frame a drag will key, and
> switches back to the plain hint once the track is removed; onion skins, export and the transformed-
> layer bounds hint all resolve per-frame rather than showing a stale static pose; undo/redo across
> Animate/Stop-animating/a keyed drag/Delete key/interpolation changes; a reference layer's track
> survives a re-link; iPad for the gizmo drag and the new key controls (they were in ToolOptions when
> this was written — they live on the TIMELINE TOOL BAR now, `TrackKeyControls`, single host).

**Multi-property animation rows (2026-08-18, merged).** The app went from ONE animatable property
(a layer's transform) to three — layer transform, layer opacity, group transform — each with its own
collapsible timeline row. The visible half is three rows; the half worth reading about is that the
keyframe machinery underneath was made generic first, because the day-old transform track had already
proved what happens when it is not.

**One resolver, parameterised by the only thing that actually differs.** `resolveTrack<V>(track,
frame, lerp)` is the bracket search, the `sampleEvery` quantisation, the per-key easing and the
hold-at-both-ends — everything that took real care to get right and is the fully-tested part — with
`lerp` passed in. `transformAt` and `opacityAt` are thin wrappers over it. Duplicating that skeleton
per property is the thing being avoided: two copies of a subtle bracket search do not stay equal, and
nothing fails loudly when they stop. **The evidence the extraction was safe is worth copying as a
technique:** every pre-existing `transformAt` test passes UNCHANGED apart from a mechanical field
rename, verified by normalising both revisions and diffing to zero — not by the suite merely being
green, which would also be true of a rewrite that quietly moved a boundary.

**The same argument, applied twice more — and the second one had ALREADY drifted.** Key COPYING
became `copyKeyframe`/`copyTrack`, a SPREAD and never a field list, because the worst bug in the
layer transform track was two copy sites that enumerated fields and silently dropped `interp` once it
was added, flattening every authored curve on a single undo. Key WRITING became `withKey<V>` after
the opacity path was found to disagree with the transform path already: `withTransformKey` inherits
the ENCLOSING SEGMENT's interp when a new key splits a range, while the inline opacity write
preserved interp only on an exact-frame hit. Concretely — on a track `[0: hold, 10]`, keying frame 5
left 5→10 a hard cut for a transform and silently made it a FADE for opacity. Same gesture, two
answers, one of them invented by a second implementation nobody reviewed as a second implementation.
**The general lesson: any per-property copy of a shared skeleton drifts, and the type system cannot
see it when the drifting field is optional.**

**A typed bag, not a string-keyed record.** `LayerTracks { transform?, opacity? }` /
`GroupTracks { transform?, opacity? }` — the group bag carries opacity too. A `Record<string, Track<unknown>>` reads as the more "extensible"
model and is the wrong trade here: it loses the value type at every call site and pushes casts into
the render path, in exchange for extensibility over a property set that is small and closed. Adding a
fourth property is one field.

**`box` is FROZEN for a group track and NULL for a layer track, and the asymmetry is the point.** A
group's base rect is the union of its members' content bounds at a frame, so it genuinely drifts as
the drawings change — freezing it at track creation is what stops the pivot interpolating and warping
the motion path between keys (gotcha #5, one level up). A layer's base is the document rect or a
reference's media contain-fit, neither of which drifts from drawing, and a frozen layer box would
silently describe the OLD document size after a canvas resize with no invalidation path — so the
gizmo recomputes it live, exactly as the static path always did. During implementation
`groupBoxLogical` was also made to CONSUME `track.box`; without that the field would have been dead
storage and the rationale above simply false. **If a future change stops it being read, the freeze
stops meaning anything — delete both or neither.**

**Opacity enters the render at ONE already-frame-aware site, and that is what made it node-testable
end to end.** `buildFrameDrawList` is pure and already takes `frame`, and `render.ts` is its only
production consumer, so the editor and both exporters are all covered by two adjacent lines (the draw
op and the ref op — reference layers animate their opacity too). The transform track had no such
vantage point and had to be review-verified instead. Worth naming as a property to LOOK for when
adding an animatable property: a pure choke point is the difference between a feature that is
test-verified and one that is only reviewed.

**The group sweep, and why the compiler could not help.** `groupTransform(g)` still compiles once a
track exists — it just returns the wrong answer, silently, for every frame that is not the playhead.
So 14 call sites were classified by hand. Two were real traps: the ONION path has to resolve at each
ghost's OWN frame or every ghost collapses onto the playhead's pose (an onion skin that shows the
same position three times is not obviously a bug, it looks like a still), and the SELECTION-COPY
identity fast-path would have taken the lossless cell-blit branch on an animated group where it must
take the composed one — a pixel-level wrong answer with nothing on screen to indicate it. Both are
the same shape as the three sites the previous feature shipped wrong. **A "does this look identity?"
fast-path is the first place to check whenever a static value becomes time-varying.**

**One collapse idiom, with one deliberate asymmetry.** Property rows fold under their owner using the
same chevron the group header already uses, and a collapsed GROUP hides its own track row too —
`timelineRows` already defines `collapsed` as "show me only this group's header row", so nothing new
was defined. A fresh `animateLayer` UNFOLDS its layer, because a folded track row has
no standing affordance and the new row would otherwise be invisible. `animateGroup` deliberately did
NOT, on the reasoning that a group's `collapsed` also hides its MEMBER rows and adding a row is not a
licence to undo the artist's layout — **reversed in the fix wave below, and the reversal is the right
call**: the group header carried no glyph either, so pressing Animate on a collapsed group produced
no visible change WHATSOEVER, and a button that appears to do nothing is worse than one that reveals
rows the artist can fold away again. Both actions unfold now.

**Property rows carry no `data-layer-id`, and that single omission is the entire mechanism.** The
timeline's selection axis resolves rows through that attribute, so a row without one is invisible to
the marquee, block copy/paste/move and the gutter marker for free, with no new guards anywhere.
Correct as well as cheap — a track holds no cells to select. This is now the THIRD row kind relying
on it (group header, transform row, property rows); anything added to the timeline that is not a
layer should follow it rather than adding exclusions.

~~**Each property's key controls live with that property's own authoring control** — transform and
group transform in ToolOptions at their scopes, opacity in the layer panel beside its slider.~~
**Superseded 2026-08-18:** Animate / Ease / Step / Delete / Stop moved to the timeline bar (see
the timeline-animation-tools entry below). Value authors stay put — the gizmo and the opacity slider
still write keys; only the key _tools_ moved.

**A range input needs the apply/commit split.** The opacity slider fires `input` per pixel, so
writing through a self-committing action would push ~100 undo entries per drag into a 50-command
history and evict the entire stack — the same flood already recorded for `setAnimationLength`, and
the same remedy: a non-committing `apply*` plus one bracket per gesture. **The KEYBOARD path needed
its own answer**, because arrow auto-repeat at ~30 Hz floods by the other door entirely: it settles on
`keyup`, with `blur` as the backstop.

**MIGRATION — one-way, and nothing in the app surfaces it.** `transformTrack` SHIPPED and is in real
projects, autosaves included. The loader reads both shapes and promotes the legacy field into the
bag; the writer emits only `tracks`. **Format version stays 1**, because the loader is tolerant of
both and a bump would only buy a louder failure if the loader validated the version, which it does
not. The consequence: **a build older than this release opens such a file with its animation MISSING,
and re-saving there drops it permanently.** Same shape as the 1× document-scale migration, and
accepted for the same reason — one deployed build, one user — but it has to be written down rather
than discovered, because the file opens cleanly and simply has no animation in it.

**Deferred, with reasons — these are decisions, not oversights:**

- ~~**Copy/paste of a key ACROSS property types.**~~ **DONE, not deferred** — the clipboard IS
  tagged (`KeyClipboard = { owner: "layer" | "group" } & ({ prop: "transform"; key: TransformKey } |
{ prop: "opacity"; key: Keyframe<number> })`), it carries opacity keys, and `pasteTrackKey`
  refuses a clipboard whose property OR owner kind does not match the destination. `copyTrackKey`
  switches on `prop` with a `never` arm so a third property cannot compile as a silent transform.
  Copy/Paste key are NOT transform-only.
- **`resizeProject` does not touch `track.box`.** A group whose members carry no ink freezes the
  full-document rect, so an animated empty group survives a canvas resize with a stale pivot. The
  same pre-existing hazard `g.transformBox` already has, so not a regression — recorded, not fixed.
- **A pointer drag released while an arrow key is physically held** splits one opacity gesture into
  two undo entries. Both brackets are well-formed; it needs simultaneous pointer and keyboard input
  on the same control, and the guard costs more clarity than the case is worth.
- **A hidden GROUP gets no auto-key hint.** `contextHint` returns early on a hidden layer while the
  group predicate deliberately allows a hidden group, so at group scope the bar says "Layer hidden"
  while the drag is in fact allowed and keys silently. Pre-existing precedence, now the visible edge
  of the settled locked-only asymmetry.
- **Row density.** A layer with two tracks is three rows, expanded by default. Collapsing is the
  answer; watch it on the iPad before adding a further property.

**Owed a browser pass — none of this is eyeballed.** Everything on this branch is build + review
verified only, per project convention (Vitest is node-only here, so canvas/Svelte/DOM work is never
test-verified): animate opacity and scrub a fade; a `hold` opacity segment reading as a hard cut; the
slider following the playhead on an animated layer; export matching the editor. **One undo entry per
slider drag** — the property the whole bracket exists for — then a click that writes nothing pushing
nothing, a single arrow tap being one entry, and a two-second arrow HOLD being one entry rather than
sixty. A group transform animated with a member layer also animated, composing correctly; **onion
ghosts showing distinct group poses** (the trap site); a selection copy on an animated group taking
the composed path. **A click-without-move on an unanimated layer leaving no `tracks` bag behind** (the
freeze guard). Collapse/expand, the animation icon, and the collapse state surviving a reload; a
fresh Animate unfolding a layer AND a group, and the group header's
animation glyph appearing while collapsed. Retiming a key on each row kind; a locked MEMBER
refusing a group key retime with the reason shown; deleting a key and setting `hold` on an opacity
track. **An old project with a `transformTrack` opening with its animation intact**, then re-saving in
the new shape — including a REFERENCE layer's track, which is the second loader path. Undo/redo
across every new writer; iPad for the collapse affordance, the slider as a keying control, and the
timeline-bar animation tools at Group scope. One thing to judge rather than verify, flagged as a conscious
choice: the layer disclosure sits AFTER the name while the group header's chevron sits BEFORE it.

**Fix wave from the three-lens whole-branch review (2026-08-18, same day).** Data integrity, render
correctness and interaction lifecycle, one reviewer each; several findings landed twice or three
times independently. One Critical, six Important, five Minor — all fixed. **Almost every one is the
same shape, and it is the shape to look for the next time a property set goes plural: _generalised
everywhere except here_.** The branch made tracks plural, but several sites that already handled the
transform track were never widened — and because the old code still compiles and still does
something, nothing failed. The lens generalises past tracks: after widening one site, ask what its
siblings are.

**The Critical was an undo bracket outliving the control that opened it.** The opacity slider lives
inside the active row's `{#if}`, and every settle route — `change`, `pointerup`, `pointercancel`,
`keyup`, `blur` — is bound to the input ELEMENT. A removed element fires none of them and loses its
implicit pointer capture, so a second contact selecting another row mid-drag (or the audio lane,
which deselects every layer) left `opacityUndo` open: the next slider drag saw a truthy bracket,
skipped re-opening it, and wrote its keys to the ABANDONED gesture's layer id and frame, after which
the settle compared the wrong key and either dropped a bracket whose writes had landed
(permanently un-undoable) or committed a before-state from the other gesture. It now settles on the
ROW's selection changing, plus a defensive settle when a write arrives for a different layer.
**The general rule: a gesture bracket may only be settled by events its own element receives if that
element cannot be unmounted mid-gesture.** Nothing else narrowed the window — `seekPlayhead`,
`setActiveLayer` and `commitStructural` all leave `transformDragGuard` alone.

**The frame shifter was the textbook case**, found by all three reviewers. `shiftLayerTransformKeys`
read `tracks.transform` and nothing else, so a layer's opacity fade stood still while its drawings
moved — one frame per hold-span resize / Add frame / Insert key / Duplicate frame / Delete frame /
paste-insert, silent and compounding — and `rippleDocumentFrames` never walked `project.groups` at
all. Generalised into ONE function (`shiftLayerTrackKeys`, looping `TRACK_PROPS` over a generic
`shiftTrackFrames`) so every existing call site was covered without adding one; the switch carries a
`never` exhaustiveness arm so a third property cannot arrive silently. **Group tracks shift inside
`rippleDocumentFrames` ONLY, and that asymmetry is load-bearing:** a group transform is shared by
every member, so a PER-LAYER frame tool has no single correct shift for it — the same reason those
tools leave a reference `range` alone. Only a document-wide ripple, which moves every layer at once,
has one.

**Three more "except here" sites, all data loss.** `whyNotMergeDown` gated on a transform track only,
so merging an opacity-animated layer burned its fade in at the seed alpha and took the track with it.
`rasterizeReference` refused only a transform track — but `animateLayerOpacity` has no `kind` guard
and the panel offers Animate on ref rows, so a ref could carry an opacity track that rasterizing
destroyed. And "Stop animating opacity" baked the resolved value into the static field inside
`commitStructural`, which `restoreStructure` deliberately keeps from the LIVE layer (opacity is a
view-prop) while the static slider path pushes no command — so **nothing could put that number back**:
the track came back on undo and the layer sat at whatever value it was stopped on. Fixed by restoring
the static value exactly when the animation state itself is being restored
(`!!snap.tracks?.opacity !== !!live.tracks?.opacity`), which keeps opacity a view-prop for every
unrelated undo. The transform twin was immune only because `transform` is restored unconditionally.
**A field that a bake writes cannot be a pure view-prop.**

**Two Animate buttons, one of them dead.** `animateTargetGroup` had no `kind === "draw"` gate, so a
REFERENCE group-member under Transform + Group scope rendered BOTH blocks — two identical `Animate`
buttons and two full key-control sets, with no way to tell them apart before pressing (on iPad the
tap IS the activation). The group half was inert there anyway, since the gizmo and the canvas drag
both gate their group branch on `kind === "draw"`. Related: a group's Transform row picked its
topmost member of ANY kind, so a ref there aimed the gizmo at that REF's own transform while the row
promised the group's — it prefers a draw member now, with the old lookup as the fallback.
**SUPERSEDED later in the same wave — the fallback is GONE: it picks a draw member or NONE, never a
ref** (see "Is this animated?" below). An all-ref group is reachable, and a wrong target is worse
than no target. Do not reinstate the fallback from this sentence.

**Smaller, same wave.** The group Transform row refused retiming on a HIDDEN group while ToolOptions
still deleted and re-eased those keys and the gizmo still dragged them — now lock-only, matching
`trackTarget`, `animateTargetGroup` and `activeTransformLayer` (the settled asymmetry: a hidden
MEMBER must not veto a group transform). The two new disclosure buttons routed
`pointermove`/`up`/`cancel` without a pointer-type check, so a Pencil crossing one during a finger
pan panned against the FINGER's origin and a Pencil tap killed the pan outright. The on-canvas group
drag paired a frozen `dragFrame()` transform with a live-playhead `groupBoxLogical` (benign only
because group boxes are frame-independent today — the gizmo already pairs them, so the two must not
disagree). The load sanitiser guarded `frame` and `sampleEvery` but never the key VALUE, and let a
fractional or negative `frame` through — a key that renders and that no key action can ever match,
since they all test `k.frame === playhead`. **The opacity case is the sharp one:** per spec
`globalAlpha` IGNORES a value outside [0,1] or NaN, so a bad key makes the layer paint at the
PREVIOUS draw op's alpha — a compositing bug rather than visibly bad data. Offending keys are
dropped and the existing empty-array branch collapses the track.

**Two findings recorded rather than fixed, both pre-existing and both wider than this branch:**

- **`panEndedWithMovement` stays latched for pen and mouse.** The row label button calls `touchPanUp`
  only for coarse pointers, and nothing else resets the latch — so after any finger scroll, a Pencil
  tap on a property row's NAME does nothing until some finger tap clears it. Pressing the row's empty
  strip still works, which is exactly why it reads as flaky rather than broken. The base branch's
  transform row had the same shape; this branch simply multiplies the rows it affects. The real fix
  is to reset the latch on any `pointerdown` in the grid, which touches every gesture in that file —
  out of scope for a fix wave.
- **Two elements in `Timeline.svelte` still route pointer events without a type check.** The layer
  READ-ONLY MARKER and the layer NAME BUTTON keep the ungated `onpointermove`/`onpointerup` shape
  that the fix wave corrected on the two disclosure buttons — so most elements in that file gate
  pointer type and these two do not (four gated at the time of writing, seven now; the SPLIT is the
  finding, not the count). Both predate this branch, and a mechanical pass over every gutter
  element is a different change with its own iPad verification (finger-pan vs Pencil-edit is exactly
  the behaviour a device pass exists to confirm), so they were left deliberately rather than swept in
  behind a fix wave. **Recorded because an undocumented split inside ONE file is precisely how
  "generalised everywhere except here" gets manufactured** — which is the defect class this whole
  review found. Fix them together, with a device pass, not one at a time.
- **With `sampleEvery > 1`, an authoring gesture off the grid does not put the value under the
  control.** Keys `[0, 20]`, `sampleEvery 4`, playhead 7: the writer plants a key at 7 while the
  render quantises to `q = 4`, which now brackets `[0, 7]` — so the gizmo, and far more visibly the
  slider thumb, does not track 1:1 and snaps back on release. This follows from the deliberate
  GLOBAL-grid semantics (the grid is anchored at the track's first key so the stepping rhythm stays
  constant), so the fix belongs at the AUTHORING end — snap the written frame to the track's grid —
  never in the resolver. Pre-existing with the transform track.

**Residual round on the wave (2026-08-18).** A scoped re-review confirmed all twelve findings
closed and found five Minor residuals, all fixed. Three are worth keeping.

**A short-circuiting ternary can silently drop a `$state` dependency, permanently.** M5's
`opacityFrameFor` returned the frozen grab frame before ever reading `appState.playhead`, and the
bracket fields it tests are plain `let`s — so for the whole time a gesture was open the `{@const}`
derived had no `playhead` dependency at all, and it did not come back on release: scrubbing then left
that row's thumb and its "keys frame N" title pinned to the grab frame until the row remounted, so
the next nudge started from a thumb that was lying about the current value. The fix is to read the
reactive value FIRST, unconditionally. **Any derived that conditionally reads reactive state must
read it before the condition, not inside a branch.**

**The C1 backstop moved from watching CAUSES to watching the ELEMENT.** Watching `activeRow` covered
the row's `{#if active}` but missed the list's `{#key dragNonce}` REBUILD, which fires on any
SortableJS reorder drop with `activeRow` unchanged — so holding a slider drag while a second finger
completes a layer reorder (the same two-contact class C1 exists for) still leaked the bracket. It is
now a `use:` action with a `destroy` hook on the `<input>` itself, and the `$effect` was DELETED
rather than kept alongside it: the action strictly dominates it (selection change unmounts the input
too), and two backstops for one invariant is how they drift. **A teardown hook on the element covers
every cause of removal, including the ones nobody has thought of yet; an enumeration of causes covers
the ones we listed.**

**"Is this animated?" is now one predicate.** `whyNotMergeDown` and `rasterizeReference` each
hand-enumerated the two properties — the very shape the wave had just fixed elsewhere, and a third
`TrackProp` would have reopened both defects exactly as they were. `TRACK_PROPS`/`TrackProp` moved
from `row-layout.ts` into `document.ts` (they are the model's property set, not a row order — the
frame shifter and these gates loop the same list; `row-layout` re-exports them for row-building
consumers), joined by `isLayerAnimated(layer)`. Also in this round: the group Transform row now
prefers a draw member or NONE, never falling back to a ref — an all-ref group is reachable by
grouping a draw layer with a ref, animating at group scope, then deleting the draw member, and the
fallback would have re-created I6's silently-wrong target. **A wrong target is worse than no target.**

**And one test was deleted for reading as coverage it did not provide.** The "per-layer tools never
touch a group track" case built a group object that `shiftLayerTrackKeys` — whose signature takes
only a layer — could not have reached: the assertion could not fail without a compile error first.
The asymmetry is now pinned where the mistake can actually be made, at the OPERATION level, through
`pasteBlockInsert` in `timeline-block.test.ts`; it was verified to fail against a deliberately broken
implementation before being kept. **That verification caught a second version of the same trap:** the
first draft asserted on the captured track object, which a correct shifter REPLACES rather than
mutates, so it passed against the broken build too. Assert on the LIVE project. A transform track's
frozen `box` surviving a shift (as a copy) is now pinned too — it became load-bearing on this branch
and nothing covered it.

**Owed a browser pass for the wave** (only the pure parts have tests — the generic shifter incl. the
group-vs-per-layer asymmetry, the merge gate, and the sanitiser's new rejections): drag an opacity
slider and select another row (or the audio lane) with a second finger mid-drag, then drag a second
layer's slider — keys must land on the right layer and frame; Add frame / Insert key / hold-span
resize on a layer with an opacity fade (the fade moves with the drawings); ripple insert with an
animated GROUP; merge and rasterize refusing on an opacity-animated layer; Stop animating opacity
then ⌘Z (the value comes back with the track); one Animate button on a ref inside a group; a group
Transform row aiming the gizmo at the GROUP; Animate on a collapsed group showing the glyph and
unfolding; retiming a hidden group's keys; a Pencil crossing a disclosure button mid-finger-pan. Plus, from the residual round: scrub after
releasing a slider drag that spanned a playhead change (the thumb must follow again); hold a slider
drag while a second finger reorders the layer list (one clean undo entry, and the next drag keys the
right frame); a group Transform row whose group has only reference members (selecting it must not
move the gizmo onto a ref).

**A rename is compiler-caught everywhere except the JSON boundary (2026-08-18, hotfix).** The
multi-property branch renamed a keyframe's value field `t` → `v`, and the task brief reasoned that
the rename was safe because `v` is required, so every miss is a type error. That is true of every
site the compiler can see, and false at exactly one: `project.json`. A type on a persisted shape is
an **assertion about bytes on disk**, not a fact — so the loader compiled cleanly, read `k.v` from
parent-build files that carry `t`, found `undefined`, and dropped every key through the value guard.
The emptied track collapsed to `undefined`, the project opened parked at the static `layer.transform`
(a pose the layer may never have rendered), and the next edit autosaved that over the only restorable
copy. It shipped, and was caught by an independent review after the merge.
**The migration test could not have caught it, and that is the more useful half.** The fixture helper
took a `TransformTrack`, so the already-renamed shape was the only one it could express — the tests
fabricated `v` keys, asserted the FIELD promotion (`transformTrack` → `tracks.transform`) and passed,
while the KEY shape inside it was never exercised. Typing a legacy on-disk shape as the current model
type makes the wrong fixture the only writable one. `LegacyTransformKeyJson` is now declared
separately for that reason, and the regression test hand-writes what `git show
b898b14:src/anim/document.ts` actually shipped.
**The rule: when a persisted field is renamed or reshaped, the migration test's fixture must be
written in the OLD shape, by hand, typed independently of the model — and the assertion must check a
VALUE that came through it, not merely that something survived.** A test that builds its input with
today's types is testing today's code against itself. Applies to any future `tracks` change; the
format version deliberately does not move for additive fields, so the loader is the only guard.

**Timeline animation tools (2026-08-18):** Animate / Add key / Copy / Paste / Ease / Step /
Delete key / Stop left ToolOptions and the layer-list detail row and now live on the timeline tool
bar. (They landed next to Insert keyframe; **that button has since left the bar entirely** — the
neighbours now are the frame tools that remain, so don't site anything by it.) The
Transform tool is a manipulator again (Frame/Layer/Group + Reset stay in ToolOptions); the opacity
slider still keys without a wrapping control strip. `activeRow` gained a track case
(`{ kind: "track"; owner; id; prop }`) so selecting a property row focuses that track; `animationBar`
is the one visible-set (start / keys / empty) driven by that selection. `TrackKeyControls` has a
single host — the timeline bar. StatusBar still uses `animateTargetLayer` / `animateTargetGroup` for
the idle “a drag keys frame N” hint. Spec/plan:
`docs/superpowers/{specs,plans}/2026-08-18-timeline-animation-tools*.md`.

**Group opacity track (2026-08-19):** a group fades as one thing — Photoshop-style multiply at the
draw list (`opacityAt(layer) * groupOpacityAt(group) / 100`), so editor, onion, and both exporters
share one gate. Optional `group.opacity` (absent = 100) plus `GroupTracks.opacity`; format version
stays 1. `GROUP_TRACK_PROPS` is the group twin of `TRACK_PROPS` — copy, sanitise, document ripple, and
`timelineRows` loop it; per-layer frame tools still leave group keys alone. Slider on the layer-panel
**group header**, labeled **Group**, even when collapsed (not on the timeline bar). Lock table:
static writes always allowed (view-prop); animated keys refuse when `groupHasLockedLayer` pins the
group. Animate from a selected member (timeline bar); Stop bakes the playhead value. `restoreStructure`
restores static `group.opacity` only when opacity-track presence flips — same rule as layer opacity,
so undoing Stop puts the baked number back and an unrelated undo does not revert a static nudge.
Spec/plan: `docs/superpowers/{specs,plans}/2026-08-19-group-opacity-track*.md`.

**Slim drawing-frame bar (2026-08-19):** Insert keyframe, Duplicate, and Hold left the
timeline tool strip. Keys appear by drawing on a hold (in place, clone of the held
drawing). The bar keeps Add frame (a hold after the playhead on **every** drawing
layer — same pad-with-holds as growing the global length — plus refs/audio), Clear
(blank this ◆), and Delete frame (that column on every layer). The old ripple pair
is those two actions and is gone. Delete hides while a timeline selection is up.
`insertFrameAllLayers` pads a shorter layer up to the insert column first, or the
new document frame stays empty-after-end on that row (not a hold).
`insertKeyframe` / `duplicateKeyframe` / `setHold` stay in `timeline.ts`.
A hold continues until a blank key (◇), not until the layer runs out of cells:
`resolveKeyframeIndex` and the timeline glyphs treat past-the-track as an implicit
hold of the last key. Clear (◇) is how a drawing ends.

**Playbar merged into the timeline strip (2026-08-19):** transport + In/Out sit on the
same row as Add/Clear/Delete, animation tools, trim, onion, and boil. Playback ⚙
(fps/length) is `ml-auto` at the right. The height grip is again the canvas /
bottom-chrome edge. `Playbar.svelte` is two variants (`transport` | `settings`)
mounted inside Timeline; App no longer has a separate playbar row.

**Group tracks fold like layer tracks (2026-08-19):** `LayerGroup.tracksCollapsed` hides
Transform/Opacity without hiding members. Group `collapsed` still means header-only.
Animate unfolds both. Same Spline+chevron after the name as a layer.

**References are not keyed (2026-08-19):** a reference is a guide (place + trim), not a
keyed plate. `layerAcceptsPropertyTracks` is `kind === "draw"` only — UI, Animate
actions, timeline rows, and `transformAt`/`opacityAt` all ask it, so a leftover track
on an old file is ignored. Group Animate still appears when a ref is in a group.

**Video clip source trim (2026-08-19):** a video reference can be trimmed at either end
of its timeline clip, so a long take does not have to be precut outside the app. Model
copies audio's optional `trimInFrames`/`trimLenFrames` (source frames, absent = untrimmed,
format version stays 1). **Head trim cannot reuse audio `trimHead`:** video
`startFrame = round(-offset/speed)`, so a project-frame drag Δ must do
`offset -= Δ·speed`, `trimIn += Δ·speed`, `trimLen -= Δ·speed` — same-delta would re-sync
the picture. Seek is `wanted = (trimIn + offset + frame·speed) / fps` (`videoWantedTime`);
`trimIn` is added only there, the same two-clock rule audio uses. Trim-to-playhead
follows the selected video row. One undo entry per completed handle gesture
(`beginStructuralEdit` + `setVideoTrim`); `restoreStructure` copies the trim scalars
like `offsetFrames` (in-place writes). Body slide stays non-undoable (inherited).
Dimmed pads show the trimmed-away source so a handle can be dragged back. Refs still
do not render in export. Spec: `docs/superpowers/specs/2026-08-19-video-clip-trim-design.md`.
**Verified 2026-08-19:** the user confirmed trim, sync-preserving head, and Animate-gone on
refs all work.

**Layer panel header follows the selected row (2026-08-19):** Duplicate / Merge / New group /
Delete used leftover `activeLayerId`, so selecting the audio lane or a group still mutated
the last drawing layer. `targetLayerId(activeRow)` is the layer those actions may hit
(layer or its own track; null for audio / group / a group-owned track).
`layerPanelActions` is the one enablement+title (same shape as `animationBar`);
`groupActiveLayer` reads it too so a future caller cannot regroup the leftover member.
Dimmed buttons say "select a layer first". Add layer stays live — it creates a new
drawing layer and selects it.

**Working target includes group tracks (2026-08-20):** `isGroupRowSelected()` is the
header row only, so a group Transform/Opacity track still dimmed the panel header
(via `targetLayerId`) while Toolbar/Canvas/ToolOptions/StatusBar painted the leftover
member. `workingTarget(activeRow)` is the one fact: layer (or its track), group
(header or its track), or audio. `pixelToolsDimmed`, stroke refuse, fill/deform/pose
entry, ToolOptions paint-block, and the status-bar name/hint all ask it.
`targetLayerId` is now `workingTarget` then "is it a layer?". Transform stays live
on a group (header or track); audio still blocks it.
**CORRECTED — the gizmo does NOT hide "only for audio".** It goes through the pure
`rowAdmitsTransform`/`whyRowRefusesTransform`, which has three refusals: `audio-row`,
`wrong-scope` (a group row at Frame or Layer scope aims at the remembered anchor, which
the lit row does not name) and `no-draw-member` (group scope but the anchor is a ref or
belongs to another group — a group of references has nothing to transform this way).
`Canvas.onStroke`'s group branch shares the same predicate BECAUSE the two must agree:
hiding the handles alone leaves the canvas drag reachable with nothing on screen to
explain it. Restoring "only for audio" re-opens the lit-and-refused contradiction that
`37cbf21` closed — the status bar would describe a drag that silently returns.

**Group tracks light the group header (2026-08-20):** `groupHeaderSelected` returned
early on an expanded group before seeing a group-owned track, so selecting Transform
or Opacity on a group left the layer panel with no highlight (it has no track rows).
The working target being this group (header or its track) now lights the header, same
as a layer track lighting its owner. Folded + a member selected still proxies; expanded

- a member still lights only the member.

**Three lessons from the four-lens review (2026-08-20).** Sixteen Minors were cleared alongside the
Criticals and Importants; these three are the ones worth carrying forward, because each is a shape
that will recur rather than a fact about one control.

**A selection model changes in TWO layers, and only one of them is visible.** This was the review's
dominant root cause — three of the four Criticals were this one shape, found independently by two
lenses. Six commits converted what LIGHTS UP to the new `activeRow` model and did it well; the
CAPABILITY layer — the predicates deciding what a gesture is ALLOWED to act on — kept resolving
through `activeLayerId`. So controls acted on stale targets while the correct row was lit and named:
a group of reference layers left `activeLayerId` pointing into a DIFFERENT group, and dragging moved
G2 while G1 was highlighted; select/lasso lifted and moved pixels out of a leftover layer with the
audio lane selected; the Group scope button was simultaneously lit and `aria-disabled` saying
"Active layer is not in a group". **The rule: when a selection model changes, convert the predicates
that decide what may ACT on the selection in the SAME pass as the ones that decide what looks
selected.** The compiler cannot help you here, and that is the whole trap — the old target still
resolves to something, so every call site keeps building and keeps returning a plausible answer. The
only signal is a review asking "what does this control DO on the new row kind?", control by control.
The tail of it kept surfacing all the way to the last round: `contextHint` still described a
transform gesture on group rows that had just gained two new ways to refuse one. When a predicate
gains a term, grep its NAME for readers that were written against the older, simpler version.

**A bar that hosts popovers must never become a scroll container.** The merged timeline bar gained
`overflow-x-auto` to cope with narrow viewports, and all three of its settings popovers went dark on
every device. Per CSS Overflow 3 an `overflow-x: auto` with `overflow-y: visible` computes
`overflow-y` to **auto** as well — so the bar became a ~28px scroll box, and an `absolute bottom-full`
panel sits entirely ABOVE that box, where overflow past a scroller's start edge is neither painted
nor scrollable to. Onion params and boil params have no other route, so they were simply gone. This
is the SECOND time it has been paid for here: `.curve-popup` was made `position: fixed` for the same
reason in 2026-07. The bar **wraps** instead. Reach for `flex-wrap` on any bar that owns a popover,
and treat `overflow-*: auto` on such a bar as a defect on sight — the failure is total and silent,
and it does not reproduce at desktop width.
**Record the trade the wrap makes:** on a portrait iPad the bar now runs to a second or third line
INSIDE a fixed `timelineHeight`, squeezing the grid below it. That is correct against popovers that
could not be opened at all, and the height grip is right there — but it will read as a regression to
whoever sees it next, so it is a known cost, not a bug.

**A gate threaded into every reader is not enforced.** `layerAcceptsPropertyTracks` narrowed
animation to drawing layers, and was wired into `transformAt`/`opacityAt`, into `isLayerAnimated`,
and into the UI that OFFERS animation — but not into the writers, which still read the track bag
raw. A reference animated by the PREVIOUS release therefore came back inert in BOTH properties: the
gizmo wrote keys into a track the renderer ignored, so the layer could not be moved at all and the
no-op check reverted every drag; the opacity slider pushed a real undo entry per drag and changed
nothing. And there was no way out, because the only recovery — Stop animating — lives behind a track
row a reference can no longer emit. Bytes were preserved, so it was a wrong result rather than
destruction, but on existing files with no route back. **Gate at the shared ACCESSOR, where readers
and writers meet**, not at each reader: one line at `layerTransformTrack` covers the gizmo, the
Canvas drag, `animated`, and both Apply/Reset refusals. The same review found the tail of that shape
as dead code — a "reference outside its visible range" refusal in `animation-bar.ts` that could no
longer fire, and an unreachable guard in `rasterizeReference`. The first was deleted; the second was
KEPT, because it is a call to the shared `isLayerAnimated` predicate rather than a hand-rolled
condition, so it resumes working on its own the day references become animatable again. That is the
distinction worth keeping: retire a dead REASON STRING (it misdescribes the world to the reader),
keep a dead guard that is expressed through a shared predicate (it is a correct refusal waiting for
its condition).

**Browser-confirmed 2026-08-20 (the two Criticals worth checking):** the onion, boil and playback
gears all open their popovers again — the `flex-wrap` fix works and no popover is clipped. And a
group containing only REFERENCE layers behaves correctly under the Transform tool: the gizmo hides,
and the status bar SAYS WHY rather than describing a drag that would return early. That second check
covers both halves of the fix — `rowAdmitsTransform` refusing, and `whyRowRefusesTransform` supplying
the reason it is now literally defined by.
**Deliberately NOT verified, and not worth chasing:** the past-the-end materialisation fix. A layer
shorter than the document is reachable in one gesture (a block paste that overruns grows ONLY its
target layer, and `frameCount` is `max(cells.length)` — nothing pads the rest, on paste or on load),
but it is INVISIBLE by construction: `computeTimelineGlyphs` loops to `frameCount` rather than
`cells.length` and emits a hold dash past a layer's end, so a short layer renders identically to a
full one. That is the hold-past-end rule working as intended. The only observable is what happens
when you DRAW on such a frame — the held drawing must survive with the new stroke on top of it,
where the old code planted a blank key and discarded the artwork to the end of the animation. The
unit tests pin that; a browser pass on it distinguishes almost nothing.

**All three resize grips are bare edges (2026-08-19, and a process lesson from getting this wrong on
2026-08-20).** The timeline's height grip lost its visual bar and took the same 8px hit / 4px hover
tint as the two vertical panel grips, after three iterations that went tab -> wider rounder tab ->
bare edge. The reasoning that retired the older rule: the timeline reads as a PANEL now rather than
as a divider inside one, so the "interior divider needs a badge, panel edge does not" distinction no
longer picks out anything real — and an app with two different resize affordances teaches two
conventions for one gesture. The known cost is unchanged and accepted: hover does not exist on iPad,
so none of the three has a resting affordance there; all three carry `title=`, which the status bar
surfaces on press.
**The process lesson is the more useful half.** A review flagged this as "the code and the log
disagree", and the log was followed — restoring the bar and reverting a deliberate decision made the
day before. That is backwards. **CLAUDE.md records why something WAS decided; it is not evidence
that the decision still stands.** When code and this file conflict, check which is newer and whether
the change looks deliberate: three commits converging on one answer, with a message that states the
intent ("Drop the tab. 8px hit along the top border, 4px hover tint"), is a decision — not drift for
a reviewer to correct. Ask before reverting anything this file merely fails to mention, and update
the entry instead of the code when the code wins.

**PSD export of the current frame (2026-08-24).** A fourth Export button writes the CURRENT frame as
a layered `.psd` for paint-up in Photoshop: visible drawing layers with their names and **live**
opacity, transforms **baked**, this project's groups as **real folders** via `lsct` dividers, hidden
and reference layers dropped, RLE-compressed on tight per-layer bounds, plus the merged composite
every non-layer-aware reader expects. Six modules — `packbits.ts`, `psd-bytes.ts`, `psd.ts` (the pure
writer), `psd-plan.ts`, `psd-frame.ts` (the canvas driver) and the `ExportDialog` wiring. Spec:
`docs/superpowers/specs/2026-08-24-psd-export-design.md`.

**Opacity stays live and transforms bake, and the asymmetry is the format's rather than a shortcut.**
PSD stores opacity as a per-layer byte — precisely the dial a colourist re-tunes all afternoon — so
fusing it into the pixels would take that away in exchange for nothing. There is no PSD equivalent of
`group ∘ layer ∘ cell`: no per-layer affine survives a paint stroke, so a transform has nowhere to
live but the pixels, and each layer is rendered through its full compose chain before it is read.

**The trap that the "real folders" decision created, and it is invisible when you fall into it.**
`buildFrameDrawList` PRE-MULTIPLIES group opacity into each layer's number (`opacityAt(layer, frame) *
groupOpacityAt(g, frame) / 100`) — exactly right for a flat export, and silently DOUBLE-APPLIED the
moment the group is also a real folder carrying its own opacity. Nothing fails: the file opens, every
layer is present, every name is right, and everything inside a group is merely darker than the editor
shows. So the driver reads `opacityAt` and `groupOpacityAt` DIRECTLY and never touches the drawlist's
number. Any future consumer wanting per-layer values rather than a flat composite needs the same
warning.

**A PSD group is three layers, not a container.** In file order — which is bottom-up — a hidden
`</Layer group>` layer with `lsct` type **3**, the bounding divider that CLOSES the folder and is
therefore written FIRST; then the members; then a type-**1** open-folder layer carrying the group's
name and opacity. **The folder's `lsct` payload is 16 bytes** (`type` + `'8BIM'` + `'norm'` + `u32 0`)
while **the bounding divider's is 4**, matching ag-psd (a Photoshop-proven writer) on both. Adobe
permits the short form anywhere ("the following is only present if length >= 12") and both readers
checked tolerate it, but a 4-byte `lsct` on a type-1 folder was the ONE byte sequence in our file that
no known writer emits — and since the acceptance test here is literally "does Photoshop show folders",
12 bytes to delete the only untested-by-anyone sequence was not a trade worth a second thought. **One
deliberate divergence from ag-psd, recorded so nobody "fixes" it toward it later:** our bounding
divider sets the hidden flag where ag-psd leaves it visible. Both readers key on the `lsct` type
alone, so it is not load-bearing; it is the safer fallback for a reader that ignores `lsct` entirely
and would otherwise surface a stray empty layer. It is also not the culprit if Photoshop opens flat.
Groups are single-level because the MODEL is (`LayerGroup` has no parent; layers carry a `groupId`),
so this is a flat walk — nested groups would make this the code that has to learn recursion.

**Boil is excluded, and it is the one place a PSD and a PNG of the same frame differ.** Boil
composites every drawing layer inside ONE GL surface and reads it back exactly once (iOS Safari cannot
do that per layer, so a per-layer boil means N readbacks); with the layers separate there is nothing
to bake it into, and the clean line is what paint-up wants anyway. Which is why the dialog SAYS so,
and only when boil is on — the silent difference is the defect, not the difference. Hidden layers,
layers with no ink at this frame, groups left with no surviving members, and reference layers drop out
too; visibility reads through `isLayerVisible(layer, groups)`, never the raw flag.

**Measure a length, never predict it.** `len32`/`len32Even` build a body, measure it, then write
length-then-body, and the same rule extends down to the per-channel byte lengths in each layer record
— those are the SAME OBJECTS later written, so declared and written agree by construction rather than
by arithmetic. Not fastidiousness: Photoshop answers an off-by-N anywhere with "could not complete
your request" and no indication of which section is wrong, so an analytically-computed length is a bug
you find by bisecting a binary file.

**`Bytes` writes into a growable `Uint8Array`, and the cost of not doing so was worse than it looked.**
The first version accumulated into a `number[]` and did `Uint8Array.from` in `build()`. Because
`len32` NESTS, every channel byte passed through four push-loops and four copies on the way out:
616 MB → **265 MB** peak RSS and 428 ms → **161 ms** on ten full-frame layers, with byte-identical
output against a deliberately awkward document. On the device the 1× document-scale work exists to
protect, the transient boxed array was the whole problem.

**A bonus fix, worth its own sentence.** Sharing `drawLayerCell` between the editor's compositor and
the PSD driver means `compositeFrameLayers` inherited the no-throw path for a cell with a `transform`
but a null `transformBox`. That input is named in this file's own data-loss audit (item 11) as "a
concrete reachable one" — the audit could only make the failure LEGIBLE (catch per frame, name the
frame); this closes it. Behaviour is bit-identical wherever `transformBox` is set, which is every file
the app writes.
**Why the compose chain is SHARED rather than copied**, in one line: it is the most-revised geometry
in this codebase, `tsc` would see two independently-valid call sites, no test reaches either, and the
symptom of drift would be a PSD layer sitting where the editor never showed it — found by a colourist,
not by CI.

**Two corrections the build made to its own plan, both the kind that get re-broken.** (1) The opacity
byte is **`* 255 / 100`, not `Math.round(x * 2.55)`** — `50 * 2.55` is `127.4999…` → 127, while
`* 255 / 100` gives 128, which is the mapping Photoshop's own UI uses, so 50% round-trips as 50%.
(2) A single reused scratch canvas collided with `contentBounds`' per-canvas memoisation (every layer
measuring the same canvas would have taken layer 1's rect), which is why **`boundsOfPixels(data, w, h)`
exists as an unmemoised pure core** with `contentBounds` as the memoising wrapper — and why the
tight-rect behaviour is node-testable for the first time.

**Testing is unusually good here, because the writer is pure — bytes in, bytes out, no canvas.** The
psd suite walks the output with a reader that trusts ONLY the file's own declared length fields, so a
mis-measured prefix desynchronises it into a failure rather than passing unnoticed, and the encoder is
lazy per layer (a test pins that thunks resolve exactly once AND not early — under an eager mutation
only that one test fails, which is the demonstration that the call-count tests were blind to it). The
canvas driver and the dialog stay build+review verified, per project convention.

**VERIFIED IN PHOTOSHOP 2026-08-24 — it opens and reads correctly.** That is the acceptance check
this feature was built against and could not settle itself: the group encoding is hand-derived from
the format and was only corroborated against ag-psd and psd-tools, so until a real file had been
opened in the actual application, none of the unit tests meant what they appeared to mean. In
particular the **16-byte folder `lsct`** is now known good rather than merely better-precedented, and
the diagnostic ladder below was never needed.
**What that confirmation does and does not cover.** It establishes the headline: a real export opens,
with its layers, and reads as intended — specifically **root layers and grouped layers both arriving
as expected**, which settles the first two rungs of the ladder directly. Grouped layers landing
inside folders means Photoshop consumed the type-3 bounding dividers, so the `lsct` encoding is right
in both its forms; root layers sitting correctly alongside them means the bottom-up flatten
interleaves grouped and ungrouped nodes in the right order. Those were the two most likely failures
and they are closed.
**Note what that specifically does NOT settle**, because it is one step away and easy to conflate: a
group SPLIT by an ungrouped layer is a different case. `buildSegments` emits it as **two folders with
the same name**, and a mix of root and grouped layers does not exercise it unless the project
happened to contain one. The enumerated edge cases below were NOT individually walked,
so treat them as still owed rather than as covered by this — the same distinction the audio Phase 3
entry draws. The ones most worth an eye if PSD export starts getting real use: a group split by an
ungrouped layer (it emits **two folders with the same name**), a transparent-background project
(the positive layer count makes the composite's fourth channel a spare alpha rather than
transparency), an all-empty frame (`layerCount 0` inside a non-empty layer-and-mask section), and a
PNG and a PSD of the same frame side by side, which must differ **only** by boil.
**The first three checks are in DIAGNOSTIC order** — each says where to look, not merely what to see:
(1) **folders vs flat** — if it opens flat the first suspect is the FOLDER's `lsct` length, not the
ordering, which is byte-identical to ag-psd; (2) **a visible `</Layer group>` row** means the type-3
divider was not consumed — again `lsct`, not ordering; (3) **opacity on the folder, not the members**
— "Pass Through" showing in Photoshop means the blend key defaulted, and that is the case where group
opacity may not composite as the editor does.
Then the rest: a group with a **non-identity GROUP transform** (the one path a transcription error
could reach that nothing else exercises); a group **split by an ungrouped layer** → two folders with
the SAME name, both nested correctly rather than merged or renamed; a layer whose **ink extends past
the paper edge** (the scratch is doc-sized so the PSD layer is cropped at the canvas — correct,
though a PSD layer may legally extend beyond it); **50% reading as 50%**, not 49 or 51; an **animated
group opacity at a NON-KEY frame** (the folder carries it, the members do not); **duplicate layer
names** (the app permits them); a **transparent-background project** — a POSITIVE layer count means
the composite's fourth channel is a spare alpha ("Alpha 1") rather than transparency, so this is the
input that could disagree; an **all-empty frame** (`layerCount 0`, composite only); and **a PNG and a
PSD of the same frame side by side — they must differ ONLY by boil.**

**Selection copy also writes a PNG to the SYSTEM clipboard (2026-08-24).** Ported from `slop-spine`,
which took the selection machinery from here and noticed the asymmetry: this app has always ACCEPTED
an image paste (`pasteImageReference`) but never produced one, so pixels flowed into the slop-\* apps
and never back out. ⌘C and the Copy button now fill the internal pixel clipboard exactly as before —
lossless, rect preserved, still what the internal paste uses — and additionally write `image/png`.
Cut inherits it for free, since `cutSelection` is `copySelection` + `deleteSelection`.
**The Safari constraint dictates the shape, and the natural way to write this is the broken way.**
`ClipboardItem` must be constructed SYNCHRONOUSLY inside the user gesture, carrying the blob's
PROMISE — `new ClipboardItem({ "image/png": canvasToBlobPromise })`. Awaiting the blob first and
passing the resolved value reads better and is exactly what Safari rejects, because by then the
gesture is over. So the `toBlob` promise is built un-awaited and handed straight in.
**It is best-effort, and deliberately quiet about it.** The internal copy runs first and is
synchronous, so a clipboard permission failure can never cost the artist the copy they asked for. No
`navigator.clipboard.write` (an insecure context — the LAN dev server over plain http on iPad) is
silent, because the copy DID work and only a bonus is missing. A genuine rejection sets a status hint
rather than an `alert`: the sibling `pasteImage()` in `Toolbar` does use `alert`, and that is right
there — a paste that finds nothing has to explain why the user's request did nothing — but here a
modal would interrupt a working action to report an extra that failed. Same reasoning, opposite
answer, which is why both live in the log.
**Deliberately NOT included: copying the whole frame when nothing is selected.** ⌘C with no marquee
currently does nothing under the select tools, and silently widening an established key to grab the
entire frame is a bigger change than it looks. A separate explicit action is the way to add that if
it is ever wanted.
**Owed a browser pass:** copy a selection and paste it into another app; the same on iPad, where the
gesture rule is strictest; cut then paste externally; that an insecure-context load stays silent
while the internal copy still works; and that a copy composited from a transformed or partly
transparent layer arrives looking the way it does on screen.

**The bucket has its own colour and opacity (2026-08-24).** Ported from `slop-spine`, which hit the
same shared swatch this app had: both fill sites read `brush.color`/`brush.opacity`, so crossing
between brush and bucket meant re-picking every time. In a cel-painting model — and this app has
`fillRegionBehind`, so it is exactly that model — outlines and flats are different colours by
definition. `state.fill` now carries `color` and `opacity` alongside `tolerance`/`expand`/`gap`, and
rides the existing `gatherPreferences`/`applyPreferences` spread-merge for free, so an OLD stored
preference simply leaves the new defaults in place.
**Opacity separated WITH the colour, deliberately, and that is the half worth arguing.** Separating
only the colour would have left a brush dropped to 30% for roughing silently handing that 30% to
every flat — a surprise with nothing on screen to explain it. The alternative, forcing fills opaque,
would have removed washes and tints, which are a real use. So the bucket gets its own opacity
defaulting to 100, and the two tools are now fully independent rather than half-shared.
**The ToolOptions swatch needed no new markup — it was already labelled "Fill color" while writing
`brush.color`.** The label is now true rather than aspirational, which is worth noticing as a class:
a control whose title already describes the behaviour someone intended is a good place to look for
this kind of half-finished separation.
**The eyedropper follows the tool it returns to.** `applyEyedropper` sets `fill.color` when the
pre-eyedropper tool was the bucket and `brush.color` otherwise. Routing every pick to the brush would
have made the eyedropper useless to the tool most likely to need it — you sample a flat precisely
because you are about to fill with it.
**Browser-confirmed 2026-08-24:** the two colours are genuinely separate — brush and bucket hold
their own across a tool switch — and the regrouped options row reads correctly.
**Still owed, and NOT covered by that:** the eyedropper under the bucket setting the FILL swatch
rather than the brush's (a different code path — `applyEyedropper` branches on the tool it returns
to, and nothing about the swatches being separate exercises it); a translucent fill compositing as
expected, with `fillRegionBehind` still painting behind the ink; both surviving a reload; and an old
stored preference opening with the new defaults rather than `undefined`.

**Browser-confirmed 2026-08-24 — the system-clipboard copy works: a copied selection pastes into
another app.** That is the headline for the entry above and the whole point of the port, since it is
what makes pixels flow both ways between the slop-\* apps. Not individually walked, so still owed:
the same on iPad, where the gesture rule is strictest and a failure would be silent; cut rather than
copy; and that an insecure-context load stays quiet while the internal copy still works.

**Fill options are PARAMETERS then the ACTION (2026-08-24).** Reported as "is the order optimal?"
after the bucket got its own swatch — and it was not: `Fill enclosed` sat between Gap and Opacity, so
an ACTION split the parameters into two unrelated halves and the row read as two groups that had
nothing to do with each other. It now runs Tolerance, Expand, Gap, Opacity, swatch, then the bar
language's `w-px h-5 bg-border mx-1` divider, then the button.
**The swatch staying LAST of the parameters is deliberate, not leftover.** The brush branch ends on
its colour too, so the two tool bars now finish the same way and a colour is always in the same
place. Checking the sibling before moving anything is what stopped this becoming a fix that made the
pair inconsistent — the swatch's position was never the problem.
**The general rule: in a ToolOptions branch, an action goes at the END behind a divider, never
between parameters.** Params are scanned and tweaked; an action is pressed. Interleaving them makes
neither group readable, and it is how a destructive control ends up next to a slider.

**Brush engine analysis (2026-08-29) — ANALYSIS ONLY, nothing here is fixed.** Reported as three
separate complaints; they are four defects across two engines plus one behaviour that turns out to be
worth keeping. Recorded because each was measured, and because re-deriving any of it costs an
afternoon. **All four candidates are now resolved: three LANDED and the fourth was tried and REJECTED on
measurement — see the two entries below.** Method, if it needs
redoing: drive `getStroke` with the app's own `input.ts` filter and `brush.ts` options in a node
script, and measure canvas alpha in a throwaway page in Chrome (Vitest is node-only, so the raster
half cannot live in the suite).

**ONE number is behind BOTH smooth-brush symptoms, and it is not where the labels point.**
perfect-freehand's `smoothing` is not a curve-smoothing parameter at all — it is a DECIMATION
DISTANCE. An outline point is discarded unless it is farther than `size × smoothing` from the last
kept one (`R=(r*a)**2` in the minified lib, read only by the two `y(G,q)>R` tests; `a` is redeclared
inside the loop, so that is genuinely its only use). And `brush.ts:55` passes `size: maxSize/2`, where
`maxSize = brush.size × sizeRange`. So the governing quantity is

    minDistance = (size × Press) / 2 × (Smooth / 100)

which grows with brush size, with **Press**, and with **Smooth** — and Stream does not enter it.

1. **The "big tip lags behind" symptom is that decimation, not throughput.** Up to `minDistance` of
   stroke behind the pen is drawn as a straight chord that snaps into shape only when the next point
   qualifies. Measured longest unshaped chord at the default Smooth 50: size 8 / Press 1× → 6 px;
   size 40 / Press 4× → 52 px; size 150 / Press 4× → **196 px**. There is a second size-dependent one
   in `getStrokePoints`: points are dropped until running length ≥ `size`, so at size 150 / Press 4×
   the **first 300 px of travel collapse to a single point**.
2. **The dashing is that same number exceeding the stroke's own width.** `minDistance` is computed
   from the MAXIMUM radius but applied uniformly, while the actual radius varies by `Press²` along the
   stroke. Worst reproduced case (size 40, Press 8×, Smooth 90, Stream 0): minDistance 144 px across a
   section only 21 px wide — 7× narrower than the spacing. No outline points are emitted there, both
   walls bridge it with a chord, the chords cross where the path curves, winding goes to 0, and the
   fill has a hole. **The identical path at Press 1× has zero gaps** (minDistance 144 → 18).
   A 2,880-combination sweep, gaps by parameter: Smooth `0→5 30→8 60→24 90→74 100→74`;
   Stream `0→110 30→64 60→11 90→0`; Press `1→0 2→10 4→81 8→94`.

**Stream's role is real but indirect, and two obvious explanations for it are WRONG — do not
re-investigate them.** It does not change `minDistance`, and it does not inflate the point count
(964 → 936 across its whole range, 3%). It changes whether the straight bridge is a GOOD FIT: a
jittery raw path deviates further from the chord, so the same chord both snaps more visibly and
crosses more often. Also ruled out by measurement: throughput is not the issue anywhere near desktop
— geometry JS is 0.44 ms at 3,874 points, and a full `paintStroke` frame including the 1920×1080
`putImageData` peaks at 2.6 ms of a 16.7 ms budget. It gets **cheaper** with a bigger brush
(2.6 → 0.7 ms), because a bigger brush decimates more outline points away. One further dead end: the
gaps do NOT show up if you test the raw pf polygon (0% dropout) — they only appear once you flatten
the quadratic path `getSvgPathFromStroke` actually builds. Test what is rasterised.

**The design problem worth naming:** "Smooth" is scaled by brush size, so the same slider value means
minDistance 1 px at size 4 and 150 px at size 150, and Press silently multiplies it while ALSO
creating the thin sections that turn it into holes. Meanwhile `input.ts` already streamlines the input
and `brush.ts:57` additionally hardcodes pf's own `streamline: 0.3` — two smoothing stages stacked,
one of them on a slider. The candidate fix is to decouple the decimation from the pressure envelope
(derive pf's `size` from the NOMINAL width, or clamp so `minDistance` cannot exceed the stroke's own
minimum width), which is why the sweep above is worth keeping as the acceptance test.

**Ink is clean because it has no decimation at all** — `ctx.stroke()` with round caps.

**Stamp engine (pencil/charcoal/airbrush): a hard cliff at drawSize 1, not a curve.**
`drawSize = Math.max(1, size)`, and a 64×64 tip drawn into a 1×1 box measures **alpha 0.00 for EVERY
tip, the hard round one included** — Chrome's downscale samples a couple of texels and lands in the
transparent corner. Peak alpha of one stamp at Opacity 100 / full press, by drawSize:

    drawSize |  smooth  pencil  charcoal  airbrush
           1 |    0.00    0.00      0.00      0.00   <- draws literally nothing
           2 |    1.00    0.23      0.97      0.05
           4 |    1.00    0.51      1.00      0.14
          40 |    1.00    0.67      1.00      0.28

So at size 4 / Press 4× the minimum width is 1 px and the whole lower pressure range renders NOTHING
— that is the "the smaller the brush, the harder you have to press" report, and it is a threshold
rather than a fade. A second, gentler effect stacks on it: pencil and airbrush lose ~half their
density between drawSize 40 and 4, because the grain and falloff are baked at `TIP_SIZE` 64 and
downsampling averages the peaks away (airbrush 0.05 at drawSize 2 vs 0.29 at 80, nearly 6×). Candidate
fix is a `MIN_STAMP_PX` floor of ~2 px, with `globalAlpha` scaled down when the ideal width falls
below it so thin strokes FADE instead of vanishing.

**The stamp "dashing" is a beat pattern, and there are no actual gaps.** Alpha along the centreline of
a straight stroke (Press 4×, Opacity 100): pencil at size 40 swings 0.34..0.76 (13% variation), size
12 → 8%, size 4 → 2%; charcoal 5%; airbrush 7%; smooth 0%. No pixel anywhere drops below 8% alpha, so
it is periodic BANDING — a >2× density swing — not holes. Cause: the tip is generated ONCE and stamped
repeatedly with no per-stamp rotation, scatter or jitter, so an identical grain pattern translated by
a fixed step beats against itself. It gets WORSE with size because at small sizes the same downscale
averaging that causes the density loss above also blurs the grain into a smooth blob and hides it.
Pencil is the worst of the three (one gradient with 300 holes punched in it) and charcoal the best
(20 overlapping opaque circles, which survives the beat).

> **SUPERSEDED 2026-08-29 — rotation jitter was tried and MADE IT WORSE, and the banding turned
> out not to be the reported symptom at all. See `The stamp banding is the grain` below before
> acting on this paragraph.**

**Two brush controls are DEAD on four of the five brushes.** `settings.smoothing` and `settings.taper`
are read in exactly one file, `brush.ts` — ink and the stamp engine receive them and never look at
them. **Stream is NOT one of them**: it is applied in `input.ts`, upstream of every engine, so it is
live everywhere. Size, Press, Opacity, colour and the pressure curve are live everywhere too. If
Smooth and Taper get dimmed for ink/pencil/charcoal/airbrush they want `aria-disabled` with the reason
in the `title`, per the 2026-08-12 rule — a `disabled` button dispatches no pointer events, so the
status bar could never read it out on an iPad tap.

> **SUPERSEDED 2026-09-07 — the texture this paragraph protects no longer exists, and the fix it
> warns against is now the shipped one. See `Ink: uniform translucent density, noise-proof batching,
> and Behind` at the end of this file before acting on it.**

**Ink at very low opacity reads as a felt tip, and that is DELIBERATE — do NOT "fix" it.**
`drawInkStrokeIncremental` strokes each segment separately at `globalAlpha = opacity/100` with round
caps, so a pixel covered N times accumulates `1-(1-a)^N` and the joins come out darker than the
mid-segments. Above ~60% opacity the accumulation SATURATES and the two are mathematically identical
(100% → 0.000 absolute difference, 60% → 0.022); relative contrast then climbs monotonically as
opacity falls (25% → 17%, 10% → 27%, 3% → 31%), and below ~10% the stroke is light enough that the
variation reads as GRAIN rather than as mottling on a dark line. The user judged this a good felt-tip
texture and it is being kept. The mechanism is genuinely the same one a marker has — overlapping wet
dabs building up at the joins — so this is not a defect that happens to look tolerable.
**The specific thing to guard against:** the textbook fix for per-segment compositing is to render the
stroke to an offscreen buffer at alpha 1 and blit it once at the target opacity. That is the correct
fix for the BUG reading of this code, and it would flatten the stroke to a dead uniform line and
destroy the behaviour. Anyone reading `ink-brush.ts`, seeing N `ctx.stroke()` calls each applying
`globalAlpha`, and recognising the classic double-compositing smell will be right about the mechanism
and wrong about the remedy.

**Stamp floor + dimming the two dead controls (2026-08-29).** The first two fixes out of the brush
analysis above. Both are narrow on purpose: neither changes how an existing stroke that already
renders looks.

**`stampFootprint` (pure, unit-tested, 6 cases) replaces `Math.max(1, size)` at both stamp sites.**
Below `MIN_STAMP_PX` (2) the stamp is drawn AT the floor with `globalAlpha` scaled by
`width / MIN_STAMP_PX`, so the same ink is spread over the wider box: a thin stroke now FADES where
it used to vanish outright. The floor is 2 because that is where the measurement stops reading zero
(drawSize 1 → alpha 0.00 for every tip; drawSize 2 → charcoal 0.97, pencil 0.23, airbrush 0.05), and
alpha composites linearly for a single stamp — the ga=1 and ga=0.5 tables in the entry above differ
by exactly half — so a width-1 pencil now lands ~0.12 instead of nothing. **Widths at or above the
floor are returned untouched with `alphaScale` 1**, which is what keeps every currently-visible
stroke identical; a test pins that, and another pins continuity across the floor so pressure crossing
it shows no step. Deliberately NOT changed: `stepSize` still derives from the ideal width, not the
floored one — the spacing is the artistic intent, and the alpha scaling already compensates for the
extra overlap. The eraser rides the same path, so a sub-floor eraser now erases proportionally less
rather than nothing, which is the same trade in the other direction.

**Smooth and Taper are `disabled` on the INPUT with the `title` on the LABEL.** This looks like it
contradicts the 2026-08-12 "`aria-disabled`, never `disabled`" rule and does not: that rule exists so
the status bar's delegated `closest("[title]")` listener can still read a refusal, and it is written
for BUTTONS, where guarding the handler costs nothing. A range input has no handler to guard —
`aria-disabled` alone would leave it fully draggable, promising an effect it cannot deliver. Putting
the title on the wrapping label keeps the hint reachable (the label's own text still dispatches) while
the input is genuinely inert. `aria-disabled` is set on the label too, for the dimming and for AT.
**Stream is deliberately left live on every brush** — it is applied in `input.ts`, upstream of all
three engines, so dimming it would be the false statement here.

Pure logic is unit-tested; both stamp call sites and the ToolOptions markup are canvas/DOM and are
build+review verified only, per project convention.
**VERIFIED IN THE BROWSER 2026-08-29 — the user tested all three shipped fixes and confirmed them
good.** That settles the headline of each: the stamp floor, the two dimmed controls, and the
decimation cap all behave as intended on the device, and in particular the cap does NOT visibly
damage the Smooth brush at high Press — the one trade that could only be judged by eye and not by
the sweep. The enumerated cases below were NOT individually walked, so treat them as still owed
rather than as covered by that confirmation. **Owed a browser pass:** a size-2 pencil at light
pressure now leaves a faint mark instead of nothing, and ramps continuously as you press rather than
snapping on; the same for charcoal and airbrush; a size-40 stroke looks unchanged; a thin ERASER
erases faintly rather than not at all; Smooth and Taper dim when you pick Ink/Pencil/Charcoal/Airbrush
and come back for Smooth; tapping a dimmed one on iPad reads its reason in the status bar; Stream
stays live throughout.

**The outline decimation is capped at the stroke's own thinnest width (2026-08-29).** The third of
the four candidates, and the one that fixes the measured dashing on the SMOOTH brush.
`decimationSmoothing` (pure, unit-tested) hands perfect-freehand
`min(userSmoothing, minStrokeWidth / pfSize)` instead of the raw slider value, so the outline spacing
can never exceed the thinnest width the stroke actually reaches — which is exactly the condition that
let both walls bridge a thin section with a chord and cancel the fill to a hole.
**Measured against the 2,880-combination sweep the analysis entry left as the acceptance test: gap
combinations 185 → 21, worst gap 7.3% → 0.7%, and the longest unshaped chord (the lag symptom) 208 →
97 px as a side effect.** The coefficient was chosen on evidence, not taste: capping at 0.5× or 0.25×
of the thin width fixes exactly the same 21 combinations while removing 33% and 42% of the artist's
Smooth setting respectively, against 25% for 1.0×. Same benefit, more damage — so 1.0×.
**Measuring the stroke's OWN minimum rather than `widthRange`'s theoretical `min` is what stops it
over-correcting**: a stroke that never presses lightly is never capped at all, so a constant-pressure
stroke and every Press 1× stroke are bit-identical to before. The cap is also monotonic — it can only
tighten as a stroke reaches thinner widths — so the live full redraw converges toward more fidelity
and cannot oscillate.
**The residual 21 are a DIFFERENT defect and are not chaseable here.** Five of them occur at Smooth 0,
where the spacing is 0 and nothing is dropped at all — so they cannot be decimation. They are a
self-intersecting outline cancelling under nonzero winding where the path doubles back on itself, and
they are present in the current shipped code too. Do not tune `decimationSmoothing` trying to reach
zero; it is already at the floor of what this lever can do.
**Verified in the browser 2026-08-29** along with the other two shipped fixes (see the note in the
stamp-floor entry above for exactly what that does and does not cover). Not individually checked:
that a Press 1x and a constant-pressure stroke are unchanged, which is the property the cap is
designed around and the one way it could silently bite where it should not.
There is an end-to-end regression test beside the unit tests that reproduces the worst sweep case and
walks the pen's centreline through the flattened quad path. **It asserts that the UNCAPPED value still
gaps**, which is what stops the suite going green on a broken hole-detector — and note it must flatten
`getSvgPathFromStroke`'s quadratics, because the raw pf polygon shows 0% dropout and misses the bug
entirely.

**The stamp banding is the GRAIN, and the reported stamp dashing was the drawSize cliff (2026-08-29
— fix REJECTED, and the rejection is the useful part).** Three mechanisms were tried against the
pencil/charcoal banding and all three are dead ends; recording them so nobody spends the afternoon
again.

1. **Per-stamp rotation jitter made it WORSE** — 10 of 12 measured cases up, some by +55% and +68%.
   Obvious in hindsight: the beat is a COHERENT repeated pattern whose overlaps partially self-cancel,
   and randomising each stamp's orientation replaces that with independent noise, which sums to
   HIGHER variance. Randomising a periodic artefact is not the same as removing it.
2. **Tighter stamp spacing removes the banding by destroying the brush.** Variation falls 15% → 3% at
   spacing 0.05 and → 1% at 0.03 — but mean density goes 0.859 → 0.992 (pencil) and 0.904 → 0.997
   (charcoal). It works by saturating the stroke to solid black, i.e. by deleting the texture that
   makes a pencil a pencil rather than the ink brush.
3. **Which reframes it: the variation IS the grain.** No pixel anywhere in the banding measurements
   drops below 8% alpha — there are no gaps to fix. A textured brush is supposed to vary along its
   length; that is the whole difference between it and `ctx.stroke()`.
   **What the artist was actually seeing was the drawSize cliff**, and it is already fixed. On a
   pressure-varying stroke under the old `Math.max(1, size)`, measured dead runs (alpha under 3% on the
   pen's own path): pencil size 1 → 35% of the stroke dead in 3 dashes up to 40 px long, size 4 → 10%,
   **size 8 → none**; charcoal the same. With the 2 px floor: **zero at every size.** That "small brushes
   dash, big ones don't" signature is exactly the report, and it is the same root cause as "the smaller
   the brush the harder you have to press" — one defect presenting as two symptoms.
   **So there is nothing left to fix here, and `spacing` is deliberately still 0.15.** If pencil grain is
   ever judged too coarse, the lever is the TIP TEXTURE (finer, denser grain baked at `TIP_SIZE`), not
   the spacing and not rotation — changing spacing trades texture for saturation on a fixed curve, and
   the numbers above are that curve.

> **SUPERSEDED the same day — the stamp implementation this entry describes was REPLACED by a
> swept ribbon; see "Calligraphy is swept, not stamped" at the end of this file. The nib model
> (non-uniform scale + fixed rotation, `nibSemiAxes`, long axis = full radius) survived the
> rewrite unchanged; the STAMP delivery of it, the tinted-tip flatness cache, and the
> `MAX_NIB_FLATNESS = 0.8` ceiling below did not.**

**Calligraphic brush (2026-09-03):** a 6th `BrushType`, `"calligraphy"` — a non-uniformly-scaled, fixed-rotation extension of the stamp engine (pencil/charcoal/airbrush), not a new tool or new engine. `nibSemiAxes(radius, flatness)` (`brush-textures.ts`, pure + unit-tested) is the ONE shared shape source for both the tip generator and the on-canvas cursor, so a mid-range flatness can never render one shape and preview another — a stronger form of the "gate at the shared accessor" lesson already logged elsewhere in this file. The long axis (`a`) always equals the tip's full radius regardless of flatness, which is what lets the rotated ellipse stay inside the existing `TIP_SIZE` square with no new bitmap geometry: flatness is baked into a cached tinted-tip bitmap (keyed on flatness, same cache `getTintedTip` already had for color/type); angle is NEVER baked — it is a live per-stamp `ctx.rotate()` in `stampAt`, so an Angle-slider drag costs nothing extra and only Flatness triggers a rebake.

**Two corrections made during design/implementation, worth keeping the record of.** (1) The design's first draft baked BOTH flatness and angle into the cached bitmap, drawn into a square `(drawSize, drawSize)` destination — caught in spec self-review as introducing shear (a rotated, non-uniformly-scaled source drawn into a differently-scaled destination is not the same shape), and corrected to angle-as-live-rotation before any code was written. (2) The brush cursor's CSS `transform:` order was shipped as an explicit unproven guess in the plan (`translate(x,y) rotate(deg) translate(-50%,-50%)`) with instructions to verify it in the browser; it orbits instead of spinning in place. Shipped order is `translate(x,y) translate(-50%,-50%) rotate(deg)` — a whole-branch review independently re-derived the affine composition and confirmed the box's own center is angle-invariant under this order (and is NOT under the original), so the fix is proven, not just observed.

**`MAX_NIB_FLATNESS` is 0.8, not the 0.9 first shipped — a whole-branch review caught a dashing defect the per-task reviews couldn't see.** The spec's claim that "the spacing loop itself is untouched" holds along the nib's LONG axis but not the short one: `stepSize` is derived from the nib's full (long-axis) width, but the alpha-opaque core along the SHORT axis is only `drawSize * (1 - flatness)` wide (from the tip's gradient stops, opaque to ρ≤0.85). Once `flatness > ~0.82`, dragging the pen ACROSS the nib's face spaces stamps farther apart than the core reaches, and the hairline goes visibly dashed — reachable in-range at 0.9, invisible at the 0.8 the browser passes actually exercised (Task 5 tested strokes up to 80%; 90% was only exercised for the slider readout and the cursor preview, never a painted stroke). This is the same defect family as the 2026-08-29 stamp-dashing analysis, arriving along a new axis the spacing math didn't anticipate. Fix chosen over the alternative (scaling `stepSize` by the nib's thin factor, which recovers the full 0-1 range but costs up to 10× the stamp count at 90% flatness and was not perf-measured): lowering the ceiling is a one-constant change the existing test (`nibSemiAxes(10, MAX_NIB_FLATNESS)`) and the ToolOptions slider's `max={MAX_NIB_FLATNESS}` both follow automatically, and it costs only a range nobody had yet drawn a working stroke in.

**Deferred, recorded not forgotten:** `calligraphyTip`'s antialiased edge duplicates `hardRoundTip`'s three gradient stops by hand rather than sharing a helper — currently true only by construction (not enforced), and `getTip("smooth")` (the only place they'd ever be compared) is unreachable in production, so this is cosmetic for now. The Angle readout (`{stroke.nibAngle}°`) has no `?? 0` fallback where the Flatness readout needs one (svelte-check demands it for the `Math.round` arithmetic, not for a bare string interpolation) — asymmetric but unreachable, since both fields are always defaulted and preferences round-trip through object spread (which drops `undefined` keys, never writes one). The tinted-tip cache in `brush-textures.ts` is now the first PARAMETERISED cache key in a file that previously had five fixed ones — up to 91 cached 64×64 canvases (~1.5MB) after a full Flatness slider sweep, bounded and small but the first of its kind; revisit if a second parameterised tip type ever lands.

**Owed a browser pass:** a painted stroke at the (now unreachable-by-slider, still worth confirming stays clean) 0.8 ceiling; small brush size (near `MIN_STAMP_PX`) at high flatness — the short axis has no alpha-fade floor of its own, so it likely washes out gracefully rather than vanishing, but this hasn't been eyeballed; the calligraphic ERASER under `destination-out` compositing (no task drew with it — the spec asked implementers to flag if it looked wrong, and none did, but none confirmed it looked right either); iPad density/reachability of the two new Angle/Flatness sliders alongside the rest of the already-dense brush ToolOptions row.

Spec/plan: `docs/superpowers/{specs,plans}/2026-09-03-calligraphic-brush*.md`.

**Calligraphy is swept, not stamped (2026-09-03, same day) — the stamped version shipped and it
beaded.** Reported with a screenshot: strokes came out as discrete elliptical blobs with visible gaps,
nothing like the continuous line Ink and Smooth produce. The whole-branch review had caught the
mechanism hours earlier and the fix chosen then (lower `MAX_NIB_FLATNESS` to 0.8) was calibrated to the
wrong threshold — the review computed where alpha reaches exactly ZERO between stamps, but visible
beading starts much earlier, wherever consecutive stamps' opaque cores stop overlapping generously. The
deeper problem is that no ceiling fixes this: **a stamp engine spaces its dabs by the tip's nominal
width, and a chisel nib's extent along the direction of travel COLLAPSES as it flattens — which is the
entire point of a chisel nib.** So the flatness values that make it look like calligraphy are exactly
the ones that break it, and the safe default (0.35) is barely calligraphic at all. Tightening the
spacing only trades beading for saturation (the 2026-08-29 analysis already measured that trade).

**The fix is the approach the design considered and rejected.** `src/core/calligraphy-brush.ts` sweeps
the nib instead of stamping it: per segment, fill the convex hull of the nib ellipse at both endpoints
— a quad along the perpendicular offset, plus the ellipse at each vertex, which is exactly the correct
round join for a Minkowski sweep. Continuous by construction at every flatness, the same way
`ink-brush.ts`'s stroked curve and `brush.ts`'s filled outline are. The rejection reasoning in the spec
("a whole new engine for a result approach A already produces correctly") was simply wrong on its
premise — approach A did not produce it correctly. `MAX_NIB_FLATNESS` is back up to **0.95**, and the
ceiling is now only about keeping the thinnest stroke renderable, not about spacing.
`nibSupport(a, b, angle, ux, uy)` — the ellipse's support function — is what produces the thick/thin:
sweeping across the nib's face returns ~`a`, along its edge returns ~`b`, every direction between
interpolates. Pure and unit-tested (14 cases incl. rotation, direction-reversal symmetry, and the
degenerate circle).

**The stamp engine is untouched again.** `brush-textures.ts` and `stamp-brush.ts` were reverted to
byte-identical copies of their pre-feature state (verified by diff, not by eye): no `"calligraphy"` in
`BrushType`, no `calligraphyTip`, no flatness cache key, no `stampAt`. Calligraphy is its own
`BrushKind` member beside `"ink"`, and `Canvas.svelte` gives it a full-redraw branch like smooth's
rather than an incremental one — **the whole ribbon must be ONE path filled ONCE**, or every overlap
between segments double-composites and a translucent stroke comes out blotchy at the joins.

**The subtle part, and it fails silently: every subpath must wind the SAME WAY.** The quads and the
join ellipses overlap by design, and under nonzero fill two opposite windings CANCEL. Getting it
backwards does not error or look obviously broken — it renders the stroke as a fine COMB, holes punched
at exactly the joins the ellipses exist to fill. The first implementation had it backwards (an
armchair shoelace-sign derivation, confidently wrong), and it was settled by rendering both windings
side by side rather than by more reasoning. The quad ordering is orientation-stable whichever way the
stroke runs — it is built in the (travel, left-normal) frame, which is a rotation of canvas space, and
rotations preserve winding — so a stroke that doubles back on itself unions with its own earlier
segments instead of erasing them (verified with a deliberately doubling-back path).

**Verified by rendering the real module** (imported through Vite, drawn onto a test canvas, output
measured rather than eyeballed): solid at flatness 0.95 where the stamped version dashed past 0.82; a
tight self-overlapping spiral, a doubling-back stroke, a pressure ramp and a 35%-opacity loop all
clean; and the residual edge "hairiness" visible in screenshots measured as **max 0.8–1.2px, mean
0.14–0.33px** deviation — ordinary antialiasing on a moving edge, plus JPEG artifact, not a defect.

**Owed a browser pass** — none of the below was reached, and the app-level wiring specifically was NOT
exercised end to end (synthetic pointer events never reached `setupInput`'s handler, confirmed by the
undo stack staying empty, so the `Canvas.svelte` branch is build- and review-verified only): an actual
Pencil stroke through the real pipeline; the calligraphic ERASER (`destination-out`); a translucent
stroke drawn as a real gesture (the single-fill uniformity claim); interaction with a selection clip;
and iPad, including whether the full-redraw cost per frame is acceptable there on a long stroke — the
stamped version was incremental, this one redraws the whole ribbon each frame like the smooth brush
already does.

**A flat nib amplifies input jitter, and that is a defect class of its own (2026-09-03).** Reported
from a real Pencil stroke as "the nib seems to rotate randomly": the swept ribbon was continuous, but
spikes the length of the nib crossed it at intervals, worst along the hairline sections. The nib angle
is fixed and never rotates — what jitters is the TRAVEL DIRECTION, and because the swept half-width is
the nib's support along the segment's perpendicular, a sample deviating sideways by a fraction of a
pixel swings the width between `b` and `a`. At flatness 0.95 that is a 20× jump, painted as a spike
across a hairline. **A round brush shows none of this** — its sweep is direction-independent — so this
is a hazard that only exists once a brush's footprint is anisotropic, and no amount of care in the
sweep geometry addresses it: the geometry was exactly right, and the INPUT was noisy.

Reproduced synthetically before fixing, which is what made the cause certain rather than plausible:
zero jitter renders perfectly clean, **0.4px of sample jitter already furs the edges, and 1.2px
reproduces the reported spikes**. Two dampers, both in `calligraphy-brush.ts`:

- **The normal is taken over a distance BASELINE, not from the adjacent segment** (`normals`).
  Measured in distance rather than samples on purpose — sample density swings with drawing speed, so
  a fixed sample count over-smooths a fast stroke and barely touches a slow one. The baseline scales
  with the nib's long semi-axis because that is what sets the error: an angular error of σ/L becomes a
  width error of about a·σ/L, so a baseline near `a` keeps a pixel of jitter to about a pixel of
  width. This is the load-bearing half.
- **Light centred smoothing of the sample positions** (`smoothPositions`), which removes the residual
  ~1px edge roughness the first stage leaves behind. Centred costs no lag here, because this engine
  redraws the whole stroke each frame and therefore has the later samples in hand — an incremental
  engine could not do this without trailing the pen.

**Direction smoothing does far more per unit of smoothing than position smoothing, and that is the
part worth remembering.** Position smoothing strong enough to kill the spikes (a ±4-sample window)
starts rounding real corners; stabilising the direction fixes the same spikes while leaving the path
exactly where the pen put it. Verified against a hard zigzag: corners stay crisp, with the calligraphic
thick/thin still reading correctly across them.

`normals` is exported solely so the damping is testable, and the regression tests include a **contrast
case** asserting that a narrow baseline still tilts more than 30° where a wide one stays under 12° —
without it, the test would pass against the broken implementation too, which is the trap the
2026-08-18 fixture lesson already recorded. Also covered: a fully coincident run (a held pen) and a
single-point path, both of which reach the divide-by-zero fallback.

**Still owed the same browser pass as the sweep itself** — this was verified by rendering the module
against synthetic jitter, not by drawing with a Pencil through the app.

**The calligraphy sweep was quadratic, and the join ellipses were the reason (2026-09-03).**
Reported as "slow, especially on large sizes and the longer the stroke gets" — an accurate
description of a full-redraw engine whose per-frame cost was itself O(N²). Measured before touching
anything: a single redraw took 5ms at 200 points, 92ms at 1500, **373ms at 3000, and 1663ms at
6000**. Doubling the points quadrupled the time, and that is per FRAME, so a long stroke degraded
cubically over its own lifetime.

**The cause was a nib footprint emitted at EVERY sample.** Those ellipses are large — up to `2a`
across — so at any realistic sample spacing each one overlapped dozens of neighbours, and a single
`fill()` had to resolve the winding of N mutually-overlapping subpaths. **They were never needed.**
Consecutive quads share their end edge *exactly* (same point, same normal, same offset), so the
chain TILES the ribbon with no gaps and no overlap; only the two stroke ends need a footprint, for
the angled entry/exit a flat cap would square off. Deleting the interior ones plus decimating to 3px
takes the 6000-point redraw from **1663ms to ~22ms**, and — the part that answers the actual report
— makes cost roughly FLAT in stroke length (600 pts 14ms, 3000 pts 21ms, 6000 pts 22ms) instead of
exploding.

**Decimation is free here in a way it would not be for a stamp engine.** The sweep is geometrically
exact at ANY spacing, because the quads connect consecutive nib positions exactly — decimation
coarsens the PATH, never the ribbon around it. Measured at 3px: 0.27% of the stroke's ink pixels
differ from the undecimated render, i.e. antialiasing noise. Spacing is capped at 3px and floored
relative to the nib so a small brush is not coarsened, and smoothing runs BEFORE decimation so the
dropped samples still inform the survivors.

**A single outline polygon was tried and rejected, and the reason generalises.** Walking the +offset
side forward and the −offset side back gives one subpath instead of N and is faster still — but a
self-intersecting ring CANCELS under nonzero fill, and it rendered white gashes through every sharp
corner, the caps, and the middle of a spiral. A union of consistently-wound convex pieces has no
such failure. **Speed came from removing overlap, not from merging subpaths.**

**Winding is now COMPUTED, never derived.** `addRing` measures each ring's signed area and reverses
it when negative, so mixed winding is structurally impossible. Reasoning about the sign by hand was
wrong twice in this file — first as a comb through every join, then as slivers at the caps only,
each time silently — so nothing here may emit a subpath by another route. The nib footprint is a
20-gon rather than `ctx.ellipse` purely so it goes through the same normalisation.

**Known residual, not chased:** a stroke that reverses through a full 180° leaves a speck of a
notch at the fold, where the sweep is genuinely degenerate. Still owed the same real-Pencil pass as
the rest of this engine — every number above is a synthetic benchmark, and the remaining per-frame
cost is dominated by fill AREA (22ms at size 60 vs 13ms at size 20 on a 6000-point stroke), so a
large brush on iPad is the case to watch. Going further means incremental rendering, which would
trade away the single-fill uniform alpha wherever a translucent stroke crosses itself.

**Calligraphy strokes end flush, not with the nib's footprint (2026-09-04).** Reported as "stroke
starts and ends with misrotated brush tip stamp": a thin whisker protruding from both ends of every
stroke, lying at the nib angle regardless of which way the stroke ran. It was not misrotated and it
was not a stamp — it was the nib's own footprint at the endpoint, which the true swept region
genuinely contains (a real broad-edge pen set down and lifted leaves exactly that shape). At any
useful flatness that footprint is a long thin sliver, so wherever it protrudes past the ribbon's end
it reads as a stray hair rather than as the stroke ending.

**Correct-but-wrong, so it goes.** The end footprint is dropped; a stroke now ends flush. This costs
nothing of the chisel look, because the ribbon's end cut already lands at the nib's own angle
wherever the geometry calls for it — rendered both ways in a 12-direction fan before choosing, and
the flush version is the one that reads as calligraphy. Recorded as a deliberate departure from the
exact Minkowski sweep so nobody "fixes" the geometry back.

**The dab is the one case that keeps the footprint, and the obvious guard for it is wrong.** A tap
with no travel has no ribbon at all, so its mark IS the nib footprint. Guarding that with an epsilon
(`extent < 1e-3`, i.e. testing for exact coincidence) looks right and fails on every real tap: a
Pencil jitters half a pixel or so while held, which clears the epsilon and then paints quads of
essentially zero area — **a deliberate tap left no mark whatsoever**. Found by testing a jittery dab
specifically, not an exact one. The threshold is now a real distance (`DAB_TRAVEL_PX = 2`), and the
pixel counts are pinned across exact dab / jittery dab / 1px drift / 5px / 20px / long stroke, all of
which must lay down ink.

**Calligraphy brush — VERIFIED on device 2026-09-04, and the browser-pass debt for it is closed.**
Confirmed by the user drawing with an Apple Pencil against the deployed build: strokes are continuous
with the calligraphic thick/thin reading correctly, the ends are clean, it is **fast to draw** (the
point of the perf work — cost is flat in stroke length rather than compounding, so a long stroke
stays as responsive as a short one), the **eraser** works, and **drawing inside a selection clip**
works. That covers every item this engine was owed, including the two — eraser under
`destination-out`, and the selection clip — that no synthetic test had ever exercised.

**The process lesson is worth more than the feature.** Every defect this brush shipped with was found
by the user drawing, never by my checks, and there were four: beading (stamped delivery), spikes from
jitter, quadratic slowness, and the end footprint. Each time the automated evidence was green —
1065 unit tests, a clean `svelte-check`, and rendering measured off the real module with pixel
counts. What that evidence could not reach was the app's own input path: synthetic pointer events
never arrived at `setupInput` (confirmed by the undo stack staying empty), so every check drove
`drawCalligraphyStroke` directly with synthetic point arrays. Synthetic points do not jitter like a
Pencil, do not arrive at 120Hz, and do not carry real pressure — which is precisely where three of
the four defects lived. **For canvas work in this app, a green suite plus a measured render is not
evidence the brush works; it is evidence the function works.** Say which of the two you have.

**Actual size / 100% zoom (2026-09-04).** Asked as "is there any way to reset canvas scale to 100%" —
there was not. `Fit to view` (`0`) scales to the window, which is only 100% by coincidence. Added
`viewActions.actualSize` beside `fitView` (same register-on-mount / null-on-teardown pattern, since
the `Viewport` is Canvas-local), a **View → Actual size (1)** item, and the `1` key. The digit pairing
matches Photoshop, where fit and 100% sit on adjacent digits.

**It calls `setZoom(1)`, deliberately NOT the Viewport's own `resetView()`.** `resetView` exists and
sets zoom to 1 — but it also zeroes pan and rotation, which throws the canvas to the top-left corner;
"reset the scale" should leave you looking at what you were looking at. `setZoom` zooms about the
viewport centre and does exactly that. `resetView` remains uncalled dead code, left alone rather than
deleted, and flagged here so the next reader does not wire it up by mistake.

Verified in the browser, all three paths: the `1` key restores exactly 1.0 from a fitted 0.525 and
re-centres; the menu item does the same and closes the menu; and typing "1" into a number field does
NOT zoom — the handler's existing INPUT/TEXTAREA guard covers it, which is the thing worth checking
before putting any bare digit on a global shortcut.

**Brush ToolOptions: inert controls are hidden, not dimmed (2026-09-04).** Reported from an iPad
screenshot — the brush row runs off the right edge and the far controls are uncomfortable to reach,
worst on Calligraphy, which added two sliders to an already-dense row (a density risk logged as owed
when those sliders shipped, now collected).

`Smooth` and `Taper` are read only by the perfect-freehand engine, so on Ink/Pencil/Charcoal/
Airbrush/Calligraphy they are inert. They were DIMMED with a title explaining why — about 160px spent
saying a control does nothing, pushing controls that do something off-screen. They are now HIDDEN.
That also makes the bar self-consistent: Angle/Flatness already hide when inapplicable, so the file
was applying two different rules to the same situation. **This is a deliberate narrowing of the
2026-08-12 `aria-disabled` rule, not a violation of it:** that rule governs a control that is
unavailable *right now for a reason the artist can act on* (locked layer, nothing copied yet) and
must therefore be able to explain itself. A setting that simply does not exist for the selected
engine has no such reason — absence is the clearer statement, and the dimmed control could never
become usable without changing brush anyway. Size presets also went 8 → 4 (`1 4 16 60`, spanning the
range and keeping the default); the slider and number field beside them cover everything between.

**Measured, because the point was reach and not tidiness:** the Calligraphy bar went ~1582px → 1327px
(-16%), Smooth 1200px, the stamp brushes 1024px. **It is not enough.** iPad Pro landscape is 1194px,
so Calligraphy still overflows by ~130px and portrait (834px) is far off. The bar remains
`overflow-x-auto`, which this log already records as wrong for a bar that hosts a popover — the
pressure-curve popup needed `position: fixed` to escape the clip. Parking the set-and-forget params
(Stream, Behind, Taper, curve) behind a gear, the pattern onion/boil/playback already use, is the
next step and would bring landscape inside budget; portrait needs more than that.

**Brush bar: set-and-forget params behind a gear, and the bar WRAPS (2026-09-04).** Second half of
the iPad reach fix. `Stream`, `Taper`, `Behind` and the pressure curve moved into one gear popover —
the pattern onion/boil/playback already use, and the split follows this log's own rule: *what you
adjust mid-stroke stays on the bar, what you calibrate once does not.* Size, Press, brush type,
Angle/Flatness, Opacity and the colour swatch stay out where the hand is.

Measured across the whole fix (hiding inert controls, 8→4 presets, then this): the **Calligraphy bar
went 1582px → 1147px, ‑27%**; Smooth 963px, the stamp brushes 844px. Verified at three real iPad
widths — landscape (1194) is one row for every brush, portrait (834) and split-view (744) wrap to
two, and **no control ever sits off the right edge at any width**, which is the thing that was
actually being reported.

**The container is `flex-wrap` now, not `overflow-x-auto`, and that is a correctness fix, not
styling.** Per CSS Overflow 3 an `overflow-x: auto` computes `overflow-y` from `visible` to `auto`,
so the bar was a ~40px scroll box and anything anchored to it was clipped — which is why
`.curve-popup` was made `position: fixed` back in 2026-07-12 to escape it. Adding a second popover to
a scroll container would have meant a second workaround; the container was fixed instead. The gear
panel now opens 326px below the bar, unclipped, with a plain `absolute` position and no clamping
helper (`positionPopup` is gone with it). Scrolling never made those controls reachable anyway — it
hid them behind a swipe, which is what the report was about. `.curve-popup`'s CSS in `app.css` is now
unused; left in place rather than deleted, and noted here.

**Deliberate trade:** on portrait the bar is two rows, so it costs ~29px of canvas height. That is
the same trade the timeline bar already made, and it buys every control being reachable without a
swipe. **VERIFIED on iPad 2026-09-04** — confirmed by the user on the deployed build: the bar is
comfortable to reach and the gear panel works on device. Nothing owed on this one.

**Ink brush: the edges were pixelated because each pixel was composited hundreds of times
(2026-09-07).** Reported as "the ink brush feels to have more pixelated edges than other brushes."
It did, and the geometry was never the problem — the curve it draws is unchanged by this fix.

`drawInkStrokeIncremental` issued one `beginPath()`/`stroke()` per input point. Input points arrive
far closer together than the stroke is wide (`input.ts` caps the gap at 4px, coalesced Pencil events
usually land 1-2px apart, against a typical brush width of 4-30px), so consecutive round-capped
segments overlapped their neighbours many times over. **Every separate `stroke()` composites
`source-over` onto the antialiased fringe the previous one left, and partial coverage compounds as
`1-(1-a)^n`** — so the soft edge pixels were driven to fully opaque. The antialiasing was computed
correctly and then destroyed after the fact, leaving a hard binary edge.

**Measured** (560px arc, 1.4px point spacing, soft edge px per crossing vs the same geometry stroked
once): 7% lost at width 1.5, 16% at 3, 28% at 6, 30% at 12, **36% at 24**. It scales with
width ÷ point spacing, which is exactly why it read as *fine hairline, crunchy when drawn fat*.

**The fix needs two things, and neither works alone.** (1) Full redraw from the pre-stroke snapshot,
like smooth and calligraphy — an incremental engine must flush on every pointermove or the stroke
visibly lags the pen, so it can never batch beyond the 1-3 points one event delivers (measured: a
per-call flush recovers only 44% of the gap at 2 points/call, 73% at 4). (2) Batching by width — a
full redraw alone changes *nothing*, because width varies per segment and `lineWidth` is fixed per
`stroke()`, so a naive redraw still emits one stroke per segment. Contiguous segments whose width
quantizes to the same 0.25px step are collected into one `Path2D` (`inkRuns`, pure and unit-tested,
since the run count *is* the composite count). Verified against the real shipped module in the
browser: 400 stroke calls → 167, soft edge px/crossing 4.92 → 6.71 (+36%), and an **identical ink
footprint of 17070px** — the stroke covers the same pixels, only the edge changed.

**This is the third engine to learn the same lesson**, after `brush.ts` (one `ctx.fill()` for the
whole outline) and `calligraphy-brush.ts` (built as a swept ribbon for exactly this reason). Ink was
the one that never got the treatment. Residual: consecutive runs share their joint point and overlap
there once — 7.69 measured against 8.0 for a single constant-width path, not worth chasing.

**Perf is a non-issue, measured rather than assumed:** the new ink full redraw costs 1.9-3.7ms at
1500-3000 points on a 1920×1080 cell, **2.8-5.6× CHEAPER than the smooth brush's full redraw**
(6.4-10.5ms) that already ships and is used on iPad daily, plus the ~1.3-2ms `putImageData` both
share. Mac-measured; **owed an iPad pass.**

**Found while measuring, NOT fixed, because it changes how the brush looks:** the ink **opacity
slider is effectively inert**. With hundreds of overlapping composites at `globalAlpha 0.5` the
interior saturates immediately — a 50% ink stroke rendered at alpha **253.6/255, i.e. 99.5%
opaque**. Batching improves it to 216 as a side effect of this fix (strictly closer to correct, but
translucent ink now renders slightly lighter than it did). A real fix means drawing the stroke
opaque into a scratch canvas and compositing it once at the requested alpha, which yields exactly
128 — deferred as an artistic call, not a bug call. Ink also ignores `alphaLock` and `drawBehind`,
which `brush.ts` honours; noted, not touched.

> **SUPERSEDED 2026-09-07 (same day, next commit) — all three of these are now fixed. The deferral
> held for one commit: a code review showed the batching had made the translucent case WORSE, not
> merely lighter. See the entry directly below.**


**Ink: uniform translucent density, noise-proof batching, and Behind (2026-09-07).** Three findings
from a high-effort code review of the commit directly above, all in `ink-brush.ts`. The build stays
0 errors / 0 warnings and the suite goes 1074 → 1075.

**1. Translucent ink was blotchy, and it is a different problem from the edge.** The deferral in the
entry above ("renders slightly lighter") understated it: the density is no longer *uniform*. Runs are
short along the path (~5px of arc) but the brush is 9-22px WIDE, so consecutive runs overlap over an
area about the width of the brush — not just at the antialiased fringe the batching fixed. How many
runs cover a given pixel therefore depends on **how fast the pressure is changing**: at opacity 50, a
stretch drawn at steady pressure is a single run and lands at α≈128, while a stretch where pressure
varies is covered by ~3 runs and lands at 1-(1-0.5)³ ≈ 224. Same brush, same slider, ~75% density
difference *inside one stroke*, and a mouse stroke (`sizeRange` collapses to 1, so the whole stroke is
one run) is lighter than a Pencil one. That is new — the old engine saturated everything to ~253
uniformly.

So the scratch-canvas fix is now the shipped one: when `globalAlpha < 1`, the stroke is painted opaque
onto a reused module-level canvas under the caller's transform and that canvas is composited onto the
target exactly once. Opacity 50 renders at exactly 128, everywhere. **This deliberately supersedes the
2026-08-29 "ink at low opacity is a felt tip, do NOT fix it" note**, whose reasoning no longer applies:
that texture came from the *incremental* engine's uniform per-join accumulation, which the previous
commit had already destroyed. What is left without this fix is not felt-tip grain, it is
pressure-correlated mottling. If a felt-tip ink is wanted later it should be an explicit brush
parameter, not an emergent property of the compositing.

Cost, since this is on the pointermove path: one canvas the size of the target, allocated on the first
translucent ink stroke and reused after. **The opaque case — the common one — never touches it and is
byte-for-byte the code that shipped yesterday.** Compositing happens at identity transform, which maps
scratch device pixels 1:1; the caller's selection clip is stored in device space and survives the
transform change, so it still applies.

**2. `inkRuns` batching collapsed under real Pencil noise — the fix was quietly undoing itself.**
Merging by "quantize each segment and compare" splits a run every time the width crosses a bucket
boundary, and real pressure jitters across a boundary constantly. Simulated on the measured stroke
(400 segments, size 8, size range 3) with ±0.02 of pressure noise: **219 runs, against 119 for the
same profile with no noise** — i.e. under realistic input it decays back toward one composite per
segment, which is precisely what the previous commit set out to stop. The smooth `Math.sin` profile
the tests used cannot show this.

The merge test is now HYSTERESIS: stay in the open run while the width is within one quantum of what
that run is *already stroking*. The run's own width is the anchor, so it cannot drift. Same input:
**101 runs**, and it is now insensitive to the noise rather than proportional to it. The price is that
a segment can be stroked up to a full quantum off its requested width instead of half of one — 0.25px
of width, 0.125px of edge, still under a device pixel at dpr 1, and exactly the bound
`INK_WIDTH_QUANTUM` was documented for. A noisy-profile test now pins this; the half-quantum tolerance
test became a one-quantum test.

**3. "Behind" was a silent no-op for Ink alone.** `drawInkStroke` hardcoded
`source-over`/`destination-out` and never read `settings.drawBehind` or `settings.alphaLock`, while
`brush.ts`, `calligraphy-brush.ts` and `stamp-brush.ts` all honour them and `ToolOptions.svelte` shows
the checkbox for every non-eraser brush. Ticking Behind with the Ink brush painted *over* the artwork.
Now the same composite-op ladder as the other three. (`alphaLock` has no UI today and is always
`false`, but it is one branch of the same ladder and was wired at the same time.)

**Owed a browser pass**, on top of the iPad pass the previous commit already owes: translucent ink at
a few opacities (the scratch path is the one that is new), Behind + Ink over existing artwork, and
Behind + translucent Ink together.

**Ink dwell pooling — the mark swells where the nib lingers (2026-09-07).** Grew out of the review
entry above: with translucent ink now flat by construction, the question was whether ink should get
back some of the organic variation the flattening removed, deliberately and under a control, rather
than as a compositing accident.

**The fork that decided the design:** density pooling (darker where the pen lingers) is INVISIBLE at
opacity 100, which is the default and the app's whole monochrome-ink-outline premise — it would only
ever show on translucent strokes, and it needs an extra composite pass and a silhouette clip to
avoid a halo. Width pooling (the mark gets *wider*) shows at every opacity, is closer to what ink
soaking into paper actually does, and is nearly free: it edits `widths[]` before `inkRuns` sees them,
so there is no new pass, no scratch and no composite. Width won on both counts.

**The measure is CONTACT TIME**, `width / speed` — the milliseconds the nib takes to travel its own
width. Scale-free on purpose: 40ms of contact means the same thing for a 2px hairline and a 24px
marker, where a raw px/ms threshold would pool a fat brush constantly and a thin one never. Below
40ms nothing pools; at 200ms+ the swell is full; `pool` (0-100) scales it, reaching 1.75× width at
100. All four constants are first guesses, tunable after a browser pass.

> **SUPERSEDED 2026-09-07 (same day) — the contact-time measure was WRONG, and this paragraph's
> confident "scale-free on purpose" is the error. See `Dwell pooling triggers on pen speed` below.**

**Speed is averaged over a window measured in MILLISECONDS, not in neighbouring samples**, and that
is the load-bearing choice rather than an implementation detail. A neighbour-count window narrows as
the Pencil samples faster, so the same stroke drawn at the same speed would pool differently at
120Hz and 240Hz — the exact sample-rate dependence `inkRuns` has now been fixed for twice. A test
pins it: the same path sampled twice as finely must produce the same widths. Interpolated points
(`input.ts` fills spatial gaps over 4px) carry interpolated timestamps, so they change the point
density without touching the time density and the measure is unaffected.

**Deliberately capped at 1.75×.** Real ink keeps spreading for as long as the nib rests; this stops.
An unbounded blob growing under a hand that paused to think is a footgun, not a feature — this is
the one place the effect chooses against realism on purpose.

**Default 0, so nothing changes until the slider moves** — every existing stroke renders identically,
and at 0 the function is a single comparison and an early return. The control is a 0-100 slider in
the brush gear panel, shown only for the ink engine (the `40899f0` convention: controls that are
inert for the selected engine are hidden, not dimmed). Calibrate-once params live behind the gear
rather than on the bar, per `bbd227d` — the iPad brush row has no spare width. `dwellPool` is
optional on `BrushSettings` beside `nibAngle`/`nibFlatness`, so it persists for free via
`Preferences`' whole-`ToolSettings` store and older stored prefs keep the default under
`applyPreferences`' spread merge. Brush settings are not part of the project file, so the save format
is untouched. It applies to an ink ERASER too, which has its own independent value — pooling is a
width effect and nothing about it is ink-specific once the engine is.

Cost is not literally zero and should not be described as such: the swell adds width variation, so
`inkRuns` emits a few more runs on a slow stroke. That is bounded by the same hysteresis that
handles pressure variation. The detector itself is O(n) with a window of ~4-8 points (bounded by the
clock, not by how slowly the pen moves) — measured at 0.024ms for 3000 points, against the ~0.33ms a
self-crossing detector would have cost and the 5.1ms a naive O(n²) one would.

Six pure tests, written first and watched fail. **Owed a browser pass, and it is the whole point of
the feature:** whether this looks good at all is the open question, and `pool` 0 remains a real
answer.

**Dwell pooling triggers on pen speed, not contact time (2026-09-07).** First iPad pass on the
feature above came back as *"feels too subtle — actually I can't tell if it's on all the time or not
at all."* Those are two halves of one root cause, and neither is a tuning problem, so bumping the
swell (which is what was asked for) would have fixed nothing.

**The measurement that found it.** Mapping the shipped model's response across realistic pen speeds
(0.03-3 px/ms) and brush widths: at **size 4, the default, every realistic drawing speed gives dwell
0.00** — you have to creep at 0.03 px/ms before anything fires. At **size 60, dwell is already 1.00
at normal drawing speed**, so the whole stroke swells uniformly and reads as nothing but a fatter
brush. Never-on and always-on, in the same feature, decided by the size slider.

**Root cause: `tCross = width / speed` makes the trigger speed PROPORTIONAL TO BRUSH WIDTH.** It
ranges from 0.02 px/ms on a hairline to 4.5 px/ms on a size-60 brush — a 225× spread — against real
drawing speeds of roughly 0.1-3 px/ms. For thin brushes the trigger sits below that entire range;
for fat brushes, above it. **There is no brush size at which the effect discriminates.**

The original reasoning ("contact time is scale-free, a raw px/ms threshold would pool a fat brush
constantly and a thin one never") had it exactly backwards, and the inversion is worth keeping:
contact time IS the right physics — a wide nib really does rest on a given spot longer — but it is
the wrong CONTROL, because it makes the effect answer to which brush you picked rather than to how
you moved. A tool control has to be learnable before it has to be physical.

**Fix: trigger on absolute pen speed** (document px/ms), unnormalised. Nothing pools above 0.3 px/ms,
full swell at or below 0.03 — chosen against measured speeds (ordinary stroke ~0.6, quick ~1.5,
deliberate ~0.25, creep ~0.03), so an ordinary stroke is untouched at any brush size and a deliberate
slowdown pools at every brush size. The swell MAGNITUDE stays proportional to width (a hairline
gaining 8px would be absurd); only the trigger is absolute. `MAX_DWELL_SWELL` also went 0.75 → 1.0
(2× at pool 100) since the effect was reported as too weak, but that was the lesser half of the fix.

> **SUPERSEDED 2026-09-07 — the swell is no longer a multiplier. See `Dwell pooling swells as the
> square root of the nib width` below; 2× now holds only at the 4px reference width.**

**The old tests all passed under both models** — they used speeds of 2 px/ms against 0.005, so
extreme that width normalisation never showed. Three new tests pin the actual property: the swell
factor is the same at width 2 and width 40 for the same motion; an ordinary 0.6 px/ms stroke is
untouched at every size; and a 0.1 px/ms slowdown pools at the DEFAULT size, which is the case that
was silently dead. Watched all three fail first, with the predicted numbers (1.00× vs 1.75×; a
size-40 brush swelling to 45 at ordinary speed; a size-4 brush flat at 4.0 through a slowdown).

**Ink dwell pooling had never once run — `Canvas.svelte` dropped the field (2026-09-07).** Reported
twice as "can't feel any difference", through two rounds of tuning. Both rounds were spent adjusting
a code path that was never reached.

`Canvas.svelte:677` built the engine-facing `settings` object by **hand-listing every
`BrushSettings` key**. `dwellPool` was added to `BrushSettings`, to the state defaults and to the UI,
and not to that list — so `settings.dwellPool` was `undefined` on every stroke, `?? 0` turned it into
0, and `dwellSwell` early-returned every time. The feature shipped, merged, deployed and got tuned
twice while being dead code.

**Nothing catches this.** `ToolSettings` is a superset of `BrushSettings`, so the object type-checked
with the key missing; `svelte-check`/`tsc` were clean; `dwellSwell` was unit-tested in isolation and
passed; and the defect site is a `.svelte` component, which this project cannot node-test at all.
The only detector was the user's eyes, twice.

**Fix: spread, never hand-list** — `{ ...stroke, isEraser: ... }`. It cannot drop a field again, it
is shorter than what it replaced, and the extra `ToolSettings` keys (`brushType`, `sizeRange`,
`streamline`) are ignored by every engine except the stamp path, which already re-specifies
`brushType` itself. **Any future brush parameter is now wired by construction.** This was the ONLY
site in the codebase that built a `BrushSettings` (checked), so there is no second one to fix.

**The debugging lesson, which cost two deploys:** the pen-speed rewrite in the entry above diagnosed
a real defect — the brush-size coupling is genuinely broken and the measurements proving it stand —
but it was NOT the cause of the reported symptom, because the model it fixed was never invoked. A
plausible mechanism that explains the symptom is not the same as a verified one. The value should
have been traced from the UI to the engine BEFORE the model was touched; one grep of the call site
would have found it in seconds. Both changes are keepers, but they were made in the wrong order.

> **RESOLVED 2026-09-07 (later the same day) — verified in Chrome, see the next entry, which also
> records the harness recipe that made the scripted-input attempt below work.**

**Still owed a browser pass, and this time it has never had one that could have succeeded.** An
attempt to verify on the dev server with synthetic `PointerEvent`s failed: `setupInput` binds to the
stage and calls `setPointerCapture(e.pointerId)`, which throws `NotFoundError` for a synthetic
pointer id and aborts the handler before drawing begins, so nothing is painted. Patching that in the
page got past it but the run then timed out twice, and the attempt was abandoned rather than
rabbit-holed. Noting the mechanism because it will defeat the next attempt to script this app's input
the same way.

**Ink dwell pooling VERIFIED in the browser (2026-09-07).** After the wiring fix above, the feature was
driven end to end on the dev server in Chrome — through `setupInput`, `Canvas.svelte`, the engine and
the composite — with pen-type pointer input at controlled speeds, and measured on the paper canvas.
Size 12, pressure 0.5, size range 2.5 (nib 17.4px):

| stroke | Pool | measured thickness | engine factor |
|---|---|---|---|
| slow, 0.05-0.1 px/ms, streamline 0 | 100 | **32-36 px** | 1.92-2.00 |
| fast, 0.9-2.0 px/ms, streamline 0 | 100 | 18 px | 1.00 |
| slow, 0.05-0.1 px/ms, streamline 0 | 0 | 18 px | 1.00 |
| slow, 0.1 px/ms, **streamline 50** | 100 | **30-32 px** | 1.95 |
| fast, 2.0 px/ms, streamline 50 | 100 | 18 px | 1.00 |

Exactly 2× on a slow stroke, untouched on a fast one, off at Pool 0, and the default streamline (50)
does not dampen it. Real mouse strokes drawn by hand in the same tab during the run showed the same
thing unprompted: a vertical stroke with a blob at each end (pen-down and lift are slow) and a thin
middle. **The code on `main` since `fac43c7` works.** Anyone still seeing no effect is running a
build from before that commit — the iPad PWA / Safari caches `index.html`; fully close the app or
clear the site's data and reopen — or is drawing on a layer that cannot show it (this project's
autosave had Layer 1 active inside Group 1 whose opacity track sits at 0 on frame 1, which hides
EVERY stroke, not just pooling).

**Harness recipe, because the first scripted attempt failed and the second nearly did:**
1. `Element.prototype.setPointerCapture = () => {}` (and `releasePointerCapture`) in the page —
   `setupInput` captures on the stage and a synthetic `pointerId` throws `NotFoundError` before
   `isDrawing` is set. Patch the page, never the app.
2. **Pace events with a busy-wait, not `setTimeout`.** Chrome throttles background-tab timers to
   ~1/s, so a 40-step stroke at 16ms took 40+ seconds and blew the CDP 45s budget — that was the
   "renderer frozen" timeout, twice. `while (performance.now() < until) {}` is immune.
3. Dispatch `PointerEvent`s with `pointerType: 'pen'`, `pressure`, `isPrimary`, `bubbles` on the
   paper canvas (they bubble to the stage). `e.timeStamp` is browser-assigned at construction, so
   real pacing yields real speeds.
4. `recomposite` rides `requestAnimationFrame`, which does not fire in a background tab: take a
   screenshot (foregrounds the tab) before reading pixels, or nothing appears to have been drawn.
5. `await import('/src/state/appState.svelte.ts')` in the page returns the app's own module
   instance under Vite dev — read `state.brush` and set `state.activeLayerId` directly rather than
   scripting the layer panel. Check the active layer is drawable AND visible at the playhead.
6. Measure thickness on `canvas.touch-none` (the paper, 2D) by colour distance from the corner
   pixel, not by alpha — the paper is opaque.

**Dwell pooling swells as the square root of the nib width (2026-09-07).** First real iPad pass of
the working feature: *"looks ok around brush size 3-5, too little with size 1 and too much after 10
or so."* That is a precise description of a multiplier — the swell was `w × (1 + strength·dwell)`,
so the added ink was LINEAR in width: +1px on a 1px hairline (invisible) and +20px on a 20px brush
(a bulb).

**The fix is the physical law, not a fudge.** Pooled ink is a fixed extra VOLUME spreading into a
disc; a disc's radius goes as the square root of its area; the nib delivers ink in proportion to its
width — so the extra radius goes as **sqrt(width)**. Now `pooled = w + strength·dwell·sqrt(w·4)`,
anchored at `POOL_REF_WIDTH = 4` so a 4px nib still exactly doubles (the size the user said looked
right). A 1px nib triples, 8px gains 1.7×, 16px 1.5×, 40px 1.3× — thin brushes get a visible blob,
fat ones a swell instead of a bulb. **The anchor is the single tuning knob**; the curve handles the
rest. Rejected: a log curve (compresses fat brushes harder still, no physical story) and `a + b·w`
(two constants, the same tuning problem in two places).

Trigger (pen speed), cap, Pool slider, cost: all unchanged — one `Math.sqrt` in the existing loop.
The verification table in the entry above was measured under the multiplier (17.4px nib → 32-36px);
under the sqrt law the same stroke should measure ~25.7px (1.48×). Tests: the cap expectation
became `w + sqrt(4w)`; the size-independence test now pins the actual spec (same TRIGGER at every
width, added ink normalised by sqrt(w) identical); two new tests pin the law itself (a 16px nib
gains exactly twice a 4px nib, a 1px nib exactly half) and the anchor (2× at the reference width).
Watched all four fail first — the linear law gave the 16px nib 4× the 4px nib's gain.

**VERIFIED on iPad 2026-09-08** — confirmed by the user on the deployed build: the swell reads
right across the size range, so `POOL_REF_WIDTH` 4 stands as shipped and the anchor did not need to
move. That closes ink dwell pooling: trigger (pen speed), curve (sqrt of nib width), cap and control
are all settled and eyeballed. Nothing owed.

**Brush bar fits a 12.9" iPad in portrait again (2026-09-08).** The nine size presets (2026-09-07)
pushed the bar past the 1024px portrait viewport: Smooth wrapped its colour swatch and Calligraphy
wrapped Opacity + gear + swatch. Measured on the deployed build rather than guessed — every
component's width at desktop, summed: Smooth ended at **1051px**, Calligraphy at **1234px**, against
1024. (Calligraphy had already been wrapping before the presets, at ~1134; the presets made Smooth
wrap too.) The fat was two BROWSER-DEFAULT sliders: Size and Press were 129px each — not a design
choice, just `<input type=range>`'s default — while every other slider on the bar is a deliberate
64px.

Three changes, all measured: (1) Size and Press sliders get `w-24` (96px), −66px, consistent with
the rest of the bar and still comfortable under a Pencil; (2) preset spacing `gap-0.5`→`gap-px`
and `px-1`→`px-0.5`, −30px, buttons still ~18px wide on a 28px row; (3) **nib Angle and Flatness
move into the gear panel**, calligraphy-only, exactly like Pool for ink — −287px, and the only
change that makes Calligraphy fit at all (it would still end at ~1138 after 1 and 2). It follows the
gear's own rule from `bbd272d`: what you adjust mid-stroke stays on the bar, what you set once does
not, and a nib is set per nib. The user weighed the two extra taps and chose this.

Result: Smooth ends at ~955, Ink ~935, Calligraphy ~835 — all inside 1024 with ≥70px spare. **Honest
limit:** an 11" iPad in portrait is 834px and Smooth would still wrap there; this fixes the 12.9".
**VERIFIED on iPad 2026-09-08** — confirmed by the user on the deployed build: no wrapping in
portrait for Smooth or Calligraphy, and Angle/Flatness are reachable in the gear. The arithmetic
above was from measured widths rather than a portrait render (the test window would not resize below
the desktop), so this confirmation is what actually closes it. The 11" limit noted above is untested
and still stands as a prediction.

**Groups drag-reorder in the layer panel (2026-09-08).** Asked for as "any chance to dnd order
change?" — and the answer was that ONE element was missing, not a feature. The root SortableJS
instance requires `handle: ".layer-drag-handle"` and the group header had none, so a `.group-block`
was a valid Sortable item that could never be grabbed. The reorder plumbing was already group-aware:
`rebuild` walked group blocks and emitted their members contiguously, and `reorderLayersWithGroups`
takes `{id, groupId}[]`. **No data-model change was needed.**

Three parts, `LayerList.svelte` only. (1) A `.layer-drag-handle` grip on the group header, in the
same column as the layer grips. It sits on the header, NOT inside `.group-members`, so the inner
Sortable never sees it and the two instances cannot fight over the gesture — the same nesting rule
that already makes member rows work. A collapsed group drags as one unit for free, because its
members stay in the DOM under `hidden` and `rebuild` still walks them. (2) `membersSortable` gets
`group: { name: "layers", put: (_to, _from, el) => el.dataset.groupId == null }` — root and members
share the "layers" group so rows cross between them, but a group header is a root item now and
`layer.groupId` is a single id with no representation for a group inside a group. (3) `rebuild`'s
two-level walk became a flat `querySelectorAll("[data-layer-id]")` + `closest("[data-group-id]")`.
Shorter, and it closes a **silent data-loss** path that (1) would otherwise have made reachable: the
old walk read a group block's members as `data-layer-id`, so any non-layer child yielded
`Number(undefined)` = NaN, `byId.get(NaN)` = undefined, and those layers vanished from the rebuilt
array. (2) should make it unreachable; (3) makes it impossible.

**Free:** undo (`reorderLayersWithGroups` already brackets `beginStructuralEdit`/
`commitStructuralEdit`), its no-op guard, `nonEmptyGroups` pruning, and the timeline gutter — it
builds from the same `row-layout` module.

**Verified in Chrome, except the grab gesture.** Both headers render a grip; the new flat walk
reproduces the live model exactly against real markup (`walkMatchesModel: true`). Relocating a
`.group-block` the way SortableJS does, then running `rebuild`'s exact walk through
`reorderLayersWithGroups`, moved Group 2 above Group 1 with members intact (g44 [40,45], g46
[42,41]), no layers lost, the re-rendered DOM matching, **and the timeline gutter following on its
own**. The order was restored afterwards. What could NOT be verified this way is SortableJS's own
grab: on desktop it uses native HTML5 drag-and-drop, which CDP mouse events do not trigger — a
`left_click_drag` on the grip left the order untouched and proves nothing either way. iPad uses
SortableJS's pointer fallback, a different path again. **VERIFIED on iPad 2026-09-08** — confirmed by the
user on the deployed build: the grab works and groups reorder. This was the one part the Chrome run
could not reach, so the user's confirmation is the only evidence that path has ever had. Nothing
owed.

**A `warn` role, and the amber was unreadable in the default theme (2026-09-08).** First step of
aligning the slop apps on `/Users/meigo/Projects/slop/SLOP-TIMELINE-UI.md` — the shared visual
language that `slop-audio-editor` and `slop-video-compositor` already follow. That document names
this app as a deliberate divergence (light-first, `.dark` class, `@theme --color-*`), so what is
shared is the ROLE NAMES, never the hex values.

**Only one role was earned.** The document defines `danger`, `warn`, `ok` and `disabled`; a survey
found consumers for exactly one. There is no red and no green anywhere in the components, and
`disabled` is not a colour here — it is `aria-disabled` (110 uses) plus `opacity-40` (31). Adding
the other three would have put dead tokens in the theme. They can arrive when something needs them.

**The real find was an accessibility bug, not a naming gap.** `text-amber-500` was hard-coded in 9
files (15 uses) and is **2.15:1 on white** — WORSE than the `#999` that `app.css`'s own comment
rejects as unreadable at 2.85:1 — and this app is light-first, so that was the DEFAULT experience.
Every other token in that file carries a measured contrast note; this one escaped the check purely
by never having been a token. Now themed: `#b45309` (amber-700, 5.02:1 on white) in light,
`#f59e0b` (amber-500, 7.76:1 on `#1e1e1e`) in dark, both in line with the `text-muted` steps. The
reverse does not work — amber-700 is only 3.32:1 on the dark panel — so this is genuinely one role
with two values, not a single colour that was picked badly.

**The meaning deliberately does NOT match the family's**, and the divergence is recorded in the
shared document rather than papered over. There, `warn` is the secondary accent for session-only
monitoring state that never reaches an export (solo, in/out markers). Here it means *"why what you
are about to do will not land"*: hidden/locked layers (7 uses), blocked-edit explanations (7),
eraser mode and the persist alert (2). Hidden layers genuinely do not render, so this is saved state
that changes output. Per that document's §8 the app wins and the document gets the note.

Verified in the built CSS rather than assumed — `svelte-check` cannot see a Tailwind class that was
never generated: `.text-warn{color:var(--color-warn)}` is emitted and both values appear in the
output. **VERIFIED on iPad 2026-09-09** as part of the colour pass below. (The "both themes" this
originally asked for no longer exists — the light theme was removed the next day, so `warn` is a
single value again and the amber-700 half of this entry is history rather than live code.)

**Flagged, not touched** (out of the chosen scope): colours Tailwind utilities cannot reach because
they are drawn on canvas — `AudioLane.svelte` (`#2b3240`, `#24272f`, `#3d4759`, `#999999`),
`RefTransformGizmo.svelte` (`#3b82f6`), `Canvas.svelte` (`#0080ff`). All are fixed dark-ish values
regardless of theme. §8 of the shared document tolerates `var(--color-*)` inside scoped CSS for
exactly this kind of furniture, so they could become roles later; it is a larger job than this one.

**The accent, and why the app read as flat grey next to the other two (2026-09-08).** The `warn`
role above was the right change and the wrong scope: it repaints small amber text, so the honest
report was *"I can't see any difference."* Comparing the two apps side by side in the browser found
the actual gap, and it is not the greys.

**The greys were already the family's** — panel `#1e1e1e` against `#1e1e22`, ground `#121212`
against `#101013`, differences no eye resolves. What differed is that **this app had no accent
colour in use at all**:

| | how "this is active" was shown | contrast vs the panel |
| --- | --- | --- |
| slop-video-compositor | filled `#5b8cff` | 5.27:1 |
| slop-animator (before) | `surface-active`, a lighter grey | **1.32:1** |

1.32:1 is a change you can measure and not one you can see, which is exactly why the interface read
as flat monochrome beside the compositor's. The cause was the token collision noted when this
alignment started and then not acted on: `--color-accent` here was `#e0e0e0`, a near-white INK
colour — the opposite of the family's meaning — while the actual blue sat in `--color-selection`,
used in FIVE places (the focus ring and `accent-color`) and never for state.

**`--color-accent` is now `#5b8cff`**, theme-independent as in the family, with `accent-hover`
`#7aa3ff`; `--color-selection` is kept as an alias so nothing naming it breaks. `--color-accent-text`
(the label ON the fill) is `#121212`: white is only 3.16:1 on that blue, near-black is 5.92:1, and
§6 of the shared document already says a filled toggle switches its label to `ground`. The 11
existing `accent` uses — slider thumb, primary buttons — become blue as a consequence, which is what
the compositor does with its own Export button and zoom slider.

**The on-state is defined ONCE, in CSS, not spread across 37 markup edits.** Two classes, because
they mark two different things: `.ui-on` fills a toggle or tool (28 sites), `.ui-selected` gives a
row an 18% accent tint plus a 2px left edge drawn as `box-shadow: inset` (9 sites) — a whole layer
row filled solid blue would shout, and §5 forbids state that changes an element's geometry. Three
`bg-surface-active` uses are deliberately LEFT grey: the timeline gutter corner, the resize strip
and the export progress track are structure, not state.

**Why CSS rather than `class:bg-accent` + `class:text-accent-text`:** every shared button constant
in this app already sets a text colour (`text-text-secondary` in Toolbar, Playbar and Timeline;
`text-text` in TimelineSelectionBar), and a `class:` directive layering a second colour utility over
it is decided by the order Tailwind EMITS them, not by the markup — the defect §6 of the shared
document records as *"a loop button styled that way looked completely dead."* These rules sit
OUTSIDE any `@layer`, and **unlayered declarations beat layered ones in the cascade whatever their
order**, so the on-state cannot lose that race. A future toggle gets the behaviour by naming one
class.

**Verified in the browser in BOTH themes** rather than reported blind: `.ui-on` computes to
`rgb(91,140,255)` with `rgb(18,18,18)` text — i.e. it does beat the base `text-text-secondary` — and
`.ui-selected` shows the tint with the inset left bar, over `#1e1e1e` dark and `#ffffff` light.
Screenshots were compared against the compositor. **VERIFIED on iPad 2026-09-09** for how loud the accent
reads on device.

**The dark theme takes the family ramp verbatim, and the sliders with it (2026-09-08).** Third and
largest step of the alignment. The user's correction is the reason it went this far: I had called the
difference between animator's neutral greys and the family's faintly tinted ones "barely" visible,
and that is wrong — *"grayscale vs slight tint is not barely, it's quite easily distinguishable"*.
Over a whole toolbar or timeline it reads immediately, which is why the shared document has an entire
table weighing zinc against slate against gray rather than just using `neutral`.

**Every dark value is now the family's hex** — ground `#101013`, panel `#1e1e22`, raised `#2d2d33`,
line `#2e2e35`, text `#f4f4f5`, muted `#a1a1aa`, clip `#172036` with border `#384b75`. Three tokens
had no family equivalent and were chosen to match its cast and hold their old contrast:
`border-light` `#26262b` (a subtler divider, between panel and line), `text-muted` `#8a8a93` (this
app has a THIRD text level; 4.86:1 on the panel against the old value's 4.83:1), and
`media-clip-dim` `#13141a`.

Two consequences worth stating rather than discovering later. **Dividers are fainter** — `line` is
1.10:1 over the panel where `#383838` was 1.42:1; that is the family's deliberate "only slightly
lighter than what it divides", and if it proves too subtle the fix is to lift `--color-border` alone,
not the ramp. And **`surface-hover` and `surface-active` collapsed into one value**, which was only
safe because active state had already moved to the accent — before that commit they had to differ.

**Blue clips supersede the neutral ones** and the note arguing for them. That note's reasoning was
"neutral keeps clips from competing with the selection blue" — written when this app had no accent in
real use, so it was guarding against a blue that never appeared on screen. The new clip is also
DARKER than the old (1.17:1 on the ground against 2.02:1), which serves the same note's other goal:
the waveform stays the loudest thing in the lane. The clip is found by its BORDER (2.20:1), not its
fill.

**Sliders adopt §6**: 4px track, 12px thumb, and the filled portion rebuilt as a gradient because
`appearance: none` — the only way to size a thumb the browser draws — also loses the fill the browser
drew for free. The fill is the accent mixed 50% into the track, so it does not compete with the thumb
you are actually aiming at. All 21 range inputs are wired.

`sliderFill(value, min, max)` is a PURE function with 5 tests, not a Svelte action: `bind:value`
already re-renders the `style` attribute on every change, so the fill tracks values set from the
store as well as by dragging — which an action listening for `input` events would miss. It always
emits both stops so a bipolar control could be added without touching the stylesheet.

**Deliberately NOT adopted: §3's 24px control height.** This app's controls are 28-32px because it
is driven by a Pencil and fingers; the other two apps are desktop-only. Shrinking every control would
undo exactly what `bbd272d` and the portrait-bar fix were tuning. §8 says the app wins.

A scripted edit inserted the slider `style=` into 19 of the 21 inputs; the regex `<input[^>]*>` broke
on one tag whose `onclick={(e) => …}` contains a `>`, and refused two more that use `value={…}`
rather than `bind:value`. All three were finished by hand. Caught by the build, but worth recording:
**an HTML-tag regex cannot be trusted on markup containing arrow functions.**

**VERIFIED on iPad 2026-09-09** — confirmed by the user on the deployed build: *"ipad — colors ok"*.
That covers the two open questions this entry raised, and the second is the one worth recording,
because it was a real risk rather than a formality: adopting `line` verbatim dropped dividers to
1.10:1 over the panel where `#383838` had been 1.42:1, and the fallback if they had not read on
device was to lift `--color-border` ALONE rather than the ramp. They read. No change needed, and the
ramp stays byte-identical to slop-audio-editor's and slop-video-compositor's.

**The light theme is gone; the app is dark-only (2026-09-08).** Removed at the user's call — *"I'm
starting to doubt on needing a light theme. I don't use it personally"* — and it was the single
biggest source of friction in the whole alignment, not merely an unused feature.

**What it was costing.** Every token was TWO decisions and two contrast checks against two different
grounds. `warn` genuinely needed two values (amber-700 is 3.32:1 on dark; amber-500 is 2.15:1 on
white), which is the entire reason that token was fiddly. `SLOP-TIMELINE-UI.md` had to carry a
carve-out naming this app as light-first and telling adopters to map roles onto "its existing light
and dark scales" — a special case in a document meant to be copied. And the light scale was pure
NEUTRAL while the new dark ramp is tinted, so keeping both would have meant hand-tuning a second
tinted ramp with no family reference to copy from. Dark-only makes this an ordinary family member:
the roles are the family's roles and the values are its hexes.

**The artwork is untouched.** The paper is `project.bgColor`, painted in `render.ts`, entirely
independent of the UI theme — a white page stays white on dark chrome, which is what every drawing
app does anyway.

Removed: the whole `.dark` block (its values merged into `@theme`, which is now the one palette),
`color-scheme: light` → `dark`, `state.theme` and its default, the theme entries in
gather/applyPreferences, `toggleTheme()` and the View-menu item in `Toolbar.svelte`, and the
`classList.toggle("dark", …)` calls in `App.svelte` and the toolbar.

**Two migration details that would have bitten.** `Preferences.theme` is KEPT on the type as ignored
legacy rather than deleted: a stored `"light"` from an older version still parses, and because
nothing reads it the user simply gets the one theme instead of being stranded in a light UI with the
toggle that would have escaped it now removed. And `AudioLane`'s waveform action took a `theme`
parameter it never read, purely to re-run the draw on a toggle — its colours come from CSS tokens via
`getComputedStyle`, which nothing else invalidated. With one palette those tokens cannot change under
it, so the parameter is gone and `audioVersion` is the only real dependency.

A side effect worth noting: the hard-coded hexes in `AudioLane.svelte` (`#2b3240`, `#24272f`,
`#3d4759`, `#999999`), flagged out of scope earlier, were dark values all along — so they were
subtly WRONG in the light theme and are simply correct now. They remain candidates for tokens.

One leftover the greps did not reach: `index.html` hard-coded `class="dark"` on `<html>`, put there
to avoid a flash of light chrome before JS ran. With one palette and no `.dark` rules it was dead,
and it was found only by checking the rendered page rather than the source — a browser check earning
its keep on a change whose whole risk surface is "did the tokens actually merge".

**VERIFIED in Chrome:** renders dark with no `.dark` class anywhere, panel `rgb(30,30,34)`, accent
`#5b8cff`, text `#f4f4f5`, no theme item in the View menu, sliders filled. Owed the usual iPad
eyeball, but the risk is low — a failure here would be unmissable rather than subtle.

**Size presets are fixed squares, and Smooth moved into the gear (2026-09-08).** Asked for from a
screenshot: *"make brush size buttons higher and square."* They were text with `px-0.5`, so each
button was a different width and the accent fill a different SHAPE per preset — "12" a wide pill,
"4" a narrow one. Now `size-6`: a 24×24 square, which is §3's shared control height and roughly
doubles a touch target that had been text-height. It is the same call
`SLOP-TIMELINE-UI.md` §6 makes for its flag rows — a fixed square so a row does not reflow as its
glyphs differ in width.

**Measured before claiming it, and it had re-broken the portrait fit from earlier the same day.**
The squares add 45px, and the Smooth brush had only 39px to give: its bar ended at **1030 against a
12.9" iPad's 1024** and would have wrapped again. Smooth was the widest engine because it alone
carried the "Smooth" slider (+120px).

So that slider moved into the gear panel — which is where the gear's own rule (`bbd272d`) puts it
anyway: you calibrate smoothing once, like Stream beside it, rather than riding it mid-stroke. It is
smooth-only, so it was hidden for every other engine regardless.

**Result: every brush now ends at exactly 910px, 114px spare in portrait** — and the bar is the same
width for EVERY engine, which it never was before (Smooth 1030 / Ink 910 / Calligraphy 910 before
this; the earlier portrait entry's ~955 estimate for Smooth is superseded). That uniformity is worth
more than the 45px: there is now one width to check rather than one per brush.

**VERIFIED in Chrome** across smooth / ink / calligraphy / pencil: all end at 910, all on a single
row, Smooth reachable in the gear under Stream with its value readout. Owed the usual iPad eyeball
for the touch feel of the 24px squares.

**The blocked-edit reason was shown twice on the deform/pose tools (2026-09-09).** Reported from a
screenshot: *"is the double warning on the canvas needed?"* It was not.

Two independent captions, written for different reasons and never compared. `Canvas.svelte`'s stage
overlay fires for ANY blocked tool, and its own comment records why it lives on the stage rather
than in the options bar — an inline span there shoved Size/Press sideways. `ToolOptions.svelte`'s
was inside the `deform`/`pose` branch only, written as "swap this tool's instructions for the
reason" without noticing the overlay already said it. So every other tool showed the message once
and deform/pose showed it twice, plus the status bar's copy at the bottom.

The ToolOptions one is removed; the stage overlay is the keeper, since it covers every tool and sits
where the gesture would have happened. One wrinkle that would have bitten a careless deletion: the
branch read `{#if paintBlock} reason {:else if deform} instructions`, so removing just the reason
would have fallen through to telling a hidden layer to "drag the grid handles on the canvas". The
instructions are now gated on NOT blocked, and the bar simply shows nothing there.

`editBlockLabel` stays imported — five tooltips still use it.

**PLACEMENT CONFIRMED 2026-09-09** — the user weighed moving it back to the options bar ("option bar
feels more natural place") and, after the two fixes below made the message correct, settled on the
stage: *"on canvas is ok"*. So this is a decision, not an unexamined default — do not move it back
without a new reason. The bar option that was on the table was NOT the old code: it would have meant
showing the reason there for EVERY tool in a fixed-height slot, since the version removed here only
ever existed in the deform/pose branch and keeping it would have lost the message for brush, eraser,
fill and transform.

**A measurement error worth recording, because it nearly caused a second unnecessary edit.** A DOM
sweep for the string reported THREE visible copies, the extra one in `SelectionActions.svelte`. It
is not visible: that element computes `opacity: 1` while its parent `.selection-actions-panel` sits
at `opacity: 0`, and opacity does not inherit as a computed value, so checking the leaf says
"visible" when the subtree is not. **Check the ancestor chain, not the element, before calling
something visible.** That caption is correct as it stands — it appears only when the panel is up,
beside the Free transform / Distort / Mesh buttons it explains, which is a different question from
"why won't the canvas take a stroke".

Verified in Chrome in the exact reported state (hidden layer, deform tool): the options row is empty
and one caption remains on the stage, with the status bar's persistent copy at the bottom.

**A blocked edit now names the GROUP when the group is the blocker (2026-09-09).** Reported as *"when
selecting visible group layer after hidden layer, the warning on canvas is still shown"* — which
looked like a stale caption and was not. Reproduced in the browser first:

| step | layer's own `visible` | group's `visible` | caption shown |
| --- | --- | --- | --- |
| select a hidden layer | `false` | — | "Layer hidden — show it to edit" |
| select a **visible** layer in a hidden group | **`true`** | `false` | "Layer hidden — show it to edit" |

The caption persisted because the layer genuinely was not editable — `isLayerVisible()` returns
false when EITHER the layer or its group is hidden. But `whyNotEditable()` collapsed both into
`"hidden"`, so it reported **the wrong reason with the wrong fix attached**: the layer is not hidden,
and toggling its eye does nothing, because the group's eye is the one that is off. It read as stale
only because the wording was identical to the previous message. `locked` had the same defect.

`LayerEditBlock` gains `group-hidden` and `group-locked`, and `whyNotEditable` now reads the raw
flags — deliberately NOT `isLayerLocked`/`isLayerVisible`, which fold the group into the layer and
are right for "can this be edited" and useless for "why not". The layer's own flag wins when both
apply, since it is the nearer of the two fixes; locks still rank ahead of hides.

**The same conflation existed a second time, in `StatusBar`**, which built the hint from `locked` and
`hiddenLayer` booleans it derived ITSELF from those two folding predicates — so the status bar could
not have named the group either, and two places were re-deriving an answer `whyNotEditable` already
owned. Those two `HintContext` fields collapse into one `editBlock`, so the bar, the stage overlay
and the selection panel now read the same value and cannot drift.

Five tests, written first and watched fail with exactly the reported symptom (`expected 'hidden' to
be 'group-hidden'`). **Verified in Chrome** across all four states — hidden layer, visible layer in a
hidden group, unlocked layer in a locked group, and healthy — with the stage overlay and the status
bar agreeing in every one.

Two self-inflicted snags, both caught by the build: an import-pruning heuristic counted two symbol
names that appear only in a COMMENT and kept them, and `status-hint.test.ts` had a SECOND local
`base` context inside a later describe block that the first edit missed.

**The pixel tools now dim for a hidden or locked layer too (2026-09-09).** Spotted from two
screenshots: *"when group layer is selected — tools dimmed but options not. when hidden layer is
selected both tools and options are active."* The second half is the bug, and it is the same CLASS
as the entry above — a second predicate answering "can you draw here?" and disagreeing with
`whyNotEditable`.

`pixelToolsBlock()` asked only two questions: is the working target a layer row, and is the active
layer a reference. **It never checked hidden or locked**, so a hidden layer left every pixel tool at
full brightness while a stroke silently refused — the exact failure the dimming exists to prevent —
and it was visibly inconsistent with a group row, which did dim. The caption knew all along, because
it asks `whyNotEditable`.

The row check stays first and stays this function's own: on a group or audio row the active layer is
usually a perfectly good drawing layer, so the fix is to select a layer row rather than to change
anything about the layer, and `whyNotEditable` sees only a layer and cannot know that. Everything
after it now delegates. Nothing regresses, because `whyNotEditable` already returns `not-draw` for
references — and the toolbar's tooltips get the group-aware reasons for free, since they already
render `editBlockLabel(toolsBlock)`.

**The options bar staying live is deliberate and unchanged.** ToolOptions' own comment states the
rule: *"Brush settings stay live (session prefs). Actions and instructional copy must not promise a
stroke that will not land — same split as the toolbar's dimmed pixel tools."* You set up Size/Press/
Ink before switching to a drawable layer; the bar's ACTIONS (fill, the selection ops) already gate
on the block. Worth noting that comment says "same split as the toolbar's dimmed pixel tools" — it
was written believing the toolbar already did this. It did not, until now.

**Verified in Chrome**, all four states, with the Size slider live in every one:

| case | tools dimmed | tooltip |
| --- | --- | --- |
| healthy layer | 0/3 | "Brush" |
| hidden layer | **3/3** (was 0) | "Brush — Layer hidden — show it to edit" |
| visible layer in a hidden group | **3/3** | "Brush — Group hidden — show the group to edit" |
| group row | 3/3 | "Brush — Select a layer row to edit" |

**Animating a property seeds its first key at the playhead, not frame 0 (2026-09-09).** Asked as a
question — *"when i start to animate transform or opacity, the keyframes are added to frame 1 instead
of current frame. Is this by design?"* It was by design, and the design was wrong.

All four entry points (`animateLayer`, `animateLayerOpacity`, `animateGroup`, `animateGroupOpacity`)
seeded `keys: [{ frame: 0, … }]` regardless of where the artist was working. The original rationale
is sound as far as it goes: `resolveTrack` returns the first key's value for every frame at or before
it, so seeding frame 0 with the current value makes enabling animation a visual no-op, and a first
drag at frame N then gives a tween from the start for free.

**The cost is what got reported.** Enable animation at frame 40 and the key lands at 1 — not where
you are. The first drag then invents a 40-frame tween across frames never visited. That is motion the
artist did not ask for, in an app whose whole premise is that you work AT a frame.

**Seeding at the playhead is equally safe and strictly more predictable.** It is *also* a visual
no-op at the moment of creation, for the same `resolveTrack` reason — a lone key holds its value
backwards to frame 0 — so nothing on screen changes either way. The only difference is where the key
lands and what the first drag produces, and the playhead is where the artist's attention already is.
This is also what After Effects and Flash do.

`createTransformTrack(t, box, frame)` takes the frame as a REQUIRED third argument rather than
defaulting to 0: a default would let a future call site silently reintroduce the old behaviour, and
there are only two callers. The two opacity seeds are inline and take `state.playhead` directly;
`animateGroupOpacity` also now reads `groupOpacityAt(g, state.playhead)` rather than
`groupOpacityAt(g, 0)` — same value today, since a group with no track resolves statically, but the
two should not disagree about which frame they describe.

Three tests, written first and watched fail (`expected [{frame: 0}] to deeply equal [{frame: 40}]`),
covering the seed frame, the frame-0 case still working, and the safety property that a track seeded
at 40 resolves to the same value at frames 0, 39 and 40.

**Verified in Chrome** across all four entry points: playhead 6, keys at 6/6/6/6, and the render
identical before and at the key. A note on the verification, because the first two attempts were
wrong and looked like a bug: setting the playhead to 17 and 23 on a **10-frame** project put it out
of range, and the first structural commit legitimately clamped it back to 9 — which read as
"animateLayer moves the playhead". It does not. The probe was invalid, not the code.

**The hollow diamond moved onto the blank keyframe it was describing (2026-09-09).** Reported as
*"when dragging keyframe next to blank key, the last one follows — is that by design?"*, then twice
more before I had finished measuring: *"blank keyframes seem to snap to next keys in other situations
as well"* and, decisively, *"it might be confusion about where the blank key is displayed and where it
actually is"* / *"it looks better when the blank key symbol is inside the span, but it actually is
outside next to it, right?"* — which is the whole bug, diagnosed by the person who could see it.

**The cause was mine, from `e30bbda` item 6.** The plan drew a `◇` as an outlined one-frame span; I
changed it to not drawing blank keys AT ALL, on the argument that a faint outline "made a boundary
look like content and stacked into noise". That argument was fine and the fix was not: the span
already carried a hollow diamond on its LAST HELD frame, so the only visible "the ink stops here" mark
sat one cell to the LEFT of the cell that actually stops it, and the cell that governs the run had no
pixels at all. Two marks' worth of meaning on one mark, at the wrong frame.

**What that produced, measured against the real functions rather than reasoned about** (a scratch
Vitest file over `moveBlockFrames`/`setHoldSpan` → `computeTimelineGlyphs` → `computeTimelineSpans`,
deleted after):

| gesture | before → after |
| --- | --- |
| drag the key alone +1 | `span 0-2, blank 3` → `span 1-2, blank 3` — the tail is pinned by the invisible key, so the span SHRINKS instead of sliding |
| drag the whole visible span +2 | `span 0-2, blank 3` → `span 2-7` — the blank key is overwritten and gone; content silently runs to the end of the document |
| drag the span's right edge +2 | `span 0-2, blank 3, span 5-7` → `span 0-4, blank 5, span 7-7` — the splice shifts the blank key AND the next real key |

Only the third is by design (`setHoldSpan` splices, exactly as Flash's F5 does). The first two are the
invisibility biting: one pins a span's end to something with no pixels, the other destroys a keyframe
with nothing on screen to warn you. Both stop being surprising the moment the mark is in the right
place, so neither needed a behaviour change.

**The fix is one mark per meaning.** The span keeps its filled diamond on its first frame and loses
the hollow one; the blank key gets the hollow diamond, on its own frame, in the empty lane, with no
fill behind it. A `◇` means "nothing from here", so a filled block there would still be a lie — the
honest picture is an outline with empty lane around it. A span that ends because an INKED key follows
needs no cap (the next filled block says so), and one running to the document end never needed one.

This also answers open question 3 of the spec — *"does the hollow end-cap earn its place?"* — with
**no**: it was competing with the blank key for the same meaning at the wrong frame. Render-only;
`computeTimelineSpans` was already reporting blank spans truthfully and its LOGIC is untouched (only
its docstring changed), so there was no
node-testable surface and no test change (1117 still green, build 0/0).

**Verified in Chrome** on a hand-built track — inked key at 1 holding to 4, blank key at 5, inked key
at 8 holding to 10, blank key at 11 — with the hollow diamonds landing on 5 and 11, the spans ending
at 4 and 10, and the filled diamond still centred under the playhead.

**Only a blank key splits a run (2026-09-09).** Asked for immediately after the diamond move, with the
reasoning attached: *"it might not be technically correct but — a span could not be split between
keyframes with content, only blank keys could do it. So continuous logic units would form, as usually
it's about a specific object what is animated and blank frame will end that."*

That is right, and it is also what Flash does. `computeTimelineSpans` used to break a run at every
key, so a character drawn on 1s rendered as a row of disconnected one-frame blocks — the screenshot
that prompted this shows three adjacent keys reading as three separate objects. But those frames ARE
one thing: one drawing being animated. The frame that ends it is the `◇`, which is also the frame the
artist reaches for when they want it ended.

**Adjacent keys now share one span and are told apart by their marks, not by gaps.** A filled diamond
lands on EVERY keyframe inside the run instead of only its first; the run is ended by a blank key or
by running out of content, and by nothing else. `TimelineSpan` gains `keyFrames: number[]` — always
non-empty for a content span (a run starts at a key), always empty for a blank one. The renderer
`{#each}`es it.

This **supersedes** the spec's "back-to-back keys are separate spans, not one run", and that test is
inverted in place with a comment saying why, rather than deleted — the old rule was deliberate, so a
future reader should find the reversal, not a silent gap. Ten tests, the nine new expectations written
first and watched fail (`expected [{…(2)}] to deeply equal [{…(3)}]`), including the two cases that
pin the new rule: a blank key SPLITS what would otherwise be one run, and back-to-back blank keys stay
separate one-frame spans.

**Verified in Chrome** on a track built to match the reported screenshot — a held key at 1, blank key
at 5, three keys on 1s at 7/8/9, blank key at 10, then a key at 12 holding to the end. The three keys
render as one block carrying three diamonds; the two blank keys carry the hollow ones.

**Review pass on the two entries above (2026-09-09).** A superpowers code review of
`cd19d838..1555c93e` returned no Critical findings and three Important ones. Two were mine to own:

**The `if (run)` guard is load-bearing, and I had documented it as unreachable.** I wrote that a `—`
glyph always follows a key "for any glyph array `computeTimelineGlyphs` can produce", and guarded it
only because the signature takes a plain `string[]`. That missed the SECOND producer: `displayGlyph`
(`Timeline.svelte:1139`), which synthesises the block-drag preview by blanking the vacated source
range — and leaves the holds that followed the dragged key stranded. Dragging a key out of its own run
yields `["", "—", "◆", "—"]`, whose `f=1` is a hold with no key before it. Without the guard,
`run.endFrame = f` throws `Cannot set properties of null` inside a render function, mid-gesture. The
comment now names the real caller, and a test pins it — which is the only thing that actually stops a
future reader deleting a guard whose defence is a sentence. Behaviour was never affected: the old
scan-forward implementation skipped stray `—` silently too.

**The spec and plan still carried the superseded rules, unmarked.** CLAUDE.md's supersession rule is
written for CLAUDE.md and CHANGELOG.md, but its REASON — "an agent that greps and lands on it first
will act on it" — applies harder to a plan file holding a copy-pasteable test body that now fails.
Both are marked now: a `> **SUPERSEDED**` block on the spec's "a Flash span is precisely ◆ followed by
its run of —" paragraph (also retiring its phase-3 note about the end-cap as a resize hotspot, since
the cap no longer exists), and one on the plan's inverted test with an explicit "do NOT paste these
bodies back in — they fail." **The convention now extends to specs and plans.**

The third finding was a dropped comment: the past-the-track test lost the sentence saying which
producer rule it protects, which is what stops it being deleted as redundant. Restored.

**Checked, not conceded:** the review flagged that adjacent diamonds could crowd at `MIN_CELL_W = 12`,
since a `size-2` square rotated 45° has an 11.3px diagonal — the merge removed the 4px inter-block gap
that used to keep back-to-back keys countable. Eyeballed in Chrome at cellW 12 with eight keys on 1s:
they stay distinctly separate, tight but countable. No zoom-dependent diamond sizing added — that
would be speculative work against a problem that does not appear.

Also confirmed by the review and worth recording: `displaySpansFor`'s uncached path got CHEAPER, not
dearer. Span count is monotonically non-increasing under the merge (500 span objects and up to 1000
elements for a 500-frame track on 1s become one span and 500 diamonds), and it was always dominated by
the `Array.from({length: frameCount})` glyph pass above it.

**The numeric play-range readout is gone (2026-09-09).** Asked as *"honestly, is numeric frame range
label needed at all?"* — no, and three things already carried it. The ruler draws the range in place
(warn edge lines with inward triangles, plus a 15% warn wash) over NUMBERED frames, so the extent is
legible where it lives; the ✕ beside the in/out icons is what says a range is set, and it has to exist
anyway as the only way to clear one; the status bar already carries the frame readout.

It also cut against the family layout this app has been aligning to. `SLOP-TIMELINE-UI.md` specifies
the transport row as `range (set in / set out / clear) | time readout` — three controls in the range
group, no numeric label, and the readout it names is the PLAYHEAD's, not the range's.
slop-video-compositor follows that, reporting range changes through its status line transiently
(`app.status = "Playhead play-in 3.40s"`) rather than parking numbers in the bar.

The label was conditional, so it cost nothing with no range set — but with one set it competed for
horizontal space in the bar that already had to be fixed for wrapping in iPad portrait. The one case
it served is a long project scrolled so the range is off-screen: you then know a range EXISTS (the ✕)
but not where. If that ever actually bites, the family's answer is a transient status message on
set/clear, not permanent chrome. `effectiveRange`'s import went with it — orphaned by this change.

**A note on the verification, because the first pass looked like a bug and was not.** Setting
`state.playback.range = { start: 5, end: 9 }` from the console rendered NO ruler markers at all, which
read as "the ruler doesn't actually show the range" — i.e. as the removal's whole justification being
false. The stored shape is `{ in, out }` (`src/anim/playback.ts:16`), not `{ start, end }`: that is
what `effectiveRange` CONSUMES, and what it RETURNS is `{ start, end }`. So both fields came back
`undefined`, `Math.min(undefined, last)` gave `NaN`, the markers positioned at `NaN` px and drew
nothing, while `{#if appState.playback.range}` stayed truthy and the ✕ showed — a state that looks
exactly like a broken renderer. Re-probed with `{ in: 5, out: 9 }` and the ruler drew the range
correctly. **Second time on this project a console probe with an invalid shape has impersonated a bug**
(the first was seeking the playhead past a 10-frame project's end, 2026-09-09); print what the function
actually consumes before believing the picture.

**A group spine marks which rows belong to a group (2026-09-09).** Asked as *"I'd like the range of
group to be better readable. One option is to span that blue vertical line across all the child layers
and nested animation tracks?"*

**The blue line was the wrong carrier, and the reason matters more than the fix.** That bar is
`.ui-selected` and means *this row is selected*. Extending it down the members gives accent two
meanings — the same tangle removed earlier today when three elements per row each drew their own bar —
and the family doc reserves accent for exactly one of them. Worse, it only appears while the GROUP row
is selected, which is when the information is least needed: you just clicked the group. Select a
MEMBER and the extent vanishes, though that is precisely when "which group am I inside?" is live.

**So: a separate hairline, drawn always, accent only while the group is the one being worked on.** It
sits at 8px in the gutter — left of the members' 16px indent, right of the header's 4px — so it reads
as a bracket rather than as a second selection bar. Lit-ness reuses `groupDetailShown`, which already
answers "the working target is this group, or one of its members is the selected row" and is already
tested; a member's TRACK row counts too, since `layerRowSelected` resolves a layer-owned track to its
owner. No new predicate, no hand-rolled `activeRow` conjunction (the thing `layerTrackSpec`'s comment
warns has shipped a forgotten term twice).

**Two surfaces, two mechanisms, one look.** The timeline's rows are a FLAT list, so the spine is a
per-row absolutely-positioned span, `-bottom-px` to bleed over each row's own `border-b` — without
that it breaks at every boundary. The layer panel genuinely nests members in `.group-members`, so
there it is one `border-l` on that container. `TrackRowSpec` gained `groupId`, which is deliberately
NOT the same question as its existing `indent`: a group's own track row is not indented (it is the
group's, not a member's) but it IS inside the block, so the spine runs unbroken from under the header
past the last member's last nested track.

**`border` was the obvious neutral colour and it is invisible.** First pass used `bg-border`, and at
1px on a `surface` row it could not be seen at all — the job undone. This file had already hit that
wall and written it down for the ruler ticks: `border` and `surface-active` sit ~1.02:1 apart on the
family ramp, which is why those ticks use `text-muted`. The spine now does the same, at 50%.

**A third invalid console probe, for the record.** Seeding a member's opacity track as
`{keys: [{frame, value}]}` made the panel's opacity readout show `NaN` — which looks like a bug in the
opacity path. The keyframe's value field is `v`, not `value` (`document.ts:83`), named that way on
purpose. Re-seeded correctly and the readout was fine. That is now three times in two days a probe
with the wrong shape has impersonated a defect (playhead past a 10-frame project; `{start,end}` for
`{in,out}`; and this). **Read the type, then write the probe** — the cost of not doing so is a false
bug report, and twice now it was caught only by checking before speaking.

**The timeline gutter goes full-bleed (2026-09-09).** Asked as *"there is that margin on the left
(there is none on the right). I'd keep equal padding for icon/labels but start header bg from the 0
and put accent line also there?"* — correct on all three counts.

**Where the asymmetry came from.** The timeline root carries `p-2`, and the scrolling grid is inside
it. On the LEFT that padding is visible as 8px of bare panel before the gutter starts; on the RIGHT
the strip is wider than the scrollport, so it is CLIPPED flush at the padding edge and the same 8px
never shows. One padding, two appearances. The consequence was worse than the margin: a selected row's
accent bar and its background both began at that 8px, so a row that fills the panel looked inset from
it, and the group header's background floated rather than reading as a band.

**Fixed by moving the 8px rather than deleting it.** `-mx-2` on the scroller cancels the root's
horizontal padding, so the scrollport spans edge to edge and every `sticky left-0` gutter row now
starts at panel x=0 — background, header band and accent bar with it. The 8px is handed to the gutter
LABELS: `px-1` → `pr-1 pl-3` on all four (group header, layer row, track row, and the audio lane's,
which is a separate component reached through `labelW`), and `pl-4` → `pl-6` for a group member. Every
icon and name therefore stays at the screen x it had — verified by measuring, not by eye: each row's
box now reports `left: 0` from the panel with `padding-left` 12px (24px for a member). The group spine
moved `left-2` → `left-4` to ride along. The frame strip gains the reclaimed 8px at each end.

The one real cost: `LABEL_W` is unchanged (it is a persisted, user-resizable preference — growing it
would silently move everyone's gutter), so the label's TEXT area is 8px narrower and truncates
slightly earlier. The gutter is draggable, which is the answer if it ever matters.

**A note for whoever edits that indent comment next:** it used to justify `pl-4` as "the same POSITION
the panel uses, 16px". The number is now 24px and the claim is unchanged, because the container it is
measured from moved 8px left. That comment already warned to "compare the resulting offset, never the
class value"; this is the case it was written for, and it has been updated rather than left to read as
a contradiction.

**And the spine centres on the group's chevron** (asked in the same breath: *"perhaps align expand
arrow and the group spine line horizontally?"* / *"center these i mean"*). 19px, not a round number:
the header's label starts at `pl-3` (12px) and the chevron button is `w-3.5` (14px), so 12 + 14/2 = 19.
Measured after the change — chevron centre 19.0, spine centre 19.5, which is as close as a 1px line
gets to a centre that falls on a pixel boundary. The point is that the control which OPENS the block
now sits on the line that shows how far the block REACHES.

Not touched, and deliberately: the LAYER PANEL's spine is not aligned to ITS chevron, and should not
be. Measured at 29px apart, because that header puts a drag grip BEFORE the chevron — so the chevron
sits further right than the members' own 12px indent, and a line through it would run straight through
the member names. In the timeline the chevron is the row's first element, which is the only reason the
alignment is available there. Nor the panel's left inset, a different container with its own padding,
and not what the screenshot showed.
