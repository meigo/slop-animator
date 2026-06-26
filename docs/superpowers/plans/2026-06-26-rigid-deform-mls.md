# Rigid Deform Mode (MLS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Rigid** deform mode (MLS) beside the existing FFD mode — pin grid handles and drag one, the mesh follows rigidly.

**Architecture:** A new pure solver `src/core/mls.ts` (`mlsRigid`). One `deformMode` branch in `selection.ts`'s grid-`updateDrag` (FFD = move one point; Rigid = MLS-solve all from pinned + dragged handles), plus a pin set, a captured rest grid, filled pin markers, and an FFD/Rigid toggle + Reset-pins in the warp panel. FFD and the whole warp/lift/render/bake pipeline are untouched.

**Tech Stack:** TypeScript, Svelte 5 runes, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-26-rigid-deform-mls-design.md`

**Branch:** execute on a new branch `rigid-deform-mls` (off `main`).

**Conventions:** Canvas imports `state` unaliased; SelectionActions imports `state as appState`. Husky pre-commit runs eslint+prettier (expected). Build **0/0**; lint clean; existing test baseline stays green (it's ~244 after Task 1 adds tests — use whatever `npm test` reports, must not drop). Verified `selection.ts` internals: `Pt = {x,y}`; `identity(): Mat`; `sampleGrid(rect, m, rows, cols): Pt[][]`; `warpGrid`/`warpGridStart: Pt[][]`; `warpRows`/`warpCols`; `dragGridIdx: {row,col}|null`; `drawHandle(ctx, x, y, shape)`; `drawOverlay()`; `beginWarp`/`densifyWarp`/`clear`/`updateDrag`/`endDrag`.

---

### Task 1: `src/core/mls.ts` — rigid MLS solver (TDD)

**Files:** Create `src/core/mls.ts`; create `src/__tests__/mls.test.ts`.

- [ ] **Step 1: Write the failing tests** — `src/__tests__/mls.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mlsRigid } from "../core/mls";

const grid = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 0, y: 10 },
  { x: 10, y: 10 },
];

