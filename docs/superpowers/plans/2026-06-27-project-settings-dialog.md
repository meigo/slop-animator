# Project Settings Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gear-opened Project Settings dialog for live editing of the current project's background color, transparent toggle, and fps (with a Resize… handoff to the existing SizeDialog).

**Architecture:** A new `ProjectSettingsDialog.svelte` modal (mirroring `SizeDialog`'s shell) bound live to existing `Project` fields, gated by a new `settingsOpen` flag in the global store, opened by a toolbar gear button, mounted in `App.svelte`. No model/persistence changes — `bgColor`/`transparentBg`/`fps` already exist and round-trip.

**Tech Stack:** Svelte 5 runes, TypeScript, Vite.

**Spec:** `docs/superpowers/specs/2026-06-27-project-settings-dialog-design.md`

**Branch:** `feat-project-settings-dialog` (already created off `main`; the spec commit is on it).

**Conventions:** Build bar **0 errors, 0 warnings** (`npm run build`). Test baseline **270** must not drop. Husky pre-commit runs eslint+prettier. Dialog/Toolbar import the store as `state as appState` and `bump` (already imported in Toolbar). All edits are DOM/UI → build + manual (Vitest has no DOM); no new unit tests.

---

### Task 1: Dialog component + state flag + mount

**Files:**
- Modify: `src/state/appState.svelte.ts` (`AnimState` interface near `exportOpen: boolean;`; the `$state({...})` init near `exportOpen: false,`)
- Create: `src/lib/ProjectSettingsDialog.svelte`
- Modify: `src/App.svelte` (dialog imports ~line 7-8; mounts ~line 125-126)

- [ ] **Step 1: Add the `settingsOpen` flag.** In `src/state/appState.svelte.ts`, in the `AnimState` interface, after `exportOpen: boolean;`:
```ts
  exportOpen: boolean;
  settingsOpen: boolean;
```
and in the `export const state = $state({ ... })` initializer, after `exportOpen: false,`:
```ts
  exportOpen: false,
  settingsOpen: false,
```

- [ ] **Step 2: Create the dialog component** `src/lib/ProjectSettingsDialog.svelte` with EXACTLY this content (explicit handlers — no `bind:` to deep proxy props — so live updates + `bump()` are robust):
```svelte
<script lang="ts">
  import { state as appState, bump } from "../state/appState.svelte";

  function close() {
    appState.settingsOpen = false;
  }
  function setBgColor(v: string) {
    appState.project.bgColor = v;
    bump();
  }
  function setTransparent(v: boolean) {
    appState.project.transparentBg = v;
    bump();
  }
  function setFps(v: number) {
    appState.project.fps = Math.max(1, Math.min(60, Math.round(v) || 1));
    bump();
  }
  function openResize() {
    appState.settingsOpen = false;
    appState.sizeDialog.mode = "resize";
    appState.sizeDialog.open = true;
  }
</script>

{#if appState.settingsOpen}
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
    onclick={close}
    role="presentation"
  >
    <div
      class="w-80 p-4 rounded-lg bg-surface border border-border shadow-lg text-text text-sm flex flex-col gap-4"
      onclick={(e) => e.stopPropagation()}
      role="presentation"
    >
      <div class="font-semibold">Project settings</div>

      <div class="flex flex-col gap-2">
        <span class="text-text-secondary text-xs uppercase tracking-wide">Background</span>
        <label class="flex items-center gap-2 text-text-secondary">
          Color
          <input
            type="color"
            class="w-10 h-6 bg-surface border border-border rounded"
            value={appState.project.bgColor}
            oninput={(e) => setBgColor(e.currentTarget.value)}
          />
        </label>
        <label class="flex items-center gap-2 text-text-secondary">
          <input
            type="checkbox"
            checked={appState.project.transparentBg}
            onchange={(e) => setTransparent(e.currentTarget.checked)}
          /> Transparent
        </label>
        <span class="text-text-secondary text-xs"
          >When transparent, this color flattens video exports.</span
        >
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-text-secondary text-xs uppercase tracking-wide">Playback</span>
        <label class="flex items-center gap-2 text-text-secondary">
          fps
          <input
            type="number"
            min="1"
            max="60"
            class="w-20 bg-surface border border-border text-text px-1"
            value={appState.project.fps}
            oninput={(e) => setFps(e.currentTarget.valueAsNumber)}
          />
        </label>
      </div>

      <div class="flex items-center gap-3">
        <span class="text-text-secondary text-xs uppercase tracking-wide">Canvas</span>
        <span>{appState.project.width}×{appState.project.height}</span>
        <button
          class="px-2 py-1 rounded border border-border text-xs hover:bg-surface-hover"
          onclick={openResize}>Resize…</button
        >
      </div>

      <div class="flex justify-end mt-1">
        <button class="px-3 py-1 rounded bg-surface-active text-text" onclick={close}>Close</button>
      </div>
    </div>
  </div>
{/if}
```

- [ ] **Step 3: Mount in `src/App.svelte`.** Add the import alongside the other dialog imports (after `import SizeDialog from "./lib/SizeDialog.svelte";`):
```ts
  import ProjectSettingsDialog from "./lib/ProjectSettingsDialog.svelte";
```
and add the element next to the others (after `<SizeDialog />`):
```svelte
<ExportDialog />
<SizeDialog />
<ProjectSettingsDialog />
```

- [ ] **Step 4: Verify.** `npm run build` → 0/0 (run `npx svelte-check`, confirm `0 ERRORS 0 WARNINGS`). `npm test` → 270 (unchanged). Lint clean.

- [ ] **Step 5: Commit.**
```bash
git add src/state/appState.svelte.ts src/lib/ProjectSettingsDialog.svelte src/App.svelte
git commit -m "feat: Project Settings dialog (bg color, transparent, fps) + settingsOpen flag"
```

---

### Task 2: Toolbar gear button to open it

**Files:** Modify `src/lib/Toolbar.svelte` (lucide import ~line 44; after the transparency-toggle button in the right cluster, before the toolbar's closing `</div>`).

- [ ] **Step 1: Import the gear icon.** In the `@lucide/svelte` import list, add `Settings`:
```ts
    Grid2x2,
    Settings,
    ClipboardPaste,
    Pipette,
```
(If build reports `Settings` is not an exported member, use `SlidersHorizontal` instead — same usage below.)

- [ ] **Step 2: Add the gear button.** Immediately AFTER the transparency-toggle button (the one with `<Grid2x2 size={18} />`) and BEFORE the toolbar's closing `</div>`, add:
```svelte
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.settingsOpen}
    title="Project settings"
    onclick={() => (appState.settingsOpen = true)}><Settings size={18} /></button
  >
```

- [ ] **Step 3: Verify.** `npm run build` → 0/0 (`npx svelte-check` → `0 ERRORS 0 WARNINGS`). `npm test` → 270. Lint clean.

- [ ] **Step 4: Commit.**
```bash
git add src/lib/Toolbar.svelte
git commit -m "feat: toolbar gear button opens Project Settings dialog"
```

---

## Final verification

- [ ] `npm run build` → 0 errors, 0 warnings; `npm run lint` → clean; `npm test` → 270.
- [ ] **Manual (browser, `npm run dev`)** — per the spec:
  - Gear button opens the dialog; click-outside and Close dismiss it.
  - Drag the color input → canvas background recolors live (when opaque). Toggle **Transparent** → checker appears/disappears live; the toolbar transparency toggle reflects the same state.
  - Change **fps** → playback speed changes; typing empty / out-of-range clamps to 1–60.
  - **Resize…** closes settings and opens the resize dialog (scale/crop/anchor) unchanged.
  - Save → reload preserves bgColor, transparentBg, and fps.

## Self-Review (completed by plan author)

**Spec coverage:** `settingsOpen` flag (Task 1 Step 1) ✅; dialog with Background color + Transparent + hint, Playback fps (clamped), Canvas size + Resize… handoff, Close/click-outside, live + `bump()`, no Apply (Task 1 Step 2) ✅; mount in App (Task 1 Step 3) ✅; gear trigger (Task 2) ✅; toolbar transparency toggle kept (untouched — still present) ✅; no model/persistence change (uses existing fields) ✅; testing = build + manual (no new pure logic beyond the inline fps clamp) ✅; out-of-scope (SizeDialog merge, name field, undo, global prefs) untouched ✅.

**Placeholder scan:** No TBD/TODO; full component code and exact anchors provided. The `Settings`→`SlidersHorizontal` fallback is an explicit conditional, not a gap.

**Type consistency:** `settingsOpen: boolean` consistent across the `AnimState` interface, its initializer, the dialog's render gate / setter, and the gear button's setter. `appState.sizeDialog.mode = "resize"` / `.open = true` match the existing `sizeDialog: { open: boolean; mode: "new" | "resize" }` shape. `setBgColor`/`setTransparent`/`setFps` write existing `Project` fields (`bgColor: string`, `transparentBg?: boolean`, `fps: number`). `bump` is the already-exported store action.
