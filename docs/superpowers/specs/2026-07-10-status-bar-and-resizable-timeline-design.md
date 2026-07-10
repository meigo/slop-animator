# Status bar + resizable/scrollable timeline — design

**Date:** 2026-07-10
**Status:** Design (approved for planning)
**Feature:** One combined bottom-of-app layout pass — (1) a full-width bottom **status bar** showing
an instant hover/press hint plus ambient status, and (2) the **timeline panel** made a bounded,
drag-resizable, vertically-scrollable region.

## Motivation

Two rough edges in the current bottom-of-app layout:

1. **No "what is this?" feedback on iPad.** Controls use `title=`, which only shows a native tooltip
   on desktop mouse hover — never on touch/Pencil (see the `tooltips-on-touch-pencil` note). There is
   no always-on place to read the current frame/tool either.
2. **The timeline grows unbounded.** `Timeline.svelte`'s track rows just stack; the app is a flex-col
   (`Toolbar → flex-1 (Canvas+LayerList) → Playbar → Timeline`) where the middle is `flex-1`, so
   adding layers grows the timeline downward and squeezes the canvas, with no vertical scroll and no
   way to trade canvas space for timeline space.

Both live in the same layout region, so we do them as one pass.

## Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Scope | Single combined spec/plan: status bar + resizable/scrollable timeline. |
| D2 | Status bar content | **Left = instant hint** (control under pointer / being pressed); **right = ambient** (`f n/total · tool · brush\|eraser · active layer`). |
| D3 | Hint source | **Reuse existing `title=` attributes** via one delegated listener — zero per-control edits; native desktop tooltips still work. |
| D4 | Hint triggers | `pointerover` (desktop hover) **and** `pointerdown` (touch/Pencil/mouse press) so iPad gets an instant hint; cleared when the pointer is over nothing titled / on `pointerup`. |
| D5 | Timeline height | **Bounded + drag-resizable**, persisted to Preferences (localStorage). |
| D6 | Resize affordance | **Visible grip strip** on the timeline's top edge (`cursor: row-resize`, `touch-action:none`), good finger/Pencil target. |
| D7 | Vertical scroll | Track rows scroll vertically within the bounded height; the **ruler pins** (`sticky top-0`); the tools toolbar stays fixed above the scroll region. |

## Architecture

Follow existing patterns: transient state in `appState.svelte.ts`, UI in `src/lib/*.svelte`,
persistence via `src/persist/preferences.ts` + `gather/applyPreferences`. One tiny pure helper is
node-unit-tested; the rest is DOM and is build+browser-verified (Vitest has no DOM).

### New state (`appState.svelte.ts`)

```ts
// in AnimState
statusHint: string;        // description of the hovered/pressed control (from its title=); "" when idle
timelineHeight: number;    // px height of the timeline panel (bounded); persisted
```

Initialize `statusHint: ""` and `timelineHeight: DEFAULT_TIMELINE_HEIGHT` (260).

### Part 1 — Status bar

**Component `src/lib/StatusBar.svelte`** (runes; `import { state as appState }`): a thin full-width
bar (~24px, `border-t border-border`, `text-xs text-text-secondary`) rendered as the **last child of
the app flex-col in `App.svelte`**, below `<Timeline />`.

- **Left:** `{appState.statusHint}` (truncates; blank when idle).
- **Right:** ambient readout built from state:
  `f {playhead+1}/{frameCount} · {tool} · {tool === "eraser" ? "eraser" : brush.brushType}` and the
  active layer name (`activeLayer().name`). Small, right-aligned, `tabular-nums` for the frame count.

**Hint wiring (`App.svelte`):** add two window listeners alongside the existing `onkeydown`/`onpaste`:

```ts
function onPointerHint(e: PointerEvent) {
  const el = (e.target as Element | null)?.closest("[title]");
  state.statusHint = el ? (el.getAttribute("title") ?? "") : "";
}
```

Bound as `onpointerover={onPointerHint}` and `onpointerdown={onPointerHint}` on `<svelte:window>`.
Rationale: `pointerover` bubbles and fires on hover-enter (desktop); `pointerdown` covers the first
touch/Pencil contact (iPad has no hover). Moving onto an untitled element sets `""` (natural clear);
add an `onpointerup` that clears the hint after a press so a tapped button's hint doesn't stick.
Reads every existing `title=` for free and leaves native tooltips intact. Cost is a `closest()` +
string assignment per event — negligible.

> This is a status-line hint, not a floating tooltip — it does not fully close
> `tooltips-on-touch-pencil` (no per-control bubble), but it delivers the instant, touch-visible
> "what is this" that gap is about. A floating long-press tooltip remains a separate future option.

### Part 2 — Resizable + vertically-scrollable timeline

**Pure helper (`src/anim/timeline-grid.ts` or a new `src/lib/timeline-layout.ts`):**

