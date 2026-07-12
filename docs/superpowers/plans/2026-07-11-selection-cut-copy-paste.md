# Canvas Selection Cut/Copy/Delete/Paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut / copy / delete the selected drawing pixels and paste them back as a movable floating selection.

**Architecture:** New pixel helpers on the `Selection` class (`copyPixels`/`clearRegion`/`pasteFloat`, refactored out of `liftPixels`); the four operations + an internal clipboard in `Canvas.svelte`, exposed via the `selectionActions` registry; action-bar buttons in `SelectionActions.svelte`; keyboard wiring in `App.svelte`. Reuses the existing lift/commit/undo path.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vite, Vitest.

## Global Constraints

- Build bar: `npm run build` must be **0 errors, 0 warnings**.
- `src/core/selection.ts` and `Canvas.svelte` are **canvas-coupled** (getContext/drawImage/getImageData) → NOT node-testable; verified by **build + reasoning + browser** (consistent with the existing untested selection code). `npm test` baseline (**319**) must stay green (regression only — no new unit tests).
- **`Canvas.svelte` imports the store as `state as appState`** (runes gotcha #1) — use `appState.` there. `App.svelte` imports `{ state }` unaliased — use `state.` there.
- Ops act on a committed marquee (`selection.state === "selected"`), not a mid-transform float. Guard on an **unlocked drawing layer** (copy may read a locked layer; delete/paste require unlocked — see tasks).
- Undo: delete pushes one before/after `ImageData` command; paste reuses the existing lift-commit command. Never mutate a cell in place outside these commands.
- Surgical edits; match existing style. Pre-commit hook reformats staged files (expected).

---

## File Structure

- **Modify** `src/core/selection.ts` — split `liftPixels` → `copyPixels` + `clearRegion`; add `pasteFloat`.
- **Modify** `src/state/appState.svelte.ts` — extend the `selectionActions` registry type + init.
- **Modify** `src/lib/Canvas.svelte` — clipboard + `copy/cut/delete/paste` + register/teardown + pass props.
- **Modify** `src/lib/SelectionActions.svelte` — Copy/Cut/Delete buttons.
- **Modify** `src/App.svelte` — keyboard wiring (Delete / ⌘C / ⌘X / ⌘V with gating).

---

## Task 1: `selection.ts` — split `liftPixels`; add `pasteFloat`

**Files:**
- Modify: `src/core/selection.ts`

**Interfaces:**
- Produces (public methods on `Selection`):
  - `copyPixels(srcCtx: CanvasRenderingContext2D, dpr: number): HTMLCanvasElement | null` (extract, no source change)
  - `clearRegion(srcCtx: CanvasRenderingContext2D, dpr: number): void` (clear source, no extract)
  - `pasteFloat(pixels: HTMLCanvasElement, rect: SelectionRect): void`
  - `liftPixels` unchanged in behavior (now `copyPixels` + `clearRegion`).

Canvas-coupled → build + reasoning verified. The refactor MUST be behavior-preserving for `liftPixels`.

- [ ] **Step 1: Refactor `liftPixels` into two halves**

Replace the existing `liftPixels(srcCtx, dpr)` method with these three methods (the extract half and the clear half are the *exact* code from the current `liftPixels`, just separated):

```ts
  /** Build a float canvas of the selected region (rect or lasso-clipped). Does NOT modify the source. */
  copyPixels(srcCtx: CanvasRenderingContext2D, dpr: number): HTMLCanvasElement | null {
    if (!this.rect) return null;
    const r = this.rect;
    const px = Math.round(r.x * dpr);
    const py = Math.round(r.y * dpr);
    const pw = Math.round(r.w * dpr);
    const ph = Math.round(r.h * dpr);
    if (pw <= 0 || ph <= 0) return null;

    const cvs = document.createElement("canvas");
    cvs.width = pw;
    cvs.height = ph;
    const ctx = cvs.getContext("2d")!;

    if (this.lassoPath) {
      ctx.save();
      const clipPath = new Path2D();
      for (let i = 0; i < this.lassoPoints.length; i++) {
        const lx = (this.lassoPoints[i].x - r.x) * dpr;
        const ly = (this.lassoPoints[i].y - r.y) * dpr;
        if (i === 0) clipPath.moveTo(lx, ly);
        else clipPath.lineTo(lx, ly);
      }
      clipPath.closePath();
      ctx.clip(clipPath);
      ctx.drawImage(srcCtx.canvas, px, py, pw, ph, 0, 0, pw, ph);
      ctx.restore();
    } else {
      ctx.drawImage(srcCtx.canvas, px, py, pw, ph, 0, 0, pw, ph);
    }
    return cvs;
  }

  /** Clear the selected region (rect or lasso-clipped) from the source. Does NOT extract. */
  clearRegion(srcCtx: CanvasRenderingContext2D, dpr: number): void {
    if (!this.rect) return;
    const r = this.rect;
    if (this.lassoPath) {
      srcCtx.save();
      const srcClip = new Path2D();
      for (let i = 0; i < this.lassoPoints.length; i++) {
        const lx = this.lassoPoints[i].x * dpr;
        const ly = this.lassoPoints[i].y * dpr;
        if (i === 0) srcClip.moveTo(lx, ly);
        else srcClip.lineTo(lx, ly);
      }
      srcClip.closePath();
      srcCtx.resetTransform();
      srcCtx.clip(srcClip);
      srcCtx.clearRect(0, 0, srcCtx.canvas.width, srcCtx.canvas.height);
      srcCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      srcCtx.restore();
    } else {
      srcCtx.clearRect(r.x, r.y, r.w, r.h);
    }
  }

  /** Lift the selected pixels off the layer: extract to a float AND clear the source. */
  liftPixels(srcCtx: CanvasRenderingContext2D, dpr: number): HTMLCanvasElement | null {
    const cvs = this.copyPixels(srcCtx, dpr);
    if (!cvs) return null;
    this.clearRegion(srcCtx, dpr);
    return cvs;
  }
```

- [ ] **Step 2: Add `pasteFloat`**

Add near `beginTransform`:

```ts
  /** Enter a floating transform from externally-supplied pixels (paste): position at `rect` as a
   *  rectangular float and go to "transforming" (beginTransform resets the matrix to identity). */
  pasteFloat(pixels: HTMLCanvasElement, rect: SelectionRect): void {
    this.rect = { ...rect };
    this.mode = "rect";
    this.lassoPath = null;
    this.lassoPoints = [];
    this.beginTransform(pixels);
  }
```

- [ ] **Step 3: Verify build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → 319 passing (no behavior change).

- [ ] **Step 4: Commit**

```bash
git add src/core/selection.ts
git commit -m "refactor: split Selection.liftPixels into copyPixels + clearRegion; add pasteFloat"
```

---

## Task 2: appState registry + Canvas operations

**Files:**
- Modify: `src/state/appState.svelte.ts` (`selectionActions` type + init)
- Modify: `src/lib/Canvas.svelte` (clipboard, ops, register/teardown, imports)

**Interfaces:**
- Consumes: `Selection.copyPixels/clearRegion/pasteFloat` (Task 1); existing `activeLayer`, `ensureDrawableKeyframe`, `canvasOps`, `resolvedKeyCell`, `cloneCanvas`, `history`, `bump`, `liftGuard`, `selCtx`/`selBefore`, `DPR`, `appState`.
- Produces: `selectionActions.copy/cut/del/paste`; `copySelection/cutSelection/deleteSelection/pasteSelection` in Canvas.

Canvas-coupled → build + browser verified.

- [ ] **Step 1: Extend the `selectionActions` registry**

In `src/state/appState.svelte.ts`, replace the `selectionActions` declaration:

```ts
/** Canvas-owned selection actions reachable from App keyboard shortcuts + the action bar. */
export const selectionActions: {
  enterWarp: ((rows: number, cols: number) => void) | null;
  copy: (() => void) | null;
  cut: (() => void) | null;
  del: (() => void) | null;
  paste: (() => boolean) | null;
} = { enterWarp: null, copy: null, cut: null, del: null, paste: null };
```

- [ ] **Step 2: Imports + clipboard state in Canvas**

Ensure `Canvas.svelte` imports `resolvedKeyCell` and `cloneCanvas` (add to the existing `../anim/document` import if not present). Near the other `let`s (by `selCtx`/`selBefore`), add:

```ts
  const PASTE_OFFSET = 8; // logical px — so a paste-in-place reads as a new copy
  let selectionClipboard: { canvas: HTMLCanvasElement; rect: SelectionRect } | null = null;
```

(`SelectionRect` is exported from `../core/selection` — add to that import; if the type isn't exported, use `{ x: number; y: number; w: number; h: number }` inline.)

- [ ] **Step 3: Add the operations**

Add near `enterTransform` (they mirror its active-layer resolution):

```ts
  // Read-only ctx of the resolved key shown at the current frame (for copy — never materializes a key).
  function activeResolvedCtx(): CanvasRenderingContext2D | null {
    const layer = activeLayer();
    if (layer.kind !== "draw") return null;
    const rk = resolvedKeyCell(layer, appState.playhead);
    if (!rk) return null;
    const ctx = rk.cell.canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return ctx;
  }
  // Drawable ctx for the current frame (for delete/paste — materializes a key on a hold). Null if the
  // active layer isn't an unlocked drawing layer.
  function activeDrawableCtx(): CanvasRenderingContext2D | null {
    const layer = activeLayer();
    if (layer.kind !== "draw" || layer.locked) return null;
    const canvas = ensureDrawableKeyframe(layer, appState.playhead, canvasOps);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return ctx;
  }

  function copySelection() {
    if (!selection || selection.state !== "selected" || !selection.rect) return;
    const ctx = activeResolvedCtx();
    if (!ctx) return;
    const float = selection.copyPixels(ctx, DPR);
    if (float) selectionClipboard = { canvas: float, rect: { ...selection.rect } };
  }

  function deleteSelection() {
    if (!selection || selection.state !== "selected") return;
    const ctx = activeDrawableCtx();
    if (!ctx) return;
    const before = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    selection.clearRegion(ctx, DPR);
    const after = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    history.push({
      undo: () => {
        ctx.putImageData(before, 0, 0);
        bump();
      },
      redo: () => {
        ctx.putImageData(after, 0, 0);
        bump();
      },
    });
    selection.cancel(); // clear the marquee (no float → onCancel no-ops)
    bump();
  }

  function cutSelection() {
    copySelection();
    deleteSelection();
  }

  function pasteSelection(): boolean {
    if (!selectionClipboard) return false;
    liftGuard.discard?.(); // drop any in-progress lift before setting up the new float
    const ctx = activeDrawableCtx();
    if (!ctx) return false;
    selCtx = ctx;
    selBefore = selCtx.getImageData(0, 0, selCtx.canvas.width, selCtx.canvas.height); // for the commit undo
    const r = selectionClipboard.rect;
    selection?.pasteFloat(cloneCanvas(selectionClipboard.canvas), {
      x: r.x + PASTE_OFFSET,
      y: r.y + PASTE_OFFSET,
      w: r.w,
      h: r.h,
    });
    appState.tool = "select"; // show the transform gizmo; Enter commits / Esc cancels
    bump();
    return true;
  }
```

- [ ] **Step 4: Register + tear down on the registry**

Where `selectionActions.enterWarp = enterWarp;` is set in `onMount`, add:

```ts
    selectionActions.copy = copySelection;
    selectionActions.cut = cutSelection;
    selectionActions.del = deleteSelection;
    selectionActions.paste = pasteSelection;
```

In the `onMount` cleanup return, where `selectionActions.enterWarp = null;` is set (or alongside the other nulling), add:

```ts
      selectionActions.copy = null;
      selectionActions.cut = null;
      selectionActions.del = null;
      selectionActions.paste = null;
```

- [ ] **Step 5: Verify build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → 319 passing.

- [ ] **Step 6: Commit**

```bash
git add src/state/appState.svelte.ts src/lib/Canvas.svelte
git commit -m "feat: canvas selection copy/cut/delete/paste ops + clipboard (registry-wired)"
```

---

## Task 3: SelectionActions.svelte — Copy/Cut/Delete buttons

**Files:**
- Modify: `src/lib/SelectionActions.svelte` (add buttons + props)
- Modify: `src/lib/Canvas.svelte` (pass `onCopy`/`onCut`/`onDelete`)

**Interfaces:**
- Consumes: `copySelection`/`cutSelection`/`deleteSelection` (Task 2).
- Produces: three action-bar buttons in the `mode === "selected"` group.

DOM → build + browser verified.

- [ ] **Step 1: Add props + buttons**

In `SelectionActions.svelte`, add `onCopy`, `onCut`, `onDelete` to the component's `$props()` (mirroring the existing `onTransform`/`onDistort`/`onMesh` callback props — match how they're typed/destructured). Import the icons: `import { Copy, Scissors, Trash2 } from "@lucide/svelte";` (extend the existing lucide import).

Inside the `{#if mode === "selected"}` block, after the Free-transform button, add:

```svelte
    <button
      class="w-10 h-10 rounded-md border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover"
      onpointerdown={tap(onCopy)}
      title="Copy (Cmd/Ctrl+C)"
    >
      <Copy size={18} />
    </button>
    <button
      class="w-10 h-10 rounded-md border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover"
      onpointerdown={tap(onCut)}
      title="Cut (Cmd/Ctrl+X)"
    >
      <Scissors size={18} />
    </button>
    <button
      class="w-10 h-10 rounded-md border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover"
      onpointerdown={tap(onDelete)}
      title="Delete (Del)"
    >
      <Trash2 size={18} />
    </button>
```

- [ ] **Step 2: Pass the props from Canvas**

In `Canvas.svelte`'s `<SelectionActions … />`, add:

```svelte
    onCopy={copySelection}
    onCut={cutSelection}
    onDelete={deleteSelection}
```

- [ ] **Step 3: Verify build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → 319 passing.

- [ ] **Step 4: Browser verification (user-deferred checklist — do NOT run a browser)**

Record: with a marquee active, the action bar shows Copy/Cut/Delete; Copy then paste (Cmd+V) floats a copy; Cut removes + is pasteable; Delete erases (undo restores).

- [ ] **Step 5: Commit**

```bash
git add src/lib/SelectionActions.svelte src/lib/Canvas.svelte
git commit -m "feat: Copy/Cut/Delete buttons on the selection action bar"
```

---

## Task 4: App.svelte — keyboard wiring

**Files:**
- Modify: `src/App.svelte` (`onKey`, after the INPUT/TEXTAREA guard; imports)

**Interfaces:**
- Consumes: `selectionRef`, `selectionActions` (already imported); `state.tool`, `state.timelineSelection`, `state.cellClipboard`; existing timeline actions + `cellPasteHandled`.

DOM/keyboard → build + browser verified.

- [ ] **Step 1: Add the shortcuts**

In `App.svelte`'s `onKey`, immediately after the `if (tag === "INPUT" || tag === "TEXTAREA") return;` guard, insert (BEFORE the existing timeline `Delete`/`meta+c/x/v` blocks — the canvas selection takes precedence when active):

```ts
    const selActive = !!selectionRef.current?.active && !selectionRef.current.hasFloating;
    const selectTool = state.tool === "select" || state.tool === "lasso";

    if (e.key === "Delete" || e.key === "Backspace") {
      if (selActive) {
        e.preventDefault();
        selectionActions.del?.();
        return;
      }
      // (falls through to the existing timeline-selection delete below)
    }
    if (meta && e.key.toLowerCase() === "c" && selActive) {
      e.preventDefault();
      selectionActions.copy?.();
      return;
    }
    if (meta && e.key.toLowerCase() === "x" && selActive) {
      e.preventDefault();
      selectionActions.cut?.();
      return;
    }
    if (meta && e.key.toLowerCase() === "v" && selectTool) {
      if (selectionActions.paste?.()) {
        e.preventDefault();
        cellPasteHandled = true; // consume this Cmd+V so onPaste doesn't also image-paste
        return;
      }
      // pixel clipboard empty → fall through to the timeline/image paste below
    }
```

(The existing `Delete`/`Backspace` timeline block already checks `state.timelineSelection`, so a
canvas-inactive Delete still reaches it. The existing `meta+c/x/v` timeline blocks run after these and
are unreached when `selActive`/pixel-paste already returned.)

- [ ] **Step 2: Verify build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → 319 passing.

- [ ] **Step 3: Browser verification (user-deferred checklist — do NOT run a browser)**

Record: with the Select/Lasso tool + a marquee — `Cmd/Ctrl+C`/`X`/`Delete` copy/cut/delete pixels;
`Cmd/Ctrl+V` floats a paste (reposition, Enter commits); with a timeline selection instead, the same
keys still drive the timeline; `Cmd+V` with no pixel clipboard falls through to timeline cells / image
paste; typing in the fps input is unaffected.

- [ ] **Step 4: Commit**

```bash
git add src/App.svelte
git commit -m "feat: canvas selection cut/copy/delete/paste keyboard shortcuts (tool-gated)"
```

---

## Final verification

- [ ] **Full build:** `npm run build` → 0 errors, 0 warnings.
- [ ] **Full tests:** `npm test` → 319 passing.
- [ ] **Interactive pass (flag as verification debt):** copy→paste (float, reposition, Enter commits, undo); cut; delete (+undo); lasso-shaped copy/delete; paste on a different layer/frame; `⌘V` priority (select tool = pixels, else timeline/image); action-bar buttons; locked/ref layer no-op; iPad parity.

---

## Spec coverage self-check

- Copy/delete/cut/paste ops reusing lift/commit → Task 1 (`copyPixels`/`clearRegion`/`pasteFloat`) + Task 2.
- Internal `{ canvas, rect }` clipboard, paste-as-additive-float with pre-snapshot (D1, D2) → Task 2 (`pasteSelection`/`selectionClipboard`).
- Operate on "selected" state; unlocked-draw guard (D3, D5) → Task 2 (`activeResolvedCtx`/`activeDrawableCtx`, state guards). Copy reads the resolved key (read-only, no key materialization); delete/paste materialize on a hold.
- `⌘V` tool-gated priority pixels→cells→image (D4) → Task 4.
- Action-bar Copy/Cut/Delete → Task 3.
- Lasso vs rect honored in `copyPixels`/`clearRegion` → Task 1.
- Deferred (system clipboard, canvas paste button, mid-transform copy) → per spec Non-goals.
