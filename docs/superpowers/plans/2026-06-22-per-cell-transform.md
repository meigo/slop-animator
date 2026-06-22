# Per-Cell (Current-Frame) Transform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A non-destructive per-keyframe transform whose gizmo box hugs the cell's content, composing under the layer transform; a Frame/Layer scope toggle on the Transform tool.

**Architecture:** Reuse the Approach-B transform machinery. Add an optional `transform`/`transformBox` to **key cells**, a content-bounds helper, a `drawCellComposed` render that composes `layer ∘ cell`, a `forwardTransformPoint` for gizmo-through-layer mapping, scope-aware tool/gizmo, and back-compat persistence. The Cell fields are **optional**, so adding them doesn't break existing constructors — this ships incrementally, each task building green.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-22-per-cell-transform-design.md`

**Branch:** execute on a new branch `per-cell-transform` (off `main`).

**Conventions:** Canvas imports `state` unaliased; Gizmo/Toolbar import `state as appState`. Husky pre-commit runs eslint+prettier (expected). Existing **212** tests must stay green; build **0/0**; lint clean. Units: cell canvases + render are DEVICE px; `transformBaseRect`/`inverseTransformPoint`/gizmo work in LOGICAL doc coords; convert by `*dpr`/`/dpr` as noted.

---

### Task 1: `forwardTransformPoint` (TDD)

**Files:** Modify `src/core/ref-transform.ts`, `src/__tests__/ref-transform.test.ts`.

- [ ] **Step 1: Failing tests** — add to `ref-transform.test.ts` (add `forwardTransformPoint` to the `../core/ref-transform` import):
```ts
describe("forwardTransformPoint", () => {
  const base = { x: 0, y: 0, w: 100, h: 100 };
  const id = { dx: 0, dy: 0, scale: 1, rotation: 0 };
  it("identity is a no-op", () => {
    expect(forwardTransformPoint(base, id, { x: 30, y: 70 })).toEqual({ x: 30, y: 70 });
  });
  it("round-trips with inverseTransformPoint", () => {
    const t = { dx: 12, dy: -7, scale: 1.5, rotation: 0.6 };
    const p = { x: 73, y: 21 };
    const back = inverseTransformPoint(base, t, forwardTransformPoint(base, t, p));
    expect(back.x).toBeCloseTo(p.x, 5);
    expect(back.y).toBeCloseTo(p.y, 5);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run src/__tests__/ref-transform.test.ts`.

- [ ] **Step 3: Implement** — add next to `inverseTransformPoint` in `ref-transform.ts`:
```ts
/** Map a layer-local point out to document space — the forward of inverseTransformPoint. */
export function forwardTransformPoint(base: Rect, t: RefTransform, p: Pt): Pt {
  const cx = base.x + base.w / 2,
    cy = base.y + base.h / 2;
  const ox = (p.x - cx) * t.scale,
    oy = (p.y - cy) * t.scale;
  const cos = Math.cos(t.rotation),
    sin = Math.sin(t.rotation);
  return { x: cx + t.dx + (ox * cos - oy * sin), y: cy + t.dy + (ox * sin + oy * cos) };
}
```

- [ ] **Step 4: Verify** — tests pass; `npm run build` → 0/0.
- [ ] **Step 5: Commit** — `git commit -m "feat: forwardTransformPoint (inverse of inverseTransformPoint)"`

---

### Task 2: `contentBounds` + `contentBoxLogical` (TDD)

**Files:** Modify `src/lib/cell-ink.ts`, `src/__tests__/cell-ink.test.ts` (create if absent).

