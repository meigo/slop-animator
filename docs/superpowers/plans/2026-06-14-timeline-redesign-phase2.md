# Timeline Redesign — Phase 2 (Grid UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the timeline into a traditional aligned frame grid — a numbered frame ruler with a draggable playhead, fixed-width contiguous cells, and an active-column highlight — on top of the Phase 1 per-layer model.

**Architecture:** Lay the ruler and every layer's cell strip on a shared, gap-free column geometry (fixed `CELL_W` px columns starting after a fixed `LABEL_W` px name gutter), so a single absolutely-positioned playhead line can span all rows. A pure `columnAtX(offsetX, cellW, count)` helper maps a pointer's horizontal offset to a frame index; the ruler is a pointer-drag surface that scrubs `state.playhead` through that helper (with pointer capture + `touch-action: none` for iPad).

**Tech Stack:** Svelte 5 (legacy/no-runes component — it imports the `state` proxy), TypeScript 5.9, Tailwind 4, `@lucide/svelte`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-14-timeline-redesign-design.md` (Phase 2 row in "Phasing").

---

## Context the implementer needs

- `src/lib/Timeline.svelte` is the only UI file. It is a **no-runes** component: it imports a binding named `state` (the reactive `$state` proxy from `appState.svelte.ts`), which makes the `$state(...)` rune misparse in this file. So **do not use any runes** here — plain `let`/`const`/functions, mutate `state.playhead` directly (it's already reactive). This matches the current file.
- The current file (post-Phase-1) already renders a numbered header row and per-layer cell strips with `gap-1` spacing and `w-6` (24px) cells. Phase 2 replaces the gap-based layout with a contiguous fixed-width grid so columns align exactly and pointer-x → column math is clean.
- Setting `state.playhead` alone updates the canvas (the existing cell `onclick={() => go(f)}` already works without `bump()`); scrubbing reuses `go()`, no `bump()` needed.
- Theme classes already used in the app: `text-accent`, `text-accent-text`, `bg-selection`, `text-text-muted`, `text-text-secondary`, `bg-surface`, `border-border`, `hover:bg-surface-hover`. The accent color token also yields `bg-accent` (used for the playhead line) — confirm it renders during manual check; if `bg-accent` produces no visible color, substitute `bg-selection` or an inline `background: var(--color-accent)` and note it.

**Run tests:** `npm test` (Vitest). **Build/typecheck:** `npm run build` (svelte-check + tsc + vite). Both must be green after each task.

---

### Task 1: `columnAtX` pure geometry helper

**Files:**
- Create: `src/lib/timeline-grid.ts`
- Test: `src/__tests__/timeline-grid.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/timeline-grid.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { columnAtX } from "../lib/timeline-grid";

