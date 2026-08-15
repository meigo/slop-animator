# Pose: fill outlines — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Outline-only drawings pose as a body instead of a thin web, by treating ink-enclosed space as part of the mesh — without altering a single pixel of the artwork.

**Architecture:** A pure `fillEnclosed` over the lifted bitmap's alpha returns a mask (ink ∪ enclosed regions). `MeshPose.fromLift` builds its `inside` predicate from that mask instead of raw alpha. Everything downstream — triangulation, geodesic weighting, baking — is untouched.

**Tech Stack:** TypeScript, Vitest (node, no DOM), Svelte 5 runes.

**Spec:** `docs/superpowers/specs/2026-08-15-pose-fill-outlines-design.md` — read it, especially the measured table. The algorithm's ORDER was falsified once already; do not rearrange it from intuition.

## Global Constraints

- `npm test` — currently **461 passing**. Must not go down.
- `npm run build` (`svelte-check && tsc --noEmit && vite build`) — **0 errors, 0 warnings**, every task.
- **Change no pixels.** This feature only ever computes a mask. If a diff writes to a canvas, it is wrong.
- Vitest is node-only, no DOM. Tasks 1–2 are pure and MUST be unit-tested. Tasks 3–4 touch Svelte/canvas and get build + review gates — do NOT add jsdom or a browser runner for them.
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. One commit per task. A pre-commit hook reformats staged files; expected.
- Do not merge to `main` unless asked.

## File map

| File | Role |
|---|---|
| `src/core/mask-ops.ts` | **New.** `dilateMask` (moved from `fill.ts`) + `erodeMask` |
| `src/__tests__/mask-ops.test.ts` | **New.** Dilate/erode unit tests |
| `src/core/fill.ts` | Imports `dilateMask` instead of defining it |
| `src/core/fill-holes.ts` | **New.** `fillEnclosed` — pad, dilate, flood, erode, union |
| `src/__tests__/fill-holes.test.ts` | **New.** The measured fixtures from the spec |
| `src/core/mesh-pose.ts` | `fromLift` takes `{ fillHoles, gap }`, builds `inside` from the mask |
| `src/state/appState.svelte.ts` | `state.pose = { fillHoles, gap }` |
| `src/lib/Canvas.svelte` | Pass the options at both `fromLift` sites; pose-bar controls; the report |

---

### Task 1: Shared mask operations

**Files:**
- Create: `src/core/mask-ops.ts`, `src/__tests__/mask-ops.test.ts`
- Modify: `src/core/fill.ts` (delete the local `dilateMask` at ~:181, import instead)

**Interfaces:**
- Produces: `dilateMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array` and `erodeMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array`. Task 2 consumes both.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/mask-ops.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dilateMask, erodeMask } from "../core/mask-ops";

/** Build a mask from ASCII art: '#' set, anything else clear. */
function grid(rows: string[]): { m: Uint8Array; w: number; h: number } {
  const h = rows.length,
    w = rows[0].length;
  const m = new Uint8Array(w * h);
  rows.forEach((r, y) => [...r].forEach((c, x) => (m[y * w + x] = c === "#" ? 1 : 0)));
  return { m, w, h };
}
const count = (m: Uint8Array) => m.reduce((n, v) => n + v, 0);

describe("dilateMask", () => {
  it("radius 0 is the identity", () => {
    const { m, w, h } = grid(["...", ".#.", "..."]);
    expect([...dilateMask(m, w, h, 0)]).toEqual([...m]);
  });

  it("radius 1 grows a single pixel into a plus (circular structuring element)", () => {
    const { m, w, h } = grid([".....", ".....", "..#..", ".....", "....."]);
    const d = dilateMask(m, w, h, 1);
    expect(count(d)).toBe(5); // centre + 4 orthogonal; the diagonals are at distance √2 > 1
    expect(d[2 * w + 2]).toBe(1);
    expect(d[1 * w + 2]).toBe(1);
    expect(d[1 * w + 1]).toBe(0);
  });

  it("clips at the bitmap edge rather than wrapping", () => {
    const { m, w, h } = grid(["#..", "...", "..."]);
    const d = dilateMask(m, w, h, 1);
    expect(count(d)).toBe(3); // (0,0), (1,0), (0,1) — the rest is off-grid
  });
});

