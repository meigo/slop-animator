# Fill all enclosed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One press fills every region the ink encloses on the current cell, behind the strokes — turning the Pose tool's non-destructive mask into real pixels.

**Architecture:** The region is `mask AND NOT ink` from the existing `fillEnclosed`, dilated by the Fill tool's `expand` to cover anti-aliased fringe. A thin canvas wrapper composites it with `destination-over`. The action follows the click-fill's existing undo/guard shape exactly.

**Tech Stack:** TypeScript, Vitest (node, no DOM), Svelte 5 runes.

**Spec:** `docs/superpowers/specs/2026-08-15-fill-all-enclosed-design.md`

## Global Constraints

- `npm test` — currently **481 passing**. Must not go down.
- `npm run build` (`svelte-check && tsc --noEmit && vite build`) — **0 errors, 0 warnings**, every task.
- Vitest is node-only, no DOM. Pure region maths MUST be unit-tested; canvas/Svelte is build + review verified — do NOT add jsdom or a browser runner.
- **This feature writes pixels** — unlike the pose fill it precedes. Every write must be one `pixelCommand` undo entry, guarded by `isLayerEditable`, and followed by `bump()`.
- Do not change the click-point Fill tool's behaviour. `floodFill` stays as it is.
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. One commit per task. A pre-commit hook reformats staged files.
- Do not merge to `main` unless asked.

## Context the spec does not carry

**`state.fill` IS persisted.** `gatherPreferences` copies it wholesale (`appState.svelte.ts:837`, `fill: { ...state.fill }`) and `applyPreferences` merges it back (`:854`, `state.fill = { ...state.fill, ...p.fill }`). Adding `gap` therefore:
- must be added to the `Preferences` interface in `src/persist/preferences.ts:8`, and
- is automatically back-compatible — the spread merge leaves the default in place when an older stored preference has no `gap`. Verify that rather than assuming it.

**`floodFill`'s destination-over path only runs when `expand > 0`** (`fill.ts:136-172`); at `expand === 0` it writes pixels directly. The new action must paint behind **always**, regardless of `expand`, so it uses the temp-canvas + `destination-over` path unconditionally.

## File map

| File | Role |
|---|---|
| `src/core/fill-holes.ts` | **New export** `enclosedRegion` — the pure "which pixels to paint" |
| `src/__tests__/fill-holes.test.ts` | Cases for `enclosedRegion` |
| `src/core/fill.ts` | **New export** `fillAllEnclosed` — the canvas composite |
| `src/state/appState.svelte.ts` | `state.fill.gap` |
| `src/persist/preferences.ts` | `gap` on the `fill` preference |
| `src/lib/Canvas.svelte` | The action: keyframe, undo bracket, guards, selection clip, report |
| `src/lib/ToolOptions.svelte` | The Gap control + the "Fill enclosed" button |

---

### Task 1: `enclosedRegion` — the pure region

**Files:**
- Modify: `src/core/fill-holes.ts` (append)
- Modify: `src/__tests__/fill-holes.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `fillEnclosed`, `clampGap` (same file); `dilateMask` from `./mask-ops`.
- Produces:
  ```ts
  /** Pixels to PAINT: enclosed by ink but not ink themselves, grown by `expand`. */
  export function enclosedRegion(
    alpha: Uint8ClampedArray,
    w: number,
    h: number,
    opts?: { alphaThreshold?: number; gap?: number; expand?: number },
  ): { region: Uint8Array; area: number };
  ```
  Task 2 consumes both.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/fill-holes.test.ts`. Reuse the existing `ring()` helper and `CENTRE` constant already in that file — do not redefine them.

