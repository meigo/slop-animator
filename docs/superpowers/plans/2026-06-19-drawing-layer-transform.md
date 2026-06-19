# Drawing-Layer Free Transform (Approach B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give drawing layers a persistent, non-destructive per-layer free transform (move/scale/rotate via the existing gizmo under a new Transform tool), with brush/eraser/fill painting correctly through it, plus Apply/Reset and persistence.

**Architecture:** Reuse the layer-agnostic `core/ref-transform.ts` math and a shared affine renderer (`drawTransformed`). A drawing layer's base rect is the full document (pivots around doc center). Painting maps input doc→local via `inverseTransformPoint`; the live preview falls out of the existing recompose. Boil is handled by pre-rendering a transformed cell into a scratch canvas (no GLSL change). An identity fast-path keeps the common case free.

**Tech Stack:** TypeScript, Svelte 5 (Canvas/Gizmo = runes mode; Toolbar/LayerList = legacy mode), Vitest (node env — canvas mocked via `recordingCtx`; `appState` not importable in tests).

**Spec:** `docs/superpowers/specs/2026-06-19-drawing-layer-transform-design.md`

**Branch:** execute on a new branch `drawing-layer-transform` (off `main`).

**Key constraints (verified against current code):**
- `RefTransform = {dx,dy,scale,rotation}` and `ref-transform.ts` are already layer-agnostic. Reference layers already carry `transform`; this mirrors that for drawing layers.
- `render.ts` `compositeFrameLayers` draws draw cells with `ctx.drawImage(cell.canvas, 0, 0)` (2D, line ~74) and `boilLayer(cell.canvas, …)` (boil branch, line ~61). Both need the transform.
- Tests run in **node**; `appState.svelte.ts` (reads `window`) is not importable there. Unit tests cover only pure functions in `document.ts`, `ref-transform.ts`, `render.ts` (via the existing `recordingCtx`). Everything in appState/Canvas/Gizmo/Toolbar/LayerList/persist is build + manual.
- `recordingCtx` in `render.test.ts` records `drawImage:<__id>@<alpha>` and appends `:sized` when ≥4 args; `translate/rotate/scale` are no-op (not recorded). So identity vs non-identity draw layers are distinguished by the `:sized` suffix.

---

### Task 1: Data model — transform on DrawingLayer + helpers

**Files:**
- Modify: `src/anim/document.ts`
- Test: `src/__tests__/document.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/document.test.ts` (import the new symbols from `../anim/document`):
```ts
import { IDENTITY_TRANSFORM, isIdentityTransform, transformBaseRect, createDrawingLayer, createReferenceLayer } from "../anim/document";

describe("layer transform helpers", () => {
  it("isIdentityTransform detects identity", () => {
    expect(isIdentityTransform(IDENTITY_TRANSFORM)).toBe(true);
    expect(isIdentityTransform({ dx: 1, dy: 0, scale: 1, rotation: 0 })).toBe(false);
    expect(isIdentityTransform({ dx: 0, dy: 0, scale: 2, rotation: 0 })).toBe(false);
  });

  it("createDrawingLayer starts at identity", () => {
    expect(isIdentityTransform(createDrawingLayer(3).transform)).toBe(true);
  });

  it("transformBaseRect: full document for a draw layer", () => {
    expect(transformBaseRect(createDrawingLayer(1), 100, 80)).toEqual({ x: 0, y: 0, w: 100, h: 80 });
  });

  it("transformBaseRect: contain-fit for a ref, null when media unloaded", () => {
    const loaded = createReferenceLayer({ type: "image", el: { naturalWidth: 50, naturalHeight: 50 } as unknown as HTMLImageElement });
    const r = transformBaseRect(loaded, 100, 100);
    expect(r).not.toBeNull();
    expect(r!.w).toBeCloseTo(100, 5); // 50x50 contained in 100x100 → 100x100
    const unloaded = createReferenceLayer({ type: "image", el: { naturalWidth: 0, naturalHeight: 0 } as unknown as HTMLImageElement });
    expect(transformBaseRect(unloaded, 100, 100)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run src/__tests__/document.test.ts` (symbols not exported).

