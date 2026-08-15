# Document-space selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The unlifted marquee lives in document (paper) space so layer switches and Frame/Layer/Group transforms do not move it; viewport pan/zoom/rotate still do.

**Architecture:** Store and hit-test the selection in document px. Overlay uses `applyView` only. A `docToCell` mapper (`inverseChain` of the active layer’s compose) is applied only in clip / copy / clear / lift / commit. Lift extracts a paper crop via `drawCellComposed`; commit inverse-stamps that crop into the cell.

**Tech Stack:** TypeScript, Vitest (pure mapper + clip path), Svelte 5 Canvas/Selection (DOM — build+review).

**Spec:** `docs/superpowers/specs/2026-08-15-document-space-selection-design.md`

## Global Constraints

- `npm test` green; `npm run build` = 0 errors, 0 warnings after every task.
- Identity compose is bit-identical to today (mapper is a no-op).
- Viewport `applyView` stays; do **not** drop pan/zoom from the overlay.
- Frame / Layer / Group scopes are not redesigned.
- Deform / Pose stay cell-local (they cancel the marquee first).
- One commit per task. Do not merge to main unless asked.
- Commit trailer: `Co-Authored-By: Grok <noreply@x.ai>`.

## File map

| File | Role |
|---|---|
| `src/core/selection-map.ts` | Pure doc→cell mapping of a rect or polyline |
| `src/__tests__/selection-map.test.ts` | Identity / translate / 2× scale cases |
| `src/core/selection.ts` | `docToCell`; clip/copy/clear/lift use the mapped path; overlay drops compose |
| `src/lib/Canvas.svelte` | Install mapper; select/lasso pointers in document space; lift via composed crop; commit via inverse compose; `screenScale` = zoom only |

---

### Task 1: `mapDocShapeToCell`

**Files:**
- Create: `src/core/selection-map.ts`
- Test: `src/__tests__/selection-map.test.ts`

**Interfaces:**
- Consumes: `inverseChain`, `ComposeStep`, `Pt` from `src/core/ref-transform.ts`; `isIdentityTransform` from `src/anim/document.ts`.
- Produces:
  - `export function mapDocPointToCell(steps: ComposeStep[], p: Pt): Pt`
  - `export function mapDocRectToCell(steps: ComposeStep[], r: { x: number; y: number; w: number; h: number }): Pt[]` — four corners, TL TR BR BL
  - `export function mapDocPolyToCell(steps: ComposeStep[], pts: Pt[]): Pt[]`

- [ ] **Step 1: Write the failing tests** in `src/__tests__/selection-map.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapDocPointToCell, mapDocRectToCell, mapDocPolyToCell } from "../core/selection-map";
import type { ComposeStep } from "../core/ref-transform";

const DOC = { x: 0, y: 0, w: 200, h: 100 };
const id = (over = {}): ComposeStep => ({
  base: DOC,
  t: { dx: 0, dy: 0, scale: 1, rotation: 0, ...over },
});

describe("mapDocPointToCell", () => {
  it("identity steps leave the point alone", () => {
    expect(mapDocPointToCell([id()], { x: 40, y: 20 })).toEqual({ x: 40, y: 20 });
    expect(mapDocPointToCell([], { x: 40, y: 20 })).toEqual({ x: 40, y: 20 });
  });

  it("undoes a translation (doc = cell + dx)", () => {
    expect(mapDocPointToCell([id({ dx: 30, dy: -10 })], { x: 70, y: 10 })).toEqual({
      x: 40,
      y: 20,
    });
  });

  it("undoes a 2× scale about the doc center", () => {
    // center (100, 50); a paper point 20 px right of center came from 10 px right in the cell
    const paper = { x: 120, y: 50 };
    const cell = mapDocPointToCell([id({ scale: 2 })], paper);
    expect(cell.x).toBeCloseTo(110);
    expect(cell.y).toBeCloseTo(50);
  });
});

describe("mapDocRectToCell", () => {
  it("identity: corners match the rect", () => {
    const r = { x: 10, y: 20, w: 40, h: 10 };
    expect(mapDocRectToCell([id()], r)).toEqual([
      { x: 10, y: 20 },
      { x: 50, y: 20 },
      { x: 50, y: 30 },
      { x: 10, y: 30 },
    ]);
  });

  it("2× scale maps a paper box to a half-size cell box about the same center", () => {
    const r = { x: 80, y: 40, w: 40, h: 20 }; // paper center (100, 50)
    const q = mapDocRectToCell([id({ scale: 2 })], r);
    expect(q[0].x).toBeCloseTo(90);
    expect(q[0].y).toBeCloseTo(45);
    expect(q[2].x).toBeCloseTo(110);
    expect(q[2].y).toBeCloseTo(55);
  });
});

describe("mapDocPolyToCell", () => {
  it("maps each lasso point", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(mapDocPolyToCell([id({ dx: 5, dy: 0 })], pts)).toEqual([
      { x: -5, y: 0 },
      { x: 5, y: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests — they fail** (`selection-map` is missing).

```bash
npx vitest run src/__tests__/selection-map.test.ts
```

- [ ] **Step 3: Implement** `src/core/selection-map.ts`:

```ts
import { inverseChain, type ComposeStep, type Pt } from "./ref-transform";
import { isIdentityTransform } from "../anim/document";