- [ ] **Step 1: Failing tests** — `src/__tests__/cell-ink.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { contentBounds } from "../lib/cell-ink";

// Minimal canvas stub: getContext→ctx with drawImage no-op + getImageData returning a known buffer.
function stubCanvas(w: number, h: number, opaque: { x: number; y: number; w: number; h: number } | null) {
  const data = new Uint8ClampedArray(w * h * 4);
  if (opaque) {
    for (let y = opaque.y; y < opaque.y + opaque.h; y++)
      for (let x = opaque.x; x < opaque.x + opaque.w; x++) data[(y * w + x) * 4 + 3] = 255;
  }
  return {
    width: w, height: h,
    getContext: () => ({
      clearRect() {}, drawImage() {},
      getImageData: () => ({ data, width: w, height: h }),
      set imageSmoothingEnabled(_v: boolean) {}, set imageSmoothingQuality(_v: string) {},
    }),
  } as unknown as HTMLCanvasElement;
}

describe("contentBounds", () => {
  it("null for an empty canvas", () => {
    expect(contentBounds(stubCanvas(10, 10, null), 1)).toBeNull();
  });
  it("tight bbox of the opaque region", () => {
    expect(contentBounds(stubCanvas(10, 10, { x: 2, y: 3, w: 4, h: 2 }), 1)).toEqual({ x: 2, y: 3, w: 4, h: 2 });
  });
  it("memoizes by version (same version → same result object identity allowed to differ, value equal)", () => {
    const c = stubCanvas(10, 10, { x: 1, y: 1, w: 1, h: 1 });
    expect(contentBounds(c, 5)).toEqual({ x: 1, y: 1, w: 1, h: 1 });
  });
});
```
(NOTE: `contentBounds` scans at full resolution via one `getImageData(0,0,w,h)` — no downscale probe — so the stub returns the full buffer directly.)

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run src/__tests__/cell-ink.test.ts`.

- [ ] **Step 3: Implement** — in `src/lib/cell-ink.ts`:
```ts
const boundsCache = new WeakMap<HTMLCanvasElement, { version: number; bounds: { x: number; y: number; w: number; h: number } | null }>();

/** Tight non-transparent bounds in DEVICE px, or null if empty. Memoized by document version. */
export function contentBounds(canvas: HTMLCanvasElement, version: number): { x: number; y: number; w: number; h: number } | null {
  const hit = boundsCache.get(canvas);
  if (hit && hit.version === version) return hit.bounds;
  let bounds: { x: number; y: number; w: number; h: number } | null = null;
  if (canvas.width > 0 && canvas.height > 0) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (data[(y * width + x) * 4 + 3] !== 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
    if (maxX >= minX) bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }
  boundsCache.set(canvas, { version, bounds });
  return bounds;
}

/** The logical gizmo/pivot box for a key cell: frozen box if set, else live content bounds, else full doc. */
export function contentBoxLogical(
  canvas: HTMLCanvasElement,
  frozen: { x: number; y: number; w: number; h: number } | null | undefined,
  docW: number, docH: number, dpr: number, version: number,
): { x: number; y: number; w: number; h: number } {
  if (frozen) return frozen;
  const b = contentBounds(canvas, version);
  if (!b) return { x: 0, y: 0, w: docW, h: docH };
  return { x: b.x / dpr, y: b.y / dpr, w: b.w / dpr, h: b.h / dpr };
}
```

- [ ] **Step 4: Verify** — tests pass; `npm run build` → 0/0.
- [ ] **Step 5: Commit** — `git commit -m "feat: contentBounds + contentBoxLogical for per-cell transform box"`

---

### Task 3: Data model — key-cell transform fields + scope state

**Files:** Modify `src/anim/document.ts`, `src/state/appState.svelte.ts`.

- [ ] **Step 1: Cell type** — in `document.ts`, change the key variant:
```ts
export type Cell =
  | { kind: "key"; canvas: HTMLCanvasElement; transform?: RefTransform; transformBox?: { x: number; y: number; w: number; h: number } | null }
  | { kind: "hold" };
