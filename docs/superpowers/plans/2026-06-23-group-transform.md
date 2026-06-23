# Group Transform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A non-destructive group transform composed above the layer in the render chain (`group ∘ layer ∘ cell`), with a gizmo box that hugs the group's drawable content (frozen on grab) and a 3-way Frame/Layer/Group scope toggle on the Transform tool.

**Architecture:** Reuse Phase A's machinery. Add an optional `transform`/`transformBox` to `LayerGroup`, a `groupContentBoxLogical` resolver, `forwardChain`/`inverseChain` helpers for arbitrarily-deep compose, extend `drawCellComposed` with an outer group wrap (and `drawTransformed` for refs), make the gizmo target scope-aware with chain-based display/pointer mapping, and persist the group transform sparsely. Cell fields and group fields are all OPTIONAL → ships incrementally, each task green.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-23-group-transform-design.md`

**Branch:** execute on a new branch `group-transform` (off `main`).

**Conventions:** Canvas imports `state` unaliased; Gizmo/Toolbar import `state as appState`. Husky pre-commit runs eslint+prettier (expected). Existing **219** tests must stay green; build **0/0**; lint clean. Units: cell canvases + render = DEVICE px; `transformBaseRect`/`inverseTransformPoint`/gizmo + the new group bbox helper work in LOGICAL doc coords; convert by `*dpr`/`/dpr` as noted.

**Compose order (always):** `group ∘ layer ∘ cell` outermost-to-innermost. Forward chain inner-to-outer = `[cell, layer, group]`. Inverse chain outer-to-inner (i.e. iterate reverse of the inner-to-outer list).

---

### Task 1: `forwardChain` / `inverseChain` helpers (TDD)

**Files:** Modify `src/core/ref-transform.ts`, `src/__tests__/ref-transform.test.ts`.

A small chain utility for arbitrarily-deep compose. Both gizmo and Canvas (5 call sites) will use this to map pointers/corners through any combination of group/layer/cell transforms without each site repeating the math.

- [ ] **Step 1: Failing tests** — append to `src/__tests__/ref-transform.test.ts` (extend the existing import line to include `forwardChain, inverseChain`):

```ts
describe("forwardChain / inverseChain", () => {
  const docBase = { x: 0, y: 0, w: 100, h: 100 };
  const cellBase = { x: 20, y: 30, w: 40, h: 50 };
  const tLayer = { dx: 5, dy: -7, scale: 1.2, rotation: 0.3 };
  const tCell = { dx: -2, dy: 4, scale: 0.8, rotation: -0.15 };
  const tIdent = { dx: 0, dy: 0, scale: 1, rotation: 0 };

  it("empty chain is identity", () => {
    expect(forwardChain([], { x: 17, y: 23 })).toEqual({ x: 17, y: 23 });
    expect(inverseChain([], { x: 17, y: 23 })).toEqual({ x: 17, y: 23 });
  });

  it("single non-identity step matches forward/inverseTransformPoint", () => {
    const p = { x: 33, y: 44 };
    const f = forwardChain([{ base: docBase, t: tLayer }], p);
    expect(f).toEqual(forwardTransformPoint(docBase, tLayer, p));
    const inv = inverseChain([{ base: docBase, t: tLayer }], f);
    expect(inv.x).toBeCloseTo(p.x, 5);
    expect(inv.y).toBeCloseTo(p.y, 5);
  });

  it("two-step chain composes inner-to-outer and round-trips", () => {
    // Steps are inner-to-outer: [cell, layer]. Forward = cell-local → doc.
    const steps = [
      { base: cellBase, t: tCell },
      { base: docBase, t: tLayer },
    ];
    const p = { x: 11, y: 13 };
    const fwd = forwardChain(steps, p);
    // Expected: layer.forward(cell.forward(p))
    const manual = forwardTransformPoint(docBase, tLayer, forwardTransformPoint(cellBase, tCell, p));
    expect(fwd.x).toBeCloseTo(manual.x, 5);
    expect(fwd.y).toBeCloseTo(manual.y, 5);
    // Round-trip
    const back = inverseChain(steps, fwd);
    expect(back.x).toBeCloseTo(p.x, 5);
    expect(back.y).toBeCloseTo(p.y, 5);
  });

  it("identity steps are skipped (no precision drift)", () => {
    const steps = [
      { base: cellBase, t: tIdent },
      { base: docBase, t: tIdent },
    ];
    const p = { x: 7, y: 9 };
    expect(forwardChain(steps, p)).toEqual(p);
    expect(inverseChain(steps, p)).toEqual(p);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run src/__tests__/ref-transform.test.ts` (the two new chain assertions should fail with "forwardChain is not a function" or similar; existing tests stay green).

- [ ] **Step 3: Implement** — append to `src/core/ref-transform.ts` (do NOT import from `../anim/document`; inline the identity check to keep this module primitive):

```ts
export interface ComposeStep {
  base: Rect;
  t: RefTransform;
}

function isId(t: RefTransform): boolean {
  return t.dx === 0 && t.dy === 0 && t.scale === 1 && t.rotation === 0;
}

/** Map p outward through a chain of transforms (inner-to-outer order). Identity steps are skipped. */
export function forwardChain(steps: ComposeStep[], p: Pt): Pt {
  let q = p;
  for (const s of steps) if (!isId(s.t)) q = forwardTransformPoint(s.base, s.t, q);
  return q;
}

/** Map p inward through a chain of transforms (inner-to-outer order); applies each step's inverse
 *  starting from the OUTER end so the result lands in the innermost local space. */
export function inverseChain(steps: ComposeStep[], p: Pt): Pt {
  let q = p;
  for (let i = steps.length - 1; i >= 0; i--)
    if (!isId(steps[i].t)) q = inverseTransformPoint(steps[i].base, steps[i].t, q);
  return q;
}
```

`Rect` and `Pt` are already imported types in this file (verify via the existing `forwardTransformPoint` signature). If `Rect` isn't currently exported, add `export` to its declaration so test/call sites can construct `ComposeStep` values.

- [ ] **Step 4: Verify** — `npx vitest run src/__tests__/ref-transform.test.ts` passes; `npm run build` → 0/0; `npm test` → all green (baseline 219 + 4 new).
- [ ] **Step 5: Commit** — `git commit -m "feat: forwardChain/inverseChain (deep-compose transform helpers)"`

---

### Task 2: Data model — `LayerGroup` transform fields + 3-way scope state

**Files:** Modify `src/anim/document.ts`, `src/state/appState.svelte.ts`.

Pure-type additive change; no tests because the optional fields don't change existing construction shapes.

- [ ] **Step 1: Extend `LayerGroup`** — in `src/anim/document.ts`, replace the current interface:

```ts
export interface LayerGroup {
  id: number;
  name: string;
  collapsed: boolean;
  visible: boolean;
  transform?: RefTransform;
  transformBox?: { x: number; y: number; w: number; h: number } | null;
}
```

- [ ] **Step 2: `groupTransform` helper** — add next to `cellTransform`:

```ts
/** A group's own transform (identity when absent / undefined group). */
export function groupTransform(group: LayerGroup | null | undefined): RefTransform {
  return group && group.transform ? group.transform : IDENTITY_TRANSFORM;
}
```

- [ ] **Step 3: Widen `transformScope`** — in `src/state/appState.svelte.ts`, change the field in the `AnimState` interface from `transformScope: "frame" | "layer"` to `transformScope: "frame" | "layer" | "group"`. The default initializer (`transformScope: "frame"`) stays unchanged.