- [ ] **Step 3: Implement**

In `src/anim/document.ts`:
1. Add `transform: RefTransform;` to the `DrawingLayer` interface (after `cells: Cell[];` is fine).
2. Add exports (near `RefTransform`/`createDrawingLayer`):
```ts
export const IDENTITY_TRANSFORM: RefTransform = { dx: 0, dy: 0, scale: 1, rotation: 0 };

export function isIdentityTransform(t: RefTransform): boolean {
  return t.dx === 0 && t.dy === 0 && t.scale === 1 && t.rotation === 0;
}

/** Logical base rect for a layer's transform: the full document for a draw layer; the media
 *  contain-fit rect for a ref (null when the ref's media isn't loaded). */
export function transformBaseRect(layer: Layer, docW: number, docH: number): { x: number; y: number; w: number; h: number } | null {
  if (layer.kind === "draw") return { x: 0, y: 0, w: docW, h: docH };
  const size = mediaIntrinsicSize(layer.media);
  if (size.w === 0 || size.h === 0) return null;
  return containRect(size.w, size.h, docW, docH);
}
```
3. In `createDrawingLayer`, add `transform: { ...IDENTITY_TRANSFORM },` to the returned object.

- [ ] **Step 4: Verify** — `npx vitest run src/__tests__/document.test.ts` passes; `npm run build` → 0/0. (TS will now flag every `DrawingLayer` literal missing `transform` — there are construction sites in `appState.svelte.ts` (`createDrawingLayer` covers them), `project-file.ts` (Task 5), and `render.test.ts`'s `layer()` helper. Fix only the ones TS flags now: add `transform: { dx:0,dy:0,scale:1,rotation:0 }` to the `render.test.ts` `layer()` helper's object so the file still compiles; project-file is Task 5.)

- [ ] **Step 5: Commit**
```bash
git add src/anim/document.ts src/__tests__/document.test.ts src/__tests__/render.test.ts
git commit -m "feat: per-layer transform field + helpers on DrawingLayer"
```

---

### Task 2: `inverseTransformPoint`

**Files:**
- Modify: `src/core/ref-transform.ts`
- Test: `src/__tests__/ref-transform.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/ref-transform.test.ts` (import `inverseTransformPoint`; `Rect`/`Pt`/`RefTransform` as used in the file):
```ts
describe("inverseTransformPoint", () => {
  const base = { x: 0, y: 0, w: 100, h: 100 }; // doc center = (50,50)
  const id = { dx: 0, dy: 0, scale: 1, rotation: 0 };

  it("identity is a no-op", () => {
    expect(inverseTransformPoint(base, id, { x: 30, y: 70 })).toEqual({ x: 30, y: 70 });
  });

  it("pure translate subtracts the offset", () => {
    const p = inverseTransformPoint(base, { ...id, dx: 10, dy: -5 }, { x: 30, y: 70 });
    expect(p.x).toBeCloseTo(20, 5);
    expect(p.y).toBeCloseTo(75, 5);
  });

  it("pure scale divides distance from doc center", () => {
    const p = inverseTransformPoint(base, { ...id, scale: 2 }, { x: 70, y: 50 }); // 20 right of center on screen
    expect(p.x).toBeCloseTo(60, 5); // → 10 right of center in local
    expect(p.y).toBeCloseTo(50, 5);
  });

  it("round-trips the forward render transform", () => {
    const t = { dx: 12, dy: -7, scale: 1.5, rotation: 0.6 };
    const cx = base.x + base.w / 2, cy = base.y + base.h / 2;
    const local = { x: 73, y: 21 };
    // forward (mirror of drawTransformed, logical/dpr=1): screen = center + R(θ)·s·(local - baseCenter)
    const ox = local.x - cx, oy = local.y - cy;
    const cos = Math.cos(t.rotation), sin = Math.sin(t.rotation);
    const screen = { x: cx + t.dx + t.scale * (ox * cos - oy * sin), y: cy + t.dy + t.scale * (ox * sin + oy * cos) };
    const back = inverseTransformPoint(base, t, screen);
    expect(back.x).toBeCloseTo(local.x, 4);
    expect(back.y).toBeCloseTo(local.y, 4);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run src/__tests__/ref-transform.test.ts`.

