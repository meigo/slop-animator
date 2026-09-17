# Drag-to-change number fields — design

**Status:** draft for review · **Date:** 2026-09-18 · **Branch:** `feat/drag-number-fields`

## The ask

> "some numeric fields are used in the UI but these are not comfortable to use. in slop-compositor
> inspector values can be changed by dragging. could this be adapted here as well?"

Every numeric field in this app is a bare `type="number"` input: to change fps you tap it, the iPad
keyboard opens, you type, you dismiss it. slop-video-compositor's inspector fields scrub — press and
drag sideways and the value follows — so typing is the exception rather than the only way.

The iPad case is stronger here than it is there. A tap on any field raises the on-screen keyboard,
and in Chrome for iPad that leaves the whole app shifted up (CLAUDE.md gotcha #15, an accepted Chrome
bug with four failed fixes behind it). A drag never focuses the field, so it never raises the
keyboard.

## What exists today

Nine `type="number"` inputs, all of them label-plus-field pairs:

| Field | File | Store path | Undoable today? |
|---|---|---|---|
| Brush/eraser size | `ToolOptions.svelte:109` | `stroke.size` (prefs) | no |
| fps | `Playbar.svelte:189` | `project.fps` + `bump()` | no |
| fps | `ProjectSettingsDialog.svelte:82` | `project.fps` + `bump()` | no |
| Length | `Playbar.svelte:212` | `setAnimationLength` | **yes** (structural, ripples) |
| Canvas W / H | `SizeDialog.svelte:104,114` | local `w`/`h`, applied on OK | n/a (dialog-local) |
| Pose gap | `Canvas.svelte:2459` | `appState.pose.gap` (session) | no |
| Video speed | `LayerProps.svelte:523` | `layer.speed` + `bump()` | no |
| Track step | `TrackKeyControls.svelte:212` | `setTrackSampleEvery` | **yes** (commits per call) |

The 22 `type="range"` sliders are out of scope: they already drag.

## Decisions (settled in brainstorming)