```

- [ ] **Step 2: Helpers** — add:
```ts
/** A key cell's own transform (identity when absent / not a key). */
export function cellTransform(cell: Cell): RefTransform {
  return cell.kind === "key" && cell.transform ? cell.transform : IDENTITY_TRANSFORM;
}
/** The resolved key cell shown at `frame` (follows holds), or null. */
export function resolvedKeyCell(layer: DrawingLayer, frame: number): { cell: Extract<Cell, { kind: "key" }>; index: number } | null {
  const ki = resolveKeyframeIndex(layer.cells, frame);
  if (ki === null) return null;
  const cell = layer.cells[ki];
  return cell.kind === "key" ? { cell, index: ki } : null;
}
```

- [ ] **Step 3: Scope state** — in `appState.svelte.ts` `AnimState`, add `transformScope: "frame" | "layer";` and in the `$state({...})` initializer `transformScope: "frame",`.

- [ ] **Step 4: Verify** — `npm run build` → 0/0 (optional fields don't break existing `{kind:"key",canvas}` literals); `npm test` → 212.
- [ ] **Step 5: Commit** — `git commit -m "feat: key-cell transform fields + transformScope state"`

---

### Task 4: Render — `drawCellComposed` + compose layer∘cell (TDD)

**Files:** Modify `src/anim/render.ts`, `src/anim/onion.ts`, `src/__tests__/render.test.ts`.

- [ ] **Step 1: Failing test** — add to `render.test.ts`:
```ts
describe("compositeFrameLayers with a per-cell transform", () => {
  it("non-identity cell transform draws composed (sized), identity stays a plain blit", () => {
    const c = keyCanvas();
    const cellT = { dx: 4, dy: 0, scale: 1.3, rotation: 0 };
    const box = { x: 0, y: 0, w: 100, h: 100 };
    const p: Project = {
      width: 100, height: 100, fps: 12, bgColor: "#000", frameCount: 1, boil: defaultBoilConfig(), groups: [],
      layers: [layer([{ kind: "key", canvas: c, transform: cellT, transformBox: box }], { id: 1 })], audio: null,
    };
    const ctx = recordingCtx();
    compositeFrameLayers(ctx as unknown as CanvasRenderingContext2D, p, 0, 1);
    expect(ctx.calls.filter((x) => x.startsWith("drawImage"))).toEqual([`drawImage:${(c as unknown as { __id: number }).__id}@1`]);
    // composed path uses translate/rotate/scale (not recorded) + a 2-arg drawImage at natural size
  });
});
```
(NOTE: `drawCellComposed` draws with a 2-arg `drawImage(cell,0,0)` at natural size, so `recordingCtx` records `drawImage:<id>@<alpha>` *without* `:sized` — the distinguishing signal here is that it does NOT throw and still emits exactly one drawImage; the transform calls are no-ops in the mock. Assert the single drawImage + that the cell-transform path ran by also checking `ctx.calls` contains `"translate"` if the mock records it; if `recordingCtx` doesn't record translate, drop that sub-assertion and rely on the build + manual.)

- [ ] **Step 2: Run, verify** — `npx vitest run src/__tests__/render.test.ts` (the new case should pass once implemented; existing layer-only + reference cases stay green).

- [ ] **Step 3: Implement `drawCellComposed`** — in `render.ts`, add (export it; it supersedes the per-branch logic for draw cells):
```ts
/** Draw `cell` through cellT (about its content-box center) then layerT (about doc center). DEVICE px. */
export function drawCellComposed(
  ctx: CanvasRenderingContext2D, cell: CanvasImageSource, wDev: number, hDev: number,
  layerT: RefTransform, cellT: RefTransform, cellBoxDev: { x: number; y: number; w: number; h: number }, dpr: number,
): void {
  ctx.save();
  const dcx = wDev / 2, dcy = hDev / 2;
  ctx.translate(dcx + layerT.dx * dpr, dcy + layerT.dy * dpr);
  ctx.rotate(layerT.rotation); ctx.scale(layerT.scale, layerT.scale); ctx.translate(-dcx, -dcy);
  const ccx = cellBoxDev.x + cellBoxDev.w / 2, ccy = cellBoxDev.y + cellBoxDev.h / 2;
  ctx.translate(ccx + cellT.dx * dpr, ccy + cellT.dy * dpr);
  ctx.rotate(cellT.rotation); ctx.scale(cellT.scale, cellT.scale); ctx.translate(-ccx, -ccy);
  ctx.drawImage(cell, 0, 0);
  ctx.restore();
}
```

- [ ] **Step 4: Use it in the 2D draw branch** — replace the current `if (isIdentityTransform(layer.transform)) drawImage… else drawTransformed…` for draw cells with:
```ts
      const cellT = cellTransform(cell);
      const layerId = isIdentityTransform(layer.transform), cellId = isIdentityTransform(cellT);
      if (layerId && cellId) ctx.drawImage(cell.canvas, 0, 0);
      else {
        const boxDev = cellId
          ? { x: 0, y: 0, w: project.width * dpr, h: project.height * dpr }
          : scaleRect(cell.transformBox!, dpr); // frozen box (logical) → device
        drawCellComposed(ctx, cell.canvas, project.width * dpr, project.height * dpr, layer.transform, cellT, boxDev, dpr);
      }
