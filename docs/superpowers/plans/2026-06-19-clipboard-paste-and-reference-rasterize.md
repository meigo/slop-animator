# Clipboard Image Paste + Reference Rasterize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste a clipboard image as an image reference layer, and add a "rasterize reference → drawing layer" action — backed by a shared `drawReferenceMedia` render helper.

**Architecture:** Extract the reference-media draw math from `render.ts` into one exported helper, so a rasterize action can reproduce displayed pixels exactly (and the two existing draw blocks de-duplicate). Two new `appState` actions — `pasteImageReference(blob)` (reuses the existing image-load path) and `rasterizeReference(layerId)` (replace-in-place). UI: a Toolbar paste button + a `window` paste listener in `App.svelte`, and a rasterize button in the active image-reference row.

**Tech Stack:** TypeScript, Svelte 5 (App/Toolbar/LayerList in legacy mode — `state` proxy reads must be in the template, not `$:`), Vitest (node env, canvas mocked via `recordingCtx`).

**Spec:** `docs/superpowers/specs/2026-06-19-clipboard-paste-and-reference-rasterize-design.md`

**Branch:** execute on a new branch `clipboard-paste-rasterize` (off `main`).

**Key constraints (verified against current code):**
- Tests run in **node**; `appState.svelte.ts` reads `window` at module load → not importable in tests. So only `drawReferenceMedia` is unit-tested; the two appState actions and all UI are build/manual-verified.
- `render.ts` draws reference media in **two** places (the WebGL-boil branch, lines ~42-50, and the plain-2D branch, lines ~79-87) with identical math — both must call the new helper.
- The helper assumes `ctx` is at the **identity** transform and draws in **device pixels** (matches both existing call sites and the rasterize cell).
- `loadImageMedia(file)` uses `file.name` only in its error string, so wrapping a clipboard `Blob` in a `File` works unchanged.
- `addLayerToProject(layer)` is group-aware and sets `state.activeLayerId` (single undo step via its structural commit).

---

### Task 1: Extract `drawReferenceMedia` helper (with tests)

