# Line Boil — Phase 1 (Config Model + Holds-Only + Settings UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the line-boil prototype into a persisted **per-project setting** with a **holds-only** mode and a tidy **settings popover**, keeping the prototype's live mesh-warp renderer.

**Architecture:** Move the `boil` config out of transient UI state into the `Project` model (saved with the file) and add a per-layer `boilStrength`. A pure `isCrispFrame` helper decides which frames render un-warped (holds-only leaves real keyframes crisp). The renderer reads the config from `project.boil` and multiplies displacement by `layer.boilStrength`. The live warp from the prototype stays as the renderer (the pre-baked variant cache is Phase 2).

**Tech Stack:** TypeScript 5.9, Svelte 5 (runes + the no-runes `state`-proxy components), Vitest, Tailwind 4, `@lucide/svelte`, fflate (zip persistence).

**Spec:** `docs/superpowers/specs/2026-06-15-line-boil-design.md` (Phase 1 row).

---

## Background the implementer needs

- The prototype (already on `main`) put `boil` in the Svelte `state` proxy (`appState.svelte.ts`) as `{ enabled, amount, cols, rate, scale }`, with controls in the timeline toolbar bound to `state.boil`, and `Canvas.svelte` passing it to `renderFrame` during playback. `src/core/boil.ts` exports `BoilConfig` (`{amount,cols,rate,scale}`) and `drawBoiled` (the mesh warp).
- This phase **moves** that config to `project.boil` (typed `BoilConfig`, now including `enabled` + `holdsOnly`), so it persists. The field is still called `scale` (the live warp's uniform scale); Phase 3 renames it `weight` when it swaps to alpha dilate/erode. Don't rename it here.
- `Cell = { kind: "key", canvas } | { kind: "hold" }`. A frame `f` is a layer's **own keyframe** when `cells[f].kind === "key"`; a hold (`kind: "hold"`) repeats an earlier key. Holds-only = boil holds, leave own-keyframes crisp.
- Persistence (`src/persist/project-file.ts`) serialises drawing layers + settings to JSON (no pixels here beyond cell kinds). Loads must tolerate **old saves without boil fields** → fall back to defaults.

**Run tests:** `npm test` (Vitest). **Build:** `npm run build` (svelte-check + tsc + vite).

---

### Task 1: BoilConfig in the model — `Project.boil` + `DrawingLayer.boilStrength`

**Files:**
- Modify: `src/anim/document.ts` (add `BoilConfig`, `defaultBoilConfig`, `Project.boil`, `DrawingLayer.boilStrength`, defaults)
- Modify: `src/core/boil.ts` (remove its `BoilConfig` — it moves to the model)
- Modify: `src/anim/render.ts` (import `BoilConfig` from `./document` instead of `../core/boil`)
- Test: `src/__tests__/document.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/document.test.ts` (it already imports from `../anim/document`; add `createProject`, `createDrawingLayer`, `defaultBoilConfig` to that import if not present):

```ts
describe("boil config defaults", () => {
  it("a new project starts with disabled boil + tuned defaults", () => {
    expect(createProject().boil).toEqual({
      enabled: false, amount: 1, cols: 20, rate: 3, scale: 0.005, holdsOnly: true,
    });
  });

  it("defaultBoilConfig returns a fresh copy each call", () => {
    const a = defaultBoilConfig();
    a.amount = 99;
    expect(defaultBoilConfig().amount).toBe(1);
  });

  it("a new drawing layer has boilStrength 1", () => {
    expect(createDrawingLayer(1, "L").boilStrength).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/document.test.ts`
Expected: FAIL — `defaultBoilConfig` not exported; `project.boil` / `boilStrength` undefined.

- [ ] **Step 3: Implement**

In `src/anim/document.ts`:

(a) Add the type + default near the top (after the `Cell` type):

```ts
/** Line-boil settings, persisted per project. `scale` is the prototype's uniform-scale weight
 *  (Phase 3 will rename it to a dilate/erode `weight`). */
export interface BoilConfig {
  enabled: boolean;
  amount: number;    // displacement px
  cols: number;      // grid columns
  rate: number;      // cycle length (on twos/threes)
  scale: number;     // uniform scale jitter (fraction)
  holdsOnly: boolean;
}

export function defaultBoilConfig(): BoilConfig {
  return { enabled: false, amount: 1, cols: 20, rate: 3, scale: 0.005, holdsOnly: true };
}
```

(b) Add `boilStrength` to the `DrawingLayer` interface:

```ts
export interface DrawingLayer {
  kind: "draw";
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..100
  boilStrength: number; // per-layer multiplier on boil amount/scale (1 = full, 0 = none)
  cells: Cell[];    // independent per-layer length; document length = the longest layer
}
```

(c) Add `boil` to the `Project` interface:

```ts
export interface Project {
  width: number;
  height: number;
  fps: number;
  bgColor: string;
  frameCount: number;
  boil: BoilConfig;
  layers: Layer[]; // layers[0] = bottom of the stack
}
```

(d) In `createDrawingLayer`, add `boilStrength: 1,` to the returned object (e.g. right after `opacity: 100,`).

(e) In `createProject`, add `boil: defaultBoilConfig(),` to the returned object (e.g. right after `bgColor: ...,`).

In `src/core/boil.ts`: delete the `export interface BoilConfig { ... }` block (keep `BoilOptions` and everything else).

In `src/anim/render.ts`: change line 2 from
`import { drawBoiled, type BoilConfig } from "../core/boil";`
to
`import { drawBoiled } from "../core/boil";`
and add `BoilConfig` to the existing `./document` import on line 1 (it already imports `type Project` etc.):
`import { buildFrameDrawList, containRect, mediaIntrinsicSize, type Project, type BoilConfig } from "./document";`

(f) The new **required** fields break every `Project`/`DrawingLayer` literal in the codebase. Make the codebase compile again by adding the field wherever tsc flags it — this is mechanical (each error is "Property 'boil'/'boilStrength' is missing"):
- `src/persist/project-file.ts` load: the `const project: Project = { ... }` literal needs a boil field — add `boil: defaultBoilConfig(),` (import `defaultBoilConfig` here too). The loaded drawing-layer literal (`layers.push({ kind: "draw", ... })`) needs `boilStrength: 1,`. (Task 4 wires the real persisted values; for now defaults keep it compiling.)
- Test fixtures: add `boil: defaultBoilConfig()` to each `Project` literal and `boilStrength: 1` to each `DrawingLayer` literal. Find them with `grep -rn "frameCount:" src/__tests__` (Project literals) and `grep -rn 'kind: "draw"' src/__tests__` (DrawingLayer literals/helpers). Known shared helpers: `layer()` in `timeline.test.ts`, `dlayer()` in `persist.test.ts`, `draw()` in `document.test.ts` — fixing those covers most; add the field to any remaining inline literals (`render.test.ts`, `onion.test.ts`, `export.test.ts`). Import `defaultBoilConfig` where used.

- [ ] **Step 4: Run test + build**

Run: `npm test -- src/__tests__/document.test.ts` → PASS.
Run: `npm run build`. Keep adding the missing field to whatever tsc flags (Step 3f) until the ONLY remaining errors are the `state.boil` references in `appState.svelte.ts` / `Canvas.svelte` / `Timeline.svelte` (those are expected — fixed in Tasks 5–6). There must be no errors in `document.ts`, `boil.ts`, `render.ts`, `project-file.ts`, or any test file.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: boil config + per-layer boilStrength in the project model"
```

---

### Task 2: `isCrispFrame` — the holds-only decision (pure)

**Files:**
- Modify: `src/anim/document.ts` (add `isCrispFrame`)
- Test: `src/__tests__/document.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/document.test.ts` (helpers `key()`/`hold()` already exist in that file):

```ts
describe("isCrispFrame", () => {
  it("holds-only: a frame that is its own keyframe stays crisp", () => {
    expect(isCrispFrame([key(), hold()], 0, true)).toBe(true);  // own key → crisp
    expect(isCrispFrame([key(), hold()], 1, true)).toBe(false); // hold → boil
  });

  it("holds-only off: nothing is crisp", () => {
    expect(isCrispFrame([key(), hold()], 0, false)).toBe(false);
    expect(isCrispFrame([key(), hold()], 1, false)).toBe(false);
  });

  it("past the track end is not crisp (no own keyframe there)", () => {
    expect(isCrispFrame([key()], 5, true)).toBe(false);
  });
});
```

Add `isCrispFrame` to the `../anim/document` import in the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/document.test.ts`
Expected: FAIL — `isCrispFrame` not exported.

- [ ] **Step 3: Implement**

In `src/anim/document.ts`, add (next to `resolveKeyframeIndex`):

```ts
/** With holds-only boil, a frame that IS its own keyframe renders crisp (un-boiled). */
export function isCrispFrame(cells: Cell[], frame: number, holdsOnly: boolean): boolean {
  return holdsOnly && cells[frame]?.kind === "key";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/document.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/anim/document.ts src/__tests__/document.test.ts
git commit -m "feat: isCrispFrame holds-only selection helper"
```

---

### Task 3: apply holds-only + per-layer strength in the renderer

**Files:**
- Modify: `src/anim/render.ts:compositeFrameLayers`

Build-verified (the warp itself is canvas-only; the holds-only logic is covered by Task 2's tests).

- [ ] **Step 1: Implement**

In `src/anim/render.ts`, add `isCrispFrame` to the `./document` import (alongside `BoilConfig`):
`import { buildFrameDrawList, containRect, mediaIntrinsicSize, isCrispFrame, type Project, type BoilConfig } from "./document";`

Then replace the draw-layer boil branch (currently):

```ts
      if (boil && (boil.amount > 0 || boil.scale > 0)) {
        // Per-layer phase (layerId) + cycle of `rate` warps (frame) → independent line boil.
        const seed = (frame % Math.max(1, boil.rate)) * 100003 + op.layerId * 9176;
        drawBoiled(ctx, cell.canvas, w, h, { amount: boil.amount, cols: boil.cols, scale: boil.scale, seed });
      } else {
        ctx.drawImage(cell.canvas, 0, 0);
      }
```

with:

```ts
      const strength = layer.boilStrength;
      const boilThisFrame = boil && strength > 0
        && !isCrispFrame(layer.cells, frame, boil.holdsOnly)
        && (boil.amount > 0 || boil.scale > 0);
      if (boilThisFrame) {
        // Per-layer phase (layerId) + cycle of `rate` warps (frame), scaled by the layer's strength.
        const seed = (frame % Math.max(1, boil!.rate)) * 100003 + op.layerId * 9176;
        drawBoiled(ctx, cell.canvas, w, h, {
          amount: boil!.amount * strength, cols: boil!.cols, scale: boil!.scale * strength, seed,
        });
      } else {
        ctx.drawImage(cell.canvas, 0, 0);
      }
```

(`layer` is already narrowed to `DrawingLayer` in this branch, so `layer.boilStrength` / `layer.cells` are available.)

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: no NEW errors in `render.ts` (remaining errors only in `appState.svelte.ts` / `Canvas.svelte` / `Timeline.svelte` re `state.boil`, fixed in Tasks 5–6).

- [ ] **Step 3: Commit**

```bash
git add src/anim/render.ts
git commit -m "feat: renderer honors holds-only + per-layer boilStrength"
```

---

### Task 4: persist `boil` + `boilStrength`

**Files:**
- Modify: `src/persist/project-file.ts` (JSON shapes, save, load)
- Test: `src/__tests__/persist.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/persist.test.ts` the `dlayer` helper already has `boilStrength: 1` and the `projectToJson` test's input `Project` literal already has a `boil` field (both added in Task 1's compile-fix). Now replace that whole `projectToJson` test so the **expected JSON** includes `boil` + per-layer `boilStrength`:

```ts
import { defaultBoilConfig } from "../anim/document";

describe("projectToJson", () => {
  it("serializes settings (incl. boil) and drawing layers, excluding reference layers", () => {
    const p: Project = {
      width: 800, height: 600, fps: 8, bgColor: "#eee", frameCount: 2,
      boil: { enabled: true, amount: 2, cols: 16, rate: 2, scale: 0.01, holdsOnly: true },
      layers: [dlayer(1, [key(), hold()]), rlayer(2)],
    };
    expect(projectToJson(p)).toEqual({
      version: 1,
      width: 800, height: 600, fps: 8, bgColor: "#eee", frameCount: 2,
      boil: { enabled: true, amount: 2, cols: 16, rate: 2, scale: 0.01, holdsOnly: true },
      layers: [
        { id: 1, name: "L1", visible: true, locked: false, opacity: 100, boilStrength: 1, cells: ["key", "hold"] },
      ],
    });
  });

  it("uses defaultBoilConfig() shape", () => {
    // guards against the serialized shape drifting from the model default
    expect(Object.keys(defaultBoilConfig()).sort()).toEqual(
      ["amount", "cols", "enabled", "holdsOnly", "rate", "scale"]
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/__tests__/persist.test.ts`
Expected: FAIL — `projectToJson` doesn't emit `boil` / `boilStrength`; `Project` literal now needs `boil` (it does).

- [ ] **Step 3: Implement**

In `src/persist/project-file.ts`:

(a) Add `type BoilConfig` to the `../anim/document` import (`defaultBoilConfig` was already imported in Task 1):
`import { isDrawingLayer, createCellCanvas, setMinLayerId, refreshLength, defaultBoilConfig, type Project, type Cell, type DrawingLayer, type BoilConfig } from "../anim/document";`

(b) Extend the JSON interfaces:

```ts
export interface DrawingLayerJson {
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  boilStrength: number;
  cells: ("key" | "hold")[];
}

export interface ProjectJson {
  version: 1;
  width: number;
  height: number;
  fps: number;
  bgColor: string;
  frameCount: number;
  boil: BoilConfig;
  layers: DrawingLayerJson[];
}
```

(c) In `projectToJson`, add `boil: project.boil,` to the returned object (after `frameCount`), and `boilStrength: l.boilStrength,` to each mapped layer (after `opacity`).

(d) In the load function, Task 1 left stub defaults so it compiled. Replace them with the persisted values + back-compat fallbacks:
- The loaded drawing-layer literal — change `boilStrength: 1` (Task 1's stub) to `boilStrength: lj.boilStrength ?? 1`.
- The `project: Project = { ... }` literal — change `boil: defaultBoilConfig()` (Task 1's stub) to `boil: json.boil ?? defaultBoilConfig()`.

(`lj.boilStrength` and `json.boil` are now valid reads thanks to the JSON interface additions in (b).)

- [ ] **Step 4: Run tests + build**

Run: `npm test -- src/__tests__/persist.test.ts` → PASS.
Run: `npm test` → the document + persist suites pass (remaining build issues are the UI `state.boil` ones, fixed next).

- [ ] **Step 5: Commit**

```bash
git add src/persist/project-file.ts src/__tests__/persist.test.ts
git commit -m "feat: persist boil config + per-layer boilStrength (back-compatible)"
```

---

### Task 5: move boil from UI state to `project.boil` (rewire Canvas + Timeline bindings)

**Files:**
- Modify: `src/state/appState.svelte.ts` (remove `boil` from `AnimState` + init)
- Modify: `src/lib/Canvas.svelte` (read `state.project.boil`)
- Modify: `src/lib/Timeline.svelte` (bind controls to `state.project.boil`)

Build + manual verified.

- [ ] **Step 1: Remove boil from `appState.svelte.ts`**

Delete the `boil` field from the `AnimState` interface (the line `boil: { enabled: boolean; ... };` and its doc comment) and delete the `boil: { enabled: false, ... },` line from the `$state({...})` initializer. (`project` already carries `boil` via `createProject()`.)

- [ ] **Step 2: Point Canvas at `state.project.boil`**

In `src/lib/Canvas.svelte`, the recomposite boil line is currently:

```ts
      const boil = state.boil.enabled && state.playback.isPlaying ? state.boil : undefined;
```

Change to:

```ts
      const boil = state.project.boil.enabled && state.playback.isPlaying ? state.project.boil : undefined;
```

- [ ] **Step 3: Point the Timeline controls at `state.project.boil`**

In `src/lib/Timeline.svelte`, replace every `state.boil` with `state.project.boil` in the boil control block (the toggle `onclick`/`class:bg-surface-active`, and each slider's `bind:value` + readout `{state.boil.*}`). There are references for `enabled`, `amount`, `cols`, `rate`, `scale`. (Leave the markup/layout as-is for this task; the popover move is Task 6.)

- [ ] **Step 4: Build + tests**

Run: `npm run build` → GREEN (svelte-check + tsc + vite, 0 errors/0 warnings; `state.boil` is gone everywhere).
Run: `npm test` → all green.

- [ ] **Step 5: Manual check** (`npm run dev`)

Draw a held pose, enable boil (Waves), Play with loop on → it boils as before. **Save** the project (Save icon) → **New** → **Open** the saved file → boil settings (and the toggle state) come back. Confirms persistence end-to-end.

- [ ] **Step 6: Commit**

```bash
git add src/state/appState.svelte.ts src/lib/Canvas.svelte src/lib/Timeline.svelte
git commit -m "feat: boil config lives on the project (persisted); rewire UI + canvas"
```

---

### Task 6: settings popover + holds-only toggle

**Files:**
- Modify: `src/lib/Timeline.svelte` (move the boil sliders into a cogwheel popover; add a holds-only checkbox)

Build + manual verified. Keeps the Waves toggle in the toolbar; tucks the params away.

- [ ] **Step 1: Add a popover-open flag + the Settings icon import**

In `src/lib/Timeline.svelte`'s `<script>`, add `Settings` to the `@lucide/svelte` import (alongside `Waves`), and add a plain reactive flag near the top of the script (this component is no-runes, so a plain `let` is reactive):

```ts
  let boilSettingsOpen = false;
```

- [ ] **Step 2: Replace the open boil sliders with a toggle + cogwheel popover**

Replace the entire boil control block in the markup (the `<!-- line boil (prototype) -->` comment, the Waves toggle button, and the four `<label>` sliders) with:

```svelte
    <!-- line boil: quick toggle + a settings popover for the params -->
    <button class={toolBtn} class:bg-surface-active={state.project.boil.enabled} title="Line boil (playback)"
            onclick={() => { state.project.boil.enabled = !state.project.boil.enabled; bump(); }}><Waves size={16} /></button>
    <div class="relative">
      <button class={toolBtn} class:bg-surface-active={boilSettingsOpen} title="Boil settings"
              onclick={() => (boilSettingsOpen = !boilSettingsOpen)}><Settings size={16} /></button>
      {#if boilSettingsOpen}
        <div class="absolute left-0 bottom-full mb-2 z-30 w-56 p-3 rounded-lg bg-surface border border-border shadow-md flex flex-col gap-2 text-xs">
          <label class="flex items-center gap-2" title="Boil amount (px)"><span class="w-10 text-text-secondary">amt</span>
            <input type="range" class="flex-1" min="0" max="8" step="0.5" bind:value={state.project.boil.amount} />
            <span class="w-8 text-right text-text-muted tabular-nums">{state.project.boil.amount}</span></label>
          <label class="flex items-center gap-2" title="Boil detail (grid columns)"><span class="w-10 text-text-secondary">grid</span>
            <input type="range" class="flex-1" min="4" max="40" step="1" bind:value={state.project.boil.cols} />
            <span class="w-8 text-right text-text-muted tabular-nums">{state.project.boil.cols}</span></label>
          <label class="flex items-center gap-2" title="Boil rate (cycle N warps — on twos/threes)"><span class="w-10 text-text-secondary">rate</span>
            <input type="range" class="flex-1" min="1" max="8" step="1" bind:value={state.project.boil.rate} />
            <span class="w-8 text-right text-text-muted tabular-nums">{state.project.boil.rate}</span></label>
          <label class="flex items-center gap-2" title="Boil line-weight jitter (uniform scale ±%)"><span class="w-10 text-text-secondary">weight</span>
            <input type="range" class="flex-1" min="0" max="0.05" step="0.005" bind:value={state.project.boil.scale} />
            <span class="w-8 text-right text-text-muted tabular-nums">{(state.project.boil.scale * 100).toFixed(1)}%</span></label>
          <label class="flex items-center gap-2"><input type="checkbox" bind:checked={state.project.boil.holdsOnly} /> <span class="text-text-secondary">Holds only (keep keyframes crisp)</span></label>
        </div>
      {/if}
    </div>
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: GREEN — svelte-check 0 errors/0 warnings, tsc clean, vite OK. (`Settings` is a valid `@lucide/svelte` icon; `boilSettingsOpen` is a plain reactive `let` in this no-runes component.)

- [ ] **Step 4: Manual check** (`npm run dev`)

1. The timeline toolbar now shows just the **Waves toggle + a cogwheel**; the params live in the popover.
2. Open the popover, draw a held pose, enable boil, Play (loop) → tune amt/grid/rate/weight live and watch.
3. Toggle **Holds only** off → during playback the drawn keyframes also boil; on → drawn keyframes render crisp, only the holds wobble.
4. Save → New → Open → all boil settings (incl. holds-only + the toggle) restore.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Timeline.svelte
git commit -m "feat: boil settings popover + holds-only toggle"
```

---

## Final verification

- [ ] `npm test` → all green (new document + persist tests included).
- [ ] `npm run build` → svelte-check + tsc + vite green, 0 warnings.
- [ ] Manual: boil persists across Save/Open; holds-only keeps keyframes crisp; per-layer `boilStrength` (defaults 1) is applied by the renderer (a layer set to 0 in code would not boil — the per-layer UI control is Phase 2).

---

## Self-Review (completed by plan author)

**Spec coverage (Phase 1 = "config model + holds-only + settings UI"):**
- Move `boil` into `Project` + persist → Tasks 1, 4. ✓
- `DrawingLayer.boilStrength` + persist + applied in renderer → Tasks 1, 3, 4. ✓
- Holds-only (pure + applied) → Tasks 2, 3. ✓
- Settings UI (toggle + popover + value readouts + holds-only) → Task 6. ✓
- Keep the prototype's live warp as the renderer → Task 3 keeps `drawBoiled`. ✓
- Defaults `1 / 20 / 3 / 0.5% / holds-only` → Task 1 `defaultBoilConfig`. ✓

**Out of Phase 1 (later phases):** pre-baked variant cache + per-layer strength UI (Phase 2); alpha dilate/erode weight + export (Phase 3). The `scale` field is intentionally NOT renamed to `weight` yet (Phase 3 does that with the mechanism change).

**Type/name consistency:** `BoilConfig { enabled, amount, cols, rate, scale, holdsOnly }` (in `document.ts`), `defaultBoilConfig()`, `isCrispFrame(cells, frame, holdsOnly)`, `DrawingLayer.boilStrength`, `project.boil` — referenced consistently across tasks; `render.ts` imports `BoilConfig`/`isCrispFrame` from `./document`; `boil.ts` keeps `BoilOptions`/`drawBoiled` only; persistence JSON mirrors the model fields with `?? default` fallbacks for old saves.

**Risk — the required-field ripple:** adding required `boil`/`boilStrength` to `Project`/`DrawingLayer` breaks every literal across the test suite + `project-file.ts`. Task 1 (Step 3f) fixes them all with stub defaults so its commit compiles **except** the intended `state.boil` references in `appState.svelte.ts`/`Canvas.svelte`/`Timeline.svelte`, which Tasks 5–6 rewire to `state.project.boil`. Task 4 then replaces the persistence stubs with the real serialized values. After every task except 1, the build is fully green.
