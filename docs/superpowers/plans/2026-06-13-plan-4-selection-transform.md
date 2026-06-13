# Plan 4 — Selection & Transform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rectangle/lasso selection and move/scale/rotate transform of the selected pixels on the active frame, with commit/cancel and undo.

**Architecture:** Port slop-paint's self-contained `selection.ts` (the `Selection` class — marquee, lasso, lift, affine transform, overlay rendering) verbatim into `src/core/`. Wire it into the existing `Canvas.svelte`: add a CSS-pixel **overlay canvas** stacked over the drawing canvas inside a shared viewport-transformed wrapper, route the existing `onStroke(points, done)` handler to the selection state-machine when the tool is `select`/`lasso` (mirroring slop-paint's host glue), and lift/commit/cancel against the active layer's resolved keyframe canvas with the document-level History command stack.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest. Warp/mesh distort is OUT of scope (spec defers it) — `selection.ts` includes that code but it stays unwired (no Distort/Mesh UI, no floating actions panel).

> ⚠️ **VERIFICATION NOTE (read before executing):** This plan is almost entirely DOM/canvas/pointer integration. `selection.ts` is a verbatim copy of battle-tested slop-paint code but is not Node-unit-testable, and the floating actions panel (the only pure piece) is intentionally omitted. **This plan adds no new unit tests.** Each task's gate is: the existing 49 tests still pass, `npm run check` is clean, `npx vite build` succeeds — plus a **human** must manually verify selection behaviour in a browser. Do not claim the interactive behaviour works from automated checks alone.

**Builds on Plans 1–3 (on `main`).** Relevant existing APIs:
- `src/core/viewport.ts`: `Viewport` — `constructor(target)` (reads `target.parentElement` as the coordinate frame), `screenToCanvas`, `canvasToScreen`, `zoom`, `onChange`, `zoomAt`.
- `src/anim/timeline.ts`: `ensureDrawableKeyframe(layer, frame, ops)` → the cell canvas (DPR-scaled ctx).
- `src/state/appState.svelte.ts`: `type Tool`, `state`, `history`, `DPR`, `canvasOps`, `activeLayer()`, `bump()`, `playbackController`.
- `src/lib/Canvas.svelte`: `onStroke(points, done)` receives canvas-LOGICAL coords; `recomposite()`; `onMount` builds `viewport = new Viewport(display)`.
- `src/App.svelte`: global `onkeydown` with INPUT/TEXTAREA guard; `Enter` currently toggles playback.
- tsconfig is the SAME file as slop-paint's (so `selection.ts` type-checks identically under `erasableSyntaxOnly`/`noUnusedLocals`).

---

## `Selection` class API (from the verbatim port — used by the glue)

Construction: `new Selection(overlayCanvas)`. Coordinates passed in/out are **CSS-document pixels**. Key members the glue uses:
- properties: `state: "idle"|"selected"|"transforming"|"warping"`, `mode: "rect"|"lasso"`, `screenScale: number`, `hasFloating: boolean`, `active: boolean`.
- callbacks (assign these): `onChange`, `onStateChange`, `onCommit`, `onCancel` (all `(() => void) | null`).
- methods: `hitTest(x,y): Handle|null`, `startCreate(x,y)`, `updateCreate(x,y)`, `endCreate()`, `startDrag(handle,x,y)`, `updateDrag(x,y)`, `endDrag()`, `liftPixels(srcCtx, dpr): HTMLCanvasElement|null`, `beginTransform(lifted)`, `renderFloatingTo(ctx)`, `commit()`, `cancel()`, `clear()`.

---

## File Structure

```
src/
  core/selection.ts        ← NEW (verbatim copy from slop-paint)
  state/appState.svelte.ts ← MODIFY: Tool += "select"|"lasso"; export selectionRef holder
  lib/Canvas.svelte        ← MODIFY: overlay canvas + viewport wrapper; Selection instance,
                              callbacks, screenScale sync; selection branch in onStroke; tool→mode effect
    Toolbar.svelte         ← MODIFY: Select + Lasso buttons
  App.svelte               ← MODIFY: s/l shortcuts; Enter=commit-or-play, Esc=cancel
```

---

## Task 1: Port `selection.ts` verbatim

**Files:**
- Create (by copy): `src/core/selection.ts`