- [ ] **Step 3: Implement** — add to `src/core/ref-transform.ts`:
```ts
/** Map a document-space point into a layer's local (untransformed) cell space — the inverse of the
 *  affine used to render the layer. Identity transform ⇒ the point unchanged. */
export function inverseTransformPoint(base: Rect, t: RefTransform, p: Pt): Pt {
  const cx = base.x + base.w / 2, cy = base.y + base.h / 2;
  const ox = p.x - (cx + t.dx), oy = p.y - (cy + t.dy);
  const cos = Math.cos(-t.rotation), sin = Math.sin(-t.rotation);
  return { x: cx + (ox * cos - oy * sin) / t.scale, y: cy + (ox * sin + oy * cos) / t.scale };
}
```

- [ ] **Step 4: Verify** — tests pass; `npm run build` → 0/0.

- [ ] **Step 5: Commit**
```bash
git add src/core/ref-transform.ts src/__tests__/ref-transform.test.ts
git commit -m "feat: inverseTransformPoint (doc→local) for drawing through a layer transform"
```

---

### Task 3: Shared affine renderer + transformed draw cells

**Files:**
- Modify: `src/anim/render.ts`
- Test: `src/__tests__/render.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/render.test.ts` (the `layer()` helper now includes `transform` from Task 1; build a transformed variant):
```ts
describe("compositeFrameLayers with a drawing-layer transform", () => {
  it("identity transform uses the plain (non-sized) blit", () => {
    const c = keyCanvas();
    const p: Project = {
      width: 100, height: 100, fps: 12, bgColor: "#000", frameCount: 1, boil: defaultBoilConfig(), groups: [],
      layers: [layer([{ kind: "key", canvas: c }], { id: 1 })], audio: null,
    };
    const ctx = recordingCtx();
    compositeFrameLayers(ctx as unknown as CanvasRenderingContext2D, p, 0, 1);
    expect(ctx.calls.filter((x) => x.startsWith("drawImage"))).toEqual([`drawImage:${(c as unknown as { __id: number }).__id}@1`]);
  });

  it("non-identity transform draws sized (through the affine)", () => {
    const c = keyCanvas();
    const p: Project = {
      width: 100, height: 100, fps: 12, bgColor: "#000", frameCount: 1, boil: defaultBoilConfig(), groups: [],
      layers: [layer([{ kind: "key", canvas: c }], { id: 1, transform: { dx: 5, dy: 0, scale: 1.5, rotation: 0 } })], audio: null,
    };
    const ctx = recordingCtx();
    compositeFrameLayers(ctx as unknown as CanvasRenderingContext2D, p, 0, 1);
    expect(ctx.calls.filter((x) => x.startsWith("drawImage"))).toEqual([`drawImage:${(c as unknown as { __id: number }).__id}@1:sized`]);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (non-identity currently blits non-sized).

- [ ] **Step 3: Implement**

In `src/anim/render.ts`:
1. Add the shared affine + import `isIdentityTransform` from `./document` and `type RefTransform`:
```ts
/** Draw `img` onto `ctx` (assumed at identity, DEVICE pixels) placed by `base` (device rect) + `t`. */
export function drawTransformed(ctx: CanvasRenderingContext2D, img: CanvasImageSource, base: { x: number; y: number; w: number; h: number }, t: RefTransform, dpr: number): void {
  ctx.save();
  ctx.translate(base.x + base.w / 2 + t.dx * dpr, base.y + base.h / 2 + t.dy * dpr);
  ctx.rotate(t.rotation);
  ctx.scale(t.scale, t.scale);
  ctx.drawImage(img, -base.w / 2, -base.h / 2, base.w, base.h);
  ctx.restore();
}
```
2. Rewrite `drawReferenceMedia` (from Approach A) to delegate:
```ts
export function drawReferenceMedia(ctx, layer, docW, docH, dpr) {
  if (layer.media.type === "missing") return;
  const size = mediaIntrinsicSize(layer.media);
  if (size.w === 0 || size.h === 0) return;
  const base = containRect(size.w, size.h, docW * dpr, docH * dpr);
  drawTransformed(ctx, layer.media.el, base, layer.transform, dpr);
}
```
3. In `compositeFrameLayers`, the 2D draw branch (`ctx.drawImage(cell.canvas, 0, 0)`):
```ts
    if (op.kind === "draw" && layer.kind === "draw") {
      const cell = layer.cells[op.keyframeIndex];
      if (cell.kind !== "key") continue;
      if (isIdentityTransform(layer.transform)) ctx.drawImage(cell.canvas, 0, 0);
      else drawTransformed(ctx, cell.canvas, { x: 0, y: 0, w: project.width * dpr, h: project.height * dpr }, layer.transform, dpr);
    } else if (...ref...) { ... }
