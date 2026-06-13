# Plan 5 — Reference Layers (image + video rotoscope) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reference layers — imported images or videos shown faintly under the drawing as a trace-under, with videos scrubbed to the playhead — that are never drawn on, never exported, and ignored by onion skin.

**Architecture:** Make `Layer` a union (`DrawingLayer | ReferenceLayer`). The pure frame-draw-list gains a `kind` discriminator and an `includeReference` flag; the compositor draws reference media with an aspect-preserving "contain" fit (`containRect`, pure-tested). Cell/timeline operations and onion skin skip reference layers. A small `reference.ts` loads image/video elements from a `File` and seeks video reference layers to `(frame + offsetFrames)/fps`, re-rendering on the async `seeked` event. UI: Add-Image/Add-Video import + per-layer opacity/visibility/delete in the layer list.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest. Interactive transform/positioning of references is OUT of scope (references are drawn contain-fit; a numeric video frame-offset is provided). Export exclusion is wired here via `includeReference=false`; the export feature itself is Plan 6.

> ⚠️ **VERIFICATION NOTE:** the pure logic (model, `buildFrameDrawList`, `containRect`, timeline guards) is unit-tested. Image/video **loading and the async video-seek sync are DOM-only and NOT unit-testable** — those tasks' gate is type-check/build/no-regression plus **human** browser verification (load an image and a video, scrub the playhead). Do not claim the media renders or scrubs from automated checks alone.

**Builds on Plans 1–4 (on `main`).** Current relevant code:
- `src/anim/document.ts`: `Cell`, `DrawingLayer {kind:"draw",…,cells}`, `type Layer = DrawingLayer`, `Project`, `resolveKeyframeIndex`, `DrawOp`, `buildFrameDrawList(project,frame)`, `createCellCanvas`, `cloneCanvas`, `createDrawingLayer`, `createProject`, module `nextLayerId`.
- `src/anim/render.ts`: `compositeFrameLayers(ctx,project,frame,_dpr)` (consumes `buildFrameDrawList`), `renderFrame(...)`.
- `src/anim/timeline.ts`: `addFrame(project)` (pushes `{kind:"hold"}` to every `layer.cells`), `deleteFrame(project,frame)` (splices every `layer.cells`), plus keyframe ops.
- `src/anim/onion.ts`: `renderFrameWithOnion(...)`; private `drawGhost` (active-layer path reads `layer.cells`, all-layers path calls `compositeFrameLayers`).
- `src/state/appState.svelte.ts`: `state`, `activeLayer()`, `bump()`, `canvasOps`, `history`, `DPR`.
- `src/lib/Canvas.svelte`: `onStroke` (brush/fill/selection branches call `activeLayer()` → `ensureDrawableKeyframe`); rAF poll recomposites on `state.version`/`state.playhead` change.
- `src/lib/LayerList.svelte`, `src/lib/Toolbar.svelte`.
- tsconfig: `erasableSyntaxOnly`, `noUnusedLocals`.

---

## File Structure

```
src/
  anim/
    document.ts   ← MODIFY: ReferenceLayer + Layer union; FrameOp (kind) buildFrameDrawList +
                    includeReference; containRect; mediaIntrinsicSize; createReferenceLayer; isDrawingLayer
    render.ts     ← MODIFY: compositeFrameLayers draws ref media (containRect) + includeReference param
    onion.ts      ← MODIFY: exclude reference layers (active-path guard + includeReference=false)
    timeline.ts   ← MODIFY: addFrame/deleteFrame skip reference layers
    reference.ts  ← NEW: loadImageLayer / loadVideoLayer / syncReferenceVideos (DOM, untested)
  state/appState.svelte.ts ← MODIFY: activeDrawingLayer(); removeLayer(); add-reference helpers
  lib/
    Canvas.svelte ← MODIFY: drawing/fill/selection use activeDrawingLayer(); video sync in poll
    LayerList.svelte ← MODIFY: render ref rows (chip/opacity/visibility/delete); opacity for all
    Toolbar.svelte   ← MODIFY: Add Image / Add Video import buttons
  __tests__/document.test.ts ← MODIFY (new FrameOp shape + ref + containRect)
  __tests__/timeline.test.ts ← MODIFY (ref-layer skip)
  __tests__/render.test.ts   ← MODIFY (FrameOp shape + ref media draw + includeReference)
```

---

## Task 1: Reference layer model + frame-draw-list + containRect

**Files:**
- Modify: `src/anim/document.ts`
- Test: `src/__tests__/document.test.ts`

- [ ] **Step 1: Update the existing `buildFrameDrawList` tests to the new `FrameOp` shape and add ref/containRect tests**