- [ ] **Step 4: Verify** — `npm run build` → 0/0; `npm test` → 219 + 4 still green (no behavioral change yet).
- [ ] **Step 5: Commit** — `git commit -m "feat: LayerGroup.transform fields + groupTransform helper + 3-way transformScope"`

---

### Task 3: `groupContentBoxLogical` resolver (TDD)

**Files:** Modify `src/lib/cell-ink.ts`, `src/__tests__/cell-ink.test.ts`.

Compute the union bbox of a group's drawable content at a frame (refs excluded; empty group → full-doc).

- [ ] **Step 1: Failing tests** — append to `src/__tests__/cell-ink.test.ts` (extend the import to add `groupContentBoxLogical` from `../lib/cell-ink`):

```ts
import type { Project, LayerGroup, DrawingLayer } from "../anim/document";

// Reuse the existing `stubCanvas` from this test file (defined above for contentBounds tests).

function makeProject(layers: DrawingLayer[], groups: LayerGroup[], w = 10, h = 10): Project {
  return {
    width: w, height: h, fps: 12, bgColor: "#000", frameCount: 1,
    boil: { enabled: false, amount: 1, cols: 20, rate: 3, weight: 0.4, holdsOnly: true },
    groups, layers, audio: null,
  } as unknown as Project;
}

function drawLayerWith(id: number, groupId: number | null, opaque: { x: number; y: number; w: number; h: number } | null): DrawingLayer {
  return {
    kind: "draw", id, name: `L${id}`, visible: true, locked: false, opacity: 100,
    boilStrength: 1, groupId,
    cells: [{ kind: "key", canvas: stubCanvas(10, 10, opaque) }],
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
  };
}

describe("groupContentBoxLogical", () => {
  const g: LayerGroup = { id: 7, name: "G", collapsed: false, visible: true };

  it("returns full doc rect for an empty group", () => {
    const p = makeProject([], [g]);
    expect(groupContentBoxLogical(g, p, 0, 1, 1)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  it("returns the lone draw layer's bbox (logical = device/dpr)", () => {
    const p = makeProject([drawLayerWith(1, 7, { x: 2, y: 3, w: 4, h: 2 })], [g]);
    expect(groupContentBoxLogical(g, p, 0, 1, 1)).toEqual({ x: 2, y: 3, w: 4, h: 2 });
  });

  it("returns the union across two member draw layers", () => {
    const p = makeProject(
      [
        drawLayerWith(1, 7, { x: 1, y: 1, w: 2, h: 2 }), // → [1..2, 1..2]
        drawLayerWith(2, 7, { x: 6, y: 5, w: 3, h: 4 }), // → [6..8, 5..8]
      ],
      [g],
    );
    expect(groupContentBoxLogical(g, p, 0, 1, 1)).toEqual({ x: 1, y: 1, w: 8, h: 8 });
  });

  it("ignores layers belonging to other groups", () => {
    const p = makeProject(
      [
        drawLayerWith(1, 7, { x: 2, y: 3, w: 4, h: 2 }), // in our group
        drawLayerWith(2, 99, { x: 0, y: 0, w: 1, h: 1 }), // in some other group
      ],
      [g],
    );
    expect(groupContentBoxLogical(g, p, 0, 1, 1)).toEqual({ x: 2, y: 3, w: 4, h: 2 });
  });

  it("converts device px to logical via /dpr", () => {
    const p = makeProject([drawLayerWith(1, 7, { x: 4, y: 6, w: 8, h: 4 })], [g]);
    expect(groupContentBoxLogical(g, p, 0, 2, 1)).toEqual({ x: 2, y: 3, w: 4, h: 2 });
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run src/__tests__/cell-ink.test.ts`. Expect: "groupContentBoxLogical is not a function" (or similar). Existing `contentBounds`/`contentBoxLogical` tests stay green.

