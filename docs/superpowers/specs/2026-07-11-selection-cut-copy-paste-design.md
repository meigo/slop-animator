# Canvas selection cut / copy / delete / paste — design

**Date:** 2026-07-11
**Status:** Design (approved for planning)
**Feature:** Cut / copy / delete the selected drawing pixels, and paste them back as a movable
floating selection. Complements the existing selection transform (move/scale/rotate/distort/warp).

## Motivation

The Select/Lasso tool already lifts pixels and transforms them (move/scale/rotate + distort + mesh
warp, Enter to commit). But there's **no way to delete, copy, or cut** the selected pixels —
`Delete`/`Backspace` is wired only to the *timeline* selection, and there's no pixel clipboard. The
lift machinery already does most of the work: `Selection.liftPixels()` extracts the region (rect or
lasso-clipped) *and* clears it from the layer, and the commit path stamps a float back with undo.

## Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Clipboard | **Internal** in-memory pixel clipboard `{ canvas, rect }`. Reliable on iPad/HTTP, no permissions; not persisted; independent of the timeline cell clipboard and the OS clipboard. |
| D2 | Paste behavior | **Floating selection to reposition** — pixels return as a fresh float on the active layer; drag/transform to place, **Enter commits** (reuses the lift/commit path). |
| D3 | Operate on state | Copy/cut/delete act on a committed marquee (`state === "selected"`), **not** a mid-transform float (no-op while transforming — Enter/Esc first). |
| D4 | `⌘/Ctrl+V` priority | Canvas-pixel paste wins **only when the Select/Lasso tool is active**; else timeline cell clipboard; else the existing image→reference-layer paste. |
| D5 | Layer guard | Copy/cut/delete/paste require an **unlocked drawing layer** (no-op on ref/locked). |

## Architecture

Three layers, mirroring how `enterWarp` is already wired:
- **`src/core/selection.ts`** — pixel-level helpers on the `Selection` class (canvas-coupled).
- **`src/lib/Canvas.svelte`** — owns `selCtx`/`selBefore`/`history`/`DPR`/active-layer canvas; implements the four operations and registers them on `selectionActions`; holds the clipboard.
- **`src/state/appState.svelte.ts`** — extends the `selectionActions` registry.
- **`src/App.svelte`** — keyboard wiring. **`src/lib/SelectionActions.svelte`** — action-bar buttons.

### `selection.ts` — refactor + new methods

`liftPixels(srcCtx, dpr)` currently *extracts + clears* in one pass (with a lasso clip path used for
both). Split the two halves so copy (extract-only) and delete (clear-only) can reuse them:

```ts
/** Build a float canvas of the selected region (rect or lasso-clipped). Does NOT modify the source. */
copyPixels(srcCtx: CanvasRenderingContext2D, dpr: number): HTMLCanvasElement | null;

/** Clear the selected region (rect or lasso-clipped) from the source. Does NOT extract. */
clearRegion(srcCtx: CanvasRenderingContext2D, dpr: number): void;

/** Enter a floating transform from externally-supplied pixels (paste): set `rect`, reset the
 *  transform to identity, and go to state "transforming" with `pixels` as the float. */
pasteFloat(pixels: HTMLCanvasElement, rect: { x: number; y: number; w: number; h: number }): void;
```

`liftPixels` becomes `const cvs = copyPixels(...); clearRegion(...); return cvs;` (behavior-preserving
— the lasso clip path is computed the same way in both halves). `pasteFloat` sets `this.rect`,
resets the transform (dx/dy=0, scale=1, rotation=0), then `beginTransform(pixels)` (state →
"transforming").

### `Canvas.svelte` — operations + clipboard + registry

A component-level `let selectionClipboard: { canvas: HTMLCanvasElement; rect: Rect } | null = null;`
(session-lived; survives layer/frame switches so you can copy on one frame and paste on another).

Each op resolves the **active drawing layer's current-frame canvas** the same way the existing lift
does (guard: active layer is `draw`, not locked; selection present). All operate in CSS/logical
coords (`setTransform(DPR,…)`), matching `liftPixels`.

```ts
// COPY — state "selected" → extract to clipboard (source untouched, selection stays).
function copySelection() {
  if (!selection || selection.state !== "selected" || !selection.rect) return;
  const ctx = activeLayerCtx(); if (!ctx) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const float = selection.copyPixels(ctx, DPR);
  if (float) selectionClipboard = { canvas: float, rect: { ...selection.rect } };
}

// DELETE — state "selected" → clear region, one undo command, drop the marquee.
function deleteSelection() {
  if (!selection || selection.state !== "selected") return;
  const ctx = activeLayerCtx(); if (!ctx) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const before = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  selection.clearRegion(ctx, DPR);
  const after = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  history.push({
    undo: () => { ctx.putImageData(before, 0, 0); bump(); },
    redo: () => { ctx.putImageData(after, 0, 0); bump(); },
  });
  selection.cancel(); // clear the marquee (no float → onCancel no-ops)
  bump();
}

// CUT = copy + delete.
function cutSelection() { copySelection(); deleteSelection(); }

// PASTE — clipboard → floating selection on the active layer; Enter later commits. Returns whether it pasted.
function pasteSelection(): boolean {
  if (!selectionClipboard) return false;
  const ctx = activeLayerCtx(); if (!ctx) return false;
  liftGuard.discard?.();               // drop any in-progress lift first
  selCtx = ctx;
  selCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  selBefore = selCtx.getImageData(0, 0, selCtx.canvas.width, selCtx.canvas.height); // for the commit undo
  const r = selectionClipboard.rect;
  const dropRect = { x: r.x + PASTE_OFFSET, y: r.y + PASTE_OFFSET, w: r.w, h: r.h }; // small offset so a copy is visible
  selection.pasteFloat(cloneCanvas(selectionClipboard.canvas), dropRect);
  state.tool = "select";               // show the transform gizmo; Enter/Esc act on it
  bump();
  return true;
}
```

