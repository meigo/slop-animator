# Canvas Size (New + Resize) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the artist pick a canvas size when creating a new project, and resize an existing project (Scale-to-fit by default, or Crop/extend, with a 3×3 anchor) — re-canvassing every keyframe, undoable.

**Architecture:** A pure `placeContent()` computes where the old art lands in the new canvas. `resizeProject()` re-creates every keyframe canvas via that placement and updates `project.width/height`, wrapped in the existing `commitStructural` (extended to snapshot dimensions) for one-step undo. `Canvas.svelte` re-sizes its display/overlay/scratch canvases when the document dimensions change. A shared `SizeDialog.svelte` (new vs resize mode) drives both flows.

**Tech Stack:** TypeScript 5.9, Svelte 5 (the dialog imports `state as appState` so it can use runes), Vitest, Tailwind 4, `@lucide/svelte`.

**Spec:** `docs/superpowers/specs/2026-06-15-canvas-size-design.md`

---

## Context the implementer needs

- `createProject(opts?: Partial<Pick<Project,"width"|"height"|"fps"|"bgColor">>)` already takes `width`/`height`.
- Keyframe canvases are `createCellCanvas(project.width, project.height, DPR)` → `width*DPR × height*DPR` device px with a DPR-scaled context. Only `kind: "key"` cells own a canvas; holds don't.
- `DPR` and `commitStructural`, `replaceProject`, the `state` proxy live in `src/state/appState.svelte.ts`. `commitStructural(mutate)` snapshots the document structure before/after and pushes one undo command; `restoreStructure` restores it.
- **Undo pitfall:** the snapshot shares cell *objects* (it `.slice()`s the cells array but not the cells). So resize must **replace** cells (`layer.cells = layer.cells.map(...)` producing new key cells) — never mutate `cell.canvas` in place — or undo's before-snapshot is corrupted.
- `Canvas.svelte` sizes `display` (in `sizeDisplay()`, `*DPR`), the selection `overlay` (in `setupSelection()`, logical px, NO `*DPR`), and the onion `scratch` (`*DPR`) from `project.width/height`, currently only at mount. Its rAF `tick` recomposites when `state.version`/`state.playhead` change.
- `ExportDialog.svelte` is the dialog pattern: it imports `state as appState` (renamed → avoids the `$state` footgun) and is mounted once in `App.svelte`.

**Run tests:** `npm test`. **Build:** `npm run build`.

---

### Task 1: `placeContent` pure helper

**Files:**
- Create: `src/anim/resize.ts`
- Test: `src/__tests__/resize.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/resize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { placeContent, type Anchor } from "../anim/resize";

const C: Anchor = { ax: 0.5, ay: 0.5 };
const TL: Anchor = { ax: 0, ay: 0 };
const BR: Anchor = { ax: 1, ay: 1 };

describe("placeContent", () => {
  it("scale, same aspect: fills the new canvas (factor = ratio)", () => {
    expect(placeContent(100, 100, 200, 200, "scale", C)).toEqual({ x: 0, y: 0, w: 200, h: 200 });
  });

  it("scale, different aspect: fits (no distortion) and the anchor positions the margin", () => {
    // old 100×50 (2:1) into 100×100 → factor min(1,2)=1 → 100×50, 50px vertical margin
    expect(placeContent(100, 50, 100, 100, "scale", C)).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    expect(placeContent(100, 50, 100, 100, "scale", TL)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(placeContent(100, 50, 100, 100, "scale", BR)).toEqual({ x: 0, y: 50, w: 100, h: 50 });
  });

  it("crop, bigger canvas: keeps pixel size, adds margin per anchor", () => {
    expect(placeContent(100, 100, 200, 200, "crop", C)).toEqual({ x: 50, y: 50, w: 100, h: 100 });
    expect(placeContent(100, 100, 200, 200, "crop", TL)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it("crop, smaller canvas: keeps pixel size, negative offset = crop", () => {
    expect(placeContent(200, 200, 100, 100, "crop", C)).toEqual({ x: -50, y: -50, w: 200, h: 200 });
  });

  it("degenerate empty source → identity rect filling the new canvas", () => {
    expect(placeContent(0, 0, 100, 80, "scale", C)).toEqual({ x: 0, y: 0, w: 100, h: 80 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/resize.test.ts`
