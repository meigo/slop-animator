# Layer Row Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compact LayerList rows (handle · eye · type-icon · name) for every layer, with a second row of detail controls (opacity+%, rename, ref offset/re-link) shown only for the active layer.

**Architecture:** Pure presentation change to the single `layerRow` snippet in `LayerList.svelte`. No model/store/persistence/drag-logic changes; the `data-layer-id` wrapper (the SortableJS item) stays intact, so grouping + drag are unaffected.

**Tech Stack:** Svelte 5 (legacy mode — this component uses plain `let`, no `$state`), Tailwind, lucide.

**Spec:** `docs/superpowers/specs/2026-06-19-layer-row-redesign-design.md`

**Branch:** execute on a new branch `layer-row-redesign` (off `main`).

**Key constraints (verified):**
- Type chip → icon: `image` → `Image`, `video` → `Film`; a `missing` reference shows its `was` type icon dimmed (`text-text-muted`).
- The inline rename input stays in row 1 (replacing the name span, via the existing `editingId`/`startEdit`/`commitEdit`/`focusSelect`); only its trigger ✎ moves to row 2. `startEdit` is reachable only from the active layer's row 2, so `editingId` always tracks the active layer (blur commits when you click away).
- Every control keeps its existing handler + `e.stopPropagation()` so the wrapper's select-`onclick` and the drag handle aren't disturbed.

---

### Task 1: rewrite the `layerRow` snippet

**Files:**
- Modify: `src/lib/LayerList.svelte`

No automated test (UI-only; no DOM in Vitest). Verification = build + the manual checklist.

- [ ] **Step 1: Add icons to the import**

In `src/lib/LayerList.svelte` line 4, add `Image, Film` to the existing `@lucide/svelte` import:
```ts
  import { Plus, Copy, ArrowDownToLine, Trash2, Eye, EyeOff, GripVertical, Pencil, Link, FolderPlus, Ungroup, ChevronDown, ChevronRight, Image, Film } from "@lucide/svelte";
```

- [ ] **Step 2: Replace the `layerRow` snippet**

Replace the entire current `{#snippet layerRow(layer: Layer)} … {/snippet}` with:

```svelte
{#snippet layerRow(layer: Layer)}
  {@const active = layer.id === state.activeLayerId}
  <div data-layer-id={layer.id}
       class="border-b border-border-light cursor-pointer hover:bg-surface-hover"
       class:bg-surface-active={active}
       onclick={() => (state.activeLayerId = layer.id)} role="presentation">
    <!-- Row 1: compact (every layer) -->
    <div class="flex items-center gap-1 px-1 py-1">
      <span class="layer-drag-handle cursor-grab text-text-muted" title="Drag to reorder"><GripVertical size={14} /></span>
      <button class="text-text-secondary" title="Toggle visibility"
              onclick={(e) => { e.stopPropagation(); layer.visible = !layer.visible; bump(); }}>
        {#if layer.visible}<Eye size={15} />{:else}<EyeOff size={15} />{/if}
      </button>
      {#if layer.kind === "ref"}
        {@const t = layer.media.type === "missing" ? layer.media.was : layer.media.type}
        <span class="shrink-0" class:text-text-muted={layer.media.type === "missing"} class:text-text-secondary={layer.media.type !== "missing"}
              title={layer.media.type === "missing" ? "Missing — re-link below" : t}>
          {#if t === "image"}<Image size={13} />{:else}<Film size={13} />{/if}
        </span>
      {/if}
      {#if editingId === layer.id}
        <input class="flex-1 min-w-0 text-xs bg-surface border border-border px-1 text-text"
               use:focusSelect bind:value={draft}
               onclick={(e) => e.stopPropagation()}
               onpointerdown={(e) => e.stopPropagation()}
               onkeydown={(e) => { if (e.key === "Enter") commitEdit(layer.id); else if (e.key === "Escape") editingId = null; }}
               onblur={() => commitEdit(layer.id)} />
      {:else}
        <span class="flex-1 text-xs truncate">{layer.name}</span>
      {/if}
    </div>
    <!-- Row 2: detail controls (active layer only) -->
    {#if active}
      <div class="flex items-center gap-2 pl-6 pr-1 pb-1 text-text-secondary">
        <input class="w-14" type="range" min="0" max="100" bind:value={layer.opacity} oninput={bump}
               onclick={(e) => e.stopPropagation()} title="Opacity" />
        <span class="text-[10px] tabular-nums w-6 text-text-muted">{layer.opacity}</span>
        <button class="text-text-muted hover:text-text-secondary" title="Rename layer"
                onclick={(e) => { e.stopPropagation(); startEdit(layer); }}><Pencil size={13} /></button>
        {#if layer.kind === "ref" && layer.media.type === "video"}
          <input class="w-9 text-xs bg-surface border border-border px-0.5 text-text" type="number" step="1"
                 bind:value={layer.offsetFrames} oninput={bump}
                 onclick={(e) => e.stopPropagation()} title="Video time offset (frames)" />
        {/if}
        {#if layer.kind === "ref" && layer.media.type === "missing"}
          <button class="text-text-muted hover:text-text-secondary" title="Re-link media"
                  onclick={(e) => { e.stopPropagation(); startRelink(layer.id); }}><Link size={13} /></button>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}
```