describe("mlsRigid", () => {
  it("identity when handles are unmoved", () => {
    const out = mlsRigid(grid, [{ x: 0, y: 0 }], [{ x: 0, y: 0 }]);
    out.forEach((p, i) => {
      expect(p.x).toBeCloseTo(grid[i].x, 6);
      expect(p.y).toBeCloseTo(grid[i].y, 6);
    });
  });

  it("a single handle translates the whole shape", () => {
    const out = mlsRigid(grid, [{ x: 0, y: 0 }], [{ x: 5, y: 7 }]);
    out.forEach((p, i) => {
      expect(p.x).toBeCloseTo(grid[i].x + 5, 6);
      expect(p.y).toBeCloseTo(grid[i].y + 7, 6);
    });
  });

  it("two handles moved by the same delta translate uniformly", () => {
    const out = mlsRigid(grid, [{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 2, y: 3 }, { x: 12, y: 3 }]);
    out.forEach((p, i) => {
      expect(p.x).toBeCloseTo(grid[i].x + 2, 6);
      expect(p.y).toBeCloseTo(grid[i].y + 3, 6);
    });
  });

  it("places a handle vertex exactly on its target (coincidence)", () => {
    const out = mlsRigid(grid, [{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 0 }, { x: 10, y: 5 }]);
    expect(out[0].x).toBeCloseTo(0, 6);
    expect(out[0].y).toBeCloseTo(0, 6);
    expect(out[1].x).toBeCloseTo(10, 6);
    expect(out[1].y).toBeCloseTo(5, 6);
  });

  it("a two-handle rotation places handles exactly and keeps free points finite", () => {
    // anchor (0,0)->(0,0), drag (10,0)->(0,10): a 90° rotation about origin
    const out = mlsRigid(grid, [{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 0 }, { x: 0, y: 10 }]);
    expect(out[0].x).toBeCloseTo(0, 6);
    expect(out[0].y).toBeCloseTo(0, 6);
    expect(out[1].x).toBeCloseTo(0, 6);
    expect(out[1].y).toBeCloseTo(10, 6);
    expect(Number.isFinite(out[3].x) && Number.isFinite(out[3].y)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run src/__tests__/mls.test.ts`.

- [ ] **Step 3: Implement** — `src/core/mls.ts`:
```ts
// Moving Least Squares RIGID deformation (Schaefer et al. 2006). Closed-form per point — no solver.
// Used by the Deform tool's "rigid" mode to pose a grid mesh from pinned + dragged handles.

export interface Pt {
  x: number;
  y: number;
}

/** Deform each point in `points` given handle correspondences from[i] → to[i]. Pure. */
export function mlsRigid(points: Pt[], from: Pt[], to: Pt[], alpha = 1): Pt[] {
  return points.map((v) => {
    const n = from.length;
    const w: number[] = new Array(n);
    let sw = 0;
    for (let i = 0; i < n; i++) {
      const dx = from[i].x - v.x;
      const dy = from[i].y - v.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 1e-12) return { x: to[i].x, y: to[i].y }; // coincident handle → exact
      const wi = 1 / Math.pow(d2, alpha); // 1 / |p - v|^(2*alpha)
      w[i] = wi;
      sw += wi;
    }
    if (sw === 0) return { x: v.x, y: v.y }; // no handles → unchanged

    let pcx = 0, pcy = 0, qcx = 0, qcy = 0;
    for (let i = 0; i < n; i++) {
      pcx += w[i] * from[i].x;
      pcy += w[i] * from[i].y;
      qcx += w[i] * to[i].x;
      qcy += w[i] * to[i].y;
    }
    pcx /= sw; pcy /= sw; qcx /= sw; qcy /= sw;

    let a = 0, b = 0;
    for (let i = 0; i < n; i++) {
      const phx = from[i].x - pcx, phy = from[i].y - pcy;
      const qhx = to[i].x - qcx, qhy = to[i].y - qcy;
      a += w[i] * (phx * qhx + phy * qhy);
      b += w[i] * (phx * qhy - phy * qhx);
    }
    let cos = 1, sin = 0;
    const r = Math.hypot(a, b);
    if (r > 0) { cos = a / r; sin = b / r; }

    const vx = v.x - pcx, vy = v.y - pcy;
    return { x: cos * vx - sin * vy + qcx, y: sin * vx + cos * vy + qcy };
  });
}
```

- [ ] **Step 4: Verify** — `npx vitest run src/__tests__/mls.test.ts` passes; `npm run build` → 0/0.
- [ ] **Step 5: Commit**
```bash
git add src/core/mls.ts src/__tests__/mls.test.ts
git commit -m "feat: MLS rigid deformation solver"
```

---

### Task 2: `selection.ts` — rigid mode, pins, rest grid, overlay

**Files:** Modify `src/core/selection.ts`.

- [ ] **Step 1: Import + fields** — add `import { mlsRigid } from "./mls";` (top, near other imports). Add fields to the `Selection` class (near `warpGrid`/`warpRows`):
```ts
  deformMode: "ffd" | "rigid" = "ffd";
  warpRest: Pt[][] = []; // uniform rest grid captured at beginWarp/densify (rigid source)
  pinned = new Map<number, Pt>(); // flat index (row*cols + col) → pinned CSS position (rigid mode)
```

- [ ] **Step 2: Capture rest grid + clear pins on (re)grid** — in `beginWarp`, after `this.warpGrid = sampleGrid(...)` and setting rows/cols, add:
```ts
    this.warpRest = sampleGrid(this.rect, identity(), rows, cols);
    this.pinned.clear();
```
In `densifyWarp`, after it resamples `this.warpGrid` and sets `warpRows`/`warpCols`, add (indices change → pins invalid):
```ts
    this.warpRest = sampleGrid(this.rect, identity(), rows, cols);
    this.pinned.clear();
```
(`this.rect` is non-null in both — they early-return otherwise.)

- [ ] **Step 3: Reset deform state in `clear()`** — in the private `clear()`, alongside the other warp resets, add:
```ts
    this.deformMode = "ffd";
    this.warpRest = [];
    this.pinned.clear();
```

- [ ] **Step 4: Rigid branch in `updateDrag`** — the current grid branch is:
```ts
      } else if (this.dragging === "grid" && this.dragGridIdx) {
        const { row, col } = this.dragGridIdx;
        this.warpGrid = this.warpGridStart.map((rArr, r) =>
          rArr.map((p, c) => (r === row && c === col ? { x: p.x + dx, y: p.y + dy } : { ...p })),
        );
      }
```
Replace with:
```ts
      } else if (this.dragging === "grid" && this.dragGridIdx) {
        const { row, col } = this.dragGridIdx;
        if (this.deformMode === "rigid") {
          const cols = this.warpCols;
          const idx = row * cols + col;
          const rest = this.warpRest.flat();
          const target = { x: this.warpGridStart[row][col].x + dx, y: this.warpGridStart[row][col].y + dy };
          const from: Pt[] = [];
          const to: Pt[] = [];
          for (const [i, pos] of this.pinned) {
            if (i !== idx) { from.push(rest[i]); to.push(pos); }
          }
          from.push(rest[idx]);
          to.push(target);
          const deformed = mlsRigid(rest, from, to);
          this.warpGrid = this.warpRest.map((rArr, r) => rArr.map((_, c) => deformed[r * cols + c]));
        } else {
          this.warpGrid = this.warpGridStart.map((rArr, r) =>
            rArr.map((p, c) => (r === row && c === col ? { x: p.x + dx, y: p.y + dy } : { ...p })),
          );
        }
      }
```

- [ ] **Step 5: Pin the dragged point on drag end** — in `endDrag()`, BEFORE it clears `this.dragging`/`this.dragGridIdx`, add:
```ts
    if (this.state === "warping" && this.deformMode === "rigid" && this.dragging === "grid" && this.dragGridIdx) {
      const { row, col } = this.dragGridIdx;
      this.pinned.set(row * this.warpCols + col, { ...this.warpGrid[row][col] });
      this.drawOverlay();
    }
```
(Read `endDrag()` first to place this before the reset lines; if it has no body to hook, add the block at its top.)

- [ ] **Step 6: Public methods** — add (near `densifyWarp`):
```ts
  setDeformMode(m: "ffd" | "rigid") {
    this.deformMode = m;
    this.drawOverlay();
    this.onChange?.();
  }
  resetPins() {
    this.pinned.clear();
    this.drawOverlay();
    this.onChange?.();
  }
```

- [ ] **Step 7: Filled pin markers** — extend `drawHandle`'s shape union to `"square" | "circle" | "pin"` and add the `pin` case (a solid black square with white outline):
```ts
    if (shape === "pin") {
      ctx.fillStyle = "#000";
      ctx.fillRect(x - HANDLE_SIZE / 2, y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - HANDLE_SIZE / 2, y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    } else if (shape === "square") {
      // …existing square body…
    } else {
      // …existing circle body…
    }
```
In `drawOverlay`'s warping grid-handle loop, replace `this.drawHandle(ctx, grid[r][c].x, grid[r][c].y, "square")` with:
```ts
          const isPinned = this.deformMode === "rigid" && this.pinned.has(r * this.warpCols + c);
          this.drawHandle(ctx, grid[r][c].x, grid[r][c].y, isPinned ? "pin" : "square");
```

- [ ] **Step 8: Verify** — `npm run build` → 0/0; `npm test` → baseline (no new failures); `npm run lint` → clean.
- [ ] **Step 9: Commit**
```bash
git add src/core/selection.ts
git commit -m "feat: selection — rigid deform mode (MLS), pin set, rest grid, pin markers"
```

---

### Task 3: Panel toggle + Reset pins + Canvas wiring

**Files:** Modify `src/lib/SelectionActions.svelte`, `src/lib/Canvas.svelte`.

- [ ] **Step 1: SelectionActions props** — add to the props destructure: `onSetDeformMode,` and `onResetPins,`; and to the type:
```ts
    onSetDeformMode: (m: "ffd" | "rigid") => void;
    onResetPins: () => void;
```

- [ ] **Step 2: Sync `deformMode`** — add `let deformMode = $state<"ffd" | "rigid">("ffd");` near the other `$state`; in the tick sync block (where `warp = { rows, cols }` is set), add:
```ts
        deformMode = selection.deformMode;
```

- [ ] **Step 3: Toggle + Reset pins markup** — inside the existing `{#if mode === "warping"}` block (near the −/+ density buttons), add:
```svelte
    <div class="flex rounded border border-border overflow-hidden text-xs">
      <button class="px-2 py-1" class:bg-surface-active={deformMode === "ffd"} onpointerdown={tap(() => onSetDeformMode("ffd"))}>FFD</button>
      <button class="px-2 py-1" class:bg-surface-active={deformMode === "rigid"} onpointerdown={tap(() => onSetDeformMode("rigid"))}>Rigid</button>
    </div>
    {#if deformMode === "rigid"}
      <button class="px-2 py-1 text-xs border border-border rounded bg-surface" title="Clear pinned handles" onpointerdown={tap(onResetPins)}>Reset pins</button>
    {/if}
```

- [ ] **Step 4: Canvas wiring** — on the `<SelectionActions … />` element (near the existing `onDensify={…}`), add:
```svelte
    onSetDeformMode={(m) => selection?.setDeformMode(m)}
    onResetPins={() => selection?.resetPins()}
```

- [ ] **Step 5: Verify** — `npm run build` → 0/0; `npm test` → baseline; `npm run lint` → clean.
- [ ] **Step 6: Manual (browser, `npm run dev`)**
  - Deform a drawing → panel shows **FFD / Rigid** + −/+. In **Rigid**: drag a point → whole shape
    moves rigidly (no pins); release → that point shows **filled**; drag another → the shape bends
    as-rigidly-as-possible between the two (limb-posing). **Reset pins** clears anchors.
  - **FFD** unchanged (drag = move one point). Toggling FFD↔Rigid preserves the current pose. −/+
    density works (resets pins in Rigid). Apply bakes (one undo); Cancel/Esc restores. Smooth on iPad.
- [ ] **Step 7: Commit**
```bash
git add src/lib/SelectionActions.svelte src/lib/Canvas.svelte
git commit -m "feat: deform FFD/Rigid toggle + Reset pins"
```

---

## Final verification

- [ ] `npm run build` → 0/0; `npm test` → baseline + 5 new `mls` tests; `npm run lint` → clean.
- [ ] Manual checklist (Task 3 Step 6) confirmed — rigid posing, pins, FFD parity, density, Apply/Cancel.

## Self-Review (completed by plan author)

**Spec coverage:** `mlsRigid` pure solver with the closed-form weighted-Procrustes rotation + coincidence rule (T1) ✅; `deformMode` branch in grid `updateDrag` (T2.4) ✅; pin accumulation on drag-end + Reset (T2.5/T2.6) ✅; rest-grid capture via `sampleGrid(rect, identity, …)` + clear on densify (T2.2) ✅; FFD untouched (else-branch verbatim) ✅; filled pin markers (T2.7) ✅; FFD/Rigid toggle + Reset-pins panel + Canvas wiring (T3) ✅; toggle preserves pose / pins empty on entry (clear resets to ffd; toggle only flips mode, keeps warpGrid) ✅; no new persistence (nothing added) ✅; solver unit-tested, rest build/manual (T1 + T3 manual) ✅; out-of-scope (silhouette/ARAP, unpin, stiffness, persistence) absent ✅.

**Placeholder scan:** No TBD/TODO. The two "read the method first" notes (`endDrag` placement, the existing square/circle bodies in `drawHandle`) are explicit adapt-in-place instructions with the surrounding code shown, not gaps.

**Type consistency:** `mlsRigid(points, from, to, alpha?) : Pt[]` (T1) called in `selection.ts` (T2.4) with `Pt[]` from `warpRest.flat()` (structurally identical `{x,y}`). `deformMode: "ffd"|"rigid"` defined (T2.1) and read in updateDrag/endDrag/drawOverlay (T2), synced in the panel (T3.2), set via `setDeformMode` (T2.6) wired from Canvas (T3.4). `pinned: Map<number, Pt>` keyed by `row*cols+col` consistently in updateDrag/endDrag/drawOverlay. `drawHandle` shape union extended to include `"pin"` (T2.7) and used in the loop (T2.7).
