# Runes Migration of the Legacy Components — Design

**Status:** Approved (design phase)
**Date:** 2026-06-20

## Goal

Convert the five remaining **legacy-mode** Svelte components — AudioLane, Toolbar, Playbar, LayerList,
Timeline — to **runes mode**, then enforce runes globally. This is a reactivity refactor with **no
behavior change**; its purpose is to remove the legacy coarse-reactivity tax that profiling pinned as
the scrub-jitter root cause.

## Why (measured)

Scrubbing a 500-frame project spends ~5.4s (85% self-time) in Svelte's `deep_read_state`, driven by
AudioLane (`{#if state.project.audio}`) and Toolbar (template root, `state.theme`, the select-hint).
A legacy component that reads the shared `$state` subscribes **coarsely**, so every `state.playhead`
mutation (~60/s while scrubbing) re-runs its whole template, and each `$state` read recursively walks
the big `state.project` proxy (hundreds of cells). Runes give **fine-grained** reactivity — a read of
`state.theme` subscribes to `theme` only; a playhead change touches nothing in Toolbar/AudioLane — so
`deep_read_state` essentially disappears. See `memory/planned-runes-migration.md` and
`memory/svelte-reactivity-footguns.md`.

Already runes (no change): Canvas, RefTransformGizmo, ExportDialog, SelectionActions, SizeDialog, App.

## Migration mechanics (uniform across components)

- `export let x` → `let { x, … }: { x: T; … } = $props();` (with defaults where the prop had one).
- Reactive local `let x` (mutated **and** read in the template) → `let x = $state(initial);`.
- `$:` **derived value** → `const x = $derived(expr);`; `$:` **side-effect** → `$effect(() => { … });`.
- A `writable(v)` store used only inside the component → `let s = $state(v);`; replace `$s` reads with
  `s`, `s.set(x)` with `s = x`, `s.update(fn)` with `s = fn(s)`.
- **Stay plain** (`let`/`const`, no rune): non-reactive locals, caches (e.g. Timeline's `glyphCache`
  Map), `bind:this` element refs, pure constants, and imported helpers.
- Template reads of the imported `state` proxy are **unchanged in syntax** and become fine-grained
  automatically — that is the entire win.