describe("erodeMask", () => {
  it("radius 0 is the identity", () => {
    const { m, w, h } = grid(["###", "###", "###"]);
    expect([...erodeMask(m, w, h, 0)]).toEqual([...m]);
  });

  it("removes any pixel whose neighbourhood is not fully set", () => {
    const { m, w, h } = grid([".....", ".###.", ".###.", ".###.", "....."]);
    const e = erodeMask(m, w, h, 1);
    expect(count(e)).toBe(1); // only the centre keeps a full plus
    expect(e[2 * w + 2]).toBe(1);
  });

  it("treats off-grid as CLEAR, so a shape flush to the edge erodes there", () => {
    const { m, w, h } = grid(["###", "###", "###"]);
    expect(count(erodeMask(m, w, h, 1))).toBe(1); // only the centre survives
  });

  it("is the inverse of dilate for a shape with room around it", () => {
    const { m, w, h } = grid([".....", ".....", "..#..", ".....", "....."]);
    const round = erodeMask(dilateMask(m, w, h, 1), w, h, 1);
    expect([...round]).toEqual([...m]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/__tests__/mask-ops.test.ts`
Expected: FAIL — `Failed to resolve import "../core/mask-ops"`.

- [ ] **Step 3: Create the module**

Create `src/core/mask-ops.ts`. `dilateMask`'s body moves verbatim from `src/core/fill.ts` (currently at ~line 181) — do not rewrite it; the Fill tool's `expand` depends on its exact behaviour.

```ts
/**
 * Binary morphology on a w×h Uint8Array mask (1 = set). Shared by the Fill tool's `expand` and by
 * the Pose tool's outline filling. The structuring element is a CIRCLE of the given radius, so
 * radius 1 is a plus, not a 3×3 block — a detail the callers' measured behaviour depends on.
 */

/** Offsets within a circular radius, computed once per call. */
function circleOffsets(radius: number): [number, number][] {
  const offsets: [number, number][] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) offsets.push([dx, dy]);
    }
  }
  return offsets;
}

/** Grow every set pixel by `radius`. Off-grid neighbours are simply skipped (no wrap). */
export function dilateMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const result = new Uint8Array(w * h);
  const offsets = circleOffsets(radius);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (const [dx, dy] of offsets) {
        const nx = x + dx,
          ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) result[ny * w + nx] = 1;
      }
    }
  }
  return result;
}

/**
 * Shrink every set region by `radius`: a pixel survives only if its whole neighbourhood is set.
 * Off-grid counts as CLEAR, so a shape flush to the edge erodes there — the alternative (treating
 * off-grid as set) lets a dilated mask reach the border and swallow the whole bitmap.
 */