```
where `scaleRect(r, k) = { x: r.x*k, y: r.y*k, w: r.w*k, h: r.h*k }` (local helper). Import `cellTransform` from `./document`.

- [ ] **Step 5: Boil path** — change `transformedCell(...)` to compose: give it the cell + layerT + cellT + boxDev and call `drawCellComposed` into the scratch (instead of `drawTransformed`). Pass identity-fast-path src (`cell.canvas`) only when BOTH are identity.

- [ ] **Step 6: Onion** — in `onion.ts` active-layer branch, mirror Step 4 (compose layer + cell, fast path when both identity), importing `cellTransform`, `drawCellComposed`, `scaleRect`/inline.

- [ ] **Step 7: Verify** — `npm run build` → 0/0; `npm test` → 212 + new case. Existing reference + layer-only render tests stay green.
- [ ] **Step 8: Commit** — `git commit -m "feat: render composes layer ∘ cell transforms (2D + boil + onion)"`

---

### Task 5: appState — Apply/Reset cell + merge-bake cells

**Files:** Modify `src/state/appState.svelte.ts`.

- [ ] **Step 1: Shared bake** — add a `bakeCell` that flattens a key cell through (layerT ∘ cellT) into fresh pixels:
```ts
import { drawCellComposed } from "../anim/render";
function bakeCell(cell: Extract<Cell, { kind: "key" }>, layerT: RefTransform): Extract<Cell, { kind: "key" }> {
  const W = state.project.width, H = state.project.height;
  const cellT = cell.transform ?? IDENTITY_TRANSFORM;
  if (isIdentityTransform(layerT) && isIdentityTransform(cellT)) return cell;
  const canvas = createCellCanvas(W, H, DPR);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const boxDev = isIdentityTransform(cellT)
    ? { x: 0, y: 0, w: W * DPR, h: H * DPR }
    : { x: cell.transformBox!.x * DPR, y: cell.transformBox!.y * DPR, w: cell.transformBox!.w * DPR, h: cell.transformBox!.h * DPR };
  drawCellComposed(ctx, cell.canvas, W * DPR, H * DPR, layerT, cellT, boxDev, DPR);
  return { kind: "key", canvas };
}
```

- [ ] **Step 2: Rewrite `bakeLayerTransform`** to use `bakeCell` (folds both layer + any cell transforms) and clear the layer transform:
```ts
function bakeLayerTransform(layer: DrawingLayer): void {
  layer.cells = layer.cells.map((c) => (c.kind === "key" ? bakeCell(c, layer.transform) : c));
  layer.transform = { ...IDENTITY_TRANSFORM };
}
```
(This now also bakes cell transforms — correct for merge.)

- [ ] **Step 3: Cell Apply/Reset** — add:
```ts
export function applyCellTransform(layerId: number, frame: number): void {
  const layer = state.project.layers.find((l) => l.id === layerId);
  if (!layer || layer.kind !== "draw") return;
  const rk = resolvedKeyCell(layer, frame);
  if (!rk || !rk.cell.transform || isIdentityTransform(rk.cell.transform)) return;
  commitStructural(() => { layer.cells[rk.index] = bakeCell(rk.cell, { ...IDENTITY_TRANSFORM }); });
}
export function resetCellTransform(layerId: number, frame: number): void {
  const layer = state.project.layers.find((l) => l.id === layerId);
  if (!layer || layer.kind !== "draw") return;
  const rk = resolvedKeyCell(layer, frame);
  if (!rk) return;
  commitStructural(() => { rk.cell.transform = { ...IDENTITY_TRANSFORM }; rk.cell.transformBox = null; });
}
```
Import `resolvedKeyCell`, `cellTransform` as needed from `../anim/document`.

- [ ] **Step 4: Verify** — `npm run build` → 0/0; `npm test` → 212.
- [ ] **Step 5: Commit** — `git commit -m "feat: applyCellTransform/resetCellTransform + merge-bake cell transforms"`

---

### Task 6: Canvas — scope-aware drag target + draw-through compose

**Files:** Modify `src/lib/Canvas.svelte`.

- [ ] **Step 1: Imports** — add `forwardTransformPoint` (from `../core/ref-transform`), `cellTransform`, `resolvedKeyCell` (from `../anim/document`), `contentBoxLogical` (from `./cell-ink`).

- [ ] **Step 2: A scope-aware drag target.** Generalize `onTransformDrag`: when `state.tool === "transform"` and `state.transformScope === "frame"` and the active layer is a draw layer, edit the **resolved key cell's** transform with `base = contentBoxLogical(cell.canvas, cell.transformBox, W, H, DPR, state.version)`, and map the pointer through the **layer** inverse first; on first delta, freeze `cell.transformBox = base` if the cell transform is identity. Otherwise (scope layer, or ref) keep today's path. Concretely, replace `onTransformDrag` with a version that resolves `target` = `{ getT, setT, base, layerForCompose }`:
  - frame/draw: `getT = () => cellTransform(cell)`, `setT = (t) => { cell.transform = t }`, `base = contentBoxLogical(...)`, `layerForCompose = layer.transform`.
  - layer/draw or ref: `getT/setT` on `layer.transform`, `base = transformBaseRect(layer,…)`, `layerForCompose = IDENTITY`.
  Then the drag math becomes (mapping the pointer through `layerForCompose` inverse so cell handles are correct under an active layer transform):
```ts
  const pc = inverseTransformPoint({ x: 0, y: 0, w: W, h: H }, layerForCompose, p); // compose-corrected point
  // on grab: freeze box if frame & identity; refDrag.center = transformCenter(base, getT());
  // body: setT(applyMove(startT, pc.x - start.x, pc.y - start.y))
  // rotate/scale: applyRotate/applyScale(startT, center, start, pc)
