# Toolbar Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the flat wrapping toolbar into a primary bar (tools + undo/redo + File/Import-Export/View menus) and a contextual `ToolOptions` bar that shows only the active tool's controls; move the selection Copy/Cut/Paste/Delete into that bar and remove the floating canvas paste button.

**Architecture:** New `ToolbarMenu.svelte` (reusable dropdown) and `ToolOptions.svelte` (contextual bar); `Toolbar.svelte` slims to the primary bar; two reactive `appState` flags (`selectionActive`, `hasPixelClipboard`) drive the selection ops' enable-states; `Canvas.svelte`/`SelectionActions.svelte` cleaned up. Control moves are verbatim relocations preserving `bind:`s and handlers.

**Tech Stack:** Svelte 5 (runes + snippets), TypeScript, Vite, Tailwind, Vitest.

## Global Constraints

- Build bar: `npm run build` must be **0 errors, 0 warnings**.
- All new/edited `.svelte` components are DOM — NOT node-testable. Verified by **build + reasoning + browser**. `npm test` baseline (**319**) must stay green (no logic touched in tested code).
- **Runes import-alias rule:** `Toolbar.svelte` already imports `state as appState`; new components using the `$state` rune must do the same. `Canvas.svelte` uses `state as appState`; `SelectionActions.svelte` — match its existing store import.
- Relocated controls keep the SAME `bind:value`/`bind:checked`/`onclick`/`title` — this is a move, not a rewrite. Do not restyle beyond layout.
- Surgical; match existing style. Pre-commit hook reformats staged files (expected).

## Reference: current `Toolbar.svelte` block map (403 lines)

- **Tools** (brush/eraser/fill/eyedropper/select/lasso/transform/deform/pose): L157-210 → **primary bar**.
- **Transform scope** (L211-235) → ToolOptions (transform).
- **Select/lasso "apply layer transform" warning** (L236-240) → ToolOptions (select/lasso).
- **Eraser label** (L241) → ToolOptions (eraser).
- **Brush/eraser settings** — Size+field (L242-254), presets (L255-263), Press (L264-270), brush-type select (L271-281), Opacity (L282-285), Smooth (L286-289), Stream (L290-293), Taper (L294-296), Behind (L297-304), pressure-curve popover (L305-315), color (L316) → ToolOptions (brush/eraser). **The curve-editor script** (L57-85 + onMount L61-64) moves with it.
- **Undo/Redo** (L317-326) → **primary bar**.
- **Import/Export** — Add Image (L328-332), Paste image (L333-337), Add Video (L338-342), Import audio (L343-347), Export (L348-352) → **Import/Export ▾ menu**.
- **File** — Save (L354-358), Open (L359-363), New (L364-371), Resize (L372-379) → **File ▾ menu**.
- **View** — Theme (L381-387), Transparent-bg/Grid2x2 (L388-396), Settings (L397-402) → **View ▾ menu**.
- Handlers `pick`/`onFile`/`pasteImage`/`saveProject`/`toggleTheme` + hidden `fileInput` stay in `Toolbar.svelte` (invoked from menu items).

---

## Task 1: appState flags + Canvas wiring (+ remove floating paste button)

**Files:**
- Modify: `src/state/appState.svelte.ts` (`AnimState` + state literal)
- Modify: `src/lib/Canvas.svelte` (set flags; delete the floating paste button)

**Interfaces:**
- Produces: `appState.selectionActive: boolean`, `appState.hasPixelClipboard: boolean`.

Build-verified.

- [ ] **Step 1: Add the two flags** — in `AnimState` (after `timelineSelection`/`cellClipboard`) add:

```ts
  selectionActive: boolean; // a committed canvas marquee exists (drives ToolOptions Copy/Cut/Delete)
  hasPixelClipboard: boolean; // the pixel selection clipboard has content (drives ToolOptions Paste)
```

and in the `state` literal: `selectionActive: false,` and `hasPixelClipboard: false,`.