function needsMap(steps: ComposeStep[]): boolean {
  return steps.some((s) => !isIdentityTransform(s.t));
}

export function mapDocPointToCell(steps: ComposeStep[], p: Pt): Pt {
  if (!needsMap(steps)) return p;
  return inverseChain(steps, p);
}

export function mapDocRectToCell(
  steps: ComposeStep[],
  r: { x: number; y: number; w: number; h: number },
): Pt[] {
  const corners = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  return mapDocPolyToCell(steps, corners);
}

export function mapDocPolyToCell(steps: ComposeStep[], pts: Pt[]): Pt[] {
  if (!needsMap(steps)) return pts.map((p) => ({ ...p }));
  return pts.map((p) => inverseChain(steps, p));
}
```

- [ ] **Step 4: Re-run tests — they pass.** Then `npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/core/selection-map.ts src/__tests__/selection-map.test.ts
git commit -m "$(cat <<'EOF'
feat: map a document-space selection into cell space

Inverse of group ∘ layer ∘ cell; identity compose is a no-op.

Co-Authored-By: Grok <noreply@x.ai>
EOF
)"
```

---

### Task 2: Selection clip / copy / clear use the mapper

**Files:**
- Modify: `src/core/selection.ts` (`applyClip`, `copyPixels`, `clearRegion`; add `docToCell` / `composeSteps`)
- Test: extend `src/__tests__/selection-map.test.ts` if you extract a path builder; otherwise the mapper tests stand and this task is verified by `npm run build` + the identity path staying a `rect()` / existing lasso.

**Interfaces:**
- Consumes: `mapDocRectToCell`, `mapDocPolyToCell`.
- Produces: `Selection.composeSteps: ComposeStep[]` (empty = identity). `applyClip` / `copyPixels` / `clearRegion` clip the mapped path when steps are non-identity; identity keeps today’s `ctx.rect` / `lassoPath`.

- [ ] **Step 1: Add `composeSteps: ComposeStep[] = []` to `Selection`.** Canvas will assign the active layer’s `cellComposeSteps` every frame / on change (Task 3). Do not import the store here.

- [ ] **Step 2: Helper on the class** (private):

```ts
private cellPath(): Path2D | null {
  if (!this.rect) return null;
  const steps = this.composeSteps;
  const pts =
    this.mode === "lasso" && this.lassoPoints.length > 1
      ? mapDocPolyToCell(steps, this.lassoPoints)
      : mapDocRectToCell(steps, this.rect);
  const path = new Path2D();
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
  path.closePath();
  return path;
}
```

When `!steps.some(s => !isIdentityTransform(s.t))` and mode is rect, `applyClip` may keep `ctx.rect(this.rect…)` so the identity path is unchanged.

- [ ] **Step 3: `applyClip`** — if a mapped path is needed, `ctx.clip(cellPath())`; else existing rect/lasso clip.

- [ ] **Step 4: `copyPixels` / `clearRegion`** — for a non-identity compose, clip to `cellPath()` then copy/clear the **AABB of the mapped points** (not the document rect). Identity: keep the current `this.rect` AABB. Lasso-on-identity: keep the existing lasso clip.

`copyPixels` AABB for a mapped quad:

```ts
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const p of pts) {
  if (p.x < minX) minX = p.x;
  if (p.y < minY) minY = p.y;
  if (p.x > maxX) maxX = p.x;
  if (p.y > maxY) maxY = p.y;
}
const r = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
```

Then the existing `drawImage` / `clearRect` against that AABB, with the path clip so the rotated quad is exact.

- [ ] **Step 5: `npm run build`** (0 errors, 0 warnings) and `npm test`.

- [ ] **Step 6: Commit**

```bash
git add src/core/selection.ts
git commit -m "$(cat <<'EOF'
feat: clip and copy a document-space selection through compose

