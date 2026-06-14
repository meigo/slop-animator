# Plan 8 — Dark Theme, Lucide Icons & Layers Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the app to slop-paint's dark theme with Lucide icons, and give the layers panel a full button bar (Add / Duplicate / Merge Down / Delete) with drag-and-drop reordering — for a flat layer list (no nested groups).

**Architecture:** Port slop-paint's Tailwind-4 `@theme` semantic color system (`--color-surface`, `--color-border`, `--color-text-secondary`, `--color-accent`, …) with a `.dark` override and default the app to dark. Swap text-label buttons for `@lucide/svelte` icons across the toolbar/panels. Add `duplicateLayer`/`mergeDown`/`reorderLayers` to app state and rebuild `LayerList` with a SortableJS-driven flat list (reorder is derived from DOM order on drop — simpler and conflict-free for a flat list).

**Tech Stack:** Svelte 5 (runes), Tailwind 4, `@lucide/svelte` (already installed), `sortablejs` (+ `@types/sortablejs`).

> ⚠️ **VERIFICATION NOTE:** the new layer operations are small state mutations consistent with the existing (untested) `addLayerToProject`/`removeLayer` helpers; the rest is visual styling + SortableJS integration. **No new unit tests** — the gate is type-check/build/no-regression (existing 69 tests) plus **human** visual/interaction verification (dark theme renders, icons show, drag reorders, duplicate/merge work).

**Builds on Plans 1–7 + recent fixes (on `main`).** Relevant existing code:
- `src/app.css`: currently `@import "tailwindcss"` + a few resets.
- `src/state/appState.svelte.ts`: `state`, `isDrawingLayer`, `canvasOps`, `bump()`, `addLayerToProject`, `removeLayer`, `activeLayer`, type `Layer`/`DrawingLayer`.
- `src/anim/document.ts`: `createDrawingLayer`, `cloneCanvas`, `isDrawingLayer`, `resolveKeyframeIndex`, `Cell`/`DrawingLayer`.
- `src/anim/timeline.ts`: `ensureDrawableKeyframe`.
- Components: `src/lib/{Toolbar,LayerList,Timeline,Playbar,ExportDialog,Canvas}.svelte`, `src/App.svelte`, `index.html`.
- tsconfig: `erasableSyntaxOnly`, `noUnusedLocals`.

slop-paint references (read for fidelity): `src/app.css` (theme), `src/lib/Toolbar.svelte` + `src/lib/LayerPanel.svelte` (icon + dark-class patterns).

---

## File Structure

```
src/
  app.css            ← MODIFY: port @theme semantic colors + .dark + range/color/sortable styling
  state/appState.svelte.ts ← MODIFY: duplicateLayer, mergeDown, reorderLayers; theme toggle state
  lib/
    LayerList.svelte ← REWRITE: dark theme, Lucide icons, button bar, SortableJS DnD
    Toolbar.svelte   ← MODIFY: Lucide icons + theme classes + theme toggle
    Playbar.svelte   ← MODIFY: Lucide transport icons + theme classes
    Timeline.svelte  ← MODIFY: theme classes (+ a couple icons)
    ExportDialog.svelte ← MODIFY: theme classes
    Canvas.svelte    ← MODIFY: stage background to theme (bg-canvas-bg)
  App.svelte         ← MODIFY: shell theme classes
  index.html         ← MODIFY: default to dark (class="dark" on <html>)
```

---

## Task 1: Theme foundation (CSS + dark default + deps)

**Files:**
- Modify: `src/app.css`, `index.html`, `package.json`

- [ ] **Step 1: Install SortableJS**

Run:
```bash
npm install sortablejs && npm install -D @types/sortablejs
```
Expected: `sortablejs` in `dependencies`, `@types/sortablejs` in `devDependencies`, install clean.

- [ ] **Step 2: Replace `src/app.css`**