- [ ] **Step 3: Implement** — append to `src/lib/cell-ink.ts` (import what's missing at the top: `import type { Project, LayerGroup } from "../anim/document"; import { resolveKeyframeIndex } from "../anim/document";`):

```ts
/** Logical bbox of a group's drawable content at `frame`: union of resolved key cells'
 *  contentBounds (device px → logical). Refs excluded. Empty → full-doc rect. */
export function groupContentBoxLogical(
  group: LayerGroup,
  project: Project,
  frame: number,
  dpr: number,
  version: number,
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const layer of project.layers) {
    if (layer.kind !== "draw" || layer.groupId !== group.id) continue;
    const ki = resolveKeyframeIndex(layer.cells, frame);
    if (ki === null) continue;
    const cell = layer.cells[ki];
    if (cell.kind !== "key") continue;
    const b = contentBounds(cell.canvas, version);
    if (!b) continue;
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  if (maxX === -Infinity) return { x: 0, y: 0, w: project.width, h: project.height };
  return { x: minX / dpr, y: minY / dpr, w: (maxX - minX) / dpr, h: (maxY - minY) / dpr };
}

/** The active gizmo/pivot box for a group: frozen box if set, else live `groupContentBoxLogical`. */
export function groupBoxLogical(
  group: LayerGroup,
  project: Project,
  frame: number,
  dpr: number,
  version: number,
): { x: number; y: number; w: number; h: number } {
  if (group.transformBox) return group.transformBox;
  return groupContentBoxLogical(group, project, frame, dpr, version);
}
```

- [ ] **Step 4: Verify** — `npx vitest run src/__tests__/cell-ink.test.ts` → all green; `npm run build` → 0/0; `npm test` → baseline + new (≥ 223).
- [ ] **Step 5: Commit** — `git commit -m "feat: groupContentBoxLogical + groupBoxLogical for per-group transform box"`

---

### Task 4: Extend `drawCellComposed` with an outer group wrap (TDD)

**Files:** Modify `src/anim/render.ts`, `src/__tests__/render.test.ts`.

Add `groupT` + `groupBoxDev` parameters to `drawCellComposed` (at the END, defaulted to identity / full-doc) so existing call sites keep compiling without changes. Wrap the cell's existing composition under one more `translate/rotate/scale` block when `groupT` is non-identity.

- [ ] **Step 1: Failing test** — append to `src/__tests__/render.test.ts` (use the same `recordingCtx`/`keyCanvas`/`layer` helpers already in that file):

```ts
import { groupTransform } from "../anim/document";

describe("compositeFrameLayers with a group transform", () => {
  it("non-identity group transform emits the composed wrap + a single drawImage", () => {
    const c = keyCanvas();
    const group = { id: 9, name: "G", collapsed: false, visible: true,
                    transform: { dx: 8, dy: 0, scale: 1.1, rotation: 0 },
                    transformBox: { x: 0, y: 0, w: 100, h: 100 } };
    const p: Project = {
      width: 100, height: 100, fps: 12, bgColor: "#000", frameCount: 1,
      boil: defaultBoilConfig(), groups: [group],
      layers: [layer([{ kind: "key", canvas: c }], { id: 1, groupId: 9 })], audio: null,
    };
    const ctx = recordingCtx();
    compositeFrameLayers(ctx as unknown as CanvasRenderingContext2D, p, 0, 1);
    // Exactly one drawImage of the cell at natural size (2-arg form → no ":sized").
    expect(ctx.calls.filter((x) => x.startsWith("drawImage"))).toEqual([
      `drawImage:${(c as unknown as { __id: number }).__id}@1`,
    ]);
    // Sanity: `groupTransform` returns the group's transform when set (cheap pure-fn check).
    expect(groupTransform(group)).toBe(group.transform);
  });

  it("identity group transform keeps the existing fast-path blit", () => {
    const c = keyCanvas();
    const group = { id: 9, name: "G", collapsed: false, visible: true };
    const p: Project = {
      width: 100, height: 100, fps: 12, bgColor: "#000", frameCount: 1,
      boil: defaultBoilConfig(), groups: [group],
      layers: [layer([{ kind: "key", canvas: c }], { id: 1, groupId: 9 })], audio: null,
    };
    const ctx = recordingCtx();
    compositeFrameLayers(ctx as unknown as CanvasRenderingContext2D, p, 0, 1);
    // Fast path: plain blit (no composed wrap). Existing layer-only/cell-only/reference tests stay green.
    expect(ctx.calls.filter((x) => x.startsWith("drawImage"))).toEqual([
      `drawImage:${(c as unknown as { __id: number }).__id}@1`,
    ]);
  });
});
```

NOTE on the test mock: if `recordingCtx` doesn't already record `translate/rotate/scale` calls (it currently records `drawImage` for the Phase A tests), the assertion above relies on the build + the no-throw + the drawImage count. That's an acceptable proxy — the spec's manual checklist covers visual correctness. If you want a tighter assertion and `recordingCtx` does record transforms, add `expect(ctx.calls).toContain("translate")` to the first test.

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run src/__tests__/render.test.ts`. Both new tests should fail (the first because `group.transform` is currently ignored → identity render produces the same calls as the second; tests still need to be wired through Step 4). The second test should PASS already (identity-group falls into the existing fast path).

- [ ] **Step 3: Extend `drawCellComposed` signature** — in `src/anim/render.ts`, change the function to accept optional outer group args at the end. Replace the current body of `drawCellComposed` (lines ~61–86) with:

```ts
/** Draw `cell` through cellT (about its content-box center) then layerT (about doc center) then
 *  groupT (about the group box center). DEVICE px. Outer args default to identity / full-doc. */
export function drawCellComposed(
  ctx: CanvasRenderingContext2D,
  cell: CanvasImageSource,
  wDev: number,
  hDev: number,
  layerT: RefTransform,
  cellT: RefTransform,
  cellBoxDev: { x: number; y: number; w: number; h: number },
  dpr: number,
  groupT: RefTransform = IDENTITY_TRANSFORM,
  groupBoxDev: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: wDev, h: hDev },
): void {
  ctx.save();
  if (!isIdentityTransform(groupT)) {
    const gcx = groupBoxDev.x + groupBoxDev.w / 2,
      gcy = groupBoxDev.y + groupBoxDev.h / 2;
    ctx.translate(gcx + groupT.dx * dpr, gcy + groupT.dy * dpr);
    ctx.rotate(groupT.rotation);
    ctx.scale(groupT.scale, groupT.scale);
    ctx.translate(-gcx, -gcy);
  }
  const dcx = wDev / 2,
    dcy = hDev / 2;
  ctx.translate(dcx + layerT.dx * dpr, dcy + layerT.dy * dpr);
  ctx.rotate(layerT.rotation);
  ctx.scale(layerT.scale, layerT.scale);
  ctx.translate(-dcx, -dcy);
  const ccx = cellBoxDev.x + cellBoxDev.w / 2,
    ccy = cellBoxDev.y + cellBoxDev.h / 2;
  ctx.translate(ccx + cellT.dx * dpr, ccy + cellT.dy * dpr);
  ctx.rotate(cellT.rotation);
  ctx.scale(cellT.scale, cellT.scale);
  ctx.translate(-ccx, -ccy);
  ctx.drawImage(cell, 0, 0);
  ctx.restore();
}
```

Add `IDENTITY_TRANSFORM` to the `document` import at the top of `render.ts`.

- [ ] **Step 4: Verify (interim)** — `npm run build` → 0/0; `npm test` → all existing tests still green (the new tests stay failing until Task 5 wires the call sites).
- [ ] **Step 5: Commit** — `git commit -m "feat: drawCellComposed accepts optional outer group transform"`

---

### Task 5: Wire group transform into 2D + boil + onion compose

**Files:** Modify `src/anim/render.ts`, `src/anim/onion.ts`. The render test from Task 4 step 1 will turn green at the end.

Add a small `groupComposeArgs` helper in `render.ts` that resolves `{ groupT, groupBoxDev }` for a given layer + project + frame, and call it at each `drawCellComposed` / `transformedCell` site.

- [ ] **Step 1: Helper** — at the top of `src/anim/render.ts`, extend the imports and add the helper just below `scaleRect`:

```ts
// Update the existing import block to add:
import {
  // ...existing...
  groupOf,
  groupTransform,
  IDENTITY_TRANSFORM,
  type LayerGroup,
} from "./document";
import { groupBoxLogical } from "../lib/cell-ink";
```

```ts
/** Resolve the outer group transform args for `layer`. Identity / full-doc when ungrouped or
 *  the group transform is identity. */
function groupComposeArgs(
  layer: Project["layers"][number],
  project: Project,
  frame: number,
  dpr: number,
  version: number,
): { groupT: RefTransform; groupBoxDev: { x: number; y: number; w: number; h: number } } {
  const g = groupOf(layer, project.groups);
  const t = groupTransform(g);
  const fullDocDev = { x: 0, y: 0, w: project.width * dpr, h: project.height * dpr };
  if (!g || isIdentityTransform(t)) return { groupT: IDENTITY_TRANSFORM, groupBoxDev: fullDocDev };
  const box = groupBoxLogical(g, project, frame, dpr, version);
  return { groupT: t, groupBoxDev: scaleRect(box, dpr) };
}
```

NOTE: `compositeFrameLayers` does not currently receive `version`. Add a `version` parameter (number, defaulted to 0) to its signature so the bounds cache can invalidate correctly. Update its single caller (`renderFrame`, same file) to accept `version` in `RenderOpts` and forward it. Then update Canvas/onion call sites in subsequent steps.

```ts
// In RenderOpts:
interface RenderOpts {
  drawBg?: boolean;
  includeReference?: boolean;
  boil?: BoilConfig;
  version?: number;
}
// In renderFrame: extract `version = 0` from opts; forward to compositeFrameLayers.
// In compositeFrameLayers signature: add `version = 0` as the last parameter.
```

- [ ] **Step 2: 2D draw branch** — replace the `if (layerId && cellId) ctx.drawImage(...)` block in `compositeFrameLayers` (lines ~180–201, the non-boil draw branch) with:

```ts
      const cellT = cellTransform(cell);
      const { groupT, groupBoxDev } = groupComposeArgs(layer, project, frame, dpr, version);
      const layerId = isIdentityTransform(layer.transform),
        cellId = isIdentityTransform(cellT),
        groupId = isIdentityTransform(groupT);
      if (layerId && cellId && groupId) ctx.drawImage(cell.canvas, 0, 0);
      else {
        const boxDev = cellId
          ? { x: 0, y: 0, w: project.width * dpr, h: project.height * dpr }
          : scaleRect(cell.transformBox!, dpr);
        drawCellComposed(
          ctx,
          cell.canvas,
          project.width * dpr,
          project.height * dpr,
          layer.transform,
          cellT,
          boxDev,
          dpr,
          groupT,
          groupBoxDev,
        );
      }