- [ ] **Step 2: Canvas sets `selectionActive`** — in `onMount`, after `setupSelection()` (where `selection` exists), register a state-change mirror; and reset on teardown:

```ts
    selection.onStateChange = () => {
      appState.selectionActive = !!selection && selection.active && !selection.hasFloating;
    };
```
(in the cleanup return, add `appState.selectionActive = false;`). If `selection.onStateChange` is already assigned elsewhere, chain both calls in one handler rather than overwriting.

- [ ] **Step 3: Canvas sets `hasPixelClipboard`** — in `copySelection`, after `selectionClipboard = …`, add `appState.hasPixelClipboard = true;`. (Cut calls copy, so it's covered. Clipboard persists → never reset to false.)

- [ ] **Step 4: Remove the floating paste button** — delete the `{#if selectionClipboard && (appState.tool === "select" || appState.tool === "lasso")}<button …ClipboardPaste…/>{/if}` block from the Canvas markup. Keep `selectionClipboard`/`pasteSelection`/`copySelection` etc. Remove the now-unused `ClipboardPaste` import from Canvas **only if** nothing else uses it.

- [ ] **Step 5: Verify** — `npm run build` 0/0; `npm test` 319.

- [ ] **Step 6: Commit**
```bash
git add src/state/appState.svelte.ts src/lib/Canvas.svelte
git commit -m "feat: selectionActive/hasPixelClipboard flags; remove floating canvas paste button"
```

---

## Task 2: SelectionActions cleanup (remove Copy/Cut/Delete)

**Files:**
- Modify: `src/lib/SelectionActions.svelte` (remove the 3 buttons + props)
- Modify: `src/lib/Canvas.svelte` (remove `onCopy`/`onCut`/`onDelete` from the `<SelectionActions>` render)

**Interfaces:** none produced; `copySelection`/`cutSelection`/`deleteSelection` remain in Canvas (used by ToolOptions via `selectionActions` in Task 4).

Build-verified.

- [ ] **Step 1:** In `SelectionActions.svelte`, remove the Copy/Cut/Delete `<button>`s (added previously) and the `onCopy`/`onCut`/`onDelete` props from `$props()`. Remove the now-unused `Copy`/`Scissors`/`Trash2` lucide imports.
- [ ] **Step 2:** In `Canvas.svelte`, remove `onCopy={copySelection}` / `onCut={cutSelection}` / `onDelete={deleteSelection}` from `<SelectionActions … />`. (Keep the functions — `selectionActions.copy/cut/del` still reference them.)
- [ ] **Step 3: Verify** — `npm run build` 0/0; `npm test` 319.
- [ ] **Step 4: Commit**
```bash
git add src/lib/SelectionActions.svelte src/lib/Canvas.svelte
git commit -m "refactor: move selection Copy/Cut/Delete off the near-selection bar (to ToolOptions)"
```

---

## Task 3: `ToolbarMenu.svelte` (reusable dropdown)

**Files:**
- Create: `src/lib/ToolbarMenu.svelte`

**Interfaces:**
- Produces: `<ToolbarMenu label="File">{#snippet children(close)}…items…{/snippet}</ToolbarMenu>` — a trigger button + click-to-open popover, dismiss on outside-click, and a `close` passed to items.

Build-verified.

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";
  import { clickOutside } from "./click-outside";

  // `children` receives a `close()` so menu items can dismiss the popover after acting.
  let { label, children }: { label: string; children: Snippet<[() => void]> } = $props();
  let open = $state(false);
  const close = () => (open = false);
</script>

<div class="relative" use:clickOutside={close}>
  <button
    class="h-8 px-2 rounded flex items-center gap-1 text-sm text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={open}
    onclick={() => (open = !open)}
  >
    {label}<span class="text-[10px] opacity-70">▾</span>
  </button>
  {#if open}
    <div
      class="absolute right-0 top-full mt-1 z-30 min-w-44 rounded border border-border bg-surface shadow-lg py-1"
      role="menu"
    >
      {@render children(close)}
    </div>
  {/if}
</div>
```

- [ ] **Step 2: Verify** — `npm run build` 0/0.
- [ ] **Step 3: Commit**
```bash
git add src/lib/ToolbarMenu.svelte
git commit -m "feat: ToolbarMenu — reusable click-to-open dropdown"
```

---

## Task 4: `ToolOptions.svelte` (contextual bar)

**Files:**
- Create: `src/lib/ToolOptions.svelte`

**Interfaces:**
- Consumes: `appState` (tool/brush/eraser/fill/transformScope), `activeLayer`, `isIdentityTransform`, `pressureCurve`/`bumpCurve` + `createCurveEditor`, `selectionActions`, `appState.selectionActive`/`hasPixelClipboard`.
- Produces: the second toolbar row.

Build + browser verified. The bar is **always present** (fixed height) so the canvas doesn't jump.

- [ ] **Step 1: Scaffold + move the brush/eraser + curve-editor script**

Create `src/lib/ToolOptions.svelte`. Script: `import { state as appState, pressureCurve, bumpCurve, activeLayer, selectionActions } from "../state/appState.svelte";`, `import { isIdentityTransform } from "../anim/document";`, `import { createCurveEditor } from "../core/pressure-curve";`, `import { clickOutside } from "./click-outside";`, lucide icons needed by moved controls (`Spline`, and for the select block `Copy, Scissors, ClipboardPaste, Trash2`). Move **verbatim** from `Toolbar.svelte`: the `SIZE_PRESETS` const, the `stroke` derived, the whole **curve editor** block (`curveOpen`/`curvePopupEl`/`curveEditor`/`onMount` append/`positionPopup`/the `$effect`) — L53-85 + L61-64. (The `.curve-popup`/`.open` styles are GLOBAL in `src/app.css` — no `<style>` move needed; the class keeps working in ToolOptions.)

- [ ] **Step 2: The contextual markup**

Outer: `<div class="flex items-center gap-2 px-2 h-10 border-b border-border bg-surface text-text overflow-x-auto">`. Inside, one `{#if}` chain on `appState.tool`:

- **brush/eraser** (`appState.tool === "brush" || appState.tool === "eraser"`): move **verbatim** the eraser label (L241), Size+field (L242-254), presets (L255-263), Press (L264-270), brush-type select (L271-281), Opacity (L282-285), Smooth (L286-289), Stream (L290-293), Taper (L294-296), Behind (L297-304, keeps its `{#if appState.tool !== "eraser"}`), pressure-curve popover (L305-315), color (L316).
- **fill** (`appState.tool === "fill"`):

```svelte
    <label class="flex items-center gap-1 text-xs text-text-secondary" title="Fill color tolerance"
      >Tolerance
      <input type="range" min="0" max="128" class="w-24" bind:value={appState.fill.tolerance} />
      <span class="text-xs w-6 tabular-nums">{appState.fill.tolerance}</span>
    </label>
    <label class="flex items-center gap-1 text-xs text-text-secondary" title="Grow the filled region (px)"
      >Expand
      <input type="range" min="0" max="8" class="w-16" bind:value={appState.fill.expand} />
      <span class="text-xs w-4 tabular-nums">{appState.fill.expand}</span>
    </label>
    <input type="color" bind:value={appState.brush.color} title="Fill color" />
```

- **select/lasso** (`appState.tool === "select" || appState.tool === "lasso"`): the Copy/Cut/Paste/Delete group + the transform-disabled warning (move L236-240 verbatim into here):

```svelte
    {@const btn = "w-9 h-9 rounded border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover disabled:opacity-40 disabled:cursor-default"}
    <button class={btn} title="Copy (Cmd/Ctrl+C)" disabled={!appState.selectionActive} onclick={() => selectionActions.copy?.()}><Copy size={16} /></button>
    <button class={btn} title="Cut (Cmd/Ctrl+X)" disabled={!appState.selectionActive} onclick={() => selectionActions.cut?.()}><Scissors size={16} /></button>
    <button class={btn} title="Paste (Cmd/Ctrl+V)" disabled={!appState.hasPixelClipboard} onclick={() => selectionActions.paste?.()}><ClipboardPaste size={16} /></button>
    <button class={btn} title="Delete (Del)" disabled={!appState.selectionActive} onclick={() => selectionActions.del?.()}><Trash2 size={16} /></button>
    {#if activeLayer().kind === "draw" && !isIdentityTransform(activeLayer().transform)}
      <span class="text-xs text-amber-500" title="Selection is disabled on a transformed layer">Apply layer transform to select</span>
    {/if}
```

- **transform** (`appState.tool === "transform"`): move the transform-scope block (L211-235) verbatim.
- **deform** (`appState.tool === "deform"`): a one-line hint for now — `<span class="text-xs text-text-muted">Drag the grid handles on the canvas · FFD/Rigid in the selection bar</span>` (its controls live on the near-selection bar; keep minimal).
- **else** (eyedropper/pose): `<span class="text-xs text-text-muted">…</span>` hint or empty — the bar stays present.

- [ ] **Step 3: Render it in App.svelte** — in `src/App.svelte`, add `import ToolOptions from "./lib/ToolOptions.svelte";` and render `<ToolOptions />` immediately after `<Toolbar />`.

- [ ] **Step 4: Verify** — `npm run build` 0/0; `npm test` 319.

- [ ] **Step 5: Browser verification (user-deferred checklist — do NOT run a browser)**
Record: brush/eraser settings all work (size/presets/press/type/opacity/smooth/stream/taper/behind/curve/color); fill shows tolerance/expand/color; select/lasso shows Copy/Cut/Paste/Delete with correct enable-states driving the same ops; transform shows scope; the bar stays present (no jump) on tool switch.

- [ ] **Step 6: Commit**
```bash
git add src/lib/ToolOptions.svelte src/App.svelte
git commit -m "feat: ToolOptions contextual bar (per-tool settings + selection ops)"
```

---

## Task 5: `Toolbar.svelte` primary bar + menus

**Files:**
- Modify: `src/lib/Toolbar.svelte` (remove moved markup; add the three menus; keep handlers/fileInput)

**Interfaces:**
- Consumes: `ToolbarMenu` (Task 3); existing handlers `pick`/`onFile`/`pasteImage`/`saveProject`/`toggleTheme`.

Build + browser verified.

- [ ] **Step 1: Trim the script** — remove the brush/curve-editor pieces now in ToolOptions: `SIZE_PRESETS`, `stroke`, `curveOpen`/`curvePopupEl`/`curveEditor`, `onMount` (curve append), `positionPopup`, the curve `$effect`, and the `createCurveEditor`/`pressureCurve`/`bumpCurve`/`isIdentityTransform`/`activeLayer` imports **if no longer used** in Toolbar. Keep `pick`/`onFile`/`pasteImage`/`saveProject`/`toggleTheme`, `fileInput`, and their imports. Add `import ToolbarMenu from "./ToolbarMenu.svelte";`. Keep only the lucide icons still used (tools + Undo2/Redo2; menu items can be text-only — see below).

- [ ] **Step 2: Rebuild the markup** — the outer stays `<div class="flex items-center gap-1 p-2 border-b border-border bg-surface text-text">` (drop `flex-wrap`). Contents in order:
  1. The **tool buttons** (L157-210) verbatim. Optionally add thin `<span class="w-px h-5 bg-border mx-1">` dividers between tool groups (draw | select | transform) for grouping.
  2. **Undo/Redo** (L317-326) verbatim.
  3. `<span class="flex-1"></span>` spacer (push menus right).
  4. The **three menus** (define `const menuItem = "w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-hover flex items-center gap-2";`):

```svelte
  <ToolbarMenu label="File">
    {#snippet children(close)}
      <button class={menuItem} onclick={() => { pick("project"); close(); }}>Open…</button>
      <button class={menuItem} onclick={() => { saveProject(); close(); }}>Save</button>
      <button class={menuItem} onclick={() => { appState.sizeDialog.mode = "new"; appState.sizeDialog.open = true; close(); }}>New…</button>
      <button class={menuItem} onclick={() => { appState.sizeDialog.mode = "resize"; appState.sizeDialog.open = true; close(); }}>Resize canvas…</button>
    {/snippet}
  </ToolbarMenu>
  <ToolbarMenu label="Import/Export">
    {#snippet children(close)}
      <button class={menuItem} onclick={() => { pick("image"); close(); }}>Add image…</button>
      <button class={menuItem} onclick={() => { pasteImage(); close(); }}>Paste image from clipboard</button>
      <button class={menuItem} onclick={() => { pick("video"); close(); }}>Add video…</button>
      <button class={menuItem} onclick={() => { pick("audio"); close(); }}>Import audio…</button>
      <button class={menuItem} onclick={() => { appState.exportOpen = true; close(); }}>Export…</button>
    {/snippet}
  </ToolbarMenu>
  <ToolbarMenu label="View">
    {#snippet children(close)}
      <button class={menuItem} onclick={() => { toggleTheme(); close(); }}>{appState.theme === "dark" ? "Light theme" : "Dark theme"}</button>
      <button class={menuItem} onclick={() => { appState.project.transparentBg = !appState.project.transparentBg; bump(); close(); }}>{appState.project.transparentBg ? "Opaque background" : "Transparent background"}</button>
      <button class={menuItem} onclick={() => { appState.settingsOpen = true; close(); }}>Project settings…</button>
    {/snippet}
  </ToolbarMenu>
```
  5. Keep the hidden `<input bind:this={fileInput} type="file" class="hidden" onchange={onFile} />`.

(`bump` is already imported in Toolbar. If any menu item references a symbol no longer imported, add it back.)

- [ ] **Step 3: Verify** — `npm run build` 0/0; `npm test` 319.

- [ ] **Step 4: Browser verification (user-deferred checklist — do NOT run a browser)**
Record: primary bar = tools + undo/redo + File/Import-Export/View; each menu opens on click, dismisses on outside-click and on item select, and every item performs its action (open/save/new/resize; add image/paste/video/audio/export; theme/transparent/settings); the bar no longer wraps; iPad reachability.

- [ ] **Step 5: Commit**
```bash
git add src/lib/Toolbar.svelte
git commit -m "feat: slim Toolbar to primary bar (tools + history + File/Import-Export/View menus)"
```

---

## Final verification

- [ ] **Full build:** `npm run build` → 0 errors, 0 warnings.
- [ ] **Full tests:** `npm test` → 319 passing.
- [ ] **Interactive pass (flag as verification debt):** every relocated control works; contextual bar swaps per tool with no layout jump; menus open/dismiss/act; selection Copy/Cut/Paste/Delete enable-states + actions; floating canvas paste button gone; near-selection bar keeps only transform ops; iPad reachability of everything (no keyboard needed); no toolbar wrapping.

---

## Spec coverage self-check

- Contextual model: primary `Toolbar` + `ToolOptions` (D1) → Tasks 4, 5.
- Menus as click popovers (D2) → Task 3 (`ToolbarMenu`) + Task 5.
- Selection ops on the contextual bar, removed from the floating bar (D3) → Task 4 (select block + flags) + Task 2 (SelectionActions cleanup).
- Floating paste button removed (D4) → Task 1 Step 4.
- Undo/Redo on primary bar (D5) → Task 5.
- Reactive enable-states → Task 1 flags + Task 4 `disabled=`.
- Fill tolerance/expand (new, small, per spec layout) → Task 4 fill block.
- Deferred (left rail, customization, restyle) → per spec Non-goals.
