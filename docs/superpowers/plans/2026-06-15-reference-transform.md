# Reference Image Transform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move/scale/rotate a reference image with an on-canvas gizmo; it stays a live, non-exporting backdrop. Selecting a reference layer becomes a transform mode instead of a dead end.

**Architecture:** A `RefTransform` (dx, dy, scale, rotation) on `ReferenceLayer`, default identity = today's contain-fit. Pure geometry/drag helpers in `src/core/ref-transform.ts` (Node-tested) carry all the math. Compositing applies the transform. `Canvas.onStroke` routes pointer input to a transform handler when the active layer is a reference. A visual-only `RefTransformGizmo.svelte` overlay draws the handles + a Reset button.

**Tech Stack:** TypeScript, Svelte 5, Vitest (Node — no DOM), Canvas 2D, the existing `Viewport` + `setupInput` pipeline.

**Spec:** `docs/superpowers/specs/2026-06-15-reference-transform-design.md`

**Branch:** execute on a new branch `reference-transform` (off `main`).

**Key constraints (verified against the codebase):**
- `setupInput(display, onStroke, (sx,sy)=>viewport.screenToCanvas(sx,sy), …)` passes **logical document points** to `onStroke(points, done)` (`Canvas.svelte:136`). `onStroke` already does nothing useful on non-drawing layers, so routing ref-transform at its top is non-invasive. Pan/zoom gesture arbitration lives in `setupInput`/`setupTouchGestures` and is preserved.
- Compositing runs in **device px** (`render.ts`: `ctx` at identity, `containRect(…, project.width*dpr, …)`), but the gizmo and pointer points are **logical px**. So `dx/dy` are stored logical and multiplied by `dpr` only in compositing; the pure helpers and the gizmo use a **logical** `base` (`containRect(size.w, size.h, project.width, project.height)`).
- `Project`/reference layers are **session-only** (not persisted, not in undo). The transform follows suit: a drag mutates `layer.transform` + `bump()`, **not** undoable. (Deliberate v1 simplification, matching references' current behavior.)
- Adding required `transform` to `ReferenceLayer` ripples to ref-layer literals: `document.test.ts` (the `rlayer` helper + one explicit literal), `persist.test.ts` (`rlayer` helper), `timeline.test.ts` (its ref helper). Find them with tsc.
- `Viewport.screenToCanvas`/`canvasToScreen` map screen↔logical doc; `viewport.zoom` scales screen tolerances into doc units.

---

### Task 1: pure transform helpers

**Files:**
- Create: `src/core/ref-transform.ts`
- Test: `src/__tests__/ref-transform.test.ts`

This needs the `RefTransform` type from Task 2 — to keep Task 1 self-contained and testable first, define `RefTransform` here is NOT allowed (it belongs on the model). Instead, **do Task 2's type addition first if the import fails**; the plan orders Task 2's interface before this in practice. For clarity this task imports `RefTransform` from `../anim/document`; if you are executing strictly in order, complete Task 2 Step 1 (the interface) before this task, then return. (The reviewer/runner may simply swap Task 1 and Task 2 order — both are fine as long as the `RefTransform` interface exists before `ref-transform.ts` compiles.)

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/ref-transform.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  transformCenter, transformedCorners, rotateHandlePos, hitTestHandle,
  applyMove, applyScale, applyRotate, type Rect,
} from "../core/ref-transform";

const base: Rect = { x: 100, y: 100, w: 200, h: 100 }; // center (200,150)
const id = { dx: 0, dy: 0, scale: 1, rotation: 0 };

describe("transformCenter", () => {
  it("identity → fit center", () => {
    expect(transformCenter(base, id)).toEqual({ x: 200, y: 150 });
  });
  it("translate shifts the center", () => {
    expect(transformCenter(base, { ...id, dx: 10, dy: -20 })).toEqual({ x: 210, y: 130 });
  });
});

