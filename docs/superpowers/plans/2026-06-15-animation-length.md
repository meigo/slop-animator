# Manual Animation Length Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user set the animation's total length in frames — extending holds each layer's last frame, shortening trims trailing cells (with a confirm when keyframes are dropped).

**Architecture:** Two pure helpers in `document.ts` (`resizeCells`, `countKeyframesPastLength`) hold the testable logic. A `setAnimationLength(n)` store mutation resizes every drawing layer's cells inside `commitStructural` (reusing the existing structural undo). A "Length" numeric input in `Playbar.svelte` drives it, prompting before a destructive trim.

**Tech Stack:** Svelte 5 (runes-free Playbar — legacy reactive `let`), TypeScript, Vitest (Node env — no jsdom), Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-15-animation-length-design.md`

**Branch:** execute on a new branch `animation-length` (off `main`).

**Key constraints (verified against the codebase):**
- Vitest runs in **Node**; no test imports the store. Unit tests target only the pure helpers in `document.ts` (covered by `src/__tests__/document.test.ts`, which already imports `type Cell`/`type Project`).
- `frameCount` is derived: `documentLength(project)` = longest drawing layer's `cells.length` (floor 1); `commitStructural` calls `bump()` → `refreshLength()` → recomputes `frameCount` and clamps the playhead. So after resizing every layer to `n`, `frameCount` becomes `n` automatically — `setAnimationLength` must not set `frameCount` itself.
- Structural undo shares cell references but snapshots a fresh cells array per layer (`cloneLayers` does `cells.slice()`); resizing must **replace** `layer.cells` with a new array (never mutate in place). `resizeCells` returns a new array, satisfying this.
- A trailing `hold` cell freezes the most recent keyframe (`resolveKeyframeIndex` scans backward), so padding with holds = "hold last frame."

---

### Task 1: `resizeCells` pure helper

**Files:**
- Modify: `src/anim/document.ts` (add the exported helper near the layer factories, after `resolveKeyframeIndex`/`documentLength`)
- Test: `src/__tests__/document.test.ts` (add `resizeCells` to the import; add a `describe` block)

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/document.test.ts`, add `resizeCells` to the existing `from "../anim/document"` import. Near the top of the file (after the existing imports), add two shared cell fixtures if not already present:

```ts
const hold = { kind: "hold" } as Cell;
const key = { kind: "key" } as unknown as Cell; // canvas irrelevant for these helpers
```

Then append:

```ts
describe("resizeCells", () => {
  it("grows by appending holds to the target length", () => {
    expect(resizeCells([key, hold], 5)).toHaveLength(5);
  });
  it("appended cells are holds", () => {
    const out = resizeCells([key], 3);
    expect(out.slice(1).every((c) => c.kind === "hold")).toBe(true);
  });
  it("shrinks by slicing to the target length", () => {
    expect(resizeCells([key, hold, key, hold], 2).map((c) => c.kind)).toEqual(["key", "hold"]);
  });
  it("returns the same contents when n equals the current length", () => {
    expect(resizeCells([key, hold], 2).map((c) => c.kind)).toEqual(["key", "hold"]);
  });
  it("does not mutate the input array", () => {
    const cells = [key];
    resizeCells(cells, 4);
    expect(cells).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/document.test.ts`
Expected: FAIL — `resizeCells is not a function` / not exported.

- [ ] **Step 3: Implement the helper**

In `src/anim/document.ts`, add:

```ts
/** Resize a cells array to exactly `n`: pad with holds when growing, slice when shrinking. */
export function resizeCells(cells: Cell[], n: number): Cell[] {
  if (n <= cells.length) return cells.slice(0, n);
  const pad: Cell[] = Array.from({ length: n - cells.length }, () => ({ kind: "hold" }));
  return cells.concat(pad);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/document.test.ts`
Expected: PASS (5 new assertions green).

- [ ] **Step 5: Commit**

```bash
git add src/anim/document.ts src/__tests__/document.test.ts
git commit -m "feat: resizeCells helper (pad holds / slice to length)"
```

---

### Task 2: `countKeyframesPastLength` pure helper

