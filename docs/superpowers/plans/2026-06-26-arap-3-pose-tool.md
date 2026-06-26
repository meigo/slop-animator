# Pose Tool Implementation Plan (ARAP/Pose tool part 3/3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `"pose"` tool: lift a drawing → triangulate → pin handles → pose via geodesic-MLS → bake. Wires parts 1–2 into a usable feature.

**Architecture:** A new `MeshPose` (`src/core/mesh-pose.ts`) holds the lifted raster + silhouette mesh (doc coords) + pinned handles; geodesic distances/weights cached per handle-set, the closed-form kernel + a per-triangle raster blit run per drag. Canvas drives lift/bake/undo (reusing the Deform tool's `selCtx`/`selBefore`/`liftPixels`) and renders the deformed mesh into the overlay. A new `poseWeights` (geodesic.ts) makes the cached path testable; `drawTriangle` is exported from `selection.ts` for reuse.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-26-arap-3-pose-tool-design.md`

**Branch:** execute on a new branch `arap-3-pose-tool` (off `main`).

**Conventions:** Canvas imports `state` unaliased; Toolbar/SelectionActions import `state as appState`. Husky pre-commit runs eslint+prettier (expected). Build **0/0**; lint clean; baseline **262** must not drop. Reused: `triangulateSilhouette`/`Mesh`/`Pt` (`triangulate.ts`), `geodesicDistances`/`deformMeshGeodesic`/`MeshHandle` (`geodesic.ts`), `mlsRigidWeighted`/`Pt` (`mls.ts`), `drawTriangle`/`SelectionRect`/`liftPixels`/`onCommit` pattern (`selection.ts`/`Canvas.svelte`).

---

### Task 1: `poseWeights` (geodesic.ts) — cacheable geodist→weights (TDD)

**Files:** Modify `src/core/geodesic.ts`, `src/__tests__/geodesic.test.ts`.

- [ ] **Step 1: Failing tests** — append to `geodesic.test.ts`:
```ts
import { poseWeights } from "../core/geodesic";
import { mlsRigidWeighted } from "../core/mls";

describe("poseWeights", () => {
  const mesh: Mesh = {
    vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }],
    triangles: [tri(0, 1, 2), tri(1, 3, 2)],
  };
  it("a handle vertex gets Infinity weight (exact placement), others finite", () => {
    const { from, weights } = poseWeights(mesh, [0]);
    expect(from).toEqual([mesh.vertices[0]]);
    expect(weights[0][0]).toBe(Infinity); // vertex 0 is handle 0
    expect(Number.isFinite(weights[3][0])).toBe(true);
  });
  it("composes to the same result as deformMeshGeodesic", () => {
    const handles = [{ vertex: 0, to: { x: 2, y: 3 } }];
    const { from, weights } = poseWeights(mesh, handles.map((h) => h.vertex));
    const viaPose = mlsRigidWeighted(mesh.vertices, from, handles.map((h) => h.to), weights);
    const viaDeform = deformMeshGeodesic(mesh, handles);
    viaPose.forEach((p, i) => {
      expect(p.x).toBeCloseTo(viaDeform[i].x, 9);
      expect(p.y).toBeCloseTo(viaDeform[i].y, 9);
    });
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run src/__tests__/geodesic.test.ts`.

- [ ] **Step 3: Implement** — in `geodesic.ts`, add `poseWeights` and refactor `deformMeshGeodesic` to use it:
```ts
/** Geodesic MLS weights for a fixed handle set (cacheable; depends on mesh + handle vertices, not
 *  targets). weights[vertex][handle]; Infinity at a handle's own vertex; 0 if unreachable. */
export function poseWeights(
  mesh: Mesh,
  handleVertices: number[],
  alpha = 1,
): { from: Pt[]; weights: number[][] } {
  const dist = geodesicDistances(mesh, handleVertices);
  const from = handleVertices.map((v) => mesh.vertices[v]);
  const weights = mesh.vertices.map((_, v) =>
    handleVertices.map((_, h) => {
      const g = dist[h][v];
      return g === 0 ? Infinity : g === Infinity ? 0 : 1 / Math.pow(g, 2 * alpha);
    }),
  );
  return { from, weights };
}

export function deformMeshGeodesic(mesh: Mesh, handles: MeshHandle[], alpha = 1): Pt[] {
  if (handles.length === 0) return mesh.vertices.map((v) => ({ x: v.x, y: v.y }));
  const { from, weights } = poseWeights(mesh, handles.map((h) => h.vertex), alpha);
  return mlsRigidWeighted(mesh.vertices, from, handles.map((h) => h.to), weights);
}
```
(Remove the now-duplicated inline weight computation from the old `deformMeshGeodesic`.)

- [ ] **Step 4: Verify** — `npx vitest run src/__tests__/geodesic.test.ts` (all pass, incl. the existing ones). `npm run build` → 0/0.
- [ ] **Step 5: Commit**
```bash
git add src/core/geodesic.ts src/__tests__/geodesic.test.ts
git commit -m "feat: poseWeights (cacheable geodesic MLS weights); deformMeshGeodesic uses it"
```

---

### Task 2: `MeshPose` + `nearestVertex` + export `drawTriangle` (TDD for the pure bit)

**Files:** Modify `src/core/selection.ts` (export `drawTriangle`); create `src/core/mesh-pose.ts`, `src/__tests__/mesh-pose.test.ts`.

- [ ] **Step 1: Export `drawTriangle`** — in `src/core/selection.ts`, change `function drawTriangle(` to `export function drawTriangle(`. (`triangleAffine` stays private.) Build to confirm 0/0.

- [ ] **Step 2: Failing test for the pure helper** — `src/__tests__/mesh-pose.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { nearestVertex } from "../core/mesh-pose";

describe("nearestVertex", () => {
  const verts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
  it("returns the index of the closest vertex", () => {
    expect(nearestVertex(verts, { x: 9, y: 1 })).toBe(1);
    expect(nearestVertex(verts, { x: 1, y: 9 })).toBe(2);
    expect(nearestVertex(verts, { x: 1, y: 1 })).toBe(0);
  });
});
```

- [ ] **Step 3: Run, verify FAIL** — `npx vitest run src/__tests__/mesh-pose.test.ts`.

- [ ] **Step 4: Implement `src/core/mesh-pose.ts`**
```ts
import { triangulateSilhouette, type Mesh } from "./triangulate";
import { poseWeights } from "./geodesic";
import { mlsRigidWeighted, type Pt } from "./mls";
import { drawTriangle, type SelectionRect } from "./selection";

export interface PoseHandle {
  vertex: number;
  to: Pt;
}

/** Index of the vertex closest to `p`. */
export function nearestVertex(verts: Pt[], p: Pt): number {
  let best = 0,
    bd = Infinity;
  for (let i = 0; i < verts.length; i++) {
    const dx = verts[i].x - p.x,
      dy = verts[i].y - p.y;
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Lift + mesh state for the Pose tool. Vertices in DOC coords; deforms via cached geodesic MLS. */
export class MeshPose {
  rest: Pt[];
  deformed: Pt[];
  triangles: [number, number, number][];
  handles: PoseHandle[] = [];
  private from: Pt[] = [];
  private weights: number[][] = [];

  private constructor(
    rest: Pt[],
    triangles: [number, number, number][],
    readonly img: HTMLCanvasElement,
    readonly rect: SelectionRect,
  ) {
    this.rest = rest;
    this.deformed = rest.map((v) => ({ x: v.x, y: v.y }));
    this.triangles = triangles;
  }

  /** Triangulate the lifted alpha and map vertices to doc coords. null if no mesh (empty content). */
  static fromLift(img: HTMLCanvasElement, rect: SelectionRect, dpr: number, spacing: number): MeshPose | null {
    const ctx = img.getContext("2d", { willReadFrequently: true });
    if (!ctx || img.width === 0 || img.height === 0) return null;
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    const inside = (x: number, y: number) =>
      x >= 0 && x < img.width && y >= 0 && y < img.height && data[(y * img.width + x) * 4 + 3] > 10;
    const mesh: Mesh = triangulateSilhouette(inside, img.width, img.height, { spacing });
    if (mesh.triangles.length === 0) return null;
    const rest = mesh.vertices.map((v) => ({ x: rect.x + v.x / dpr, y: rect.y + v.y / dpr }));
    return new MeshPose(rest, mesh.triangles, img, rect);
  }

  private restMesh(): Mesh {
    return { vertices: this.rest, triangles: this.triangles };
  }
  private recompute() {
    const verts = this.handles.map((h) => h.vertex);
    const pw = poseWeights(this.restMesh(), verts);
    this.from = pw.from;
    this.weights = pw.weights;
    this.solve();
  }
  private solve() {
    this.deformed = this.handles.length
      ? mlsRigidWeighted(this.rest, this.from, this.handles.map((h) => h.to), this.weights)
      : this.rest.map((v) => ({ x: v.x, y: v.y }));
  }

  /** Hit-test an existing handle dot (deformed position) within `tol` doc px. */
  handleAt(p: Pt, tol: number): number | null {
    for (let i = 0; i < this.handles.length; i++) {
      const v = this.deformed[this.handles[i].vertex];
      if (Math.hypot(v.x - p.x, v.y - p.y) <= tol) return i;
    }
    return null;
  }
  /** Add a handle at the nearest vertex (pinned at its current deformed pos). Returns its handle index. */
  addHandleAt(p: Pt): number {
    const vtx = nearestVertex(this.deformed, p);
    const existing = this.handles.findIndex((h) => h.vertex === vtx);
    if (existing >= 0) return existing;
    const d = this.deformed[vtx];
    this.handles.push({ vertex: vtx, to: { x: d.x, y: d.y } });
    this.recompute(); // handle set changed → geodist + weights
    return this.handles.length - 1;
  }
  /** Move a handle's target and resolve (cached weights — cheap). */
  dragHandle(i: number, p: Pt) {
    if (i < 0 || i >= this.handles.length) return;
    this.handles[i].to = { x: p.x, y: p.y };
    this.solve();
  }
  resetHandles() {
    this.handles = [];
    this.from = [];
    this.weights = [];
    this.deformed = this.rest.map((v) => ({ x: v.x, y: v.y }));
  }

  /** Warp the lifted raster through the deformed mesh into `ctx` (doc coords). */
  render(ctx: CanvasRenderingContext2D) {
    for (const [a, b, c] of this.triangles) {
      drawTriangle(
        ctx,
        this.img,
        this.rect,
        [this.rest[a], this.rest[b], this.rest[c]],
        [this.deformed[a], this.deformed[b], this.deformed[c]],
      );
    }
  }
  /** Mesh edges (faint) + handle dots (filled), at deformed positions. */
  drawWireframe(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.strokeStyle = "rgba(0,128,255,0.4)";
    ctx.lineWidth = 0.75;
    for (const [a, b, c] of this.triangles) {
      const va = this.deformed[a], vb = this.deformed[b], vc = this.deformed[c];
      ctx.beginPath();
      ctx.moveTo(va.x, va.y);
      ctx.lineTo(vb.x, vb.y);
      ctx.lineTo(vc.x, vc.y);
      ctx.closePath();
      ctx.stroke();
    }
    for (const h of this.handles) {
      const v = this.deformed[h.vertex];
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(v.x, v.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }
}
```

- [ ] **Step 5: Verify** — `npx vitest run src/__tests__/mesh-pose.test.ts` → pass. `npm run build` → 0/0 (the `MeshPose` class type-checks; `drawTriangle`/`SelectionRect` import OK). `npm test` → 262 + new.
- [ ] **Step 6: Commit**
```bash
git add src/core/selection.ts src/core/mesh-pose.ts src/__tests__/mesh-pose.test.ts
git commit -m "feat: MeshPose state + nearestVertex; export drawTriangle"
```

---

### Task 3: Tool enum + toolbar button

**Files:** Modify `src/state/appState.svelte.ts`, `src/lib/Toolbar.svelte`.

- [ ] **Step 1:** add `"pose"` to `Tool`:
```ts
export type Tool = "brush" | "eraser" | "fill" | "select" | "lasso" | "transform" | "eyedropper" | "deform" | "pose";
```
- [ ] **Step 2:** in `Toolbar.svelte`, add `PersonStanding` to the `@lucide/svelte` import; after the Deform button add:
```svelte
  <button
    class="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:bg-surface-hover"
    class:bg-surface-active={appState.tool === "pose"}
    title="Pose (mesh deform)"
    onclick={() => (appState.tool = "pose")}><PersonStanding size={18} /></button
  >
```
- [ ] **Step 3:** `npm run build` → 0/0; `npm test` → 262; lint clean.
- [ ] **Step 4: Commit**
```bash
git add src/state/appState.svelte.ts src/lib/Toolbar.svelte
git commit -m "feat: pose tool enum + toolbar button"
```

---

### Task 4: Canvas — enterPose, interaction, overlay render, bake

**Files:** Modify `src/lib/Canvas.svelte`. READ the file's lift/onStroke/`$effect`/overlay parts first.

- [ ] **Step 1: Imports + state** — add `import { MeshPose } from "../core/mesh-pose";`. Add a state var near `selectionMode`: `let meshPose: MeshPose | null = null;`. Add a default spacing const: `const POSE_SPACING = 16;` (device px; the dev-viz-tuned value).

- [ ] **Step 2: Overlay paint helper** — add:
```ts
  function posePaint() {
    const octx = overlay.getContext("2d")!;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (meshPose) {
      meshPose.render(octx);
      meshPose.drawWireframe(octx);
    }
  }
```

- [ ] **Step 3: `enterPose()`** — mirror `enterDeform` (lift), then build the mesh:
```ts
  function enterPose() {
    const al = activeLayer();
    if (al.kind !== "draw" || al.locked || !isIdentityTransform(al.transform)) return;
    const canvas = ensureDrawableKeyframe(al, state.playhead, canvasOps);
    const rect = contentRectLogical(contentBounds(canvas, state.version), DPR);
    if (!rect) return;
    selection.cancel(); // clear any stale selection
    selCtx = canvas.getContext("2d", { willReadFrequently: true })!;
    selBefore = selCtx.getImageData(0, 0, canvas.width, canvas.height);
    selCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    selection.rect = rect;
    const lifted = selection.liftPixels(selCtx, DPR); // clears the content region from the cell
    if (!lifted) {
      selCtx = null;
      selBefore = null;
      return;
    }
    meshPose = MeshPose.fromLift(lifted, rect, DPR, POSE_SPACING);
    if (!meshPose) {
      // no mesh → undo the lift and bail
      if (selBefore) selCtx.putImageData(selBefore, 0, 0);
      selCtx = null;
      selBefore = null;
      recomposite();
      return;
    }
    recomposite();
    posePaint();
  }
```

- [ ] **Step 4: `applyPose()` / `cancelPose()`** — bake/restore (mirror `selection.onCommit`/`onCancel`):
```ts
  function applyPose() {
    if (!meshPose || !selCtx || !selBefore) return;
    selCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    meshPose.render(selCtx); // bake the deformed raster into the cell
    const ctx = selCtx;
    const before = selBefore;
    const after = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    history.push({
      undo: () => { ctx.putImageData(before, 0, 0); recomposite(); },
      redo: () => { ctx.putImageData(after, 0, 0); recomposite(); },
    });
    meshPose = null;
    selCtx = null;
    selBefore = null;
    posePaint(); // clears the overlay (meshPose is null)
    bump();
    recomposite();
  }
  function cancelPose() {
    if (meshPose && selCtx && selBefore) selCtx.putImageData(selBefore, 0, 0);
    meshPose = null;
    selCtx = null;
    selBefore = null;
    posePaint();
    recomposite();
  }
```

- [ ] **Step 5: onStroke pose branch** — extend the transformed-layer guard to include `"pose"`, then add a branch BEFORE the deform branch:
```ts
    if (state.tool === "pose") {
      const p = points[points.length - 1];
      if (!meshPose) {
        if (points.length === 1 && !done) enterPose();
        return;
      }
      if (points.length === 1 && !done) {
        const hit = meshPose.handleAt(p, 10 / viewport.zoom);
        poseDrag = hit !== null ? hit : meshPose.addHandleAt(p);
        posePaint();
      } else if (!done) {
        if (poseDrag !== null) {
          meshPose.dragHandle(poseDrag, p);
          posePaint();
        }
      } else {
        poseDrag = null;
      }
      return;
    }
```
Add `let poseDrag: number | null = null;` near `selectionMode`. Extend the existing guard: `(state.tool === "select" || state.tool === "lasso" || state.tool === "deform" || state.tool === "pose")`.

- [ ] **Step 6: Leave-pose commit** — in the tool-watching `$effect`, bank the pose when leaving:
```ts
    if (prevTool === "pose" && t !== "pose" && meshPose) applyPose();
```
(Place alongside the existing `prevTool === "deform"` commit; `prevTool` already exists.) Esc → `cancelPose()`: in the keyboard handler (App.svelte routes Esc to `selection.cancel()`; add a pose path) — simplest: handle Esc in Canvas's existing key handling if present, else wire `selectionActions`/a cancel. For this task, make **switching tools** commit (Step 6) and the **panel Cancel** (Task 5) cancel; Esc-cancel is a nicety handled in Task 5 if a key hook exists.

- [ ] **Step 7: Verify** — `npm run build` → 0/0; `npm test` → 262; lint clean.
- [ ] **Step 8: Commit**
```bash
git add src/lib/Canvas.svelte
git commit -m "feat: Canvas — pose tool lift/interaction/overlay/bake"
```

---

### Task 5: Panel — Apply / Cancel / Reset handles / density

**Files:** Modify `src/lib/Canvas.svelte`.

**Why not `SelectionActions`:** that panel anchors itself to the *selection's* screen bbox (`getScreenBounds()`) and gates its visibility on an active selection. A pose has **no selection** — routing pose controls through it would mean fighting that anchoring/visibility logic. The pose bar has nothing to anchor to a moving bbox, so render it as a **self-contained, fixed-position bar inside the `stage` div**, gated purely on `meshPose`. No `SelectionActions` changes.

- [ ] **Step 1: Density re-mesh + state** — in `Canvas.svelte` add `let poseSpacing = POSE_SPACING;` (and use `poseSpacing` instead of the `POSE_SPACING` const inside `enterPose`'s `fromLift` call). Add the density handler:
```ts
  function poseDensity(delta: number) {
    if (!meshPose) return;
    poseSpacing = Math.max(4, poseSpacing + delta * 4);
    // rebuild from the SAME lifted img (resets handles — vertex indices change)
    meshPose = MeshPose.fromLift(meshPose.img, meshPose.rect, DPR, poseSpacing) ?? meshPose;
    poseDrag = null;
    posePaint();
  }
```

- [ ] **Step 2: The pose bar** — add this block inside the `stage` `<div>` (sibling of `<SelectionActions … />`, before the closing `</div>`). It is centered at the top of the stage, only mounted while a pose is active, and uses `onpointerdown` so a pencil/touch tap fires without a click delay:
```svelte
  {#if meshPose}
    <div
      class="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1 rounded bg-surface border border-border shadow-lg z-10"
    >
      <button
        class="px-2 py-1 text-xs border border-border rounded bg-surface hover:bg-surface-hover"
        title="Coarser mesh"
        onpointerdown={(e) => { e.preventDefault(); poseDensity(-1); }}>−</button
      >
      <button
        class="px-2 py-1 text-xs border border-border rounded bg-surface hover:bg-surface-hover"
        title="Denser mesh"
        onpointerdown={(e) => { e.preventDefault(); poseDensity(1); }}>+</button
      >
      <button
        class="px-2 py-1 text-xs border border-border rounded bg-surface hover:bg-surface-hover"
        title="Reset handles"
        onpointerdown={(e) => { e.preventDefault(); meshPose?.resetHandles(); poseDrag = null; posePaint(); }}>Reset</button
      >
      <button
        class="px-2 py-1 text-xs border border-border rounded bg-accent text-accent-text"
        title="Apply pose"
        onpointerdown={(e) => { e.preventDefault(); applyPose(); }}>Apply</button
      >
      <button
        class="px-2 py-1 text-xs border border-border rounded bg-surface hover:bg-surface-hover"
        title="Cancel pose"
        onpointerdown={(e) => { e.preventDefault(); cancelPose(); }}>Cancel</button
      >
    </div>
  {/if}
```
(`meshPose` is component-local state, so `{#if meshPose}` reactively mounts/unmounts the bar as `enterPose`/`applyPose`/`cancelPose` set it. `e.preventDefault()` keeps the tap from also reaching the stage's pointer handlers / starting a stroke.)

- [ ] **Step 3: Verify** — `npm run build` → 0/0; `npm test` → 262; lint clean.
- [ ] **Step 4: Manual (browser, `npm run dev`)**
  - Pick **Pose** on a drawing → press to drop an anchor (filled dot on a mesh vertex). Press-drag
    elsewhere → that region follows while the geodesically-far parts (held by the anchor) stay (bend an
    arm without dragging the other limb). The wireframe + raster preview update live.
  - **Reset** clears handles (back to rest); **−/+** rebuilds the mesh (denser/coarser, handles reset);
    **Apply** bakes (one undo); **Cancel** restores; switching to a brush banks the pose.
  - Empty cell → nothing; transformed layer → disabled (Apply transform first); a hold frame poses its
    key. Baked result composites with onion/boil/export and survives save-reload. Check iPad smoothness
    (if a dense mesh stutters, that's the noted wireframe-during-drag fallback candidate).
- [ ] **Step 5: Commit**
```bash
git add src/lib/Canvas.svelte
git commit -m "feat: pose panel (Apply/Cancel/Reset/density)"
```

---

## Final verification

- [ ] `npm run build` → 0/0; `npm test` → 262 + new (`poseWeights`, `nearestVertex`); `npm run lint` → clean.
- [ ] Manual (Task 5 Step 4): pose a drawing — anchor + drag bends a limb without dragging far parts;
      density/reset/apply/cancel/leave-commit all work; baked + persisted.

## Self-Review (completed by plan author)

**Spec coverage:** `MeshPose` (rest/deformed/triangles/handles, doc coords, cached weights) + `fromLift` triangulate→doc mapping (T2) ✅; geodist/weights cached per handle-set via `poseWeights`, kernel per drag (T1/T2 `recompute`/`solve`/`dragHandle`) ✅; `"pose"` tool + button (T3) ✅; `enterPose` lift mirror + null-mesh abort (T4) ✅; tap-to-anchor + drag-to-pose, accumulate, `handleAt`/`addHandleAt`/`nearestVertex` snap (T2/T4) ✅; live overlay render via exported `drawTriangle` (T2/T4 `posePaint`) ✅; Apply bakes one undo / Cancel restores / leave-commit (T4) ✅; transformed-layer guard extended (T4) ✅; panel Apply/Cancel/Reset/density, density re-meshes+resets (T5) ✅; pure tests `poseWeights`/`nearestVertex`, rest build+manual (T1/T2 + manual) ✅; out-of-scope (non-destructive, animated, true ARAP, arbitrary handles) absent ✅.

**Placeholder scan:** No TBD/TODO; full code per step. The Esc-cancel "if a key hook exists" note (T4.6) is an explicit conditional with the tool-switch/panel paths as the guaranteed cancel route, not a gap.

**Type consistency:** `MeshPose.fromLift(img, rect, dpr, spacing)` / `addHandleAt`/`dragHandle`/`handleAt`/`resetHandles`/`render`/`drawWireframe` defined T2, called in Canvas T4/T5. `poseWeights(mesh, handleVertices, alpha) → {from, weights}` defined T1, used in `MeshPose.recompute` T2. `nearestVertex(verts, p)` defined+tested T2, used in `addHandleAt`. `drawTriangle` exported T2, used in `MeshPose.render`. `meshPose`/`poseDrag`/`poseSpacing` Canvas state consistent across T4/T5. `Pt`/`SelectionRect`/`Mesh` reused from their modules.
