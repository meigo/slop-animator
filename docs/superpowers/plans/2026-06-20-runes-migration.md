# Runes Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the five legacy-mode Svelte components (AudioLane, Toolbar, Playbar, LayerList, Timeline) to runes, then enforce runes globally — removing the `deep_read_state` coarse-reactivity tax. No behavior change.

**Architecture:** Per-component, mechanical conversion. The shared `state` proxy and all store actions are untouched; template reads of `state` keep the same syntax and become fine-grained automatically. One commit per component; a profiling gate after the two measured offenders.

**Tech Stack:** Svelte 5 runes, TypeScript, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-20-runes-migration-design.md`

**Branch:** execute on a new branch `runes-migration` (off `main`).

**The conversion rule (apply per component):** for each top-level `let`, if it is **read in the template** (or in a `$derived`/`$effect`) → `let x = $state(init)`. If it is only a `bind:this` element ref, a pure-logic latch, or drag/undo bookkeeping **not** shown in the UI → leave it a plain `let`. Getting a template-read `let` wrong = it silently stops updating, so the per-task manual check exercises exactly those bindings. No new automated tests (Svelte components aren't node-renderable); the existing **209** must stay green and every build must be **0 errors / 0 warnings**.

---

### Task 1: AudioLane → runes (gate offender, tiny)

**Files:** Modify `src/lib/AudioLane.svelte`

- [ ] **Step 1: Props → `$props`**

Replace:
```ts
  export let cellW: number;
  export let labelW: number;
```
with:
```ts
  let { cellW, labelW }: { cellW: number; labelW: number } = $props();
```
No other reactive constructs exist (the `waveform` use-action and its `{ audioVersion }` param are unchanged — actions work in runes).

- [ ] **Step 2: Verify** — `npm run build` → 0/0; `npm test` → 209 pass.
- [ ] **Step 3: Manual** (`npm run dev`) — with an audio track loaded: the waveform draws, stays aligned with the frame columns on zoom/scroll, and the remove-audio (✕) button works.
- [ ] **Step 4: Commit**
```bash
git add src/lib/AudioLane.svelte
git commit -m "refactor: AudioLane to runes ($props)"
```

---

### Task 2: Toolbar → runes (gate offender)

**Files:** Modify `src/lib/Toolbar.svelte`

- [ ] **Step 1: Replace the store with `$state`**

- Remove `import { writable } from "svelte/store";` (line 3).
- `const curveOpen = writable(false);` → `let curveOpen = $state(false);`.

- [ ] **Step 2: `$:` → `$effect`**

Replace:
```ts
  $: if ($curveOpen) {
    curveEditor?.redraw();
    requestAnimationFrame(positionPopup);
  }
```
with:
```ts
  $effect(() => {
    if (curveOpen) {
      curveEditor?.redraw();
      requestAnimationFrame(positionPopup);
    }
  });