```ts
export const MIN_TIMELINE_HEIGHT = 140;         // toolbar + ruler + ~2 rows
/** Clamp a proposed timeline height to [MIN, 60% of the viewport]. */
export function clampTimelineHeight(px: number, viewportH: number): number {
  const max = Math.max(MIN_TIMELINE_HEIGHT, Math.round(viewportH * 0.6));
  return Math.max(MIN_TIMELINE_HEIGHT, Math.min(px, max));
}
```

Unit-tested (below-min → min; above-max → 60% vp; a tiny viewport → still ≥ MIN).

**`Timeline.svelte` structure change:** the outer becomes a fixed-height flex column:

```
<div class="border-t border-border bg-surface text-text text-sm flex flex-col min-h-0"
     style="height: {appState.timelineHeight}px">
  <!-- (a) grip strip: top edge, drag to resize -->
  <div class="h-1.5 shrink-0 cursor-row-resize flex items-center justify-center ..."
       style="touch-action: none" onpointerdown={gripDown}> …grip mark… </div>
  <!-- (b) tools toolbar: unchanged, shrink-0 -->
  <div class="p-2 ...tool buttons..."> … </div>
  <!-- (c) scroll region: the existing grid wrapper, now flex-1 + scroll both axes -->
  <div class="relative flex-1 min-h-0 overflow-auto" bind:this={gridWrapper}>
     <!-- ruler pins to the top of THIS scroller -->
     <div class="sticky top-0 z-… bg-surface"> …ruler… </div>
     <AudioLane .../>
     {#each layers} …rows… {/each}
     <TimelineSelectionBar container={gridWrapper} .../>
  </div>
</div>
```

Key points:
- The wrapper changes `overflow-x-auto` → **`overflow-auto`** (both axes) and gains `flex-1 min-h-0`
  so it fills the remaining panel height and scrolls when tracks overflow.
- The **ruler** gets `sticky top-0` + an opaque background so frame numbers stay visible while
  scrolling tracks. The label gutter is already `sticky left-0`.
- The **playhead line** and column geometry are inside the wrapper, so they scroll/align unchanged.
- **`TimelineSelectionBar`** already positions off `container.scrollTop`/`clientHeight`; making the
  wrapper the vertical scroller keeps the action bar correct with no change to it.

**Resize drag (`gripDown` in `Timeline.svelte`):** pointer-capture drag on the grip. Capture
`startY = e.clientY` and `startH = appState.timelineHeight`; on move set
`appState.timelineHeight = clampTimelineHeight(startH + (startY - e.clientY), window.innerHeight)`
(drag **up** → taller). On `pointerup`, release capture and **save preferences** (debounced save
already runs off the prefs effect — see below). Because the middle area is `flex-1 min-h-0`, a taller
timeline shrinks the canvas and a shorter one grows it; the min-height clamp stops the canvas from
collapsing. Also re-clamp on window resize (an `$effect`/resize listener) so a shrunk viewport can't
leave the timeline larger than 60% of it.

### Persistence (`preferences.ts` + `gather/applyPreferences`)

Add to `Preferences`: `timelineHeight?: number;`. In `gatherPreferences` return
`timelineHeight: state.timelineHeight`. In `applyPreferences`, guard:
`if (typeof p.timelineHeight === "number") state.timelineHeight = clampTimelineHeight(p.timelineHeight, window.innerHeight);`
The existing debounced prefs `$effect` in `App.svelte` (reads `gatherPreferences()`) already persists
on any change, so a resize drag is saved automatically ~400ms after release. `statusHint` is
transient and is **not** persisted (not added to Preferences).

## Testing

- **Unit (node):** `clampTimelineHeight` — below MIN → MIN; within range → unchanged; above 60% vp →
  60% vp; tiny viewport (e.g. 100px) → still MIN (MIN wins over the 60% cap).
- **Build:** `npm run build` 0 errors/0 warnings; `npm test` baseline (302) unaffected.
- **Browser (verification debt, flag to user):** status bar hint updates instantly on desktop hover
  and on iPad tap/Pencil; ambient fields track frame/tool/layer; grip drag resizes the timeline (up =
  taller), canvas shrinks/grows, height persists across reload; tracks scroll vertically with the
  ruler pinned and the label gutter pinned; the selection action bar still anchors correctly inside
  the now-vertically-scrolling wrapper; window-shrink re-clamps the height.

## Non-goals / deferred

- A **floating** long-press tooltip bubble per control (the status line is the chosen surface now;
  the floating variant stays a separate future item per `tooltips-on-touch-pencil`).
- Resizing any other panel (LayerList width, canvas split) — only the timeline height.
- Collapsing/hiding the timeline entirely, or a double-click-to-reset-height gesture (could be added
  later; not in scope).
- Horizontal (frame) zoom — unrelated.

## Open questions for spec review

None blocking. The exact ambient field set (D2) and the grip's visual treatment are easy to tweak
during implementation/browser pass.