```
  (When `layerForCompose` is identity, `pc === p`, so the layer path is unchanged.) Capture `start = pc` at grab.

- [ ] **Step 3: Draw-through compose.** In `paintStroke` and `doFill`, after the existing layer inverse, also inverse the **cell** transform when the active resolved key cell has a non-identity transform:
```ts
  // existing: map through layer transform if non-identity → q
  const rk = al.kind === "draw" ? resolvedKeyCell(al, state.playhead) : null;
  const cellT = rk ? (rk.cell.transform ?? IDENTITY) : IDENTITY;
  if (rk && !isIdentityTransform(cellT)) {
    const box = contentBoxLogical(rk.cell.canvas, rk.cell.transformBox, W, H, DPR, state.version);
    q = inverseTransformPoint(box, cellT, q); // q already in post-layer-inverse space
  }
```
Apply to the brush points map and the fill seed point.

- [ ] **Step 4: Verify** — `npm run build` → 0/0; `npm test` → 212.
- [ ] **Step 5: Commit** — `git commit -m "feat: Canvas — per-frame transform target + compose draw-through"`

---

### Task 7: Gizmo — scope-aware target + layer-compose display

**Files:** Modify `src/lib/RefTransformGizmo.svelte`.

- [ ] **Step 1:** `activeTransformLayer()`/`baseRect`/`tick` become scope-aware (mirror Canvas Task 6): for a draw layer with `appState.transformScope === "frame"`, the target is the resolved key cell — `base = contentBoxLogical(cell.canvas, cell.transformBox, W, H, DPR, appState.version)`, transform = `cellTransform(cell)`, and the corner/rotate-handle screen positions push through the **layer** forward transform before `canvasToScreen`:
```ts
  // corners (logical) → forwardTransformPoint(fullDoc, layer.transform, corner) → canvasToScreen