```
4. Boil branch — pre-render a transformed cell into a reused scratch, feed to `boilLayer`. Add module-level:
```ts
let boilScratch: HTMLCanvasElement | null = null;
function transformedCell(cell: HTMLCanvasElement, t: RefTransform, wDev: number, hDev: number, dpr: number): HTMLCanvasElement {
  if (!boilScratch) boilScratch = document.createElement("canvas");
  if (boilScratch.width !== wDev || boilScratch.height !== hDev) { boilScratch.width = wDev; boilScratch.height = hDev; }
  const c = boilScratch.getContext("2d")!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, wDev, hDev);
  drawTransformed(c, cell, { x: 0, y: 0, w: wDev, h: hDev }, t, dpr);
  return boilScratch;
}
```
In the boil draw-layer loop, replace `boilLayer(cell.canvas, …)` with:
```ts
      const src = isIdentityTransform(layer.transform) ? cell.canvas : transformedCell(cell.canvas, layer.transform, w, h, dpr);
      boilLayer(src, op.opacity / 100, crisp ? 0 : boil.amount * strength, boil.cols, crisp ? 0 : boil.weight * strength, seed);
```
(Boil path isn't exercised in node tests — `boilBegin` returns false without GL — so `transformedCell` runs only in the browser.)

- [ ] **Step 4: Verify** — `npx vitest run src/__tests__/render.test.ts` (new cases pass; existing reference + draw tests stay green — the `drawReferenceMedia` refactor must not change output). `npm run build` → 0/0.

- [ ] **Step 5: Commit**
```bash
git add src/anim/render.ts src/__tests__/render.test.ts
git commit -m "feat: render drawing cells through their per-layer transform (2D + boil)"
```

---

### Task 4: Onion ghosts honor the transform

**Files:**
- Modify: `src/anim/onion.ts`

No automated test (drawn through `compositeFrameLayers` for all-layers; the active-only branch is canvas). Build + manual.

- [ ] **Step 1:** In `drawGhost`, the active-layer branch currently is:
```ts
    const layer = project.layers.find((l) => l.id === activeLayerId);
    if (layer && layer.kind === "draw" && isLayerVisible(layer, project.groups)) {
      const ki = resolveKeyframeIndex(layer.cells, ghostFrame);
      const cell = ki === null ? null : layer.cells[ki];
      if (cell && cell.kind === "key") scratch.drawImage(cell.canvas, 0, 0);
    }
```
Replace the final draw line with:
```ts
      if (cell && cell.kind === "key") {
        if (isIdentityTransform(layer.transform)) scratch.drawImage(cell.canvas, 0, 0);
        else drawTransformed(scratch, cell.canvas, { x: 0, y: 0, w, h }, layer.transform, dpr);
      }