| Question | Answer |
|---|---|
| Which fields | **All nine.** One behaviour everywhere; a field that scrubs in one panel and not another is worse than neither. |
| What you drag | **The field itself**, as in the compositor. Rejected: the adjacent label (first choice in brainstorming, reversed once the compositor's approach was read) — a few words of text is a poor Pencil target, and it would differ from the sibling app. |
| Input type | **`type="text" inputmode="decimal"`**, the compositor's reason verbatim: a number input owns pointer gestures for its spinner, which is exactly the gesture the scrub needs. |
| Mapping | **Horizontal, quantised to the field's own step**, `pxPerStep` per field, measured from the press. |
| Fine modifier | **Shift = 4× more travel per step**, i.e. finer control on the SAME step grid. Rejected: the compositor's Shift = ×0.1 of the step — it produces 0.1 fps and 1.6px canvas widths. |
| Per-pixel undo | **Never.** Each field is live-and-not-undoable, live-inside-one-bracket, or commit-on-release (§4). |
| Sliders | Unchanged. |

## 1. `src/core/scrub.ts` — the arithmetic

Pure, no DOM, unit-tested. Mirrors slop-video-compositor's `scrub.ts`, with quantisation added.

```ts
/** Travel (px) before a press becomes a drag. Under this, it is still a tap that focuses the
 *  field for typing. Same value as the compositor's. */
export const SCRUB_THRESHOLD_PX = 3;

/** Shift makes each step cost this many times more travel — finer control on the SAME grid. */
export const FINE_FACTOR = 4;

export interface ScrubArgs {
  startValue: number; // value at pointerdown; the drag is measured from here, never accumulated
  dx: number; // clientX - startX
  step: number; // the field's own increment (0.5 brush size, 1 fps, 0.1 speed, 8 canvas px)
  pxPerStep: number; // horizontal travel worth one step
  fine: boolean; // Shift held
  min: number;
  max: number;
}

export function scrubbedValue(a: ScrubArgs): number;
```

Behaviour:

1. Non-finite `dx` → `startValue` (defensive, as the compositor does).
2. `steps = Math.round(dx / (pxPerStep * (fine ? FINE_FACTOR : 1)))` — **rounded**, so the value
   sits on the step grid and the field never shows `23.7000000001` fps.
3. `next = startValue + steps * step`, then snapped to the grid `min + k*step` and clamped to
   `[min, max]`. Snapping to the grid ANCHORED AT `min` (not at 0) keeps a dragged value landing on
   the same numbers the arrow keys and the old spinner produced.
4. Float cleanup: round to the decimals implied by `step` (`0.1` → 1 dp), so `0.1 * 3` is `0.3`.

Because the value is always derived from `startValue + dx`, dragging back to where you pressed
restores the original value exactly — the property the compositor's tests pin, and the reason this is
not an accumulating delta.

## 2. `src/lib/NumberField.svelte` — the control

```ts
interface Props {
  value: number;
  min: number;
  max: number;
  step: number; // typing/arrow increment AND the scrub grid
  pxPerStep?: number; // default 8
  decimals?: number; // display precision; default derived from `step`
  title?: string; // " · Drag to change" is appended by the component
  ariaLabel: string;
  disabled?: boolean;
  class?: string; // the call site keeps its own width/size classes
  onInput?: (v: number) => void; // every move of a live field; omitted = commit-on-release only
  onCommit: (v: number) => void; // pointerup after a drag, Enter, blur
}
```

**Markup:** one `<input type="text" inputmode="decimal">`. It stays an `<input>` deliberately —
`App.svelte:82` drops single-key shortcuts whose target is an INPUT/TEXTAREA, so a non-input widget
would make `b`, `e`, `f` etc. fire while the field is focused.

**Drag:**

```
pointerdown (button 0, not disabled)
  → remember { startX, startValue, moved: false }; add window pointermove/up/cancel listeners
  → NO preventDefault: the browser still focuses and places the caret, so a tap types as before
pointermove
  → until |dx| ≥ SCRUB_THRESHOLD_PX, do nothing
  → on crossing it: moved = true, input.blur() (a caret blinking in a scrubbing field is a lie)
  → draft = scrubbedValue(...); onInput?.(draft)
pointerup / pointercancel
  → remove listeners; if moved → onCommit(draft) (see §4); reset
```

`pointercancel` is bound to the same handler as `pointerup`: an OS-cancelled stream (iPad palm
rejection) must end the gesture, not leave it armed — the gap gotcha #6 records for the transform
drags.

**Typing:** `draft` is a writable `$derived` of the displayed value, so an external change (undo,
a timeline drag, a preset button) re-syncs the field. Enter commits and blurs; Escape restores the
value and blurs; blur commits a changed draft; a draft equal to the current value commits nothing (no
empty undo entry). All keydowns `stopPropagation`.

**Keyboard:** ArrowUp/Down = ±1 step, with Shift = ±10 steps. The text input has no spinner, and
this replaces it for desktop keyboard users.

**Styling:** `cursor-ew-resize` when enabled, `tabular-nums` so digits don't jitter mid-drag, and
**`touch-action: none`** (gotcha #10 — without it iPad treats the drag as a scroll and cancels the
pointer stream). Consequence, accepted: a panel can no longer be scrolled by a finger that starts on
top of a field.

## 3. Per-field settings

| Field | `step` | `pxPerStep` | Full-range travel |
|---|---|---|---|
| Brush size | 0.5 | 4 | 476px |
| fps (both) | 1 | 8 | 472px |
| Length | 1 | 6 | (unreachable — typing stays) |
| Canvas W / H | 8 | 4 | (unreachable) |
| Pose gap (0–8) | 1 | 8 | 64px |
| Video speed | 0.1 | 8 | 632px |
| Track step (1–12) | 1 | 10 | 110px |

Length (1–9999) and canvas W/H (16–8192) cannot be crossed in one drag, by choice: an acceleration
curve would make small corrections — the common case for both — unpredictable. The field still types.

## 4. Committing, per field

Three shapes, because a drag must never push one undo entry per pixel (the mistake
`applyAnimationLength`'s doc comment records: "a drag calling it pushed one undo command per
pointermove — a 30-frame drag left 30 entries in the history").

1. **Live, no history** — brush size, both fps fields, pose gap, video speed, canvas W/H. `onInput`
   writes exactly what the current `oninput`/`onchange` handler writes. Pose gap keeps its
   `rebuildPoseMesh()` call on every move; it already runs per change today.
2. **Live inside one bracket** — Length. `onInput` calls `applyAnimationLength` (the existing
   no-history writer); the component's drag start/end are bracketed by `beginStructuralEdit()` /
   `commitStructuralEdit()` at the call site, so the whole drag is ONE undo entry and a drag that
   ends where it started pushes none (`commitStructuralEdit` no-ops on an unchanged snapshot).
   `applyAnimationLength` already discards live lifts (gotcha #9) on its own.

   > **SUPERSEDED 2026-09-18 by the plan's "Spec amendment":** Length is commit-on-release, like Track
   > step. `commitLength` asks for confirmation before dropping keyframes, and a live drag would fire
   > that dialog per pointermove.
3. **Commit on release** — Track step. `setTrackSampleEvery` commits per call and has no
   non-committing variant; writing one would be new store surface for one field. So no `onInput`:
   the field shows the scrubbed number while dragging and writes once on `onCommit`. Its existing
   "write the resolved value back" behaviour stays, via the `draft` re-sync.

`SizeDialog`'s W/H are dialog-local until OK, so they need no history handling at all.

## 5. Out of scope

- The 22 range sliders.
- Any change to what the fields mean, their ranges, or their clamping rules (each keeps its current
  min/max and its store-side clamp — an input's `max` is advisory, as `setTrackSampleEvery` and the
  pose gap handler already note).
- A shared "scrub" for non-numeric controls.

## 6. Testing

- **Unit (Vitest):** `scrub.ts` — grid quantisation, clamping at both ends, drag-back-to-start
  restoring the exact start value, Shift widening the travel per step, non-finite `dx`, and the
  float cleanup for `step: 0.1`.
- **Not unit-testable** (no DOM in Vitest): the component and the nine call sites. Browser pass:
  each field drags, each field still types, Escape restores, the length drag is exactly one undo
  entry (and none when it ends where it started), the track-step drag writes once.
- **iPad pass** (deploy, per the project's rule): a Pencil drag on each field changes the value
  without raising the keyboard; a tap still opens it; palm rejection mid-drag leaves no stuck state.

## 7. Risks

- **Nine call sites change shape at once.** A wrong `min`/`step` on one field is invisible to the
  tests. Mitigation: convert in small groups, one commit each, browser-checked per group.
- **Losing the spinner** on desktop is a real regression for mouse users; the arrow keys cover it,
  but only while the field is focused.
- **`touch-action: none`** removes finger-scroll that starts on a field. The fields are small and
  every panel has surrounding space, so this is accepted rather than worked around.