In `src/__tests__/document.test.ts`, the current `buildFrameDrawList` describe block asserts ops shaped `{ layerId, keyframeIndex, opacity }`. Replace the ENTIRE `describe("buildFrameDrawList", …)` block with:
```ts
import { containRect, createReferenceLayer, type ReferenceMedia } from "../anim/document";

function refLayer(id: number, over: Partial<import("../anim/document").ReferenceLayer> = {}): import("../anim/document").ReferenceLayer {
  const media: ReferenceMedia = { type: "image", el: {} as HTMLImageElement };
  return { kind: "ref", id, name: `R${id}`, visible: true, opacity: 60, offsetFrames: 0, media, ...over };
}

describe("buildFrameDrawList", () => {
  it("emits a draw op per visible drawing layer with a resolved keyframe, bottom→top", () => {
    const p = proj([layer(1, [key(), hold()]), layer(2, [hold(), key()])], 2);
    expect(buildFrameDrawList(p, 1)).toEqual([
      { kind: "draw", layerId: 1, keyframeIndex: 0, opacity: 100 },
      { kind: "draw", layerId: 2, keyframeIndex: 1, opacity: 100 },
    ]);
  });

  it("skips invisible layers", () => {
    const p = proj([layer(1, [key()], { visible: false }), layer(2, [key()])], 1);
    expect(buildFrameDrawList(p, 0)).toEqual([{ kind: "draw", layerId: 2, keyframeIndex: 0, opacity: 100 }]);
  });

  it("skips drawing layers with no keyframe yet at this frame", () => {
    const p = proj([layer(1, [hold(), key()])], 2);
    expect(buildFrameDrawList(p, 0)).toEqual([]);
  });

  it("emits a ref op for visible reference layers, in z-order with drawing layers", () => {
    const p: Project = {
      width: 10, height: 10, fps: 12, bgColor: "#fff", frameCount: 1,
      layers: [refLayer(1), layer(2, [key()], { id: 2 })],
    };
    expect(buildFrameDrawList(p, 0)).toEqual([
      { kind: "ref", layerId: 1, opacity: 60 },
      { kind: "draw", layerId: 2, keyframeIndex: 0, opacity: 100 },
    ]);
  });

  it("excludes reference layers when includeReference is false", () => {
    const p: Project = {
      width: 10, height: 10, fps: 12, bgColor: "#fff", frameCount: 1,
      layers: [refLayer(1), layer(2, [key()], { id: 2 })],
    };
    expect(buildFrameDrawList(p, 0, false)).toEqual([
      { kind: "draw", layerId: 2, keyframeIndex: 0, opacity: 100 },
    ]);
  });
});

describe("containRect", () => {
  it("centres a wide source inside a square box (letterboxed top/bottom)", () => {
    expect(containRect(200, 100, 100, 100)).toEqual({ x: 0, y: 25, w: 100, h: 50 });
  });
  it("centres a tall source inside a square box (pillarboxed left/right)", () => {
    expect(containRect(100, 200, 100, 100)).toEqual({ x: 25, y: 0, w: 50, h: 100 });
  });
  it("fills exactly when aspect ratios match", () => {
    expect(containRect(50, 25, 100, 50)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });
  it("returns the full box for a zero-sized source", () => {
    expect(containRect(0, 0, 100, 80)).toEqual({ x: 0, y: 0, w: 100, h: 80 });
  });
});

describe("createReferenceLayer", () => {
  it("creates a faint, visible ref layer with the given media", () => {
    const media: ReferenceMedia = { type: "image", el: {} as HTMLImageElement };
    const r = createReferenceLayer(media, "bg.png");
    expect(r.kind).toBe("ref");
    expect(r.visible).toBe(true);
    expect(r.opacity).toBe(60);
    expect(r.offsetFrames).toBe(0);
    expect(r.name).toBe("bg.png");
    expect(r.media).toBe(media);
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `npm test -- document`
Expected: FAIL — `containRect`/`createReferenceLayer`/`ReferenceMedia` not exported and the `buildFrameDrawList` shape mismatches.

- [ ] **Step 3: Implement the model changes in `document.ts`**

Replace the `export type Layer = DrawingLayer; // reference layers arrive in a later plan` line with:
```ts
export type ReferenceMedia =
  | { type: "image"; el: HTMLImageElement }
  | { type: "video"; el: HTMLVideoElement };

export interface ReferenceLayer {
  kind: "ref";
  id: number;
  name: string;
  visible: boolean;
  opacity: number;       // 0..100
  offsetFrames: number;  // video time offset in frames; ignored for images
  media: ReferenceMedia;
}

export type Layer = DrawingLayer | ReferenceLayer;

export function isDrawingLayer(l: Layer): l is DrawingLayer {
  return l.kind === "draw";
}
```
Replace the `DrawOp` interface and `buildFrameDrawList` function with:
```ts
export type FrameOp =
  | { kind: "draw"; layerId: number; keyframeIndex: number; opacity: number }
  | { kind: "ref"; layerId: number; opacity: number };

/**
 * Ordered (bottom→top) list of what each visible layer contributes at `frame`.
 * Reference layers are omitted when `includeReference` is false (used by export and onion).
 */
export function buildFrameDrawList(project: Project, frame: number, includeReference = true): FrameOp[] {
  const ops: FrameOp[] = [];
  for (const layer of project.layers) {
    if (!layer.visible) continue;
    if (layer.kind === "draw") {
      const ki = resolveKeyframeIndex(layer.cells, frame);
      if (ki === null) continue;
      ops.push({ kind: "draw", layerId: layer.id, keyframeIndex: ki, opacity: layer.opacity });
    } else {
      if (!includeReference) continue;
      ops.push({ kind: "ref", layerId: layer.id, opacity: layer.opacity });
    }
  }
  return ops;
}

/** Aspect-preserving "contain" fit of a `srcW×srcH` source centred in a `boxW×boxH` box. */
export function containRect(srcW: number, srcH: number, boxW: number, boxH: number): { x: number; y: number; w: number; h: number } {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: boxW, h: boxH };
  const scale = Math.min(boxW / srcW, boxH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

/** Intrinsic pixel size of reference media (0 until loaded). */
export function mediaIntrinsicSize(media: ReferenceMedia): { w: number; h: number } {
  if (media.type === "image") return { w: media.el.naturalWidth, h: media.el.naturalHeight };
  return { w: media.el.videoWidth, h: media.el.videoHeight };
}
```
Add the `createReferenceLayer` factory immediately after `createDrawingLayer`:
```ts
/** A reference layer defaults to faint (60%) so the artist's ink reads over it. */
export function createReferenceLayer(media: ReferenceMedia, name?: string): ReferenceLayer {
  const id = nextLayerId++;
  return {
    kind: "ref",
    id,
    name: name ?? `Reference ${id}`,
    visible: true,
    opacity: 60,
    offsetFrames: 0,
    media,
  };
}
```