describe("columnAtX", () => {
  const W = 24;

  it("maps an offset inside column 0 to 0", () => {
    expect(columnAtX(0, W, 10)).toBe(0);
    expect(columnAtX(23, W, 10)).toBe(0);
  });

  it("maps offsets to the column under the pointer (floor of offset/cellW)", () => {
    expect(columnAtX(24, W, 10)).toBe(1);
    expect(columnAtX(60, W, 10)).toBe(2); // 60/24 = 2.5 -> 2
  });

  it("clamps a negative offset to 0", () => {
    expect(columnAtX(-50, W, 10)).toBe(0);
  });

  it("clamps an offset past the end to the last column", () => {
    expect(columnAtX(10_000, W, 10)).toBe(9);
  });

  it("returns 0 when there are no columns", () => {
    expect(columnAtX(100, W, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/timeline-grid.test.ts`
Expected: FAIL — `columnAtX` / module not found.

- [ ] **Step 3: Implement**

Create `src/lib/timeline-grid.ts`:

```ts
/**
 * Map a horizontal offset (px, measured from the grid track's left edge) to a frame column
 * index, clamped to [0, count-1]. `cellW` is the fixed column width in px.
 */
export function columnAtX(offsetX: number, cellW: number, count: number): number {
  if (count <= 0) return 0;
  const i = Math.floor(offsetX / cellW);
  return Math.max(0, Math.min(count - 1, i));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/timeline-grid.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeline-grid.ts src/__tests__/timeline-grid.test.ts
git commit -m "feat: columnAtX timeline grid geometry helper"
```

---

### Task 2: grid refactor — numbered ruler, fixed columns, playhead line, active column

**Files:**
- Modify: `src/lib/Timeline.svelte` (replace the markup + add grid constants/helpers; tool buttons + tool functions unchanged)

This task is verified by build + manual in-browser check (pointer UI). No drag yet — the ruler is display-only this task; cells stay clickable.

- [ ] **Step 1: Replace `src/lib/Timeline.svelte` with:**

```svelte
<script lang="ts">
  import { Plus, Diamond, Copy, Minus, Trash2 } from "@lucide/svelte";
  import { state, canvasOps, activeLayer, bump } from "../state/appState.svelte";
  import { addFrame, insertKeyframe, duplicateKeyframe, setHold, deleteFrame } from "../anim/timeline";
  import { resolveKeyframeIndex, type Cell } from "../anim/document";

  const CELL_W = 24;   // px, fixed column width (box-border cells, no gap → contiguous columns)
  const LABEL_W = 80;  // px, layer-name gutter

  // ◆ keyframe · blank (past end or before first key) — hold over a key
  function cellLabel(cells: Cell[], f: number): string {
    if (f >= cells.length) return "";
    if (cells[f].kind === "key") return "◆";
    return resolveKeyframeIndex(cells, f) === null ? "·" : "—";
  }

  // Ruler shows frame 1, then every 5th frame (1, 5, 10, 15, …); other columns are bare ticks.
  function rulerLabel(f: number): string {
    return f === 0 || (f + 1) % 5 === 0 ? String(f + 1) : "";
  }

  function go(f: number) {
    state.playhead = Math.max(0, Math.min(state.project.frameCount - 1, f));
  }

  // All tools act on the active drawing layer at the current frame, current-frame-aware
  // (inserts land AFTER the playhead, then the playhead follows to the new frame).
  function frameTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    addFrame(l, state.playhead);
    bump();
    go(state.playhead + 1);
  }
  function keyTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    insertKeyframe(l, state.playhead, canvasOps);
    bump();
    go(state.playhead + 1);
  }
  function dupTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    duplicateKeyframe(l, state.playhead, canvasOps);
    bump();
    go(state.playhead + 1);
  }
  function holdTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    setHold(l, state.playhead);
    bump();
  }
  function deleteTool() {
    const l = activeLayer();
    if (l.kind !== "draw") return;
    deleteFrame(l, state.playhead);
    bump();
  }

  const toolBtn =
    "w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover border border-border";
</script>

<div class="border-t border-border bg-surface text-text p-2 text-sm">
  <div class="flex gap-1 mb-2">
    <button class={toolBtn} title="Add frame (after current)" onclick={frameTool}><Plus size={16} /></button>
    <button class={toolBtn} title="Insert keyframe (after current)" onclick={keyTool}><Diamond size={16} /></button>
    <button class={toolBtn} title="Duplicate keyframe (after current)" onclick={dupTool}><Copy size={16} /></button>
    <button class={toolBtn} title="Hold (clear keyframe)" onclick={holdTool}><Minus size={16} /></button>
    <button class={toolBtn} title="Delete frame" onclick={deleteTool}><Trash2 size={16} /></button>
  </div>

  <!-- aligned grid: ruler + layer rows share one column geometry; a single playhead line spans them -->
  <div class="relative overflow-x-auto">
    <!-- playhead line (visual, non-interactive); centered on the current column -->
    <div class="absolute top-0 bottom-0 w-0.5 bg-accent pointer-events-none z-10"
         style="left: {LABEL_W + state.playhead * CELL_W + CELL_W / 2 - 1}px"></div>

    <!-- ruler -->
    <div class="flex items-stretch mb-1">
      <span class="shrink-0" style="width: {LABEL_W}px"></span>
      <div class="flex">
        {#each Array(state.project.frameCount) as _, f}
          <div class="box-border h-4 border-r border-border text-[10px] leading-4 text-center text-text-muted"
               class:text-accent={f === state.playhead}
               style="width: {CELL_W}px">{rulerLabel(f)}</div>
        {/each}
      </div>
    </div>

    <!-- layer rows (top layer first) -->
    {#each [...state.project.layers].reverse() as layer (layer.id)}
      <div class="flex items-center"
           class:opacity-100={layer.id === state.activeLayerId}
           class:opacity-70={layer.id !== state.activeLayerId}>
        <span class="shrink-0 truncate text-text-secondary pr-1" style="width: {LABEL_W}px">{layer.name}</span>
        {#if layer.kind === "draw"}
          <div class="flex">
            {#each Array(state.project.frameCount) as _, f}
              <button
                class="box-border h-6 border border-border leading-none text-xs"
                class:bg-selection={f === state.playhead}
                class:text-accent-text={f === state.playhead}
                style="width: {CELL_W}px"
                onclick={() => go(f)}>{cellLabel(layer.cells, f)}</button>
            {/each}
          </div>
        {:else}
          <span class="text-xs text-text-muted ml-1">ref</span>
        {/if}
      </div>
    {/each}
  </div>
</div>
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run build`
Expected: GREEN (svelte-check 0 errors, tsc clean, vite build OK).

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: all green (86 from Phase 1 + 5 from Task 1 = 91).

- [ ] **Step 4: Manual verification** (`npm run dev`)

1. The frame ruler shows numbers at 1, 5, 10, 15, … and bare tick columns between; the columns line up exactly above each layer's cells.
2. The cells are now contiguous (no gaps) forming a clean grid; `◆`/`—`/`·`/blank render per cell as before.
3. A vertical accent playhead line sits centered on the current frame column, spanning the ruler down through all layer rows. Clicking a cell moves the line to that column.
4. The active layer's row is full-opacity; others are dimmed. Past a short layer's end, cells are blank.
5. If the playhead line is invisible, `bg-accent` may not be a generated class — substitute `bg-selection` or inline `style="… background: var(--color-accent)"` and re-verify.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Timeline.svelte
git commit -m "feat: timeline frame ruler + aligned grid + playhead line"
```

---

### Task 3: draggable playhead (scrub the ruler)

**Files:**
- Modify: `src/lib/Timeline.svelte` (add pointer-drag handlers to the ruler track + import `columnAtX`)

Verified by build + manual check.

- [ ] **Step 1: Add the import**

In `src/lib/Timeline.svelte`, add below the existing imports:

```ts
  import { columnAtX } from "./timeline-grid";
```

- [ ] **Step 2: Add the scrub state + handlers**

In the `<script>`, after the `go` function, add:

```ts
  // Draggable playhead: pointer-drag anywhere on the ruler scrubs the current frame.
  // Pointer capture keeps the drag alive outside the element; touch-action:none stops
  // the browser from panning/zooming the page while scrubbing (needed on iPad).
  let scrubbing = false;
  function scrubTo(e: PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    go(columnAtX(e.clientX - rect.left, CELL_W, state.project.frameCount));
  }
  function rulerDown(e: PointerEvent) {
    scrubbing = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrubTo(e);
  }
  function rulerMove(e: PointerEvent) {
    if (scrubbing) scrubTo(e);
  }
  function rulerUp(e: PointerEvent) {
    scrubbing = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }
```

- [ ] **Step 3: Make the ruler track the drag surface**

In the ruler markup, replace this line:

```svelte
      <div class="flex">
```

(the `<div class="flex">` that directly wraps the ruler's `{#each Array(state.project.frameCount) …}` columns — NOT the layer-row tracks)

with:

```svelte
      <div class="flex cursor-ew-resize select-none" style="touch-action: none"
           onpointerdown={rulerDown} onpointermove={rulerMove}
           onpointerup={rulerUp} onpointercancel={rulerUp}>
```

Leave the layer-row `<div class="flex">` wrappers unchanged.

- [ ] **Step 4: Typecheck + build**

Run: `npm run build`
Expected: GREEN.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: all green (91).

- [ ] **Step 6: Manual verification** (`npm run dev`, and on iPad via `npm run dev:lan`)

1. Press-and-drag horizontally across the ruler → the playhead line follows the pointer and the canvas scrubs frame-by-frame; releasing leaves the playhead on the dropped column.
2. Dragging past the left edge clamps to frame 1; past the right edge clamps to the last frame.
3. A single click/tap on the ruler jumps the playhead to that column.
4. On iPad: dragging the ruler scrubs without scrolling/zooming the page (confirms `touch-action: none` + pointer capture).
5. Clicking a layer cell still jumps the playhead (cell `onclick` unaffected).

- [ ] **Step 7: Commit**

```bash
git add src/lib/Timeline.svelte
git commit -m "feat: draggable playhead scrubbing on the frame ruler"
```

---

## Final verification

- [ ] `npm test` → 91 green.
- [ ] `npm run build` → svelte-check + tsc + vite all green.
- [ ] Manual: ruler numbered + aligned grid + active-column highlight + draggable playhead (mouse/pen/touch), columns aligned between ruler and every layer row.

---

## Self-Review (completed by plan author)

**Spec coverage (Phase 2 row = "numbered frame ruler + draggable playhead + per-layer cell strips of their own lengths"):**
- Numbered frame ruler → Task 2. ✓
- Draggable playhead → Tasks 1 (geometry, tested) + 3 (pointer wiring). ✓
- Per-layer cell strips at their own lengths + aligned grid + active-column highlight → Task 2 (cells already render per-layer length from Phase 1; Task 2 makes the grid contiguous/aligned and adds the playhead line + active styling). ✓

**Out of Phase 2 (Phase 3):** dragging keyframes (`moveKeyframe`) and dragging a keyframe's right edge to resize its hold span (`setHoldSpan`) — ops already built/tested in Phase 1, UI wiring deferred.

**Type/name consistency:** `columnAtX(offsetX, cellW, count)`, `CELL_W`, `LABEL_W`, `scrubbing`, `scrubTo`/`rulerDown`/`rulerMove`/`rulerUp`, and `go` are referenced consistently across Tasks 1–3; the drag handlers reuse `go` (so the playhead clamp lives in one place) and `CELL_W` (so geometry matches the markup).

**Risks:** `bg-accent` may not be a generated Tailwind class even though `text-accent` is — Task 2 step 4.5 calls this out with a fallback. Pointer capture + `touch-action: none` are the iPad-critical bits and are explicitly manual-verified in Task 3.