Expected: FAIL — module/function not found.

- [ ] **Step 3: Implement**

Create `src/anim/resize.ts`:

```ts
export type ResizeMode = "scale" | "crop";

/** 3×3 anchor: 0 = left/top, 0.5 = center, 1 = right/bottom. */
export interface Anchor {
  ax: 0 | 0.5 | 1;
  ay: 0 | 0.5 | 1;
}

/**
 * Where old content (`oldW×oldH`) lands inside a new canvas (`newW×newH`), in the same px units.
 * - scale → uniform fit factor `min(newW/oldW, newH/oldH)` (preserves aspect, no distortion).
 * - crop  → factor 1 (pixel scale kept).
 * The anchor distributes the leftover margin (negative offset on shrink = crop on that side).
 */
export function placeContent(
  oldW: number, oldH: number, newW: number, newH: number, mode: ResizeMode, anchor: Anchor
): { x: number; y: number; w: number; h: number } {
  if (oldW <= 0 || oldH <= 0) return { x: 0, y: 0, w: newW, h: newH };
  const factor = mode === "scale" ? Math.min(newW / oldW, newH / oldH) : 1;
  const w = oldW * factor;
  const h = oldH * factor;
  return { x: (newW - w) * anchor.ax, y: (newH - h) * anchor.ay, w, h };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/resize.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/anim/resize.ts src/__tests__/resize.test.ts
git commit -m "feat: placeContent canvas-resize placement helper"
```

---

### Task 2: snapshot dimensions for undo

**Files:**
- Modify: `src/state/appState.svelte.ts` (`StructSnapshot`, `snapshotStructure`, `restoreStructure`)

Build-verified (this just extends the undo snapshot; no new behavior until Task 3 uses it).

- [ ] **Step 1: Implement**

In `src/state/appState.svelte.ts`:

(a) Add `width`/`height` to `StructSnapshot`:

```ts
export interface StructSnapshot {
  layers: Layer[];
  frameCount: number;
  width: number;
  height: number;
  activeLayerId: number;
  playhead: number;
}
```

(b) In `snapshotStructure`, capture them (add after `frameCount: state.project.frameCount,`):

```ts
    width: state.project.width,
    height: state.project.height,
```

(c) In `restoreStructure`, restore them (add after `state.project.frameCount = s.frameCount;`):

```ts
  state.project.width = s.width;
  state.project.height = s.height;
```

- [ ] **Step 2: Build + tests**