export function erodeMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const result = new Uint8Array(w * h);
  const offsets = circleOffsets(radius);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let all = 1;
      for (const [dx, dy] of offsets) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h || !mask[ny * w + nx]) {
          all = 0;
          break;
        }
      }
      result[y * w + x] = all;
    }
  }
  return result;
}
```

- [ ] **Step 4: Point `fill.ts` at it**

In `src/core/fill.ts`: delete the local `function dilateMask(...)` entirely and add to the imports at the top:

```ts
import { dilateMask } from "./mask-ops";
```

The two call sites (`fill.ts` ~:132 and its guard at ~:131/:136) are unchanged — same name, same signature.

**Note the one behavioural difference:** the moved version early-returns `mask` itself when `radius <= 0`, where the original always allocated. `fill.ts` only calls it under `if (expand > 0)`, so this path is unreachable there — but do not "fix" it back, Task 2 relies on the early return.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/__tests__/mask-ops.test.ts` — expected PASS (7 tests).
Run: `npm test` — expected 468 passing (461 + 7).
Run: `npm run build` — 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/core/mask-ops.ts src/core/fill.ts src/__tests__/mask-ops.test.ts
git commit -m "refactor: share dilate, add erode, as mask-ops"
```

---

### Task 2: `fillEnclosed`

**Files:**
- Create: `src/core/fill-holes.ts`, `src/__tests__/fill-holes.test.ts`

**Interfaces:**
- Consumes: `dilateMask`, `erodeMask` from Task 1.
- Produces:
  ```ts
  export interface FillEnclosedResult {
    mask: Uint8Array; // w*h, 1 = part of the shape (ink or enclosed)
    inkArea: number;
    grownArea: number;
    insideArea: number;
  }
  export function fillEnclosed(
    alpha: Uint8ClampedArray, // RGBA
    w: number,
    h: number,
    opts?: { alphaThreshold?: number; gap?: number },
  ): FillEnclosedResult;
  ```
  Task 3 consumes both the function and `FillEnclosedResult`.

**The order of operations is load-bearing and was falsified once.** Pad → dilate ink → flood from the padded border → invert → erode the SOLID result → union with the ink. Closing the ink (dilate-then-erode) does NOT bridge a 1 px line break at any radius. The tests below encode the measured truth; if an implementation disagrees with them, the implementation is wrong.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/fill-holes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fillEnclosed } from "../core/fill-holes";

/**
 * A 15×15 square ring (1 px stroke, inset 2) with a `gap`-wide break in its top edge — the
 * outline-drawing case in miniature. Centre is (7,7); if that is in the mask, the fill worked.
 */
function ring(gap: number, size = 15, inset = 2): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const lo = inset,
    hi = size - 1 - inset;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const onEdge =
        ((x === lo || x === hi) && y >= lo && y <= hi) || ((y === lo || y === hi) && x >= lo && x <= hi);
      const inBreak = y === lo && x >= 7 && x < 7 + gap;
      if (onEdge && !inBreak) rgba[(y * size + x) * 4 + 3] = 255;
    }
  }
  return rgba;
}
const CENTRE = 7 * 15 + 7;

describe("fillEnclosed — a closed outline", () => {
  it("fills the enclosed interior", () => {
    const r = fillEnclosed(ring(0), 15, 15);
    expect(r.mask[CENTRE]).toBe(1);
    expect(r.inkArea).toBe(40);
    expect(r.insideArea).toBe(121); // the 11×11 block the ring encloses, ring included
  });

  it("does not bloat the silhouette at any gap radius", () => {
    for (const gap of [1, 2, 3]) {
      expect(fillEnclosed(ring(0), 15, 15, { gap }).insideArea).toBe(121);
    }
  });
});

describe("fillEnclosed — a broken outline", () => {
  it("leaks through the break at gap 0, finding nothing", () => {
    const r = fillEnclosed(ring(1), 15, 15);
    expect(r.mask[CENTRE]).toBe(0);
    expect(r.insideArea).toBe(r.inkArea); // nothing beyond the ink itself
  });

  it("bridges a break of roughly 2×gap", () => {
    // gap 1 spans a 1px break but not a 3px one; gap 2 spans 3px but not 5px.
    expect(fillEnclosed(ring(1), 15, 15, { gap: 1 }).mask[CENTRE]).toBe(1);
    expect(fillEnclosed(ring(3), 15, 15, { gap: 1 }).mask[CENTRE]).toBe(0);
    expect(fillEnclosed(ring(3), 15, 15, { gap: 2 }).mask[CENTRE]).toBe(1);
    expect(fillEnclosed(ring(5), 15, 15, { gap: 2 }).mask[CENTRE]).toBe(0);
    expect(fillEnclosed(ring(5), 15, 15, { gap: 3 }).mask[CENTRE]).toBe(1);
  });

  it("reports failure against the GROWN mask, not the ink", () => {
    // A failed fill still measures ~1.26× the ink from dilation bloat alone, so an ink-based
    // threshold would call this a success. Against `grownArea` the failure is unambiguous.
    const r = fillEnclosed(ring(5), 15, 15, { gap: 2 });
    expect(r.insideArea / r.inkArea).toBeGreaterThan(1.2); // the misleading number
    expect(r.insideArea).toBeLessThan(r.grownArea * 1.1); // the honest one
  });
});

describe("fillEnclosed — edges and degenerate input", () => {
  it("handles ink flush against the crop edge (the tight-bbox case)", () => {
    // inset 0: the ring IS the bitmap border, so everything it encloses is the whole bitmap.
    const r = fillEnclosed(ring(0, 15, 0), 15, 15);
    expect(r.mask[CENTRE]).toBe(1);
    expect(r.insideArea).toBe(225);
  });

  it("returns an empty mask for a fully transparent bitmap", () => {
    const r = fillEnclosed(new Uint8ClampedArray(15 * 15 * 4), 15, 15);
    expect(r.inkArea).toBe(0);
    expect(r.insideArea).toBe(0);
  });

  it("respects the alpha threshold", () => {
    const faint = ring(0);
    for (let i = 3; i < faint.length; i += 4) if (faint[i]) faint[i] = 5; // below the default 10
    expect(fillEnclosed(faint, 15, 15).inkArea).toBe(0);
    expect(fillEnclosed(faint, 15, 15, { alphaThreshold: 4 }).inkArea).toBe(40);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/__tests__/fill-holes.test.ts`