describe("transformedCorners", () => {
  it("identity → the fit rect corners (NW,NE,SE,SW)", () => {
    const [nw, ne, se, sw] = transformedCorners(base, id);
    expect(nw).toEqual({ x: 100, y: 100 });
    expect(ne).toEqual({ x: 300, y: 100 });
    expect(se).toEqual({ x: 300, y: 200 });
    expect(sw).toEqual({ x: 100, y: 200 });
  });
  it("scale=2 doubles each corner's distance from center", () => {
    const [nw] = transformedCorners(base, { ...id, scale: 2 });
    expect(nw).toEqual({ x: 0, y: 50 }); // center(200,150) - (200,100)
  });
  it("rotation=π/2 rotates corners a quarter turn about center", () => {
    const [nw] = transformedCorners(base, { ...id, rotation: Math.PI / 2 });
    expect(nw.x).toBeCloseTo(250, 6);
    expect(nw.y).toBeCloseTo(50, 6);
  });
});

describe("hitTestHandle", () => {
  const gap = 30;
  it("hits a corner near it", () => {
    expect(hitTestHandle(base, id, { x: 300, y: 200 }, 8, gap)).toBe("se");
  });
  it("hits the rotate handle above the top edge", () => {
    expect(hitTestHandle(base, id, { x: 200, y: 100 - gap }, 8, gap)).toBe("rotate");
  });
  it("hits the body inside", () => {
    expect(hitTestHandle(base, id, { x: 200, y: 150 }, 8, gap)).toBe("body");
  });
  it("misses outside + tolerance", () => {
    expect(hitTestHandle(base, id, { x: 500, y: 500 }, 8, gap)).toBe(null);
  });
});

describe("applyMove", () => {
  it("adds to dx/dy and leaves scale/rotation", () => {
    expect(applyMove({ dx: 1, dy: 2, scale: 3, rotation: 4 }, 10, -5))
      .toEqual({ dx: 11, dy: -3, scale: 3, rotation: 4 });
  });
});

describe("applyScale", () => {
  const center = { x: 200, y: 150 };
  it("doubling the distance from center doubles scale", () => {
    const out = applyScale(id, center, { x: 250, y: 150 }, { x: 300, y: 150 });
    expect(out.scale).toBeCloseTo(2, 6);
    expect(out.dx).toBe(0); expect(out.dy).toBe(0); expect(out.rotation).toBe(0);
  });
  it("clamps to a small minimum", () => {
    const out = applyScale(id, center, { x: 300, y: 150 }, { x: 200.0001, y: 150 });
    expect(out.scale).toBeGreaterThan(0);
  });
});

