# Timeline markers — design

**Status:** draft for review · **Date:** 2026-09-13 · **Branch:** `feat/timeline-markers`

## The ask

> "what do you think about adding timeline markers feature (slop-compositor has it) or does it feel
> as a overreach?" … "No specific reasons, it might be anything that needs navigational help or maybe
> even short todo notes etc"

General-purpose, labelled, per-frame markers: a way to find your way around a long timeline, and
room for a short note ("fix hand", "beat 3"). The concept comes from slop-video-compositor
(`Marker { id, t, label }`). Its interactions don't all carry over: rename there is a double-click
and delete is Alt+click, and neither works with a Pencil.

## Decisions (settled in brainstorming)

| Question | Answer |
|---|---|
| Text | **Short label only.** One line, no longer note. Rejected: label plus a multi-line note, and one free-length text field. |
| Placement | **Own strip under the ruler**, always shown. Rejected: flags inside the 29px ruler (the playhead badge covers the whole ruler height, tick numbers collide, and marker taps would fight scrubbing); a strip that only appears once a marker exists (the timeline jumps by a row). |
| Gestures | **Add at the playhead; tap = jump; tap again = edit popover; drag = move.** Rejected: tap an empty spot in the strip to add (stray taps create markers); long-press to edit (hidden, and has to be told apart from a slow drag). |
| Identity | **One marker per frame; the frame is the identity** (no id). |
| Frame deleted under a marker | **Moves onto the next frame; labels are joined if that frame already has one.** Rejected: delete it with the frame. |
| Animation shortened | Markers past the new end are **removed**, in the same place the cells are cut. Undoable. |
| Add button | **＋ in the strip's own name column**, not the timeline toolbar. The frame-tool group has a documented "positions must not shift" rule, and the toolbar already wraps in portrait. |
| Strip scrolling | **Scrolls vertically with the rows, like the audio lane.** It is not sticky; pinning it is deferred because of gotcha #14. |
| Colour | **Neutral** (text colour). Amber is "why this won't land" here, teal is loop, red is the playhead. |

## 1. Model — `src/anim/document.ts`

```ts
/** A navigation/note mark on one document frame. Never rendered into an export. */
export interface Marker {
  frame: number; // 0-based document frame, integer ≥ 0
  label: string; // one line, already trimmed; "" = unlabelled (flag only)
}

interface Project {
  // …existing fields…
  /** Sorted by `frame`, at most one per frame. Absent = none. */
  markers?: Marker[];
}
```

- **Invariants:**
  - `markers` is sorted ascending by `frame`.
  - Frames are unique.
  - Every `frame` is an integer ≥ 0.