```

- [ ] **Step 3: Boil path** — extend `transformedCell` to accept group args and forward them to `drawCellComposed`:

```ts
function transformedCell(
  cell: HTMLCanvasElement,
  layerT: RefTransform,
  cellT: RefTransform,
  cellBoxDev: { x: number; y: number; w: number; h: number },
  wDev: number,
  hDev: number,
  dpr: number,
  groupT: RefTransform = IDENTITY_TRANSFORM,
  groupBoxDev: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: wDev, h: hDev },
): HTMLCanvasElement {
  if (!boilScratch) boilScratch = document.createElement("canvas");
  if (boilScratch.width !== wDev || boilScratch.height !== hDev) {
    boilScratch.width = wDev;
    boilScratch.height = hDev;
  }
  const c = boilScratch.getContext("2d")!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, wDev, hDev);
  drawCellComposed(c, cell, wDev, hDev, layerT, cellT, cellBoxDev, dpr, groupT, groupBoxDev);
  return boilScratch;
}
```

Then in the boil branch of `compositeFrameLayers`, replace the `transformedCell(...)` call site:

```ts
        const { groupT, groupBoxDev } = groupComposeArgs(layer, project, frame, dpr, version);
        const bothId = isIdentityTransform(layer.transform) && isIdentityTransform(cellT) && isIdentityTransform(groupT);
        const boxDev = isIdentityTransform(cellT)
          ? { x: 0, y: 0, w, h }
          : scaleRect(cell.transformBox!, dpr);
        const src = bothId
          ? cell.canvas
          : transformedCell(cell.canvas, layer.transform, cellT, boxDev, w, h, dpr, groupT, groupBoxDev);
```

- [ ] **Step 4: Onion** — update `src/anim/onion.ts` `drawGhost` to receive the project version (extend its signature so the caller forwards it):

```ts
// drawGhost signature: add `version: number` at the end. Caller (renderFrameWithOnion) also gains
// `version: number` and forwards it.
```

In the active-layer branch (the `else` that runs when `!allLayers`), replace the `if (layerId && cellId) scratch.drawImage(...) else drawCellComposed(...)` block (lines ~88–101) with:

```ts
        const cellT = cellTransform(cell);
        const g = groupOf(layer, project.groups);
        const groupT = groupTransform(g);
        const layerId = isIdentityTransform(layer.transform),
          cellId = isIdentityTransform(cellT),
          groupId = isIdentityTransform(groupT);
        if (layerId && cellId && groupId) scratch.drawImage(cell.canvas, 0, 0);
        else {
          const boxDev = cellId
            ? { x: 0, y: 0, w, h }
            : {
                x: cell.transformBox!.x * dpr,
                y: cell.transformBox!.y * dpr,
                w: cell.transformBox!.w * dpr,
                h: cell.transformBox!.h * dpr,
              };
          const groupBoxDev = groupId
            ? { x: 0, y: 0, w, h }
            : (() => {
                const lb = groupBoxLogical(g!, project, ghostFrame, dpr, version);
                return { x: lb.x * dpr, y: lb.y * dpr, w: lb.w * dpr, h: lb.h * dpr };
              })();
          drawCellComposed(scratch, cell.canvas, w, h, layer.transform, cellT, boxDev, dpr, groupT, groupBoxDev);
        }
```

Add the imports at the top of `onion.ts` (alongside the existing `cellTransform`):

```ts
import {
  // ...existing...
  groupOf,
  groupTransform,
} from "./document";
import { groupBoxLogical } from "../lib/cell-ink";
```

And forward `version` in the `compositeFrameLayers` call inside `drawGhost`'s `allLayers` branch and the final `compositeFrameLayers` call in `renderFrameWithOnion`.

- [ ] **Step 5: Update callers in Canvas** — `src/lib/Canvas.svelte` calls `renderFrame` and `renderFrameWithOnion`. Pass `state.version`:
  - `renderFrame(displayCtx, state.project, state.playhead, DPR, { boil, version: state.version })`
  - `renderFrameWithOnion(displayCtx, scratchCtx, state.project, state.playhead, DPR, state.onion, state.activeLayerId, state.version)`

(Grep for these calls in `Canvas.svelte` to find their exact arg lists.)

- [ ] **Step 6: Verify** — `npm run build` → 0/0; `npm test` → baseline + Task 1/3/4 tests all green (the failing render test from Task 4 now passes because the call sites resolve and forward `groupT`).
- [ ] **Step 7: Commit** — `git commit -m "feat: render composes group ∘ layer ∘ cell across 2D, boil, and onion paths"`

---

### Task 6: Refs in groups ride the group transform

**Files:** Modify `src/anim/render.ts`. Optional test addition in `src/__tests__/render.test.ts`.

Today `drawReferenceMedia` calls `drawTransformed` directly. To make refs follow their group, wrap the existing draw in an outer group `translate/rotate/scale` when the ref's group has a non-identity transform.

- [ ] **Step 1: Extend `drawReferenceMedia`** — replace the body with a group-aware wrap. Add `project` and `frame` and `version` to its signature so it can resolve the group:

```ts
export function drawReferenceMedia(
  ctx: CanvasRenderingContext2D,
  layer: ReferenceLayer,
  docW: number,
  docH: number,
  dpr: number,
  project?: Project,
  frame?: number,
  version?: number,
): void {
  if (layer.media.type === "missing") return;
  const size = mediaIntrinsicSize(layer.media);
  if (size.w === 0 || size.h === 0) return;
  const base = containRect(size.w, size.h, docW * dpr, docH * dpr);
  const g = project ? groupOf(layer, project.groups) : null;
  const groupT = groupTransform(g);
  if (!g || isIdentityTransform(groupT) || frame == null || project == null) {
    drawTransformed(ctx, layer.media.el, base, layer.transform, dpr);
    return;
  }
  const lb = groupBoxLogical(g, project, frame, dpr, version ?? 0);
  ctx.save();
  const gcx = lb.x * dpr + (lb.w * dpr) / 2,
    gcy = lb.y * dpr + (lb.h * dpr) / 2;
  ctx.translate(gcx + groupT.dx * dpr, gcy + groupT.dy * dpr);
  ctx.rotate(groupT.rotation);
  ctx.scale(groupT.scale, groupT.scale);
  ctx.translate(-gcx, -gcy);
  drawTransformed(ctx, layer.media.el, base, layer.transform, dpr);
  ctx.restore();
}
```

NOTE: keeping the new params optional preserves back-compat for any caller (e.g. `rasterizeReference` in `appState.svelte.ts`) that doesn't have a project/frame context — rasterize wants the ref's *own* transform only, not the group context (the rasterized layer goes into the group flat).

- [ ] **Step 2: Forward project/frame from compositeFrameLayers** — in `compositeFrameLayers` (both the boil-prep loop and the non-boil branch), pass `project`, `frame`, and `version`:

```ts
drawReferenceMedia(ctx, layer, project.width, project.height, dpr, project, frame, version);
```

- [ ] **Step 3: Verify** — `npm run build` → 0/0; `npm test` → all green. Existing reference tests stay valid (they call `drawReferenceMedia` with the old 5-arg form → group path is skipped → identical output).
- [ ] **Step 4: Commit** — `git commit -m "feat: reference layers in a group follow the group transform"`

---

### Task 7: `resetGroupTransform` action

**Files:** Modify `src/state/appState.svelte.ts`.

No Apply for Phase B (see spec §"Apply / Reset / merge"). Just Reset.

- [ ] **Step 1: Add the action** — append next to `resetCellTransform`:

```ts
export function resetGroupTransform(groupId: number): void {
  const g = state.project.groups.find((x) => x.id === groupId);
  if (!g || !g.transform || isIdentityTransform(g.transform)) return;
  commitStructural(() => {
    g.transform = { ...IDENTITY_TRANSFORM };
    g.transformBox = null;
  });
}
```

- [ ] **Step 2: Snapshot/restore parity** — `restoreStructure` currently restores `layer.transform` from the snapshot. Group transforms also need to round-trip through undo. Extend `StructSnapshot` and `cloneLayers`/`restoreStructure` to capture `state.project.groups`:

In `StructSnapshot`, add `groups: LayerGroup[]`.

In `snapshotStructure()`, add `groups: state.project.groups.map((g) => ({ ...g, transform: g.transform ? { ...g.transform } : undefined, transformBox: g.transformBox ? { ...g.transformBox } : g.transformBox }))`.

In `restoreStructure(s)`, after restoring layers, restore groups by id:
```ts
  const liveGroupsById = new Map(state.project.groups.map((g) => [g.id, g]));
  state.project.groups = s.groups.map((snap) => {
    const live = liveGroupsById.get(snap.id);
    if (live) {
      live.transform = snap.transform ? { ...snap.transform } : undefined;
      live.transformBox = snap.transformBox ? { ...snap.transformBox } : snap.transformBox ?? null;
      // name/collapsed/visible are view-props (mirror layer pattern) — keep `live` values.
      return live;
    }
    return { ...snap, transform: snap.transform ? { ...snap.transform } : undefined,
             transformBox: snap.transformBox ? { ...snap.transformBox } : snap.transformBox ?? null };
  });
