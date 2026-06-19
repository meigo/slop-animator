# Brush / Eraser Cursor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pointer-following circle cursor sized to the stroke diameter for the brush/eraser tools — solid for brush, dashed for eraser.

**Architecture:** A standalone `BrushCursor.svelte` mounted in the Canvas `stage` (mirrors `RefTransformGizmo`: `getViewport`/`getContainer` props, rAF loop, `pointer-events-none`). Two-line Canvas change (mount + `cursor: none`). No model/store change; it reads `activeStroke()` + `state.tool`.

**Tech Stack:** Svelte 5 runes, TypeScript, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-20-brush-cursor-design.md`

**Branch:** execute on a new branch `brush-cursor` (off `main`).

**No new automated tests** (DOM overlay, not node-renderable). Existing **209** must stay green; build **0/0**; lint clean. Verified by the manual checklist.

---

### Task 1: BrushCursor component + Canvas integration

**Files:** Create `src/lib/BrushCursor.svelte`; modify `src/lib/Canvas.svelte`.

- [ ] **Step 1: Create `src/lib/BrushCursor.svelte`**

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import type { Viewport } from "../core/viewport";
  import { state as appState, activeStroke } from "../state/appState.svelte";

  let {
    getViewport,
    getContainer,
  }: { getViewport: () => Viewport | null; getContainer: () => HTMLElement | null } = $props();

  let visible = $state(false);
  let x = $state(0);
  let y = $state(0);
  let diameter = $state(0);
  let dashed = $state(false);
  let raf = 0;

  const isStrokeTool = () => appState.tool === "brush" || appState.tool === "eraser";

  function onMove(e: PointerEvent) {
    // Mouse/pen only; finger touches (which pan/draw via gestures) get no cursor.
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") {
      visible = false;
      return;
    }
    const c = getContainer();
    if (!c) return;
    const r = c.getBoundingClientRect();
    x = e.clientX - r.left;
    y = e.clientY - r.top;
    visible = true;
  }
  const onLeave = () => (visible = false);

  // Keep size synced to the active tool's size AND zoom, even without a pointer move.
  function tick() {
    diameter = activeStroke().size * (getViewport()?.zoom ?? 1);
    dashed = appState.tool === "eraser";
    raf = requestAnimationFrame(tick);
  }

  onMount(() => {
    const c = getContainer();
    c?.addEventListener("pointermove", onMove);
    c?.addEventListener("pointerover", onMove);
    c?.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      c?.removeEventListener("pointermove", onMove);
      c?.removeEventListener("pointerover", onMove);
      c?.removeEventListener("pointerleave", onLeave);
    };
  });
</script>

{#if visible && isStrokeTool() && diameter > 0}
  <div
    class="brush-cursor"
    class:dashed
    style="transform: translate({x}px, {y}px) translate(-50%, -50%); width: {diameter}px; height: {diameter}px;"
  ></div>
  <div
    class="brush-cursor-dot"
    style="transform: translate({x}px, {y}px) translate(-50%, -50%);"
  ></div>
{/if}

<style>
  .brush-cursor {
    position: absolute;
    left: 0;
    top: 0;
    border-radius: 50%;
    border: 1.5px solid rgba(0, 0, 0, 0.7);
    box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.6);
    pointer-events: none;
    z-index: 40;
  }
  .brush-cursor.dashed {
    border-style: dashed;
  }
  .brush-cursor-dot {
    position: absolute;
    left: 0;
    top: 0;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.7);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.6);
    pointer-events: none;
    z-index: 40;
  }
</style>
```

Notes:
- The two divs are `position: absolute` and render as direct children of the `stage` (the `relative` ancestor where `<BrushCursor>` is mounted), so `translate(x, y)` places them in stage-local coordinates — exactly like `RefTransformGizmo`'s absolute SVG.
- During a stroke the display canvas has pointer capture, but `pointermove` still **bubbles** up to the `stage` listener, so the cursor keeps tracking while drawing.
- `isStrokeTool()`/`activeStroke()` read the `appState` proxy in a reactive (template / `$state`-write) context, so the cursor follows the per-tool size and flips solid↔dashed automatically.