Replace the ENTIRE contents of `src/app.css` with:
```css
@import "tailwindcss";

@theme {
  --color-surface: #ffffff;
  --color-surface-hover: #f5f5f5;
  --color-surface-active: #ebebeb;
  --color-border: #e0e0e0;
  --color-border-light: #f0f0f0;
  --color-text: #222222;
  --color-text-secondary: #666666;
  --color-text-muted: #999999;
  --color-canvas-bg: #f5f5f5;
  --color-accent: #222222;
  --color-accent-text: #ffffff;
  --color-selection: #6688cc;
}

.dark {
  --color-surface: #1e1e1e;
  --color-surface-hover: #282828;
  --color-surface-active: #333333;
  --color-border: #383838;
  --color-border-light: #2a2a2a;
  --color-text: #e0e0e0;
  --color-text-secondary: #999999;
  --color-text-muted: #666666;
  --color-canvas-bg: #121212;
  --color-accent: #e0e0e0;
  --color-accent-text: #1e1e1e;
  --color-selection: #6688cc;
}

html, body, #app { height: 100%; margin: 0; }
body {
  overscroll-behavior: none;
  font-family: system-ui, sans-serif;
  color: var(--color-text);
  background: var(--color-surface);
}

/* SortableJS drag states */
.sortable-ghost { opacity: 0.4; background: var(--color-surface-active) !important; }
.sortable-chosen { background: var(--color-surface-hover); }

/* Range input — thin track, small round thumb */
input[type="range"] { -webkit-appearance: none; appearance: none; height: 18px; background: transparent; cursor: pointer; }
input[type="range"]::-webkit-slider-runnable-track { height: 3px; border-radius: 1.5px; background: var(--color-border); }
input[type="range"]::-moz-range-track { height: 3px; border-radius: 1.5px; background: var(--color-border); border: none; }
input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--color-accent); border: 2px solid var(--color-surface); margin-top: -4.5px; box-shadow: 0 0 0 1px var(--color-border); }
input[type="range"]::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: var(--color-accent); border: 2px solid var(--color-surface); box-shadow: 0 0 0 1px var(--color-border); }
```
(Tailwind 4 generates `bg-surface`, `border-border`, `text-text-secondary`, `bg-accent`, `text-accent-text`, `bg-canvas-bg`, etc. from these `--color-*` variables.)

- [ ] **Step 3: Default the app to dark**

In `index.html`, change the `<html lang="en">` opening tag to:
```html
<html lang="en" class="dark">
```

- [ ] **Step 4: Verify**

Run: `npm run check` — 0 errors. `npm test` — 69 pass. `npx vite build` — succeeds. `npm run dev` (headless) — boots clean.

- [ ] **Step 5: Commit**

```bash
git add src/app.css index.html package.json package-lock.json
git commit -m "feat(ui): port slop-paint dark theme (Tailwind @theme) + sortablejs dep"
```

---

## Task 2: Layer operations (duplicate / merge down / reorder)

**Files:**
- Modify: `src/state/appState.svelte.ts`

These are DOM-coupled state mutations, consistent with the existing `addLayerToProject`/`removeLayer` (no unit tests; verified by build + manual). `mergeDown` composites per frame.

- [ ] **Step 1: Add the three functions**