```ts
import { enclosedRegion } from "../core/fill-holes"; // add to the existing import

/** A solid w×h block of ink, inset by `pad`, as RGBA. */
function blob(size = 15, pad = 3): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = pad; y < size - pad; y++)
    for (let x = pad; x < size - pad; x++) rgba[(y * size + x) * 4 + 3] = 255;
  return rgba;
}

describe("enclosedRegion", () => {
  it("is the interior of a closed outline, and excludes the ink itself", () => {
    const r = enclosedRegion(ring(0), 15, 15);
    expect(r.area).toBe(81); // the 9×9 interior of the 11×11 ring — the stroke is not painted
    expect(r.region[CENTRE]).toBe(1);
    expect(r.region[2 * 15 + 2]).toBe(0); // a ring pixel: ink, so not painted
  });

  it("is empty when the outline leaks", () => {
    expect(enclosedRegion(ring(1), 15, 15).area).toBe(0);
  });

  it("bridges the leak once gap is large enough", () => {
    expect(enclosedRegion(ring(1), 15, 15, { gap: 1 }).area).toBeGreaterThan(0);
  });

  it("is empty for a solid shape — nothing is enclosed", () => {
    expect(enclosedRegion(blob(), 15, 15).area).toBe(0);
  });

  it("is empty for a fully transparent bitmap", () => {
    expect(enclosedRegion(new Uint8ClampedArray(15 * 15 * 4), 15, 15).area).toBe(0);
  });

  it("grows by `expand` to tuck under an anti-aliased stroke", () => {
    const plain = enclosedRegion(ring(0), 15, 15).area;
    const grown = enclosedRegion(ring(0), 15, 15, { expand: 1 }).area;
    expect(grown).toBeGreaterThan(plain); // reaches into the ink it will be painted behind
  });

  it("clamps gap like fillEnclosed does", () => {
    const a = enclosedRegion(ring(5), 15, 15, { gap: 50 });
    const b = enclosedRegion(ring(5), 15, 15, { gap: MAX_GAP });
    expect(a.area).toBe(b.area);
  });
});
```

`MAX_GAP` is already imported by that test file; if not, add it to the existing import.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/__tests__/fill-holes.test.ts`
Expected: FAIL — `enclosedRegion is not a function` (or an import error).

- [ ] **Step 3: Implement**

Append to `src/core/fill-holes.ts`:

```ts
/**
 * The pixels a "fill all enclosed" should PAINT: inside the shape but not ink themselves.
 *
 * Derived from `fillEnclosed`, so it inherits the property that makes a one-press whole-cell fill
 * safe — the flood starts at the border, so an outline with a gap encloses nothing and this returns
 * an empty region. A leak can never paint the canvas; worst case it paints nothing.
 *
 * `expand` grows the region so it tucks UNDER an anti-aliased stroke. The mask stops at the alpha
 * threshold, so without it the fringe stays unpainted and leaves a one-pixel halo. Safe to grow
 * because the caller composites behind the ink.
 */