Notes:
- The wrapper keeps `data-layer-id={layer.id}` (SortableJS item) and the select-`onclick`; it's now `flex-col`-ish (two block children) instead of a single flex row.
- All handlers/bindings are the existing ones (`bump`, `startEdit`, `commitEdit`, `editingId`, `draft`, `focusSelect`, `startRelink`, `relinkReference` via `startRelink`); only placement + the chip→icon swap changed.
- Don't touch the group header markup, the segments `{#each}`, the `membersSortable`/root Sortable, or `rebuild` — they're unaffected.

- [ ] **Step 3: Build**

Run: `npm run build` → MUST be 0 errors, 0 warnings (watch unused-import warnings — `Image`/`Film` are both used; the old chip `<span>` is gone).
Run: `npm test` → all pass (184), unchanged (UI-only).

- [ ] **Step 4: Manual verification (browser)**

Run `npm run dev`:
- Non-active rows show only handle · eye · (type icon for refs) · name; names have room; no opacity/rename/offset visible.
- Image vs video references show distinct icons; a missing reference shows a dimmed icon with the "Missing — re-link below" tooltip even when not selected.
- Selecting a layer reveals row 2: opacity slider + the `%` value, a rename ✎, and — for refs — the video-offset input (video) and 🔗 re-link (missing). Deselecting hides row 2.
- Rename (✎ → inline edit in row 1, Enter/Esc/blur), opacity drag (canvas updates live), video offset, and re-link all still work.
- Drag a layer by its handle → still reorders; into/out of groups still works; collapse still works; the active-layer highlight spans both rows.

- [ ] **Step 5: Commit**

```bash
git add src/lib/LayerList.svelte
git commit -m "feat: compact layer rows with detail controls on a second row when selected"
```

---

## Final verification

- [ ] `npm run build` → 0 errors, 0 warnings.
- [ ] `npm test` → 184 pass (unchanged).
- [ ] Manual checklist in Task 1 Step 4 confirmed.

## Self-Review (completed by plan author)

**Spec coverage:** compact row 1 (handle/eye/type-icon/name) ✅; chip→icon incl. dimmed missing ✅; row 2 on active with opacity+%/rename/offset/re-link ✅; inline rename stays in row 1, trigger on row 2 ✅; group headers/drag/`data-layer-id` untouched ✅; out-of-scope items absent ✅.

**Placeholder scan:** No TBD/TODO; the full replacement snippet is provided. ✅

**Consistency:** Uses the existing `editingId`/`draft`/`startEdit`/`commitEdit`/`focusSelect`/`startRelink`/`bump` and the existing per-layer bindings (`layer.visible`/`opacity`/`offsetFrames`); only `Image`/`Film` are newly imported. The `data-layer-id` wrapper and `.layer-drag-handle` are preserved so `rebuild`/SortableJS keep working. ✅