Expected: FAIL — `Failed to resolve import "../core/fill-holes"`.

- [ ] **Step 3: Implement**

Create `src/core/fill-holes.ts`:

```ts
import { dilateMask, erodeMask } from "./mask-ops";

export interface FillEnclosedResult {
  /** w*h, 1 = part of the shape: ink, or a region the ink encloses. */
  mask: Uint8Array;
  inkArea: number;
  /** Area of the ink after dilation — the baseline the report compares against. */
  grownArea: number;
  insideArea: number;
}

/**
 * Treat space ENCLOSED by ink as part of the shape, so an outline-only drawing meshes as a body
 * rather than a thin web. Reads alpha, writes nothing: the artwork is never touched.
 *
 * `gap` bridges breaks in the outline of roughly 2×gap px (the dilated discs have to meet). The
 * ORDER below is load-bearing: closing the INK (dilate → erode) fails to bridge a 1px line at any
 * radius, because the erosion eats the join straight back out. Dilate, fill, then erode the SOLID
 * result — by then the mask is thick enough to survive erosion. See the spec's measured table.
 */
export function fillEnclosed(
  alpha: Uint8ClampedArray,
  w: number,
  h: number,
  opts: { alphaThreshold?: number; gap?: number } = {},
): FillEnclosedResult {
  const threshold = opts.alphaThreshold ?? 10;
  const gap = Math.max(0, Math.floor(opts.gap ?? 0));

  // Pad by gap+1: the pose lift is a TIGHT content bbox, so ink routinely touches all four edges.
  // Without a guaranteed clear ring the border flood has nowhere to start and everything reads as
  // inside.
  const p = gap + 1;
  const W = w + 2 * p,
    H = h + 2 * p;
  const ink = new Uint8Array(W * H);
  let inkArea = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[(y * w + x) * 4 + 3] > threshold) {
        ink[(y + p) * W + (x + p)] = 1;
        inkArea++;
      }
    }
  }

  const grown = dilateMask(ink, W, H, gap);
  let grownArea = 0;
  for (let i = 0; i < grown.length; i++) grownArea += grown[i];

  // Flood the outside from the padded border, travelling only through non-ink.
  const outside = new Uint8Array(W * H);
  const stack: number[] = [];
  const visit = (x: number, y: number) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = y * W + x;
    if (outside[i] || grown[i]) return;
    outside[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < W; x++) {
    visit(x, 0);
    visit(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    visit(0, y);
    visit(W - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % W,
      y = (i - x) / W;
    visit(x + 1, y);
    visit(x - 1, y);
    visit(x, y + 1);
    visit(x, y - 1);
  }

  let filled = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) filled[i] = outside[i] ? 0 : 1;
  filled = erodeMask(filled, W, H, gap); // undo the dilation's bloat, on a solid mask

  const mask = new Uint8Array(w * h);
  let insideArea = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pi = (y + p) * W + (x + p);
      // Union with the ink: erosion must never be able to eat the strokes themselves.
      if (filled[pi] || ink[pi]) {
        mask[y * w + x] = 1;
        insideArea++;
      }
    }
  }
  return { mask, inkArea, grownArea, insideArea };
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run src/__tests__/fill-holes.test.ts` — expected PASS (8 tests).
Run: `npm test` — expected 476 (468 + 8). Run: `npm run build` — 0/0.

If a fixture number disagrees with the implementation, **do not edit the test to match** — the numbers came from a working prototype. Re-read the order of operations above.

- [ ] **Step 5: Commit**

```bash
git add src/core/fill-holes.ts src/__tests__/fill-holes.test.ts
git commit -m "feat: treat ink-enclosed space as part of the shape"
```

---

### Task 3: Wire it into the pose mesh

**Files:**
- Modify: `src/core/mesh-pose.ts` (`fromLift`, ~:110-125)
- Modify: `src/state/appState.svelte.ts` (`AnimState` + the `$state` initialiser)
- Modify: `src/lib/Canvas.svelte` (both `MeshPose.fromLift` call sites: `:1303`, `:1370`)