export function enclosedRegion(
  alpha: Uint8ClampedArray,
  w: number,
  h: number,
  opts: { alphaThreshold?: number; gap?: number; expand?: number } = {},
): { region: Uint8Array; area: number } {
  const threshold = opts.alphaThreshold ?? 10;
  const filled = fillEnclosed(alpha, w, h, { alphaThreshold: threshold, gap: opts.gap });

  let region = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    // In the shape, but not ink: exactly the space the ink encloses.
    if (filled.mask[i] && alpha[i * 4 + 3] <= threshold) region[i] = 1;
  }

  const expand = Math.max(0, Math.floor(opts.expand ?? 0));
  if (expand > 0) region = new Uint8Array(dilateMask(region, w, h, expand));

  let area = 0;
  for (let i = 0; i < w * h; i++) area += region[i];
  return { region, area };
}
```

Add `dilateMask` to the existing `./mask-ops` import at the top of the file.

Note the `new Uint8Array(...)` around `dilateMask`: it returns `Uint8Array<ArrayBufferLike>`, which does not assign to a `Uint8Array<ArrayBuffer>` local. The same wrapping already appears in `fillEnclosed` for `erodeMask` — match it. (It also sidesteps `mask-ops`'s documented radius-0 aliasing, though `expand > 0` here means that path is not taken.)

- [ ] **Step 4: Verify**

Run: `npx vitest run src/__tests__/fill-holes.test.ts` — expected PASS.
Run: `npm test` — expected 488 (481 + 7). Run: `npm run build` — 0/0.

If the `area` fixture in the first test disagrees, work out which is right before touching it: the ring is inset 2 in a 15×15 grid, so its stroke is the 11×11 perimeter and the interior it encloses is 9×9 = 81.

- [ ] **Step 5: Commit**

```bash
git add src/core/fill-holes.ts src/__tests__/fill-holes.test.ts
git commit -m "feat: the region a fill-all-enclosed would paint"
```

---

### Task 2: `fillAllEnclosed` — the canvas composite

**Files:**
- Modify: `src/core/fill.ts` (append; add `enclosedRegion` to its imports)

**Interfaces:**
- Consumes: `enclosedRegion` from Task 1.
- Produces:
  ```ts
  /** Paints every ink-enclosed region behind existing content. Returns the area painted (0 = nothing enclosed). */
  export function fillAllEnclosed(
    ctx: CanvasRenderingContext2D,
    fillColor: { r: number; g: number; b: number; a: number },
    opts?: { gap?: number; expand?: number },
  ): number;
  ```
  Task 3 consumes it.

No unit tests: this is canvas compositing with no node-testable surface. Build + review, per project convention. Do NOT add jsdom.

- [ ] **Step 1: Implement**

Append to `src/core/fill.ts`:

```ts
/**
 * Fill every region the ink encloses, in one pass, BEHIND existing content — the animator's
 * white-under-black-outline. Returns the area painted; 0 means nothing was enclosed (an open
 * outline, or art that is already solid), which the caller must report rather than silently no-op:
 * a no-op and a successful fill of an already-white interior look identical.
 *
 * Always composites with destination-over, unlike `floodFill`, which only takes that path when
 * `expand > 0`. Painting behind is the point here, not an artefact of the expand pass.
 */
export function fillAllEnclosed(
  ctx: CanvasRenderingContext2D,
  fillColor: { r: number; g: number; b: number; a: number },
  opts: { gap?: number; expand?: number } = {},
): number {
  const w = ctx.canvas.width,
    h = ctx.canvas.height;
  if (w === 0 || h === 0) return 0;
  const { data } = ctx.getImageData(0, 0, w, h);
  const { region, area } = enclosedRegion(data, w, h, { gap: opts.gap, expand: opts.expand });
  if (area === 0) return 0;

  const temp = document.createElement("canvas");
  temp.width = w;
  temp.height = h;
  const tctx = temp.getContext("2d")!;
  const img = tctx.createImageData(w, h);
  const td = img.data;
  for (let i = 0; i < w * h; i++) {
    if (!region[i]) continue;
    const pi = i * 4;
    td[pi] = fillColor.r;
    td[pi + 1] = fillColor.g;
    td[pi + 2] = fillColor.b;
    td[pi + 3] = fillColor.a;
  }
  tctx.putImageData(img, 0, 0);

  ctx.save();
  ctx.resetTransform(); // the region is in device px; the caller's CTM must not scale it
  ctx.globalCompositeOperation = "destination-over";
  ctx.drawImage(temp, 0, 0);
  ctx.restore();
  return area;
}
```

Add `enclosedRegion` to the imports at the top of `fill.ts`.

- [ ] **Step 2: Verify**

Run: `npm run build` — 0 errors, 0 warnings. Run: `npm test` — still 488.

- [ ] **Step 3: Commit**

```bash
git add src/core/fill.ts
git commit -m "feat: composite an enclosed-region fill behind the ink"
```

---

### Task 3: State, preference, and the action

**Files:**
- Modify: `src/state/appState.svelte.ts` (`AnimState.fill`, the initialiser)
- Modify: `src/persist/preferences.ts:8` (the `fill` preference shape)
- Modify: `src/lib/Canvas.svelte` (the action + its registry entry)

**Interfaces:**
- Consumes: `fillAllEnclosed` from Task 2.
- Produces: `state.fill.gap: number`, and a `fillActions.allEnclosed: (() => void) | null` registry entry (the same register-on-mount / null-on-teardown pattern as `viewActions.fitView`), so `ToolOptions` can invoke it in Task 4.

- [ ] **Step 1: State and preference**

`appState.svelte.ts` — `fill: { tolerance: number; expand: number }` becomes
`fill: { tolerance: number; expand: number; gap: number }`, initialised `gap: 0`.

`src/persist/preferences.ts:8` — add `gap: number` to the `fill` field.

`applyPreferences` already merges (`state.fill = { ...state.fill, ...p.fill }`), so an older stored preference without `gap` keeps the default. **Verify that** — load is `{ ...state.fill, ...p.fill }`, and `p.fill.gap` being absent must leave `0` rather than writing `undefined`.

- [ ] **Step 2: The action**

In `Canvas.svelte`, add a function next to the existing click-fill (`applyFill`, ~:390-450) and follow its shape exactly. Read that function first; mirror its guards rather than inventing new ones.

```ts
  /** Fill every ink-enclosed region on the current cell, behind the strokes. Unlike the click fill
   *  this needs no pointer, so no compose inverse — it works on the cell's own pixels. */
  function fillAllEnclosedOnCell() {
    const layer = activeLayer();
    if (!isLayerEditable(layer, appState.project.groups)) return;
    const canvas = ensureDrawableKeyframe(layer, appState.playhead, canvasOps);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const color = hexToRgba(appState.brush.color, appState.brush.opacity);
    let painted = 0;
    if (selection && selection.state === "selected") {
      // Same shape as the click fill: paint a temp copy, composite back through the clip.
      const tmp = document.createElement("canvas");
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
      tctx.drawImage(canvas, 0, 0);
      painted = fillAllEnclosed(tctx, color, {
        gap: appState.fill.gap,
        expand: appState.fill.expand,
      });
      if (painted > 0) {
        ctx.save();
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        selection.applyClip(ctx);
        ctx.drawImage(tmp, 0, 0, tmp.width / DPR, tmp.height / DPR);
        ctx.restore();
      }
    } else {
      painted = fillAllEnclosed(ctx, color, {
        gap: appState.fill.gap,
        expand: appState.fill.expand,
      });
    }

    if (painted === 0) {
      // Must not silently no-op: this looks identical to filling an already-white interior.
      appState.statusHint = "Nothing enclosed — the outline isn't closed, or is already filled";
      return;
    }
    const after = ctx.getImageData(0, 0, canvas.width, canvas.height);
    history.push(
      pixelCommand(
        () => {
          ctx.putImageData(before, 0, 0);
          recomposite();
        },
        () => {
          ctx.putImageData(after, 0, 0);
          recomposite();
        },
        before,
        after,
      ),
    );
    bump();
  }