Identity compose keeps the old rect/lasso path.

Co-Authored-By: Grok <noreply@x.ai>
EOF
)"
```

---

### Task 3: Overlay and select/lasso pointers are document space

**Files:**
- Modify: `src/lib/Canvas.svelte` (`applyOverlayCompose` usage on the selection overlay, `syncOverlayScale`, select/lasso `onStroke`, assign `selection.composeSteps`)

**Interfaces:**
- Consumes: `cellComposeSteps`, `Selection.composeSteps`.
- Produces: ants that do not inherit the active layer’s compose; create/hit/drag in document px.

- [ ] **Step 1: Stop composing the selection overlay.** In `setupSelection` you may leave `selection.applyCompose = applyOverlayCompose` unused, or set it to `null`. `drawOverlay` must not call `applyCompose` for the marquee or the float (float becomes a paper crop in Task 4; until then identity-layer files still look right). Pose’s `posePaint` **keeps** `applyOverlayCompose` — do not remove the helper.

- [ ] **Step 2: `syncOverlayScale`** — `selection.screenScale = viewport.zoom` only. Drop `composeScaleOf`. Handles stay screen-constant against **view** zoom, not layer scale.

- [ ] **Step 3: Keep `composeSteps` current.** In the existing rAF `tick` (next to `syncOverlayScale` / recomposite), and at the start of select/lasso `onStroke`:

```ts
if (selection) {
  const al = activeLayer();
  selection.composeSteps = al.kind === "draw" ? cellComposeSteps(al) : [];
}
```

- [ ] **Step 4: Select / lasso pointers stay in document space.** In `onStroke`, for `tool === "select" || tool === "lasso"`, use the raw `points[…].x/y` (already `screenToCanvas` / document). Do **not** call `toCellSpace`. Deform, pose, draw, fill are unchanged.

- [ ] **Step 5: `npm run build` && `npm test`.**

- [ ] **Step 6: Commit**

```bash
git add src/lib/Canvas.svelte
git commit -m "$(cat <<'EOF'
fix: draw and hit-test the marquee in document space

Viewport pan/zoom still apply; layer compose no longer moves the ants.

