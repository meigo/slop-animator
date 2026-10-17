# Code review — 2026-10-17

A whole-codebase review, run the way the 2026-09-30 one was: eight feature areas (brushes,
model-render, persist-export, selection, state-undo, timeline, transform, ui-input), one reviewer
agent each, then one adversarial verifier per area that tried to refute every finding (verdicts:
**confirmed** — the code path was traced; **plausible** — likely, but depends on browser or device
behaviour it could not trace; **refuted**). Reviewers were told to weigh the code changed since
`e060951` (the last review's base; 139 commits, +7.6k lines in `src`) and not to re-report anything
the 2026-09-30 review fixed. Read-only: nothing was run in a browser or on an iPad. `npm test`: 1727
passing.

36 findings, 35 distinct after merging one found by two areas (resize drift of a rotating layer:
transform and state-undo). 30 confirmed, 3 plausible, 2 split (part confirmed; part refuted or
plausible). 11 major, 24 minor, no critical. No regression of a 2026-09-30 fix was found; the one
gap in a fix is Pose's seams (#9), which `646ddb7` (ported from slop-paint, which has no Pose) did
not cover.

Line numbers are as of `86a11ba` (main) and drift as fixes land — search for the code, not the
number. When a finding is fixed, mark it **FIXED** here with the commit.

Each finding gives the verifier's verdict and severity first (the reviewer's original severity
follows), then the reviewer's Problem / Scenario / Suggested fix, then the verifier's notes, which
correct the reviewer where they disagree.