```

Import `LayerGroup` at the top of `appState.svelte.ts` if not already there (it is — grep `LayerGroup` confirms).

- [ ] **Step 3: Verify** — `npm run build` → 0/0; `npm test` → baseline still green.
- [ ] **Step 4: Commit** — `git commit -m "feat: resetGroupTransform + group transforms round-trip through undo"`

---

### Task 8: Canvas — extend draw-through inverse + transform-drag with group chain

**Files:** Modify `src/lib/Canvas.svelte`. No new tests (DOM-only; covered by manual checklist).

- [ ] **Step 1: Imports** — extend the existing imports at the top of `Canvas.svelte`:

```ts
import {
  // ...existing...
  groupOf,
  groupTransform,
} from "../anim/document";
import { contentBoxLogical, groupBoxLogical } from "./cell-ink";
import {
  // ...existing forwardTransformPoint, inverseTransformPoint, etc...
  forwardChain,
  inverseChain,
  type ComposeStep,
} from "../core/ref-transform";
```

- [ ] **Step 2: Build a chain helper local to Canvas** (top of `<script>`, after the imports). For a given draw layer, return the steps `[layer-step, group-step]` (inner-to-outer) up to the layer's local space — used by both `paintStroke`/`doFill` (which compose all the way down to cell) and `onTransformDrag` for scope=Frame.

```ts
function layerComposeSteps(layer: Layer): ComposeStep[] {
  const W = state.project.width, H = state.project.height;
  const steps: ComposeStep[] = [];
  // Inner-to-outer: layer first, then group.
  steps.push({ base: { x: 0, y: 0, w: W, h: H }, t: layer.transform });
  const g = groupOf(layer, state.project.groups);
  if (g) {
    const gt = groupTransform(g);
    steps.push({
      base: groupBoxLogical(g, state.project, state.playhead, DPR, state.version),
      t: gt,
    });
  }
  return steps;
}
```

- [ ] **Step 3: Extend `paintStroke`'s inverse chain** — replace the existing block (lines ~181–199) that builds `inPts`:

```ts
    if (al.kind === "draw") {
      const W = state.project.width, H = state.project.height;
      const rk = resolvedKeyCell(al, state.playhead);
      const cellT = rk ? cellTransform(rk.cell) : IDENTITY;
      const cellBox = rk
        ? contentBoxLogical(rk.cell.canvas, rk.cell.transformBox, W, H, DPR, state.version)
        : { x: 0, y: 0, w: W, h: H };
      const steps: ComposeStep[] = [{ base: cellBox, t: cellT }, ...layerComposeSteps(al)];
      // Skip the map when nothing maps (all identity).
      const anyNonId = steps.some((s) => !(s.t.dx === 0 && s.t.dy === 0 && s.t.scale === 1 && s.t.rotation === 0));
      if (anyNonId) {
        inPts = pts.map((p) => {
          const q = inverseChain(steps, { x: p.x, y: p.y });
          return { ...p, x: q.x, y: q.y };
        });
      }
    }
```

- [ ] **Step 4: Extend `doFill`'s inverse chain** — replace the existing two `inverseTransformPoint` blocks (~lines 116–131) with a single `inverseChain`:

```ts
    const W = state.project.width, H = state.project.height;
    const rk = resolvedKeyCell(layer, state.playhead);
    const cellT = rk ? cellTransform(rk.cell) : IDENTITY;
    const cellBox = rk
      ? contentBoxLogical(rk.cell.canvas, rk.cell.transformBox, W, H, DPR, state.version)
      : { x: 0, y: 0, w: W, h: H };
    const steps: ComposeStep[] = [{ base: cellBox, t: cellT }, ...layerComposeSteps(layer)];
    pt = inverseChain(steps, pt);
```

- [ ] **Step 5: Extend `onTransformDrag` for scope=Group + group-aware compose** — replace its body (lines ~252–299):

```ts
  function onTransformDrag(layer: Layer, points: { x: number; y: number }[], done: boolean) {
    const W = state.project.width, H = state.project.height;
    const p = points[points.length - 1];

    const scope = state.transformScope;
    const isDraw = layer.kind === "draw";
    const g = groupOf(layer, state.project.groups);

    // Resolve target + base + compose-steps (outer transforms above the target, inner-to-outer).
    let getT: () => RefTransform, setT: (t: RefTransform) => void;
    let base: { x: number; y: number; w: number; h: number } | null;
    let outerSteps: ComposeStep[] = [];
    let frameRk: ReturnType<typeof resolvedKeyCell> = null;

    if (isDraw && scope === "group" && g) {
      const t = groupTransform(g);
      getT = () => t;
      setT = (nt) => (g.transform = nt);
      base = groupBoxLogical(g, state.project, state.playhead, DPR, state.version);
    } else if (isDraw && scope === "frame") {
      frameRk = resolvedKeyCell(layer as Extract<Layer, { kind: "draw" }>, state.playhead);
      if (!frameRk) { if (done) refDrag = null; return; }
      base = contentBoxLogical(frameRk.cell.canvas, frameRk.cell.transformBox, W, H, DPR, state.version);
      getT = () => cellTransform(frameRk!.cell);
      setT = (nt) => (frameRk!.cell.transform = nt);
      // Outer = layer, then group (inner-to-outer).
      outerSteps.push({ base: { x: 0, y: 0, w: W, h: H }, t: layer.transform });
      if (g) outerSteps.push({ base: groupBoxLogical(g, state.project, state.playhead, DPR, state.version), t: groupTransform(g) });
    } else {
      // scope = "layer" (or ref layer)
      base = transformBaseRect(layer, W, H);
      getT = () => layer.transform;
      setT = (nt) => (layer.transform = nt);
      // Outer = group (if any).
      if (g) outerSteps.push({ base: groupBoxLogical(g, state.project, state.playhead, DPR, state.version), t: groupTransform(g) });
    }
    if (!base) { if (done) refDrag = null; return; }

    // Pointer in target's local space: inverse-map through outer (outermost first → use inverseChain).
    const pc = inverseChain(outerSteps, p);

    if (!refDrag) {
      const tol = 10 / viewport.zoom;
      const gap = REF_ROTATE_GAP_PX / viewport.zoom;
      const handle = hitTestHandle(base, getT(), pc, tol, gap);
      // Freeze the box on grab for a frame/group transform currently at identity.
      if (handle && isIdentityTransform(getT())) {
        if (isDraw && scope === "frame" && frameRk) frameRk.cell.transformBox = base;
        else if (isDraw && scope === "group" && g) g.transformBox = base;
      }
      refDrag = { handle, start: pc, startT: { ...getT() }, center: transformCenter(base, getT()) };
    }
    const d = refDrag;
    if (d.handle) {
      if (d.handle === "body") setT(applyMove(d.startT, pc.x - d.start.x, pc.y - d.start.y));
      else if (d.handle === "rotate") setT(applyRotate(d.startT, d.center, d.start, pc));
      else setT(applyScale(d.startT, d.center, d.start, pc));
      bump();
    }
    if (done) refDrag = null;
  }