```
Add imports: `isIdentityTransform` from `./document`, `drawTransformed` from `./render`. (`w`, `h`, `dpr` are already in `drawGhost` scope.)

- [ ] **Step 2:** `npm run build` → 0/0; `npm test` → all pass.

- [ ] **Step 3: Commit**
```bash
git add src/anim/onion.ts
git commit -m "feat: onion ghosts of the active layer honor its transform"
```

---

### Task 5: Persistence

**Files:**
- Modify: `src/persist/project-file.ts`

Build + manual (project-file uses real canvas; not node-unit-tested here). The existing `persist.test.ts` must stay green.

- [ ] **Step 1:** Add `transform: RefTransform;` to `DrawingLayerJson` (after `cells`). (`RefTransform` is already imported.)

- [ ] **Step 2:** In the draw-layer serializer (the `.map((l) => ({ … }))` at ~line 78), add `transform: l.transform,` (after `cells: …`).

- [ ] **Step 3:** In the draw-layer deserializer (`layers.push({ kind: "draw", … })` at ~line 168), add:
```ts
      transform: lj.transform ?? { dx: 0, dy: 0, scale: 1, rotation: 0 },
```
(Back-compat: existing saved projects/autosaves without the field load at identity.)

- [ ] **Step 4:** `npm run build` → 0/0; `npm test` → all pass (incl. `persist.test.ts`).

- [ ] **Step 5: Commit**
```bash
git add src/persist/project-file.ts
git commit -m "feat: persist drawing-layer transform (identity back-compat)"
```

---

### Task 6: appState — Transform tool, Apply/Reset, merge-bake

**Files:**
- Modify: `src/state/appState.svelte.ts`

Build + manual (appState not node-importable).

- [ ] **Step 1: Tool union** — change `export type Tool = "brush" | "eraser" | "fill" | "select" | "lasso";` to add `| "transform"`.

- [ ] **Step 2: Imports** — ensure `createCellCanvas`, `isIdentityTransform`, `IDENTITY_TRANSFORM` are imported from `../anim/document`, and `drawTransformed` from `../anim/render`. (`createCellCanvas`, `DPR`, `commitStructural`, `state`, `bump` already exist here.)

- [ ] **Step 3: Bake helper + Apply/Reset**
```ts
/** Bake a draw layer's transform into its cells and reset to identity. No commit (caller wraps it). */
function bakeLayerTransform(layer: DrawingLayer): void {
  if (isIdentityTransform(layer.transform)) return;
  const W = state.project.width, H = state.project.height;
  layer.cells = layer.cells.map((c) => {
    if (c.kind !== "key") return c;
    const canvas = createCellCanvas(W, H, DPR);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawTransformed(ctx, c.canvas, { x: 0, y: 0, w: W * DPR, h: H * DPR }, layer.transform, DPR);
    return { kind: "key", canvas };
  });
  layer.transform = { ...IDENTITY_TRANSFORM };
}

export function applyLayerTransform(layerId: number): void {
  const layer = state.project.layers.find((l) => l.id === layerId);
  if (!layer || layer.kind !== "draw" || isIdentityTransform(layer.transform)) return;
  commitStructural(() => bakeLayerTransform(layer));
}

export function resetLayerTransform(layerId: number): void {
  const layer = state.project.layers.find((l) => l.id === layerId);
  if (!layer || layer.kind !== "draw" || isIdentityTransform(layer.transform)) return;
  commitStructural(() => { layer.transform = { ...IDENTITY_TRANSFORM }; });
}
```
(`bakeLayerTransform` takes `DrawingLayer`; import the type if not already.)

- [ ] **Step 4: Merge-bake** — in `mergeDown`, inside the `commitStructural(() => { … })`, BEFORE the `below.cells = planMergeDown(…)` line, add:
```ts
    bakeLayerTransform(upper);
    bakeLayerTransform(below);
