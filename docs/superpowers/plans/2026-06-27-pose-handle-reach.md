# Pose Per-Handle Geodesic Reach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each Pose handle an optional geodesic "reach" (influence radius) so its move/rotation can be localized, set by a second on-canvas nub with a live affected-region highlight.

**Architecture:** One backward-compatible addition to `poseWeights` (a per-handle reach window that zeroes weight beyond the reach); `PoseHandle.reach` + `setReach`/`reachMask` thread it through `MeshPose`; Canvas adds a reach nub (distance = reach) and tints the affected triangles. Default unlimited keeps existing poses identical.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-27-pose-handle-reach-design.md`

**Branch:** `feat-pose-handle-reach` (already created off `main`; the spec commit is on it).

**Conventions:** Build bar **0 errors, 0 warnings**. Test baseline **273**, must not drop. Husky pre-commit reformats. `Canvas.svelte` imports the store unaliased as `state`. Reuses `geodesicDistances` (`geodesic.ts`), `mlsRigidWeighted`/`Pt` (`mls.ts`), `solvePoseDeform`/`poseWeights`.

---

### Task 1: `poseWeights` reach window (pure, TDD)

**Files:** Modify `src/core/geodesic.ts`; Test `src/__tests__/geodesic.test.ts`.

- [ ] **Step 1: Write the failing tests.** Append to `src/__tests__/geodesic.test.ts` (it already imports `geodesicDistances`, `poseWeights`, the `tri` helper, and `Mesh`):
```ts
describe("poseWeights reach window", () => {
  // A 4×2 strip; geodesic distance from vertex 0 grows along the top row.
  const mesh: Mesh = {
    vertices: [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 },
      { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 },
    ],
    triangles: [tri(0, 1, 4), tri(1, 5, 4), tri(1, 2, 5), tri(2, 6, 5), tri(2, 3, 6), tri(3, 7, 6)],
  };
  it("zeros influence beyond the reach and dampens within it", () => {
    const dist = geodesicDistances(mesh, [0]);
    const noReach = poseWeights(mesh, [0]).weights;
    const R = 15; // between vertex 1 (g=10) and vertex 2 (g=20)
    const reached = poseWeights(mesh, [0], 1, [R]).weights;
    mesh.vertices.forEach((_, v) => {
      const g = dist[0][v];
      if (g === 0) expect(reached[v][0]).toBe(Infinity);
      else if (g >= R) expect(reached[v][0]).toBe(0);
      else {
        expect(reached[v][0]).toBeGreaterThan(0);
        expect(reached[v][0]).toBeLessThan(noReach[v][0]); // windowed below unwindowed
      }
    });
    expect(reached[2][0]).toBe(0); // vertex 2 at g=20 ≥ 15 is excluded
  });
  it("undefined reach equals the no-reach weights (regression)", () => {
    const a = poseWeights(mesh, [0, 3]).weights;
    const b = poseWeights(mesh, [0, 3], 1, [undefined, undefined]).weights;
    expect(b).toEqual(a);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `npx vitest run src/__tests__/geodesic.test.ts` — `poseWeights` takes 3 args today; the 4th (`reaches`) is ignored, so the reach test fails (vertex 2 weight is `1/400`, not `0`).

- [ ] **Step 3: Implement.** In `src/core/geodesic.ts`, replace `poseWeights` with:
```ts
export function poseWeights(
  mesh: Mesh,
  handleVertices: number[],
  alpha = 1,
  reaches?: (number | undefined)[],
): { from: Pt[]; weights: number[][] } {
  const dist = geodesicDistances(mesh, handleVertices);
  const from = handleVertices.map((v) => mesh.vertices[v]);
  const weights = mesh.vertices.map((_, v) =>
    handleVertices.map((_, h) => {
      const g = dist[h][v];
      if (g === 0) return Infinity;
      if (g === Infinity) return 0;
      let w = 1 / Math.pow(g, 2 * alpha);
      const R = reaches?.[h];
      if (R != null && R > 0) {
        if (g >= R) return 0;
        const t = g / R; // smooth compact window: 1 at g=0 → 0 at g=R
        const win = 1 - t * t;
        w *= win * win;
      }
      return w;
    }),
  );
  return { from, weights };
}
```

- [ ] **Step 4: Run, verify PASS.** `npx vitest run src/__tests__/geodesic.test.ts` → pass (incl. the existing `poseWeights`/`deformMeshGeodesic` tests — `reaches` is optional). `npm run build` → 0/0. `npm test` → 275.

- [ ] **Step 5: Commit.**
```bash
git add src/core/geodesic.ts src/__tests__/geodesic.test.ts
git commit -m "feat: poseWeights per-handle reach window (compact geodesic influence)"
```

---

### Task 2: `MeshPose` reach wiring + localized-solve test

**Files:** Modify `src/core/mesh-pose.ts`; Test `src/__tests__/mesh-pose.test.ts`.

- [ ] **Step 1: Write the failing test** (exercises reach end-to-end through the pure functions). Append to `src/__tests__/mesh-pose.test.ts` (it already imports `solvePoseDeform`/`PoseHandle`, `poseWeights`, `armMesh`):
```ts
describe("reach localizes the deform", () => {
  it("a far vertex stays at rest when the handle's reach excludes it", () => {
    const mesh = armMesh(); // verts 0..3 top row (y=0, x=0,10,20,30), 4..7 bottom (y=10)
    const handles: PoseHandle[] = [
      { vertex: 0, to: { x: 0, y: 0 }, angle: 0 }, // anchor
      { vertex: 3, to: { x: 40, y: 10 }, angle: 0, reach: 12 }, // tug far end, tight reach
    ];
    const { from, weights } = poseWeights(mesh, [0, 3], 1, [undefined, 12]);
    const out = solvePoseDeform(mesh.vertices, handles, from, weights);
    // vertex 1 (geodesic 20 from the reached handle 3, ≥ 12) is outside its reach AND is the anchor's
    // domain → stays at rest.
    expect(out[1].x).toBeCloseTo(mesh.vertices[1].x, 6);
    expect(out[1].y).toBeCloseTo(mesh.vertices[1].y, 6);
    // vertex 3 (the reached handle) still reaches its target exactly (Infinity weight).
    expect(out[3].x).toBeCloseTo(40, 6);
    expect(out[3].y).toBeCloseTo(10, 6);
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `npx vitest run src/__tests__/mesh-pose.test.ts` — fails: `PoseHandle` has no `reach` property (type error in the literal), so the test file won't compile.

- [ ] **Step 3: Implement in `src/core/mesh-pose.ts`.**
  - Add `reach?: number;` to `PoseHandle`:
```ts
export interface PoseHandle {
  vertex: number;
  to: Pt;
  angle: number;
  reach?: number; // geodesic influence radius in doc px; undefined = unlimited
}
```
  - In `recompute()`, pass the per-handle reaches:
```ts
  private recompute() {
    const verts = this.handles.map((h) => h.vertex);
    const pw = poseWeights(this.restMesh(), verts, 1, this.handles.map((h) => h.reach));
    this.from = pw.from;
    this.weights = pw.weights;
    this.solve();
  }
```
  - Add `setReach` (next to `rotateHandle`):
```ts
  /** Set a handle's geodesic reach (undefined = unlimited) and re-derive weights + re-solve. */
  setReach(i: number, reach: number | undefined) {
    if (i < 0 || i >= this.handles.length) return;
    this.handles[i].reach = reach;
    this.recompute();
  }
```
  - Add `reachMask` (for the overlay highlight):
```ts
  /** Per-vertex: is this vertex within handle `i`'s influence (non-zero weight)? */
  reachMask(i: number): boolean[] {
    return this.weights.map((row) => row[i] > 0);
  }
```
  (`addHandleAt` needs no change — `reach` is optional, so new handles are unlimited.)

- [ ] **Step 4: Run, verify PASS.** `npx vitest run src/__tests__/mesh-pose.test.ts` → pass. `npm run build` → 0/0. `npm test` → 276.

- [ ] **Step 5: Commit.**
```bash
git add src/core/mesh-pose.ts src/__tests__/mesh-pose.test.ts
git commit -m "feat: MeshPose per-handle reach (setReach, reachMask, recompute threads reach)"
```

---

### Task 3: Canvas — reach nub + affected-region highlight

**Files:** Modify `src/lib/Canvas.svelte`. READ the pose state vars (~line 95), `poseNubPos`/`posePaint`, and the onStroke pose branch first. DOM → build + manual.

- [ ] **Step 1: State.** Next to `let poseRotating = false;` add:
```ts
  let poseReaching = false;
```

- [ ] **Step 2: Reach-nub geometry helpers.** Add near `poseNubPos`:
```ts
  const POSE_REACH_DIR = { x: 0, y: 1 }; // fixed (screen-down) rail, independent of the rotate nub
  function poseReachMax(): number {
    return meshPose ? Math.hypot(meshPose.rect.w, meshPose.rect.h) : 0; // beyond full extent = unlimited
  }
  function poseReachNubPos(): { x: number; y: number } | null {
    if (!meshPose || activeHandle === null) return null;
    const h = meshPose.handles[activeHandle];
    const c = meshPose.deformed[h.vertex];
    const r = h.reach ?? poseReachMax();
    return { x: c.x + POSE_REACH_DIR.x * r, y: c.y + POSE_REACH_DIR.y * r };
  }
```

- [ ] **Step 3: Draw the highlight + reach nub in `posePaint()`.** Inside the `if (activeHandle !== null) {` block, BEFORE the existing rotate-nub drawing, add the affected-region tint; AFTER the rotate-nub drawing (still inside the block), add the reach nub:
```ts
        // affected-region highlight (only when this handle has a finite reach)
        if (h.reach != null) {
          const mask = meshPose.reachMask(activeHandle);
          octx.fillStyle = "rgba(0,200,120,0.18)";
          for (const [ta, tb, tc] of meshPose.triangles) {
            if (mask[ta] && mask[tb] && mask[tc]) {
              const va = meshPose.deformed[ta],
                vb = meshPose.deformed[tb],
                vc = meshPose.deformed[tc];
              octx.beginPath();
              octx.moveTo(va.x, va.y);
              octx.lineTo(vb.x, vb.y);
              octx.lineTo(vc.x, vc.y);
              octx.closePath();
              octx.fill();
            }
          }
        }
```
and (after the rotate nub, before the block closes):
```ts
        const rnub = poseReachNubPos()!;
        octx.strokeStyle = "rgba(0,200,120,0.7)";
        octx.lineWidth = 1.5 / viewport.zoom;
        octx.beginPath();
        octx.moveTo(c.x, c.y);
        octx.lineTo(rnub.x, rnub.y);
        octx.stroke();
        const s = 5 / viewport.zoom;
        octx.fillStyle = "#00c878";
        octx.beginPath();
        octx.moveTo(rnub.x, rnub.y - s);
        octx.lineTo(rnub.x + s, rnub.y);
        octx.lineTo(rnub.x, rnub.y + s);
        octx.lineTo(rnub.x - s, rnub.y);
        octx.closePath();
        octx.fill();
        octx.strokeStyle = "#fff";
        octx.stroke();
```
(The existing block already binds `const h` and `const c` for the active handle — reuse them; place the highlight after `const c = ...` and the reach nub after the rotate-nub fill/stroke.)

- [ ] **Step 4: Interaction — press hit priority + reach drag.** In the onStroke pose branch:
  - In the **press** (`points.length === 1 && !done`) block, after the rotate-nub test and before the `else { handleAt/addHandleAt }`, insert a reach-nub test so the chain is rotate → reach → body → add:
```ts
        const nub = poseNubPos();
        const rnub = poseReachNubPos();
        if (nub && Math.hypot(nub.x - p.x, nub.y - p.y) <= 12 / viewport.zoom) {
          poseRotating = true;
        } else if (rnub && Math.hypot(rnub.x - p.x, rnub.y - p.y) <= 12 / viewport.zoom) {
          poseReaching = true;
        } else {
          const hit = meshPose.handleAt(p, 10 / viewport.zoom);
          activeHandle = hit !== null ? hit : meshPose.addHandleAt(p);
          poseDrag = activeHandle;
        }
        posePaint();
```
  - In the **move** (`!done`) block, add a reach branch before the `poseDrag` branch:
```ts
      } else if (!done) {
        if (poseRotating && activeHandle !== null) {
          const c = meshPose.deformed[meshPose.handles[activeHandle].vertex];
          meshPose.rotateHandle(activeHandle, Math.atan2(p.y - c.y, p.x - c.x));
          posePaint();
        } else if (poseReaching && activeHandle !== null) {
          const c = meshPose.deformed[meshPose.handles[activeHandle].vertex];
          const d = Math.hypot(p.x - c.x, p.y - c.y);
          meshPose.setReach(activeHandle, d >= poseReachMax() ? undefined : d);
          posePaint();
        } else if (poseDrag !== null) {
          meshPose.dragHandle(poseDrag, p);
          posePaint();
        }
      } else {
        poseDrag = null;
        poseRotating = false;
        poseReaching = false;
      }
```

- [ ] **Step 5: Teardown.** At the four sites that already set `activeHandle = null; poseRotating = false;` (in `applyPose`, `cancelPose`, `poseDensity`, and the Reset-button handler), also add `poseReaching = false;`.

- [ ] **Step 6: Verify.** `npm run build` → 0/0 (`npx svelte-check` → `0 ERRORS 0 WARNINGS`). `npm test` → 276. Lint clean.

- [ ] **Step 7: Commit.**
```bash
git add src/lib/Canvas.svelte
git commit -m "feat: Pose reach nub + affected-region highlight"
```

---

## Final verification

- [ ] `npm run build` → 0/0; `npm run lint` → clean; `npm test` → 276.
- [ ] **Manual (browser, `npm run dev`):** select a handle → a green diamond reach nub appears (below it). Drag the nub in → the affected mesh region (green tint) shrinks and only that part follows the handle's move/rotation; the rest holds. Drag it past the mesh extent → reach returns to unlimited (tint clears). Rotate + translate still work; Apply/Cancel unchanged. A tight reach on a lone handle shows the expected boundary seam (documented).

## Self-Review (completed by plan author)

**Spec coverage:** reach window in `poseWeights` with smooth compact falloff + backward-compat (Task 1) ✅; `PoseHandle.reach` + `setReach` + `reachMask` + recompute threading (Task 2) ✅; geodesic (reuses `geodesicDistances`), default-unlimited preserves behavior (Tasks 1–2) ✅; reach nub (distance=reach, fixed rail), hit priority rotate→reach→body→add, snap-to-unlimited past `poseReachMax`, affected-region highlight (Task 3) ✅; reach shapes whole influence (it's in the weights, used by both translate and rotate) ✅; teardown of `poseReaching` (Task 3 Step 5) ✅; pure tests for window/regression/localized-solve (Tasks 1–2), gizmo manual ✅; out-of-scope (hardness, anchors, grid tool, persistence) untouched ✅.

**Placeholder scan:** No TBD/TODO; full code per step. Step 3/4 reference the existing `const h`/`const c` and the existing press/move structure explicitly.

**Type consistency:** `poseWeights(mesh, verts, alpha, reaches?)` — the new optional 4th arg matches its call in `recompute` and the tests. `PoseHandle.reach?: number` matches `setReach(i, number|undefined)`, the test literals, and `poseReachNubPos`'s `h.reach ?? poseReachMax()`. `reachMask(i): boolean[]` matches its use in `posePaint`. `meshPose.rect`/`triangles`/`deformed` are existing public members. `poseReaching` consistent across state/press/move/done/teardown.