**Files:**
- Modify: `src/anim/document.ts` (add the exported helper right after `resizeCells`)
- Test: `src/__tests__/document.test.ts` (add `countKeyframesPastLength` to the import; add a `describe` block)

- [ ] **Step 1: Write the failing tests**

Add `countKeyframesPastLength` to the existing `from "../anim/document"` import. Then append (reuses the `key`/`hold` fixtures from Task 1):

```ts
function drawLayers(...layerCells: Cell[][]): Project {
  return {
    layers: layerCells.map((cells, i) => ({
      kind: "draw", id: i + 1, name: "", visible: true, locked: false, opacity: 100, boilStrength: 1, cells,
    })),
  } as unknown as Project;
}

describe("countKeyframesPastLength", () => {
  it("counts keyframes at index >= n across layers", () => {
    const p = drawLayers([key, hold, key, key], [hold, key, hold, key]);
    expect(countKeyframesPastLength(p, 2)).toBe(3); // layer0: idx2,idx3; layer1: idx3
  });
  it("returns 0 when all keyframes are within [0, n)", () => {
    expect(countKeyframesPastLength(drawLayers([key, key, hold, hold]), 2)).toBe(0);
  });
  it("ignores trailing holds", () => {
    expect(countKeyframesPastLength(drawLayers([key, hold, hold, hold]), 1)).toBe(0);
  });
  it("ignores reference layers", () => {
    const p = { layers: [{ kind: "ref" }, { kind: "draw", cells: [key, key] }] } as unknown as Project;
    expect(countKeyframesPastLength(p, 1)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/document.test.ts`
Expected: FAIL — `countKeyframesPastLength is not a function`.

- [ ] **Step 3: Implement the helper**

In `src/anim/document.ts`, add directly after `resizeCells`:

```ts
/** Count keyframes at index >= n across all drawing layers (those a shorten-to-n would drop). */
export function countKeyframesPastLength(project: Project, n: number): number {
  let count = 0;
  for (const layer of project.layers) {
    if (layer.kind !== "draw") continue;
    for (let i = n; i < layer.cells.length; i++) {
      if (layer.cells[i].kind === "key") count++;
    }
  }
  return count;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/document.test.ts`
Expected: PASS (4 new assertions green).

- [ ] **Step 5: Commit**

```bash
git add src/anim/document.ts src/__tests__/document.test.ts
git commit -m "feat: countKeyframesPastLength helper"
```

---

### Task 3: `setAnimationLength` store mutation

**Files:**
- Modify: `src/state/appState.svelte.ts` (add `resizeCells` to the import from `../anim/document`; add the function after the other layer mutations, e.g. after `renameLayer`)