```
(So compositing the two cell tracks at identity stays pixel-correct.)

- [ ] **Step 5:** `npm run build` → 0/0; `npm test` → all pass.

- [ ] **Step 6: Commit**
```bash
git add src/state/appState.svelte.ts
git commit -m "feat: transform tool enum + applyLayerTransform/resetLayerTransform + merge bake"
```

---

### Task 7: Toolbar — Transform tool button (+ selection hint)

**Files:**
- Modify: `src/lib/Toolbar.svelte`

- [ ] **Step 1: Import** — add `Move` to the `@lucide/svelte` import (line 11).

- [ ] **Step 2: Tool button** — directly after the Lasso button (ends line ~129), add:
```svelte
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={state.tool === "transform"}
    title="Transform layer (move/scale/rotate)"
    onclick={() => (state.tool = "transform")}
  ><Move size={18} /></button>
```

- [ ] **Step 3: Selection hint** — add `isIdentityTransform` and `activeLayer` to the `../state/appState.svelte` import, then near the tool buttons add a small reactive hint shown when a select tool is chosen on a transformed draw layer:
```svelte
  {#if (state.tool === "select" || state.tool === "lasso") && activeLayer().kind === "draw" && !isIdentityTransform(activeLayer().transform)}
    <span class="text-xs text-amber-500" title="Selection is disabled on a transformed layer">Apply layer transform to select</span>
  {/if}
```
(If `activeLayer` isn't exported from appState, use `state.project.layers.find((l) => l.id === state.activeLayerId)` inline with a null guard. Verify the export during implementation; `LayerList`/`Canvas` already use an `activeLayer` accessor — match whatever exists.)

- [ ] **Step 4:** `npm run build` → 0/0; `npm test` → all pass.

- [ ] **Step 5: Commit**
```bash
git add src/lib/Toolbar.svelte
git commit -m "feat: Transform tool button + transformed-layer selection hint"
```

---

### Task 8: Gizmo — show & edit for draw layers under the Transform tool

**Files:**
- Modify: `src/lib/RefTransformGizmo.svelte`

Build + manual.

- [ ] **Step 1: Generalize the active layer + base rect.** In `src/lib/RefTransformGizmo.svelte`:
- Import `transformBaseRect, type Layer` from `../anim/document` (keep `containRect`/`mediaIntrinsicSize` if still used elsewhere — they aren't after this, so drop unused ones to avoid warnings).
- Change `drag.layer` type and `activeRef` to a generic accessor:
```ts
  let drag: { handle: DragHandle; layer: Layer; startT: Layer["transform"]; start: Pt; center: Pt } | null = null;

  function activeTransformLayer(): Layer | null {
    const l = appState.project.layers.find((x) => x.id === appState.activeLayerId);
    if (!l) return null;
    if (l.kind === "ref") return l;                                  // refs: any tool (unchanged)
    if (l.kind === "draw" && appState.tool === "transform") return l; // draw: only under the Transform tool
    return null;
  }

  function baseRect(layer: Layer) {
    return transformBaseRect(layer, appState.project.width, appState.project.height); // {x,y,w,h} | null
  }
```
- Replace `activeRef()` calls (`startHandleDrag`, `tick`, `resetTransform`) with `activeTransformLayer()`.
- In `tick`, replace the `mediaIntrinsicSize(...)`/`containRect(...)` base computation with `const base = baseRect(layer); if (base) { … } else visible = false;` (draw layers always return a rect; refs return null when unloaded — same guard as before).
- Update the hint text to be layer-kind aware, e.g. `{activeKind === "ref" ? "Reference" : "Layer"}: drag to move · corners scale · top handle rotates`, and the Reset button stays (it already sets identity).

- [ ] **Step 2:** `npm run build` → 0/0 (watch unused imports). `npm test` → all pass.

- [ ] **Step 3: Manual** (`npm run dev`): with the Transform tool active and a drawing layer selected, the gizmo appears around the full canvas; corner-scale and rotate handles work; references still show/behave as before with any tool.

- [ ] **Step 4: Commit**
```bash
git add src/lib/RefTransformGizmo.svelte
git commit -m "feat: gizmo edits drawing-layer transforms under the Transform tool"
```

---

### Task 9: Canvas — input routing, draw-through-transform, selection deferral

**Files:**
- Modify: `src/lib/Canvas.svelte`

Build + manual.

- [ ] **Step 1: Generalize the transform-drag handler.** Rename `onRefTransform` → `onTransformDrag` and make it accept any layer with a transform; compute the base via `transformBaseRect`:
```ts
  function onTransformDrag(layer: Layer, points: { x: number; y: number }[], done: boolean) {
    const p = points[points.length - 1];
    const base = transformBaseRect(layer, state.project.width, state.project.height);
    if (!base) { if (done) refDrag = null; return; }
    if (!refDrag) {
      const tol = 10 / viewport.zoom;
      const gap = REF_ROTATE_GAP_PX / viewport.zoom;
      const handle = hitTestHandle(base, layer.transform, p, tol, gap);
      refDrag = { handle, start: p, startT: { ...layer.transform }, center: transformCenter(base, layer.transform) };
    }
    const d = refDrag;
    if (d.handle) {
      if (d.handle === "body") layer.transform = applyMove(d.startT, p.x - d.start.x, p.y - d.start.y);
      else if (d.handle === "rotate") layer.transform = applyRotate(d.startT, d.center, d.start, p);
      else layer.transform = applyScale(d.startT, d.center, d.start, p);
      bump();
    }
    if (done) refDrag = null;
  }
```
Import `transformBaseRect, isIdentityTransform, type Layer` from `../anim/document` and `inverseTransformPoint` from `../core/ref-transform` (add to existing imports). The `refDrag` type's `startT` becomes `Layer["transform"]`.

- [ ] **Step 2: Route input in `onStroke`.** Replace the head of `onStroke`:
```ts
  function onStroke(points: InputPoint[], done: boolean) {
    const al = activeLayer();
    if (al.kind === "ref" || (al.kind === "draw" && state.tool === "transform")) { onTransformDrag(al, points, done); return; }
    // Selection is disabled while the active draw layer is transformed (Apply first).
    if ((state.tool === "select" || state.tool === "lasso") && al.kind === "draw" && !isIdentityTransform(al.transform)) return;
    if (state.tool === "select" || state.tool === "lasso") { /* …existing select/lasso block unchanged… */ }
    /* …existing draw path unchanged… */
  }
```

- [ ] **Step 3: Draw through the transform.** In `paintStroke(pts, done)`, before the existing `const curved = …`, inverse-map when the active draw layer is transformed:
```ts
    const al = activeLayer();
    let inPts = pts;
    if (al.kind === "draw" && !isIdentityTransform(al.transform)) {
      const base = transformBaseRect(al, state.project.width, state.project.height)!;
      inPts = pts.map((p) => ({ ...p, ...inverseTransformPoint(base, al.transform, p) }));
    }
    const curved = inPts.map((p) => ({ ...p, pressure: pressureCurve.evaluate(p.pressure) }));
```
(`inverseTransformPoint` returns `{x,y}`; the spread keeps `pressure`/`timestamp`/`hasPressure`.) The live preview is automatically correct because `recomposite` now draws the active cell through the transform (Task 3).

- [ ] **Step 4: Fill through the transform.** In `doFill(pt)`, map the seed point first:
```ts
    const al = activeLayer();
    if (al.kind === "draw" && !isIdentityTransform(al.transform)) {
      const base = transformBaseRect(al, state.project.width, state.project.height)!;
      pt = inverseTransformPoint(base, al.transform, pt);
    }
```
(place at the top of `doFill`, before computing the keyframe/flood). Eraser uses the `paintStroke` path, so it's covered by Step 3.

- [ ] **Step 5:** `npm run build` → 0/0; `npm test` → all pass.

- [ ] **Step 6: Manual** (`npm run dev`): with the Transform tool, drag the body to move / corners to scale / top handle to rotate a drawing layer (all frames move together). Switch to brush/eraser/fill and paint — strokes land under the cursor on the transformed layer; the preview matches the committed pixels. Select/lasso are inert on a transformed layer (hint shows). References unaffected.

- [ ] **Step 7: Commit**
```bash
git add src/lib/Canvas.svelte
git commit -m "feat: transform drawing layers + draw/fill through the transform; defer selection"
```

---

### Task 10: LayerList — Apply / Reset buttons

**Files:**
- Modify: `src/lib/LayerList.svelte`

Build + manual.

- [ ] **Step 1: Imports** — add `applyLayerTransform, resetLayerTransform` to the `../state/appState.svelte` import; add `isIdentityTransform` to the `../anim/document` import; add lucide icons `Stamp, RotateCcw`.

- [ ] **Step 2: Buttons** — in the `layerRow` snippet's row-2 block (active layer), add, shown only for a transformed draw layer:
```svelte
        {#if layer.kind === "draw" && !isIdentityTransform(layer.transform)}
          <button class="text-text-muted hover:text-text-secondary" title="Apply transform (bake to pixels)"
                  onclick={(e) => { e.stopPropagation(); applyLayerTransform(layer.id); }}><Stamp size={13} /></button>
          <button class="text-text-muted hover:text-text-secondary" title="Reset transform"
                  onclick={(e) => { e.stopPropagation(); resetLayerTransform(layer.id); }}><RotateCcw size={13} /></button>
        {/if}
```

- [ ] **Step 3:** `npm run build` → 0/0; `npm test` → all pass.

- [ ] **Step 4: Manual** (`npm run dev`): transform a drawing layer → Apply (pixels unchanged on screen, transform back to identity, buttons disappear, select/lasso re-enabled) and Reset (placement discarded) both work and are single undo steps; merge-down of a transformed layer is pixel-correct.

- [ ] **Step 5: Commit**
```bash
git add src/lib/LayerList.svelte
git commit -m "feat: Apply/Reset transform buttons on the active drawing layer"
```

---

## Final verification

- [ ] `npm run build` → 0 errors, 0 warnings.
- [ ] `npm test` → all prior pass + new `document`/`ref-transform`/`render` tests; existing reference render tests stay green (the `drawReferenceMedia` refactor).
- [ ] Manual: transform tool + gizmo on a draw layer; paint/erase/fill through the transform; onion + playback boil + export show it transformed; Apply/Reset/merge; save-reload round-trip (and an old project loads at identity).

## Self-Review (completed by plan author)

**Spec coverage:** per-layer transform field + identity default (T1) ✅; `inverseTransformPoint` (T2) ✅; shared `drawTransformed`, identity fast-path, 2D + boil render (T3) ✅; onion (T4) ✅; persistence + back-compat (T5) ✅; Transform tool enum, Apply/Reset, merge-bake (T6) ✅; toolbar tool + selection hint (T7) ✅; gizmo for draw layers under the tool (T8) ✅; input routing + draw/fill through transform + selection deferral (T9) ✅; Apply/Reset UI (T10) ✅; tests on the node-testable pure units + render fast-path/sized distinction (T1–T3) ✅; out-of-scope items (per-frame, selection editing on transformed, lossless scale, custom cursor) absent ✅.

**Placeholder scan:** No TBD/TODO; each code step has concrete before/after. The two "verify the existing accessor name during implementation" notes (`activeLayer` export in T7; `Layer["transform"]` field) are guarded with explicit fallbacks, not placeholders.

**Type consistency:** `transform: RefTransform` (T1) read everywhere as `layer.transform`; `transformBaseRect(layer, W, H): {x,y,w,h}|null` (T1) used in render/gizmo/canvas; `drawTransformed(ctx, img, base, t, dpr)` (T3) called in render + onion (T4) + appState bake (T6); `inverseTransformPoint(base, t, p)` (T2) used in Canvas (T9); `isIdentityTransform` (T1) used in render/onion/appState/Toolbar/Canvas/LayerList; `applyLayerTransform`/`resetLayerTransform` (T6) called in LayerList (T10); `"transform"` tool (T6) read in Toolbar/Canvas/Gizmo. Consistent.