**Interfaces:**
- Consumes: `fillEnclosed`, `FillEnclosedResult` from Task 2.
- Produces: `MeshPose.fromLift(img, rect, dpr, spacing, opts?: { fillHoles?: boolean; gap?: number })`, and `state.pose: { fillHoles: boolean; gap: number }`. `MeshPose` also exposes the last fill result as `readonly fill: FillEnclosedResult | null` so Task 4 can report on it.

No unit tests: this is Svelte/canvas wiring with no node-testable surface. Build + review, per project convention.

- [ ] **Step 1: `fromLift` builds `inside` from the mask**

In `src/core/mesh-pose.ts`, import `fillEnclosed` and its result type, add the options parameter, and replace the predicate. The existing body is:

```ts
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    const inside = (x: number, y: number) =>
      x >= 0 && x < img.width && y >= 0 && y < img.height && data[(y * img.width + x) * 4 + 3] > 10;
```

becomes:

```ts
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    // Outline-only art has ink ONLY on the strokes, so an alpha predicate meshes a thin web. When
    // fillHoles is on, enclosed space counts as body — this paints nothing, it only changes what
    // the mesh considers part of the shape.
    const fill = opts?.fillHoles === false
      ? null
      : fillEnclosed(data, img.width, img.height, { gap: opts?.gap ?? 0 });
    const inside = (x: number, y: number) =>
      x >= 0 &&
      x < img.width &&
      y >= 0 &&
      y < img.height &&
      (fill ? fill.mask[y * img.width + x] === 1 : data[(y * img.width + x) * 4 + 3] > 10);
```

Pass `fill` into the `MeshPose` constructor and store it as a public readonly field so Canvas can read the areas. Keep the existing `if (mesh.triangles.length === 0) return null;` guard.

- [ ] **Step 2: Add the state**

In `src/state/appState.svelte.ts`, add to the `AnimState` interface (near `onion`):

```ts
  /** Pose-mesh construction. Session-only, like `onion` — a working preference, not document data. */
  pose: { fillHoles: boolean; gap: number };
```

and to the `$state({...})` initialiser:

```ts
  pose: { fillHoles: true, gap: 0 },
```

- [ ] **Step 3: Pass the options at both call sites**

`src/lib/Canvas.svelte` — the initial lift (~:1303) and the density rebuild (~:1370) both become:

```ts
    meshPose = MeshPose.fromLift(lifted, rect, DPR, poseSpacing, {
      fillHoles: appState.pose.fillHoles,
      gap: appState.pose.gap,
    });
```

(the rebuild keeps its `?? meshPose` fallback and its existing `meshPose.img`/`meshPose.rect` arguments).

- [ ] **Step 4: Verify**

Run: `npm run build` — 0 errors, 0 warnings. Run: `npm test` — still 476 (this task adds no tests and must break none).
Run: `grep -rn "MeshPose.fromLift" src` — expect exactly the two call sites, both passing options.

- [ ] **Step 5: Commit**

```bash
git add src/core/mesh-pose.ts src/state/appState.svelte.ts src/lib/Canvas.svelte
git commit -m "feat: the pose mesh can treat enclosed space as body"
```

---

### Task 4: Pose-bar controls, the failure report, and docs

**Files:**
- Modify: `src/lib/Canvas.svelte` (pose bar markup ~:1668-1700, plus a rebuild helper)
- Modify: `CLAUDE.md`, `README.md`

**Interfaces:**
- Consumes: everything from Task 3.
- Produces: nothing downstream.

- [ ] **Step 1: One rebuild path for both settings**

`poseDensity` (`Canvas.svelte:1366`) already rebuilds from the same lifted bitmap and resets `poseDrag`/`activeHandle`/`poseAdjusting`. Extract that body into `rebuildPoseMesh()` and have `poseDensity` call it after changing `poseSpacing`, so the new controls reuse exactly the same reset semantics (vertex indices change, so stale handle indices MUST be dropped).

- [ ] **Step 2: Add the controls**

In the pose bar (`{#if poseBarVisible()}`), after the existing `−` / `+` / `Reset` buttons, add:

```svelte
      <label class="flex items-center gap-1 text-xs" title="Treat space enclosed by the outline as part of the shape">
        <input
          type="checkbox"
          bind:checked={appState.pose.fillHoles}
          onchange={rebuildPoseMesh}
        /> Fill outlines
      </label>
      {#if appState.pose.fillHoles}
        <label class="flex items-center gap-1 text-xs" title="Bridge breaks in the outline, up to about twice this many pixels">
          Gap
          <input
            class="w-10 text-xs bg-surface border border-border rounded px-1 text-text"
            type="number"
            min="0"
            max="8"
            bind:value={appState.pose.gap}
            onchange={rebuildPoseMesh}
          />
        </label>
      {/if}
```

Note the bar is inside `.selection-actions-panel`, so taps already do not bleed through to the canvas.

- [ ] **Step 3: Report a failed fill**

In `rebuildPoseMesh` (and after the initial lift), once `meshPose` exists:

```ts
    // A gapped outline lets the flood escape, silently producing the old thin web. Say so, and name
    // the remedy — compare against the GROWN mask, since dilation bloat alone can look like success.
    const f = meshPose?.fill;
    if (f && f.inkArea > 0 && f.insideArea < f.grownArea * 1.1)
      appState.statusHint = "Outline isn't closed — raise Gap, or fill the shape";
```

- [ ] **Step 4: Documentation**

`CLAUDE.md` — add an entry near the other pose notes recording: what the web was and why (geodesic distance travelling along the ribbon, not just the missing body); that this changes **no pixels**; the load-bearing order (dilate → fill → erode the solid result, NOT close the ink) and that the intuitive order was tried and measured to fail; the padding requirement and why (tight bbox ⇒ ink touches the edges); `gap ≈ 2r` bridging; that the report compares against `grownArea`; and that `pose` settings are session-only like `onion`.

`README.md` — the Pose bullet currently reads:

```markdown
- **Pose tool** — silhouette triangulation + geodesic-weighted MLS with per-handle rotation/reach gizmos, for posing a character drawing without redrawing it
```

Add, as a sibling bullet: that outline-only drawings can now be posed, because space enclosed by the outline counts as part of the shape — with no change to the artwork. Keep it user-facing; the mechanism belongs in CLAUDE.md. Also refresh the test count in the scripts block by running `npm test` — do not guess it.

Delete the roadmap line in `CLAUDE.md` that lists outline-only posing as deferred; it has shipped.

- [ ] **Step 5: Verify and commit**

Run `npm test` and `npm run build` (0/0), then:

```bash
git add src/lib/Canvas.svelte CLAUDE.md README.md
git commit -m "feat: fill-outlines controls in the pose bar"
```

- [ ] **Step 6: Hand the browser pass to the controller**

Nothing in Tasks 3–4 is reachable by the test suite. Report that it is build + review verified, and list what needs eyeballing: an outline-only drawing meshing as a body rather than a web; a handle drag falling off through the shape instead of along the lines; a **donut** with the checkbox OFF keeping its hole; a deliberately gapped outline producing the status hint; raising Gap closing it; a filled drawing being unchanged throughout; and a very thin appendage (thinner than the gap radius) surviving — the reason Gap defaults to 0.

---

## Self-Review

**Spec coverage:** requirement 1 (change no pixels) → `fillEnclosed` reads alpha and returns a mask; no task writes to a canvas. Requirement 2 (on by default, can disable) → Task 3 state + Task 4 checkbox. Requirement 3 (strict default, tunable gap) → `gap: 0` default, early-returns in both mask ops make it a true no-op. Requirement 4 (say so on failure) → Task 4 Step 3. Spec §Core → Task 2. §Wiring → Task 3. §State → Task 3 Step 2. §UI → Task 4 Step 2. §Report → Task 4 Step 3. §Testing → Tasks 1–2 tests plus Task 4 Step 6's browser list.

**Placeholder scan:** no TBDs; every code step carries literal code; the browser step enumerates its checks.

**Type consistency:** `fillEnclosed`, `FillEnclosedResult`, `mask`/`inkArea`/`grownArea`/`insideArea`, `dilateMask`/`erodeMask`, and `state.pose.{fillHoles,gap}` are spelled identically in every task that declares or consumes them.

**Known risk:** Task 1 moves a function the Fill tool depends on. `fill.ts`'s only caller is guarded by `if (expand > 0)`, so the new `radius <= 0` early return cannot change its behaviour — but a Fill regression is the thing to watch for in review.
