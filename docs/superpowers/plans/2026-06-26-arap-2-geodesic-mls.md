# Geodesic-Weighted MLS Implementation Plan (ARAP/Pose tool part 2/3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pure geodesic-weighted MLS deformation for the silhouette mesh — a shared rigid kernel (`mlsRigidWeighted`) plus `geodesicDistances` (Dijkstra over mesh edges) plus `deformMeshGeodesic`.

**Architecture:** Refactor `mls.ts` to extract a shared per-point rigid fit, keeping `mlsRigid` behavior-identical and adding a precomputed-weights variant. A new `src/core/geodesic.ts` builds the mesh edge graph, runs Dijkstra, turns geodesic distances into MLS weights, and calls the weighted kernel. All pure + unit-tested; no app wiring (that's part 3).

**Tech Stack:** TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-26-arap-2-geodesic-mls-design.md`

**Branch:** execute on a new branch `arap-2-geodesic-mls` (off `main`).

**Conventions:** Husky pre-commit runs eslint+prettier (expected). Build **0/0**; lint clean; baseline **252** must not drop. `Mesh = { vertices: Pt[]; triangles: [number,number,number][] }` and `Pt = {x,y}` are exported from `src/core/triangulate.ts`; `Pt` is also exported from `src/core/mls.ts` (structurally identical). The existing 5 `mlsRigid` tests are the refactor's regression guard.

---

### Task 1: Refactor `mls.ts` — shared kernel + `mlsRigidWeighted` (TDD)

**Files:** Modify `src/core/mls.ts`, `src/__tests__/mls.test.ts`.

- [ ] **Step 1: Write failing tests** — append to `src/__tests__/mls.test.ts`:
```ts
import { mlsRigidWeighted } from "../core/mls";

describe("mlsRigidWeighted", () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }];
  const from = [{ x: 0, y: 0 }];
  const to = [{ x: 3, y: 4 }];

  it("Infinity weight maps a point exactly to that handle's target", () => {
    const out = mlsRigidWeighted(pts, from, to, [[Infinity], [1], [1]]);
    expect(out[0]).toEqual({ x: 3, y: 4 });
  });
  it("all-zero weight row leaves the point unchanged", () => {
    const out = mlsRigidWeighted(pts, from, to, [[0], [0], [0]]);
    out.forEach((p, i) => {
      expect(p.x).toBeCloseTo(pts[i].x, 6);
      expect(p.y).toBeCloseTo(pts[i].y, 6);
    });
  });
  it("a single handle (any positive weights) translates uniformly", () => {
    const out = mlsRigidWeighted(pts, from, to, [[1], [2], [0.5]]);
    out.forEach((p, i) => {
      expect(p.x).toBeCloseTo(pts[i].x + 3, 6);
      expect(p.y).toBeCloseTo(pts[i].y + 4, 6);
    });
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run src/__tests__/mls.test.ts` (`mlsRigidWeighted` missing).

- [ ] **Step 3: Refactor** — rewrite `src/core/mls.ts` so the centroid→rotation math is a shared `rigidFit`, `mlsRigid` is behavior-identical, and `mlsRigidWeighted` is added:
```ts
// Moving Least Squares RIGID deformation (Schaefer et al. 2006). Closed-form per point — no solver.
// Used by the grid Deform tool ("rigid" mode) and the silhouette Pose tool (geodesic weights).

export interface Pt {
  x: number;
  y: number;
}

/** Rigid fit for one point given per-handle weights `w` and their sum `sw`. sw===0 ⇒ point unchanged. */
function rigidFit(v: Pt, from: Pt[], to: Pt[], w: number[], sw: number): Pt {
  if (sw === 0) return { x: v.x, y: v.y };
  const n = from.length;
  let pcx = 0,
    pcy = 0,
    qcx = 0,
    qcy = 0;
  for (let i = 0; i < n; i++) {
    pcx += w[i] * from[i].x;
    pcy += w[i] * from[i].y;
    qcx += w[i] * to[i].x;
    qcy += w[i] * to[i].y;
  }
  pcx /= sw;
  pcy /= sw;
  qcx /= sw;
  qcy /= sw;
  let a = 0,
    b = 0;
  for (let i = 0; i < n; i++) {
    const phx = from[i].x - pcx,
      phy = from[i].y - pcy;
    const qhx = to[i].x - qcx,
      qhy = to[i].y - qcy;
    a += w[i] * (phx * qhx + phy * qhy);
    b += w[i] * (phx * qhy - phy * qhx);
  }
  let cos = 1,
    sin = 0;
  const r = Math.hypot(a, b);
  if (r > 0) {
    cos = a / r;
    sin = b / r;
  }
  const vx = v.x - pcx,
    vy = v.y - pcy;
  return { x: cos * vx - sin * vy + qcx, y: sin * vx + cos * vy + qcy };
}

/** Deform each point given handle correspondences from[i] → to[i], weighting by 1/|p−v|^(2α). */
export function mlsRigid(points: Pt[], from: Pt[], to: Pt[], alpha = 1): Pt[] {
  return points.map((v) => {
    const n = from.length;
    const w = new Array<number>(n);
    let sw = 0;
    for (let i = 0; i < n; i++) {
      const dx = from[i].x - v.x,
        dy = from[i].y - v.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 1e-12) return { x: to[i].x, y: to[i].y }; // coincident handle → exact
      const wi = 1 / Math.pow(d2, alpha);
      w[i] = wi;
      sw += wi;
    }
    return rigidFit(v, from, to, w, sw);
  });
}

/** Rigid MLS with PRECOMPUTED weights. weights[i][h] = weight of handle h for point i.
 *  weights[i][h] === Infinity ⇒ point i maps exactly to to[h]; an all-zero row ⇒ point unchanged. */
export function mlsRigidWeighted(points: Pt[], from: Pt[], to: Pt[], weights: number[][]): Pt[] {
  return points.map((v, pi) => {
    const n = from.length;
    const row = weights[pi];
    const w = new Array<number>(n);
    let sw = 0;
    for (let i = 0; i < n; i++) {
      const wi = row[i];
      if (wi === Infinity) return { x: to[i].x, y: to[i].y }; // coincident handle → exact
      w[i] = wi;
      sw += wi;
    }
    return rigidFit(v, from, to, w, sw);
  });
}
```

- [ ] **Step 4: Verify** — `npx vitest run src/__tests__/mls.test.ts` → ALL pass (the original 5 `mlsRigid` tests unchanged + the 3 new). `npm run build` → 0/0.
- [ ] **Step 5: Commit**
```bash
git add src/core/mls.ts src/__tests__/mls.test.ts
git commit -m "refactor: shared rigid kernel + mlsRigidWeighted (precomputed weights)"
```

---

### Task 2: `geodesic.ts` — distances + `deformMeshGeodesic` (TDD)

**Files:** Create `src/core/geodesic.ts`; create `src/__tests__/geodesic.test.ts`.

- [ ] **Step 1: Write failing tests** — `src/__tests__/geodesic.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { geodesicDistances, deformMeshGeodesic } from "../core/geodesic";
import { triangulateSilhouette, type Mesh } from "../core/triangulate";

const tri = (a: number, b: number, c: number) => [a, b, c] as [number, number, number];

describe("geodesicDistances", () => {
  it("single triangle: distances are edge lengths", () => {
    const mesh: Mesh = { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], triangles: [tri(0, 1, 2)] };
    const d = geodesicDistances(mesh, [0]);
    expect(d[0][0]).toBe(0);
    expect(d[0][1]).toBeCloseTo(10, 6);
    expect(d[0][2]).toBeCloseTo(10, 6);
  });
  it("two-triangle strip: shortest path along edges", () => {
    const mesh: Mesh = {
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }],
      triangles: [tri(0, 1, 2), tri(1, 3, 2)],
    };
    expect(geodesicDistances(mesh, [0])[0][3]).toBeCloseTo(20, 6); // 0→1→3 or 0→2→3
  });
  it("disconnected vertex → Infinity", () => {
    const mesh: Mesh = {
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 99, y: 99 }],
      triangles: [tri(0, 1, 2)],
    };
    expect(geodesicDistances(mesh, [0])[0][3]).toBe(Infinity);
  });
});