- [ ] **Step 4: Run to verify all document tests pass**

Run: `npm test -- document`
Expected: PASS (resolveKeyframeIndex + the rewritten buildFrameDrawList + containRect + createReferenceLayer). Note: `render.ts` still imports the old `DrawOp` — it will be fixed in Task 3; `npm run check` may error on `render.ts` until then. Run `npm test -- document` only here.

- [ ] **Step 5: Commit**

```bash
git add src/anim/document.ts src/__tests__/document.test.ts
git commit -m "feat(anim): reference layer model + FrameOp draw list + containRect"
```

---

## Task 2: Skip reference layers in timeline cell operations

**Files:**
- Modify: `src/anim/timeline.ts`
- Test: `src/__tests__/timeline.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/__tests__/timeline.test.ts`:
```ts
import type { ReferenceLayer } from "../anim/document";

function refLayerFixture(id: number): ReferenceLayer {
  return {
    kind: "ref", id, name: `R${id}`, visible: true, opacity: 60, offsetFrames: 0,
    media: { type: "image", el: {} as HTMLImageElement },
  };
}

describe("timeline operations with reference layers", () => {
  it("addFrame does not add cells to reference layers (and does not crash)", () => {
    const d = layer([{ kind: "key", canvas: fakeOps.create() }]);
    const r = refLayerFixture(2);
    const p: Project = { width: 10, height: 10, fps: 12, bgColor: "#fff", frameCount: 1, layers: [d, r] };
    addFrame(p);
    expect(p.frameCount).toBe(2);
    expect(d.cells.length).toBe(2);
    expect((r as unknown as { cells?: unknown }).cells).toBeUndefined();
  });

  it("deleteFrame only splices drawing-layer cells", () => {
    const d = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
    const r = refLayerFixture(2);
    const p: Project = { width: 10, height: 10, fps: 12, bgColor: "#fff", frameCount: 2, layers: [d, r] };
    deleteFrame(p, 0);
    expect(p.frameCount).toBe(1);
    expect(d.cells.length).toBe(1);
    expect((r as unknown as { cells?: unknown }).cells).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- timeline`
Expected: FAIL — `addFrame`/`deleteFrame` try to `.push`/`.splice` on `r.cells` (undefined) and throw.

- [ ] **Step 3: Implement the guards**