describe("applyRotate", () => {
  const center = { x: 200, y: 150 };
  it("a 90° pointer sweep adds π/2", () => {
    const out = applyRotate(id, center, { x: 300, y: 150 }, { x: 200, y: 250 });
    expect(out.rotation).toBeCloseTo(Math.PI / 2, 6);
    expect(out.scale).toBe(1); expect(out.dx).toBe(0);
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run: `npx vitest run src/__tests__/ref-transform.test.ts` → FAIL (module not found / `RefTransform` missing). If the failure is only the missing `RefTransform` import, do Task 2 Step 1 first, then continue.

- [ ] **Step 3: Implement**

Create `src/core/ref-transform.ts`:

```ts
import type { RefTransform } from "../anim/document";

export interface Pt { x: number; y: number; }
export interface Rect { x: number; y: number; w: number; h: number; }
export type Handle = "nw" | "ne" | "se" | "sw" | "rotate" | "body" | null;

const MIN_SCALE = 0.05;

/** Image center in document coords (fit-center + translate). */
export function transformCenter(base: Rect, t: RefTransform): Pt {
  return { x: base.x + base.w / 2 + t.dx, y: base.y + base.h / 2 + t.dy };
}

function rotate(p: Pt, c: Pt, ang: number): Pt {
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const x = p.x - c.x, y = p.y - c.y;
  return { x: c.x + x * cos - y * sin, y: c.y + x * sin + y * cos };
}

/** Corners NW, NE, SE, SW of the transformed image. */
export function transformedCorners(base: Rect, t: RefTransform): [Pt, Pt, Pt, Pt] {
  const c = transformCenter(base, t);
  const hw = (base.w / 2) * t.scale, hh = (base.h / 2) * t.scale;
  const local: Pt[] = [
    { x: c.x - hw, y: c.y - hh },
    { x: c.x + hw, y: c.y - hh },
    { x: c.x + hw, y: c.y + hh },
    { x: c.x - hw, y: c.y + hh },
  ];
  return local.map((p) => rotate(p, c, t.rotation)) as [Pt, Pt, Pt, Pt];
}

/** Rotate-handle position: `gap` doc px beyond the top-edge midpoint (rotated about center). */
export function rotateHandlePos(base: Rect, t: RefTransform, gap: number): Pt {
  const c = transformCenter(base, t);
  const hh = (base.h / 2) * t.scale;
  return rotate({ x: c.x, y: c.y - hh - gap }, c, t.rotation);
}

function dist(a: Pt, b: Pt): number { return Math.hypot(a.x - b.x, a.y - b.y); }

/** Which handle a point hits within `tolDoc`. Corners + rotate first, then body, else null. */
export function hitTestHandle(base: Rect, t: RefTransform, p: Pt, tolDoc: number, gap: number): Handle {
  const [nw, ne, se, sw] = transformedCorners(base, t);
  const named: [Handle, Pt][] = [
    ["nw", nw], ["ne", ne], ["se", se], ["sw", sw], ["rotate", rotateHandlePos(base, t, gap)],
  ];
  for (const [h, pt] of named) if (dist(p, pt) <= tolDoc) return h;
  const c = transformCenter(base, t);
  const local = rotate(p, c, -t.rotation); // un-rotate the point about center
  const hw = (base.w / 2) * t.scale, hh = (base.h / 2) * t.scale;
  if (Math.abs(local.x - c.x) <= hw && Math.abs(local.y - c.y) <= hh) return "body";
  return null;
}

/** Translate by (ddx, ddy). */
export function applyMove(t: RefTransform, ddx: number, ddy: number): RefTransform {
  return { ...t, dx: t.dx + ddx, dy: t.dy + ddy };
}

/** Uniform scale about `center`: start.scale * |p-center|/|start-center|, clamped. */
export function applyScale(t: RefTransform, center: Pt, start: Pt, p: Pt): RefTransform {
  const d0 = dist(start, center);
  if (d0 < 1e-6) return t;
  return { ...t, scale: Math.max(MIN_SCALE, t.scale * (dist(p, center) / d0)) };
}

/** Rotate about `center` by the angle the pointer swept from `start` to `p`. */
export function applyRotate(t: RefTransform, center: Pt, start: Pt, p: Pt): RefTransform {
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  const a1 = Math.atan2(p.y - center.y, p.x - center.x);
  return { ...t, rotation: t.rotation + (a1 - a0) };
}
```

- [ ] **Step 4: Verify PASS + build**

Run: `npx vitest run src/__tests__/ref-transform.test.ts` → PASS.
Run: `npm run build` → 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/core/ref-transform.ts src/__tests__/ref-transform.test.ts
git commit -m "feat: pure reference-transform helpers (geometry, hit-test, drag math)"
```

---

### Task 2: data model

**Files:**
- Modify: `src/anim/document.ts` (add `RefTransform`; add `transform` to `ReferenceLayer`; default it in `createReferenceLayer`)
- Modify (ripple): `src/__tests__/document.test.ts`, `src/__tests__/persist.test.ts`, `src/__tests__/timeline.test.ts`

> If executing strictly in order, do **Step 1** of this task before Task 1 Step 3 (so `ref-transform.ts` can import `RefTransform`).

- [ ] **Step 1: Add the type + field**

In `src/anim/document.ts`, add near the reference types:

```ts
export interface RefTransform {
  dx: number;        // translate from fit-center, document logical px
  dy: number;
  scale: number;     // uniform multiplier on the fit size (1 = fit)
  rotation: number;  // radians, clockwise, about the center
}
```

Add `transform: RefTransform;` to the `ReferenceLayer` interface. In `createReferenceLayer`, add:

```ts
    transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },
```

- [ ] **Step 2: Fix the ripple**

Run `npm run build`; tsc flags every `ReferenceLayer` literal missing `transform`. Add
`transform: { dx: 0, dy: 0, scale: 1, rotation: 0 },` to each: the `rlayer` helper + the explicit
literal in `src/__tests__/document.test.ts`, the `rlayer` helper in `src/__tests__/persist.test.ts`,
and the ref helper in `src/__tests__/timeline.test.ts`. Trust tsc's full list.

- [ ] **Step 3: Build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass.

- [ ] **Step 4: Commit**

```bash
git add src/anim/document.ts src/__tests__/document.test.ts src/__tests__/persist.test.ts src/__tests__/timeline.test.ts
git commit -m "feat: RefTransform model + ReferenceLayer.transform (default identity)"
```

---

### Task 3: apply the transform in compositing

**Files:**
- Modify: `src/anim/render.ts` (both reference draws)

No unit test (canvas compositing isn't Node-testable here). Verification = build; visual = Task 5 manual.

- [ ] **Step 1: Transform both reference draws**

`render.ts` draws references in two places. The 2D path (~`:68-71`) is:

```ts
      const size = mediaIntrinsicSize(layer.media);
      if (size.w === 0 || size.h === 0) continue;
      const r = containRect(size.w, size.h, project.width * dpr, project.height * dpr);
      ctx.drawImage(layer.media.el, r.x, r.y, r.w, r.h);
```

Replace the `ctx.drawImage(...)` line with a transformed draw using `layer.transform`:

```ts
      const t = layer.transform;
      const cx = r.x + r.w / 2 + t.dx * dpr;
      const cy = r.y + r.h / 2 + t.dy * dpr;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t.rotation);
      ctx.scale(t.scale, t.scale);
      ctx.drawImage(layer.media.el, -r.w / 2, -r.h / 2, r.w, r.h);
      ctx.restore();
```

Do the **same** replacement in the boil path's reference draw (~`:38-42`), which has the same
`drawImage(layer.media.el, r.x, r.y, r.w, r.h)` shape (its rect var is `r`, `globalAlpha` already set
above it — keep that line). Identity transform renders identically to before.

- [ ] **Step 2: Build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass (render tests use identity transforms via `createReferenceLayer`/literals, so output is unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/anim/render.ts
git commit -m "feat: apply reference transform in compositing (identity = contain-fit)"
```

---

### Task 4: route pointer input to the transform handler

**Files:**
- Modify: `src/lib/Canvas.svelte`

No unit test (DOM). Verification = build + the manual checks in Task 5.

- [ ] **Step 1: Imports + a shared rotate-gap constant**

In `src/lib/Canvas.svelte`, add imports:

```ts
  import { containRect, mediaIntrinsicSize, type ReferenceLayer } from "../anim/document";
  import { hitTestHandle, transformCenter, applyMove, applyScale, applyRotate, type Handle, type Pt, type Rect } from "../core/ref-transform";
```

(If `containRect`/`mediaIntrinsicSize` are already imported from `../anim/document`, just add the missing names; avoid duplicate imports.)

Add a module-level constant near the top of `<script>`:

```ts
  const REF_ROTATE_GAP_PX = 28; // screen px from the top edge to the rotate handle
```

- [ ] **Step 2: Add the ref-transform drag handler**

Add to `Canvas.svelte`'s `<script>`:

```ts
  let refDrag: { handle: Handle; start: Pt; startT: ReferenceLayer["transform"]; center: Pt } | null = null;

  function onRefTransform(layer: ReferenceLayer, points: { x: number; y: number }[], done: boolean) {
    const p = points[points.length - 1];
    const size = mediaIntrinsicSize(layer.media);
    if (size.w === 0 || size.h === 0) { if (done) refDrag = null; return; }
    const base: Rect = containRect(size.w, size.h, state.project.width, state.project.height);
    if (!refDrag) {
      const tol = 10 / viewport.zoom;            // 10 screen px of grab tolerance
      const gap = REF_ROTATE_GAP_PX / viewport.zoom;
      const handle = hitTestHandle(base, layer.transform, p, tol, gap);
      refDrag = { handle, start: p, startT: { ...layer.transform }, center: transformCenter(base, layer.transform) };
    }
    const d = refDrag;
    if (d.handle) {
      if (d.handle === "body") layer.transform = applyMove(d.startT, p.x - d.start.x, p.y - d.start.y);
      else if (d.handle === "rotate") layer.transform = applyRotate(d.startT, d.center, d.start, p);
      else layer.transform = applyScale(d.startT, d.center, d.start, p); // any corner = uniform scale
      bump();
    }
    if (done) refDrag = null;
  }
```

- [ ] **Step 3: Route from `onStroke`**

At the very top of `onStroke(points, done)` (`Canvas.svelte:136`), before any existing logic, add:

```ts
    const al = activeLayer();
    if (al.kind === "ref") { onRefTransform(al, points, done); return; }
```

(`points` are logical document coords; `InputPoint` has `x`/`y`, compatible with the handler's `{x,y}[]`.)

- [ ] **Step 4: Build + tests**

Run: `npm run build` → 0 errors, 0 warnings (watch for unused-import warnings — only import the names you use).
Run: `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Canvas.svelte
git commit -m "feat: drag reference layers to move/scale/rotate (pointer routing)"
```

---

### Task 5: gizmo overlay + reset

**Files:**
- Create: `src/lib/RefTransformGizmo.svelte`
- Modify: `src/lib/Canvas.svelte` (mount the gizmo)

No automated test. Verification = build + the manual checklist.

- [ ] **Step 1: Create `src/lib/RefTransformGizmo.svelte`**

A visual-only overlay (pointer-events on the SVG are off; only the Reset button is clickable). It polls
the viewport each frame (like `SelectionActions.svelte`) and positions handles via `canvasToScreen`.

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import type { Viewport } from "../core/viewport";
  import { state, bump } from "../state/appState.svelte";
  import { containRect, mediaIntrinsicSize, type ReferenceLayer } from "../anim/document";
  import { transformedCorners, rotateHandlePos } from "../core/ref-transform";

  let { getViewport, getContainer }: { getViewport: () => Viewport | null; getContainer: () => HTMLElement | null } = $props();

  const ROTATE_GAP_PX = 28;
  let visible = $state(false);
  let corners = $state<{ x: number; y: number }[]>([]);
  let rotatePt = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let raf = 0;

  function activeRef(): ReferenceLayer | null {
    const l = state.project.layers.find((x) => x.id === state.activeLayerId);
    return l && l.kind === "ref" ? l : null;
  }

  function tick() {
    const vp = getViewport();
    const container = getContainer();
    const layer = activeRef();
    if (vp && container && layer) {
      const size = mediaIntrinsicSize(layer.media);
      if (size.w > 0 && size.h > 0) {
        const base = containRect(size.w, size.h, state.project.width, state.project.height);
        const gap = ROTATE_GAP_PX / vp.zoom;
        const rect = container.getBoundingClientRect();
        const toLocal = (p: { x: number; y: number }) => {
          const s = vp.canvasToScreen(p.x, p.y);
          return { x: s.x - rect.left, y: s.y - rect.top };
        };
        corners = transformedCorners(base, layer.transform).map(toLocal);
        rotatePt = toLocal(rotateHandlePos(base, layer.transform, gap));
        visible = true;
      } else visible = false;
    } else visible = false;
    raf = requestAnimationFrame(tick);
  }

  function resetTransform() {
    const layer = activeRef();
    if (layer) { layer.transform = { dx: 0, dy: 0, scale: 1, rotation: 0 }; bump(); }
  }

  onMount(() => { raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf); });
</script>

{#if visible && corners.length === 4}
  <svg class="absolute inset-0 w-full h-full pointer-events-none" style="overflow: visible">
    <polygon points={corners.map((c) => `${c.x},${c.y}`).join(" ")}
             fill="none" stroke="#3b82f6" stroke-width="1.5" />
    <line x1={(corners[0].x + corners[1].x) / 2} y1={(corners[0].y + corners[1].y) / 2}
          x2={rotatePt.x} y2={rotatePt.y} stroke="#3b82f6" stroke-width="1.5" />
    {#each corners as c}
      <rect x={c.x - 5} y={c.y - 5} width="10" height="10" fill="#fff" stroke="#3b82f6" stroke-width="1.5" />
    {/each}
    <circle cx={rotatePt.x} cy={rotatePt.y} r="6" fill="#fff" stroke="#3b82f6" stroke-width="1.5" />
  </svg>
  <div class="absolute left-2 top-2 flex items-center gap-2 text-xs text-text-secondary bg-surface/90 rounded px-2 py-1 pointer-events-auto">
    <span>Reference: drag to move · corners scale · top handle rotates</span>
    <button class="underline hover:text-text" onclick={resetTransform}>Reset to fit</button>
  </div>
{/if}
```

- [ ] **Step 2: Mount it in `Canvas.svelte`**

Import it in the `<script>`:

```ts
  import RefTransformGizmo from "./RefTransformGizmo.svelte";
```

In the template, add it inside the `<div bind:this={stage} …>` (a sibling of `<SelectionActions …/>`):

```svelte
  <RefTransformGizmo getViewport={() => viewport} getContainer={() => stage} />
```

- [ ] **Step 3: Build**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass.

- [ ] **Step 4: Manual verification (browser)**

Run `npm run dev`:
- Import an image; select its layer → a blue box with corner handles + a rotate handle appears over the fit-placed image, plus the hint + "Reset to fit".
- Drag the body to move; drag a corner to scale uniformly about center; drag the top handle to rotate.
- Draw on a drawing layer, then move the reference under it — the ink stays put (live, traceable).
- "Reset to fit" returns the image to the centered fit.
- Selecting a reference layer no longer leaves the drawing tools doing nothing.
- Untouched references look identical to before.
- Pan/zoom the viewport: the gizmo tracks the image and the handles stay grabbable; two-finger pan/pinch still work.

- [ ] **Step 5: Commit**

```bash
git add src/lib/RefTransformGizmo.svelte src/lib/Canvas.svelte
git commit -m "feat: reference transform gizmo overlay + reset to fit"
```

---

## Final verification

- [ ] `npm run build` → 0 errors, 0 warnings.
- [ ] `npm test` → all pass (baseline + Task 1's new assertions).
- [ ] Manual checklist in Task 5 confirmed (move/scale/rotate, reset, traceable, untouched-identical, pan/zoom tracking).

## Self-Review (completed by plan author)

**Spec coverage:**
- `RefTransform` + `ReferenceLayer.transform` (identity default) → Task 2. ✅
- Pure helpers (center, corners, rotate-handle, hit-test, move/scale/rotate) + tests → Task 1. ✅
- Compositing applies the transform (identity = fit) in both ref draws → Task 3. ✅
- Pointer routing → transform handler when a ref layer is active → Task 4. ✅
- Gizmo overlay + Reset + hint; selecting a ref = transform mode → Task 5. ✅
- Session-only / not undoable / out-of-scope distort+keyframe → respected (no persistence/undo code). ✅

**Placeholder scan:** No TBD/TODO; complete code in every code step. The Task 1↔Task 2 ordering note is explicit (the `RefTransform` interface must exist before `ref-transform.ts` compiles). ✅

**Type consistency:** `RefTransform` (Task 2) imported by `ref-transform.ts` (Task 1) and used in `render.ts` (Task 3), `Canvas.svelte` (Task 4), `RefTransformGizmo.svelte` (Task 5). `Rect`/`Pt`/`Handle` (Task 1) used in Task 4's handler. Helper signatures (`hitTestHandle(base,t,p,tolDoc,gap)`, `applyScale(t,center,start,p)`, etc.) match between Task 1's defs and Task 4's calls. `base` is logical px everywhere the helpers/gizmo use it; compositing uses the device rect and `t.dx*dpr`. ✅
