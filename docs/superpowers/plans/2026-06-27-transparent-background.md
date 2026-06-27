# Transparent Background + Checkerboard + Paint-Behind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the document an optional transparent background (checkerboard in the editor, real alpha in PNG export, flattened in video), and surface the existing `drawBehind` brush setting as a UI toggle.

**Architecture:** Add an optional `Project.transparentBg` flag (absent = today's opaque behavior). Route the existing `drawBg` render option off that flag for the editor + PNG export (video stays flattened). Show a checkerboard `<div>` behind the transparent display canvas, and add two Toolbar toggles. Reuses the existing `drawBg` plumbing and `drawBehind` engine support; the only new visual is the checker div.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-27-transparent-background-design.md`

**Branch:** `feat-transparent-background` (already created off `main`; the spec commit is on it).

**Conventions:** Build bar **0 errors, 0 warnings** (`npm run build` = `svelte-check && tsc --noEmit && vite build`). Test baseline **268** must not drop. Husky pre-commit runs eslint+prettier (expected). `Toolbar.svelte` imports the store as `state as appState` and already imports `bump`. `Canvas.svelte` imports `state` unaliased. Canvas/UI code is build- + manual-verified (Vitest has no DOM).

**Design decision (refinement of the spec):** `transparentBg` is **optional** (`transparentBg?: boolean`), not a required field — many test files build `Project` literals, and a required field would break ~22 of them for no benefit. Absent/`undefined` means opaque; `createProject` and the loader set an explicit default, so real projects always have it defined.

---

### Task 1: Model + persistence (pure, TDD)

**Files:**
- Modify: `src/anim/document.ts` (Project interface ~line 106; `createProject` ~line 344)
- Modify: `src/persist/project-file.ts` (`ProjectJson` ~line 64; `projectToJson` ~line 103; loader ~line 293)
- Test: `src/__tests__/document.test.ts`, `src/__tests__/persist.test.ts`

- [ ] **Step 1: Write the failing tests.**

In `src/__tests__/document.test.ts`, add a new describe (e.g. after the `createReferenceLayer` block):
```ts
describe("createProject transparentBg", () => {
  it("defaults to false (opaque)", () => {
    expect(createProject().transparentBg).toBe(false);
  });
});
```

In `src/__tests__/persist.test.ts`, update the existing `projectToJson` test's expected object (the `toEqual({...})` at ~line 66) to include the new field, and add a true-case. First, in that test's `expect(projectToJson(p)).toEqual({ ... })`, add a line `transparentBg: false,` (the hand-built `p` omits `transparentBg`, so it serializes as `false`). Then add a new `it` inside the same `describe("projectToJson", ...)`:
```ts
  it("serializes transparentBg when set", () => {
    const p: Project = {
      width: 800,
      height: 600,
      fps: 8,
      bgColor: "#eee",
      transparentBg: true,
      frameCount: 1,
      boil: { enabled: false, amount: 0, cols: 12, rate: 1, weight: 0, holdsOnly: false },
      groups: [],
      layers: [dlayer(1, [key()])],
      audio: null,
    };
    expect(projectToJson(p).transparentBg).toBe(true);
  });
```

- [ ] **Step 2: Run to verify they fail.**

Run: `npx vitest run src/__tests__/document.test.ts src/__tests__/persist.test.ts`
Expected: FAIL — `createProject().transparentBg` is `undefined` (≠ `false`); `projectToJson(...).transparentBg` is `undefined` (≠ `true`); and the updated `toEqual` mismatches (no `transparentBg` emitted yet).

- [ ] **Step 3: Implement.**

In `src/anim/document.ts`, add the optional field to the `Project` interface (right after `bgColor: string;`):
```ts
  bgColor: string;
  /** When true, the document has NO opaque background: the editor shows a checkerboard and PNG export
   *  carries alpha. Video export still flattens onto `bgColor`. Absent/undefined = opaque (default). */
  transparentBg?: boolean;
```
In `createProject`, add the default to the returned object (right after `bgColor: ...`):
```ts
    bgColor: opts?.bgColor ?? "#f4efe2",
    transparentBg: false,
```

In `src/persist/project-file.ts`, add to the `ProjectJson` interface (after `bgColor: string;`):
```ts
  bgColor: string;
  transparentBg?: boolean;
```
In `projectToJson`, emit it (after `bgColor: project.bgColor,`):
```ts
    bgColor: project.bgColor,
    transparentBg: !!project.transparentBg,
```
In the loader's `const project: Project = { ... }` (after `bgColor: json.bgColor,`):
```ts
    bgColor: json.bgColor,
    transparentBg: json.transparentBg ?? false,
```

- [ ] **Step 4: Run to verify they pass.**

Run: `npx vitest run src/__tests__/document.test.ts src/__tests__/persist.test.ts` → PASS.
Then `npm run build` → 0 errors, 0 warnings. Then `npm test` → 268 + 2 new = 270.

- [ ] **Step 5: Commit.**
```bash
git add src/anim/document.ts src/persist/project-file.ts src/__tests__/document.test.ts src/__tests__/persist.test.ts
git commit -m "feat: Project.transparentBg flag + persistence (default opaque)"
```

---

### Task 2: Render routing (editor + onion + exports)

**Files:** Modify `src/anim/onion.ts` (~line 161), `src/lib/Canvas.svelte` (`recomposite`, line 139), `src/export/png-sequence.ts` (~line 18), `src/export/video.ts` (~line 51). No change to `render.ts` (its `drawBg` option + the `drawBg:false` test already exist). DOM rendering glue → build + manual (no new unit test).

- [ ] **Step 1: Onion path — make the bg fill conditional.** In `src/anim/onion.ts`, the `renderFrameWithOnion` function currently has:
```ts
  display.clearRect(0, 0, w, h);
  display.fillStyle = project.bgColor;
  display.fillRect(0, 0, w, h);
```
Change to:
```ts
  display.clearRect(0, 0, w, h);
  if (!project.transparentBg) {
    display.fillStyle = project.bgColor;
    display.fillRect(0, 0, w, h);
  }
```

- [ ] **Step 2: Editor normal path — drive `drawBg`.** In `src/lib/Canvas.svelte`, `recomposite()`, change:
```ts
      renderFrame(displayCtx, state.project, state.playhead, DPR, { boil, version: state.version });
```
to:
```ts
      renderFrame(displayCtx, state.project, state.playhead, DPR, {
        drawBg: !state.project.transparentBg,
        boil,
        version: state.version,
      });
```

- [ ] **Step 3: PNG export — alpha when transparent.** In `src/export/png-sequence.ts`, the `renderFrame(ctx, project, f, dpr, { drawBg: true, ... })` call: change `drawBg: true` to:
```ts
      drawBg: !project.transparentBg,
```

- [ ] **Step 4: Video export — keep flattening (comment only).** In `src/export/video.ts`, leave the `renderFrame(ctx, project, f, dpr, { drawBg: true, ... })` call's `drawBg: true` as-is, and add a comment above it:
```ts
      // Video has no alpha codec here (MP4/H.264); a transparent project is intentionally
      // flattened onto project.bgColor.
      drawBg: true,
```

- [ ] **Step 5: Verify.** `npm run build` → 0/0. `npm test` → 270 (unchanged; `render.test.ts`'s existing `drawBg:false` case still passes). Lint clean.

- [ ] **Step 6: Commit.**
```bash
git add src/anim/onion.ts src/lib/Canvas.svelte src/export/png-sequence.ts src/export/video.ts
git commit -m "feat: route drawBg off transparentBg (editor + PNG transparent; video flattened)"
```

---

### Task 3: Editor checkerboard

**Files:** Modify `src/lib/Canvas.svelte` (the `wrapper` div, ~line 815). DOM → build + manual.

- [ ] **Step 1: Add the checker div.** In the `wrapper` div, before the `<canvas bind:this={display} ...>` element, insert:
```svelte
  <div bind:this={wrapper} class="absolute left-0 top-0">
    {#if state.project.transparentBg}
      <div
        class="absolute left-0 top-0 pointer-events-none"
        style="width:{state.project.width}px; height:{state.project.height}px;
               background-color:#fff;
               background-image:
                 linear-gradient(45deg,#ccc 25%,transparent 25%),
                 linear-gradient(-45deg,#ccc 25%,transparent 25%),
                 linear-gradient(45deg,transparent 75%,#ccc 75%),
                 linear-gradient(-45deg,transparent 75%,#ccc 75%);
               background-size:16px 16px;
               background-position:0 0,0 8px,8px -8px,-8px 0;"
      ></div>
    {/if}
    <canvas bind:this={display} class="absolute left-0 top-0 shadow-lg touch-none"></canvas>
    <canvas bind:this={overlay} class="absolute left-0 top-0 pointer-events-none"></canvas>
  </div>
```
(The checker is doc-sized in logical px and sits behind the display canvas; it pans/zooms with the wrapper transform. `{#if state.project.transparentBg}` is reactive on the store proxy, so toggling shows/hides it.)

- [ ] **Step 2: Verify.** `npm run build` → 0/0. Lint clean. `npm test` → 270.

- [ ] **Step 3: Commit.**
```bash
git add src/lib/Canvas.svelte
git commit -m "feat: checkerboard behind the canvas when the background is transparent"
```

---

### Task 4: Toolbar — transparency toggle

**Files:** Modify `src/lib/Toolbar.svelte` (lucide import ~line 44; the theme-button block ~line 376). `bump` and `state as appState` are already imported. DOM → build + manual.

- [ ] **Step 1: Import an icon.** In the `@lucide/svelte` import list, add `Grid2x2`:
```ts
    Workflow,
    Grid2x2,
    ClipboardPaste,
    Pipette,
```
(If `svelte-check`/build reports `Grid2x2` is not an exported member of `@lucide/svelte`, use `Grid3x3` instead — same usage below.)

- [ ] **Step 2: Add the toggle button.** Immediately AFTER the theme toggle button's closing `</button>` (the `{#if appState.theme === "dark"}...` button) and BEFORE the toolbar's closing `</div>`, add:
```svelte
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.project.transparentBg}
    title="Transparent background (checkerboard)"
    onclick={() => {
      appState.project.transparentBg = !appState.project.transparentBg;
      bump();
    }}><Grid2x2 size={18} /></button
  >
```
(`bump()` increments the version; Canvas's rAF tick recomposites on version change, so the display re-renders transparent/opaque.)

- [ ] **Step 3: Verify.** `npm run build` → 0/0. Lint clean. `npm test` → 270.

- [ ] **Step 4: Commit.**
```bash
git add src/lib/Toolbar.svelte
git commit -m "feat: toolbar toggle for transparent background"
```

---

### Task 5: Toolbar — paint-behind toggle (hidden for eraser)

**Files:** Modify `src/lib/Toolbar.svelte` (after the Taper `<label>`, ~line 293). DOM → build + manual.

- [ ] **Step 1: Add the checkbox.** Immediately AFTER the existing Taper label:
```svelte
  <label class="flex items-center gap-1 text-xs text-text-secondary" title="Taper stroke ends">
    <input type="checkbox" bind:checked={stroke.taper} /> Taper
  </label>
```
insert:
```svelte
  {#if appState.tool !== "eraser"}
    <label
      class="flex items-center gap-1 text-xs text-text-secondary"
      title="Paint behind existing pixels (e.g. white fill under a black outline)"
    >
      <input type="checkbox" bind:checked={stroke.drawBehind} /> Behind
    </label>
  {/if}
```
(`stroke` is the `$derived` active-tool settings; when the eraser is active the whole block is hidden, so `stroke.drawBehind` only ever binds the brush's setting here. The engine already honors `drawBehind` — `brush.ts:77`, `stamp-brush.ts:67`, forwarded at `Canvas.svelte:231`.)

- [ ] **Step 2: Verify.** `npm run build` → 0/0. Lint clean. `npm test` → 270.

- [ ] **Step 3: Commit.**
```bash
git add src/lib/Toolbar.svelte
git commit -m "feat: surface paint-behind toggle (hidden when erasing)"
```

---

## Final verification

- [ ] `npm run build` → 0 errors, 0 warnings; `npm run lint` → clean; `npm test` → 270.
- [ ] **Manual (browser, `npm run dev`)** — per the spec's checklist:
  - Toggle transparency (toolbar checker button) → checkerboard appears behind the artwork; toggle off → opaque `bgColor` returns.
  - Pick white, enable **Behind**, paint over a black outline → white fill lands behind the ink and is visible on the checker. **Behind** disappears when the eraser tool is selected.
  - Export PNG sequence of a transparent project → PNGs have real alpha. Export video → flattened onto `bgColor` (opaque), unchanged.
  - Enable onion skins while transparent → ghosts composite over transparency (no opaque fill).
  - Save → reload preserves the transparent flag; an old project (no `transparentBg` in JSON) loads opaque.

## Self-Review (completed by plan author)

**Spec coverage:** model+persistence (Task 1) ✅; render routing editor-normal + onion + PNG + video (Task 2) ✅; checkerboard view (Task 3) ✅; transparency toggle (Task 4) ✅; paint-behind toggle hidden-for-eraser (Task 5) ✅; testing pure (Task 1) + manual (final) ✅; out-of-scope (alpha video, color picker, auto-fill) untouched ✅.

**Placeholder scan:** No TBD/TODO; every code step has concrete code and exact anchors. The `Grid2x2`→`Grid3x3` fallback is an explicit, defined conditional, not a gap.

**Type consistency:** `transparentBg?: boolean` consistent across `Project` (document.ts), `ProjectJson` (project-file.ts), `createProject` default `false`, `projectToJson` emits `!!project.transparentBg`, loader defaults `json.transparentBg ?? false`. `drawBg` option name matches `render.ts`'s existing `RenderOpts`. `state.project.transparentBg` (Canvas) / `appState.project.transparentBg` (Toolbar) match the alias each file uses. `stroke.drawBehind` matches the existing `ToolSettings`/engine field.