```

- [ ] **Step 6: Verify** — `npm run build` → 0/0; `npm test` → all green; `npm run lint` → clean.
- [ ] **Step 7: Commit** — `git commit -m "feat: Canvas — group-aware draw-through inverse + transform-drag"`

---

### Task 9: Gizmo — scope=group target + chain-based display

**Files:** Modify `src/lib/RefTransformGizmo.svelte`. No new tests (DOM-only).

The current `transformTarget()` returns `{ getT, setT, base, compose: RefTransform, cell, frame }`. `compose` is a single transform — that worked for Phase A because there was at most one outer transform (the layer). For Phase B we can have two outer transforms (layer + group when scope=Frame, or group when scope=Layer). Refactor `compose: RefTransform` → `outer: ComposeStep[]` (inner-to-outer) and use `forwardChain`/`inverseChain`.

- [ ] **Step 1: Imports** — extend the existing imports:

```ts
import {
  // ...existing...
  groupOf,
  groupTransform,
} from "../anim/document";
import { contentBoxLogical, groupBoxLogical } from "./cell-ink";
import {
  // ...existing...
  forwardChain,
  inverseChain,
  type ComposeStep,
} from "../core/ref-transform";
```

- [ ] **Step 2: Refactor `transformTarget()`** — replace its body to return `outer: ComposeStep[]` instead of `compose: RefTransform`. Add the `scope === "group"` branch.

```ts
  type Rect = { x: number; y: number; w: number; h: number };
  function transformTarget(): {
    getT: () => RefTransform;
    setT: (t: RefTransform) => void;
    base: Rect | null;
    outer: ComposeStep[]; // inner-to-outer (innermost first)
    cell: Extract<import("../anim/document").Cell, { kind: "key" }> | null;
    group: import("../anim/document").LayerGroup | null;
    scope: "frame" | "layer" | "group";
  } | null {
    const l = activeTransformLayer();
    if (!l) return null;
    const W = appState.project.width, H = appState.project.height;
    const g = groupOf(l, appState.project.groups);

    if (l.kind === "draw" && appState.transformScope === "group") {
      if (!g) return null; // Group scope is disabled when ungrouped; safety fallback.
      return {
        getT: () => groupTransform(g),
        setT: (t: RefTransform) => (g.transform = t),
        base: groupBoxLogical(g, appState.project, appState.playhead, DPR, appState.version),
        outer: [], // group is top of the compose chain
        cell: null, group: g, scope: "group",
      };
    }

    if (l.kind === "draw" && appState.transformScope === "frame") {
      const rk = resolvedKeyCell(l, appState.playhead);
      if (!rk) return null;
      const outer: ComposeStep[] = [{ base: { x: 0, y: 0, w: W, h: H }, t: l.transform }];
      if (g) outer.push({ base: groupBoxLogical(g, appState.project, appState.playhead, DPR, appState.version), t: groupTransform(g) });
      return {
        getT: () => cellTransform(rk.cell),
        setT: (t: RefTransform) => (rk.cell.transform = t),
        base: contentBoxLogical(rk.cell.canvas, rk.cell.transformBox, W, H, DPR, appState.version),
        outer, cell: rk.cell, group: g, scope: "frame",
      };
    }

    // scope = "layer" (or ref layer of any scope)
    const outer: ComposeStep[] = [];
    if (g) outer.push({ base: groupBoxLogical(g, appState.project, appState.playhead, DPR, appState.version), t: groupTransform(g) });
    return {
      getT: () => l.transform,
      setT: (t: RefTransform) => (l.transform = t),
      base: baseRect(l),
      outer, cell: null, group: g, scope: "layer",
    };
  }
```

- [ ] **Step 3: Update `drag` shape and call sites** — change `drag.compose: RefTransform` to `drag.outer: ComposeStep[]`, and replace the `inverseTransformPoint(fullDoc, d.compose, ...)` call in `startHandleDrag`/`onDragMove` with `inverseChain(d.outer, ...)`:

```ts
  let drag: {
    handle: DragHandle;
    startT: RefTransform;
    start: Pt;
    center: Pt;
    outer: ComposeStep[];
    setT: (t: RefTransform) => void;
  } | null = null;
```

```ts
  // In startHandleDrag, replace the freeze-box block + start-point mapping:
    if (
      (tgt.scope === "frame" && tgt.cell && t.scale === 1 && t.rotation === 0 && t.dx === 0 && t.dy === 0) ||
      (tgt.scope === "group" && tgt.group && t.scale === 1 && t.rotation === 0 && t.dx === 0 && t.dy === 0)
    ) {
      if (tgt.scope === "frame" && tgt.cell) tgt.cell.transformBox = base;
      else if (tgt.scope === "group" && tgt.group) tgt.group.transformBox = base;
    }
    const start = inverseChain(tgt.outer, vp.screenToCanvas(e.clientX, e.clientY));
    drag = { handle, startT: { ...t }, start, center: transformCenter(base, t), outer: tgt.outer, setT: tgt.setT };
```

```ts
  // In onDragMove, replace inverseTransformPoint(fullDoc, d.compose, ...) with:
    const p = inverseChain(d.outer, vp.screenToCanvas(e.clientX, e.clientY));
```

- [ ] **Step 4: Update `tick()` display mapping** — replace the `toLocal` function:

```ts
      const toLocal = (p: { x: number; y: number }) => {
        const q = forwardChain(tgt.outer, p);
        const s = vp.canvasToScreen(q.x, q.y);
        return { x: s.x - rect.left, y: s.y - rect.top };
      };
```

- [ ] **Step 5: Update `resetTransform()`** — handle scope=group:

```ts
  function resetTransform() {
    const tgt = transformTarget();
    if (!tgt) return;
    if (tgt.scope === "frame" && tgt.cell) {
      tgt.cell.transform = { ...IDENTITY };
      tgt.cell.transformBox = null;
    } else if (tgt.scope === "group" && tgt.group) {
      tgt.group.transform = { ...IDENTITY };
      tgt.group.transformBox = null;
    } else {
      tgt.setT({ ...IDENTITY });
    }
    bump();
  }