- `onMount`/`onDestroy` remain valid in runes mode; keep them as-is (don't churn them into `$effect`).
- The `bump()` / `state.version` signal still works: a `$derived`/`$effect` (or template) that reads
  `state.version` re-runs when it bumps.

## Per-component plan (one commit each, in this order)

### 1. AudioLane (`src/lib/AudioLane.svelte`) — gate offender, tiny
- `export let cellW: number;` / `export let labelW: number;` →
  `let { cellW, labelW }: { cellW: number; labelW: number } = $props();`.
- The `waveform` use-action and its `{ audioVersion }` param are unchanged (actions work in runes).
- No other reactive constructs.

### 2. Toolbar (`src/lib/Toolbar.svelte`) — gate offender
- Remove `import { writable } from "svelte/store";`.
- `const curveOpen = writable(false);` → `let curveOpen = $state(false);`.
- `$: if ($curveOpen) { curveEditor?.redraw(); requestAnimationFrame(positionPopup); }` →
  `$effect(() => { if (curveOpen) { curveEditor?.redraw(); requestAnimationFrame(positionPopup); } });`.
- `clickOutside={() => curveOpen.set(false)}` → `… => (curveOpen = false)`;
  `class:bg-surface-active={$curveOpen}` → `={curveOpen}`;
  `onclick={() => curveOpen.update(v => !v)}` → `={() => (curveOpen = !curveOpen)}`;
  `class:open={$curveOpen}` → `={curveOpen}`.
- The two `onMount` blocks stay. Keep the `activeLayer()`-based select-hint as-is (runes makes it
  fine-grained; no need to change it here).

### 3. 🔬 Re-profile gate (no code)
Run `npm run dev`, scrub a ~500-frame project with DevTools Performance recording. **Confirm
`deep_read_state` self-time drops sharply** (the AudioLane + Toolbar contributors gone). If it does,
proceed; if it does **not** drop as predicted, STOP and reassess the thesis before migrating the rest.

### 4. Playbar (`src/lib/Playbar.svelte`) — trivial
- `let settingsOpen = false;` → `let settingsOpen = $state(false);` (its only reactive local).

### 5. LayerList (`src/lib/LayerList.svelte`)
- Reactive locals → `$state`: `editingId`, `draft`, `editingGroupId`, `groupDraft`, `dragNonce`,
  `dropHandled`, `relinkTargetId` (and any other `let` that is mutated and read in the template).
- `bind:this` refs (`listEl`, `relinkInput`) stay plain `let`.
- The two `onMount`/Sortable setups stay; the SortableJS `{#key dragNonce}` re-render still works
  (`dragNonce` is now `$state`, `dragNonce++` triggers the keyed re-render).
- `buildSegments(...)` called in the template stays in the template (fine in runes); no need to move
  it to `$derived`.

### 6. Timeline (`src/lib/Timeline.svelte`) — most local state
- Reactive locals → `$state`: the drag/scrub state (`scrubbing`, `dragMode`, `dragLayerId`,
  `dragTarget`, `boilSettingsOpen`, `rowCursor`, and any other mutated-and-read `let`).
- `glyphCache` (Map) and `CELL_W`/`LABEL_W` constants stay plain.
- The precomputed-glyph fix (`glyphsFor` + `timeline-glyphs.ts`) is untouched and still correct.
- `bind:this` refs stay plain `let`.

### 7. Enforce runes globally (`svelte.config.js`)
Add `compilerOptions: { runes: true }`. This makes every component runes-mode and prevents a future
component from silently reintroducing legacy coarse reactivity. Fix any fallout the flag surfaces
(the already-runes components are unaffected; the five above are now converted). `npm run build` must
be 0 errors / 0 warnings.

## Verification

**Per component:** `npm run build` → 0/0; `npm test` → existing 209 pass (unchanged — Svelte
components aren't node-renderable, so no new automated tests); manual browser check of *that*
component's features:
- AudioLane: waveform draws, aligns with frame columns, remove-audio works.
- Toolbar: tools switch, brush/size/presets/opacity/etc. work, pressure-curve popup opens/positions/
  redraws and closes on click-outside.
- Playbar: play/pause, frame step, fps + frame-count inputs, settings popover.
- LayerList: select/rename/visibility/opacity, group create/collapse/drag, **drag-reorder incl. to the
  bottom** (the SortableJS `{#key}` path), rasterize/apply/reset buttons.
- Timeline: scrub, frame tools (add/insert/dup/hold/delete), cell drag-move/hold-resize, boil
  settings, audio lane.

**Gate (step 3):** the scrub re-profile shows `deep_read_state` collapsing — the evidence that
justifies finishing the migration.

**After step 7:** full `npm run build` + `npm test`, plus a broad manual smoke of every panel, since
the global `runes: true` flag could surface any missed legacy reliance (e.g. a `let` that was
implicitly reactive and now needs `$state`).

## Out of scope

- The already-runes components (no change).
- Any behavior change, restyle, or feature.
- Unrelated perf work (tiled storage, composite cache, etc.).
- New automated tests for the components.

## Self-review notes

- The change is mechanical and isolated per component; each is a single reversible commit, and the
  perf-critical pair is validated at the step-3 gate before the rest.
- The one real risk is a `let` that was *implicitly* reactive in legacy mode and is missed during
  conversion (it would silently stop updating). Mitigation: per-component manual verification of that
  component's interactive features, and the `runes: true` flag at the end forces the compiler to flag
  any remaining legacy assumption.
- No store/persistence/model/data-flow change; the shared `state` proxy and all actions are untouched.
