# Pose Tool Per-Handle Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each Pose handle a rotation, driven by a rotate-nub gizmo, so bending a limb is a rotation about a handle (low distortion) instead of a translate-drag (shear).

**Architecture:** A handle gains an `angle`; the rotation is injected into the existing geodesic-MLS by adding a "satellite" point-correspondence per rotated handle (reusing `mlsRigidWeighted` + cached `poseWeights`). The augmentation+solve is extracted into a **pure** `solvePoseDeform` (node-testable). Canvas adds an active-handle rotate nub (drag it around the handle to set the angle).

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-27-pose-rotation-handle-design.md`

**Branch:** `feat-pose-rotation-handle` (already created off `main`; the spec commit is on it).

**Conventions:** Build bar **0 errors, 0 warnings**. Test baseline **270**, must not drop. Husky pre-commit reformats. `Canvas.svelte` imports the store unaliased as `state`. Reuses `mlsRigidWeighted`/`Pt` (`mls.ts`), `poseWeights` (`geodesic.ts`).

**Design refinements vs the spec (intent unchanged):** (1) the rotation math goes through a new pure `solvePoseDeform` so it's unit-testable; (2) `rotateVec` is inlined in `mesh-pose.ts` rather than importing `ref-transform`'s `rotate` (avoids an export change); (3) the gizmo is a **rotate nub** (a single draggable dot at a fixed screen radius, like the transform tool's rotate handle) rather than a full ring band — simpler hit-test, same interaction.

---

### Task 1: Rotation core — `solvePoseDeform` + `PoseHandle.angle` + `rotateHandle` (pure, TDD)

**Files:** Modify `src/core/mesh-pose.ts`; Test `src/__tests__/mesh-pose.test.ts`.

- [ ] **Step 1: Write the failing tests.** Append to `src/__tests__/mesh-pose.test.ts`:
```ts
import { solvePoseDeform, type PoseHandle } from "../core/mesh-pose";
import { poseWeights } from "../core/geodesic";
import { mlsRigidWeighted } from "../core/mls";
import type { Mesh } from "../core/triangulate";

// A 4×2 grid "arm" strip: verts 0..3 = top row (y=0), 4..7 = bottom row (y=10).
function armMesh(): Mesh {
  const cols = 4,
    rows = 2,
    step = 10;
  const vertices = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) vertices.push({ x: c * step, y: r * step });
  const triangles: [number, number, number][] = [];
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const i = r * cols + c;
      triangles.push([i, i + 1, i + cols]);
      triangles.push([i + 1, i + cols + 1, i + cols]);
    }
  return { vertices, triangles };
}