```

**On the early return:** `ensureDrawableKeyframe` may already have materialised a keyframe on a hold before we discover there is nothing to paint, leaving a ·→◆ marker with no undo entry. That is the app's existing known behaviour for delete/paste on a hold (recorded in `CLAUDE.md`), so it is consistent — but note it in your report rather than fixing it here.

- [ ] **Step 3: Registry**

In `appState.svelte.ts`, beside `viewActions`:

```ts
/** Canvas-owned fill actions. `ToolOptions` reaches the active cell's pixels through here — the
 *  canvas owns the keyframe, the undo bracket and the selection clip. */
export const fillActions: { allEnclosed: (() => void) | null } = { allEnclosed: null };
```

Register it in `Canvas.svelte`'s `onMount` (`fillActions.allEnclosed = fillAllEnclosedOnCell`) and null it in the teardown, exactly where `viewActions.fitView` is set and cleared.

- [ ] **Step 4: Verify**

Run: `npm run build` (0/0) and `npm test` (still 488).
Run: `grep -rn "fillActions" src` — the declaration, the register, the teardown. Task 4 adds the caller.

- [ ] **Step 5: Commit**

```bash
git add src/state/appState.svelte.ts src/persist/preferences.ts src/lib/Canvas.svelte
git commit -m "feat: a fill-all-enclosed action on the active cell"
```

---

### Task 4: The control, and docs

**Files:**
- Modify: `src/lib/ToolOptions.svelte` (the `fill` branch, ~:157-170)
- Modify: `CLAUDE.md`, `README.md`

- [ ] **Step 1: The Gap control and the button**

In the `{:else if appState.tool === "fill"}` branch, after the existing Expand label and before the colour input:

```svelte
    <label
      class="flex items-center gap-1 text-xs text-text-secondary"
      title="Bridge breaks in the outline before filling, up to about twice this many pixels"
      >Gap
      <input type="range" min="0" max={MAX_GAP} class="w-16" bind:value={appState.fill.gap} />
      <span class="text-xs w-4 tabular-nums">{appState.fill.gap}</span>
    </label>
    <button
      class="h-7 px-2 rounded border border-border bg-surface text-text-secondary text-xs hover:bg-surface-hover hover:text-text"
      title="Fill every area enclosed by the outline, behind the strokes"
      onclick={() => fillActions.allEnclosed?.()}>Fill enclosed</button
    >