Batches, in the order to fix them:
- **A — lost work** (#1–8): all FIXED on `fix/review2-batch-a` (see CHANGELOG, "Code review 2
  batch A"). An open stroke left uncommitted, the blank-layers guard on small documents, autosave
  after a failed load, checkpoints vs quota, crop dropping visible pixels, undo history evicted by
  one Duplicate, timeline Copy capturing a live lift.
- **B — wrong pixels or wrong place** (#9–20): all FIXED on `fix/review2-batch-b` (see CHANGELOG,
  "Code review 2 batch B"). Pose seams, the display canvas over iOS's area limit,
  resize vs rotating layers / reference scale / missing media, collapsed-group paste, play range
  vs insert/delete, Rigid pins, lasso rect rounding, bucket/eyedropper rounding, layer drag of a
  lifted layer, boil after context loss.
- **C — undo and lifecycle** (#21–25): all FIXED on `fix/review2-batch-c` (see CHANGELOG, "Code
  review 2 batch C"). Untouched Apply / lift wiping redo, no-op span drags, stale selected row and
  timeline selection.
- **D — performance** (#26–29): all FIXED on `fix/review2-batch-d` (see CHANGELOG, "Code review 2
  batch D"). Onion scratch size, hidden video seeks, idle warp redraw, marquee.
- **E — UI and input** (#30–35): focused `<select>` eating shortcuts, paste everywhere, finger
  gestures during a gizmo drag, pointer filtering on NumberField and the loop arrowhead, export
  "Done." on a refused share.

## Batch A — lost work (FIXED)

### 1. An open stroke is never committed when the working row becomes the audio lane or a group (same active layer) mid-stroke; the next stroke silently resumes it

**FIXED 2026-10-17** in `55a8f8f` (branch `fix/review2-batch-a`).

**verdict:** confirmed — **severity:** major (rare trigger, silent loss of one stroke) — **reviewer:** major — data-loss — `src/lib/Canvas.svelte:1336` (area: brushes)

- **Problem:** `onStroke` returns before the paint path when `workingTarget(appState.activeRow)` is
  `audio` (1336-1339) or `group` (1340-1351) for the brush/eraser — including for the `done`
  event, so `commitOpenStroke` never runs. Nothing else closes the stroke: the only banker for a
  row change is the `$effect` at ~2914, which watches `activeLayerId` and `playhead` only.
  `selectAudioLane()` (appState 2133) changes neither; `selectGroup(id)` (2120) changes
  `activeLayerId` only when the group's top draw member is not already active; `selectTrack` of a
  group-owned track likewise. So `strokeCanvas` / `beforeSnapshot` / `strokeBrushType` / the stamp
  engine's `lastStampCount` stay set after the pen lifts. On the next pen-down `if (!strokeCanvas)`
  (1550) is false, so the new gesture is painted as a continuation of the old stroke: full-redraw
  engines (Smooth, Ink, Calligraphy, Dry, Watercolour) `putImageData(beforeSnapshot)` first, wiping
  the earlier partial stroke; the stamp engine slices from the OLD `lastStampCount - 1` (stamp-brush
  `startIdx`), drawing nothing until the new stroke has more points than the old one, then
  resuming mid-stroke; and the engine is still the old stroke's (`strokeBrushType`), whatever the
  picker now says. If instead the user undoes (two-finger tap) while the stroke is open,
  `discardActiveEdits` reverts the partial stroke AND `undo()` also pops the previous history entry.
  The same swallowed `done` leaves the Fill tool's `fillUsed` latch set (1532), so the next bucket
  tap does nothing.
- **Scenario:** iPad, Brush (Smooth). Pencil mid-stroke on the group's top layer, a finger taps the
  audio lane (or that group's row) in the timeline; the line stops following the pen; lift. Tap the
  layer row again (same layer: no bank) and draw a second stroke → the first stroke disappears and
  only the second is in the undo step. With Pencil (stamp): the second stroke draws nothing for its
  first N points, N = the first stroke's length.
- **Suggested fix:** in `onStroke`, when a stroke is open (`strokeCanvas`) and the row no longer
  admits painting, `commitOpenStroke(lastPoints)` and set `dropStrokeUntilUp` (as `bankActiveEdits`
  does); or have the bank effect also watch `workingTarget(activeRow).kind`. Reset `fillUsed` on
  `done` before the early returns.

- **Verifier:** Traced end to end. `onStroke` (`src/lib/Canvas.svelte:1330`) returns at 1336-1339 (audio) or 1340-1351 (group) for brush/eraser/fill, before the `done` → `commitOpenStroke(points)` at 1583-1584, so a release after the row change never commits; `strokeCanvas`, `beforeSnapshot`, `strokeLayer`, `strokeBrushType` stay set. The only other closers are the tool-switch effect (2800-2803, needs a TOOL change), `bankActiveEdits` via the effect at ~2913-2921 (watches only `activeLayerId`/`playhead`), and `discardActiveEdits` (undo/replace). `selectAudioLane()` (`appState.svelte.ts:2133`) touches only `activeRow`; `selectGroup` (2120) and the group branch of `selectTrack` (2148) change `activeLayerId` only when the group's top draw member is not already active — so stroking that member and tapping its group's name keeps the layer id and no effect fires. Reachable triggers: a finger tap on the audio lane label (`AudioLane.svelte:378` onclick), a group name in the Timeline (`Timeline.svelte:3008`) or LayerList (`LayerList.svelte:766`), or a group property track; none sit inside the workspace, so `touch-gestures.ts`'s touchstart preventDefault (workspace-only, 376) doesn't suppress their click, and nothing checks for an open stroke. The code itself already assumes a finger can tap UI while the Pencil is mid-stroke (comment at the tool-entry guard, ~2822). The consequences follow as described: on re-selecting the same layer row (no `activeLayerId` change) the next pen-down skips the `if (!strokeCanvas)` init (1550), full-redraw engines restore `beforeSnapshot` (wiping the first stroke), and the stamp engine slices from the stale `lastStampCount - 1` (`stamp-brush.ts:283`). The `fillUsed` sub-claim is also real (set at 1536, reset only at 1538, behind the group/audio early return) but costs just one ignored tap. Only caveat: whether iPadOS delivers the finger's click while the Pencil is down is device behaviour I can't run, but the codebase's own comments assert it does.

### 2. The blank-layers guard misses a blanking whenever there are unsaved undo steps at least equal to the number of drawing layers, which is the usual state when the hide-flush save is suspended mid-encode

**FIXED 2026-10-17** in `0103ba8` (branch `fix/review2-batch-a`).

**verdict:** confirmed — **severity:** major — **reviewer:** major — data-loss — `src/App.svelte:592` (`blankedSince`), `src/App.svelte:447` (`describeForSave`), `src/persist/autosave-plan.ts:59` (area: persist-export)

- **Problem:** `looksBlanked` treats every history change since the last save (`history.changes - historyAtSave`) as an edit that might have emptied a layer: `emptied > historySteps`. Every edit counts, whatever layer it touched and whatever it did. Animator documents usually have 1 to 4 drawing layers, not slop-paint's 40, so a few strokes are enough to cover every layer. The failure is worst on the path the guard was built for. On hide, `flush` (App.svelte:549) runs `flushAutosave` only when `autosaveDirty`, which means unsaved edits, which means at least one history step since `historyAtSave`. `saveAutosave` then encodes key cells with one `toBlob` per cell over many awaits. On a large project (the kind at risk of being blanked) iOS suspends the page before the encode finishes. When the page comes back:
  - the cells encoded after the resume read the canvases the iPad emptied;
  - `describeForSave` then calls `blankedSince(inked)` with emptied = N layers and steps ≥ 1;
  - with N ≤ steps it returns false, so `describe` returns a meta and `write([LATEST_KEY, blob], …)` (autosave.ts:127) replaces the good latest with a partly or fully blank copy.

  `checkBlankOnReturn` on `visibilitychange` uses the same count, so it misses the same cases.
- **Scenario:** A 1-drawing-layer project with ~150 key cells. Draw a stroke and switch apps within ~4 s. The hide flush starts, iOS suspends it mid-encode, and the iPad reclaims canvas memory. Back in the app, the layer is blank, the guard sees 1 emptied and 1 step, no dialog appears, and the latest autosave is overwritten. Only checkpoints at least 5 minutes old survive. If you keep drawing, the blank document rotates through all 3 checkpoints in about 15 minutes.
- **Suggested fix:** Count only edits to the canvas being compared. `cell-ink.ts` already keeps `inkRevision(canvas)`, bumped by `markInkChanged` on every pixel edit and undo. At baseline, record each inked layer's canvas and its `inkRevision`. A layer counts as blanked when that same canvas is now empty and its `inkRevision` has not moved. Then drop the history-step tolerance.

- **Verifier:** `looksBlanked` (`src/persist/autosave-plan.ts:51-60`) returns `emptied > 0 && emptied > historySteps`, and `blankedSince` (`src/App.svelte:592`) passes `history.changes - historyAtSave`. `History.changes` (`src/anim/history.ts:187`) goes up on every push, undo, redo and clear, whatever layer the step touched. `historyAtSave` moves only in `describeForSave` (App.svelte:447) and `markSaved`. So a suspended hide-flush save (`flush`, App.svelte:549, runs only when `autosaveDirty`) resumes with at least one unsaved step. On a 1-layer document with one stroke since the last save, it then sees emptied 1 and steps 1, and `write([LATEST_KEY, blob])` (`src/persist/autosave.ts:127`) goes ahead. `checkBlankOnReturn` (App.svelte:623) uses the same count. The tolerance itself is a deliberate design choice, documented in the spec (`2026-10-02-autosave-checkpoints-design.md:20,37`) and the CHANGELOG 2026-10-02 entry ("more layers emptied than `History.changes` moved since"). It was inherited from slop-paint's 40-layer case. Its weakness on 1-4 layer documents is NOT documented as a trade-off; the only parked limitation is per-cell partial blanking. Telling detail: the C1 mid-encode check in `tools/ipad-smoke.mjs:804-818` (and the first guard check at :757) arms the save with "Transparent background", a direct field toggle (`Toolbar.svelte:566`) that pushes NO undo step. So both checks run with steps = 0. With a stroke as the triggering edit, the 1-layer smoke document would not pause. The fix direction (the canvas's `inkRevision`, `src/lib/cell-ink.ts:119`) is sound.

### 3. A return from the background while a lift or Outline preview is open never runs the blank check, and the next check counts the lift's Apply as an explaining step

**FIXED 2026-10-17** in `2833de4` (branch `fix/review2-batch-a`).

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — data-loss — `src/App.svelte:623` (`checkBlankOnReturn`), `src/App.svelte:549-553` (area: persist-export)

- **Problem:** `checkBlankOnReturn` returns early when `liftGuard.isOpen?.()`, and the hide `flush` also skips the save when a lift is open, so the baseline stays at the last timed save. Nothing re-runs the check when the lift closes. The next check is in `flushAutosave` or `describeForSave`, and by then Apply (a history push) or any further edit has added to `history.changes - historyAtSave`. That raises the tolerance in `looksBlanked` (see #1).
- **Scenario:** With a float or Outline preview open on a 1-layer project, background the app and the canvases are reclaimed. Back in the app, there is no check. Tap Apply: 1 step. The next autosave sees 1 emptied and 1 step, does not pause, and writes the blank layer over the latest.
- **Suggested fix:** Remember a "check owed" flag when the return check is skipped, and run it when the lift or preview closes (the `liftGuard` bank/discard hooks), before the closing step is pushed. Fixing #1 also covers this.

- **Verifier:** `checkBlankOnReturn` returns early on `liftGuard.isOpen?.()` (App.svelte:624; `isOpen` = mesh pose, floating selection or Outline, `Canvas.svelte:1706`). The hide `flush` also skips (App.svelte:553), and nothing re-runs the check when the lift closes. `autosaveWhenQuiet` keeps polling while the lift is open, so the first guard run after Apply sees `history.changes - historyAtSave >= 1`. On a 1-layer document that hides the blanking. Cancel / discard pushes no step, so that path IS still caught. This is a narrow sub-case of #1 (needs a lift open while backgrounded, plus N <= steps), and fixing #1 closes it.

### 4. Restoring a copy after a failed startup load leaves autosave off for the session, and restoring an older copy pushes the unreadable latest into the checkpoints, evicting a good one

**FIXED 2026-10-17** in `ff35682` (branch `fix/review2-batch-a`).

**verdict:** confirmed (first half) / refuted (second half) — **severity:** minor — **reviewer:** major — data-loss — `src/App.svelte:403`, `src/App.svelte:420`, `src/App.svelte:639-680` (area: persist-export)

- **Problem:** When the startup `loadAutosave` throws (truncated blob, decode OOM), `autosaveReady` stays false "for the session" and `state.autosaveOff = true`. File ▸ Restore autosave… is now the natural way back, and `restoreAutosaveEntry` works in that state: `replaceProject`, `resumeAutosave`, and the hint "Restored the copy …". But the persistTick effect returns at `if (!autosaveReady) return;` (App.svelte:420) and the hide flush checks `autosaveReady` too, so the restored document is never autosaved. A reload runs the same broken latest again and fails again. In addition, for an older entry, `shelveLatestAutosave` first pushes the unloadable latest into the rotation through `pushCheckpoint` (interval `-Infinity`). With 3 checkpoints that overwrites the oldest good checkpoint with the corrupt blob.
- **Scenario:** The startup load fails. The user opens Restore autosave… and restores the 5-minutes-old checkpoint. "Restored" shows and they work for an hour. Nothing autosaves. They reload and get the failure again, and the hour is gone. One good older checkpoint was also replaced by the corrupt latest.
- **Suggested fix:** When a restore (or an Open) succeeds after a failed startup, set `autosaveReady = true` and clear `autosaveOff` and its alert: the document is now a known one. Do not shelve a latest that just failed to load (track `startupLoadFailed` and skip `shelveLatestAutosave`). The startup alert could also point to Restore autosave….

- **Verifier:** First half confirmed. `autosaveReady` is assigned only at App.svelte:413, at the end of the startup `onMount`, and the catch returns before it (App.svelte:405). `restoreAutosaveEntry` (App.svelte:639) never sets it, so the persistTick effect (App.svelte:420) and `flush` (App.svelte:550) stay off for the restored document. Severity is lower than "major", though. The startup `persistAlert` ("Autosave is OFF …") stays up: `resumeAutosave` clears only `AUTOSAVE_PAUSED`, and `autosaveOff` keeps a manual save from retiring it. The user is told autosave is off, although "Restored the copy …" next to it is misleading. The exception is an `audioUndecoded` restore, which overwrites the alert (App.svelte:670-672). File ▸ Open after a failed startup has the same gap; that one predates this branch and is part of the "for the session" design. Second half refuted as a defect. The startup failure can be transient (a decode OOM or an IDB open that never settled are the causes named at App.svelte:397), so the latest is not known to be corrupt. It may hold the newest work, and shelving it is what C3 was built for. Evicting the oldest checkpoint is the documented rotation. Skipping the shelf, as the review suggests, would risk losing the newest copy when the restored document's first autosave replaces the latest.

### 5. Checkpoints keep up to 5 full project copies in IndexedDB, and a quota failure on the latest write never frees an older copy to make room

**FIXED 2026-10-17** in `8622154` (branch `fix/review2-batch-a`).

**verdict:** plausible — **severity:** minor — **reviewer:** minor — data-loss — `src/persist/autosave.ts:119-148` (area: persist-export)

- **Problem:** Each stored copy (latest, kept, `autosave-cp-0..2`) is a full project zip. `save()` writes LATEST and META first. If that transaction aborts on quota, the error goes to `onAutosaveFailed` ("Autosave is failing … save to a file") and every later save fails the same way. Meanwhile the older checkpoints, which are the copies least worth keeping, still hold the space. Before this change only the single latest slot existed, so the space a large project needs roughly quadrupled with no fallback.
- **Scenario:** A large project on an iPad close to its storage limit. Checkpoint writes start failing ("Couldn't keep an older autosave copy", shown once). Later the LATEST write fails too and keeps failing for the rest of the session, while three older copies stay stored.
- **Suggested fix:** When the LATEST write fails with `QuotaExceededError`, delete the oldest checkpoint (then the next one) and retry. Optionally skip new checkpoints once one has failed on quota.

- **Verifier:** The code matches the description. `save()` (autosave.ts:119-148) writes LATEST+META in one transaction, and a quota abort rejects to `onAutosaveFailed` (App.svelte:349). Nothing deletes checkpoints or the kept copy, so up to 5 full zips (latest, kept, cp-0..2) can be stored. Whether this actually tips an iPad over quota depends on WebKit's quota and blob-storage accounting, which I can't trace: whether a `put` over an existing key needs headroom for both blobs, and whether identical Blobs are deduplicated. The suggested fix carries its own risk. Evicting checkpoints to make room for a latest that could be the blank or broken copy defeats the reason checkpoints exist. A safer variant would stop creating NEW checkpoints after a quota error. The failure is loud (sticky "Autosave is failing … save to a file"), which supports minor.

### 6. Crop resize throws away visible pixels of a moved or scaled drawing layer

**FIXED 2026-10-17** in `3f04dea` (branch `fix/review2-batch-a`).

**verdict:** confirmed — **severity:** major — **reviewer:** major — data-loss — `src/state/appState.svelte.ts:2354-2365` (area: transform)

- **Problem:** `resizeProject` crops every key cell in CELL space: each cell is redrawn at `placeContent`'s rect into a new `w×h` canvas, and whatever falls outside is gone. Cell space equals display space only for an untransformed layer. A drawing layer's `transform` (static or track) shows cell pixels somewhere else on the paper, and `resizeDocPivotTransform` then moves the transform to keep the cropped pixels in place. So pixels that SHOWED inside the new document can be cropped out because their CELL coordinates fall outside it, while cell pixels that showed off-paper are kept. Nothing warns about this, unlike the merge-down refusal for the analogous group case. Undo restores it (one structural step), but the loss is easy to miss in a large animation, because it only shows on frames where that part of the drawing exists.
- **Scenario:** (a) 1920×1080, layer A moved 400 px right (`dx = 400`). Resize to 1500×1080, Crop, anchor right (o = −420). Cell x 0…420 is discarded. Those pixels showed at x 400…820, and paper x 420…820 lies inside the kept region, so a 400 px wide band of A's visible drawing disappears from every key cell. (b) The layer is scaled to 0.5, then cropped to 1000 px wide with a centre anchor. Cell x 100 showed at x 530, inside the kept window [460, 1460], but cell x 100 lies outside the cell crop [460, 1460], so it is dropped.
- **Suggested fix:** For a drawing layer with a non-identity static transform, either bake it (`bakeLayerTransform`, as legacy cell transforms are already baked here) before the crop, or choose the cell placement so the layer's displayed region maps into the new cell, as in #1 with a centre-keeping cell offset plus `d' = f·d + e`. For an animated layer that cannot be baked, warn in the Size dialog (or refuse Crop) when any drawing layer has a transform and the new size is smaller in either dimension.

- **Verifier:** The cell loop (appState.svelte.ts:2354-2366) redraws every key cell at `placeContent`'s rect into a `w×h` canvas in CELL space, without looking at `layer.transform` or its track. Only `bakeCell` runs, and it bakes per-cell transforms only. I traced scenario (a) by hand: anchor right gives rect.x = −420, so cell x 0…420 is dropped. With dx = 400 those pixels showed at paper x 400…820, and paper x 420…820 lies inside the kept window. Scenario (b) also holds: cell x 100 at scale 0.5 shows at 530, which is inside the kept paper [460, 1460] but outside the kept cell range. SizeDialog.svelte has a warning only for "new" mode (lines 216-220) and none for Crop on transformed layers. The canvas-size spec (2026-06-15) predates layer transforms, and batch B's fix (`ab7229c`) only maps transform values, so no recorded decision covers this. Data loss is real but stays recoverable while the resize step is in undo history. That keeps the severity at major, not critical.

### 7. Structural steps charge the history budget for canvases that are still IN the document, so a Duplicate / paste / audio import / upscale can evict the whole undo history

**FIXED 2026-10-17** in `f77c1a2` (branch `fix/review2-batch-a`).

**verdict:** confirmed — **severity:** major — **reviewer:** major — undo — `src/anim/history.ts:166-177` (`detachedBytes`), used at `src/state/appState.svelte.ts:768` (area: state-undo)

- **Problem:** `detachedBytes` returns `Math.max(onlyBefore, onlyAfter)`. Its comment says only one side is off the document at a time — true, but while a step sits on the UNDO stack the off-document side is always `before`; `after` is the live document. Taking the max charges a step for its `after`-only canvases while they are on screen. `History.push` adds that to `bytes` and `trim()` then shifts older steps until under 256 MB (`length > 1`). Steps whose `after` side is large and whose `before` side is empty: `duplicateLayer` / `duplicateGroup` (`cloneDrawingLayer` clones every key canvas), `pasteCells` / `moveTimelineSelection` (clones via `canvasOps`), `setAudioTrack` (counts the decoded PCM), `resizeProject` to a larger size (the test at `src/__tests__/history.test.ts:202` asserts that the NEW canvases are what gets counted: 3200, not the 800 actually detached).
- **Scenario:** a 1920×1080 project, a layer with 32 drawn keys (~8.3 MB each = 265 MB). Do 20 strokes, then Duplicate layer. The step is charged 265 MB, over the 256 MB budget by itself, so `trim()` evicts all 20 strokes. ⌘Z takes back the duplicate and nothing more. The same happens when you upscale 1280×720 → 3840×2160 with ~10 keys, or import a long audio track on top of an already-heavy history.
- **Suggested fix:** charge what the undo-stack state actually keeps alive: `onlyBefore`. The redo side lives only until the next push clears it. If redo memory matters, store `undoBytes`/`redoBytes` on the command and have `History` swap them on undo/redo. Update the resize test.

- **Verifier:** `detachedBytes` (history.ts:166) returns `Math.max(onlyBefore, onlyAfter)` and `commitStructuralEdit` (appState:768) stores it as `bytes`; `History.push` → `trim()` shifts undo steps while `bytes > 256 MB && length > 1`. For `duplicateLayer` (appState:989, `cloneDrawingLayer` clones every key canvas at :972) `onlyBefore = 0` and `onlyAfter` = every cloned canvas, all of which are live in the document while the step sits on the undo stack, so the charge is pure over-count. 1920×1080×4 = 8.29 MB, ×32 keys = 265 MB > budget, so `trim()` evicts every older step. The `max` was a deliberate choice in `33104a2` (batch C; comment: "only one side is off the document... so it counts the larger") because `History` never moves bytes between stacks on undo/redo, so the redo-side case is covered by the same number; CHANGELOG accepts that "one very large step (resizing a long project) now evicts older steps" — but it did not anticipate that an all-`after` step (duplicate, paste, move-block clones, audio import) charges memory that history does not hold at all. The suggested fix (charge `onlyBefore`, swap to `onlyAfter` while on the redo stack) is sound. Severity stays major because the loss is silent and unrecoverable, but it needs a heavy layer (~31+ 1080p keys alone, or a sum of several such steps) to bite.

### 8. Copy (and so Cut) of a timeline selection doesn't settle a live lift or Outline preview, so the clipboard gets the hole or the un-applied preview

**FIXED 2026-10-17** in `0d17fa5` (branch `fix/review2-batch-a`).

**verdict:** confirmed — **severity:** major — **reviewer:** major — wrong-pixels — `src/state/appState.svelte.ts:2931` (`copyTimelineSelection`), `:2955` (`cutTimelineSelection`) (area: state-undo)

- **Problem:** `copyTimelineSelection` calls `copyBlock` (`timeline-block.ts:70`), which clones each cell's canvas as it is now. It never calls `liftGuard.bank`, unlike `deleteTimelineSelection`, `moveTimelineSelection` and `pasteCells`. A live selection lift has cleared its region from the cell, and an Outline preview is written into it (see `liftGuard.isOpen`). App routes ⌘C/⌘X to the timeline whenever the pixel selection is floating (`selActive = active && !hasFloating`, `App.svelte` onKey and `editActions.copy/cut`). So with a float up, a timeline copy clones the punched cell. `cutTimelineSelection` copies FIRST and only then calls `deleteTimelineSelection`, which banks, so the float gets applied into a cell that is then deleted.
- **Scenario:** lift and move part of a drawing with Select (the float stays up). Long-press the same row at the current frame to start a timeline marquee; that is the same layer and frame, so nothing banks (`Timeline.svelte` row press). Press ⌘X, then ⌘V on another frame. The pasted drawing is missing the moved part, and the moved pixels are in neither the clipboard nor the document.
- **Suggested fix:** call `liftGuard.bank?.()` at the top of `copyTimelineSelection`, before `currentSelectionRect()`. `cutTimelineSelection` then inherits it.

- **Verifier:** `copyTimelineSelection` (appState:2931) calls `copyBlock` with no `liftGuard.bank`, while its siblings `deleteTimelineSelection` (:2948), `moveTimelineSelection` (:2968) and `pasteCells` (:2994) all bank. `liftPixels`/the Free-transform path punch the region out of the live cell canvas (selection.ts:453-457, Canvas.svelte:1781-1814), and App routes both ⌘C/⌘X (App.svelte:146,156-197) and Edit ▸ Copy/Cut (:100-109) to the timeline whenever the pixel selection is floating (`active && !hasFloating` is false). Nothing in the timeline press path banks for a same-layer, same-frame press: `rowDown` (Timeline.svelte:1778) calls `setActiveLayer` with the same id (no layer change for `bankActiveEdits`) and the long-press marquee sets the selection without moving the playhead; `liftGuard.bank` in rowDown runs only for a `resize` plan. Cut then banks inside `deleteTimelineSelection` and deletes the cell the float was just applied to. Undo recovers the pixels (the bank and the delete are both undo steps), and the TimelineSelectionBar's Copy/Cut buttons hit the same path; major is right for silently wrong clipboard contents.


## Batch B — wrong pixels or wrong place (FIXED)

### 9. Pose still draws each mesh triangle under its own antialiased clip, so Apply leaves seams along every triangle edge (the 646ddb7 fix only covered Distort/Mesh)

**FIXED 2026-10-17** in `4dbfc19` (branch `fix/review2-batch-b`).

**verdict:** confirmed — **severity:** major — **reviewer:** major — wrong-pixels — `src/core/mesh-pose.ts:234` (area: selection)

- **Problem:** 646ddb7 found that `drawTriangle` (selection.ts:1298) clips each triangle with an antialiased clip. Along a shared edge, the two partial coverages laid over each other never add up to opaque, so faint light lines appear. It measured ~585 px changed for an untouched Distort and ~1300 px for Mesh 3×3. The fix moved only `drawWarpedMesh` onto a `lighter` scratch. `MeshPose.render` still loops `drawTriangle(ctx, …)` straight onto the target. Two callers use it: `applyPose` (Canvas.svelte:2242, `meshPose.render(selCtx)`, which bakes into the cell) and `posePaint` (Canvas.svelte:2114, the overlay preview). A pose mesh is far denser than a warp grid: ~600 triangles at the default spacing 16, with vertices at pixel centres inside a 2 px grown silhouette (`coverSilhouette`). So internal edges cross the solid art in a lattice about every 16 px. Old finding #5 already flagged this ("each triangle's own anti-aliased clip may also leave faint seams along shared edges"), and its fix (51dd21b) changed only the mesh coverage.
- **Scenario:** Draw a solid filled shape. Pick Pose, add two handles, bend, Apply. The baked cell shows a faint light triangle lattice across the whole drawing. The bend is undoable, but the seams are part of that same step and cannot be removed separately. Each further pose adds another lattice.
- **Suggested fix:** Factor the scratch-and-`lighter` compositing out of `drawWarpedMesh` into a helper that takes a triangle list (src/dst point triples), and call it from `MeshPose.render`. Caveat: a posed mesh folds over itself much more often than a warp grid (inner elbow of a bent limb). With `lighter`, the overlap adds, giving darker or more opaque ink where triangles overlap. Check whether that fold artifact is acceptable, or clamp it, for example by drawing the scratch's alpha through `source-over` per connected fan.

- **Verifier:** `MeshPose.render` (src/core/mesh-pose.ts:234-244) still loops `drawTriangle(ctx, …)` straight onto the target, and `drawTriangle` (src/core/selection.ts:1298-1318) clips each triangle to its own path with the canvas's antialiased clip, which is the exact mechanism 646ddb7 fixed for `drawWarpedMesh` (selection.ts:1149-1233, scratch + `lighter`). Both callers are as stated: `applyPose` (src/lib/Canvas.svelte:2239-2242) bakes `meshPose.render(selCtx)` into the cell, and `posePaint` (Canvas.svelte:2094-2114) renders the preview the same way. I found no sign Pose was deliberately left out: 646ddb7's message and CHANGELOG entry (CHANGELOG.md:8476) talk only about Distort/Mesh as a port of slop-paint 5f708ce, and slop-paint has no Pose tool, so Pose was simply outside the port's scope. The mesh is built by `coverSilhouette` with spacing 16 (triangulate.ts:80; mesh-pose.ts:144), so interior edges cross solid ink in a lattice; the ~600-triangle count depends on the drawing's size. Unlike a selection lift there is no "untouched" restore, so even an untouched ✓ bakes the seams (see #2). Not browser-measured here; the mechanism is identical to the measured Distort/Mesh case, so "major" stands. The fold-over caveat in the suggested fix is real: posed meshes fold far more than warp grids, and `lighter` would brighten the overlap.

### 10. Display (and onion scratch) backing store is doc × outputScale² with no area cap — over iOS WebKit's canvas-area limit for a 4K/UHD document at ≥ 200 % zoom

**FIXED 2026-10-17** in `614e2f0` (branch `fix/review2-batch-b`).

**verdict:** plausible — **severity:** major — **reviewer:** major — wrong-pixels — `src/lib/Canvas.svelte:496-517` (area: model-render)

- **Problem:** `displayOutputScale()` picks 2 whenever `viewport.zoom >= 2`, independent of document size, and `sizeDisplay()` sets BOTH `display` and `scratch` to `round(W·DPR·ss) × round(H·DPR·ss)`. iOS WebKit refuses canvases above 16,777,216 px of area (the "Canvas area exceeds the maximum limit (width * height > 16777216)" console error) and also caps total canvas memory. A 3840×2160 document is 8.3 MP; at ss = 2 the display becomes 7680×4320 = 33 MP, and the onion scratch the same — both over the limit, so the 2D context draws nothing (blank canvas) the moment the zoom crosses 200 %. A 2896×2896-or-larger document crosses at 2×; `MAX_DOC_PX = 8192` (resize.ts:101) even lets a document whose CELL canvases exceed the limit at 1× (8192×8192 = 67 MP). Desktop browsers and desktop WebKit (`test:ipad`) have far higher limits, so nothing local would catch it. UNVERIFIED on device — reasoned from WebKit's documented iOS limit.
- **Scenario:** iPad, New ▸ 3840×2160. Pinch to 200 %+ to ink detail: the canvas goes blank (or stays at the last image and stops updating); zooming back below 200 % restores it.
- **Suggested fix:** clamp `ss` so `W·H·DPR²·ss² ≤ 16_777_216` (and leave headroom for the scratch, see finding 2); consider capping New/Resize on iPad, or at least warning above 4096×4096.

- **Verifier:** The code path holds up. `displayOutputScale()` (`src/lib/Canvas.svelte:496-500`) picks from `OUTPUT_SCALE_STEPS = [2, 1.5, 1]` on zoom alone. `sizeDisplay()` (`:502-517`) sizes both `display` and `scratch` to `round(W·DPR·ss) × round(H·DPR·ss)`, with `DPR = 1` (`appState.svelte.ts:510`). Nothing caps the area: the viewport only clamps zoom (`viewport.ts:48`, maxZoom 20), and `SizeDialog` / `MAX_DOC_PX` allow up to 8192 per side. The review UNDERSTATES the threshold. The 1.5 step already pushes a 3840×2160 document to 5760×3240 = 18.7 MP, over 16,777,216, so the failure starts at 150 % zoom, not 200 %. Any document over about 7.46 MP (for example 2732×2732) crosses at 1.5×, and a square document over 4096×4096 is already over the limit at 1×, cells included. I can confirm the arithmetic and that no guard exists. That WebKit on iPadOS 18/26 still enforces the 16.7 MP area limit (and what a refused canvas then shows) depends on the device, so the verdict is plausible. The fix should clamp `ss` by area, not only by zoom.

### 11. Resize with a non-centre anchor makes a rotating drawing layer's in-between frames land far from where they showed (keys are exact)

**FIXED 2026-10-17** in `c750df8` (branch `fix/review2-batch-b`).

**verdict:** confirmed — **severity:** major — **reviewer:** major — wrong-place — `src/state/appState.svelte.ts:2396` (`resizeTrack`), `src/anim/resize.ts:61` (`resizeDocPivotTransform`) (area: transform)

- **Problem:** A drawing layer turns about the document centre, so `resizeDocPivotTransform` gives each key `d' = f·d + e − A·e`, where `e = M(C) − C'` and `A = R(θ)S`. `resizeTrack` applies this to each KEY separately (`keys.map(k => byBox(k.v))`). `lerpTransform` (document.ts:705) then interpolates `dx/dy` linearly between keys. `A(θ)·e` is not linear in θ, so an in-between frame gets `lerp(A₀e, A₁e)` where it needs `A(lerp θ)·e`. Every key comes out exact and every in-between is off. The size of the error is |e| times the chord-vs-arc gap. `e` is 0 only for a centre anchor; any edge or corner anchor in Crop, or a Scale to a non-matching aspect with an edge anchor, makes it non-zero. CHANGELOG (batch B, `ab7229c`) lists this as a "known limit" where the path "can differ slightly". Measured, the offset is not slight.
- **Scenario:** 1920×1080 project. A drawing layer is animated from rotation 0° at frame 0 to 90° at frame 10. Resize canvas to 1000×1080, Crop, anchor middle-left (e = 460 px). Frames 0 and 10 match the pre-resize picture. At frame 5, a point at doc (500, 540) should now show at (634.7, 214.7) but shows at (730, 310), about 134 px off. I ran the same arithmetic as `forwardTransformPoint`, `resizeDocPivotTransform` and `lerpTransform` in a Node script to get these numbers. A 0°→180° key pair puts the midpoint off by |e| (460 px). The motion path visibly swings during playback and in export.
- **Suggested fix:** Make the map linear for any drawing layer that has a transform track with a varying rotation, or simply for every transformed drawing layer. Place its CELL pixels with a centre-keeping offset (`o_cell = C' − f·C`) instead of the anchor offset, and put the whole anchor shift into the translation: `d' = f·d + e`, with no `A·e` term. That is linear in the key values, so interpolation stays exact. It is the same form `resizeFitTransform` already uses for refs. This also moves the crop window for such layers (see #2). Alternatively, bake the in-betweens, or refuse a non-centre anchor while a drawing layer has a rotating track. At the least, correct "slightly" in the CHANGELOG.

- **Verifier:** `resizeProject` (src/state/appState.svelte.ts:2383-2398) maps every key of a drawing layer's transform track through `resizeDocPivotTransform` (src/anim/resize.ts:61-66, `d' = f·d + e − A·e`) via `resizeTrack` (appState:2410-2421). `resolveTrack` returns keys raw and `lerpTransform` (src/anim/document.ts:705-717) lerps dx/dy linearly, so the non-linear `A(θ)·e` term is chord-interpolated. I re-ran the finding's scenario with copies of `forwardTransformPoint`, `resizeDocPivotTransform` and `lerpTransform`: (500,540) at the 0°→90° midpoint should show at (634.7, 214.7) and shows at (730, 310), 134.7 px off; a 0°→180° pair puts the midpoint off by exactly |e| = 460 px. This is the documented "Known limit" in CHANGELOG.md:7820-7821 (batch B, `ab7229c`), so it is not new, but "slightly" is only accurate for small rotations between keys. A 15° segment gives about 4 px, and the error grows with the rotation per segment, so the entry understates it. The error also appears with edge anchors, not only corner anchors, and with Scale mode to a different aspect ratio, which the entry doesn't mention. Major is defensible because the error is silent and goes into exports, but it needs both a rotating track and an off-centre placement, and one undo restores everything.

*Also found by the state-undo reviewer (its #4):* Resize shifts an animated layer that turns between keys: the frames between keys go off by up to about 100 px

- **Verifier:** Same root cause as transform finding 1. `resizeProject` maps each draw layer key with `resizeDocPivotTransform` (resize.ts:62: `dx' = f·dx + ex − (A·e).x`), whose correction is non-linear in rotation, while interpolation is linear in `dx/dy/rotation`. Layer tracks always have `box: null` (`animateLayer`, appState:1263-1270, deliberately), so `resizeTrack` (:2413) never takes the linear `resizeContentPivotTransform` branch for a drawing layer. Hand-check of the scenario (f=1, e=(320,0)): key 90° gets +(320,−320), frame 6 interpolates to (160,−160) vs the correct (93.7,−226.3), ~94 px off — matches the finding.

### 12. Copy/paste across a collapsed group writes the copied columns onto the wrong layers, including a layer hidden in the collapsed group

**FIXED 2026-10-17** in `ecc6967` (branch `fix/review2-batch-b`).

**verdict:** confirmed — **severity:** major — **reviewer:** major — wrong-place — `src/anim/timeline-selection.ts:37`, `src/anim/timeline-block.ts:103-110` (area: timeline)

- **Problem:** `resolveSelectionRect` drops members of a COLLAPSED group from `layerIds` (line 37), so `copyBlock` builds one column per visible row. `pasteBlockOverwrite` / `pasteBlockInsert` then place column `c` on `drawingLayerIdsDown(project, top)[c]`, which lists every drawing layer down the stack. It skips only references, so collapsed members are included. `isLayerEditable` checks lock and visibility, not collapse, so the collapsed member is written. Copy and paste disagree on which layers count, so every column after the collapsed group lands one layer (or more) too high.
- **Scenario:** Stack top-first: A, group G (collapsed, member C), B. Marquee rows A to B (rows shown: A, G header, B), then Cmd+C. Select A and press Cmd+V at another frame. Column 0 lands on A, but B's column lands on C, inside the collapsed group, where nothing on screen shows the write. B gets nothing. With Shift (insert paste), C's cells and track keys also ripple right.
- **Suggested fix:** Make the paste target list use the same rule as the selection axis: skip collapsed-group members in `drawingLayerIdsDown` (or in a paste-specific variant). Alternatively, record which layers were skipped at copy time.

- **Verifier:** `resolveSelectionRect` (`src/anim/timeline-selection.ts:37`) skips `groupOf(layer, groups)?.collapsed` members, so `copyTimelineSelection` (`appState.svelte.ts:2931-2941`) builds one column per visible row. `pasteCells` (`appState.svelte.ts:2989-3000`) passes the active layer to `pasteBlockOverwrite`/`pasteBlockInsert`, and both map column `c` to `drawingLayerIdsDown(...)[c]` (`timeline-block.ts:103-110`, `:122`, `:140`). That list skips only non-`draw` layers. The only filter after that is `isLayerEditable` (`document.ts:303-305`), which tests lock and visibility, not collapse. Nothing between the two calls reconciles them, so the scenario works as described: B's column lands on the collapsed member C, and B gets nothing. The bug is wider than the copy-across case. Any paste whose target stack has a collapsed group below the active layer writes into the hidden members, even when the copy did not span a group. Major is right: the write is silent and lands on a layer you can't see, although ⌘Z undoes it.

### 13. Insert/delete frame does not move the play range, so the in/out points slide off the frames they bracketed

**FIXED 2026-10-17** in `c1e705d` (branch `fix/review2-batch-b`).

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — wrong-place — `src/anim/timeline.ts:352-417` (area: timeline)

- **Problem:** `rippleDocumentFrames` shifts every document-frame quantity: track keys, ref ranges, video offset, audio, and markers. It does not shift `state.playback.range`, which is also in document frames (`{in, out}`, used by `effectiveRange`). `frameTool` / `deleteTool` (Timeline.svelte:2077-2093) call only `insertFrameAllLayers` / `deleteFrameAllLayers`. Markers on the same frames do move, so after an insert inside or before the range, the range and the markers disagree.
- **Scenario:** Set in = 10, out = 20 around a walk cycle and add a marker at 10. Put the playhead on 5 and press Insert frame. The marker moves to 11 and the cycle now spans 11-21, but playback still loops 10-20: it starts one frame early and cuts the cycle's last frame.
- **Suggested fix:** Apply `shiftSpan` (or the `shiftStartFrame` rule for each edge) to `state.playback.range` in the two frame tools. It is session state, so it needs no undo, but it should follow the frames like the markers do.

- **Verifier:** `rippleDocumentFrames` (`timeline.ts:352-417`) shifts ref ranges, audio, `audioUndecoded` and markers, but never touches `state.playback.range`. The only writers of `playback.range` are the in/out/edge/clear actions (`appState.svelte.ts:2685-2703`). `frameTool` and `deleteTool` (`Timeline.svelte:2077-2093`) call only `insertFrameAllLayers` and `deleteFrameAllLayers` inside `commitStructural`. The scenario holds: insert lands at `playhead + 1 = 6`, the marker at 10 moves to 11, and the range stays 10-20. The review missed one more consumer: the stale range is also the default export range (`ExportDialog.svelte:90`, `resolveExportRange(opts, appState.playback.range, …)`), so an export of the play range is off by the same frames. Minor, because it is session state and visible on the ruler.

### 14. Rigid warp pins are not moved with the grid, so after a whole-grid move (or an FFD drag of a pinned point) the next Rigid drag yanks the pins back to their old spots

**FIXED 2026-10-17** in `809796f` (branch `fix/review2-batch-b`).

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — wrong-place — `src/core/selection.ts:658` (area: selection)

- **Problem:** `endDrag` (selection.ts ~723) records `pinned[idx] = current position` after a Rigid grid drag. `rigidDeformGrid` (rigid-grid.ts) then treats each pin as `rest[i] → pinned pos`, and assumes the doc's invariant that "a pinned point sits at its pinned position in gridStart". Two drags break that invariant without updating `pinned`:
  - The warping `"move"` drag (selection.ts:658-661) translates every `warpGrid` point and leaves `pinned` alone. The Select/Lasso tool reaches it by pressing inside a Distort/Mesh perimeter (`hitTest` returns `"move"`; Canvas.svelte ~1513-1518 `startDrag(handle)`).
  - An FFD grid drag (selection.ts ~680-684) can move a pinned point after a mode switch: pins survive `setDeformMode`, and the FFD/Rigid toggle is in the bar for both Deform and Distort/Mesh.
  - On the next Rigid drag, each stale pin maps from its current position to its OLD position. MLS then pulls the whole float back toward where it was.
- **Scenario:** Marquee → Mesh → Rigid. Drag a corner, which pins it. Drag inside the mesh to move the whole float 100 px right. Drag another control point slightly. The pinned corner snaps back 100 px left and the art shears across the canvas. Cancel loses the whole edit (undo while lifted only cancels).
- **Suggested fix:** In the `"move"` branch, translate every `pinned` entry by (dx, dy), computed from a copy taken at `startDrag`. In an FFD grid drag, update the dragged index's entry if it is pinned. Or simply re-sync `pinned` from `warpGrid` in `endDrag` for every pinned index.

- **Verifier:** The warping `"move"` branch (selection.ts:658-661) translates every `warpGrid` point from `warpGridStart` and never touches `this.pinned`; `endDrag` (743-755) only records a pin after a Rigid `"grid"` drag; FFD grid drags (680-684) don't update it either, and `setDeformMode` (543-547) keeps pins. `rigidDeformGrid` (rigid-grid.ts) maps `gridStart[i]` (the current, moved position) → the stored stale pin, so the stale pins act as strong constraints pulling the shape back. `"move"` is reachable only with the Select/Lasso tool on a Distort/Mesh float (hitTest returns "move" inside the outer perimeter, selection.ts:600-602; routed at Canvas.svelte:1508-1514) — the Deform tool path (Canvas.svelte:1470-1476) only starts `"grid"` drags, so the move half does not apply to the Deform tool, but the FFD-after-Rigid half does (the FFD/Rigid toggle is shown for every `"warping"` state, SelectionActions.svelte:226-255). Mitigation: "Reset pins" exists, and pins are cleared on `densifyWarp`/`beginWarp`. Minor is right.

### 15. Lasso lift snaps the copy rect by rounding (not outward), so a lasso edge left outside the rounded rect is cleared from the cell but missing from the float and the clipboard

**FIXED 2026-10-17** in `ecbf402` (branch `fix/review2-batch-b`).

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — wrong-pixels — `src/core/selection.ts:377` (area: selection)

- **Problem:** `copyPixelsFromDoc` (377-385), from fix 5c1b1ed (old #11), snaps `px = round(x)`, `pw = round(w)` and copies only `[px, px+pw)`. For a rect marquee this is consistent, because `clearRegion`'s rect branch clears the same snapped rect. For a lasso it is not. `clearRegion`'s lasso branch (~430-444; the needsMap branch likewise uses the unsnapped `lassoPoints`) clears everything inside the lasso PATH. The path is unchanged, and rounding can pull the rect up to 0.5 px inside the lasso on either side. Example: leftmost lasso x = 10.55 gives px = 11. Column 10 lies 45% inside the lasso along the whole stretch of the edge near x≈10.55. `clearRegion` erases 45% of its alpha, but the float starts at column 11. The right and bottom edges behave the same way when `round(x) + round(w) < x + w`.
- **Scenario:** With the Pencil, lasso a figure whose left edge is a near-vertical stroke drawn at a fractional x. Drag the selection away and apply. A faint ghost of the figure's edge stays at the old place, and the moved figure has a thinned left edge. Copy then Paste also drops that column.
- **Suggested fix:** Snap outward: `px = floor(x·dpr)`, `py = floor(y·dpr)`, `pw = ceil((x+w)·dpr) − px`, and the same for `ph`. The rect marquee stays exact (it becomes the covering pixel rect), and the lasso's whole path then fits inside the copied bitmap.

- **Verifier:** A lasso's `rect` is the raw fractional AABB of its points (selection.ts:304-317, `updateCreate`), and `copyPixelsFromDoc` (selection.ts:374-412) rounds it to `[round(x), round(x)+round(w))` and clips the copy to that bitmap, while `clearRegion`'s lasso branch (selection.ts:428-441, and the `needsMap` branch 416-426) clears through the unsnapped lasso path over the whole canvas. So partial-coverage pixels of the path outside the rounded rect are cleared but never copied. The finding actually understates the right/bottom side: `round(x)+round(w)` can fall nearly a whole pixel short of `x+w` (e.g. x=10.4, w=5.4 → 15 vs 15.8), not just 0.5 px. The rounding itself is deliberate (code comment at 383-388, same as slop-paint `src/selection.ts:359`), but its interaction with the lasso clear was not considered; for rect marquees it is consistent because `rect` is reassigned to the snapped value before `clearRegion`. Affected area is limited to where the freehand path reaches its bbox extremes (usually short stretches), only on Select/Lasso paper-crop lifts (Deform/Pose use content bounds) and copy; an untouched Apply restores via `untouchedLift`, so it shows only after a real move. Minor holds.

### 16. The bucket picks the tapped pixel with Math.round, so at high zoom a tap on a pixel's right or bottom half fills its neighbour

**FIXED 2026-10-17** in `3d56867` (branch `fix/review2-batch-b`).

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — wrong-place — `src/core/fill.ts:430` (area: brushes)

- **Problem:** `doFill` passes continuous document coordinates (`viewport.screenToCanvas` →
  `inverseChain`, Canvas.svelte 621/651/664) to `floodFill`, which takes the seed pixel as
  `Math.round(startX)`, `Math.round(startY)` (fill.ts 430-431). Pixel `i` covers `[i, i+1)`, so any
  tap with a fractional part ≥ 0.5 seeds pixel `i+1`. At zoom 1 that is invisible; at 400-800 %
  (a pixel is 4-8 screen px, where you zoom in precisely to fill tiny pockets) the right/bottom half
  of every pixel belongs to the next one. On the last column/row, `round` gives `w`/`h`, so the fill
  returns as off-canvas and reports "Nothing filled — that area is already this color". (The
  eyedropper's `sampleAt`, Canvas.svelte 982-983, rounds the same way — outside this area.)
- **Scenario:** zoom to 800 %, Fill tool, tap the right half of a 1-px-wide gap pixel between two
  lines → the seed is the line pixel to its right, and the bucket recolours the LINE instead of the
  gap. Tap the right half of the last pixel column → "already this color", nothing filled.
- **Suggested fix:** `Math.floor` for the seed in `floodFill` (and in `sampleAt`).

- **Verifier:** Line numbers are off: the seed is `Math.round(startX/startY)` at `src/core/fill.ts:407-408` (bounds check 409), not 430-431. The coordinates are continuous corner-origin document coords: `viewport.screenToCanvas` (`src/core/viewport.ts:65-80`) is just `(client - rect - pan)` un-rotated and divided by zoom, with no half-pixel offset, and `input.ts getPoint` (118-139) passes it through untouched; `doFill` (`Canvas.svelte:612`) only applies `inverseChain` and multiplies by `DPR` (=1) before `floodFill` (Canvas.svelte:641/667). So pixel i spans [i, i+1) and `round` seeds i+1 for any fractional part ≥ 0.5, invisible at 100 % but half of each pixel at 400-800 %. On the last column/row `round` yields w/h, `floodFill` returns early at 409, and `doFill` reports "Nothing filled — that area is already this color" (a misleading message). The eyedropper shares it: `sampleAt` (`Canvas.svelte:980-983`) uses `Math.round(p.x * DPR * ss)` and returns null at `px >= display.width`, i.e. "Nothing to pick there" on the last column. Fix as suggested: `Math.floor` in both.

### 17. Resize can push a reference's scale below the 0.05 floor, so it later pops (between keys, after reload, on the next scale drag)

**FIXED 2026-10-17** in `59358e9` (branch `fix/review2-batch-b`).

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — wrong-pixels — `src/anim/resize.ts:76-86` (`resizeFitTransform`) (area: transform)

- **Problem:** `resizeFitTransform` multiplies `scaleX/scaleY` by `r = f / k` and does not apply `floorScale`. When a crop enlarges the document (f = 1, k = new fit ÷ old fit > 1), `r < 1`, and a small reference drops below `MIN_SCALE` (0.05), which `RefTransform`'s doc says a magnitude never goes below (document.ts:82). Everything else enforces that floor, so the value does not survive: (a) `lerpTransform` floors (document.ts:712), so on an animated ref the in-between frames render at 0.05 while key frames render at the sub-floor value, and the ref flickers in size at every key. (b) `normalizeTransform` floors on load (project-file.ts:500), so after save and reopen, or an autosave restore, the ref is bigger than it was. (c) The next corner or side drag starts from `floorScale(t.scaleX * k)` (ref-transform.ts:154/171), so the first move snaps it up.
- **Scenario:** 480×270 sketch project with a reference scaled to 0.15. Resize to 1920×1080, Crop: k = 4, so the scale becomes 0.0375. It looks right now. After a reload it shows at 0.05, a third bigger. If animated, it pulses between 0.0375 at keys and 0.05 between them.
- **Suggested fix:** Floor the result (`floorScale(t.scaleX * r)`) and accept the small error, or, when any key would fall below the floor, absorb the factor elsewhere (warn). Also floor the resized static value.

- **Verifier:** `resizeFitTransform` (src/anim/resize.ts:76-87) sets `scaleX: t.scaleX * r` with `r = f/k` and no `floorScale`. For a 480×270 → 1920×1080 Crop with 16:9 media, f = 1 and k = 4, so 0.15 becomes 0.0375, below MIN_SCALE (ref-transform.ts:15). All three knock-on effects trace through the code. (a) `resolveTrack` returns key values raw, while `lerpTransform` floors in-betweens (document.ts:712-713), so even two equal sub-floor keys render at 0.05 between them. (b) `normalizeTransform` floors on load (project-file.ts:499-502). (c) `applyScale`/`applyStretch` floor `t.scaleX * k` (ref-transform.ts:157, 172-174), so the first drag snaps. The static value also renders unfloored right after the resize, so it looks correct until any of those paths runs. It needs a small reference plus a resize where k > f, so minor is right.

### 18. Resize with a reference whose media is missing (or still loading) guesses its re-fit, so it comes back the wrong size once relinked

**FIXED 2026-10-17** in `ef54de2` (branch `fix/review2-batch-b`).

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — wrong-place — `src/state/appState.svelte.ts:2387-2391` (area: transform)

- **Problem:** `k` (new contain-fit ÷ old) needs the media's intrinsic size. For a `missing` placeholder (`mediaIntrinsicSize` → 0×0, document.ts:1322), and for a video whose metadata has not loaded yet (`videoWidth` 0), the code falls back to `k = pl.f`, i.e. `r = 1`, and leaves the scale unchanged. The real `k` depends on the media's aspect against both document shapes, so it is generally not `f`. In Crop mode `f` is 1, while `k` is anything the new doc shape gives. The placeholder stores no dimensions (document.ts:76), so nothing corrects this at relink: the reference is contain-fitted to the NEW document and multiplied by an unadjusted scale.
- **Scenario:** Open a project on iPad whose 16:9 reference video was not embedded, so it shows as a relink placeholder. Resize 1920×1080 → 1080×1080, Crop. Relink the video: its fit width is now 1080 instead of 1920 (k = 0.5625), but its scale was not multiplied by 1/0.5625. It comes back at 56% of the size it was aligned at, and its offset is also off by the scale error.
- **Suggested fix:** Store the media's intrinsic size on the placeholder (it is known at save time) and use it here. Failing that, refuse or warn on resize while any reference has an unknown size. For a video still loading, wait for `loadedmetadata`.

- **Verifier:** For a `missing` placeholder, `mediaIntrinsicSize` returns 0×0 (document.ts:1320-1324), and so does a video before `loadedmetadata`. `resizeProject` then uses `k = pl.f` (appState.svelte.ts:2387-2391), so r = 1 and the scale is unchanged. The save JSON keeps only `was`/`name` for the media, with no dimensions (project-file.ts:285-298, 723), and `relinkReference` (appState:1837) just swaps in the media without correcting the scale. The scenario's 0.5625 size error is right: Crop f = 1, and the fit width goes 1920 → 1080. One part of the finding is wrong: the offset is not "also off". `transformCenter` is base centre + dx, a contain-fit stays centred, and `dx' = f·dx + ex` does not depend on k. So the media's centre lands correctly and only its size, about that centre, is wrong. Reaching it takes a non-embedded video (images always persist) plus a resize before relinking, or a resize in the brief window while metadata loads, so minor is right.

### 19. A layer drag (or Ungroup) changes a lifted layer's group compose without banking the float, so Apply lands the pixels off where they were shown

**FIXED 2026-10-17** in `6b14f7d` (branch `fix/review2-batch-b`).

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — wrong-place — `src/lib/LayerList.svelte:363`, `src/state/appState.svelte.ts:1819` (and `:1753` ungroup, `src/lib/LayerProps.svelte:629`) (area: ui-input)

- **Problem:** `reorderLayersWithGroups` (called from `endDrag` on release) and `ungroup` change a layer's `groupId`, so its `group ∘ layer ∘ cell` chain changes. Neither calls `liftGuard.bank`, although `addLayerToProject`, `removeLayer`, `removeGroup` and `duplicate*` do. Dragging the active layer by its grip doesn't switch layers (the click is swallowed), so Canvas's bank-on-layer-switch effect (Canvas ~2914) doesn't fire either. Selecting the group row to reach Ungroup also leaves `activeLayerId` unchanged when the lifted layer is the group's top drawing member (`selectGroup`). A paper-crop float keeps its lift-time `liftComposeSteps` (`syncComposeSteps` returns early while `hasFloating`), so Apply maps the float into the cell through the OLD chain, and the cell is then drawn through the NEW one.
- **Scenario:** Give a group a transform (for example rotate 30°). Marquee-lift some pixels on a top-level layer, then drag that layer's grip into the group: the hole jumps to the rotated position while the float stays put. Press Enter: the pixels end up rotated away from where the float was shown. Ungroup a transformed group while a member's float is open: same result in reverse.
- **Suggested fix:** Call `liftGuard.bank?.()` at the start of `reorderLayersWithGroups` (after its no-op guard) and in `ungroup`, as the other layer-structure actions already do (gotcha #9).

- **Verifier:** `reorderLayersWithGroups` (`appState.svelte.ts:1819-1833`) and `ungroup` (`:1753-1758`) have no `liftGuard.bank`. `addLayerToProject` (`:808`) and the other structural actions (`:919`, `:938`, `:992`, `:1015`, …) do. `LayerList.endDrag` (`:353-364`) calls the reorder directly, and `startDrag` never switches layers. Canvas banks on an `activeLayerId`/`playhead` change (`:2914-2922`) and on a tool change, not on `groupId`. `selectGroup` (`:2120-2131`) leaves `activeLayerId` alone when the lifted layer is already the group's top draw member. The float keeps its lift-time `liftComposeSteps` (`:1809`; `syncComposeSteps` returns while `hasFloating`, `:233-236`), and `onCommit` inverts that old chain (`:1649`). After the reorder, `layerComposeSteps` (`:141-159`) adds or drops the group step, so the cell renders through a chain the commit did not invert. The float lands displaced by the group transform. This only shows when the group has a non-identity transform, so minor is right.

### 20. A WebGL context that is (or comes back) lost during `build()` now disables boil for the whole session, and a loss mid-export silently drops boil for some frames

**FIXED 2026-10-17** in `acbd489` (branch `fix/review2-batch-b`).

**verdict:** plausible — **severity:** minor — **reviewer:** minor — wrong-pixels — `src/core/boil-gl.ts:72-110,141-146` (area: model-render)

- **Problem:** the batch-C fix sets `unsupported = true` on ANY throw from `build()` and on a link failure. But `getShaderParameter`/`getProgramParameter` return `null` on a lost context, so `compile()` throws and the link check fails when the context is lost — not only for a genuinely unsupported shader. The `isContextLost()` branch in `boilBegin` resets and the next frame calls `build()` again; if the GPU is still unavailable (iOS memory pressure, the case the check exists for), the new context comes back lost, compile "fails", and boil is turned off permanently with no message — every later playback and export takes the 2D path, unboiled. Separately, in an export a context loss now renders the affected frame(s) through the 2D fallback: the file mixes boiled and crisp frames with no error, the "looks finished but isn't" outcome video.ts's frame-error comment says must never happen.
- **Scenario:** iPad, boil on, long video export under memory pressure: the context drops; that frame (and, if the rebuild hits a still-lost context, every remaining frame and the rest of the session) exports without boil.
- **Suggested fix:** in the catch / link-failure branch, set `unsupported` only when `!g.isContextLost()`; otherwise just `resetBoilGL()` and return false. Let exporters know when a boil frame fell back (e.g. `boilBegin` returns a reason, or `compositeFrameLayers` reports it) and fail or retry the frame rather than encode it crisp.

- **Verifier:** The code matches the description. `init()` (`src/core/boil-gl.ts:72-85`) sets `unsupported = true` on any throw from `build()`, and `build()` sets it on a failed `LINK_STATUS` (`:106-110`). The WebGL spec has `getShaderParameter`/`getProgramParameter` return null on a lost context, so `compile()` throws (`:63-64`) and the session's boil is disabled for good. That needs `getContext` on a fresh canvas to hand back an already-lost context, rather than null (null takes the retry-able `return false` at `:100`). Browsers can do that under GPU or memory pressure, but I cannot trace it, hence plausible. The export half is real: `renderFrame` takes the 2D path whenever `boilBegin` returns false (`render.ts:274`), and nothing tells the exporter. Note this is a deliberate improvement over the pre-`e1aba55` behaviour, where such frames had no drawing layers at all, so the cost is crisp frames in a boiled export, not missing ink. Minor is right.


## Batch C — undo and lifecycle (FIXED)

### 21. Enter / ✓ on an untouched Pose, Deform or Distort/Mesh bakes a re-render and pushes an undo step, which wipes the redo stack

**FIXED 2026-10-17** in `ffcba1e` (branch `fix/review2-batch-c`).

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — undo — `src/lib/Canvas.svelte:2239` (area: selection)

- **Problem:** `poseDirty` and `deformDirty` exist so that an untouched lift is cancelled, not baked (comment at Canvas.svelte:415-420). Only the tool-switch effect (~2806-2813) and `bankActiveEdits` (~2854-2863) check them. The explicit apply paths do not:
  - `applyPose` (2239) has no `poseDirty` check. It is reached from Enter (App.svelte:236 `poseActions.apply()`) and the pose bar ✓ (Canvas.svelte ~3164).
  - Enter on a Deform lift goes to `selection.commit()` (App.svelte:235, since `selection.active`). The SelectionActions ✓ also calls `selection?.commit()` (Canvas.svelte:3057). Both reach `onCommit` (1637). Its guard, `selection.untouchedLift` (selection.ts:488), is true only for `state === "transforming"`. A `"warping"` lift (Deform tool, or Distort/Mesh on a marquee) always re-renders through `drawWarpedMesh` and pushes a `pixelCommand`. There is no `sameImageData` check, unlike deleteSelection, doFill and Outline.
  - Since the tool now lifts on arrival, "select the tool, change your mind, press ✓/Enter" is a natural sequence.
- **Scenario:** Undo three strokes. Select Pose (it lifts at once) and tap ✓ without adding a handle. The cell is re-rendered through the mesh, which adds seams per #1, and one undo entry is pushed. The three redo steps are gone. Same with Deform → Enter, without the seams.
- **Suggested fix:** In `applyPose`, `if (!poseDirty) return cancelPose();`. In `onCommit`, treat an untouched warp like an untouched transform: cancel when `appState.tool === "deform" && !deformDirty`, or have Selection track whether any warp drag happened. Or, more general: compare `after` with `before` via `sameImageData` before pushing, and restore `selMaterialized` when they match.

- **Verifier:** `applyPose` (Canvas.svelte:2239) has no `poseDirty` check; it is reached from Enter via `poseActions.apply` (App.svelte:236 → Canvas.svelte:1708) and the pose bar ✓ (Canvas.svelte:3159-3166, `onpointerdown` → `applyPose()`). `poseDirty`/`deformDirty` are only consulted in the tool-switch effect (2806-2813) and `bankActiveEdits` (2850-2863). For a warp, Enter (App.svelte:235) and the SelectionActions ✓ (Canvas.svelte:3057) call `selection.commit()` → `onCommit` (1636), whose only short-circuit is `selection.untouchedLift` (selection.ts:488-500), true only for `state === "transforming"`; a `"warping"` lift always re-renders and pushes. `pixelCommand` (src/anim/history.ts:91-131) does not skip a no-change command (empty tile list still returns a command) and `History.push` (history.ts:198-206) empties the redo stack unconditionally, so redo is lost and `changes` increments (which also weakens the blank-layers guard slightly). Since Deform/Pose lift on tool arrival (Canvas.svelte ~2837-2840), the select-then-✓ sequence is reachable. Minor is right: data is not lost except the redo stack, and the bake is undoable.

### 22. An untouched Select lift makes ⌘Z only cancel it and blocks ⌘⇧Z, against undo()'s own stated rule

**FIXED 2026-10-17** in `f63ccc8` (branch `fix/review2-batch-c`).

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — ui — `src/state/appState.svelte.ts:2859`, `:2885`; `src/lib/Canvas.svelte:2849` (`liftHasEdits`) (area: state-undo)

- **Problem:** `undo()` says an untouched lift "is cancelled below and the undo goes on". But `liftHasEdits()` treats any floating selection as edited: `!!selection?.hasFloating && !(tool === "deform" && !deformDirty)`. It never consults `selection.untouchedLift`, which `onCommit` already uses to treat an unmoved lift as nothing. So with an unmoved Select or Free-transform lift, ⌘Z just cancels it and stops. ⌘⇧Z refuses with "Apply or cancel the transform first, then redo", even though applying or cancelling it would change nothing.
- **Scenario:** select a region, press Free transform in the selection bar without moving anything, then press ⌘⇧Z to redo a step you had just undone. Nothing happens except the hint. ⌘Z needs two presses to undo the previous edit.
- **Suggested fix:** in `liftHasEdits`, return false when `selection.untouchedLift` (as Pose does with `poseDirty`, and Deform with `deformDirty`).

- **Verifier:** `liftHasEdits` (Canvas.svelte:2849) returns true for any `selection.hasFloating` outside an undirtied Deform, and `undo()` (appState:2859) / `redo()` (:2885) treat that as an edit: undo cancels and returns, redo refuses with the hint. `selection.untouchedLift` (selection.ts:488) exists and `onCommit` (Canvas.svelte:1639) already treats it as a no-op, but it landed in `a09c2f7` (2026-10-01), after `liftHasEdits` was written in `cae0a2b` (2026-09-29), so this is drift rather than a decision. `untouchedLift` requires `state === "transforming"`, `!fromPaste` and an identity matrix, so the suggested fix would not misclassify a Distort/Mesh warp (`"warping"`) or a paste. Impact: an extra ⌘Z press and a blocked redo, no data loss.

### 23. Dragging a span edge where nothing visibly changes still pushes an undo step and clears redo

**FIXED 2026-10-17** in `3db3a15` (branch `fix/review2-batch-c`).

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — undo — `src/lib/Timeline.svelte:2039` (also `settleRowDrag` at `:1965`) (area: timeline)

- **Problem:** The resize gesture commits whenever `dragLastBoundary !== dragStartBoundary`, and that is a POINTER test, not a document test. `rowMoveAt` updates `dragLastBoundary` on every move, even when `resizeHoldSpan` returns `false` (nothing was written). Two cases are affected. (a) A key whose span is already 1 (another key follows it) offers a resize edge (`planCellPointer`, timeline-grid.ts:64-66). Dragging that edge left clamps `span` to `Math.max(1, boundary - dragKey) = 1`, which is the current value, so `setHoldSpan` returns early. The release still calls `commitStructuralEdit(dragUndo)` with before == after. (b) A trailing span on a layer shorter than the document: dragging its visible end left within the other layers' length only pads the stored track (`setHoldSpan` grows `cells`), and `spanVisualEnd` is unchanged. The step that gets pushed has no visible effect. In both cases the push wipes the redo stack. This is the 14b class that batch C closed for Delete (#22, #23) and that the earlier review recorded as "resize drag skips no-ops", but that check only compared boundaries.
- **Scenario:** Undo a stroke, then grab the right edge of a 1-frame key's span and nudge it left before releasing. Nothing changes on screen, but redo is gone and the next ⌘Z appears to do nothing.
- **Suggested fix:** At release, commit only if the track actually differs from the grab. Either latch a `wrote` flag from `resizeHoldSpan`'s visible-end change, or compare `spanVisualEnd` / `cells` against `dragUndo`. Otherwise call `revertKeepingPlayhead`. (b) also needs the visible end, not the stored end, to decide.

- **Verifier:** `rowMoveAt` sets `dragLastBoundary = rowBoundaryAt(clientX)` before it calls `resizeHoldSpan` (`Timeline.svelte:1915-1918`). The return value only gates `bump()`. Release commits whenever `dragLastBoundary !== dragStartBoundary` (`:2039` in `rowUp`, `:1965` in `settleRowDrag`), and `commitStructuralEdit` (`appState.svelte.ts:762-770`) has no no-op check. Its `history.push` empties `redoStack` and increments `changes` (`history.ts:198-205`). Case (a) is reachable. `planCellPointer` (`timeline-grid.ts`) offers `resize` on any key's span end, including a span of 1, and dragging that edge left gives `Math.max(1, b - dragKey) = 1 === current`, so `setHoldSpan` returns early (`timeline.ts:484`) and an identical before/after step is pushed. Case (b) does write: `setHoldSpan` pads the stored `cells` while `spanVisualEnd` stays the same. That step is a real but invisible change, not a strict no-op. A side effect the review missed: the bogus push also raises `History.changes`, which the blank-layers guard counts as an undo step. Minor is right.

### 24. Dragging the last layer out of a group leaves the selected row pointing at the deleted group, which dims every pixel tool

**FIXED 2026-10-17** in `7ca96d7` (branch `fix/review2-batch-c`).

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — lifecycle — `src/state/appState.svelte.ts:1819` (`reorderLayersWithGroups`) (area: state-undo)

- **Problem:** `reorderLayersWithGroups` uses `beginStructuralEdit` / `commitStructuralEdit` directly, so it skips the `resolveStaleTrackFocus` repair that `commitStructural` runs (lines 781-789). That repair exists so that no edit can leave `activeRow` on something it destroyed. The reorder does destroy things: `nonEmptyGroups` drops a group whose last member moved out. A layer-grip drag never selects (`LayerList.svelte` `swallowClick`), so the group row, or one of that group's track rows, can still be the selected row. `pixelToolsBlock()` then returns `"not-layer-row"` (`workingTarget` kind `group`), no row is lit, and `transformScope()` reports `group` for a group that no longer exists.
- **Scenario:** group G holds one layer L. Tap G's header (or G's Opacity track), then drag L by its grip to the root. G vanishes, the brush, eraser and fill all refuse with a "select a layer row" caption, and nothing in the panel is highlighted. Clicking a row recovers.
- **Suggested fix:** in `reorderLayersWithGroups`, run `state.activeRow = resolveStaleTrackFocus(...)` before `commitStructuralEdit`, as `commitStructural` does. Or route it through `commitStructural`, keeping the no-op guard above it.

- **Verifier:** `reorderLayersWithGroups` (appState:1818) uses `beginStructuralEdit`/`commitStructuralEdit` directly and prunes via `nonEmptyGroups` (document.ts:1259), but never runs `resolveStaleTrackFocus` (the only callers are appState:720 restore, :789 commitStructural, :1791). No Svelte component writes `activeRow` (grep of `src/lib`, `App.svelte` finds no assignment), so nothing else repairs it. The LayerList grip drag ends in `reorderLayersWithGroups(target.order)` (LayerList.svelte:363) and `swallowClick` suppresses the selecting click, so a previously selected group header or group track row survives; `workingTarget` maps it to `{kind:"group"}` (active-row.ts:28) and `pixelToolsBlock` (appState:2096) returns `"not-layer-row"`. A layer track row moved into a COLLAPSED group is a second, smaller instance of the same gap (`trackRowEmitted` false, not repaired). Recovery is one tap, so minor.

### 25. A length drag that shortens the animation leaves the timeline selection pointing past the end

**FIXED 2026-10-17** in `97b442f` (branch `fix/review2-batch-c`).

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — lifecycle — `src/lib/Timeline.svelte:1028-1029` (area: timeline)

- **Problem:** `commitStructural` clears `state.timelineSelection` because "any structural edit can invalidate stored endpoints" (appState:782). The gesture brackets that commit through `commitStructuralEdit` directly do not: the length drag (`settleLenDrag`), span resize, loop drag and key drag. After the ruler's length drag shrinks the document, the selection's frames can lie wholly past `frameCount`. The wash disappears (rows render only `frameCount` cells), but the selection is still live. Delete, Cmd+C and the selection bar act on it. `copyBlock` past a layer's end materialises the held last key, so Copy, then Paste stamps a drawing the user never selected. `TimelineSelectionBar.place` positions the bar at `startFrame * cellW`, beyond the row.
- **Scenario:** Marquee frames 30-35, then drag the ruler's length handle to 20 and release. Nothing looks selected. Cmd+C, then Cmd+V at frame 5 pastes the last key's drawing plus holds over frames 5-10.
- **Suggested fix:** In `settleLenDrag`, after a committed shrink, clear the selection (or clamp it to `frameCount`), as `commitStructural` does. The resize drag changes this row's frame mapping, so it should do the same.

- **Verifier:** `settleLenDrag` (`Timeline.svelte:989-1031`) ends in `applyAnimationLength(end); commitStructuralEdit(undo)` (`:1028-1029`). Neither `applyAnimationLength` (`appState.svelte.ts:2272-2287`), `revertStructural` (`:2292`) nor `commitStructuralEdit` clears `timelineSelection`. Only `commitStructural` (`:782`), undo/redo (`:2867`, `:2893`), `resizeProject` and a few other sites do. Nothing in `lenGripDown` clears it either. The Length FIELD path goes through `commitStructural`, so only the ruler drag is affected. The paste claim holds: `copyBlock` materializes the leading cell through `resolvedDisplayKeyCell` → `resolveKeyframeIndex`, which clamps `frame` to `cells.length - 1` and walks back (`document.ts:569-575`), so it copies the last key. App.svelte's Cmd+C, Cmd+X and Delete (`:190-200`) act on the stale selection. Delete past the end is harmless (it changes nothing). Minor is right.


## Batch D — performance (FIXED)

### 26. Onion scratch is allocated at outputScale but every ghost is rendered at 1× into its top-left quarter — up to 4× the memory for nothing, and ghosts upsampled when zoomed

**FIXED 2026-10-17** in `7e0789b` (branch `fix/review2-batch-d`).

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — perf — `src/anim/onion.ts:152-158`, `src/lib/Canvas.svelte:513-516` (area: model-render)

- **Problem:** `sizeDisplay()` sizes `scratch` to `W·DPR·ss`. `drawGhost` then does `scratch.setTransform(1,0,0,1,0,0)`, clears only `w×h` (doc size) and composites the ghost at identity, so only the top-left `1/ss²` of the scratch is ever used. `display.drawImage(scratch.canvas, 0, 0)` under the display's `ss` transform then stretches that 1× image up by `ss`. Placement is right, but at ss = 2 the scratch costs 4× the memory it uses (33 MB of a 1920×1080 doc, 133 MB at UHD — exactly the iPad image-memory pressure the shared Canvas-resolution note warns about), and the ghosts are the one part of the display NOT supersampled, so a scaled-down layer's ghost is blurrier than the frame drawn over it. The uncleared remainder of the scratch also holds stale off-paper pixels from earlier ghosts (harmless only because they land outside the display).
- **Scenario:** zoom to 200 % with onion on: the scratch reallocates to 2×2 the doc size; ghosts of a 50 %-scaled layer look soft next to the current drawing.
- **Suggested fix:** either size `scratch` at 1× (W·DPR × H·DPR) and keep the 1× ghost, or give `drawGhost` the same `outputScale` transform (`scratch.setTransform(ss,0,0,ss,0,0)` and clear the whole canvas) and draw it back at identity.

- **Verifier:** `drawGhost` (`src/anim/onion.ts:150-155`) resets the scratch to identity and clears only `w×h = project.width·dpr × project.height·dpr`. Both draw paths (`compositeFrameLayers`, or `drawImage`/`drawCellComposed` of the cell) and the `source-in` tint fill (`:217-221`) cover only that top-left region. `display.drawImage(scratch.canvas, 0, 0)` (`:224`) then runs under the display's `setTransform(outputScale…)` (`:250`), so the whole `w·ss`-sized scratch is stretched by `ss`. The used `w×h` part lands exactly on the display, and the rest falls off-canvas. Placement is therefore correct, but the ghosts are upsampled 1× pixels, and at ss = 2 the scratch holds 4× the pixels it uses: 33 MB at 1920×1080, 133 MB at UHD, which also makes finding 1 worse. The stale out-of-region pixels never reach the display, so they are harmless as the review says. Line numbers are right (the scratch sizing is at Canvas.svelte:513-516).

### 27. Hidden (or group-hidden) video references are still exact-seeked on every scrubbed frame, and each seek's `repaint()` forces a second full recomposite

**FIXED 2026-10-17** in `7620c4d` (branch `fix/review2-batch-d`).

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — perf — `src/anim/reference.ts:95-124`, `src/lib/Toolbar.svelte:153` (area: model-render)

- **Problem:** `syncReferenceVideos` gates only on `isRefVisibleAtFrame` (the clip's frame span); it never checks `layer.visible` / the group's visibility. Paused, every playhead change sets `vid.currentTime` on a hidden ref (a hardware decode on iOS — the cost gotcha #17 measured), and the `seeked` listener installed at load (`() => repaint()`) bumps `state.version`, so the Canvas tick runs `syncComposeSteps` and a full `recomposite()` a second time for a frame nobody can see. While playing, the "hidden + audio = audio only" decision needs hidden refs WITH audio to keep running, but a hidden muted ref has no reason to decode at all.
- **Scenario:** import a video reference, hide it (or its group) to ink without it, scrub the timeline on iPad: every scrubbed frame still decodes the video and composites twice.
- **Suggested fix:** skip (and pause) a ref that is not `isLayerVisible` unless it is playing with `audioEnabled`; unhiding bumps the version, so the next tick re-seeks it.

- **Verifier:** `syncReferenceVideos` (`src/anim/reference.ts:95-124`) skips only `layer.media.type !== "video"` and refs outside their frame span (`isRefVisibleAtFrame`, `:107`). It never reads `layer.visible` or the group's visibility, so a paused, hidden ref still gets `vid.currentTime = clamped` (`:124`) on every playhead change. The Canvas tick calls it on every `version`/`playhead` change (`Canvas.svelte:2687-2698`), followed by `recomposite()`. The `seeked` listener is `() => repaint()` (Toolbar.svelte:114 and :153; `repaint` = `state.version++`, appState.svelte.ts:2633), so each landed seek triggers a second tick with `syncComposeSteps` plus a full `recomposite()`. That costs a hardware decode on iOS and a frame's worth of compositing for something not drawn. For a visible ref this second composite is needed; for a hidden one it is pure waste. While playing, a hidden muted ref also free-runs and decodes, as the review says.

### 28. An open Deform / Distort / Mesh lift re-renders the whole warped bitmap every animation frame while idle, now through an extra overlay-sized scratch

**FIXED 2026-10-17** in `985f180` (branch `fix/review2-batch-d`).

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — perf — `src/core/selection.ts:960` (area: selection)

- **Problem:** `drawOverlay` restarts its marching-ants rAF loop on every call (960) for any non-idle state. Each frame in `"warping"` re-runs `drawWarpedMesh` (993). That is `2·(rows−1)·(cols−1)` full-bitmap `drawImage` calls, each clipped to one triangle: 18 at the Deform default 4×4, 98 at 8×8. Since 646ddb7 each frame also clears and composites a scratch the size of the overlay (`meshScratch`). None of this changes between frames when no drag is happening; only the ants' dash offset moves. The Deform tool now lifts on arrival (Canvas.svelte tool effect ~2830), so simply having Deform selected keeps this running at display rate. On iPad that is constant GPU load and heat while the user is idle or drawing with another hand on the UI. The `"transforming"` state redraws only one image per frame, which is cheap.
- **Scenario:** Select Deform on a large drawing, raise the mesh to 8×8 with "+", and leave it. The page stays at ~100 large clipped blits per frame indefinitely (visible in a performance trace as continuous rAF work).
- **Suggested fix:** Cache the warped float in a canvas, keyed on `warpGrid`/rows/cols/contentAlpha/view, and rebuild it only in `updateDrag` / densify / view change. Let the per-frame loop draw the cached image plus the ants and handles.

- **Verifier:** `drawOverlay` (selection.ts:948-…) unconditionally reschedules itself with `requestAnimationFrame` (958-960) for any non-idle state with a rect, and in `"warping"` calls `drawWarpedMesh` (selection.ts:991-996) every frame: `2·(rows−1)·(cols−1)` clipped full-bitmap `drawImage`s (18 at the Deform default 4×4, Canvas.svelte:2010), plus since 646ddb7 a scratch clear and copy. One correction: the scratch is allocated overlay-sized but only the mesh's device box is cleared and copied (selection.ts:1191-1232), so per-frame scratch cost scales with the mesh box, not the whole overlay. Deform lifts on tool arrival (Canvas.svelte:2837-2839), so merely having Deform selected keeps this running; rAF is paused in a backgrounded tab, so it only burns while visible. A real but measured-nowhere perf/battery cost on iPad; minor is right.

### 29. A marquee drag re-evaluates the selection test for every frame cell of every row on every pointer event

**FIXED 2026-10-17** in `e907fd1` (branch `fix/review2-batch-d`).

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — perf — `src/lib/Timeline.svelte:1893-1899`, `:3574-3575` (area: timeline)

- **Problem:** `rowMoveAt` in marquee mode calls `setTimelineSelection` on every pointermove (and on every edge-scroll tick), always with a new `{anchor, focus}` object, even when the column and row under the pointer have not changed. `selRect` is `$derived` from it and always returns a new object, so every row's `{#each Array(frameCount)}` re-runs `{#if inSelection(layer.id, f)}`, which costs `layerIds.includes` per cell. With a Pencil at 120-240 Hz that is rows × frames checks per event (20 rows × 1000 frames is about 20k per event, millions per second) for a rectangle that usually has not moved. This is the gotcha #17 class (per-move work where the display cannot have changed). It is cheap per call, but on iPad the work grows with document length.
- **Scenario:** In a long document with many layers, drag a marquee slowly with the Pencil. Every sub-column move re-runs the full per-cell pass.
- **Suggested fix:** Skip `setTimelineSelection` when the focus `layerId` and `frame` equal the current focus. Optionally, draw the wash as one absolutely positioned rectangle per row (start/end) instead of one `{#if}` per frame.

- **Verifier:** in marquee mode `rowMoveAt` (`Timeline.svelte:1893-1899`) calls `setTimelineSelection`, which always assigns a fresh `{anchor, focus}` (`appState.svelte.ts:2915-2916`), with no equality check on the focus. `selRect` (`Timeline.svelte:1274-1283`) is a `$derived` that returns a new object from `resolveSelectionRect` each time. Every `{#if inSelection(layer.id, f)}` inside `{#each Array(frameCount)}` (`:3574-3575`) reads it, so all rows × frames blocks re-run per event. Each one does `rowMovesWithBlock` and `layerIds.includes`, which is cheap. Nothing virtualizes frames or coalesces to rAF on this path. The finding counts edge-scroll ticks as triggers too, and that holds (`armRowEdgeScroll` re-calls `rowMoveAt`). The real cost on iPad has not been measured, so minor (perf) is right.


## Batch E — UI and input

### 30. A focused `<select>` keeps focus after a canvas press, so every shortcut is dead and typed tool keys retype the brush or the key's easing

**verdict:** confirmed (the dead shortcuts) / plausible (the typeahead retyping) — **severity:** major — **reviewer:** major — ui — `src/App.svelte:144`, `src/lib/Canvas.svelte:334`, `src/lib/Canvas.svelte:2618-2622`, `src/lib/ToolOptions.svelte:121`, `src/lib/TrackKeyControls.svelte:183` (area: ui-input)

- **Problem:** Batch E (`f23be5a`) made `onKey` and `onViewKeyDown` return early when the target or active element is a SELECT ("a dropdown keeps its own keys"). The batch-E canvas fix (`blurTextEntry`, Canvas 2618) blurs only `isTextEntry` elements, and `input.ts onPointerDown` preventDefaults the press, so focus never leaves a SELECT. After you pick a brush type (ToolOptions:121) or an easing (TrackKeyControls:183), the select stays focused through any number of strokes. Every single-key shortcut, Enter/Escape, arrows, `[ ]`, Delete, Cmd+C/X/V, Space-pan and `0`/`1` are skipped (only Cmd+Z, above the guard, still works). Because nothing calls preventDefault, the browser's typeahead on a focused, closed select gets the letter instead.
- **Scenario:** On desktop (or iPad with a keyboard), pick "Ink" in the brush-type menu, draw a stroke, then press `s` for Select: the brush type silently becomes "Smooth" and the tool doesn't change. `p` gives Pencil, `w` gives Watercolour, `c` gives Charcoal. Or pick "Ease out" on a track key, click the canvas, and press `e` for the eraser: the key's easing changes to "Ease in" through `setTrackKeyInterp`, an undoable document edit the user never asked for.
- **Suggested fix:** Have the canvas press also blur a focused SELECT (extend `blurTextEntry`), and/or `blur()` both selects in their `change` handlers. Keep the SELECT guard only for keys pressed while it is really being operated.

- **Verifier:** In the app the path checks out. `App.svelte:143-144` returns on `isTextEntry(target)` and on `target.tagName === "SELECT"`, and `Canvas.svelte:333-334` does the same in `onViewKeyDown`. The stage's capture-phase `blurTextEntry` (`Canvas.svelte:2618-2623`) blurs only `isTextEntry` elements, and `text-entry.ts` returns false for SELECT. `input.ts:152` preventDefaults the pen/mouse press, and the code's own comment (Canvas 2613-2616) records that this stops the focus change. So a select that has focus keeps it through strokes. Only Cmd+Z (above the guard) still works, and nothing else does until something else takes focus. The "dropdown keeps its own keys" guard was deliberate (`f23be5a`), but only to let the select's own keys work. The commit says nothing about a canvas press leaving the select focused, so this is a gap, not a decision. Not traced: whether the browser runs its typeahead on a closed, focused select and fires `change` (`bind:value` → `brushType`; `onchange` → undoable `setTrackKeyInterp`). That is standard on desktop Chrome, but I could not run it here: a Playwright repro hung at browser launch in the sandbox. It also depends on whether a click focuses a select at all (macOS Safari may not). Major holds for desktop and keyboard users; with a Pencil and no keyboard there is no impact.

### 31. The window `paste` handler turns any paste into a new reference layer: in a text field, under a modal dialog, during an export

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — ui — `src/App.svelte:304` (area: ui-input)

- **Problem:** `onPaste` (bound with `<svelte:window onpaste>`) checks only `currentPasteRoute() !== "image"`. It has none of `onKey`'s guards: `isTextEntry(target)`, `modalOpen()` and `state.exportBusy`. A `paste` event inside a text field bubbles to the window. With no cell clipboard the route is "image", so when the OS clipboard holds an image file, the handler calls `e.preventDefault()`, which stops the text paste, and then calls `pasteImageReference(blob)`. That adds an undoable reference layer behind whatever is focused. "Copy image" in a browser puts both the image and text/html on the clipboard, and the loop skips the string items to find the file. During an export, `onKey` returns at `exportBusy` without preventDefault, so Cmd+V still produces the `paste` event and adds a layer (with `liftGuard.bank` and an undo push) mid-render.
- **Scenario:** Copy an image in Safari. Open Document ▸ Project settings…, or double-tap a layer name to rename it, and paste: no text goes in, and a new image reference layer appears in the layer list behind the dialog.
- **Suggested fix:** At the top of `onPaste`, return when `state.exportBusy || modalOpen() || isTextEntry(e.target as HTMLElement)`, the same gates as `onKey`.

- **Verifier:** `onPaste` (`App.svelte:304`, bound at `:799`) checks only `currentPasteRoute() !== "image"`. In a text field, `onKey` returns at `isTextEntry` (`:143`) before any preventDefault. With a modal open or `exportBusy` it returns at `:129-130`, also without preventDefault. So the browser's `paste` event fires and bubbles to the window either way. If the clipboard holds an image file item, `onPaste` preventDefaults (the text paste is lost) and calls `pasteImageReference`, which adds a layer through `addLayerToProject` (`appState.svelte.ts:805`, with `liftGuard.bank` and `commitStructural`). Nothing there checks `exportBusy`, so the live project changes mid-render, which the export gate exists to prevent. Whether a "Copy image" clipboard exposes a `file` item next to text/html depends on the browser, but Chrome and Safari both do for image/png. Minor is right: the case is uncommon and the layer can be undone. The export case is the worst of them, because it can change the rendered file.

### 32. Finger pan, pinch and two-finger undo still act during a Pencil drag of a transform gizmo handle

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — wrong-place — `src/core/touch-gestures.ts:121`, `src/core/input.ts:148-151`, `src/lib/RefTransformGizmo.svelte:315` (area: ui-input)

- **Problem:** The batch-A fix (#4) suppresses finger gestures while `callbacks.isDrawing()` is true, and Canvas wires that to `input.isDrawing()`. But `input.ts onPointerDown` returns early for a `[data-ref-handle]` target (`isStageChromeTarget`), so a Pencil drag on a gizmo handle (`RefTransformGizmo.startHandleDrag`, for a reference, a layer or a group) never sets `isDrawing`. A finger landing during that drag is not suppressed, and it pans or pinches the viewport. The gizmo recomputes the transform from `vp.screenToCanvas(e.clientX, e.clientY)` on every move (line 315), so the same pen position now maps to a different canvas point.
- **Scenario:** With the Transform tool, drag a scale or rotate handle with the Pencil and let a finger or palm touch the canvas and slide: the view pans under the pen, and the layer's scale or rotation jumps although the Pencil is still. A two-finger tap mid-drag undoes (the guard settles the drag first, but the gesture is lost).
- **Suggested fix:** Make `isDrawing` also report an open gizmo handle drag (for example `input.isDrawing() || gizmoDragOpen()`, or a shared "pen gesture open" flag the gizmo sets in `startHandleDrag` and clears in `settleDragUndo`).

- **Verifier:** `input.ts:149` returns for `isStageChromeTarget`, which covers `[data-ref-handle]` (`:49`), before `isDrawing = true` (`:154`). So during a gizmo handle drag (`RefTransformGizmo.svelte:234 startHandleDrag`, window listeners at `:298-300`), `Canvas.svelte:2636`'s `isDrawing: () => input.isDrawing()` returns false. `touch-gestures.ts:121` therefore never sets `suppressed` for a finger that lands on the canvas (a finger on a handle is exempt at `:116`, but a palm on the canvas is not). The pan or pinch changes the viewport, and the next pen `pointermove` maps through the new view (`:315`), so the handle moves to wherever the pen is now over the content. A two-finger tap still runs `onUndo`, and the guard settles the drag. The gizmo's pointerId filter (`:306`, `:329`) only stops the finger from DRIVING the handle, not from moving the view. Minor: whether iPadOS palm rejection delivers the palm at all varies; a deliberate finger does reproduce it.

### 33. NumberField scrub doesn't filter by pointerId: a second contact (a resting palm) drives or ends the scrub

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — ui — `src/lib/NumberField.svelte:65-118` (area: ui-input)

- **Problem:** `onPointerDown` doesn't record `e.pointerId`, and the window-level `onPointerMove` / `onPointerUp` (and `pointercancel`) accept any pointer. `dx` is `e.clientX - scrub.startX`, so a move from another contact is read as a huge or negative drag, and any other contact's up or cancel ends the gesture and commits. The timeline fix in batch C (#20) addressed this same class there.
- **Scenario:** On iPad, scrub Length (Playbar, commit-only) or brush size with the Pencil while a palm or finger touches down elsewhere and moves: the value jumps to wherever the palm's x position puts it. When the palm lifts or is cancelled, `onCommit` runs with that value; for Length that is `commitLength`, a destructive shorten. If two NumberFields are scrubbed at once, each pointer drives both.
- **Suggested fix:** Store `pointerId` in `scrub` and ignore move/up/cancel events from other pointers.

- **Verifier:** `NumberField.svelte:65-77` stores no `pointerId`. The window `pointermove`/`pointerup`/`pointercancel` handlers (`:79`, `:108`) take any pointer. A second contact's x is read as `dx` from the first press, and its up or cancel ends the scrub and runs `onCommit`. Touch events captured by `touch-gestures` (`setPointerCapture` on the workspace) still bubble to `window`, so a finger on the canvas while scrubbing both pans and drives the field. Two fields scrubbed at once each react to both pointers. One correction to the severity text: "a destructive shorten" overstates the Length case. `applyAnimationLength` (`appState.svelte.ts:2272`) runs inside an undoable commit (its comment cites the Length field's `commitStructural`), so the shorten can be undone. Minor.

### 34. The loop arrowhead drag accepts any pointer's move and lift, so a second contact ends or drives the Pencil's drag; a finger on the arrowhead cannot pan

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — ui — `src/lib/Timeline.svelte:1750-1765`, `:1737` (area: timeline)

- **Problem:** `loopHandleMove` checks only `loopDrag.layerId === layer.id`, and `loopHandleUp` checks nothing. The #20 fix (owning pointer) covered the row, clip and audio-lane drags, but not this one. Touch pointers are implicitly captured by their pointerdown target, so a finger pressed on any arrowhead keeps sending its move/up events to that handle. Its `pointerup` (or `pointercancel`) runs `settleLoopDrag` and commits the Pencil's drag halfway through. On the same layer, the finger's moves also set `back` from the finger's column. `loopHandleDown` also calls `stopPropagation()` before it returns on a finger, so a finger on the arrowhead neither pans nor starts anything, leaving a dead zone in an otherwise pannable row.
- **Scenario:** Pencil drags the arrowhead of a loop on row 1, and a finger taps another loop's arrowhead (any row). The drag ends at that moment with whatever `back` it had. Later Pencil moves do nothing, and the release commits nothing further.
- **Suggested fix:** Store `pointerId` in `loopDrag`, ignore other pointers in move/up/cancel, and for a finger call `touchPanDown` (with capture) instead of returning after `stopPropagation`.

- **Verifier:** `loopHandleDown` (`Timeline.svelte:1735-1749`) calls `e.stopPropagation()` first and then returns for a non-fine pointer. With Svelte 5 delegation (gotcha #12) that stops the row's `rowDown`/`touchPanDown`, so a finger on the handle neither pans nor does anything else. `loopHandleMove` (`:1750-1761`) checks only `loopDrag.layerId === layer.id`, and `loopHandleUp` (`:1762-1765`, also bound to `pointercancel` at `:3565`) settles without checking `pointerId`. A finger that lifts on any arrowhead therefore runs `settleLoopDrag` mid-Pencil-drag, which commits or reverts and nulls `loopDrag`, so the Pencil's later moves do nothing. On the same layer, a finger's moves rewrite `back` from the finger's column. The route depends on the handle being only 16×8 px (`h-2 w-4`, `:3555`), so a stray contact has to land on that strip. That keeps it minor, and how often it happens on iPad is the only part that can't be traced. Line numbers are correct.

### 35. In the Home Screen app, an export the share sheet refuses says "Done.", and the sticky "couldn't save" alert is cleared by the next autosave

**verdict:** confirmed — **severity:** minor — **reviewer:** minor — ui — `src/lib/deliver-file.ts:33-36`, `src/lib/ExportDialog.svelte:185/199/217/237`, `src/App.svelte:340` (area: persist-export)

- **Problem:** `deliverToFiles` returns `"failed"` and sets `persistAlert` when `isStandalone()` and `!canShareFile(file)`. `ExportDialog.deliver` maps that to `false` ("keep the dialog open"), and every branch then sets `status = "Done."`. So the dialog says Done while no file exists. The alert is meant to be sticky, but `onAutosaveOk` clears any `persistAlert` other than the pause on the next successful autosave, a few seconds after the next edit.
- **Scenario:** In the Home Screen app, export a format the sheet won't take (WebM/PSD where unsupported). The export dialog shows "Done." and the alert goes away after the next stroke, with no file written.
- **Suggested fix:** Have `deliver` return the outcome and set `status` to a failure line on `"failed"`. Have `onAutosaveOk` clear only the alerts it owns (the "Autosave is failing" text) rather than any alert.

- **Verifier:** `deliverToFiles` returns `"failed"` and sets `persistAlert` in standalone mode when `!canShareFile` (`src/lib/deliver-file.ts:33-37`). `ExportDialog.deliver` (`src/lib/ExportDialog.svelte:59-66`) collapses that to `false`, and every branch then sets `status = "Done."` (lines 185, 199, 217, 228 for video, 237), shown at :503. `onAutosaveOk` (App.svelte:340-343) clears any `persistAlert` except while halted, so the next successful autosave after an edit wipes the "Couldn't save" text. The code path is certain. Whether iOS `canShare` actually refuses a given type (PSD's `image/vnd.adobe.photoshop`, WebM) is device behaviour I cannot trace, but the code would mislead whenever it does.