- [ ] **Step 2: Mount it in `src/lib/Canvas.svelte`**

Add the import near the other component imports (e.g. below `import RefTransformGizmo from "./RefTransformGizmo.svelte";`):
```ts
  import BrushCursor from "./BrushCursor.svelte";
```
Mount it right after the `<RefTransformGizmo … />` line (inside the `stage` div):
```svelte
  <RefTransformGizmo getViewport={() => viewport} getContainer={() => stage} />
  <BrushCursor getViewport={() => viewport} getContainer={() => stage} />
```

- [ ] **Step 3: Hide the OS cursor for stroke tools (`src/lib/Canvas.svelte`)**

On the `stage` `<div bind:this={stage} class="relative flex-1 overflow-hidden bg-canvas-bg touch-none" onwheel={onWheel}>`, add a reactive class:
```svelte
<div
  bind:this={stage}
  class="relative flex-1 overflow-hidden bg-canvas-bg touch-none"
  class:cursor-none={state.tool === "brush" || state.tool === "eraser"}
  onwheel={onWheel}
>
```
(Canvas imports `state` unaliased — use `state.tool`. `cursor-none` is the Tailwind utility for `cursor: none`.)

- [ ] **Step 4: Build + tests + lint**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → 209 pass (unchanged).
Run: `npm run lint` → clean.

- [ ] **Step 5: Manual verification (browser, `npm run dev`)**

- Brush tool + mouse over the canvas → a **solid** circle (double-outlined, with a center dot) follows
  the pointer, sized to the brush diameter; the OS arrow is hidden.
- Switch to the eraser → the circle becomes **dashed** and uses the eraser's own size.
- Change size (slider / `[` / `]` / presets) or zoom (wheel) → the circle resizes **live** (no pointer
  move needed).
- Move the pointer off the canvas → the circle disappears; a finger touch shows **no** circle.
- Draw a stroke → the circle tracks the pointer during the stroke.
- Switch to fill/select/transform → no circle; a normal cursor returns.

- [ ] **Step 6: Commit**
```bash
git add src/lib/BrushCursor.svelte src/lib/Canvas.svelte
git commit -m "feat: brush/eraser size cursor (solid brush ring, dashed eraser ring)"
```

---

## Final verification

- [ ] `npm run build` → 0/0; `npm test` → 209; `npm run lint` → clean.
- [ ] Manual checklist (Step 5) confirmed — especially solid↔dashed on tool switch, live resize on
      size/zoom, and finger-touch/off-canvas hiding.

## Self-Review (completed by plan author)

**Spec coverage:** standalone `BrushCursor.svelte` mirroring the gizmo (Step 1) ✅; diameter = `activeStroke().size × viewport.zoom` via rAF (Step 1 `tick`) ✅; solid brush / dashed eraser + double-outline + center dot (Step 1 markup/style) ✅; visible for mouse/pen over canvas, hidden on leave/finger, brush+eraser only (Step 1 `onMove`/render gate) ✅; mounted in Canvas + `cursor: none` for stroke tools (Steps 2–3) ✅; out-of-scope items (pressure width, layer-transform scale, per-type shapes, other tools) absent ✅; no new tests, 209 green (Step 4) ✅.

**Placeholder scan:** No TBD/TODO; the full component source and exact Canvas edits are provided.

**Consistency:** Props `getViewport`/`getContainer` match the `RefTransformGizmo` call signature reused in Step 2. `state` is referenced as `state` in Canvas (its existing import) and as `appState` inside the new component (which uses the `$state` rune, so it must alias — consistent with the other runes components). `activeStroke()` is the exported selector from the brush/eraser-settings feature.