- [ ] **Step 1: Copy the file**

Run:
```bash
cp /Users/meigo/Projects/slop/slop-paint/src/selection.ts /Users/meigo/Projects/slop/slop-animator/src/core/selection.ts
```
Do NOT modify it. It has no imports (browser-globals only) and exports `SelectionRect`, `Mat`, `SelectionMode`, `SelectionState`, and the `Selection` class.

- [ ] **Step 2: Verify it type-checks and builds under the animator's config**

Run: `npm run check`
Expected: 0 errors involving `src/core/selection.ts`. (The animator's tsconfig is identical to slop-paint's, where this file compiles, so no errors are expected. If a real error appears, STOP and report it — do NOT edit the ported file beyond what an import-path fix would require, and there are no imports to fix.)
Then run: `npm test` — still 49 passing (unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/core/selection.ts
git commit -m "feat(core): port selection/transform from slop-paint"
```

---

## Task 2: Tool union + selection holder in app state

**Files:**
- Modify: `src/state/appState.svelte.ts`

- [ ] **Step 1: Add a type-only import for Selection**

After the existing `import type { CanvasOps } from "../anim/timeline";` line, add:
```ts
import type { Selection } from "../core/selection";
```

- [ ] **Step 2: Extend the `Tool` union**

The current line is:
```ts
export type Tool = "brush" | "eraser" | "fill";
```
Replace with:
```ts
export type Tool = "brush" | "eraser" | "fill" | "select" | "lasso";
```

- [ ] **Step 3: Export a holder so other components can reach the live Selection instance**

At the END of the file, add:
```ts
/**
 * Holder for the single Selection instance (created by Canvas.svelte on mount).
 * App.svelte reads it to handle Enter (commit) / Escape (cancel) globally.
 */
export const selectionRef: { current: Selection | null } = { current: null };
```

- [ ] **Step 4: Verify**

Run: `npm run check` — 0 errors. `npm test` — 49 passing.

- [ ] **Step 5: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat(state): add select/lasso tools + selectionRef holder"
```

---

## Task 3: Overlay canvas, viewport wrapper, and Selection wiring in Canvas

**Files:**
- Modify: `src/lib/Canvas.svelte`

This task adds the overlay + Selection instance and its callbacks, and restructures the DOM so the overlay shares the viewport transform with the drawing canvas. It does NOT yet route pointer input to selection (Task 4) — after this task, drawing/onion/playback must still work exactly as before.

- [ ] **Step 1: Add imports and module state**

After the existing import line `import { state, history, DPR, canvasOps, activeLayer, bump } from "../state/appState.svelte";` add:
```ts
  import { selectionRef } from "../state/appState.svelte";
  import { Selection } from "../core/selection";
```
After the line `let scratchCtx: CanvasRenderingContext2D;` add:
```ts
  // Selection overlay (CSS-pixel sized, shares the viewport transform via the wrapper).
  let wrapper: HTMLDivElement;
  let overlay: HTMLCanvasElement;
  let selection: Selection;
  let selectionMode: "create" | "drag" | null = null;
  // The cell being transformed + its pre-lift snapshot, for commit/cancel undo.
  let selCtx: CanvasRenderingContext2D | null = null;
  let selBefore: ImageData | null = null;
```

- [ ] **Step 2: Add a `setupSelection()` function**

Add this function immediately above the `onMount(() => {` line:
```ts
  function setupSelection() {
    overlay.width = state.project.width;
    overlay.height = state.project.height;
    overlay.style.width = `${state.project.width}px`;
    overlay.style.height = `${state.project.height}px`;

    selection = new Selection(overlay);
    selection.mode = "rect";
    selection.screenScale = viewport.zoom;
    viewport.onChange = () => { selection.screenScale = viewport.zoom; };

    // While dragging/creating, the lifted region is cleared from the cell; repaint it.
    selection.onChange = () => recomposite();
    selection.onStateChange = () => recomposite();

    selection.onCommit = () => {
      if (!selCtx || !selBefore) return;
      selection.renderFloatingTo(selCtx);
      const ctx = selCtx;
      const before = selBefore;
      const after = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
      history.push({
        undo: () => { ctx.putImageData(before, 0, 0); recomposite(); },
        redo: () => { ctx.putImageData(after, 0, 0); recomposite(); },
      });
      selCtx = null;
      selBefore = null;
      bump();
      recomposite();
    };

    selection.onCancel = () => {
      if (selCtx && selBefore) { selCtx.putImageData(selBefore, 0, 0); recomposite(); }
      selCtx = null;
      selBefore = null;
    };

    selectionRef.current = selection;
  }
```

- [ ] **Step 3: Point the viewport at the wrapper and call `setupSelection` in `onMount`**

The current onMount opening is:
```ts
    displayCtx = display.getContext("2d")!;
    scratch = document.createElement("canvas");
    scratch.width = state.project.width * DPR;
    scratch.height = state.project.height * DPR;
    scratchCtx = scratch.getContext("2d")!;
    sizeDisplay();
    viewport = new Viewport(display);
    recomposite();
```
Replace `viewport = new Viewport(display);` with `viewport = new Viewport(wrapper);` and add `setupSelection();` immediately after `recomposite();`, so it reads:
```ts
    displayCtx = display.getContext("2d")!;
    scratch = document.createElement("canvas");
    scratch.width = state.project.width * DPR;
    scratch.height = state.project.height * DPR;
    scratchCtx = scratch.getContext("2d")!;
    sizeDisplay();
    viewport = new Viewport(wrapper);
    recomposite();
    setupSelection();
```

- [ ] **Step 4: Clear the selectionRef on teardown**

The current cleanup return is:
```ts
    return () => { cleanup(); cancelAnimationFrame(raf); };
```
Replace with:
```ts
    return () => { cleanup(); cancelAnimationFrame(raf); selectionRef.current = null; };
```

- [ ] **Step 5: Restructure the markup — wrap display + overlay in a transformed group**

The current markup is:
```svelte
<div class="relative flex-1 overflow-hidden bg-neutral-300" onwheel={onWheel}>
  <canvas bind:this={display} class="absolute left-0 top-0 shadow-lg touch-none"></canvas>
</div>
```
Replace with:
```svelte
<div class="relative flex-1 overflow-hidden bg-neutral-300" onwheel={onWheel}>
  <div bind:this={wrapper} class="absolute left-0 top-0">
    <canvas bind:this={display} class="absolute left-0 top-0 shadow-lg touch-none"></canvas>
    <canvas bind:this={overlay} class="absolute left-0 top-0 pointer-events-none"></canvas>
  </div>
</div>
```
(The `wrapper` is the viewport's transform target; both canvases are absolutely positioned at its origin so they overlay exactly. `overlay` has `pointer-events-none` so pointer events fall through to `display`, where `setupInput` is attached.)

- [ ] **Step 6: Verify NO regression**

Run: `npm run check` — 0 errors. `npm test` — 49 passing. Then `npm run dev` (headless, short timeout) — confirm it boots with no runtime error.
**Manual gate (human):** after this task, drawing, eraser, fill, onion, and playback must still work AND pan/zoom must still move the canvas (now via the wrapper). The overlay is present but inert. If pan/zoom or drawing broke, the viewport-target change is wrong — fix before continuing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/Canvas.svelte
git commit -m "feat(ui): selection overlay canvas + Selection instance wiring"
```

---

## Task 4: Route pointer input to selection

**Files:**
- Modify: `src/lib/Canvas.svelte`

- [ ] **Step 1: Add the selection branch at the top of `onStroke`**

The current `onStroke` begins:
```ts
  function onStroke(points: InputPoint[], done: boolean) {
    if (state.tool === "fill") {
```
Insert the selection branch as the FIRST statements inside `onStroke` (before the fill branch):
```ts
  function onStroke(points: InputPoint[], done: boolean) {
    if (state.tool === "select" || state.tool === "lasso") {
      const p = points[points.length - 1];
      if (points.length === 1 && !done) {
        const handle = selection.hitTest(p.x, p.y);
        if (selection.state === "selected" && handle === "move") {
          // First grab inside a fresh marquee: lift the pixels and enter transform mode.
          const layer = activeLayer();
          if (layer.locked) return;
          const canvas = ensureDrawableKeyframe(layer, state.playhead, canvasOps);
          selCtx = canvas.getContext("2d", { willReadFrequently: true })!;
          selBefore = selCtx.getImageData(0, 0, canvas.width, canvas.height);
          const lifted = selection.liftPixels(selCtx, DPR);
          if (lifted) {
            selection.beginTransform(lifted);
            recomposite();
            selectionMode = "drag";
            selection.startDrag("move", p.x, p.y);
          }
        } else if ((selection.state === "transforming" || selection.state === "warping") && handle) {
          selectionMode = "drag";
          selection.startDrag(handle, p.x, p.y);
        } else {
          // Outside any selection (or idle) → commit/cancel the old one, start a new marquee.
          if (selection.hasFloating) selection.commit();
          else if (selection.active) selection.cancel();
          selectionMode = "create";
          selection.startCreate(p.x, p.y);
        }
      } else if (!done) {
        if (selectionMode === "create") selection.updateCreate(p.x, p.y);
        else if (selectionMode === "drag") selection.updateDrag(p.x, p.y);
      } else {
        if (selectionMode === "create") selection.endCreate();
        selection.endDrag();
        selectionMode = null;
      }
      return;
    }
    if (state.tool === "fill") {
```
(Everything from `if (state.tool === "fill") {` onward is unchanged.)

- [ ] **Step 2: Add a tool→mode effect (and auto-commit when leaving selection tools)**

Add this `$effect` immediately after the `onMount(...)` block (top-level in the `<script>`):
```ts
  $effect(() => {
    const t = state.tool;
    if (!selection) return;
    if (t === "select") selection.mode = "rect";
    else if (t === "lasso") selection.mode = "lasso";
    else {
      // Switching to a drawing tool: bank or drop any active selection.
      if (selection.hasFloating) selection.commit();
      else if (selection.active) selection.cancel();
    }
  });
```

- [ ] **Step 3: Verify**

Run: `npm run check` — 0 errors. `npm test` — 49 passing. `npm run dev` (headless) — boots clean.
**Manual gate (human):** with the Select tool, drag a rectangle marquee (marching ants appear over the drawing); click-drag inside it → the pixels lift and move with scale/rotate handles; drag a corner to scale, the rotate handle to rotate; switching to Brush banks the move. (Full manual checklist in Task 5.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/Canvas.svelte
git commit -m "feat(ui): route pointer input to selection + transform"
```

---

## Task 5: Toolbar buttons, keyboard shortcuts, and verification

**Files:**
- Modify: `src/lib/Toolbar.svelte`, `src/App.svelte`

- [ ] **Step 1: Add Select + Lasso buttons to the toolbar**

In `src/lib/Toolbar.svelte`, the current Fill button line is:
```svelte
  <button class:font-bold={state.tool === "fill"} onclick={() => (state.tool = "fill")}>Fill</button>
```
Add immediately after it:
```svelte
  <button class:font-bold={state.tool === "select"} onclick={() => (state.tool = "select")}>Select</button>
  <button class:font-bold={state.tool === "lasso"} onclick={() => (state.tool = "lasso")}>Lasso</button>
```

- [ ] **Step 2: Add shortcuts + Enter/Escape handling in App.svelte**

In `src/App.svelte`, import `selectionRef`. The current import line is:
```ts
  import { state, history, bump, playbackController } from "./state/appState.svelte";
```
Replace with:
```ts
  import { state, history, bump, playbackController, selectionRef } from "./state/appState.svelte";
```
Then, in `onKey`, the current play/pause + onion + tool lines are:
```ts
    if (e.key === "b") state.tool = "brush";
    else if (e.key === "e") state.tool = "eraser";
    else if (e.key === "g") state.tool = "fill";
    else if (e.key === "k" || e.key === "Enter") { e.preventDefault(); playbackController.toggle(); }
    else if (e.key === "o") { state.onion.enabled = !state.onion.enabled; bump(); }
```
Replace that block with:
```ts
    if (e.key === "b") state.tool = "brush";
    else if (e.key === "e") state.tool = "eraser";
    else if (e.key === "g") state.tool = "fill";
    else if (e.key === "s") state.tool = "select";
    else if (e.key === "l") state.tool = "lasso";
    else if (e.key === "Escape") { if (selectionRef.current?.active) selectionRef.current.cancel(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (selectionRef.current?.active) selectionRef.current.commit();
      else playbackController.toggle();
    }
    else if (e.key === "k") { e.preventDefault(); playbackController.toggle(); }
    else if (e.key === "o") { state.onion.enabled = !state.onion.enabled; bump(); }
```
(Leave the `,` `.` `[` `]` branches that follow unchanged.)

- [ ] **Step 3: Automated verification (Definition of Done — run all, paste real output)**

1. `npm run check` — 0 errors.
2. `npm test` — 49 passing (this plan adds no unit tests; the gate is no regression).
3. `npx vite build` — successful production build.
4. Dev boot (headless): `npm run dev` short timeout — `Local:` URL prints, no compile/runtime errors, then stop.

Do NOT claim interactive selection works from these checks — that is the human's manual step below.

- [ ] **Step 4: Commit**

```bash
git add src/lib/Toolbar.svelte src/App.svelte
git commit -m "feat(ui): select/lasso buttons + s/l/Enter/Esc shortcuts"
```

- [ ] **Step 5: Manual verification checklist (HUMAN — required; no browser automation here)**

Run `npm run dev`, open the app, draw something, then:
1. **Rect select** (`s` / Select): drag a marquee over part of the drawing → marching-ants rectangle appears.
2. **Move**: click-drag inside the marquee → the enclosed pixels lift (leaving a hole) and follow the cursor; scale/rotate handles appear.
3. **Scale**: drag a corner/side handle → the floating pixels scale. **Rotate**: drag the rotate handle (above the box) → they rotate.
4. **Commit**: press `Enter` (or click outside the selection) → the transformed pixels bake into the frame; undo (`Cmd/Ctrl+Z`) reverts the whole move; redo re-applies.
5. **Cancel**: start another move, press `Escape` → pixels snap back to the original position, nothing committed.
6. **Lasso** (`l` / Lasso): draw a freehand loop → only pixels inside the lasso lift and transform.
7. **Zoom/pan**: zoom in, then select and transform → handles stay grabbable and the marquee/handles track the canvas (overlay shares the viewport transform).
8. **No regression**: brush, eraser, fill, onion, playback, frame stepping all still work; switching from a selection to the Brush banks the move first.

---

## Self-Review (completed during planning)

**Spec coverage (spec §2: "Selection + transform — rect/lasso select, then move/scale/rotate"):** rect + lasso via `selection.mode` (Tasks 2, 4); lift + affine move/scale/rotate via the ported `Selection` (Tasks 1, 4); commit/cancel with undo via the History command stack (Task 3); UI + shortcuts (Task 5). Warp/mesh distort is intentionally excluded (spec §2 out-of-scope) — the ported code carries it dormant; no Distort/Mesh UI or actions panel is wired.

**Placeholder scan:** none — every step has complete code and an exact command + expected result.

**Type consistency:** `Tool` gains `"select"|"lasso"` once (Task 2) and is matched in Canvas (Task 4), Toolbar and App (Task 5). `selectionRef` is defined in Task 2, populated in Task 3 (`setupSelection`/teardown), read in App (Task 5). `selection`, `selCtx`, `selBefore`, `selectionMode` are declared in Task 3 and used in Tasks 3–4. The `Selection` method names used by the glue (`hitTest`, `startCreate/updateCreate/endCreate`, `startDrag/updateDrag/endDrag`, `liftPixels`, `beginTransform`, `renderFloatingTo`, `commit`, `cancel`, properties `state/mode/screenScale/hasFloating/active`, callbacks `onChange/onStateChange/onCommit/onCancel`) match the verbatim port. `Enter` is disambiguated: commit when a selection is active, else play/pause (resolves the Plan 2 binding).

**Risks / known limitations (called out honestly):**
- **No new unit tests.** The whole feature is DOM/canvas/pointer integration; coverage is "no regression in 49 tests" + type/build + mandatory human testing. This is a deliberate, flagged departure from Plans 1–3.
- **Viewport retarget (display → wrapper)** is the riskiest edit; Task 3's manual gate exists specifically to catch a broken pan/zoom or drawing before more is built on top.
- **No hover cursor feedback** (slop-paint's `getCursor` needs button-less pointermove, which `setupInput` doesn't deliver) — omitted; not required by the spec.
- **No "draw inside selection" clipping** (`applyClip`) — switching to a drawing tool banks/clears the selection instead. Acceptable for the spec's scope.
- Selecting on a held frame first clones it to a keyframe (via `ensureDrawableKeyframe`), so the transform is local to that frame — consistent with the draw-on-hold behaviour.