```

- [ ] **Step 3: Update the store call-sites in the template**

- `use:clickOutside={() => curveOpen.set(false)}` → `={() => (curveOpen = false)}`
- `class:bg-surface-active={$curveOpen}` → `={curveOpen}`
- `onclick={() => curveOpen.update(v => !v)}` → `={() => (curveOpen = !curveOpen)}`
- `class:open={$curveOpen}` → `={curveOpen}`

- [ ] **Step 4: Other `let`s** — `curveEditor`, `curvePopupEl`, `fileInput` are `bind:this`/imperative refs and `pendingKind` is JS-only; all stay plain `let`. The two `onMount` blocks stay. Confirm no remaining `$store` (`$curveOpen`) or `writable` references.

- [ ] **Step 5: Verify** — `npm run build` → 0/0; `npm test` → 209 pass.
- [ ] **Step 6: Manual** (`npm run dev`) — tools switch; brush size slider/number/presets, opacity/smooth/stream, taper, color, brush-type all work; **the pressure-curve popup** opens, redraws, repositions near the edge, and closes on click-outside; undo/redo, add image/video, paste, save/load, theme toggle work.
- [ ] **Step 7: Commit**
```bash
git add src/lib/Toolbar.svelte
git commit -m "refactor: Toolbar to runes (curveOpen $state, $effect)"
```

---

### Task 3: 🔬 Profiling gate (controller + human; no code)

**This is a human-in-the-loop checkpoint, not a code task.** After Tasks 1–2 are merged into the working branch:

- [ ] Run `npm run dev`, open DevTools → **Performance**, scrub a ~500-frame project for a few seconds, record.
- [ ] **Confirm `deep_read_state` self-time has dropped sharply** (the AudioLane + Toolbar contributors are gone).
- [ ] **Decision:** if it dropped as predicted → proceed to Task 4. If it did **not** drop → STOP and reassess the thesis (do not migrate the remaining three on a disproven premise).

---

### Task 4: Playbar → runes (trivial)

**Files:** Modify `src/lib/Playbar.svelte`

- [ ] **Step 1:** `let settingsOpen = false;` → `let settingsOpen = $state(false);` (its only reactive local; everything else is template reads of `state` + handlers).
- [ ] **Step 2: Verify** — `npm run build` → 0/0; `npm test` → 209 pass.
- [ ] **Step 3: Manual** (`npm run dev`) — play/pause, prev/next frame, the fps input and frame-count input (incl. the shrink-confirm path), and the settings popover all work.
- [ ] **Step 4: Commit**
```bash
git add src/lib/Playbar.svelte
git commit -m "refactor: Playbar to runes ($state)"
```

---

### Task 5: LayerList → runes

**Files:** Modify `src/lib/LayerList.svelte`

- [ ] **Step 1: Reactive locals → `$state`** (these are read in the template):
```ts
  let dragNonce = $state(0);            // read in {#key dragNonce}
  let editingId: number | null = $state(null);   // {#if editingId === layer.id}
  let draft = $state("");                // bind:value={draft}
  let editingGroupId: number | null = $state(null); // {#if editingGroupId === seg.group.id}
  let groupDraft = $state("");           // bind:value={groupDraft}