In `src/anim/timeline.ts`, in `addFrame`, the loop is:
```ts
  for (const layer of project.layers) {
    layer.cells.push({ kind: "hold" });
  }
```
Change to:
```ts
  for (const layer of project.layers) {
    if (layer.kind !== "draw") continue;
    layer.cells.push({ kind: "hold" });
  }
```
In `deleteFrame`, the loop is:
```ts
  for (const layer of project.layers) {
    layer.cells.splice(frame, 1);
  }
```
Change to:
```ts
  for (const layer of project.layers) {
    if (layer.kind !== "draw") continue;
    layer.cells.splice(frame, 1);
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- timeline`
Expected: PASS (all timeline tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/anim/timeline.ts src/__tests__/timeline.test.ts
git commit -m "feat(anim): timeline cell ops skip reference layers"
```

---

## Task 3: Composite reference media + exclude from onion

**Files:**
- Modify: `src/anim/render.ts`, `src/anim/onion.ts`
- Test: `src/__tests__/render.test.ts`

- [ ] **Step 1: Update render tests for the FrameOp shape and add a ref-media draw test**

In `src/__tests__/render.test.ts`, the existing `recordingCtx` records `drawImage(img)` as `drawImage:${img.__id}@${alpha}`. The ref-media path calls `drawImage(el, x, y, w, h)` (5 args). Update `recordingCtx`'s `drawImage` to also record sized draws, and add tests. Replace the `recordingCtx` function with:
```ts
function recordingCtx() {
  const calls: string[] = [];
  const ctx = {
    calls,
    canvas: { width: 100, height: 100 },
    globalAlpha: 1,
    fillStyle: "",
    setTransform: () => {},
    clearRect: () => calls.push("clearRect"),
    fillRect: () => calls.push(`fillRect:${ctx.fillStyle}`),
    drawImage: (img: { __id: number }, ...rest: number[]) =>
      calls.push(`drawImage:${img.__id}@${ctx.globalAlpha}${rest.length ? ":sized" : ""}`),
  };
  return ctx;
}
```
Append these tests (the `compositeFrameLayers` describe already exists from Plan 2 — add a new describe):
```ts
import { createReferenceLayer } from "../anim/document";

describe("compositeFrameLayers with reference layers", () => {
  function imageMedia(id: number, w = 50, h = 50) {
    return { type: "image" as const, el: { __id: id, naturalWidth: w, naturalHeight: h } as unknown as HTMLImageElement };
  }

  it("draws a reference layer's media (sized via containRect) at its opacity, in z-order", () => {
    const refEl = imageMedia(7);
    const ref = createReferenceLayer(refEl, "bg");
    ref.id = 1; // deterministic for the assertion
    const drawC = keyCanvas();
    const p: Project = {
      width: 100, height: 100, fps: 12, bgColor: "#fff", frameCount: 1,
      layers: [ref, layer([{ kind: "key", canvas: drawC }], { id: 2 })],
    };
    const ctx = recordingCtx();
    compositeFrameLayers(ctx as unknown as CanvasRenderingContext2D, p, 0, 1);
    const draws = ctx.calls.filter((c) => c.startsWith("drawImage"));
    expect(draws).toEqual([
      `drawImage:7@0.6:sized`,                                    // ref media, sized, 60% opacity
      `drawImage:${(drawC as unknown as { __id: number }).__id}@1`, // drawing layer keyframe on top
    ]);
  });

  it("omits reference layers when includeReference is false", () => {
    const ref = createReferenceLayer(imageMedia(7), "bg");
    ref.id = 1;
    const drawC = keyCanvas();
    const p: Project = {
      width: 100, height: 100, fps: 12, bgColor: "#fff", frameCount: 1,
      layers: [ref, layer([{ kind: "key", canvas: drawC }], { id: 2 })],
    };
    const ctx = recordingCtx();
    compositeFrameLayers(ctx as unknown as CanvasRenderingContext2D, p, 0, 1, false);
    expect(ctx.calls.filter((c) => c.startsWith("drawImage"))).toEqual([
      `drawImage:${(drawC as unknown as { __id: number }).__id}@1`,
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- render`
Expected: FAIL — `compositeFrameLayers` doesn't accept `includeReference`, doesn't draw ref media, and `render.ts` still references the removed `DrawOp`/old shape.

- [ ] **Step 3: Rewrite `compositeFrameLayers` in `render.ts`**

Replace the `import` line and the whole `compositeFrameLayers` function with:
```ts
import { buildFrameDrawList, containRect, mediaIntrinsicSize, type Project } from "./document";

/**
 * Draw the visible layers for `frame` onto `ctx`, bottom→top, each at its layer opacity.
 * Drawing layers blit their resolved keyframe; reference layers draw their media with a
 * "contain" fit. Reference layers are omitted when `includeReference` is false.
 * Does NOT clear or fill — the caller resets the transform and clears/fills beforehand.
 */
export function compositeFrameLayers(
  ctx: CanvasRenderingContext2D,
  project: Project,
  frame: number,
  dpr: number,
  includeReference = true
): void {
  const layersById = new Map(project.layers.map((l) => [l.id, l]));
  for (const op of buildFrameDrawList(project, frame, includeReference)) {
    const layer = layersById.get(op.layerId)!;
    ctx.globalAlpha = op.opacity / 100;
    if (op.kind === "draw" && layer.kind === "draw") {
      const cell = layer.cells[op.keyframeIndex];
      if (cell.kind !== "key") continue;
      ctx.drawImage(cell.canvas, 0, 0);
    } else if (op.kind === "ref" && layer.kind === "ref") {
      const size = mediaIntrinsicSize(layer.media);
      if (size.w === 0 || size.h === 0) continue; // media not loaded yet
      const r = containRect(size.w, size.h, project.width * dpr, project.height * dpr);
      ctx.drawImage(layer.media.el, r.x, r.y, r.w, r.h);
    }
  }
  ctx.globalAlpha = 1;
}
```
(`renderFrame` calls `compositeFrameLayers(ctx, project, frame, dpr)` unchanged — `includeReference` defaults to true, so the display shows references.)

- [ ] **Step 4: Exclude reference layers from onion in `onion.ts`**

In `src/anim/onion.ts`, in the private `drawGhost`, the active-layer branch currently is:
```ts
  } else {
    const layer = project.layers.find((l) => l.id === activeLayerId);
    if (layer) {
      const ki = resolveKeyframeIndex(layer.cells, ghostFrame);
      const cell = ki === null ? null : layer.cells[ki];
      if (cell && cell.kind === "key") scratch.drawImage(cell.canvas, 0, 0);
    }
  }
```
Change the guard to require a drawing layer:
```ts
  } else {
    const layer = project.layers.find((l) => l.id === activeLayerId);
    if (layer && layer.kind === "draw") {
      const ki = resolveKeyframeIndex(layer.cells, ghostFrame);
      const cell = ki === null ? null : layer.cells[ki];
      if (cell && cell.kind === "key") scratch.drawImage(cell.canvas, 0, 0);
    }
  }
```
And the all-layers branch currently is:
```ts
  if (allLayers) {
    compositeFrameLayers(scratch, project, ghostFrame, dpr);
  } else {
```
Change it to exclude references from ghosts:
```ts
  if (allLayers) {
    compositeFrameLayers(scratch, project, ghostFrame, dpr, false);
  } else {
```

- [ ] **Step 5: Run to verify everything passes**

Run: `npm test` — all tests pass (document, timeline, render incl. new ref tests, onion, playback, history, fill). Then `npm run check` — 0 errors (the `DrawOp` removal is now consistent across document/render).

- [ ] **Step 6: Commit**

```bash
git add src/anim/render.ts src/anim/onion.ts src/__tests__/render.test.ts
git commit -m "feat(anim): composite reference media (contain-fit); exclude from onion"
```

---

## Task 4: Reference loading + video sync helpers; app-state wiring

**Files:**
- Create: `src/anim/reference.ts`
- Modify: `src/state/appState.svelte.ts`

`reference.ts` is DOM/async (image/video element loading, video seeking) — no unit tests; verified by build + manual.

- [ ] **Step 1: Create `src/anim/reference.ts`**

```ts
import { createReferenceLayer, type ReferenceLayer, type Project } from "./document";

/** Load an image file into a reference layer (resolves once the bitmap is decoded). */
export function loadImageLayer(file: File): Promise<ReferenceLayer> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(createReferenceLayer({ type: "image", el }, file.name));
    el.onerror = () => reject(new Error(`Failed to load image: ${file.name}`));
    el.src = URL.createObjectURL(file);
  });
}

/**
 * Load a video file into a reference layer. `onSeeked` fires after each frame seek
 * completes (the caller uses it to repaint). Resolves once the first frame is available.
 */
export function loadVideoLayer(file: File, onSeeked: () => void): Promise<ReferenceLayer> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("video");
    el.muted = true;
    el.preload = "auto";
    el.playsInline = true;
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("loadeddata", () => resolve(createReferenceLayer({ type: "video", el }, file.name)), { once: true });
    el.addEventListener("error", () => reject(new Error(`Failed to load video: ${file.name}`)), { once: true });
    el.src = URL.createObjectURL(file);
  });
}

/** Seek every video reference layer to the time matching `frame` at `fps`. */
export function syncReferenceVideos(project: Project, frame: number, fps: number): void {
  for (const layer of project.layers) {
    if (layer.kind !== "ref" || layer.media.type !== "video") continue;
    const vid = layer.media.el;
    const wanted = (frame + layer.offsetFrames) / fps;
    const dur = isFinite(vid.duration) ? vid.duration : wanted;
    const clamped = Math.max(0, Math.min(dur, wanted));
    if (Math.abs(vid.currentTime - clamped) > 1e-3) vid.currentTime = clamped;
  }
}
```

- [ ] **Step 2: Add app-state helpers**

In `src/state/appState.svelte.ts`, after the existing `export function activeLayer() { … }`, add:
```ts
import { isDrawingLayer, type DrawingLayer, type Layer } from "../anim/document";

/** The active layer if it is a drawing layer; null if it's a reference layer (not drawable). */
export function activeDrawingLayer(): DrawingLayer | null {
  const l = activeLayer();
  return isDrawingLayer(l) ? l : null;
}

/** Append a layer (drawing or reference) on top and make it active. */
export function addLayerToProject(layer: Layer) {
  state.project.layers.push(layer);
  state.activeLayerId = layer.id;
  bump();
}

/** Remove a layer by id, keeping at least one drawing layer. */
export function removeLayer(id: number) {
  const layers = state.project.layers;
  const idx = layers.findIndex((l) => l.id === id);
  if (idx === -1) return;
  const drawingCount = layers.filter(isDrawingLayer).length;
  if (isDrawingLayer(layers[idx]) && drawingCount <= 1) return; // keep one drawing layer
  layers.splice(idx, 1);
  if (state.activeLayerId === id) {
    const firstDrawing = layers.find(isDrawingLayer);
    if (firstDrawing) state.activeLayerId = firstDrawing.id;
  }
  bump();
}
```
NOTE: `activeLayer()` already returns `state.project.layers.find(...) ?? state.project.layers[0]` — keep it as-is. The `import { createProject, createCellCanvas, cloneCanvas, type Project } …` line at the top already imports from `../anim/document`; you may merge the new `isDrawingLayer, type DrawingLayer, type Layer` import into that existing line instead of adding a second import from the same module.

- [ ] **Step 3: Verify**

Run: `npm run check` — 0 errors. `npm test` — all pass (no new unit tests this task).

- [ ] **Step 4: Commit**

```bash
git add src/anim/reference.ts src/state/appState.svelte.ts
git commit -m "feat: reference load/seek helpers + activeDrawingLayer/removeLayer state"
```

---

## Task 5: Guard drawing tools on reference layers + video sync in the canvas

**Files:**
- Modify: `src/lib/Canvas.svelte`

- [ ] **Step 1: Import the new helpers**

In `src/lib/Canvas.svelte`, the appState import currently is two lines:
```ts
  import { state, history, DPR, canvasOps, activeLayer, bump } from "../state/appState.svelte";
  import { selectionRef } from "../state/appState.svelte";
```
Change the first to add `activeDrawingLayer` and add a `syncReferenceVideos` import:
```ts
  import { state, history, DPR, canvasOps, activeLayer, activeDrawingLayer, bump } from "../state/appState.svelte";
  import { selectionRef } from "../state/appState.svelte";
  import { syncReferenceVideos } from "../anim/reference";
```
(`activeLayer` stays imported — it remains used by the selection branch's hit-test path; if `npm run check` reports `activeLayer` is now unused after Step 2, remove it from the import then.)

- [ ] **Step 2: Use `activeDrawingLayer()` for the brush and fill paths**

In `doFill`, the first lines are:
```ts
  function doFill(pt: { x: number; y: number }) {
    const layer = activeLayer();
    if (layer.locked) return;
```
Change to:
```ts
  function doFill(pt: { x: number; y: number }) {
    const layer = activeDrawingLayer();
    if (!layer || layer.locked) return;
```
In `onStroke`'s brush branch, the lines are:
```ts
    if (!strokeCanvas) {
      // First event of the stroke: resolve the target layer once and bail if it's
      // locked. Binding the layer here (rather than re-reading activeLayer() every
      // move) keeps the whole stroke on the layer it started on.
      const layer = activeLayer();
      if (layer.locked) return;
      strokeCanvas = ensureDrawableKeyframe(layer, state.playhead, canvasOps);
```
Change the two lines:
```ts
      const layer = activeDrawingLayer();
      if (!layer || layer.locked) return;
      strokeCanvas = ensureDrawableKeyframe(layer, state.playhead, canvasOps);
```
In `onStroke`'s selection branch, the move/lift lines are:
```ts
        if (selection.state === "selected" && handle === "move") {
          // First grab inside a fresh marquee: lift the pixels and enter transform mode.
          const layer = activeLayer();
          if (layer.locked) return;
          const canvas = ensureDrawableKeyframe(layer, state.playhead, canvasOps);
```
Change to:
```ts
        if (selection.state === "selected" && handle === "move") {
          // First grab inside a fresh marquee: lift the pixels and enter transform mode.
          const layer = activeDrawingLayer();
          if (!layer || layer.locked) return;
          const canvas = ensureDrawableKeyframe(layer, state.playhead, canvasOps);
```

- [ ] **Step 3: Sync video reference layers when the playhead/fps changes**

In `onMount`, the rAF poll currently is:
```ts
    const tick = () => {
      if (state.version !== lastVersion || state.playhead !== lastPlayhead) {
        lastVersion = state.version;
        lastPlayhead = state.playhead;
        recomposite();
      }
      raf = requestAnimationFrame(tick);
    };
```
Change the body to also seek videos:
```ts
    const tick = () => {
      if (state.version !== lastVersion || state.playhead !== lastPlayhead) {
        lastVersion = state.version;
        lastPlayhead = state.playhead;
        syncReferenceVideos(state.project, state.playhead, state.project.fps);
        recomposite();
      }
      raf = requestAnimationFrame(tick);
    };
```
(When a video seek completes, the loader's `onSeeked` callback — wired in Task 6 to `bump()` — bumps `state.version`, so this poll repaints with the freshly-seeked frame.)

- [ ] **Step 4: Verify**

Run: `npm run check` — 0 errors (resolve the `activeLayer` unused note from Step 1 if it appears). `npm test` — all pass. `npm run dev` (headless) — boots clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Canvas.svelte
git commit -m "feat(ui): guard drawing on reference layers + seek videos to playhead"
```

---

## Task 6: Layer-list rows + import buttons; verification

**Files:**
- Modify: `src/lib/LayerList.svelte`, `src/lib/Toolbar.svelte`

- [ ] **Step 1: Rewrite `LayerList.svelte` to handle both layer kinds**

Replace the entire contents of `src/lib/LayerList.svelte` with:
```svelte
<script lang="ts">
  import { state, bump, removeLayer } from "../state/appState.svelte";
  import { createDrawingLayer } from "../anim/document";

  function addLayer() {
    const layer = createDrawingLayer(state.project.frameCount);
    state.project.layers.push(layer);
    state.activeLayerId = layer.id;
    bump();
  }
</script>

<div class="w-56 border-l border-neutral-300 bg-neutral-100 p-2 flex flex-col gap-1">
  <div class="flex justify-between items-center">
    <span class="text-sm font-semibold">Layers</span>
    <button onclick={addLayer} title="Add drawing layer">＋</button>
  </div>
  {#each [...state.project.layers].reverse() as layer (layer.id)}
    <div class="flex items-center gap-1 px-1 py-0.5 rounded"
         class:bg-neutral-300={layer.id === state.activeLayerId}>
      <input type="checkbox" bind:checked={layer.visible} onchange={bump} title="Visible" />
      {#if layer.kind === "ref"}
        <span class="text-[10px] px-1 rounded bg-neutral-400 text-white uppercase">{layer.media.type}</span>
      {/if}
      <button class="flex-1 text-left text-sm truncate" onclick={() => (state.activeLayerId = layer.id)}>
        {layer.name}
      </button>
      <input class="w-12" type="range" min="0" max="100" bind:value={layer.opacity} onchange={bump}
             title="Opacity" />
      <button class="text-neutral-500 hover:text-red-600" onclick={() => removeLayer(layer.id)} title="Delete">×</button>
    </div>
  {/each}
</div>
```

- [ ] **Step 2: Add Add-Image / Add-Video import to `Toolbar.svelte`**

In `src/lib/Toolbar.svelte`, replace the `<script>` block with:
```svelte
<script lang="ts">
  import { state, history, bump, addLayerToProject } from "../state/appState.svelte";
  import { loadImageLayer, loadVideoLayer } from "../anim/reference";

  let fileInput: HTMLInputElement;
  let pendingKind: "image" | "video" = "image";

  function pick(kind: "image" | "video") {
    pendingKind = kind;
    fileInput.accept = kind === "image" ? "image/*" : "video/*";
    fileInput.value = "";
    fileInput.click();
  }

  async function onFile() {
    const file = fileInput.files?.[0];
    if (!file) return;
    const layer = pendingKind === "image"
      ? await loadImageLayer(file)
      : await loadVideoLayer(file, () => bump());
    addLayerToProject(layer);
  }
</script>
```
Then, in the markup, after the existing Undo/Redo buttons (the last line is `<button onclick={() => history.redo()}>Redo</button>`), add before the closing `</div>`:
```svelte
  <span class="w-px h-5 bg-neutral-300 mx-1"></span>
  <button onclick={() => pick("image")}>Add Image</button>
  <button onclick={() => pick("video")}>Add Video</button>
  <input bind:this={fileInput} type="file" class="hidden" onchange={onFile} />
```

- [ ] **Step 3: Automated verification (Definition of Done — run all, paste real output)**

1. `npm run check` — 0 errors.
2. `npm test` — all pass (Plan 4's 49 + new document/timeline/render ref tests; expect 49 + 5 (buildFrameDrawList ref/exclude + containRect×4 + createReferenceLayer) ... count is informational — the gate is all-green). Paste the `Tests` line.
3. `npx vite build` — successful production build.
4. Dev boot (headless): `npm run dev` short timeout — `Local:` URL, no compile/runtime errors, stop.

Do NOT claim image/video display or scrubbing works — that's the human's manual step.

- [ ] **Step 4: Commit**

```bash
git add src/lib/LayerList.svelte src/lib/Toolbar.svelte
git commit -m "feat(ui): reference layer rows + image/video import"
```

- [ ] **Step 5: Manual verification checklist (HUMAN — required; no browser automation here)**

Run `npm run dev`, open the app:
1. **Add Image**: click "Add Image", pick a PNG/JPG → a faint reference appears under the drawing, contain-fit (letterboxed if aspect differs), and a new `IMAGE` row appears in Layers. Draw over it — ink reads on top.
2. **Opacity / visibility**: drag the reference row's opacity slider (it fades); uncheck its checkbox (it hides). Delete it with `×`.
3. **Add Video**: click "Add Video", pick an MP4 → its first frame shows as a faint reference. Step the playhead (`,`/`.`) or scrub frames → the video reference updates to the matching time (a moment of lag per seek is expected). Play (`K`) → the reference advances roughly with playback.
4. **Not drawable / not onion**: select the reference row as active, then try to draw — nothing happens (references aren't drawable). Turn on onion — reference layers do NOT appear as tinted ghosts.
5. **No regression**: drawing, eraser, fill, selection/transform, onion, playback still work; you always keep at least one drawing layer (delete is blocked on the last drawing layer).

---

## Self-Review (completed during planning)

**Spec coverage (spec §4 reference layers + §2 image+video decision):** `ReferenceLayer` union with image/video media (Task 1); never holds cells / timeline skips them (Task 2); composited contain-fit at opacity, excluded from onion (Task 3) and (via `includeReference=false`) ready for export exclusion in Plan 6; video seeks to `(frame+offsetFrames)/fps` re-rendering on `seeked` (Tasks 4–5); import + opacity/visibility/delete UI (Task 6); not drawable (Task 5 guards). `offsetFrames` exists in the model (default 0); a numeric UI for it is deferred (noted limitation). Interactive transform/positioning of references is out of scope (contain-fit only).

**Placeholder scan:** none — every step has complete code and an exact command + expected result.

**Type consistency:** `Layer = DrawingLayer | ReferenceLayer`, `ReferenceMedia`, `FrameOp` (replaces `DrawOp`), `containRect`, `mediaIntrinsicSize`, `createReferenceLayer`, `isDrawingLayer` defined in Task 1 and used in Tasks 2–6. `buildFrameDrawList(project, frame, includeReference=true)` signature is consistent across document/render/onion. `activeDrawingLayer()`, `addLayerToProject()`, `removeLayer()` defined in Task 4 and used in Tasks 5–6. `syncReferenceVideos`, `loadImageLayer`, `loadVideoLayer` defined in Task 4 and used in Tasks 5–6. `render.ts`'s removal of `DrawOp` is made consistent within Task 3 (document changed in Task 1; `npm run check` is only asserted clean again at the end of Task 3).

**Risks / known limitations (flagged):**
- **Video sync + loading are untested** (DOM/async) — manual verification required.
- **Per-seek lag**: scrubbing fast may show stale frames until each `seeked` fires; acceptable for rotoscope tracing.
- **No reference repositioning** (contain-fit only) and **no offset UI** — both deferred; the model carries `offsetFrames` for a later pass.
- **Memory**: object URLs from imported files are not revoked on layer delete — a minor leak acceptable at MVP, worth addressing with persistence (Plan 7).