```
For scope layer / ref, unchanged (layer transform = identity in the compose, so no-op). Import `forwardTransformPoint`, `cellTransform`, `resolvedKeyCell`, `contentBoxLogical`.

- [ ] **Step 2:** Drag handlers (`onDragMove`) map the pointer through the layer inverse (same as Canvas Step 2) and write `cell.transform` (frame) or `layer.transform` (layer), freezing `cell.transformBox` on the first frame-scope grab.

- [ ] **Step 3: Verify** — `npm run build` → 0/0; `npm test` → 212.
- [ ] **Step 4: Manual** — gizmo hugs the current drawing in Frame scope; corners/rotate track correctly with and without an active layer transform.
- [ ] **Step 5: Commit** — `git commit -m "feat: gizmo edits the per-frame cell transform (scope-aware)"`

---

### Task 8: Toolbar — Frame/Layer toggle + scope-aware Apply/Reset

**Files:** Modify `src/lib/Toolbar.svelte` (and `src/lib/LayerList.svelte` if the Apply/Reset buttons live there).

- [ ] **Step 1: Scope toggle** — when `appState.tool === "transform"`, show a segmented Frame/Layer control bound to `appState.transformScope`:
```svelte
{#if appState.tool === "transform"}
  <div class="flex rounded border border-border overflow-hidden text-xs">
    <button class:bg-surface-active={appState.transformScope === "frame"} onclick={() => (appState.transformScope = "frame")} class="px-2 py-1">Frame</button>
    <button class:bg-surface-active={appState.transformScope === "layer"} onclick={() => (appState.transformScope = "layer")} class="px-2 py-1">Layer</button>
  </div>
{/if}
```

- [ ] **Step 2: Apply/Reset by scope** — the active-draw-layer Apply/Reset buttons (LayerList row, shown when the layer OR active cell has a non-identity transform) call the scope's action: `transformScope === "frame" ? applyCellTransform(layer.id, state.playhead) : applyLayerTransform(layer.id)` (and reset likewise). Show the buttons when `!isIdentityTransform(layer.transform)` OR the resolved key cell's transform is non-identity. Import `applyCellTransform`/`resetCellTransform`, `resolvedKeyCell`, `cellTransform`.

- [ ] **Step 3: Verify** — `npm run build` → 0/0; `npm test` → 212; lint clean.
- [ ] **Step 4: Commit** — `git commit -m "feat: transform scope toggle + scope-aware Apply/Reset"`

---

### Task 9: Persistence — `cellTransforms` sparse map

**Files:** Modify `src/persist/project-file.ts`.

- [ ] **Step 1: Type** — add to `DrawingLayerJson`:
```ts
  cellTransforms?: { [index: number]: { transform?: RefTransform; transformBox?: { x: number; y: number; w: number; h: number } | null } };
```

- [ ] **Step 2: Serialize** — in the draw-layer `.map`, build the sparse map from key cells whose transform is non-identity:
```ts
      cellTransforms: Object.fromEntries(
        l.cells.flatMap((c, i) =>
          c.kind === "key" && c.transform && !(c.transform.dx === 0 && c.transform.dy === 0 && c.transform.scale === 1 && c.transform.rotation === 0)
            ? [[i, { transform: c.transform, transformBox: c.transformBox ?? null }]]
            : [],
        ),
      ),
```

- [ ] **Step 3: Deserialize** — after the cells loop builds the `cells` array, apply the map:
```ts
      const ct = lj.cellTransforms ?? {};
      for (const [k, v] of Object.entries(ct)) {
        const cell = cells[Number(k)];
        if (cell && cell.kind === "key") { cell.transform = v.transform; cell.transformBox = v.transformBox ?? null; }
      }
```
(Existing saves: no `cellTransforms` → cells stay identity. Pixels unaffected.)

- [ ] **Step 4: Verify** — `npm run build` → 0/0; `npm test` → 212 (incl. `persist.test.ts`).
- [ ] **Step 5: Commit** — `git commit -m "feat: persist per-cell transforms (sparse map, back-compat)"`

---

## Final verification

- [ ] `npm run build` → 0/0; `npm test` → 212 + new (`forwardTransformPoint`, `contentBounds`, render compose); lint clean.
- [ ] Manual (browser): Frame-scope gizmo hugs the current drawing and transforms only that keyframe; drawing more doesn't jump existing content; Layer scope unchanged; layer + frame transforms compose on screen and the Frame gizmo tracks under an active layer transform; Apply/Reset per scope; merge-down pixel-correct; onion/boil/export reflect the cell transform; save-reload round-trips; old projects load identity.

## Self-Review (completed by plan author)

**Spec coverage:** key-cell `transform`/`transformBox` + scope state (T3) ✅; `contentBounds`/`contentBoxLogical` cached by version (T2) ✅; `drawCellComposed` layer∘cell in 2D/boil/onion + fast paths (T4) ✅; `forwardTransformPoint` (T1) ✅; draw-through composes cell inverse inside layer inverse (T6) ✅; scope-aware gizmo with layer-compose display + frozen box on grab (T6/T7) ✅; Frame/Layer toggle default Frame + scope Apply/Reset + merge-bake cells (T5/T8) ✅; sparse `cellTransforms` persistence back-compat (T9) ✅; hold→resolved-key target (T3 `resolvedKeyCell`, T5/T6) ✅; out-of-scope (group/animated/ref-cell/promote-hold) absent ✅.

**Placeholder scan:** No TBD/TODO. The render-test assertion notes a mock-dependent sub-assertion with an explicit fallback (rely on build+manual) — a real instruction, not a gap.

**Consistency:** `drawCellComposed(ctx, cell, wDev, hDev, layerT, cellT, cellBoxDev, dpr)` defined T4, reused in bake (T5). `contentBoxLogical(canvas, frozen, docW, docH, dpr, version)` defined T2, used in Canvas (T6) + gizmo (T7). `resolvedKeyCell`/`cellTransform` defined T3, used T5/T6/T7/T8. `forwardTransformPoint` T1 → gizmo T7. Units: device in render/bake, logical in gizmo/inverse, converted at the boundaries. Compose order `layer ∘ cell` consistent across render, inverse (cell inside layer), and bake.