Co-Authored-By: Grok <noreply@x.ai>
EOF
)"
```

---

### Task 4: Lift is a paper crop; commit inverse-stamps

**Files:**
- Modify: `src/lib/Canvas.svelte` (`enterTransform`, the grab-inside lift in `onStroke`, `copySelection`, `selection.onCommit` / `renderFloatingTo` path)

**Interfaces:**
- Consumes: `drawCellComposed` from `src/anim/render.ts`; `mapDocRectToCell` / clip from Task 2.
- Produces: float bitmap = what the document-space region looked like; commit writes it back through inverse compose.

- [ ] **Step 1: Paper-crop helper** in `Canvas.svelte` (not exported):

```ts
function cropComposedSelection(): HTMLCanvasElement | null {
  if (!selection?.rect) return null;
  const al = activeLayer();
  if (al.kind !== "draw") return null;
  const W = appState.project.width;
  const H = appState.project.height;
  const tmp = document.createElement("canvas");
  tmp.width = W * DPR;
  tmp.height = H * DPR;
  const tctx = tmp.getContext("2d")!;
  // Draw only the active layer's resolved cell through group ∘ layer ∘ cell.
  // Reuse drawCellComposed (same path as render.ts). Background stays transparent.
  const rk = resolvedKeyCell(al, appState.playhead);
  if (!rk) return null;
  // Signature (render.ts): drawCellComposed(ctx, cell, wDev, hDev, layerT, cellT, cellBoxDev, dpr, groupT?, groupBoxDev?)
  drawCellComposed(
    tctx,
    rk.cell.canvas,
    W * DPR,
    H * DPR,
    al.transform,
    cellTransform(rk.cell),
    /* cellBoxDev in DEVICE px — same resolver render.ts uses */,
    DPR,
    groupT,
    groupBoxDev,
  );
  return selection.copyPixelsFromDoc(tctx, DPR);
}
```

Read `drawCellComposed`’s real signature in `src/anim/render.ts` and call it the same way `renderFrame` draws a draw-layer. Do not invent a second compose.

Simpler and equivalent when you already have `copyPixels` clipping the **cell**: for the paper crop, copy from `tmp` using the **document** rect (identity mapper). Either:

- temporarily `selection.composeSteps = []`, `copyPixels(tctx, DPR)`, restore steps, or
- add `copyPixelsFromDoc(srcCtx, dpr)` that always uses `this.rect` as an AABB on `srcCtx` (the temp is document-sized).

Prefer the small `copyPixelsFromDoc` so you do not mutate steps around the call.

- [ ] **Step 2: `enterTransform` and the grab-inside lift** use the paper crop as `beginTransform`’s bitmap, then `clearRegion` on the **cell** ctx (mapped clip). Do not `liftPixels` (that copies the cell AABB). Order: snapshot `selBefore` → crop → `clearRegion` on cell → `beginTransform(crop)`.

- [ ] **Step 3: `copySelection`** uses the paper crop (so a copy from a scaled layer is what you saw). Clipboard `rect` stays the document rect.

- [ ] **Step 4: Commit inverse-stamps.** `renderFloatingTo` draws in **document** space. Before calling it, the cell ctx must carry inverse compose + dpr:

```ts
function applyInverseCompose(ctx: CanvasRenderingContext2D) {
  const al = activeLayer();
  if (al.kind !== "draw") return;
  const steps = cellComposeSteps(al);
  if (!steps.some((s) => !isIdentityTransform(s.t))) return;
  // Invert applyOverlayCompose: inner-to-outer, each step inverted.
  for (const s of steps) {
    const cx = s.base.x + s.base.w / 2;
    const cy = s.base.y + s.base.h / 2;
    ctx.translate(cx, cy);
    ctx.scale(1 / s.t.scale, 1 / s.t.scale);
    ctx.rotate(-s.t.rotation);
    ctx.translate(-cx - s.t.dx, -cy - s.t.dy);
  }
}
```

In `selection.onCommit` (and any other `renderFloatingTo` onto a cell): `setTransform(DPR,0,0,DPR,0,0)` then `applyInverseCompose(selCtx)` then `renderFloatingTo`. Identity ⇒ today’s blit.

Verify invert order against a 2× scale: a paper-centered crop must land on the corresponding half-size cell region. If a first browser pass is mirrored or offset, swap the invert to “reverse of `applyOverlayCompose`’s loop” rather than inventing a third order.

- [ ] **Step 5: `npm run build` && `npm test`.**

- [ ] **Step 6: Commit**

```bash
git add src/lib/Canvas.svelte src/core/selection.ts
git commit -m "$(cat <<'EOF'
feat: lift a paper crop and commit through inverse compose

A selection on a transformed layer copies what you see and bakes it back
into the cell.

Co-Authored-By: Grok <noreply@x.ai>
EOF
)"
```

---

### Task 5: README / CLAUDE

**Files:**
- Modify: `README.md` only if a user-facing Features/Keyboard line now implies the old “selection sticks to the layer.”
- Modify: `CLAUDE.md` — short current-state note + a gotcha: selection geometry is document space; `applyCompose` is not for the marquee; `composeSteps` + `doc→cell` only at pixel ops.

- [ ] **Step 1: Add CLAUDE.md gotcha** (next number after 12):

```
Selection geometry is DOCUMENT space (the paper). Viewport pan/zoom still apply;
group ∘ layer ∘ cell does not. Overlay must not applyCompose the ants. Pixel ops
(clip/lift/copy/commit) map through inverseChain via selection.composeSteps.
Switching layers keeps the ants put; a live lift still banks (gotcha #9).
```

- [ ] **Step 2: `npm test` && `npm run build`.**

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: document-space selection (paper-stable marquee)

Co-Authored-By: Grok <noreply@x.ai>
EOF
)"
```

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| Marquee in document space; ants stay put on layer switch | 3 |
| Viewport pan/zoom/rotate still apply | 3 (`applyView` untouched) |
| Inverse-map only at pixel ops | 1, 2 |
| Paper crop lift + inverse commit | 4 |
| Copy / delete / clip paint | 2, 4 |
| Lift still banks on layer/frame switch | unchanged `bankActiveEdits` |
| Frame/Layer/Group untouched | no task touches those actions |
| Deform/Pose untouched | 3 leaves their `toCellSpace` |
| Identity bit-identical | 1 short-circuit; 2 identity clip |
| Tests for mapper | 1 |
| CLAUDE gotcha | 5 |
