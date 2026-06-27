# Transparent Background + Checkerboard View + Paint-Behind Toggle — Design

**Status:** Approved (design phase)
**Date:** 2026-06-27

## Context

The app is monochrome ink-outline. A user drawing **black outlines** wants to add **white fills** and
distinguish a white fill from empty canvas while drawing. Today the document renders an **opaque**
background (`Project.bgColor`, default cream `#f4efe2`), so white-on-cream is muddy and transparent vs
white is indistinguishable.

This feature makes the document's background **genuinely transparent** (a per-project option), shows a
**checkerboard** behind the artwork in the editor so fills stand out, and carries the transparency into
**PNG/image export** (real alpha). **Video export stays flattened** onto the project `bgColor` (MP4/H.264
can't hold alpha; WebM-alpha is out of scope). It also **surfaces the existing `drawBehind`** brush
setting as a UI toggle so white fills can be painted behind the black outline.

Confirmed scope decisions (from brainstorming):
- Transparency is a **real document property**, not just a view aid.
- Transparency reaches the **editor + PNG export** only; **video flattens** onto `bgColor`.
- **No auto-filling** of drawings — the user fills manually (this feature just makes that workflow legible).
- Paint-behind checkbox is **hidden when the eraser tool is active** ("behind" is meaningless for erase).

## Architecture

Five small, independent components.

### 1. Document model + persistence
- Add `transparentBg: boolean` to the `Project` interface (`src/anim/document.ts`, beside `bgColor`).
- `createProject` initializes `transparentBg: false` (back-compat: existing behavior unchanged).
- **Keep `bgColor`** as the opaque/flatten color (used when not transparent, and always for video export).
  We do **not** make `bgColor` nullable — that would force every reader to handle null and lose the
  flatten color.
- Persistence (`src/persist/project-file.ts`): save `transparentBg` alongside `bgColor`; on load,
  `transparentBg: json.transparentBg ?? false` (old project files → opaque).

### 2. Render routing
`renderFrame` (`render.ts`) already gates the background fill behind its `drawBg` opt (default true) and
is unit-tested for `drawBg:false` — **no change to `render.ts`.** `compositeFrameLayers` paints no
background (layers only). The two display/export call sites and the onion path drive `drawBg`:

- **Editor, normal path** — `Canvas.svelte` `recomposite()` line 139:
  `renderFrame(displayCtx, project, playhead, DPR, { drawBg: !project.transparentBg, boil, version })`.
- **Editor, onion path** — `renderFrameWithOnion` (`onion.ts:161-163`) currently fills `project.bgColor`
  unconditionally. Make that fill conditional: `display.clearRect(...)` always; fill `bgColor` only
  `if (!project.transparentBg)`. It already receives `project`, so **no signature change**.
- **PNG sequence export** — `png-sequence.ts:18` change `drawBg: true` → `drawBg: !project.transparentBg`
  → real-alpha PNGs.
- **Video export** — `video.ts:51` stays `drawBg: true` (flatten onto `bgColor`). Add a one-line comment
  noting transparency is intentionally flattened for video.

### 3. Editor checkerboard
A doc-sized checker `<div>` inside the `wrapper` (which carries the viewport pan/zoom transform), placed
**behind** the display canvas, shown only when `state.project.transparentBg`. The display canvas is
transparent where there's no ink (component 2), so the checker shows through. The stage's existing
`bg-canvas-bg` remains for the area outside the document.

```svelte
<div bind:this={wrapper} class="absolute left-0 top-0">
  {#if state.project.transparentBg}
    <div
      class="absolute left-0 top-0 pointer-events-none"
      style="width:{state.project.width}px; height:{state.project.height}px;
             background-color:#fff;
             background-image:
               linear-gradient(45deg,#ccc 25%,transparent 25%),
               linear-gradient(-45deg,#ccc 25%,transparent 25%),
               linear-gradient(45deg,transparent 75%,#ccc 75%),
               linear-gradient(-45deg,transparent 75%,#ccc 75%);
             background-size:16px 16px;
             background-position:0 0,0 8px,8px -8px,-8px 0;"
    ></div>
  {/if}
  <canvas bind:this={display} ...></canvas>
  <canvas bind:this={overlay} ...></canvas>
</div>
```
The checker is sized in **logical** px to match the display canvas footprint and zooms with the wrapper
transform (Photoshop keeps it screen-fixed; doc-scaled is acceptable for v1). Colors are neutral
(`#fff`/`#ccc`); a dark-theme variant is optional polish, not required.

### 4. UI — Transparency toggle (Toolbar)
A toolbar **button** with a checker icon (an unused lucide icon — e.g. `Grid2x2`; verify free at plan time) that toggles
`appState.project.transparentBg` and calls `bump()` (already imported in `Toolbar.svelte`) so the
display recomposites. Active state styled like the other toolbar toggles (`class:bg-surface-active`).
Placed among the canvas/view controls.

### 5. UI — Paint-behind toggle (Toolbar)
Surface the existing `drawBehind` setting as a checkbox `☐ Behind` next to the existing `☐ Taper`
(`Toolbar.svelte:292`), bound to `stroke.drawBehind` (where `stroke` is the active tool's settings).
**Shown only when `appState.tool !== "eraser"`.** No engine work — `brush.ts:77`/`stamp-brush.ts:67`
already implement destination-over compositing, and `Canvas.svelte:231` already forwards
`stroke.drawBehind`.

## Data flow

Toggle transparency → `project.transparentBg` flips + `bump()` → reactive `recomposite()` renders the
display with `drawBg:false` (and the onion path skips its fill) → display canvas transparent where no ink
→ checker `<div>` shows through. White strokes (with paint-behind on) composite under the black outline
on a transparent layer → visible white over checker. PNG export omits the flatten (alpha); video export
flattens onto `bgColor`.

## Testing

**Pure (node, vitest):**
- `createProject()` → `transparentBg === false` (default).
- Persistence round-trip: a project with `transparentBg: true` saved then loaded preserves the flag; a
  legacy JSON without the field loads as `false`.
- `render.ts` `drawBg:false` is already covered by the existing `render.test.ts` ("omits the background
  fill when drawBg is false") — no new render test needed; the routing is the change.

**DOM / manual (browser, `npm run dev`):**
- Toggle transparency → checker appears behind the art; toggle off → opaque `bgColor` returns.
- Pick white, enable **Behind**, paint over a black outline → white fill lands **behind** the ink and is
  visible on the checker; **Behind** hidden when the eraser is selected.
- PNG-sequence export of a transparent project → PNGs have real alpha. Video export → flattened onto
  `bgColor` (opaque), unchanged.
- Onion-skin enabled + transparent → ghosts composite over transparency (no opaque fill).
- Save → reload preserves transparency.

Baseline build **0/0**, lint clean, existing test count must not drop (plus the new pure tests).

## Out of scope
- Alpha **video** export (WebM VP9 alpha); MP4 alpha (impossible).
- A UI color-picker for the flatten/`bgColor` (video uses the existing project `bgColor`).
- Auto-filling / hole-filling drawings (explicitly declined — the user fills manually).
- Screen-fixed (non-zooming) checker; per-theme checker palette (optional polish only).
- The Pose-tool silhouette-mesh outline limitation (separate concern, not addressed here).

## Self-review notes
- Five decoupled units: model+persistence, render routing, checker view, two toolbar toggles. Each is
  independently testable/inspectable; only the render routing touches multiple files, and there it's a
  one-expression change per call site plus one conditional in `onion.ts`.
- `transparentBg` boolean + retained `bgColor` keeps back-compat and preserves a flatten color for video,
  avoiding a nullable-`bgColor` ripple.
- Paint-behind is pure UI surfacing — zero engine risk — and the eraser-hidden rule keeps it meaningful.
- The only genuinely new visual is the checker `<div>`; everything else reuses existing `drawBg` plumbing.
