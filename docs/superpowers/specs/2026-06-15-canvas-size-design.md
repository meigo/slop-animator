# Canvas Size (New + Resize) Design

**Status:** Approved (design phase)
**Date:** 2026-06-15

## Goal

Let the artist **choose the canvas size when creating a new project** and **resize an existing
project** afterward. Resizing defaults to **scaling** the drawings to fit (aspect-preserving),
with an option to **crop/extend** instead, and a **3×3 anchor** that positions the content for
the transform.

## Background — what's coupled to canvas size

- `createProject(opts)` already accepts `width`/`height` (defaults 1280×720), so a new-project
  picker just feeds it.
- Every keyframe canvas is created at `project.width × project.height × DPR`
  (`createCellCanvas`). So **resizing means re-creating every keyframe canvas** across all
  drawing layers and frames, and deciding what happens to the art on each.
- Consumers of `project.width/height` (render clear/fill, `Canvas.svelte` display/overlay/scratch
  canvas sizing, onion scratch, export, persistence) all read the values live — they adapt once
  the dimensions change **and** the keyframe canvases are resized **and** the display canvases are
  re-sized.
- Reference (image/video) layers draw with a "contain" fit (`containRect`) computed from
  `project.width/height`, so they re-fit automatically on resize — no per-layer work.
- Hold cells have no canvas; only `kind: "key"` cells own a canvas to re-create.

## Decisions (locked)

1. **Resize default = Scale** (uniform, aspect-preserving fit). **Option = Crop/extend** (keep
   pixel scale). A **3×3 anchor** applies in **both** modes.
2. Scale never distorts: it fits with a single factor; on a different aspect ratio it leaves
   margin, positioned by the anchor (same aspect → fills exactly, anchor moot).
3. Resize is **undoable** as one step (canvases + dimensions).
4. New-project size picker offers **presets + custom W×H** (size only; fps/bg stay where they
   are).

---

## Architecture

### Pure placement helper (the only non-trivial logic → unit-tested)

`src/anim/resize.ts` (new):

```ts
export type ResizeMode = "scale" | "crop";
export interface Anchor { ax: 0 | 0.5 | 1; ay: 0 | 0.5 | 1 } // 3×3 grid (0=left/top … 1=right/bottom)

/** Where the old content (oldW×oldH) lands inside a new canvas (newW×newH), in the same px units.
 *  scale → uniform fit factor min(newW/oldW, newH/oldH); crop → factor 1 (pixel scale kept).
 *  The anchor positions the placed content (margin distributed per ax/ay). */
export function placeContent(
  oldW: number, oldH: number, newW: number, newH: number, mode: ResizeMode, anchor: Anchor
): { x: number; y: number; w: number; h: number };
```

Implementation: `factor = mode === "scale" ? Math.min(newW/oldW, newH/oldH) : 1`; `w = oldW*factor`,
`h = oldH*factor`, `x = (newW - w) * anchor.ax`, `y = (newH - h) * anchor.ay`. (Negative `x`/`y`
on shrink = crop on the anchored side; positive = margin.) Guard `oldW`/`oldH` ≤ 0 → identity.

### Resize action

`resizeProject(newW, newH, mode, anchor)` in `appState.svelte.ts`:
- Compute `rect = placeContent(oldW*DPR, oldH*DPR, newW*DPR, newH*DPR, mode, anchor)` (device px).
- For each drawing layer, each `kind: "key"` cell: `const nc = createCellCanvas(newW, newH, DPR)`,
  draw the old canvas into `nc` at identity transform via `ctx.drawImage(old, rect.x, rect.y, rect.w, rect.h)`,
  then **replace the cell object**: `layer.cells[i] = { kind: "key", canvas: nc }`. (Replace, not
  `cell.canvas = nc` — the undo snapshot shares cell objects, so mutating one in place would
  corrupt the before-snapshot and break undo.)
- Set `project.width = newW; project.height = newH`.
- Wrap the whole thing in `commitStructural(...)` so it's one undo step.