In `src/state/appState.svelte.ts`, after the existing `export function removeLayer(id: number) { … }`, add. First ensure the document import includes `cloneCanvas`, `createDrawingLayer`, `resolveKeyframeIndex`, `type Cell`, `type DrawingLayer` — merge these into the existing `import { … } from "../anim/document"` line. Also ensure `ensureDrawableKeyframe` is imported from `../anim/timeline` (merge into the existing CanvasOps import or add a value import):
```ts
import { ensureDrawableKeyframe } from "../anim/timeline";
```
Then add:
```ts
/** Reorder the layer stack to exactly `ordered` (bottom→top) and repaint. */
export function reorderLayers(ordered: Layer[]) {
  state.project.layers = ordered;
  bump();
}

/** Duplicate a drawing layer (cloning every key cell's canvas) above it, and make it active. */
export function duplicateLayer(id: number) {
  const layers = state.project.layers;
  const idx = layers.findIndex((l) => l.id === id);
  if (idx === -1) return;
  const src = layers[idx];
  if (!isDrawingLayer(src)) return; // only drawing layers duplicate (clone pixels)
  const dup = createDrawingLayer(state.project.frameCount, `${src.name} copy`);
  dup.visible = src.visible;
  dup.locked = src.locked;
  dup.opacity = src.opacity;
  dup.cells = src.cells.map((c): Cell =>
    c.kind === "key" ? { kind: "key", canvas: cloneCanvas(c.canvas) } : { kind: "hold" }
  );
  layers.splice(idx + 1, 0, dup);
  state.activeLayerId = dup.id;
  bump();
}

/** Merge the drawing layer `id` down onto the drawing layer directly below it, then remove it. */
export function mergeDown(id: number) {
  const layers = state.project.layers;
  const idx = layers.findIndex((l) => l.id === id);
  if (idx <= 0) return; // nothing below
  const upper = layers[idx];
  const below = layers[idx - 1];
  if (!isDrawingLayer(upper) || !isDrawingLayer(below)) return;

  for (let f = 0; f < state.project.frameCount; f++) {
    const uki = resolveKeyframeIndex(upper.cells, f);
    if (uki === null) continue;
    const uCell = upper.cells[uki];
    if (uCell.kind !== "key") continue;
    // Ensure the lower layer owns a keyframe at this frame, then blit the upper onto it.
    const target = ensureDrawableKeyframe(below as DrawingLayer, f, canvasOps);
    const ctx = target.getContext("2d")!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = upper.opacity / 100;
    ctx.drawImage(uCell.canvas, 0, 0);
    ctx.restore();
  }
  layers.splice(idx, 1);
  state.activeLayerId = below.id;
  bump();
}
```

- [ ] **Step 2: Verify**

Run: `npm run check` — 0 errors (all imports resolve; no duplicates). `npm test` — 69 pass.

- [ ] **Step 3: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat(layers): duplicateLayer, mergeDown, reorderLayers"
```

---

## Task 3: Rebuild LayerList (dark theme, icons, button bar, drag-and-drop)

**Files:**
- Modify: `src/lib/LayerList.svelte`

- [ ] **Step 1: Replace the component**

Replace the ENTIRE contents of `src/lib/LayerList.svelte` with:
```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import Sortable from "sortablejs";
  import { Plus, Copy, ArrowDownToLine, Trash2, Eye, EyeOff, GripVertical } from "@lucide/svelte";
  import { state, bump, removeLayer, duplicateLayer, mergeDown, reorderLayers } from "../state/appState.svelte";
  import { createDrawingLayer } from "../anim/document";

  let listEl: HTMLDivElement;

  function addLayer() {
    const layer = createDrawingLayer(state.project.frameCount);
    state.project.layers.push(layer);
    state.activeLayerId = layer.id;
    bump();
  }

  // Display order is top-first (reverse of the bottom→top data order).
  // On drop, rebuild the data array from the DOM order so Svelte and Sortable agree.
  function onDrop() {
    const ids = [...listEl.children].map((el) => Number((el as HTMLElement).dataset.layerId));
    const byId = new Map(state.project.layers.map((l) => [l.id, l]));
    const newDisplayOrder = ids.map((id) => byId.get(id)).filter((l): l is NonNullable<typeof l> => !!l);
    reorderLayers(newDisplayOrder.reverse());
  }

  onMount(() => {
    const sortable = Sortable.create(listEl, {
      handle: ".layer-drag-handle",
      animation: 150,
      onEnd: onDrop,
    });
    return () => sortable.destroy();
  });
</script>