```

Import `MAX_GAP` from `../core/fill-holes` and `fillActions` from the store. A range (not a number input) matches Tolerance and Expand beside it, and `max={MAX_GAP}` needs no clamping handler because a range cannot exceed its max.

- [ ] **Step 2: Documentation**

`CLAUDE.md` — add an entry recording: that this PAINTS where the pose fill only masks, and why that is not the auto-fill declined in June (the tool finds the regions; the user presses the button); the fail-safe property inherited from `fillEnclosed` (border flood ⇒ a leak paints nothing, never the canvas); why `gap` and `expand` are both present and different (gap bridges breaks in the outline before the flood, expand grows the result to tuck under anti-aliased fringe); that it always composites `destination-over` unlike `floodFill`, which only does so when `expand > 0`; that `state.fill` is persisted so `gap` rides along and old preferences merge safely; and that an empty result reports rather than no-ops, because a no-op and a successful fill of an already-white interior are indistinguishable.

`README.md` — one user-facing bullet under Drawing: the Fill tool can fill every area enclosed by an outline in one press, behind the strokes. Do not paste the mechanism. Refresh the test count in the scripts block by running `npm test` — do not guess it.

- [ ] **Step 3: Verify and commit**

Run `npm test` and `npm run build` (0/0), then:

```bash
git add src/lib/ToolOptions.svelte CLAUDE.md README.md
git commit -m "feat: Fill enclosed button in the Fill tool options"
```

- [ ] **Step 4: Hand the browser pass to the controller**

Nothing in Tasks 2–4 is reachable by the test suite. Report that they are build + review verified and list what needs eyeballing: an outline drawing filling behind its strokes with no halo at `expand ≥ 1`; the strokes themselves unmodified; undo restoring in one step; a gapped outline reporting rather than silently doing nothing, and raising Gap then filling it; a solid drawing reporting "nothing enclosed"; filling on a HOLD materialising a keyframe; a selection clipping the fill; a locked or hidden layer refusing; and the Pose tool then meshing that drawing as a body with **Fill outlines off** — the end-to-end point of the feature.

---

## Self-Review

**Spec coverage:** requirement 1 (Fill tool button) → Task 4 Step 1. Requirement 2 (current cell only) → Task 3's action takes the active layer at the playhead; no batch path exists anywhere. Requirement 3 (fill colour, behind) → Task 2's unconditional `destination-over` with `hexToRgba(appState.brush.color, …)`. Spec §Region → Task 1. §Gap → Task 3 Step 1 + Task 4 Step 1. §Anti-aliased edges → Task 1's `expand`. §Painting → Task 2. §Wiring → Task 3 Step 2 (keyframe, undo, guards, clip, bump). §Feedback → Task 3 Step 2's `painted === 0` branch.

**Placeholder scan:** no TBDs; every code step carries literal code; the browser step enumerates its checks.

**Type consistency:** `enclosedRegion` → `{ region, area }`, `fillAllEnclosed` → `number`, `state.fill.gap`, `fillActions.allEnclosed`, `MAX_GAP` are spelled identically wherever declared or consumed.

**Known risks:** (1) Task 1's first fixture asserts 81; if the existing `ring()` helper's geometry differs from the spec's description the number moves — the plan says to derive it rather than edit blindly. (2) Task 3 touches the persisted `Preferences` shape; the merge is believed back-compatible and the plan requires verifying it rather than assuming.