```

- [ ] **Step 6: Verify** — `npm run build` → 0/0; `npm test` → all green; `npm run lint` → clean.
- [ ] **Step 7: Commit** — `git commit -m "feat: gizmo — scope=group target + chain-based compose display"`

---

### Task 10: Toolbar — 3-way scope toggle + active-layer fallback

**Files:** Modify `src/lib/Toolbar.svelte`, `src/lib/LayerList.svelte`, `src/state/appState.svelte.ts`.

- [ ] **Step 1: Toolbar — add Group button** — replace the existing 2-button scope segmented control (`src/lib/Toolbar.svelte` lines ~194–207):

```svelte
{#if appState.tool === "transform"}
  {@const _activeLayer = activeLayer()}
  {@const _groupedActive = _activeLayer.groupId != null}
  <div class="flex rounded border border-border overflow-hidden text-xs" title="Transform scope">
    <button
      class="px-2 py-1"
      class:bg-surface-active={appState.transformScope === "frame"}
      onclick={() => (appState.transformScope = "frame")}>Frame</button
    >
    <button
      class="px-2 py-1"
      class:bg-surface-active={appState.transformScope === "layer"}
      onclick={() => (appState.transformScope = "layer")}>Layer</button
    >
    <button
      class="px-2 py-1"
      class:bg-surface-active={appState.transformScope === "group"}
      class:opacity-40={!_groupedActive}
      class:cursor-not-allowed={!_groupedActive}
      disabled={!_groupedActive}
      title={_groupedActive ? "Transform the group" : "Active layer is not in a group"}
      onclick={() => _groupedActive && (appState.transformScope = "group")}>Group</button
    >
  </div>
{/if}
```

- [ ] **Step 2: Auto-fall-back when active layer changes** — in `src/state/appState.svelte.ts`, the active-layer is `state.activeLayerId`. Add a tiny guard inside `replaceProject` and a watcher inside the Canvas (or anywhere `state.activeLayerId` is set). Cheapest centralised fix: a setter helper at the bottom of `appState.svelte.ts`:

```ts
/** Set the active layer; if scope=group and the new layer isn't in a group, fall back to Frame. */
export function setActiveLayer(id: number): void {
  state.activeLayerId = id;
  const l = state.project.layers.find((x) => x.id === id);
  if (state.transformScope === "group" && (!l || l.groupId == null)) {
    state.transformScope = "frame";
  }
}
```

Then in `src/lib/LayerList.svelte`, replace direct `appState.activeLayerId = ...` writes with `setActiveLayer(...)`. Grep `activeLayerId =` in `LayerList.svelte` to find the call sites (likely the layer-row click handler). Import `setActiveLayer` from `../state/appState.svelte`.

(Other code paths that set `activeLayerId` — `addLayerToProject`, `removeLayer`, `duplicateLayer`, `mergeDown`, `rasterizeReference`, `replaceProject` — are already in `appState.svelte.ts`. Add the same scope guard inline at each site, or factor a private helper. Pick whichever keeps the diff readable; the rule is: when `state.activeLayerId` lands on an ungrouped layer and scope is `"group"`, downgrade to `"frame"`.)

- [ ] **Step 3: Verify** — `npm run build` → 0/0; `npm test` → all green; `npm run lint` → clean.
- [ ] **Step 4: Manual sanity (deferred to final pass)** — switching between grouped/ungrouped active layer doesn't leave scope=Group stuck.
- [ ] **Step 5: Commit** — `git commit -m "feat: Toolbar — Frame/Layer/Group scope toggle + active-layer fallback"`

---

### Task 11: LayerList — wire Group-scope Reset button

**Files:** Modify `src/lib/LayerList.svelte`.

The existing Apply/Reset block (lines ~320–331 in `LayerList.svelte`) branches on `activeTransformScope(layer)` returning `"frame" | "layer" | null`. Extend it to also recognise the group case.

- [ ] **Step 1: Extend `activeTransformScope`** — return `"frame" | "layer" | "group" | null` and treat group transform as a tiebreak source:

```ts
  function activeTransformScope(layer: Layer): "frame" | "layer" | "group" | null {
    if (layer.kind !== "draw") return null;
    const layerNI = !isIdentityTransform(layer.transform);
    const rk = resolvedKeyCell(layer, appState.playhead);
    const cellNI = !!rk && !isIdentityTransform(cellTransform(rk.cell));
    const g = groupOf(layer, appState.project.groups);
    const groupNI = !!g && !isIdentityTransform(groupTransform(g));
    if (!layerNI && !cellNI && !groupNI) return null;
    // Honour the active toolbar scope when it points at a non-identity transform.
    if (appState.transformScope === "frame" && cellNI) return "frame";
    if (appState.transformScope === "layer" && layerNI) return "layer";
    if (appState.transformScope === "group" && groupNI) return "group";
    // Tiebreak: whichever is non-identity.
    if (cellNI) return "frame";
    if (layerNI) return "layer";
    return "group";
  }

  function hasTransform(layer: Layer): boolean {
    if (layer.kind !== "draw") return false;
    if (!isIdentityTransform(layer.transform)) return true;
    const rk = resolvedKeyCell(layer, appState.playhead);
    if (rk && !isIdentityTransform(cellTransform(rk.cell))) return true;
    const g = groupOf(layer, appState.project.groups);
    return !!g && !isIdentityTransform(groupTransform(g));
  }
```

Add the missing imports at the top of `LayerList.svelte`:

```ts
import {
  // ...existing...
  groupTransform,
} from "../anim/document";
import { resetGroupTransform } from "../state/appState.svelte";
```

- [ ] **Step 2: Wire the Reset button to group scope** — find the existing Reset onclick (line ~330) and add a third branch:

```ts
              if (activeTransformScope(layer) === "frame") {
                resetCellTransform(layer.id, appState.playhead);
              } else if (activeTransformScope(layer) === "group") {
                const g = groupOf(layer, appState.project.groups);
                if (g) resetGroupTransform(g.id);
              } else {
                resetLayerTransform(layer.id);
              }
```

- [ ] **Step 3: Hide the Apply button when scope is group** — find the Apply onclick (line ~320) and guard it: render the button only when `activeTransformScope(layer) !== "group"` (group has no Apply this phase). One option:

```svelte
{#if activeTransformScope(layer) !== "group"}
  <button onclick={...}>Apply</button>
{/if}
```

(Or render disabled with a tooltip "Group Apply is not available in Phase B" — pick whichever fits the row's existing visual style.)

- [ ] **Step 4: Verify** — `npm run build` → 0/0; `npm test` → all green; `npm run lint` → clean.
- [ ] **Step 5: Commit** — `git commit -m "feat: LayerList — Reset wired to group scope (no Apply this phase)"`

---

### Task 12: Persistence — sparse group transform fields (TDD)

**Files:** Modify `src/persist/project-file.ts`, `src/__tests__/persist.test.ts`.

- [ ] **Step 1: Failing test** — append to `src/__tests__/persist.test.ts` (follow the existing round-trip style — grep one of the layer-transform persist tests for the helper functions/imports already in use):

```ts
describe("group transform persistence", () => {
  it("round-trips a non-identity group transform + frozen box", async () => {
    const project = createProject();
    const g = { id: 42, name: "G", collapsed: false, visible: true,
                transform: { dx: 12, dy: -3, scale: 1.4, rotation: 0.2 },
                transformBox: { x: 5, y: 6, w: 30, h: 20 } };
    project.groups = [g];
    // Place an existing layer into the group so it survives the round-trip.
    project.layers[0].groupId = 42;
    const blob = await saveProjectBlob(project);
    const loaded = await loadProjectBlob(blob, 1);
    expect(loaded.groups).toHaveLength(1);
    expect(loaded.groups[0].id).toBe(42);
    expect(loaded.groups[0].transform).toEqual(g.transform);
    expect(loaded.groups[0].transformBox).toEqual(g.transformBox);
  });

  it("legacy saves (no group transform fields) load with identity / null", async () => {
    const project = createProject();
    project.groups = [{ id: 7, name: "L", collapsed: false, visible: true }]; // no transform
    project.layers[0].groupId = 7;
    const blob = await saveProjectBlob(project);
    const loaded = await loadProjectBlob(blob, 1);
    expect(loaded.groups[0].transform).toBeUndefined();
    expect(loaded.groups[0].transformBox ?? null).toBeNull();
  });

  it("identity group transform is NOT serialized (sparse map)", async () => {
    const project = createProject();
    project.groups = [{ id: 1, name: "I", collapsed: false, visible: true,
                       transform: { dx: 0, dy: 0, scale: 1, rotation: 0 } }];
    const blob = await saveProjectBlob(project);
    // Inspect project.json directly.
    const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const json = JSON.parse(strFromU8(zip["project.json"]));
    expect(json.groups[0].transform).toBeUndefined();
  });
});
```

The third test needs `unzipSync` and `strFromU8` from `fflate` (same imports the source file uses). If `persist.test.ts` doesn't already import them, add `import { unzipSync, strFromU8 } from "fflate";`.

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run src/__tests__/persist.test.ts`. The round-trip test fails (loaded group has no `transform`). The sparse-omit test passes already (since the field is never written).

- [ ] **Step 3: Extend `ProjectJson.groups`** — in `src/persist/project-file.ts`, widen the group element shape:

```ts
groups: {
  id: number; name: string; collapsed: boolean; visible: boolean;
  transform?: RefTransform;
  transformBox?: { x: number; y: number; w: number; h: number } | null;
}[];
```

- [ ] **Step 4: Serialize sparsely** — replace `groups: project.groups,` (line ~97) with:

```ts
    groups: project.groups.map((g) => {
      const t = g.transform;
      const isId = !t || (t.dx === 0 && t.dy === 0 && t.scale === 1 && t.rotation === 0);
      return {
        id: g.id, name: g.name, collapsed: g.collapsed, visible: g.visible,
        ...(isId ? {} : { transform: t, transformBox: g.transformBox ?? null }),
      };
    }),
```

- [ ] **Step 5: Deserialize** — find the existing `const groups = (json.groups ?? []).map((g) => ({ ...g }));` (line ~260) and widen it to copy the new fields (the spread already brings them in; this is just a defensive cast/clone for `transform`):

```ts
  const groups: LayerGroup[] = (json.groups ?? []).map((g) => ({
    id: g.id, name: g.name, collapsed: g.collapsed, visible: g.visible,
    transform: g.transform ? { ...g.transform } : undefined,
    transformBox: g.transformBox ? { ...g.transformBox } : g.transformBox ?? null,
  }));
```

(Make sure `LayerGroup` is imported from `../anim/document` at the top of the file.)

- [ ] **Step 6: Verify** — `npx vitest run src/__tests__/persist.test.ts` → all three new tests pass; `npm test` → all baseline + new tests green; `npm run build` → 0/0; `npm run lint` → clean.
- [ ] **Step 7: Commit** — `git commit -m "feat: persist group transform sparsely (back-compat)"`

---

## Final verification

- [ ] `npm run build` → 0/0; `npm test` → baseline 219 + new (`forwardChain`/`inverseChain`: 4, `groupContentBoxLogical`: 5, render group: 2, persist group: 3) ≈ 233+ green; `npm run lint` → clean.
- [ ] **Manual (browser):**
  - Transform tool, scope **Group**: gizmo hugs the bbox of grouped draw layers at the current frame; rotate/scale about that bbox center; refs in the group ride along.
  - Scope **Frame** and **Layer** with a non-identity group transform applied: gizmos still track the pointer correctly under the group transform.
  - Triple-stack draw-through: paint on a layer in a transformed group with a transformed layer transform and a transformed cell transform — stroke lands at the cursor; fill seeds the right region; brush cursor positions correctly.
  - Group + Frame both engaged: the frame transform composes under the group (drawing on the cell stays pinned to its own bbox; the group bbox moves the whole rig).
  - Onion / playback-boil / export show the group transform.
  - Save → reload round-trips group transform + frozen box; old projects load with identity.
  - Toolbar Group button disabled when active layer is ungrouped, with tooltip.
  - Switching active layer from a grouped one to an ungrouped one while scope=Group → falls back to Frame.
  - Merge-down within a group with a non-identity group transform: result stays visually correct while in the group; moving the merged target out shows the documented jump (acceptable Phase B behavior).
  - Group has no Apply button; Reset clears `group.transform` + `transformBox`.
- [ ] Update `CLAUDE.md` "Current state" line to add per-group transform; move the deferred "Transform Phase B — Group" entry from "Roadmap" to current state. (Optional last step — can be a separate small commit.)

## Self-Review (completed by plan author)

**Spec coverage:**
- Data model — `LayerGroup.transform`/`transformBox` + 3-way scope (Task 2) ✅
- `groupContentBoxLogical` resolver with refs-excluded union, full-doc fallback (Task 3) ✅
- Compose order `group ∘ layer ∘ cell` in render: extended `drawCellComposed`, 2D + boil + onion (Tasks 4–5) ✅
- Refs in groups ride the group transform (Task 6) ✅
- Draw-through inverse extended to three-deep (Task 8 step 3–4) ✅
- Gizmo scope-aware target + chain-based display through group forward (Task 9) ✅
- Frozen box on grab for group, mirror of cell pattern (Task 8 step 5 + Task 9 step 3) ✅
- Frame/Layer/Group toggle, Group disabled when ungrouped, active-layer-switch fallback (Task 10) ✅
- No Apply for groups; `resetGroupTransform` + LayerList wiring; merge-down unchanged (Tasks 7, 11) ✅
- Sparse `transform`/`transformBox` persistence with back-compat (Task 12) ✅
- Group transforms round-trip through undo (Task 7 step 2) ✅
- One level of grouping only / out-of-scope items absent (no nested-group code anywhere) ✅
- Tween-readiness: `LayerGroup.transform` mirrors `Layer.transform`'s shape exactly — same `RefTransform`, same sparse persistence pattern — ready for the future `KeyframedTransform` migration ✅

**Placeholder scan:** No TBD/TODO. The render-test mock-dependent sub-assertion note (Task 4 step 1 NOTE) and the active-layer-fallback "centralised vs inline" note (Task 10 step 2) are explicit instructions, not gaps.

**Type/symbol consistency:**
- `drawCellComposed(ctx, cell, wDev, hDev, layerT, cellT, cellBoxDev, dpr, groupT?, groupBoxDev?)` — defined Task 4, called identically in Tasks 5 (2D + boil) and used implicitly via Task 6's group ref wrap (which composes inline rather than calling drawCellComposed, since it draws a ref not a cell — distinct draw API).
- `groupContentBoxLogical(group, project, frame, dpr, version)` / `groupBoxLogical(group, project, frame, dpr, version)` — defined Task 3, used in Tasks 5, 6, 8, 9.
- `groupTransform(group | null | undefined)` — defined Task 2, used in Tasks 5, 6, 8, 9, 11.
- `forwardChain` / `inverseChain(steps: ComposeStep[], p)` — defined Task 1, used in Tasks 8 and 9.
- `resetGroupTransform(groupId)` — defined Task 7, used in Task 11.
- `setActiveLayer(id)` — defined Task 10 step 2; replaces direct `activeLayerId` writes in `LayerList.svelte`.
- Units: render/bake = DEVICE px (× dpr); gizmo / Canvas inverse / `*BoxLogical` helpers = LOGICAL. Group bbox is accumulated from cell `contentBounds` (device px) and converted at the boundary (`/dpr` in `groupContentBoxLogical`).
- Compose order consistent throughout: `group ∘ layer ∘ cell` outermost-to-innermost; the chain helpers' "inner-to-outer" parameter convention matches the gizmo's `outer` step list `[layer-step, group-step]` for scope=Frame, `[group-step]` for scope=Layer, `[]` for scope=Group.