<div class="w-56 border-l border-border bg-surface flex flex-col text-text">
  <div class="flex items-center gap-1 p-1 border-b border-border">
    <span class="text-xs font-semibold text-text-secondary flex-1 px-1">Layers</span>
    <button class="w-7 h-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary" title="Add layer" onclick={addLayer}><Plus size={16} /></button>
    <button class="w-7 h-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary" title="Duplicate layer" onclick={() => duplicateLayer(state.activeLayerId)}><Copy size={16} /></button>
    <button class="w-7 h-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary" title="Merge down" onclick={() => mergeDown(state.activeLayerId)}><ArrowDownToLine size={16} /></button>
    <button class="w-7 h-7 rounded hover:bg-surface-hover flex items-center justify-center text-text-secondary" title="Delete layer" onclick={() => removeLayer(state.activeLayerId)}><Trash2 size={16} /></button>
  </div>

  <div bind:this={listEl} class="flex-1 overflow-y-auto">
    {#each [...state.project.layers].reverse() as layer (layer.id)}
      <div data-layer-id={layer.id}
           class="flex items-center gap-1 px-1 py-1 border-b border-border-light cursor-pointer hover:bg-surface-hover"
           class:bg-surface-active={layer.id === state.activeLayerId}
           onclick={() => (state.activeLayerId = layer.id)} role="presentation">
        <span class="layer-drag-handle cursor-grab text-text-muted" title="Drag to reorder"><GripVertical size={14} /></span>
        <button class="text-text-secondary" title="Toggle visibility"
                onclick={(e) => { e.stopPropagation(); layer.visible = !layer.visible; bump(); }}>
          {#if layer.visible}<Eye size={15} />{:else}<EyeOff size={15} />{/if}
        </button>
        {#if layer.kind === "ref"}
          <span class="text-[9px] px-1 rounded bg-surface-active text-text-muted uppercase">{layer.media.type}</span>
        {/if}
        <span class="flex-1 text-xs truncate">{layer.name}</span>
        <input class="w-10" type="range" min="0" max="100" bind:value={layer.opacity} onchange={bump}
               onclick={(e) => e.stopPropagation()} title="Opacity" />
      </div>
    {/each}
  </div>
</div>
```

- [ ] **Step 2: Verify**

Run: `npm run check` — 0 errors (lucide + sortablejs types resolve). `npm test` — 69 pass. `npx vite build` — succeeds.
(Manual later: drag a row by its handle to reorder; Add/Duplicate/Merge/Delete operate on the active layer; visibility/opacity work.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/LayerList.svelte
git commit -m "feat(ui): layers panel — dark theme, icons, button bar, drag-and-drop"
```

---

## Task 4: Restyle Toolbar (Lucide icons + theme) + theme toggle

**Files:**
- Modify: `src/lib/Toolbar.svelte`

- [ ] **Step 1: Convert the toolbar to icons + theme classes**

Read `src/lib/Toolbar.svelte`. Keep ALL existing logic/handlers (tools, undo/redo, size & press sliders, color, add image/video, export, save/open/new). Make two kinds of change:
1. **Icons:** add this import at the top of the `<script>`:
```ts
  import { Paintbrush, Eraser, PaintBucket, BoxSelect, Lasso, Undo2, Redo2, Image, Film, Download, Save, FolderOpen, FilePlus2, Sun, Moon } from "@lucide/svelte";
```
Replace each text-label button's text with the icon (keep the same `onclick`/`class:font-bold`/`title`). Mapping: Brush→`<Paintbrush size={18}/>`, Eraser→`<Eraser size={18}/>`, Fill→`<PaintBucket size={18}/>`, Select→`<BoxSelect size={18}/>`, Lasso→`<Lasso size={18}/>`, Undo→`<Undo2 size={18}/>`, Redo→`<Redo2 size={18}/>`, Add Image→`<Image size={18}/>`, Add Video→`<Film size={18}/>`, Export→`<Download size={18}/>`, Save→`<Save size={18}/>`, Open→`<FolderOpen size={18}/>`, New→`<FilePlus2 size={18}/>`. Add a `title` attribute (the old label text) to each icon button so hover tooltips remain. Wrap each in the standard button class below.
2. **Theme + button styling:** change the toolbar container class from `bg-neutral-100 border-neutral-300` to `bg-surface border-border text-text`. Give each tool/action button the class:
```
class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
```
and for the active tool keep a highlight via `class:bg-surface-active={state.tool === "brush"}` (etc.) INSTEAD of `font-bold`. Keep the size/press sliders and the `{state.sizeRange}×` label (style label text `text-text-secondary`). Keep `<input type="color" bind:value={state.brush.color} />`.
3. **Theme toggle:** add `state.theme` handling — add a button at the end:
```svelte
  <button class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover ml-auto" title="Toggle theme" onclick={toggleTheme}>
    {#if state.theme === "dark"}<Sun size={18} />{:else}<Moon size={18} />{/if}
  </button>
```
and in the script:
```ts
  function toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", state.theme === "dark");
  }
```
This requires `state.theme` — added in Step 2.

- [ ] **Step 2: Add `theme` to app state**

In `src/state/appState.svelte.ts`, add to the `interface AnimState` (after `exportOpen: boolean;`):
```ts
  theme: "dark" | "light";
```
and to the `$state({…})` initializer (after `exportOpen: false,`):
```ts
  theme: "dark",
```

- [ ] **Step 3: Verify**

Run: `npm run check` — 0 errors. `npm test` — 69 pass. `npx vite build` — succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/Toolbar.svelte src/state/appState.svelte.ts
git commit -m "feat(ui): toolbar Lucide icons + dark theme + theme toggle"
```

---

## Task 5: Restyle Playbar, Timeline, ExportDialog, Canvas stage, App shell

**Files:**
- Modify: `src/lib/Playbar.svelte`, `src/lib/Timeline.svelte`, `src/lib/ExportDialog.svelte`, `src/lib/Canvas.svelte`, `src/App.svelte`

- [ ] **Step 1: Playbar — transport icons + theme**

Read `src/lib/Playbar.svelte`. Keep all logic. Add import:
```ts
  import { SkipBack, ChevronLeft, Play, Pause, ChevronRight, SkipForward, Repeat, Layers } from "@lucide/svelte";
```
Replace transport glyphs: first→`<SkipBack size={16}/>`, prev (◀)→`<ChevronLeft size={16}/>`, play/pause→`{#if state.playback.isPlaying}<Pause size={16}/>{:else}<Play size={16}/>{/if}`, next (▶▎)→`<ChevronRight size={16}/>`, last→`<SkipForward size={16}/>`. Keep `loop` as a checkbox+label or use `<Repeat size={14}/>` next to it. Keep the fps input + presets and the onion controls (you may prefix the onion group with `<Layers size={14}/>`). Change the bar container class `bg-neutral-100 border-neutral-300` → `bg-surface border-border text-text`; give transport buttons `class="w-7 h-7 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"`; muted text → `text-text-secondary`; number inputs → `bg-surface border border-border text-text`.

- [ ] **Step 2: Timeline — theme classes**

Read `src/lib/Timeline.svelte`. Keep all logic. Change container `bg-neutral-100 border-neutral-300` → `bg-surface border-border text-text`. Frame cells: border `border-neutral-300` → `border-border`; current-frame highlight `bg-amber-200` → `bg-selection text-accent-text` (or keep amber — pick `bg-selection`). Buttons (+Frame, Keyframe, Dup, Hold, ◀/▶): give them `class="px-2 py-0.5 rounded text-text-secondary hover:bg-surface-hover border border-border"`. Layer-name column text → `text-text-secondary`.

- [ ] **Step 3: ExportDialog — theme classes**

Read `src/lib/ExportDialog.svelte`. Keep all logic. Change the dialog panel `bg-neutral-100` → `bg-surface text-text border border-border`; buttons `border-neutral-300` → `border-border hover:bg-surface-hover`; muted/status text → `text-text-secondary`. Keep the `bg-black/40` backdrop.

- [ ] **Step 4: Canvas stage background**

In `src/lib/Canvas.svelte`, change the stage div class `bg-neutral-300` → `bg-canvas-bg` (keep `relative flex-1 overflow-hidden touch-none` and the `bind:this={stage}`/`onwheel`).

- [ ] **Step 5: App shell**

In `src/App.svelte`, the root `<div class="h-full flex flex-col">` — change to `<div class="h-full flex flex-col bg-surface text-text">`. (Toolbar/Playbar/Timeline already carry their own surface colors.)

- [ ] **Step 6: Verify**

Run: `npm run check` — 0 errors. `npm test` — 69 pass. `npx vite build` — succeeds. `npm run dev` (headless) — boots clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/Playbar.svelte src/lib/Timeline.svelte src/lib/ExportDialog.svelte src/lib/Canvas.svelte src/App.svelte
git commit -m "feat(ui): dark theme across playbar, timeline, export dialog, canvas, shell"
```

---

## Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Automated DoD**

Run and confirm: `npm run check` (0 errors), `npm test` (69 pass), `npx vite build` (success), `npm run dev` headless (boots, no errors).

- [ ] **Step 2: Manual verification checklist (HUMAN — required; no browser automation here)**

Run `npm run dev:lan` (or `dev`):
1. **Dark theme** everywhere (toolbar, layers, timeline, playbar, canvas backdrop), text readable.
2. **Icons** show for every tool/action; hover tooltips (titles) present; active tool is highlighted.
3. **Theme toggle** (Sun/Moon at toolbar end) flips dark↔light.
4. **Layers panel**: Add Layer adds one; **drag a row by its grip handle** to reorder → stacking order in the canvas changes accordingly; **Duplicate** clones the active layer (and its drawing); **Merge Down** flattens the active layer onto the one below; **Delete** removes it (keeps ≥1 drawing layer); per-row eye toggles visibility; opacity slider works.
5. **No regression**: drawing (pen pressure), onion, playback, fill, selection, reference layers, export, save/load all still work.

---

## Self-Review (completed during planning)

**Spec coverage (the user's requests):** dark theme — Task 1 (`@theme` + `.dark` + default dark) + Task 5 (components); Lucide icons — Tasks 3–5; layers panel button bar (Add/Duplicate/Merge Down/Delete) — Tasks 2–3; drag-and-drop reorder — Task 3 (SortableJS, DOM-order-derived). Nested groups are intentionally OUT (user chose flat list).

**Placeholder scan:** Tasks 1–3 have complete code. Tasks 4–5 are mechanical icon/class swaps specified as exact mappings + exact class strings + "keep all logic"; the subagent reads the current component and slop-paint's equivalent for fidelity — acceptable for a pure restyle where the logic is unchanged.

**Type consistency:** `reorderLayers(ordered: Layer[])`, `duplicateLayer(id)`, `mergeDown(id)` defined in Task 2 and consumed by LayerList (Task 3). `state.theme` added in Task 4 Step 2 and read in Toolbar (Task 4 Step 1). Theme utility classes (`bg-surface`, `border-border`, `text-text-secondary`, `bg-surface-hover`, `bg-surface-active`, `text-accent-text`, `bg-canvas-bg`, `bg-selection`) all derive from the `--color-*` vars defined in Task 1's `app.css`.

**Risks / known limitations:** SortableJS + Svelte keyed-`each` reconciliation — mitigated by rebuilding the data array from DOM order on `onEnd` (Sortable's DOM move and the data update agree, so no revert/flicker). `mergeDown` composites per frame and is DOM-coupled (manual-verify). No rename-on-double-click (slop-paint has it; deferred — low value). All styling is visually verified by the human.