describe("solvePoseDeform", () => {
  it("angle 0 matches the plain translate-only MLS solve", () => {
    const mesh = armMesh();
    const handles: PoseHandle[] = [
      { vertex: 0, to: { x: 0, y: 0 }, angle: 0 },
      { vertex: 3, to: { x: 35, y: -5 }, angle: 0 },
    ];
    const { from, weights } = poseWeights(mesh, [0, 3]);
    const out = solvePoseDeform(mesh.vertices, handles, from, weights);
    const ref = mlsRigidWeighted(mesh.vertices, from, [handles[0].to, handles[1].to], weights);
    out.forEach((p, i) => {
      expect(p.x).toBeCloseTo(ref[i].x, 9);
      expect(p.y).toBeCloseTo(ref[i].y, 9);
    });
  });

  it("rotating a handle swings the nearby region (and the pivot/anchor hold)", () => {
    const mesh = armMesh();
    const handles: PoseHandle[] = [
      { vertex: 0, to: { x: 0, y: 0 }, angle: 0 }, // anchor (body side)
      { vertex: 3, to: { x: 30, y: 0 }, angle: Math.PI / 2 }, // rotate the far end 90°
    ];
    const { from, weights } = poseWeights(mesh, [0, 3]);
    const out = solvePoseDeform(mesh.vertices, handles, from, weights);
    // pivot vertex stays exactly at its target (Infinity weight)
    expect(out[3].x).toBeCloseTo(30, 6);
    expect(out[3].y).toBeCloseTo(0, 6);
    // anchor vertex stays put
    expect(out[0].x).toBeCloseTo(0, 6);
    expect(out[0].y).toBeCloseTo(0, 6);
    // vertex 7 (adjacent to the rotated pivot) swings left/up toward the rotated position
    expect(Math.hypot(out[7].x - mesh.vertices[7].x, out[7].y - mesh.vertices[7].y)).toBeGreaterThan(3);
    expect(out[7].x).toBeLessThan(mesh.vertices[7].x - 2);
  });

  it("pivot/anchor hold and the region swings at any satellite offset (offset is a falloff knob)", () => {
    const mesh = armMesh();
    const handles: PoseHandle[] = [
      { vertex: 0, to: { x: 0, y: 0 }, angle: 0 },
      { vertex: 3, to: { x: 30, y: 0 }, angle: Math.PI / 2 },
    ];
    const { from, weights } = poseWeights(mesh, [0, 3]);
    // The satellite offset tunes how far the rotation propagates (NOT a cross-offset invariant), but at
    // every offset the Infinity-weighted pivot/anchor map exactly and the nearby region still swings.
    for (const off of [8, 32]) {
      const out = solvePoseDeform(mesh.vertices, handles, from, weights, off);
      expect(out[3].x).toBeCloseTo(30, 6); // pivot exact
      expect(out[3].y).toBeCloseTo(0, 6);
      expect(out[0].x).toBeCloseTo(0, 6); // anchor exact
      expect(out[0].y).toBeCloseTo(0, 6);
      expect(out[7].x).toBeLessThan(mesh.vertices[7].x - 2); // rotation occurs
    }
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** `npx vitest run src/__tests__/mesh-pose.test.ts` — fails: `solvePoseDeform` not exported, and `PoseHandle` has no `angle`.

- [ ] **Step 3: Implement in `src/core/mesh-pose.ts`.**
  - Add `angle: number;` to the `PoseHandle` interface:
```ts
export interface PoseHandle {
  vertex: number;
  to: Pt;
  angle: number; // radians; rotation of the handle's local frame (0 = none)
}
```
  - Add a module-level helper + constant near the top (after the imports):
```ts
/** Rotate a vector about the origin. */
function rotateVec(v: Pt, ang: number): Pt {
  const c = Math.cos(ang),
    s = Math.sin(ang);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Satellite offset (doc px) used to inject a handle's rotation into the MLS. The recovered angle is
 *  independent of this magnitude (it cancels in the rigid fit); only numerical conditioning cares. */
const SAT_OFFSET = 16;
```
  - Add the pure solve function (above the class):
```ts
/**
 * Deform `rest` from pose handles, injecting each handle's rotation as a "satellite" correspondence so
 * the existing geodesic-MLS reproduces a local rotation about the handle. `from` = pivot rest positions
 * (poseWeights.from, aligned with `handles`); `weights[vertex][handle]`. Pure.
 */
export function solvePoseDeform(
  rest: Pt[],
  handles: PoseHandle[],
  from: Pt[],
  weights: number[][],
  satOffset = SAT_OFFSET,
): Pt[] {
  if (!handles.length) return rest.map((v) => ({ x: v.x, y: v.y }));
  const augFrom: Pt[] = [];
  const augTo: Pt[] = [];
  const cols: number[] = []; // built-column → source handle index
  for (let h = 0; h < handles.length; h++) {
    const hd = handles[h];
    augFrom.push(from[h]);
    augTo.push(hd.to);
    cols.push(h);
    if (hd.angle) {
      const e = { x: satOffset, y: 0 };
      const re = rotateVec(e, hd.angle);
      augFrom.push({ x: from[h].x + e.x, y: from[h].y + e.y });
      augTo.push({ x: hd.to.x + re.x, y: hd.to.y + re.y });
      cols.push(h);
    }
  }
  const augWeights = weights.map((row) => cols.map((h) => row[h]));
  return mlsRigidWeighted(rest, augFrom, augTo, augWeights);
}
```
  - Change `solve()` to use it:
```ts
  private solve() {
    this.deformed = solvePoseDeform(this.rest, this.handles, this.from, this.weights);
  }
```
  (Drop the old inline `mlsRigidWeighted`/empty-handles branch — `solvePoseDeform` handles the empty case.)
  - In `addHandleAt`, set `angle: 0` on the pushed handle:
```ts
    this.handles.push({ vertex: vtx, to: { x: d.x, y: d.y }, angle: 0 });
```
  - Add a `rotateHandle` method (next to `dragHandle`):
```ts
  /** Set a handle's rotation angle (radians) and re-solve (cached weights — cheap). */
  rotateHandle(i: number, angle: number) {
    if (i < 0 || i >= this.handles.length) return;
    this.handles[i].angle = angle;
    this.solve();
  }
```

- [ ] **Step 4: Run, verify PASS.** `npx vitest run src/__tests__/mesh-pose.test.ts` → pass. `npm run build` → 0/0. `npm test` → 270 + 3 = 273.

- [ ] **Step 5: Commit.**
```bash
git add src/core/mesh-pose.ts src/__tests__/mesh-pose.test.ts
git commit -m "feat: pose handle rotation via satellite-injected geodesic MLS (solvePoseDeform)"
```

---

### Task 2: Canvas — rotate-nub interaction + overlay

**Files:** Modify `src/lib/Canvas.svelte`. READ the pose state vars (`meshPose`/`poseDrag` ~line 95), `posePaint()` (~626), and the onStroke pose branch (~396) first. DOM → build + manual.

- [ ] **Step 1: State.** Near `let poseDrag: number | null = null;` add:
```ts
  let activeHandle: number | null = null;
  let poseRotating = false;
```

- [ ] **Step 2: Nub geometry helper.** Add (near `posePaint`):
```ts
  // Rotate-nub: a dot at a fixed screen radius around the active handle; dragging it sets the angle.
  const POSE_NUB_R = 28; // screen px from the handle center
  function poseNubPos(): { x: number; y: number } | null {
    if (!meshPose || activeHandle === null) return null;
    const h = meshPose.handles[activeHandle];
    const c = meshPose.deformed[h.vertex];
    const R = POSE_NUB_R / viewport.zoom;
    return { x: c.x + R * Math.cos(h.angle), y: c.y + R * Math.sin(h.angle) };
  }
```

- [ ] **Step 3: Draw the nub in `posePaint()`.** After the `meshPose.render(octx); meshPose.drawWireframe(octx);` lines (inside the `if (meshPose)` block), add:
```ts
      if (activeHandle !== null) {
        const h = meshPose.handles[activeHandle];
        const c = meshPose.deformed[h.vertex];
        const nub = poseNubPos()!;
        octx.strokeStyle = "rgba(0,128,255,0.7)";
        octx.lineWidth = 1.5 / viewport.zoom;
        octx.beginPath();
        octx.moveTo(c.x, c.y);
        octx.lineTo(nub.x, nub.y);
        octx.stroke();
        octx.fillStyle = "#0080ff";
        octx.beginPath();
        octx.arc(nub.x, nub.y, 5 / viewport.zoom, 0, Math.PI * 2);
        octx.fill();
        octx.strokeStyle = "#fff";
        octx.lineWidth = 1.5 / viewport.zoom;
        octx.stroke();
      }
```

- [ ] **Step 4: Rework the onStroke pose branch.** Replace the existing `if (state.tool === "pose") { ... }` block with:
```ts
    if (state.tool === "pose") {
      const p = points[points.length - 1];
      if (!meshPose) {
        if (points.length === 1 && !done) enterPose();
        return;
      }
      if (points.length === 1 && !done) {
        // Press: rotate nub first, then handle body, then add a handle.
        const nub = poseNubPos();
        if (nub && Math.hypot(nub.x - p.x, nub.y - p.y) <= 12 / viewport.zoom) {
          poseRotating = true;
        } else {
          const hit = meshPose.handleAt(p, 10 / viewport.zoom);
          activeHandle = hit !== null ? hit : meshPose.addHandleAt(p);
          poseDrag = activeHandle;
        }
        posePaint();
      } else if (!done) {
        if (poseRotating && activeHandle !== null) {
          const c = meshPose.deformed[meshPose.handles[activeHandle].vertex];
          meshPose.rotateHandle(activeHandle, Math.atan2(p.y - c.y, p.x - c.x));
          posePaint();
        } else if (poseDrag !== null) {
          meshPose.dragHandle(poseDrag, p);
          posePaint();
        }
      } else {
        poseDrag = null;
        poseRotating = false;
      }
      return;
    }
```

- [ ] **Step 5: Clear `activeHandle`/`poseRotating` where `poseDrag` is reset.** In `applyPose`, `cancelPose`, the `onPoseReset` handler, and `poseDensity` (each currently sets `poseDrag = null`), also set `activeHandle = null; poseRotating = false;`. (Search the file for `poseDrag = null;` — there are several; add the two resets alongside each in those four spots. Leave the onStroke `else { poseDrag = null; poseRotating = false; }` as written in Step 4.)

- [ ] **Step 6: Verify.** `npm run build` → 0/0 (`npx svelte-check` → `0 ERRORS 0 WARNINGS`). `npm test` → 273. Lint clean.

- [ ] **Step 7: Commit.**
```bash
git add src/lib/Canvas.svelte
git commit -m "feat: Pose rotate-nub gizmo (drag to rotate a handle)"
```

---

## Final verification

- [ ] `npm run build` → 0/0; `npm run lint` → clean; `npm test` → 273.
- [ ] **Manual (browser, `npm run dev`) — includes the spec's validation gate:**
  - Pose an outline drawing. Pin an anchor on the upper arm. Select the elbow handle (tap it) → a blue
    rotate nub appears at a fixed screen distance. Drag the nub around the elbow → the forearm/hand swing
    around the elbow with far less distortion than dragging the hand.
  - Translating a handle (drag its body) still works; adding handles still works; the nub follows the
    active handle.
  - Apply bakes; Cancel/leave-commit restore/commit as before.
  - **Validation gate:** if the limb visibly *curves* (falloff) rather than swinging acceptably on real
    art, that's the documented risk — fall back to a small explicit rotation term in `rigidFit` (spec's
    "Risks" section). Report the result either way.

## Self-Review (completed by plan author)

**Spec coverage:** per-handle `angle` + `rotateHandle` (Task 1) ✅; rotation injected via satellite into the existing `mlsRigidWeighted`/`poseWeights`, no kernel rewrite (Task 1 `solvePoseDeform`) ✅; offset-is-a-falloff-knob: pivot/anchor hold + region swings at any offset (Task 1 test 3) ✅; zero-angle == today regression (Task 1 test 1) ✅; rotate-gizmo interaction with hit priority nub→body→add, active-handle tracking, overlay (Task 2) ✅; validation gate + fallback (final manual) ✅; out-of-scope (skeleton/IK/grid-deform) untouched ✅. Refinements (pure `solvePoseDeform`, inlined `rotateVec`, nub vs ring) noted in the header.

**Placeholder scan:** No TBD/TODO; full code per step. Step 5 references "several `poseDrag = null;` spots" but enumerates exactly which four functions — concrete, not vague.

**Type consistency:** `PoseHandle` now `{ vertex; to; angle }` — `addHandleAt` sets `angle: 0`, tests build literals with `angle`, `rotateHandle` writes `angle`. `solvePoseDeform(rest, handles, from, weights, satOffset?)` signature matches its call in `solve()` and in all three tests. `poseNubPos`/`activeHandle`/`poseRotating` consistent across Canvas Steps 1–5. Reuses `mlsRigidWeighted`/`poseWeights` unchanged.