**Files:**
- Modify: `src/anim/render.ts`
- Test: `src/__tests__/render.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/__tests__/render.test.ts`, add an import for the new helper to the existing import from `../anim/render`:
```ts
import { renderFrame, compositeFrameLayers, drawReferenceMedia } from "../anim/render";
```
Then append this describe block (reuses the file's `recordingCtx`; defines a local media stub like the existing ref tests):
```ts
describe("drawReferenceMedia", () => {
  const imageMedia = (id: number, w = 50, h = 40) =>
    ({ type: "image" as const, el: { __id: id, naturalWidth: w, naturalHeight: h } as unknown as HTMLImageElement });
  const refLayer = (media: ReturnType<typeof imageMedia> | { type: "missing"; was: "image"; name: string }) =>
    createReferenceLayer(media as never, "r");

  it("records translate/rotate/scale then a sized drawImage for loaded image media", () => {
    const ctx = recordingCtx();
    drawReferenceMedia(ctx as unknown as CanvasRenderingContext2D, refLayer(imageMedia(7)), 100, 100, 1);
    expect(ctx.calls.filter((c) => c.startsWith("drawImage"))).toEqual(["drawImage:7@1:sized"]);
  });

  it("is a no-op for missing media", () => {
    const ctx = recordingCtx();
    drawReferenceMedia(
      ctx as unknown as CanvasRenderingContext2D,
      refLayer({ type: "missing", was: "image", name: "x" }),
      100, 100, 1
    );
    expect(ctx.calls.filter((c) => c.startsWith("drawImage"))).toEqual([]);
  });

  it("is a no-op for zero-size media", () => {
    const ctx = recordingCtx();
    drawReferenceMedia(ctx as unknown as CanvasRenderingContext2D, refLayer(imageMedia(7, 0, 0)), 100, 100, 1);
    expect(ctx.calls.filter((c) => c.startsWith("drawImage"))).toEqual([]);
  });
});
```
(If `createReferenceLayer` isn't already imported at the top of the test file, it is — line 3 imports it from `../anim/document`.)

- [ ] **Step 2: Run the test, verify it FAILS**

Run: `npx vitest run src/__tests__/render.test.ts`
Expected: FAIL — `drawReferenceMedia` is not exported.

- [ ] **Step 3: Add the helper**

In `src/anim/render.ts`, line 1 import — add `type ReferenceLayer`:
```ts
import { buildFrameDrawList, containRect, mediaIntrinsicSize, isCrispFrame, type Project, type BoilConfig, type ReferenceLayer } from "./document";
```
Add the exported helper above `compositeFrameLayers` (after the imports / `RenderOpts`):
```ts
/**
 * Draw a reference layer's media onto `ctx`, sized via containRect and placed by its transform.
 * ASSUMES `ctx` is at the identity transform and works in DEVICE pixels. The caller sets
 * `ctx.globalAlpha` (render path uses layer opacity; rasterize leaves it at 1). No-op for missing
 * or not-yet-loaded media.
 */
export function drawReferenceMedia(
  ctx: CanvasRenderingContext2D,
  layer: ReferenceLayer,
  docW: number,
  docH: number,
  dpr: number
): void {
  if (layer.media.type === "missing") return;
  const size = mediaIntrinsicSize(layer.media);
  if (size.w === 0 || size.h === 0) return;
  const r = containRect(size.w, size.h, docW * dpr, docH * dpr);
  const t = layer.transform;
  const cx = r.x + r.w / 2 + t.dx * dpr;
  const cy = r.y + r.h / 2 + t.dy * dpr;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t.rotation);
  ctx.scale(t.scale, t.scale);
  ctx.drawImage(layer.media.el, -r.w / 2, -r.h / 2, r.w, r.h);
  ctx.restore();
}
```

- [ ] **Step 4: Call the helper from both existing ref-draw blocks**

In `compositeFrameLayers`, the **WebGL-boil branch** ref block currently is (lines ~37-51):
```ts
      if (op.kind === "ref" && layer.kind === "ref") {
        const size = mediaIntrinsicSize(layer.media);
        if (size.w === 0 || size.h === 0) continue;
        const r = containRect(size.w, size.h, w, h);
        ctx.globalAlpha = op.opacity / 100;
        const t = layer.transform;
        const cx = r.x + r.w / 2 + t.dx * dpr;
        const cy = r.y + r.h / 2 + t.dy * dpr;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t.rotation);
        ctx.scale(t.scale, t.scale);
        if (layer.media.type !== "missing") ctx.drawImage(layer.media.el, -r.w / 2, -r.h / 2, r.w, r.h);
        ctx.restore();
      }
```
Replace its body with:
```ts
      if (op.kind === "ref" && layer.kind === "ref") {
        ctx.globalAlpha = op.opacity / 100;
        drawReferenceMedia(ctx, layer, project.width, project.height, dpr);
      }
```

The **plain-2D branch** ref block currently is (lines ~75-88):
```ts
    } else if (op.kind === "ref" && layer.kind === "ref") {
      const size = mediaIntrinsicSize(layer.media);
      if (size.w === 0 || size.h === 0) continue; // media not loaded yet
      const r = containRect(size.w, size.h, project.width * dpr, project.height * dpr);
      const t = layer.transform;
      const cx = r.x + r.w / 2 + t.dx * dpr;
      const cy = r.y + r.h / 2 + t.dy * dpr;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t.rotation);
      ctx.scale(t.scale, t.scale);
      if (layer.media.type !== "missing") ctx.drawImage(layer.media.el, -r.w / 2, -r.h / 2, r.w, r.h);
      ctx.restore();
    }
```
Replace with:
```ts
    } else if (op.kind === "ref" && layer.kind === "ref") {
      ctx.globalAlpha = op.opacity / 100;
      drawReferenceMedia(ctx, layer, project.width, project.height, dpr);
    }
```
Note: in the 2D branch the `ctx.globalAlpha = op.opacity / 100` was previously set at line 70 (before the `if`); keeping the explicit set inside the ref branch is harmless and keeps both branches symmetric. Leave the `draw` branch (`ctx.drawImage(cell.canvas, 0, 0)`) and the line-70 assignment as they are.

`mediaIntrinsicSize`, `containRect`, and the now-unused locals: confirm no unused-variable warning (the helper owns `size`/`r`/`t`; the branches no longer declare them). `mediaIntrinsicSize`/`containRect` are still imported and used (inside the helper).

- [ ] **Step 5: Run tests + build**

Run: `npx vitest run src/__tests__/render.test.ts` → all pass (3 new + existing ref tests still green).
Run: `npm run build` → 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/anim/render.ts src/__tests__/render.test.ts
git commit -m "refactor: extract drawReferenceMedia helper shared by render + rasterize"
```

---

### Task 2: `pasteImageReference` + `rasterizeReference` actions

**Files:**
- Modify: `src/state/appState.svelte.ts`

No automated test (appState can't load in node). Build-verified here; behavior verified in Tasks 3-5 manual steps.

- [ ] **Step 1: Add imports**

In `src/state/appState.svelte.ts`:
- Extend the line-1 `../anim/document` import to add `mediaIntrinsicSize` and `createReferenceLayer`:
  ```ts
  import { createProject, createCellCanvas, cloneCanvas, isDrawingLayer, createDrawingLayer, createReferenceLayer, resolveLayerName, refreshLength, resizeCells, nextId, nonEmptyGroups, mediaIntrinsicSize, type Project, type Layer, type Cell, type AudioTrack, type ReferenceMedia, type LayerGroup } from "../anim/document";
  ```
- Add two new imports near the other `../anim` imports:
  ```ts
  import { loadImageMedia } from "../anim/reference";
  import { drawReferenceMedia } from "../anim/render";
  ```

- [ ] **Step 2: Add `pasteImageReference`**

Add near `addLayerToProject` (which it calls):
```ts
/** Paste a clipboard image blob as a new, fully-opaque image reference layer (auto-selected). */
export async function pasteImageReference(blob: Blob): Promise<void> {
  // loadImageMedia reads file.name only for its error message — wrap the blob in a File.
  const file = new File([blob], "Pasted image", { type: blob.type || "image/png" });
  const media = await loadImageMedia(file);
  const layer = createReferenceLayer(media, "Pasted image");
  layer.opacity = 100; // content, not a dimmed trace underlay (ref default is 60)
  addLayerToProject(layer);
}
```

- [ ] **Step 3: Add `rasterizeReference`**

```ts
/** Replace an image reference layer in place with a drawing layer baked at its current transform. */
export function rasterizeReference(layerId: number): void {
  commitStructural(() => {
    const layers = state.project.layers;
    const idx = layers.findIndex((l) => l.id === layerId);
    const ref = layers[idx];
    if (!ref || ref.kind !== "ref" || ref.media.type !== "image") return; // image refs only
    if (mediaIntrinsicSize(ref.media).w === 0) return; // media not loaded

    const cell = createCellCanvas(state.project.width, state.project.height, DPR);
    const ctx = cell.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0); // helper draws in device pixels
    drawReferenceMedia(ctx, ref, state.project.width, state.project.height, DPR);

    // Replace in place: keep id/name/group/opacity/visibility; one keyframe at frame 0 (holds after)
    // so the image shows on every frame. Off-canvas pixels are clipped (the accepted commit trade).
    const dl = createDrawingLayer(state.project.frameCount, ref.name);
    dl.id = ref.id;
    dl.groupId = ref.groupId;
    dl.opacity = ref.opacity;
    dl.visible = ref.visible;
    dl.cells[0] = { kind: "key", canvas: cell };
    layers[idx] = dl;
    state.activeLayerId = dl.id;
  });
}
```

- [ ] **Step 4: Build**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass (unchanged count; appState isn't imported by tests).

- [ ] **Step 5: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat: pasteImageReference + rasterizeReference actions"
```

---

### Task 3: Keyboard paste (`window` paste listener)

**Files:**
- Modify: `src/App.svelte`

- [ ] **Step 1: Import the action**

In `src/App.svelte` line 10, add `pasteImageReference` to the `./state/appState` import (append before the closing brace):
```ts
  import { state, history, bump, playbackController, selectionRef, selectionActions, DPR, replaceProject, gatherPreferences, applyPreferences, pasteImageReference } from "./state/appState.svelte";
```

- [ ] **Step 2: Add the paste handler**

After the `onKey` function (around line 44), add:
```ts
  function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const blob = it.getAsFile();
        if (blob) {
          e.preventDefault();
          void pasteImageReference(blob);
        }
        return;
      }
    }
  }
```

- [ ] **Step 3: Wire the window listener**

In the template, the existing `<svelte:window onkeydown={onKey} />` (line ~68) — add the paste handler:
```svelte
<svelte:window onkeydown={onKey} onpaste={onPaste} />
```

- [ ] **Step 4: Build**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass.

- [ ] **Step 5: Manual check (browser)**

Run `npm run dev`: copy an image (e.g. a screenshot), press `Cmd/Ctrl+V` → a "Pasted image" reference layer appears, selected, fit-centered, at 100% opacity, transform gizmo active. Pasting with no image in the clipboard does nothing (normal paste proceeds in inputs).

- [ ] **Step 6: Commit**

```bash
git add src/App.svelte
git commit -m "feat: paste clipboard image via Cmd/Ctrl+V"
```

---

### Task 4: Toolbar "Paste image" button

**Files:**
- Modify: `src/lib/Toolbar.svelte`

- [ ] **Step 1: Imports**

Add `ClipboardPaste` to the `@lucide/svelte` import (line 11) and `pasteImageReference` to the `../state/appState.svelte` import (line 4).

- [ ] **Step 2: Add the click handler**

In the `<script>`, add:
```ts
  async function pasteImage() {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (type) {
          await pasteImageReference(await it.getType(type));
          return;
        }
      }
      alert("No image found in the clipboard.");
    } catch {
      alert("Couldn't read the clipboard (permission denied or unsupported).");
    }
  }
```

- [ ] **Step 3: Add the button**

Next to the Add Image / Add Video buttons (the `pick("image")` / `pick("video")` buttons), add:
```svelte
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    title="Paste image from clipboard"
    onclick={pasteImage}
  ><ClipboardPaste size={18} /></button>
```

- [ ] **Step 4: Build + manual**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass.
Manual (`npm run dev`): with an image copied, click the Paste button → same result as Cmd/Ctrl+V. With no image copied → the alert appears. (On iPad/Safari, confirm the `navigator.clipboard.read()` permission flow.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/Toolbar.svelte
git commit -m "feat: toolbar paste-image button"
```

---

### Task 5: Rasterize button in the layer row

**Files:**
- Modify: `src/lib/LayerList.svelte`

- [ ] **Step 1: Imports**

Add `ImageDown` to the `@lucide/svelte` import in `src/lib/LayerList.svelte`, and `rasterizeReference` to its `../state/appState.svelte` import.

- [ ] **Step 2: Add the button to the active-layer row 2**

In the `layerRow` snippet's row-2 block (the `{#if active} … {/if}` section), alongside the existing reference controls (video-offset / re-link), add — for an image reference only:
```svelte
        {#if layer.kind === "ref" && layer.media.type === "image"}
          <button class="text-text-muted hover:text-text-secondary" title="Rasterize to drawing layer"
                  onclick={(e) => { e.stopPropagation(); rasterizeReference(layer.id); }}><ImageDown size={13} /></button>
        {/if}
```
(Placement: after the re-link `{#if … "missing"}` block, still inside row 2. Keep `e.stopPropagation()` so the row's select-onclick / drag aren't disturbed — matches the sibling controls.)

- [ ] **Step 3: Build + manual**

Run: `npm run build` → 0 errors, 0 warnings (watch unused `ImageDown` — it must be used; it is).
Run: `npm test` → all pass.
Manual (`npm run dev`): select an image reference, transform it, click the rasterize button → it becomes a drawing layer at the same stack position/name/group; drawing on it works; the gizmo no longer applies; `Cmd/Ctrl+Z` restores the reference in one step. The button is absent for drawing, video, and missing layers.

- [ ] **Step 4: Commit**

```bash
git add src/lib/LayerList.svelte
git commit -m "feat: rasterize image reference to a drawing layer"
```

---

## Final verification

- [ ] `npm run build` → 0 errors, 0 warnings.
- [ ] `npm test` → all prior tests pass + 3 new `drawReferenceMedia` tests; existing `compositeFrameLayers` ref tests still green (extraction regression guard).
- [ ] Manual checklists in Tasks 3-5 confirmed in browser (paste via keyboard + button; rasterize replace-in-place + undo).

## Self-Review (completed by plan author)

**Spec coverage:** shared `drawReferenceMedia` extracted + both render blocks use it (Task 1) ✅; `pasteImageReference` reference at 100% opacity / "Pasted image" / auto-selected (Task 2) ✅; `rasterizeReference` replace-in-place, image-only, frame-0 keyframe, single undo (Task 2) ✅; keyboard paste via `window` paste event (Task 3) ✅; Toolbar paste button via `navigator.clipboard.read()` + alert fallback (Task 4) ✅; rasterize button in active image-reference row only (Task 5) ✅; tests on the only unit-testable unit (`drawReferenceMedia`) + extraction regression guard (Task 1) ✅; Approach B / video-snapshot / non-image paste out of scope ✅.

**Placeholder scan:** No TBD/TODO; every code step has exact before/after. ✅

**Type consistency:** `drawReferenceMedia(ctx, layer: ReferenceLayer, docW, docH, dpr)` defined in Task 1 and called identically in Task 1 (render blocks) and Task 2 (rasterize). `pasteImageReference(blob: Blob): Promise<void>` defined Task 2, imported/called in Tasks 3-4. `rasterizeReference(layerId: number)` defined Task 2, called in Task 5. `createDrawingLayer`/`createReferenceLayer`/`createCellCanvas`/`mediaIntrinsicSize`/`loadImageMedia` are existing exports; the new imports are listed in Task 2 Step 1. ✅