- **No mutation in place** (gotcha #8). Every write replaces the array and any changed `Marker`
  object. The undo snapshot can therefore hold the array by reference.
- **Label length:** the input field caps typing at **40 characters** (`maxlength`). The model does
  NOT cap labels. A joined label (§2) can be longer, and it must survive save/load intact. The UI
  cuts it off for display.

## 2. Pure operations — new `src/anim/markers.ts`

All functions are pure. They take a `readonly Marker[]` and return a new array, or the same array
when nothing changed, so a caller can skip a no-op commit.

| Function | Behaviour |
|---|---|
| `markerAt(ms, frame)` | The marker on `frame`, or `undefined`. |
| `addMarker(ms, frame, label = "")` | Inserts in sorted position. **Returns `ms` unchanged if `frame` is occupied.** The caller opens the existing marker's editor instead. |
| `removeMarker(ms, frame)` | Removes it. Unchanged if absent. |
| `renameMarker(ms, frame, label)` | Trims the label. Unchanged if the marker is absent or the label is the same. |
| `moveMarker(ms, from, to)` | **Unchanged if `to` is occupied** (the caller shows a refusal hint), if `from` is absent, or if `from === to`. Otherwise re-sorts. `to` is clamped to ≥ 0. |
| `shiftMarkers(ms, at, delta: 1 \| -1)` | Ripple for one inserted or deleted frame (§3). |
| `truncateMarkers(ms, frameCount)` | Drops every marker with `frame ≥ frameCount`. |
| `nextMarkerFrame(ms, frame)` / `prevMarkerFrame(ms, frame)` | The nearest marker frame strictly after / before, or `null`. |
| `joinLabels(a, b)` | Joins the non-empty labels with `" · "`, earlier frame's label first. Two empty labels give `""`. |
| `sanitizeMarkers(raw, frameCount)` | Loader guard (§5). |

## 3. Frame rules

### Insert frame (all layers) — `insertFrameAllLayers(project, at)`

Markers with `frame ≥ at` move to `frame + 1`. This is the same rule `shiftStartFrame` applies to
the audio offset and track keys.

### Delete frame (all layers) — `deleteFrameAllLayers(project, at)`

- Markers with `frame > at` move to `frame − 1`.
- A marker **on** `at` stays on `at`, which now shows what used to be `at + 1`.
- If both `at` and `at + 1` had a marker, they collide on `at`. They are **joined** into one marker
  with label `joinLabels(label@at, label@at+1)`. No label is dropped.

Both shifts go into `rippleDocumentFrames` (`src/anim/timeline.ts`), after the audio shift:
`if (project.markers) project.markers = shiftMarkers(project.markers, at, delta);`.
`rippleDocumentFrames` is the single place document-frame data ripples, so both the insert and the
delete path get it.

### Animation length — `applyAnimationLength(n)` (`appState.svelte.ts`)

After the cells are resized:
`if (state.project.markers) state.project.markers = truncateMarkers(state.project.markers, target)`.
Both the Playbar Length field (`setAnimationLength`, inside `commitStructural`) and the ruler length
drag (a begin/commit bracket) go through `applyAnimationLength`, so both get it. Both are already
undoable, and undo restores the markers with the cells. A live drag that shrinks and then grows
again loses the cut markers until release, exactly as it already loses the cut cells. Abandoning the
drag (`revertStructural`) brings both back.

### Not rippled

Single-layer edits leave markers alone, just as they leave the audio and reference ranges alone:
paste-insert (`pasteBlockInsert`), hold-span resize, and `deleteTimelineSelection` (which replaces
cells with holds and doesn't shift anything).

### Out-of-range markers at render

`frameCount` is re-derived from the cells in `bump()`, so in principle it can drop below a marker
without going through `applyAnimationLength`. The strip renders only markers with
`frame < frameCount`, and the next/prev jumps ignore the others. They are not deleted there.
Deleting outside an undoable edit would be a silent data change.

## 4. Undo — `src/state/appState.svelte.ts`

- `StructSnapshot` gets `markers: Marker[] | undefined`. `snapshotStructure` captures
  `state.project.markers` by reference, which is safe under §1's no-mutation rule.
- `restoreStructure` assigns `state.project.markers = s.markers`. It does this unconditionally,
  including `undefined`, so undoing the first add clears the field.
- **New actions** (each one undo step, each a no-op that pushes nothing when the pure op returns the
  same array):
  - `addMarkerAtPlayhead(): "added" | "exists"`
  - `renameMarkerAt(frame, label)`
  - `deleteMarkerAt(frame)`
  - `moveMarkerTo(from, to): boolean` (false = refused, frame occupied)

  Each calls `commitStructural(() => { state.project.markers = next })`.
- The no-op check runs **before** `commitStructural`, not inside the mutate callback, because
  `commitStructural` always pushes (the `setAnimationLength` comment records this trap).
- A drag doesn't touch the document while it runs (§6). One `moveMarkerTo` on release is the whole
  gesture, so there is no begin/revert bracket and no per-pointermove entry.
- **`commitStructural` side effects to be aware of:** it clears `timelineSelection` and runs
  `resolveStaleTrackFocus`. A marker edit clearing a cell-block selection is acceptable: every other
  structural edit already does it. Still, the plan should check this doesn't feel wrong when you
  rename a marker in the middle of a selection. If it does, marker edits get a lighter commit path
  that snapshots and pushes without those side effects.

## 5. Save file — `src/persist/project-file.ts`

- `ProjectJson` gets `markers?: { frame: number; label: string }[]`. `version` stays `1`, the same
  way `transparentBg` and `tracks` were added.
- `projectToJson` writes `markers` only when the array is non-empty.
- **The loader** runs `project.markers = sanitizeMarkers(json.markers, project.frameCount)` after
  `refreshLength(project)`, so `frameCount` is the real value. `sanitizeMarkers`:
  - Not an array → `undefined`.
  - Drops entries whose `frame` is not an integer, is `< 0`, or is `≥ frameCount`.
  - A non-string `label` becomes `""`. String labels are trimmed and **not** length-capped (§1).
  - Sorts by frame.
  - Duplicate frames are joined with `joinLabels`, in file order.
  - An empty result → `undefined`.
- Autosave needs no change: it serialises the same `Project`, and every marker action calls
  `bump()` through `commitStructural`, which marks the project dirty.
- `replaceProject` and new projects start with `markers` absent.
- **Export:** markers are never drawn. `renderFrame`/`compositeFrameLayers` never read them, and
  nothing in this spec adds a reader there.

## 6. UI — `src/lib/Timeline.svelte` + new `src/lib/MarkerStrip.svelte`

Most of this goes in a new component, `MarkerStrip.svelte`, so `Timeline.svelte` (3,623 lines)
gains only a mount and its props. `AudioLane` is the model: `cellW`, `labelW`, `markerW`,
`minWidth`, the touch-pan and edge-scroll callbacks, `getScrollLeft`, and `didPan`.

### Strip

- **Where:** mounted directly after the ruler row and before `<AudioLane>`.
- **Height and scrolling:** one row about 20px tall (the plan picks the exact height to match the
  row rhythm), `w-max`, with `min-width: stripMinW`. Like the audio lane, it is **not** vertically
  sticky; it scrolls with the rows.
- **Left column** (`LABEL_W`, `sticky left-0 z-20 bg-surface`): the text "Markers" and a ＋ button,
  title "Add marker at playhead (N)".
- **Glyph column** (`MARKER_W`, the lock/hidden-glyph column): empty, reserved so the columns line
  up with the rows below.
- **Frame area:** `touch-action: none` (gotcha #10). Each marker with `frame < frameCount` is
  absolutely positioned at `frame × cellW`.

### Marker

- **Look:**
  - A downward 8×4 flag whose tip sits on the column's left edge.
  - A 1px stem down the height of the strip.
  - A pill label to the right: ~10px text in the ground colour on `--color-text`, max ~80px, cut
    off with "…".
  - An empty label shows the flag only.
  - All neutral: `text` / `text-muted`, never `warn`, `accent`, `loop` or `danger`.
  - The marker on the playhead's frame gets a subtle emphasis (e.g. full-opacity stem). The exact
    style is left to the plan.
- **Hit area:** the flag plus the label, at least 24px wide and the full strip height.
- **Title** (shown in the status bar on press): `Marker: <label or "unlabelled"> · tap to jump,
  tap again to edit, drag to move`.
- **Element and pointer handling:** each marker is a `<button>`. Pointer handlers go on the button,
  and move/up/cancel go on `window` for the length of the gesture, filtered by `pointerId`. This is
  the same pattern as the key drag. `pointercancel` cancels (see the table below).
- **Finger:** a finger goes to `onTouchDown` and pans, the same as the ruler and the audio lane.
  `isFinePointer` is private to `Timeline.svelte` (`:326`). The plan either passes it in as a prop
  or moves it to a shared module; it is not duplicated.

### Gestures (pen or mouse)

| Input | Result |
|---|---|
| Press and release within `MOVE_CANCEL_PX`, playhead **not** on the marker | `seekPlayhead(frame)` |
| Press and release within `MOVE_CANCEL_PX`, playhead **already** on the marker | Open the editor popover |
| Move beyond `MOVE_CANCEL_PX` | Drag. A local `dragFrame` preview (the marker draws at `round((x − stripLeft) / cellW)`, clamped to `0 … frameCount − 1`) plus edge-scroll. The document is not changed. |
| Release after a drag | `moveMarkerTo(from, dragFrame)`. If refused: preview cleared and `statusHint = "Frame N already has a marker"` (N 1-based). If `dragFrame === from`: nothing. |
| `pointercancel` (e.g. iPad palm rejection) | Cancel: preview cleared, nothing committed. Nothing was changed during the drag, so there is nothing to settle. |

There is no Escape-to-cancel for a drag. Escape already cancels the selection/pose in `App.svelte`,
so one key would do two things, and a pen drag has no keyboard in hand anyway.

### Editor popover

- **Where:** `position: fixed` and anchored under the marker's flag (the timeline's scroll box
  clips `absolute` popovers; this is the `.curve-popup` trap). It closes on outside press
  (`clickOutside`) and on scroll.
- **Contents:**
  - A text input (`maxlength=40`, value = the label, focused and selected on open).
  - A **Delete** button (`deleteMarkerAt`, closes the popover).
- **Keys:**
  - **Enter** or an outside press → `renameMarkerAt` (a no-op if unchanged), then close.
  - **Escape** → close without saving.
  - The input stops propagation of `keydown` so typing `n`, `<` or `>` does nothing else. The
    app-level handler already ignores `INPUT`.
- **Playhead moves while open:** the popover closes and saves, the same as an outside press.

### Add

The ＋ button and the `n` key both call `addMarkerAtPlayhead()`:

- `"added"` → open the editor on the new marker with an empty field.
- `"exists"` → open the editor on the existing marker.

**iPad keyboard caveat:** Safari shows the on-screen keyboard for `focus()` only inside a user
gesture. The ＋ tap is one, but `n` from a hardware keyboard doesn't need the on-screen keyboard
anyway. If focus-on-open doesn't bring up the keyboard after a ＋ tap on iPad, the fallback is that
the field is focused but you have to tap it. This goes on the verification list.

### Keys — `App.svelte` `onKey`

These are placed in the single-key chain, after the tool keys. They're unused today; the app
already uses `b e g s l w m o k`, `, .`, `[ ]`, `0 1` and Space.

- `n` → add a marker at the playhead, then open the editor (the Timeline exposes an
  `openMarkerEditor(frame)` hook through a small ref object, the way `selectionActions` does).
- `<` → `seekPlayhead(prevMarkerFrame)`. `>` → `seekPlayhead(nextMarkerFrame)`. With no marker in
  that direction: `statusHint = "No marker before/after this frame"`, and the playhead doesn't move.
- `e.key` is `<`/`>` for Shift+`,`/`.` on US and most layouts. Layouts where it isn't just don't
  get the jump keys. Tapping a marker is the primary navigation.
- All of these are already skipped while a text field has focus and while an export is running
  (existing guards).

## 7. Out of scope

Marker colours or categories · longer notes · a marker list or panel · markers in exported files ·
other things (keys, play range, clips) snapping to markers · a sticky/pinned strip · per-layer
markers · a toolbar button. Each can be added later without changing the save format.

## 8. Testing

**Unit (Vitest, node):**

- `src/__tests__/markers.test.ts` — every function in §2:
  - sorted insert, and an occupied frame refused
  - no-ops return the same array
  - trim on rename
  - move refused onto an occupied frame
  - `shiftMarkers` insert at, before and after a marker
  - `shiftMarkers` delete on a marker, after it, and with a collision joined in order
  - `joinLabels` empty cases
  - `truncateMarkers`
  - next/prev at the ends
  - `sanitizeMarkers`: non-array, bad frames, out-of-range frames, non-string label, unsorted
    input, duplicates joined
- `insertFrameAllLayers` / `deleteFrameAllLayers` carry markers. Added next to the existing ripple
  tests.
- Save/load round-trip: markers survive `projectToJson` → load; absent markers stay absent; an
  over-40-character joined label survives.
- **Undo:** the store is imported by no test today (`appState.svelte` has no test file), so snapshot
  and restore are verified by review plus a browser pass, not by a unit test. If the plan finds a
  cheap way to exercise `commitStructural` in node, it adds an add → undo → redo test.

**Build:** `npm run build`, 0 errors, 0 warnings. `npm test` stays green, with the count updated
in the README.

**Browser pass (desktop, then iPad), flagged as owed if not done:**

- Add with ＋ and with `n`.
- Type a label.
- Tap to jump; tap again to edit.
- Drag with snapping and edge-scroll; drop on an occupied frame.
- Delete.
- Insert and delete frames around markers.
- Shorten with the Length field and undo.
- Save, reload and autosave restore.
- `<`/`>` jumps.
- Finger pans the strip.
- The popover isn't clipped at the timeline's edges.
- On iPad: the on-screen keyboard appears on ＋.

## 9. Docs

- **README:**
  - a Features bullet (timeline markers)
  - Keyboard: `n`, `<`, `>`
  - the test count
- **`CLAUDE.md`:** a one-line mention in "Current state".
- **`docs/superpowers/CHANGELOG.md`:** a dated entry.
- **`../SLOP-TIMELINE-UI.md`:** the "Named markers (compositor only)" line gains a note that
  slop-animator has them too, in neutral colour, in their own strip instead of the ruler. That file
  is in the parent `slop/` folder, which is not a git repository, so the edit is made in place and
  there is nothing to commit.

## Amendments from planning (2026-09-13)

Found while writing the plan (`docs/superpowers/plans/2026-09-13-timeline-markers.md`). Each change
below overrides the section it names.

1. **§6, the popover does not close on scroll.** On iPad the on-screen keyboard can scroll the page
   as it opens, which would close the popover the moment it appeared. It closes on an outside press,
   Enter, Escape, Delete, or the playhead moving.
2. **§6, the strip is `h-6` plus its border (25px),** matching the layer rows, not "about 20px".
3. **§2, `nextMarkerFrame(ms, frame, frameCount)`** takes the frame count, so a marker past the
   document end is never a jump target. `prevMarkerFrame(ms, frame)` doesn't need it, because the
   playhead is always inside the document.
4. **§4, `addMarkerAtPlayhead()` returns `void`.** Both callers (＋ and `n`) open the editor on the
   playhead frame whether or not a marker was added, so the `"added" | "exists"` result had no reader.
5. **§6, finger detection is `e.pointerType === "touch"`,** the same idiom `AudioLane.svelte` uses.
   Timeline's private `isFinePointer` is neither passed in nor moved.
6. **§5, the loader keeps markers past `frameCount`.** Found in the final review: §3 says a marker
   past the document length is HIDDEN by the strip, never deleted, because deleting outside an
   undoable edit is a silent data change — but §5 as written had the loader drop
   `frame >= frameCount` on load, which would silently delete a hidden marker on the very next
   reload. `sanitizeMarkers(raw)` no longer takes a `frameCount` parameter; it drops only entries
   whose frame is not an integer or is negative, and keeps everything else, including frames past
   any length. §5 above is unchanged text and is superseded by this amendment.
7. **§6, the editor popover also commits on `focusout`.** Found in the final review: a keyboard-only
   focus change (Tab from the input to the Delete button, or iPad's "hide keyboard") leaves the
   popover without any pointerdown for `clickOutside` to catch, so a typed `n`/⌘Z/Enter could reach
   App's shortcuts with the popover still open — losing the draft, moving another marker onto the
   edited frame before a stale commit, or toggling playback instead of deleting. The popover wrapper
   now commits on `focusout` when focus leaves the popover entirely, and stops propagation of every
   `keydown` so no key typed anywhere inside it reaches App's shortcuts. The Delete button no longer
   takes focus on pointer press (`preventDefault` on its `pointerdown`), so a mouse/Safari click
   doesn't trigger that focusout and unmount the popover before the click itself lands.
8. **§6, the strip is PINNED under the ruler and styled as part of the ruler header** (2026-09-14,
   asked after the first merge-ready build: "markers row looks like all the others … and also sticky
   and not scroll with other layers"). Supersedes the Decisions row "Strip scrolling" and §6's "not
   vertically sticky". Timeline's `sticky top-0 z-35` moved from the ruler row to a header wrapper
   holding the ruler row and the strip — one sticky element, not a second sticky row stacked under the
   first (gotcha #14); the ruler row became `relative`. The strip uses the ruler's tones
   (`surface-active` name/glyph cells and a band up to the last frame, `surface` past it) and closes
   the header with a `text-muted` bottom divider. Being opaque, it draws its own slice of the playhead
   line and the play-range lines (no 5-frame guides, like the ruler). A side effect: the editor
   popover can no longer open detached because the strip scrolled out of view vertically.
9. **§6, own tone, toolbar button, lane shown only with markers** (2026-09-14, asked right after
   amendment 8: "marker lane could be distinctive maybe with bg color between the ruler and layer
   lanes. And we could move marker adding button to the main toolbar and show marker lane only if
   there are any markers"). Supersedes amendment 8's tones, the Decisions rows "Add button" and
   "Placement … always shown", and §6's ＋ in the name column. The lane's tone is a 50/50
   `color-mix` of `surface-active` and `surface` (name/glyph cells and a band up to the last frame;
   `surface` past it). The add button is `BookmarkPlus` "Add marker at playhead (N)" in the timeline
   bar's range group, after Out and before the conditional clear ✕; the lane has no ＋ and its label
   icon is `Bookmark`. The lane renders only while at least one marker is inside the document; the
   `MarkerStrip` component stays mounted so `markerActions.openEditor` is always registered, and
   `openEditor` awaits `tick()` before measuring. The header height changes by one row when the first
   marker appears or the last disappears — the brainstorming concern about that jump is accepted.
10. **§6, a marker is one sideways-bookmark tag** (2026-09-14, asked with a zoomed screenshot: "wedge
    and line not aligned with ruler tick and each other … are these needed at all, perhaps only badge
    is enough? Maybe can try some distinctive shape - similar to icon for example but rotated 90
    degrees?"). Supersedes §6's "Marker — Look" (downward flag, 1px stem, pill label). The misalignment
    was three different pixel columns: the ruler tick is `right-0 w-px` in the PREVIOUS cell (one px
    left of the boundary), the stem `left-0 w-px` in the marker's own cell (one px right of it), and
    the wedge centred on the boundary. Now: the button sits at `max(0, col * cellW - 1)` (frame 1 has no
    tick; the name column's divider is its edge) and holds a single
    16px tag — square left edge on the tick's pixel column, label inside (10px/600, `max-w-20`,
    ellipsis), a 5px notch cut into the right end by a `clip-path` polygon, at least 12px wide when
    unlabelled. Full `text` colour on the playhead's frame, `text-secondary` elsewhere; dark `surface`
    label text on both. No stem, no wedge. The button stays full lane height and ≥ 24px wide.
11. **§6, the lane's gutter cell shows the Bookmark icon only** (2026-09-14, asked: "should we have a
    label 'markers' at all in the gutter?"). The "Markers" word is removed: the lane appears only once
    a marker exists, the tags share the bookmark shape with the icon and the toolbar button, and the
    lane reads as part of the ruler header, whose own corner cell has no label. The icon stays,
    because the lane can be visible while every marker is scrolled out of view horizontally and an
    empty band would not explain itself. The cell keeps `title="Markers"` so a press shows the name
    in the status bar, and the cell itself stays (sticky, opaque, aligned with the rows' gutter).
12. **§6, the label editor opens at the top of the window, not beside the marker** (2026-09-14, iPad
    report with screenshots: "on creating marker, the popup rendered under the toolbar … and after
    creation large empty space created under the status bar"). Supersedes §6's "Editor popover" and
    amendment 1's placement. Cause: `#app` is `position: fixed` (app.css), whose documented cost is
    that iOS cannot scroll a focused input above the keyboard; the popover opened in the timeline,
    where the keyboard appears, so WebKit shifted the whole app up, the popover landed under the
    toolbar, and the page stayed shifted after the keyboard closed. Now: `MarkerEditor.svelte`,
    mounted in App in a zero-height anchor under the tool options row, a centred bar
    `Marker · frame N [label] [Delete]` (14px, max-w-sm). Same behaviour as before — opens pre-filled
    and focused; commits on outside press, Enter, focus leaving the bar, or the playhead moving;
    Escape closes without saving; keys inside never reach App's shortcuts; Delete does not take focus
    on press. `markerActions.openEditor` is registered by the editor and is synchronous again (no lane
    to measure). App.svelte also snaps a shifted page back to scroll 0 on focusout and visual-viewport
    resize, as a safety net. CLAUDE.md gotcha #15.