No unit test (the store can't be imported under Node). Verification is the build + full suite.

- [ ] **Step 1: Add the import**

In `src/state/appState.svelte.ts` line 1, the import from `../anim/document` currently includes `createDrawingLayer, resolveLayerName, refreshLength, ...`. Add `resizeCells` to that same import list (do not add a second import statement).

- [ ] **Step 2: Add the function**

After the `renameLayer` function, add:

```ts
/** Set the animation's total length to `n` frames (clamped 1..9999). Extends layers by holding the
 *  last frame; shortens by trimming trailing cells. Undoable. */
export function setAnimationLength(n: number) {
  const target = Math.max(1, Math.min(9999, Math.floor(n)));
  if (target === state.project.frameCount) return;
  commitStructural(() => {
    for (const layer of state.project.layers) {
      if (layer.kind === "draw") layer.cells = resizeCells(layer.cells, target);
    }
  });
}
```

(`state`, `commitStructural`, and `bump` are module-local already; only `resizeCells` is newly imported. Do NOT set `frameCount` — `commitStructural` → `bump` → `refreshLength` derives it from the now-equal-length layers.)

- [ ] **Step 3: Build + tests**

Run: `npm run build`
Expected: GREEN — 0 errors, 0 warnings.

Run: `npm test`
Expected: all pass. Baseline after Tasks 1–2 is 133 (124 + 5 + 4); unchanged here.

- [ ] **Step 4: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat: setAnimationLength store mutation (extend holds / trim, undoable)"
```

---

### Task 4: Playbar length input

**Files:**
- Modify: `src/lib/Playbar.svelte` (imports; a `commitLength` handler; a "Length" input after the frame-counter span at line 32)

No automated test (no Svelte component tests; jsdom unavailable). Verification = build + the manual checklist in Step 4.

- [ ] **Step 1: Extend imports + add the handler**

In `src/lib/Playbar.svelte`, change the store import (line 2) to add `setAnimationLength`, and add a new import for the pure helper:

```ts
  import { state, bump, playbackController, setAnimationLength } from "../state/appState.svelte";
  import { countKeyframesPastLength } from "../anim/document";
```

Then, inside the `<script>` (e.g. after `setFps`), add the handler:

```ts
  function commitLength(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const n = Math.max(1, Math.min(9999, Math.floor(+input.value)));
    if (n !== state.project.frameCount) {
      if (n < state.project.frameCount) {
        const dropped = countKeyframesPastLength(state.project, n);
        if (dropped > 0 && !confirm(`Shorten to ${n} frames? This removes ${dropped} keyframe(s).`)) {
          input.value = String(state.project.frameCount); // cancelled — revert the field
          return;
        }
      }
      setAnimationLength(n);
    }
    input.value = String(state.project.frameCount); // normalize the displayed value (clamp / no-op)
  }
```

- [ ] **Step 2: Add the input to the markup**

In `src/lib/Playbar.svelte`, the frame-counter line (line 32) is:

```svelte
  <span class="text-text-secondary">Frame {state.playhead + 1}/{state.project.frameCount}</span>
```

Immediately after it, add:

```svelte
  <label class="flex items-center gap-1 text-text-secondary">Length
    <input class="w-14 bg-surface border border-border text-text px-1" type="number" min="1" max="9999"
           value={state.project.frameCount} onchange={commitLength} />
  </label>
```

(The `value={state.project.frameCount}` one-way binding keeps the field correct after undo/redo and other edits; `commitLength` handles clamp/confirm/revert.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: GREEN — 0 errors, 0 warnings.

Run: `npm test`
Expected: all pass, 133 (unchanged — no new tests this task).

- [ ] **Step 4: Manual verification (browser)**

Run `npm run dev`, then confirm:
- The Length field shows the current frame count and updates after timeline edits and after undo/redo.
- Increasing it (e.g. to 120) extends the timeline; playing through shows each layer's last drawing held across the new frames.
- Decreasing it below a keyframe prompts ("Shorten to N frames? This removes M keyframe(s)."); confirming trims, cancelling leaves the animation and the field unchanged.
- Decreasing into an only-holds/empty tail trims with no prompt.
- Undo restores the previous length (and any trimmed keyframes); the field reflects it.
- Typing an out-of-range value (e.g. 0 or 99999) clamps to 1 / 9999.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Playbar.svelte
git commit -m "feat: animation length input in Playbar (extend/trim with confirm)"
```

---

## Final verification

- [ ] `npm run build` → 0 errors, 0 warnings.
- [ ] `npm test` → all pass (133 = 124 baseline + 9 new).
- [ ] Manual checklist in Task 4 Step 4 all confirmed.

## Self-Review (completed by plan author)

**Spec coverage:**
- `resizeCells` pure helper + tests → Task 1. ✅
- `countKeyframesPastLength` pure helper + tests → Task 2. ✅
- `setAnimationLength` structural mutation (extend-holds / trim, clamp 1..9999, undoable, derives frameCount via bump) → Task 3. ✅
- Length input + UI-side confirm-before-destructive-trim + clamp + revert-on-cancel → Task 4. ✅
- Persistence/export unchanged; undo via `commitStructural` → no task needed (covered by Task 3 + Task 4 manual reload/undo checks). ✅

**Placeholder scan:** No TBD/TODO/vague steps; every code step shows complete code. ✅

**Type consistency:** `resizeCells(cells: Cell[], n: number): Cell[]` defined in Task 1, called in Task 2's neighbour and in Task 3's `setAnimationLength`. `countKeyframesPastLength(project: Project, n: number): number` defined in Task 2, called in Task 4's `commitLength`. `setAnimationLength(n: number)` defined in Task 3, called in Task 4. The `key`/`hold` test fixtures are introduced in Task 1 Step 1 and reused in Task 2. ✅