Run: `npm run build` → GREEN (no other code constructs `StructSnapshot` literals).
Run: `npm test` → all green (unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat: undo snapshot carries document dimensions"
```

---

### Task 3: `resizeProject` action

**Files:**
- Modify: `src/state/appState.svelte.ts` (add `resizeProject`; import `placeContent` + types; ensure `createCellCanvas`/`Cell` imported)

Build-verified + manual (canvas re-creation is DOM; the placement is unit-tested in Task 1).

- [ ] **Step 1: Implement**

In `src/state/appState.svelte.ts`:

(a) `createCellCanvas` and `type Cell` are already imported from `../anim/document` (used by `canvasOps`/`duplicateLayer`). Add a new import for the resize helper:

```ts
import { placeContent, type ResizeMode, type Anchor } from "../anim/resize";
```

(b) Add the action (near `replaceProject`):

```ts
/**
 * Resize the document to `newW×newH`. Re-creates every keyframe canvas: `scale` fits the old art
 * (aspect-preserving), `crop` keeps its pixel size; the anchor positions it. One undo step.
 */
export function resizeProject(newW: number, newH: number, mode: ResizeMode, anchor: Anchor) {
  const w = Math.max(16, Math.min(8192, Math.round(newW)));
  const h = Math.max(16, Math.min(8192, Math.round(newH)));
  if (w === state.project.width && h === state.project.height) return;
  const rect = placeContent(state.project.width * DPR, state.project.height * DPR, w * DPR, h * DPR, mode, anchor);
  commitStructural(() => {
    for (const layer of state.project.layers) {
      if (layer.kind !== "draw") continue;
      // Replace cells (don't mutate cell.canvas) so the undo before-snapshot keeps the old canvases.
      layer.cells = layer.cells.map((c): Cell => {
        if (c.kind !== "key") return c;
        const nc = createCellCanvas(w, h, DPR);
        const ctx = nc.getContext("2d")!;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(c.canvas, rect.x, rect.y, rect.w, rect.h);
        return { kind: "key", canvas: nc };
      });
    }
    state.project.width = w;
    state.project.height = h;
  });
}
```

- [ ] **Step 2: Build + tests**

Run: `npm run build` → GREEN.
Run: `npm test` → all green.

- [ ] **Step 3: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat: resizeProject re-canvases every keyframe (scale/crop + anchor, undoable)"
```

---

### Task 4: re-size the on-screen canvases when dimensions change

**Files:**
- Modify: `src/lib/Canvas.svelte` (rAF `tick`)

Build + manual verified.

- [ ] **Step 1: Track + react to dimension changes in the rAF tick**

In `src/lib/Canvas.svelte`, find the tick setup:

```ts
    let lastVersion = state.version;
    let lastPlayhead = state.playhead;
    const tick = () => {
      if (state.version !== lastVersion || state.playhead !== lastPlayhead) {
        lastVersion = state.version;
        lastPlayhead = state.playhead;
        syncReferenceVideos(state.project, state.playhead, state.project.fps);
        recomposite();
      }
      raf = requestAnimationFrame(tick);
    };
```

Replace it with (adds dimension tracking that re-sizes display/overlay/scratch before recompositing):

```ts
    let lastVersion = state.version;
    let lastPlayhead = state.playhead;
    let lastW = state.project.width;
    let lastH = state.project.height;
    const tick = () => {
      const dimsChanged = state.project.width !== lastW || state.project.height !== lastH;
      if (dimsChanged) {
        lastW = state.project.width;
        lastH = state.project.height;
        sizeDisplay();
        scratch.width = state.project.width * DPR;
        scratch.height = state.project.height * DPR;
        overlay.width = state.project.width;
        overlay.height = state.project.height;
        overlay.style.width = `${state.project.width}px`;
        overlay.style.height = `${state.project.height}px`;
      }
      if (dimsChanged || state.version !== lastVersion || state.playhead !== lastPlayhead) {
        lastVersion = state.version;
        lastPlayhead = state.playhead;
        syncReferenceVideos(state.project, state.playhead, state.project.fps);
        recomposite();
      }
      raf = requestAnimationFrame(tick);
    };
```

- [ ] **Step 2: Build**

Run: `npm run build` → GREEN. (`sizeDisplay`, `scratch`, `overlay`, `DPR` are all in scope in `Canvas.svelte`.)

- [ ] **Step 3: Manual smoke** (`npm run dev`)

Deferred to Task 5's manual check (no resize UI yet). For now just confirm the app still loads and draws.

- [ ] **Step 4: Commit**

```bash
git add src/lib/Canvas.svelte
git commit -m "feat: Canvas re-sizes display/overlay/scratch on document dimension change"
```

---

### Task 5: SizeDialog + state flag + toolbar entry points

**Files:**
- Create: `src/lib/SizeDialog.svelte`
- Modify: `src/state/appState.svelte.ts` (add `sizeDialog` to `AnimState` + init)
- Modify: `src/App.svelte` (mount `<SizeDialog />`)
- Modify: `src/lib/Toolbar.svelte` (New button opens dialog; add a Resize button)

Build + manual verified.

- [ ] **Step 1: Add the `sizeDialog` UI-state flag**

In `src/state/appState.svelte.ts`, add to the `AnimState` interface (near `exportOpen: boolean;`):

```ts
  sizeDialog: { open: boolean; mode: "new" | "resize" };
```

and to the `$state({...})` initializer (near `exportOpen: false,`):

```ts
  sizeDialog: { open: false, mode: "new" },
```

- [ ] **Step 2: Create `src/lib/SizeDialog.svelte`**

```svelte
<script lang="ts">
  import { state as appState, replaceProject, resizeProject } from "../state/appState.svelte";
  import { createProject } from "../anim/document";
  import { clearAutosave } from "../persist/autosave";
  import type { ResizeMode, Anchor } from "../anim/resize";

  const PRESETS = [
    { label: "1920×1080", w: 1920, h: 1080 },
    { label: "1280×720", w: 1280, h: 720 },
    { label: "1080×1080", w: 1080, h: 1080 },
    { label: "1080×1920", w: 1080, h: 1920 },
    { label: "1024×768", w: 1024, h: 768 },
  ];
  const ANCHORS: Anchor[] = [
    { ax: 0, ay: 0 }, { ax: 0.5, ay: 0 }, { ax: 1, ay: 0 },
    { ax: 0, ay: 0.5 }, { ax: 0.5, ay: 0.5 }, { ax: 1, ay: 0.5 },
    { ax: 0, ay: 1 }, { ax: 0.5, ay: 1 }, { ax: 1, ay: 1 },
  ];

  let w = $state(1280);
  let h = $state(720);
  let mode: ResizeMode = $state("scale");
  let anchor: Anchor = $state({ ax: 0.5, ay: 0.5 });

  // Prefill from the current document each time the dialog opens.
  $effect(() => {
    if (appState.sizeDialog.open) {
      w = appState.project.width;
      h = appState.project.height;
      mode = "scale";
      anchor = { ax: 0.5, ay: 0.5 };
    }
  });

  function close() { appState.sizeDialog.open = false; }
  function confirm() {
    const cw = Math.max(16, Math.min(8192, Math.round(w)));
    const ch = Math.max(16, Math.min(8192, Math.round(h)));
    if (appState.sizeDialog.mode === "new") {
      replaceProject(createProject({ width: cw, height: ch }));
      clearAutosave();
    } else {
      resizeProject(cw, ch, mode, anchor);
    }
    close();
  }
</script>

{#if appState.sizeDialog.open}
  <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onclick={close} role="presentation">
    <div class="w-80 p-4 rounded-lg bg-surface border border-border shadow-lg text-text text-sm flex flex-col gap-3"
         onclick={(e) => e.stopPropagation()} role="presentation">
      <div class="font-semibold">{appState.sizeDialog.mode === "new" ? "New project" : "Resize canvas"}</div>

      <div class="flex flex-wrap gap-1">
        {#each PRESETS as p}
          <button class="px-2 py-1 rounded border border-border text-xs hover:bg-surface-hover"
                  class:bg-surface-active={w === p.w && h === p.h}
                  onclick={() => { w = p.w; h = p.h; }}>{p.label}</button>
        {/each}
      </div>

      <div class="flex items-center gap-3">
        <label class="flex items-center gap-1 text-text-secondary">W
          <input class="w-20 bg-surface border border-border text-text px-1" type="number" min="16" max="8192" bind:value={w} /></label>
        <label class="flex items-center gap-1 text-text-secondary">H
          <input class="w-20 bg-surface border border-border text-text px-1" type="number" min="16" max="8192" bind:value={h} /></label>
      </div>

      {#if appState.sizeDialog.mode === "resize"}
        <div class="flex items-center gap-2">
          <span class="text-text-secondary w-14">Mode</span>
          <button class="px-2 py-1 rounded border border-border text-xs" class:bg-surface-active={mode === "scale"} onclick={() => (mode = "scale")}>Scale</button>
          <button class="px-2 py-1 rounded border border-border text-xs" class:bg-surface-active={mode === "crop"} onclick={() => (mode = "crop")}>Crop</button>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-text-secondary w-14">Anchor</span>
          <div class="grid grid-cols-3 gap-px w-[3.25rem]">
            {#each ANCHORS as a}
              <button class="h-4 border border-border hover:bg-surface-hover"
                      class:bg-surface-active={a.ax === anchor.ax && a.ay === anchor.ay}
                      onclick={() => (anchor = a)} aria-label="Anchor {a.ax},{a.ay}"></button>
            {/each}
          </div>
        </div>
      {/if}

      <div class="flex justify-end gap-2 mt-1">
        <button class="px-3 py-1 rounded hover:bg-surface-hover text-text-secondary" onclick={close}>Cancel</button>
        <button class="px-3 py-1 rounded bg-surface-active text-text" onclick={confirm}>{appState.sizeDialog.mode === "new" ? "Create" : "Resize"}</button>
      </div>
    </div>
  </div>
{/if}
```

- [ ] **Step 3: Mount it in `src/App.svelte`**

Add the import alongside the other lib imports:
```ts
  import SizeDialog from "./lib/SizeDialog.svelte";
```
and add the element after `<ExportDialog />` (near the end of the markup):
```svelte
<ExportDialog />
<SizeDialog />
```

- [ ] **Step 4: Wire the Toolbar buttons**

In `src/lib/Toolbar.svelte`:

(a) Add `Scaling` to the `@lucide/svelte` import (alongside `FilePlus2`).

(b) The **New** button currently calls `newProject`. Change its `onclick` to open the dialog in new mode:
```svelte
    onclick={() => { state.sizeDialog.mode = "new"; state.sizeDialog.open = true; }}
```

(c) Delete the now-unused `async function newProject() { ... }` and remove its now-unused imports: `createProject` (from `../anim/document`) and `clearAutosave` (from `../persist/autosave`) — but ONLY if nothing else in Toolbar uses them (it doesn't; verify with `grep -n "createProject\|clearAutosave" src/lib/Toolbar.svelte` after deleting `newProject`). Keep `replaceProject` (still used by the file-open path).

(d) Add a **Resize** button next to New (same button styling as the other icon buttons — copy the class string from an adjacent `<button>`):
```svelte
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    title="Resize canvas"
    onclick={() => { state.sizeDialog.mode = "resize"; state.sizeDialog.open = true; }}
  ><Scaling size={18} /></button>
```

- [ ] **Step 5: Build + tests**

Run: `npm run build` → GREEN, 0 errors AND 0 warnings. (If svelte-check warns on the overlay `<div onclick role="presentation">` backdrop, that's the standard click-catcher pattern; if it complains, add `onkeydown` no-op or switch the inner stop-propagation div's role — keep the build at 0 warnings.)
Run: `npm test` → all green (Task 1's 5 tests included).

- [ ] **Step 6: Manual verification** (`npm run dev`)

1. **New** → dialog opens; pick a preset or type W/H → **Create** → a blank project at that size (canvas resizes on screen).
2. Draw on a frame. **Resize canvas** → change to a bigger size, **Scale** → **Resize**: the drawing scales up to fill; on-screen canvas grows. **Ctrl+Z** → back to the old size + art.
3. Resize to a different aspect with **Scale** → art fits centered (no distortion); try anchor top-left vs bottom-right → it repositions.
4. Resize with **Crop** bigger → art stays pixel-size with margin (anchor moves it); smaller → it crops.
5. Resize then **Export** → output is the new size. **Save** → reload → size persists.

- [ ] **Step 7: Commit**

```bash
git add src/lib/SizeDialog.svelte src/state/appState.svelte.ts src/App.svelte src/lib/Toolbar.svelte
git commit -m "feat: SizeDialog for new-project size + resize (presets, scale/crop, 3x3 anchor)"
```

---

## Final verification

- [ ] `npm test` → all green (5 new from Task 1).
- [ ] `npm run build` → svelte-check + tsc + vite green, 0 warnings.
- [ ] Manual: new-project size; resize scale/crop with anchors; undo/redo restores art + size + on-screen canvas; export + save/reload use the new size.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- `placeContent` (scale fit / crop / anchor) → Task 1. ✓
- Undo snapshot carries dimensions → Task 2. ✓
- `resizeProject` re-canvases keyframes (replace cells, not mutate), `commitStructural` → Task 3. ✓
- Canvas display/overlay/scratch re-size on dim change → Task 4. ✓
- New-project picker + resize dialog (presets, W/H, scale/crop, 3×3 anchor), two entry points, mounted like ExportDialog → Task 5. ✓
- Reference layers auto-refit (no work — `containRect` reads `project.width/height`); persistence unchanged (`width/height` already saved). ✓

**Type/name consistency:** `placeContent(oldW,oldH,newW,newH,mode,anchor)`, `ResizeMode = "scale"|"crop"`, `Anchor {ax,ay}`, `resizeProject(newW,newH,mode,anchor)`, `state.sizeDialog {open,mode}` — referenced consistently across tasks; the dialog imports `resizeProject`/`replaceProject` from appState and `createProject` from document.

**Risks:** Resizing while a floating selection is active clears the overlay (the re-size in Task 4 resets `overlay.width`) — acceptable; resize is a rare, committed action. The dialog backdrop uses `role="presentation"` + `stopPropagation` (the established click-catcher pattern); Task 5 Step 5 calls out keeping the build warning-free if svelte-check objects.
