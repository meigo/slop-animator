# Silhouette Triangulation Implementation Plan (ARAP tool part 1/3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure `triangulateSilhouette` (alpha mask → silhouette-conforming triangle mesh) + a throwaway dev viz to see/tune it.

**Architecture:** Boundary points (decimated edge pixels) ∪ interior grid samples → `delaunator` Delaunay → drop triangles whose centroid is outside the mask → reindex. Pure module `src/core/triangulate.ts`; a standalone `triangulate-viz.html` page renders it for tuning. No app wiring (that's part 3).

**Tech Stack:** TypeScript, Vitest, `delaunator`, Vite (serves any root `*.html`).

**Spec:** `docs/superpowers/specs/2026-06-26-arap-1-triangulation-design.md`

**Branch:** execute on a new branch `arap-1-triangulation` (off `main`).

**Conventions:** Husky pre-commit runs eslint+prettier (expected). Build **0/0**; lint clean; existing test baseline (244) must not drop. `delaunator` API: `import Delaunator from "delaunator"; Delaunator.from(points, p => p.x, p => p.y).triangles` → flat `Uint32Array`; triangle `t` = point indices `[triangles[3t], triangles[3t+1], triangles[3t+2]]`.

---

### Task 1: Add `delaunator`

**Files:** `package.json`, `package-lock.json`.

- [ ] **Step 1: Install** — `npm install delaunator` (runtime dep). Then `npm install -D @types/delaunator` (types).
- [ ] **Step 2: Verify** — `node -e "console.log(require('delaunator/package.json').version)"` prints a version; `npm run build` → 0/0.
- [ ] **Step 3: Commit**
```bash
git add package.json package-lock.json
git commit -m "build: add delaunator for silhouette triangulation"
```

---

### Task 2: `boundaryPoints` + `interiorPoints` (TDD)

**Files:** Create `src/core/triangulate.ts`; create `src/__tests__/triangulate.test.ts`.

- [ ] **Step 1: Write the failing tests** — `src/__tests__/triangulate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { boundaryPoints, interiorPoints } from "../core/triangulate";

// A 20×20 filled square inside a 40×40 field (inside = 10..29 in both axes).
const sq = (x: number, y: number) => x >= 10 && x <= 29 && y >= 10 && y <= 29;

describe("boundaryPoints", () => {
  it("returns points on the silhouette edge, none deep-interior", () => {
    const pts = boundaryPoints(sq, 40, 40, 6);
    expect(pts.length).toBeGreaterThan(0);
    // every boundary point is inside and touches the edge (has an outside 4-neighbor)
    for (const p of pts) {
      expect(sq(p.x, p.y)).toBe(true);
      const edge = !sq(p.x + 1, p.y) || !sq(p.x - 1, p.y) || !sq(p.x, p.y + 1) || !sq(p.x, p.y - 1);
      expect(edge).toBe(true);
    }
    // a deep-interior pixel like (20,20) is NOT a boundary point
    expect(pts.some((p) => p.x === 20 && p.y === 20)).toBe(false);
  });
  it("decimates: kept points are roughly `spacing` apart", () => {
    const pts = boundaryPoints(sq, 40, 40, 6);
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        expect(d).toBeGreaterThan(2); // no near-duplicate boundary samples
      }
  });
  it("empty mask → no points", () => {
    expect(boundaryPoints(() => false, 40, 40, 6)).toEqual([]);
  });
});

describe("interiorPoints", () => {
  it("returns inside points spaced from the boundary", () => {
    const b = boundaryPoints(sq, 40, 40, 6);
    const pts = interiorPoints(sq, 40, 40, 6, b);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      expect(sq(p.x, p.y)).toBe(true);
      for (const q of b) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(2);
    }
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run src/__tests__/triangulate.test.ts`.

- [ ] **Step 3: Implement** — `src/core/triangulate.ts`:
```ts
import Delaunator from "delaunator";

export interface Pt {
  x: number;
  y: number;
}
export interface Mesh {
  vertices: Pt[];
  triangles: [number, number, number][];
}

type Inside = (x: number, y: number) => boolean;

/** Silhouette-edge pixels (inside, with an outside 4-neighbor), greedily decimated to ~`spacing`
 *  apart via a spacing-grid bucket (one kept point per cell). */
export function boundaryPoints(inside: Inside, width: number, height: number, spacing: number): Pt[] {
  const cell = Math.max(1, spacing);
  const taken = new Set<string>();
  const out: Pt[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) continue;
      const isEdge =
        !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1);
      if (!isEdge) continue;
      const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
      if (taken.has(key)) continue;
      taken.add(key);
      out.push({ x, y });
    }
  }
  return out;
}

/** Interior grid samples (inside, at `spacing`), excluding any within ~spacing/2 of a boundary point. */
export function interiorPoints(
  inside: Inside,
  width: number,
  height: number,
  spacing: number,
  boundary: Pt[],
): Pt[] {
  const min = (spacing / 2) * (spacing / 2);
  const out: Pt[] = [];
  for (let y = spacing; y < height; y += spacing) {
    for (let x = spacing; x < width; x += spacing) {
      if (!inside(x, y)) continue;
      let tooClose = false;
      for (const b of boundary) {
        const dx = b.x - x,
          dy = b.y - y;
        if (dx * dx + dy * dy < min) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) out.push({ x, y });
    }
  }
  return out;
}
```
(`inside` must tolerate out-of-range coords → return false; callers pass such a predicate. In tests `sq` already does via the range check.)

- [ ] **Step 4: Verify** — `npx vitest run src/__tests__/triangulate.test.ts` passes; `npm run build` → 0/0.
- [ ] **Step 5: Commit**
```bash
git add src/core/triangulate.ts src/__tests__/triangulate.test.ts
git commit -m "feat: boundary + interior point sampling for silhouette triangulation"
```

---

### Task 3: `triangulateSilhouette` (assemble + Delaunay + filter + reindex) (TDD)

**Files:** Modify `src/core/triangulate.ts`, `src/__tests__/triangulate.test.ts`.

- [ ] **Step 1: Failing tests** — append:
```ts
import { triangulateSilhouette } from "../core/triangulate";

describe("triangulateSilhouette", () => {
  const sq = (x: number, y: number) => x >= 10 && x <= 29 && y >= 10 && y <= 29;
  // L-shape: full 30×30 block minus the top-right 15×15 quadrant (a concave notch).
  const L = (x: number, y: number) =>
    x >= 5 && x < 35 && y >= 5 && y < 35 && !(x >= 20 && y >= 20);

  it("meshes a filled square: all triangle centroids inside, indices valid", () => {
    const m = triangulateSilhouette(sq, 40, 40, { spacing: 6 });
    expect(m.triangles.length).toBeGreaterThan(0);
    for (const [a, b, c] of m.triangles) {
      for (const i of [a, b, c]) expect(i).toBeGreaterThanOrEqual(0), expect(i).toBeLessThan(m.vertices.length);
      const cx = (m.vertices[a].x + m.vertices[b].x + m.vertices[c].x) / 3;
      const cy = (m.vertices[a].y + m.vertices[b].y + m.vertices[c].y) / 3;
      expect(sq(Math.round(cx), Math.round(cy))).toBe(true);
    }
  });

  it("conforms to a concavity: no triangle centroid in the L's notch", () => {
    const m = triangulateSilhouette(L, 40, 40, { spacing: 5 });
    for (const [a, b, c] of m.triangles) {
      const cx = (m.vertices[a].x + m.vertices[b].x + m.vertices[c].x) / 3;
      const cy = (m.vertices[a].y + m.vertices[b].y + m.vertices[c].y) / 3;
      // notch is x>=20 && y>=20 — must contain no centroid
      expect(cx >= 20 && cy >= 20).toBe(false);
    }
  });

  it("reindex: no unused vertices", () => {
    const m = triangulateSilhouette(sq, 40, 40, { spacing: 6 });
    const used = new Set(m.triangles.flat());
    expect(used.size).toBe(m.vertices.length);
  });

  it("empty mask → empty mesh", () => {
    expect(triangulateSilhouette(() => false, 40, 40, { spacing: 6 })).toEqual({ vertices: [], triangles: [] });
  });
});
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** — append to `src/core/triangulate.ts`:
```ts
/** Triangulate the silhouette of a binary alpha mask into a conforming triangle mesh (pixel space). */
export function triangulateSilhouette(
  inside: Inside,
  width: number,
  height: number,
  opts: { spacing?: number } = {},
): Mesh {
  const spacing = Math.max(2, opts.spacing ?? 16);
  const boundary = boundaryPoints(inside, width, height, spacing);
  const interior = interiorPoints(inside, width, height, spacing, boundary);
  const pts = boundary.concat(interior);
  if (pts.length < 3) return { vertices: [], triangles: [] };

  const d = Delaunator.from(
    pts,
    (p) => p.x,
    (p) => p.y,
  );
  const tris: [number, number, number][] = [];
  for (let t = 0; t < d.triangles.length; t += 3) {
    const a = d.triangles[t],
      b = d.triangles[t + 1],
      c = d.triangles[t + 2];
    const cx = (pts[a].x + pts[b].x + pts[c].x) / 3;
    const cy = (pts[a].y + pts[b].y + pts[c].y) / 3;
    if (inside(Math.round(cx), Math.round(cy))) tris.push([a, b, c]);
  }

  // Reindex: keep only referenced vertices, compact.
  const remap = new Map<number, number>();
  const vertices: Pt[] = [];
  const triangles: [number, number, number][] = tris.map(([a, b, c]) => {
    const m = (i: number) => {
      let n = remap.get(i);
      if (n === undefined) {
        n = vertices.length;
        remap.set(i, n);
        vertices.push(pts[i]);
      }
      return n;
    };
    return [m(a), m(b), m(c)];
  });
  return { vertices, triangles };
}
```

- [ ] **Step 4: Verify** — tests pass; `npm run build` → 0/0; `npm test` → 244 + new.
- [ ] **Step 5: Commit**
```bash
git add src/core/triangulate.ts src/__tests__/triangulate.test.ts
git commit -m "feat: triangulateSilhouette (Delaunay + centroid filter + reindex)"
```

---

### Task 4: Dev visualization page

**Files:** Create `triangulate-viz.html`, `src/triangulate-viz.ts`.

- [ ] **Step 1: HTML** — `triangulate-viz.html` (repo root; Vite serves it at `/triangulate-viz.html`):
```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>triangulate viz</title>
    <style>
      body { font: 13px sans-serif; margin: 12px; }
      canvas { border: 1px solid #ccc; image-rendering: pixelated; }
      label { margin-right: 12px; }
    </style>
  </head>
  <body>
    <div>
      <label>shape <select id="shape"><option>rect</option><option>L</option><option>disc</option></select></label>
      <label>spacing <input id="spacing" type="range" min="4" max="40" value="16" /> <span id="spacingVal">16</span></label>
    </div>
    <canvas id="cv" width="300" height="300"></canvas>
    <div id="stats"></div>
    <script type="module" src="/src/triangulate-viz.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Script** — `src/triangulate-viz.ts`:
```ts
import { triangulateSilhouette } from "./core/triangulate";

const W = 300, H = 300;
const cv = document.getElementById("cv") as HTMLCanvasElement;
const ctx = cv.getContext("2d")!;
const shapeSel = document.getElementById("shape") as HTMLSelectElement;
const spacingEl = document.getElementById("spacing") as HTMLInputElement;
const spacingVal = document.getElementById("spacingVal")!;
const stats = document.getElementById("stats")!;

function paintShape(kind: string): Uint8ClampedArray {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  if (kind === "rect") ctx.fillRect(60, 60, 180, 180);
  else if (kind === "L") {
    ctx.fillRect(60, 60, 180, 180);
    ctx.clearRect(150, 150, 90, 90);
  } else {
    ctx.beginPath();
    ctx.arc(150, 150, 100, 0, Math.PI * 2);
    ctx.fill();
  }
  return ctx.getImageData(0, 0, W, H).data;
}

function render() {
  const spacing = Number(spacingEl.value);
  spacingVal.textContent = String(spacing);
  const data = paintShape(shapeSel.value);
  const inside = (x: number, y: number) =>
    x >= 0 && x < W && y >= 0 && y < H && data[(y * W + x) * 4 + 3] > 10;
  const m = triangulateSilhouette(inside, W, H, { spacing });

  // overlay the mesh on the (still-painted) shape
  ctx.strokeStyle = "rgba(0,128,255,0.8)";
  ctx.lineWidth = 1;
  for (const [a, b, c] of m.triangles) {
    const va = m.vertices[a], vb = m.vertices[b], vc = m.vertices[c];
    ctx.beginPath();
    ctx.moveTo(va.x, va.y);
    ctx.lineTo(vb.x, vb.y);
    ctx.lineTo(vc.x, vc.y);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.fillStyle = "#f00";
  for (const v of m.vertices) ctx.fillRect(v.x - 1.5, v.y - 1.5, 3, 3);
  stats.textContent = `${m.vertices.length} vertices, ${m.triangles.length} triangles`;
}

shapeSel.onchange = render;
spacingEl.oninput = render;
render();
```

- [ ] **Step 3: Verify** — `npm run build` → 0/0 (the page is a valid extra entry; it won't break the main build). `npm run dev`, open `http://localhost:5173/triangulate-viz.html`.

- [ ] **Step 4: Manual** — switch shape (rect / L / disc), drag spacing. Confirm: the mesh covers the
  shape, vertices sit **on the silhouette edge**, the **L's notch stays empty** (no triangles), the
  disc boundary is roughly round, and lowering spacing densifies. This is the quality gate — note if
  the uniform-spaced boundary looks too jagged (would justify upgrading `boundaryPoints` to
  marching-squares+DP later).

- [ ] **Step 5: Commit**
```bash
git add triangulate-viz.html src/triangulate-viz.ts
git commit -m "chore: dev viz for silhouette triangulation"
```

---

## Final verification

- [ ] `npm run build` → 0/0; `npm test` → 244 + new triangulate tests; `npm run lint` → clean.
- [ ] Dev viz (Task 4 Step 4) confirmed — mesh conforms to rect/L/disc, boundary on the silhouette,
      density tunable.

## Self-Review (completed by plan author)

**Spec coverage:** `triangulateSilhouette(inside,w,h,opts) → {vertices, triangles}` (T3) ✅; boundary-by-decimation + interior samples (T2, the spec's revised pipeline) ✅; Delaunay via `delaunator` (T1 dep, T3 use) ✅; centroid filter for concavity conformance (T3 + L-shape test) ✅; reindex/no-unused-vertices (T3 + test) ✅; `spacing` density knob (T2/T3) ✅; pixel-space output (no coord mapping — deferred to part 3) ✅; throwaway dev viz with shape + spacing controls (T4) ✅; pure unit tests on synthetic masks (T2/T3) ✅; out-of-scope (geodesic/deform/solver, tool, coord mapping, CDT) absent ✅.

**Placeholder scan:** No TBD/TODO; every code step is complete. The "swappable boundary" note is a design property, not a deferred task.

**Type consistency:** `Pt {x,y}` / `Mesh {vertices: Pt[]; triangles: [number,number,number][]}` defined in T2/T3 and asserted in tests. `boundaryPoints(inside,w,h,spacing): Pt[]` and `interiorPoints(inside,w,h,spacing,boundary): Pt[]` (T2) consumed by `triangulateSilhouette` (T3). `Inside = (x,y)=>boolean` used consistently. `delaunator` `.triangles` flat-array consumption matches its API (header note).