describe("deformMeshGeodesic", () => {
  const mesh: Mesh = {
    vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }],
    triangles: [tri(0, 1, 2), tri(1, 3, 2)],
  };
  it("a handle vertex lands exactly on its target", () => {
    const out = deformMeshGeodesic(mesh, [{ vertex: 0, to: { x: -5, y: -5 } }]);
    expect(out[0].x).toBeCloseTo(-5, 6);
    expect(out[0].y).toBeCloseTo(-5, 6);
  });
  it("a single handle translates the connected component", () => {
    const out = deformMeshGeodesic(mesh, [{ vertex: 0, to: { x: 2, y: 3 } }]);
    out.forEach((p, i) => {
      expect(p.x).toBeCloseTo(mesh.vertices[i].x + 2, 6);
      expect(p.y).toBeCloseTo(mesh.vertices[i].y + 3, 6);
    });
  });
  it("an unhandled disjoint component stays at rest", () => {
    const m2: Mesh = {
      vertices: [...mesh.vertices, { x: 50, y: 50 }, { x: 60, y: 50 }, { x: 50, y: 60 }],
      triangles: [...mesh.triangles, tri(4, 5, 6)],
    };
    const out = deformMeshGeodesic(m2, [{ vertex: 0, to: { x: 2, y: 3 } }]);
    for (const i of [4, 5, 6]) {
      expect(out[i].x).toBeCloseTo(m2.vertices[i].x, 6);
      expect(out[i].y).toBeCloseTo(m2.vertices[i].y, 6);
    }
  });

  it("geodesic beats Euclidean: a U-mesh's far tip barely moves vs its near tip", () => {
    // U opening upward: outer 30×30 minus a top-center slot (x 10..20, y 0..20). Two arms joined at base.
    const inside = (x: number, y: number) =>
      x >= 0 && x < 30 && y >= 0 && y < 30 && !(x >= 10 && x < 20 && y < 20);
    const m = triangulateSilhouette(inside, 30, 30, { spacing: 4 });
    const nearest = (px: number, py: number) => {
      let best = 0,
        bd = Infinity;
      m.vertices.forEach((v, i) => {
        const d = (v.x - px) ** 2 + (v.y - py) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      return best;
    };
    const leftTip = nearest(5, 1); // top of left arm
    const rightTip = nearest(25, 1); // top of right arm (Euclidean-close, mesh-far)
    const out = deformMeshGeodesic(m, [{ vertex: leftTip, to: { x: m.vertices[leftTip].x, y: m.vertices[leftTip].y - 12 } }]);
    const leftMove = Math.hypot(out[leftTip].x - m.vertices[leftTip].x, out[leftTip].y - m.vertices[leftTip].y);
    const rightMove = Math.hypot(out[rightTip].x - m.vertices[rightTip].x, out[rightTip].y - m.vertices[rightTip].y);
    expect(leftMove).toBeGreaterThan(10); // the dragged tip moves
    expect(rightMove).toBeLessThan(leftMove * 0.5); // the geodesically-far tip lags far behind
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run src/__tests__/geodesic.test.ts`.

- [ ] **Step 3: Implement** — `src/core/geodesic.ts`:
```ts
import type { Mesh } from "./triangulate";
import { mlsRigidWeighted, type Pt } from "./mls";

export interface MeshHandle {
  vertex: number;
  to: Pt;
}

/** Geodesic distance from each source vertex to every vertex, via Dijkstra over the mesh edge graph
 *  (edge weight = Euclidean length). dist[s][v]; Infinity if unreachable. */
export function geodesicDistances(mesh: Mesh, sources: number[]): number[][] {
  const V = mesh.vertices.length;
  const adj: { to: number; w: number }[][] = Array.from({ length: V }, () => []);
  const seen = new Set<number>();
  const addEdge = (a: number, b: number) => {
    const key = a < b ? a * V + b : b * V + a;
    if (seen.has(key)) return;
    seen.add(key);
    const w = Math.hypot(mesh.vertices[a].x - mesh.vertices[b].x, mesh.vertices[a].y - mesh.vertices[b].y);
    adj[a].push({ to: b, w });
    adj[b].push({ to: a, w });
  };
  for (const [a, b, c] of mesh.triangles) {
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  return sources.map((s) => dijkstra(adj, V, s));
}

function dijkstra(adj: { to: number; w: number }[][], V: number, src: number): number[] {
  const dist = new Array<number>(V).fill(Infinity);
  const done = new Array<boolean>(V).fill(false);
  dist[src] = 0;
  for (let iter = 0; iter < V; iter++) {
    let u = -1,
      best = Infinity;
    for (let i = 0; i < V; i++) if (!done[i] && dist[i] < best) ((best = dist[i]), (u = i));
    if (u === -1) break;
    done[u] = true;
    for (const e of adj[u]) {
      const nd = dist[u] + e.w;
      if (nd < dist[e.to]) dist[e.to] = nd;
    }
  }
  return dist;
}

/** Deform a mesh's vertices from vertex-anchored handles, weighting by geodesic distance. Pure. */
export function deformMeshGeodesic(mesh: Mesh, handles: MeshHandle[], alpha = 1): Pt[] {
  if (handles.length === 0) return mesh.vertices.map((v) => ({ x: v.x, y: v.y }));
  const dist = geodesicDistances(
    mesh,
    handles.map((h) => h.vertex),
  );
  const from = handles.map((h) => mesh.vertices[h.vertex]);
  const to = handles.map((h) => h.to);
  const weights = mesh.vertices.map((_, v) =>
    handles.map((_, h) => {
      const g = dist[h][v];
      return g === 0 ? Infinity : g === Infinity ? 0 : 1 / Math.pow(g, 2 * alpha);
    }),
  );
  return mlsRigidWeighted(mesh.vertices, from, to, weights);
}
```

- [ ] **Step 4: Verify** — `npx vitest run src/__tests__/geodesic.test.ts` → all pass (esp. the U-mesh validating test). `npm run build` → 0/0; `npm test` → 252 + Task 1's 3 + these (no drop); `npm run lint` → clean.
- [ ] **Step 5: Commit**
```bash
git add src/core/geodesic.ts src/__tests__/geodesic.test.ts
git commit -m "feat: geodesicDistances + deformMeshGeodesic (silhouette-aware MLS)"
```

---

## Final verification

- [ ] `npm run build` → 0/0; `npm test` → baseline + new (incl. the U-mesh geodesic>Euclidean test); `npm run lint` → clean.
- [ ] The 5 original `mlsRigid` tests still pass (refactor regression guard).

## Self-Review (completed by plan author)

**Spec coverage:** `geodesicDistances(mesh, sources)` Dijkstra over deduped triangle edges, Euclidean weights, Infinity-unreachable (T2) ✅; `mls.ts` shared `rigidFit` kernel + `mlsRigidWeighted` with Infinity-coincidence / zero-row-rest, `mlsRigid` behavior-identical (T1) ✅; `deformMeshGeodesic` handles@vertices, weight `1/g^(2α)`, the two confirmed fallbacks emergent from Infinity/0 (T2) ✅; prefactor separation (`geodesicDistances` vs kernel kept distinct) ✅; tests incl. the U-mesh geodesic>Euclidean validating test + regression guard (T1/T2) ✅; out-of-scope (tool/render/bake, arbitrary handles, ARAP) absent ✅.

**Placeholder scan:** No TBD/TODO; full code in every step.

**Type consistency:** `Pt {x,y}` (from `mls.ts`) and `Mesh` (from `triangulate.ts`) used consistently; `MeshHandle {vertex, to}` defined in geodesic.ts and used in its tests. `mlsRigidWeighted(points, from, to, weights: number[][])` defined T1, called in `deformMeshGeodesic` T2 with a `vertices×handles` weight matrix. `rigidFit` is module-private (not exported), shared by both public MLS functions. The `tri()` test helper casts `[a,b,c]` to the tuple type to satisfy `Mesh.triangles`.