```

- [ ] **Step 2: Leave these plain `let`** (refs / JS-only): `listEl`, `relinkInput` (`bind:this`), `dropHandled` (drop latch, JS-only), `relinkTargetId` (read only in the hidden input's onchange handler — verify it is NOT referenced in the template; if it is, make it `$state`).

- [ ] **Step 3:** The two `onMount`/Sortable setups stay. `buildSegments(...)` stays called in the template. Confirm the `{#key dragNonce}` re-render still fires (`dragNonce++` now mutates `$state`).

- [ ] **Step 4: Verify** — `npm run build` → 0/0; `npm test` → 209 pass.
- [ ] **Step 5: Manual** (`npm run dev`) — select a layer; rename (✎ → inline input → Enter/Esc/blur); visibility/opacity; group create/collapse/visibility/rename/ungroup; **drag-reorder including dropping at the very bottom** (the SortableJS `{#key}` path — the bug we fixed must stay fixed); rasterize/apply/reset buttons; add/duplicate/merge/delete layer.
- [ ] **Step 6: Commit**
```bash
git add src/lib/LayerList.svelte
git commit -m "refactor: LayerList to runes ($state)"
```

---

### Task 6: Timeline → runes

**Files:** Modify `src/lib/Timeline.svelte`

- [ ] **Step 1: Reactive locals → `$state`** (read in the template):
```ts
  let scrubbing = $state(false);         // verify template usage; if JS-only it may stay plain
  let boilSettingsOpen = $state(false);  // {#if boilSettingsOpen} popover
  let dragMode: DragMode = $state("none");   // per-cell class:ring-* bindings
  let dragLayerId = $state(-1);          // per-cell class bindings
  let dragTarget = $state(-1);           // f === dragTarget
  let rowCursor = $state("default");     // style="cursor: {rowCursor}"
```

- [ ] **Step 2: Leave these plain `let`** (JS-only drag/undo bookkeeping, not shown in the UI): `dragKey`, `dragUndo`, `dragStartBoundary`, `dragLastBoundary`. The `glyphCache` Map and `CELL_W`/`LABEL_W` constants stay plain. (`scrubbing` is gating logic — keep `$state` only if a template binding reads it; otherwise plain. Verify against the template.)

- [ ] **Step 3:** The precomputed-glyph code (`glyphsFor` + `timeline-glyphs.ts`) is untouched. `bind:this` refs stay plain.

- [ ] **Step 4: Verify** — `npm run build` → 0/0; `npm test` → 209 pass.
- [ ] **Step 5: Manual** (`npm run dev`) — **scrub a ~500-frame project (smooth — this is the payoff)**; frame tools (add/insert-keyframe/duplicate/hold/delete); cell strip drag-move a ◆ and drag-resize a hold span; the move ghost / target highlight shows; boil settings popover; the audio lane renders.
- [ ] **Step 6: Commit**
```bash
git add src/lib/Timeline.svelte
git commit -m "refactor: Timeline to runes ($state)"
```

---

### Task 7: Enforce runes globally

**Files:** Modify `svelte.config.js`

- [ ] **Step 1:** Add `compilerOptions: { runes: true }`:
```js
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
  compilerOptions: { runes: true },
};
```

- [ ] **Step 2: Build → fix fallout** — `npm run build`. With `runes: true` global, any remaining legacy construct (`export let`, top-level `$:`, an implicitly-reactive `let` read in a template) becomes a **compile error**. Fix each by converting it (`export let`→`$props`, `$:`→`$derived`/`$effect`, reactive `let`→`$state`). Must end at 0 errors / 0 warnings. (The six already-runes components and the five migrated above should produce none; this flag is the safety net.)

- [ ] **Step 3: Verify** — `npm test` → 209 pass.
- [ ] **Step 4: Broad manual smoke** (`npm run dev`) — open every panel and exercise one action each (toolbar tools + popup, layer list select/drag, timeline scrub + frame tool, playbar play, audio lane, export/size dialogs, canvas draw + transform gizmo) — the global flag could surface a missed legacy reliance anywhere.
- [ ] **Step 5: Commit**
```bash
git add svelte.config.js
git commit -m "build: enforce Svelte runes mode globally (compilerOptions.runes)"
```

---

## Final verification

- [ ] `npm run build` → 0 errors, 0 warnings.
- [ ] `npm test` → 209 pass (unchanged).
- [ ] Gate (Task 3) confirmed `deep_read_state` collapsed; Timeline scrub feels smooth (Task 6).
- [ ] Broad manual smoke (Task 7) clean — every panel works, no silently-stale binding.

## Self-Review (completed by plan author)

**Spec coverage:** AudioLane `$props` (T1) ✅; Toolbar store→`$state` + `$effect` + call-sites (T2) ✅; profiling gate (T3) ✅; Playbar (T4) ✅; LayerList reactive `let`→`$state`, refs/latch plain, `{#key}` preserved (T5) ✅; Timeline reactive `let`→`$state`, drag bookkeeping + `glyphCache` plain (T6) ✅; global `runes: true` + fallout fix (T7) ✅; per-component manual checks + no new tests + 209 green (all tasks) ✅; out-of-scope (already-runes components, behavior changes) respected ✅.

**Placeholder scan:** No TBD/TODO; each task lists concrete edits. The two "verify template usage" notes (`relinkTargetId`, `scrubbing`) are explicit conditional instructions with a default, not placeholders.

**Consistency:** The conversion rule is stated once and applied identically per component; `$state`/`$props`/`$effect`/`$derived` used per the spec; the SortableJS `{#key dragNonce}` and the precomputed-glyph fixes are explicitly preserved. Order matches the spec (gate after T2).