**Undo:** extend the existing structural snapshot to carry dimensions. `StructSnapshot` gains
`width`/`height`; `snapshotStructure` captures them and `restoreStructure` restores them (plus the
cells arrays, which already hold the canvas refs — the before-snapshot keeps the old canvases, so
undo swaps them and the dimensions back together). This is the minimal change that makes the
canvas-swap + dimension-change reversible in one command, reusing `commitStructural`.

### Display re-sizing on dimension change

`Canvas.svelte` sizes its `display`, selection `overlay`, and onion `scratch` canvases from
`project.width/height` (currently on mount). Add: the rAF poll tracks `lastW`/`lastH`; when they
differ from `state.project.width/height`, call `sizeDisplay()` (and re-size overlay/scratch) before
recompositing. This makes both resize and undo-of-resize update the on-screen canvases. (The
existing version/playhead poll is the natural place.)

### New-project action

`createNewProject(width, height)` in `appState.svelte.ts`: `replaceProject(createProject({ width, height }))`
then `clearAutosave()` (mirrors the current `Toolbar.newProject`). `replaceProject` already clears
history + resets playhead/active layer.

### UI — one shared dialog

`src/lib/SizeDialog.svelte` (new), mounted in `App.svelte` like `ExportDialog`, gated by a state
flag `state.sizeDialog: { open: boolean; mode: "new" | "resize" }`.

- **Both modes:** size **presets** (buttons: `1920×1080`, `1280×720`, `1080×1080`, `1080×1920`,
  `1024×768`) that fill the W and H number inputs; editable **W**/**H** number inputs.
- **Resize mode only:** a **Scale / Crop** toggle (default Scale) and a clickable **3×3 anchor
  grid** (9 cells → sets `{ax, ay}`, default center). Pre-fills W/H with the current document size.
- **Confirm:** new mode → `createNewProject(w, h)`; resize mode → `resizeProject(w, h, mode, anchor)`.
  Then close. Guard: W/H clamped to a sane range (e.g. 16–8192) and rounded to integers.

**Entry points:** the toolbar **New** button (`FilePlus2`) opens the dialog in `mode: "new"`
(instead of newing instantly); a **new toolbar button** (lucide `Scaling`) opens it in
`mode: "resize"`, prefilled with the current size.

---

## Data model & persistence

No model change beyond the in-memory `StructSnapshot` extension (dimensions for undo). `project.width`
/`height` are already persisted; saved files round-trip unchanged. `state.sizeDialog` is transient
UI state (not persisted).

## Testing

- **`placeContent`** (pure, Vitest): scale same-aspect (fills, factor = ratio); scale different
  aspect (fits, margin, anchor positions it — test top-left vs center vs bottom-right); crop bigger
  (margin, factor 1); crop smaller (negative offset = crop, per anchor); degenerate `oldW=0` →
  identity rect.
- **Manual** (browser/iPad): new-project size picker creates a correctly-sized doc; resize Scale
  on same and different aspect; resize Crop with different anchors; undo/redo of a resize restores
  art + dimensions + on-screen canvas size; export uses the new size; save/reload keeps the size.

## Phasing → implementation plan

One plan (cohesive). Natural task order:
1. `placeContent` pure helper + tests.
2. `StructSnapshot` dimension fields (snapshot/restore) — keeps undo correct.
3. `resizeProject` action (canvas re-creation, wrapped in `commitStructural`).
4. `Canvas.svelte` display re-sizing on dimension change.
5. `createNewProject` action + `state.sizeDialog` flag.
6. `SizeDialog.svelte` (presets, W/H, Scale/Crop toggle, 3×3 anchor) + wire the two toolbar entry points.

## Out of scope (future)

- Aspect-ratio lock (link W/H) in the dialog.
- Non-destructive document size (drawings unchanged, only the frame box) beyond the crop/extend
  re-canvas.
- Per-layer independent sizing; rotating the canvas.
- Setting fps / background color from this dialog (they live elsewhere).