Notes:
- **Paste is additive** (float over the layer): `selBefore` is snapshotted *before* the float is
  stamped, so the existing `onCommit` (which `renderFloatingTo(selCtx)` + pushes a before/after undo)
  correctly records "layer + pasted pixels", and undo restores the pre-paste layer. The pasted float
  is a **clone** of the clipboard canvas, so repeated pastes don't share/consume it.
- `PASTE_OFFSET` ≈ 8 logical px so a paste-in-place reads as a new copy.
- Register in `onMount`: `selectionActions.copy = copySelection; …cut; …del = deleteSelection; …paste = pasteSelection;` and null them in the teardown return (like `enterWarp`).

### `appState.svelte.ts` — registry

```ts
export const selectionActions: {
  enterWarp: ((rows: number, cols: number) => void) | null;
  copy: (() => void) | null;
  cut: (() => void) | null;
  del: (() => void) | null;
  paste: (() => boolean) | null;
} = { enterWarp: null, copy: null, cut: null, del: null, paste: null };
```

### `App.svelte` — keyboard (after the INPUT/TEXTAREA guard)

`selectionRef.current` is the `Selection`; a committed marquee is `active && !hasFloating`.

```ts
const selActive = !!selectionRef.current?.active && !selectionRef.current.hasFloating;
const selectTool = state.tool === "select" || state.tool === "lasso";

if (e.key === "Delete" || e.key === "Backspace") {
  if (selActive) { e.preventDefault(); selectionActions.del?.(); return; }
  if (state.timelineSelection) { e.preventDefault(); deleteTimelineSelection(); return; }
}
if (meta && e.key.toLowerCase() === "c") {
  if (selActive) { e.preventDefault(); selectionActions.copy?.(); return; }
  if (state.timelineSelection) { e.preventDefault(); copyTimelineSelection(); return; }
}
if (meta && e.key.toLowerCase() === "x") {
  if (selActive) { e.preventDefault(); selectionActions.cut?.(); return; }
  if (state.timelineSelection) { e.preventDefault(); cutTimelineSelection(); return; }
}
if (meta && e.key.toLowerCase() === "v") {
  if (selectTool && selectionActions.paste?.()) { e.preventDefault(); cellPasteHandled = true; return; } // pixel paste won → stop
  if (state.cellClipboard) { e.preventDefault(); cellPasteHandled = true; pasteCells(e.shiftKey); return; }
  // else falls through to onPaste (OS image → reference layer)
}
```

`paste()` returns `false` when the pixel clipboard is empty, so `⌘V` with the select tool active but
nothing copied falls through to the timeline/image paths (no swallow). `cellPasteHandled` still gates
the window `paste` event so an image isn't also pasted.

### `SelectionActions.svelte` — action-bar buttons

When `mode === "selected"`, add **Copy · Cut · Delete** buttons (lucide `Copy` / `Scissors` /
`Trash2`) beside Free-transform, wired to new `onCopy`/`onCut`/`onDelete` props that `Canvas.svelte`
passes (mirroring the existing `onTransform`/`onDistort`/`onMesh` props). Paste stays keyboard-only
(it needs no active selection; a canvas paste button can come later).

## Edge cases

- **Locked / reference active layer:** all four ops no-op (D5 guard).
- **Empty selection / degenerate rect:** `copyPixels` returns null → copy/cut no-op; delete no-ops.
- **Mid-transform (floating):** copy/cut/delete no-op (D3); paste first `liftGuard.discard`s a live lift.
- **Undo:** delete = one before/after `ImageData` command; paste-then-commit = the existing lift
  commit command; both interleave with other history correctly (canvas refs shared, pixels snapshotted).
- **Lasso vs rect:** `copyPixels`/`clearRegion` honor the lasso clip path exactly as `liftPixels` does.

## Testing

Selection/canvas code is **canvas-coupled** (getContext/drawImage/getImageData) and not node-testable
(Vitest has no DOM/canvas) — consistent with the existing untested `selection.ts`. Verification:
- **Build:** `npm run build` 0/0; `npm test` baseline unaffected (no new unit tests).
- **Reasoning:** the `liftPixels` refactor is behavior-preserving (extract + clear halves unchanged);
  paste is additive with a pre-snapshot; ops guard on state/layer.
- **Browser (verification debt — flag to user):** copy→paste (float, reposition, Enter commits, undo);
  cut (pixels gone + pasteable); delete (undo restores); lasso-shaped copy/delete; paste on a
  *different* layer/frame than copied; `⌘V` priority (select tool = pixels, else timeline/image);
  action-bar Copy/Cut/Delete; locked/ref layer no-op; iPad parity.

## Non-goals / deferred

- **System-clipboard interop** (cross-app copy/paste) — deferred (permissions/HTTPS/iPad-Safari; the
  existing image→ref-layer paste covers bringing outside images in).
- **A canvas Paste button / paste-at-cursor** — keyboard paste only for now.
- **Copy/cut across the *timeline* clipboard** — the two clipboards stay independent.
- Copy/cut while **mid-transform** (must commit/cancel first).
