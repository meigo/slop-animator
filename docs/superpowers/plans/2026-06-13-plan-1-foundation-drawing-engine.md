# Plan 1 — Foundation & Frame-by-Frame Drawing Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `slop-animator` Svelte app and the core animation engine so an artist can draw pressure-sensitive ink strokes onto frame cells, step between frames across multiple layers, and undo/redo — the foundation every later plan builds on.

**Architecture:** A fresh Svelte 5 + Vite + TypeScript + Tailwind 4 app. The drawing core (brush, input, viewport, pressure curve) is copied from the sibling `slop-paint` app under `src/core/`. New `src/anim/` modules hold a pure, unit-tested data model (`Project → Layer → Cell`), timeline operations, frame compositing, and a command-stack history. Pure logic is separated from canvas/DOM so it tests in plain Node. Svelte components wire the engine to the screen.

**Tech Stack:** Svelte 5 (runes), Vite 8, TypeScript 5.9, Tailwind 4, `perfect-freehand`, `lucide-svelte`, Vitest.

**Reference source:** `/Users/meigo/Projects/slop/slop-paint` (the app we copy the core from). The design spec is `docs/superpowers/specs/2026-06-13-slop-animator-design.md`.

---

## File Structure (created by this plan)

```
slop-animator/
  package.json, vite.config.ts, svelte.config.js, tsconfig.json, eslint.config.js, index.html
  src/
    main.ts
    app.css
    App.svelte
    core/                      ← copied from slop-paint
      brush.ts, stamp-brush.ts, brush-textures.ts, pressure-curve.ts
      input.ts, touch-gestures.ts, viewport.ts
    anim/
      document.ts              ← Project/Layer/Cell types + pure resolvers + factories
      timeline.ts              ← keyframe/hold/frame/layer operations (CanvasOps-injected)
      render.ts                ← composite one frame onto a 2D context
      history.ts               ← command-stack undo/redo
    state/
      appState.svelte.ts       ← reactive app state ($state)
    lib/
      Canvas.svelte            ← drawing surface (input → brush → active cell → composite)
      Timeline.svelte          ← frame ruler, playhead, add frame / keyframe / hold
      LayerList.svelte         ← list layers, add layer, set active, toggle visibility
      Toolbar.svelte           ← brush / eraser tool buttons + size/color
    __tests__/
      document.test.ts
      timeline.test.ts
      history.test.ts
      render.test.ts
```

**Responsibilities (one job each):**
- `document.ts` — data shapes + **pure** functions that never touch the DOM except in clearly-marked factory helpers.
- `timeline.ts` — mutate the model (add/insert/delete frames & keyframes, layers); canvas creation/cloning injected via a `CanvasOps` object so the logic is testable without a real canvas.
- `render.ts` — given a `Project` + frame index + target `CanvasRenderingContext2D`, paint that frame. Drawing-order logic extracted into the pure `buildFrameDrawList`.
- `history.ts` — a generic command stack (`{undo, redo}`), reused for both pixel edits and structural edits.
- `appState.svelte.ts` — the single reactive store the components read.

---

## Task 1: Scaffold the project

**Files:**
- Create: `package.json`, `vite.config.ts`, `svelte.config.js`, `tsconfig.json`, `eslint.config.js`, `index.html`, `src/main.ts`, `src/app.css`, `src/App.svelte`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "slop-animator",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "svelte-check && tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/",
    "check": "svelte-check"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@sveltejs/vite-plugin-svelte": "^7.0.0",
    "@tailwindcss/vite": "^4.2.2",
    "eslint": "^10.2.0",
    "svelte": "^5.55.1",
    "svelte-check": "^4.4.6",
    "tailwindcss": "^4.2.2",
    "typescript": "~5.9.3",
    "typescript-eslint": "^8.58.0",
    "vite": "^8.0.1",
    "vitest": "^4.1.2"
  },
  "dependencies": {
    "@lucide/svelte": "^1.3.0",
    "perfect-freehand": "^1.2.3"
  }
}
```

- [ ] **Step 2: Copy build config from slop-paint**

Run:
```bash
cp /Users/meigo/Projects/slop/slop-paint/svelte.config.js   ./svelte.config.js
cp /Users/meigo/Projects/slop/slop-paint/vite.config.ts     ./vite.config.ts
cp /Users/meigo/Projects/slop/slop-paint/tsconfig.json      ./tsconfig.json
cp /Users/meigo/Projects/slop/slop-paint/eslint.config.js   ./eslint.config.js
```
Then open `vite.config.ts` and confirm it includes the svelte and tailwind plugins (it does in slop-paint). No edits expected.

- [ ] **Step 3: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
    <title>slop-animator</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `src/app.css`**

```css
@import "tailwindcss";

html, body, #app { height: 100%; margin: 0; }
body { overscroll-behavior: none; font-family: system-ui, sans-serif; }
```

- [ ] **Step 5: Create `src/main.ts`**

```ts
import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

const app = mount(App, { target: document.getElementById("app")! });
export default app;
```

- [ ] **Step 6: Create a placeholder `src/App.svelte`**

```svelte
<script lang="ts">
</script>

<main class="h-full flex items-center justify-center text-neutral-600">
  slop-animator
</main>
```

- [ ] **Step 7: Install and verify the dev server boots**

Run:
```bash
npm install
npm run dev
```
Expected: Vite prints `Local: http://localhost:5173/`. Open it; the page shows "slop-animator". Stop the server (Ctrl+C).

- [ ] **Step 8: Verify the test runner works**

Create `src/__tests__/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
describe("smoke", () => {
  it("runs", () => { expect(1 + 1).toBe(2); });
});
```
Run: `npm test`
Expected: 1 passing test. Then delete `src/__tests__/smoke.test.ts`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold slop-animator Svelte app"
```

---

## Task 2: Copy the drawing core from slop-paint

**Files:**
- Create (by copy): `src/core/brush.ts`, `src/core/stamp-brush.ts`, `src/core/brush-textures.ts`, `src/core/pressure-curve.ts`, `src/core/input.ts`, `src/core/touch-gestures.ts`, `src/core/viewport.ts`

- [ ] **Step 1: Copy the files**

Run:
```bash
mkdir -p src/core
cd /Users/meigo/Projects/slop/slop-paint/src
cp brush.ts stamp-brush.ts brush-textures.ts pressure-curve.ts input.ts touch-gestures.ts viewport.ts \
   /Users/meigo/Projects/slop/slop-animator/src/core/
cd /Users/meigo/Projects/slop/slop-animator
```

- [ ] **Step 2: Verify imports resolve**

These modules import only from each other (`brush.ts` imports `./input` and `./brush-textures`; `stamp-brush.ts` imports `./brush-textures`). No path edits needed because they keep relative sibling imports inside `src/core/`.

Run: `npm run check`
Expected: no errors referencing `src/core/*`. (Unused-export warnings are fine.)

- [ ] **Step 3: Commit**

```bash
git add src/core
git commit -m "chore: copy drawing core (brush/input/viewport) from slop-paint"
```

---

## Task 3: Data model types + keyframe resolver (`document.ts`)

**Files:**
- Create: `src/anim/document.ts`
- Test: `src/__tests__/document.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/document.test.ts
import { describe, it, expect } from "vitest";
import { resolveKeyframeIndex, type Cell } from "../anim/document";

const key = (): Cell => ({ kind: "key", canvas: {} as HTMLCanvasElement });
const hold = (): Cell => ({ kind: "hold" });

describe("resolveKeyframeIndex", () => {
  it("returns null when there is no keyframe at or before the frame", () => {
    expect(resolveKeyframeIndex([hold(), hold()], 1)).toBeNull();
    expect(resolveKeyframeIndex([], 0)).toBeNull();
  });

  it("returns the frame's own index when it is a keyframe", () => {
    expect(resolveKeyframeIndex([key(), hold()], 0)).toBe(0);
  });

  it("walks back to the nearest prior keyframe across holds", () => {
    expect(resolveKeyframeIndex([key(), hold(), hold()], 2)).toBe(0);
  });

  it("picks the most recent keyframe when several precede the frame", () => {
    expect(resolveKeyframeIndex([key(), hold(), key(), hold()], 3)).toBe(2);
  });

  it("clamps a frame index past the end to the last cell", () => {
    expect(resolveKeyframeIndex([key(), hold()], 5)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- document`
Expected: FAIL — cannot find module `../anim/document`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/anim/document.ts

export type Cell =
  | { kind: "key"; canvas: HTMLCanvasElement }
  | { kind: "hold" };

export interface DrawingLayer {
  kind: "draw";
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..100
  cells: Cell[];    // length === project.frameCount
}

export type Layer = DrawingLayer; // reference layers arrive in a later plan

export interface Project {
  width: number;
  height: number;
  fps: number;
  bgColor: string;
  frameCount: number;
  layers: Layer[]; // layers[0] = bottom of the stack
}

/**
 * Index of the keyframe that is shown at `frame` on this cell track:
 * the nearest "key" cell at or before `frame`. Returns null if none precedes it.
 * A frame index past the end clamps to the last cell.
 */
export function resolveKeyframeIndex(cells: Cell[], frame: number): number | null {
  const start = Math.min(frame, cells.length - 1);
  for (let i = start; i >= 0; i--) {
    if (cells[i].kind === "key") return i;
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- document`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/anim/document.ts src/__tests__/document.test.ts
git commit -m "feat(anim): Project/Layer/Cell model + keyframe resolver"
```

---

## Task 4: Frame draw list (`buildFrameDrawList`)

**Files:**
- Modify: `src/anim/document.ts`
- Test: `src/__tests__/document.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/__tests__/document.test.ts`:
```ts
import { buildFrameDrawList, type Project, type DrawingLayer } from "../anim/document";

function layer(id: number, cells: Cell[], over: Partial<DrawingLayer> = {}): DrawingLayer {
  return { kind: "draw", id, name: `L${id}`, visible: true, locked: false, opacity: 100, cells, ...over };
}
function proj(layers: DrawingLayer[], frameCount: number): Project {
  return { width: 100, height: 100, fps: 12, bgColor: "#fff", frameCount, layers };
}

describe("buildFrameDrawList", () => {
  it("emits one op per visible layer that has a resolved keyframe, bottom to top", () => {
    const p = proj([layer(1, [key(), hold()]), layer(2, [hold(), key()])], 2);
    expect(buildFrameDrawList(p, 1)).toEqual([
      { layerId: 1, keyframeIndex: 0, opacity: 100 },
      { layerId: 2, keyframeIndex: 1, opacity: 100 },
    ]);
  });

  it("skips invisible layers", () => {
    const p = proj([layer(1, [key()], { visible: false }), layer(2, [key()])], 1);
    expect(buildFrameDrawList(p, 0)).toEqual([{ layerId: 2, keyframeIndex: 0, opacity: 100 }]);
  });

  it("skips layers with no keyframe yet at this frame", () => {
    const p = proj([layer(1, [hold(), key()])], 2);
    expect(buildFrameDrawList(p, 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- document`
Expected: FAIL — `buildFrameDrawList` is not exported.

- [ ] **Step 3: Implement**

Append to `src/anim/document.ts`:
```ts
export interface DrawOp {
  layerId: number;
  keyframeIndex: number;
  opacity: number;
}

/** Ordered list (bottom→top) of which keyframe each visible layer contributes at `frame`. */
export function buildFrameDrawList(project: Project, frame: number): DrawOp[] {
  const ops: DrawOp[] = [];
  for (const layer of project.layers) {
    if (!layer.visible) continue;
    const ki = resolveKeyframeIndex(layer.cells, frame);
    if (ki === null) continue;
    ops.push({ layerId: layer.id, keyframeIndex: ki, opacity: layer.opacity });
  }
  return ops;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- document`
Expected: PASS (all document tests).

- [ ] **Step 5: Commit**

```bash
git add src/anim/document.ts src/__tests__/document.test.ts
git commit -m "feat(anim): buildFrameDrawList composite ordering"
```

---

## Task 5: Canvas factories + project/layer constructors

**Files:**
- Modify: `src/anim/document.ts`

These touch the DOM, so they are plain factory helpers (not unit-tested here; exercised via the app and later jsdom tests).

- [ ] **Step 1: Add the factories**

Append to `src/anim/document.ts`:
```ts
/** Devicepixel-ratio-aware blank canvas sized to the document, with a dpr-scaled 2D context. */
export function createCellCanvas(width: number, height: number, dpr: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return canvas;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const dst = document.createElement("canvas");
  dst.width = src.width;
  dst.height = src.height;
  dst.getContext("2d")!.drawImage(src, 0, 0);
  return dst;
}

let nextLayerId = 1;

export function createDrawingLayer(frameCount: number, name?: string): DrawingLayer {
  return {
    kind: "draw",
    id: nextLayerId++,
    name: name ?? `Layer ${nextLayerId - 1}`,
    visible: true,
    locked: false,
    opacity: 100,
    cells: Array.from({ length: frameCount }, () => ({ kind: "hold" }) as Cell),
  };
}

export function createProject(opts?: Partial<Pick<Project, "width" | "height" | "fps" | "bgColor">>): Project {
  const frameCount = 1;
  const layer = createDrawingLayer(frameCount, "Layer 1");
  return {
    width: opts?.width ?? 1280,
    height: opts?.height ?? 720,
    fps: opts?.fps ?? 12,
    bgColor: opts?.bgColor ?? "#f4efe2",
    frameCount,
    layers: [layer],
  };
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/anim/document.ts
git commit -m "feat(anim): canvas + project/layer factories"
```

---

## Task 6: Timeline operations (`timeline.ts`)

**Files:**
- Create: `src/anim/timeline.ts`
- Test: `src/__tests__/timeline.test.ts`

Operations are injected with a `CanvasOps` so they test without a real canvas. The app supplies a real implementation built from `createCellCanvas`/`cloneCanvas`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/timeline.test.ts
import { describe, it, expect } from "vitest";
import type { Cell, DrawingLayer, Project } from "../anim/document";
import {
  addFrame, insertKeyframe, setHold, duplicateKeyframe, deleteFrame,
  ensureDrawableKeyframe, type CanvasOps,
} from "../anim/timeline";

// Fake canvases are tagged objects so we can assert identity/cloning without the DOM.
let tag = 0;
const fakeOps: CanvasOps = {
  create: () => ({ __id: ++tag } as unknown as HTMLCanvasElement),
  clone: (src) => ({ __cloneOf: (src as unknown as { __id: number }).__id, __id: ++tag } as unknown as HTMLCanvasElement),
};

function layer(cells: Cell[]): DrawingLayer {
  return { kind: "draw", id: 1, name: "L", visible: true, locked: false, opacity: 100, cells };
}
function proj(l: DrawingLayer, frameCount: number): Project {
  return { width: 10, height: 10, fps: 12, bgColor: "#fff", frameCount, layers: [l] };
}

describe("timeline operations", () => {
  it("addFrame grows frameCount and appends a hold to every layer", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }]);
    const p = proj(l, 1);
    addFrame(p);
    expect(p.frameCount).toBe(2);
    expect(l.cells.length).toBe(2);
    expect(l.cells[1]).toEqual({ kind: "hold" });
  });

  it("insertKeyframe puts a blank keyframe at the frame", () => {
    const l = layer([{ kind: "hold" }, { kind: "hold" }]);
    insertKeyframe(l, 1, fakeOps);
    expect(l.cells[1].kind).toBe("key");
  });

  it("setHold converts a cell back to a hold", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }]);
    setHold(l, 0);
    expect(l.cells[0]).toEqual({ kind: "hold" });
  });

  it("duplicateKeyframe clones the resolved keyframe canvas into the target frame", () => {
    const src = fakeOps.create() as unknown as { __id: number };
    const l = layer([{ kind: "key", canvas: src as unknown as HTMLCanvasElement }, { kind: "hold" }]);
    duplicateKeyframe(l, 1, fakeOps);
    const cell = l.cells[1];
    expect(cell.kind).toBe("key");
    if (cell.kind === "key") {
      expect((cell.canvas as unknown as { __cloneOf: number }).__cloneOf).toBe(src.__id);
    }
  });

  it("deleteFrame removes the column from every layer and shrinks frameCount", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }, { kind: "hold" }]);
    const p = proj(l, 2);
    deleteFrame(p, 0);
    expect(p.frameCount).toBe(1);
    expect(l.cells.length).toBe(1);
    expect(l.cells[0]).toEqual({ kind: "hold" });
  });

  it("deleteFrame is a no-op when only one frame remains", () => {
    const l = layer([{ kind: "key", canvas: fakeOps.create() }]);
    const p = proj(l, 1);
    deleteFrame(p, 0);
    expect(p.frameCount).toBe(1);
  });

  it("ensureDrawableKeyframe converts a hold into a keyframe that clones the held drawing", () => {
    const src = fakeOps.create() as unknown as { __id: number };
    const l = layer([{ kind: "key", canvas: src as unknown as HTMLCanvasElement }, { kind: "hold" }]);
    const canvas = ensureDrawableKeyframe(l, 1, fakeOps);
    expect(l.cells[1].kind).toBe("key");
    expect((canvas as unknown as { __cloneOf: number }).__cloneOf).toBe(src.__id);
  });

  it("ensureDrawableKeyframe creates a blank keyframe when nothing is held", () => {
    const l = layer([{ kind: "hold" }]);
    const canvas = ensureDrawableKeyframe(l, 0, fakeOps);
    expect(l.cells[0].kind).toBe("key");
    expect((canvas as unknown as { __cloneOf?: number }).__cloneOf).toBeUndefined();
  });

  it("ensureDrawableKeyframe returns the existing canvas when the frame is already a keyframe", () => {
    const existing = fakeOps.create();
    const l = layer([{ kind: "key", canvas: existing }]);
    const canvas = ensureDrawableKeyframe(l, 0, fakeOps);
    expect(canvas).toBe(existing);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- timeline`
Expected: FAIL — cannot find module `../anim/timeline`.

- [ ] **Step 3: Implement**

```ts
// src/anim/timeline.ts
import { resolveKeyframeIndex, type DrawingLayer, type Project } from "./document";

/** Canvas creation/cloning, injected so timeline logic is testable without the DOM. */
export interface CanvasOps {
  create(): HTMLCanvasElement;
  clone(src: HTMLCanvasElement): HTMLCanvasElement;
}

/** Append one blank (hold) frame to every layer. */
export function addFrame(project: Project): void {
  project.frameCount += 1;
  for (const layer of project.layers) {
    layer.cells.push({ kind: "hold" });
  }
}

/** Make the cell at `frame` a blank keyframe. */
export function insertKeyframe(layer: DrawingLayer, frame: number, ops: CanvasOps): void {
  layer.cells[frame] = { kind: "key", canvas: ops.create() };
}

/** Make the cell at `frame` a hold. */
export function setHold(layer: DrawingLayer, frame: number): void {
  layer.cells[frame] = { kind: "hold" };
}

/** Make `frame` a keyframe whose canvas is a clone of the keyframe currently shown there. */
export function duplicateKeyframe(layer: DrawingLayer, frame: number, ops: CanvasOps): void {
  const ki = resolveKeyframeIndex(layer.cells, frame);
  const cell = ki === null ? null : layer.cells[ki];
  const canvas = cell && cell.kind === "key" ? ops.clone(cell.canvas) : ops.create();
  layer.cells[frame] = { kind: "key", canvas };
}

/** Remove the frame column from every layer. No-op if only one frame remains. */
export function deleteFrame(project: Project, frame: number): void {
  if (project.frameCount <= 1) return;
  project.frameCount -= 1;
  for (const layer of project.layers) {
    layer.cells.splice(frame, 1);
  }
}

/**
 * Guarantee the cell at `frame` is a keyframe and return its canvas, so a tool can draw on it.
 * - Already a keyframe → returns its canvas unchanged.
 * - A hold over an earlier keyframe → clones that drawing (draw-on-hold = clone & edit on top).
 * - A hold with nothing held → a fresh blank keyframe.
 */
export function ensureDrawableKeyframe(layer: DrawingLayer, frame: number, ops: CanvasOps): HTMLCanvasElement {
  const current = layer.cells[frame];
  if (current.kind === "key") return current.canvas;

  const ki = resolveKeyframeIndex(layer.cells, frame);
  const held = ki === null ? null : layer.cells[ki];
  const canvas = held && held.kind === "key" ? ops.clone(held.canvas) : ops.create();
  layer.cells[frame] = { kind: "key", canvas };
  return canvas;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- timeline`
Expected: PASS (all timeline tests).

- [ ] **Step 5: Commit**

```bash
git add src/anim/timeline.ts src/__tests__/timeline.test.ts
git commit -m "feat(anim): timeline operations (keyframes, holds, frames)"
```

---

## Task 7: Command-stack history (`history.ts`)

**Files:**
- Create: `src/anim/history.ts`
- Test: `src/__tests__/history.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/history.test.ts
import { describe, it, expect } from "vitest";
import { History, type Command } from "../anim/history";

function counterCmd(state: { n: number }, delta: number): Command {
  return { undo: () => { state.n -= delta; }, redo: () => { state.n += delta; } };
}

describe("History", () => {
  it("undo reverts the last command and redo re-applies it", () => {
    const s = { n: 0 };
    const h = new History();
    s.n += 5; h.push(counterCmd(s, 5));
    expect(s.n).toBe(5);
    h.undo(); expect(s.n).toBe(0);
    h.redo(); expect(s.n).toBe(5);
  });

  it("pushing a new command after undo clears the redo stack", () => {
    const s = { n: 0 };
    const h = new History();
    s.n += 5; h.push(counterCmd(s, 5));
    h.undo();
    s.n += 2; h.push(counterCmd(s, 2));
    h.redo(); // nothing to redo
    expect(s.n).toBe(2);
    expect(h.canRedo).toBe(false);
  });

  it("undo/redo are no-ops on empty stacks", () => {
    const h = new History();
    expect(h.canUndo).toBe(false);
    h.undo(); h.redo();
    expect(h.canUndo).toBe(false);
  });

  it("caps the undo stack at its max size", () => {
    const s = { n: 0 };
    const h = new History(3);
    for (let i = 0; i < 5; i++) { s.n += 1; h.push(counterCmd(s, 1)); }
    let undone = 0;
    while (h.canUndo) { h.undo(); undone++; }
    expect(undone).toBe(3); // only the last 3 are retained
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- history`
Expected: FAIL — cannot find module `../anim/history`.

- [ ] **Step 3: Implement**

```ts
// src/anim/history.ts

/** A reversible edit. The caller performs the action, then pushes the command. */
export interface Command {
  undo(): void;
  redo(): void;
  label?: string;
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  constructor(private maxSize = 50) {}

  push(cmd: Command): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.maxSize) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.redo();
    this.undoStack.push(cmd);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- history`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/anim/history.ts src/__tests__/history.test.ts
git commit -m "feat(anim): command-stack undo/redo history"
```

---

## Task 8: Frame compositor (`render.ts`)

**Files:**
- Create: `src/anim/render.ts`
- Test: `src/__tests__/render.test.ts`

`render.ts` uses `buildFrameDrawList` (already tested) and paints onto a 2D context. The test drives it with a recording fake context (no DOM needed) to verify clear + background fill + per-op draw order and alpha.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/render.test.ts
import { describe, it, expect } from "vitest";
import type { Cell, DrawingLayer, Project } from "../anim/document";
import { renderFrame } from "../anim/render";

function recordingCtx() {
  const calls: string[] = [];
  const ctx = {
    calls,
    canvas: { width: 100, height: 100 },
    globalAlpha: 1,
    fillStyle: "",
    setTransform: () => calls.push("setTransform"),
    clearRect: () => calls.push("clearRect"),
    fillRect: () => calls.push(`fillRect:${ctx.fillStyle}`),
    drawImage: (img: { __id: number }) => calls.push(`drawImage:${img.__id}@${ctx.globalAlpha}`),
  };
  return ctx;
}

let id = 0;
const keyCanvas = () => ({ __id: ++id }) as unknown as HTMLCanvasElement;
function layer(cells: Cell[], over: Partial<DrawingLayer> = {}): DrawingLayer {
  return { kind: "draw", id: 1, name: "L", visible: true, locked: false, opacity: 100, cells, ...over };
}

describe("renderFrame", () => {
  it("clears, fills the background, then draws each layer keyframe bottom→top with layer alpha", () => {
    const c1 = keyCanvas();
    const c2 = keyCanvas();
    const p: Project = {
      width: 100, height: 100, fps: 12, bgColor: "#abc", frameCount: 1,
      layers: [
        layer([{ kind: "key", canvas: c1 }], { id: 1 }),
        layer([{ kind: "key", canvas: c2 }], { id: 2, opacity: 50 }),
      ],
    };
    const ctx = recordingCtx();
    renderFrame(ctx as unknown as CanvasRenderingContext2D, p, 0, 1);
    expect(ctx.calls[0]).toBe("clearRect");
    expect(ctx.calls).toContain("fillRect:#abc");
    const draws = ctx.calls.filter((c) => c.startsWith("drawImage"));
    expect(draws).toEqual([
      `drawImage:${(c1 as unknown as { __id: number }).__id}@1`,
      `drawImage:${(c2 as unknown as { __id: number }).__id}@0.5`,
    ]);
  });

  it("omits the background fill when drawBg is false", () => {
    const p: Project = {
      width: 100, height: 100, fps: 12, bgColor: "#abc", frameCount: 1,
      layers: [layer([{ kind: "key", canvas: keyCanvas() }])],
    };
    const ctx = recordingCtx();
    renderFrame(ctx as unknown as CanvasRenderingContext2D, p, 0, 1, { drawBg: false });
    expect(ctx.calls.some((c) => c.startsWith("fillRect"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- render`
Expected: FAIL — cannot find module `../anim/render`.

- [ ] **Step 3: Implement**

```ts
// src/anim/render.ts
import { buildFrameDrawList, type Project } from "./document";

interface RenderOpts {
  /** Paint the project background color first. Default true. */
  drawBg?: boolean;
}

/**
 * Paint `frame` of `project` onto `ctx`. `dpr` is the device pixel ratio the cell
 * canvases were created at, used to reset the transform before raw drawImage calls.
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  frame: number,
  dpr: number,
  opts: RenderOpts = {}
): void {
  const { drawBg = true } = opts;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, project.width * dpr, project.height * dpr);

  if (drawBg) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = project.bgColor;
    ctx.fillRect(0, 0, project.width * dpr, project.height * dpr);
  }

  const layersById = new Map(project.layers.map((l) => [l.id, l]));
  for (const op of buildFrameDrawList(project, frame)) {
    const layer = layersById.get(op.layerId)!;
    const cell = layer.cells[op.keyframeIndex];
    if (cell.kind !== "key") continue;
    ctx.globalAlpha = op.opacity / 100;
    ctx.drawImage(cell.canvas, 0, 0);
  }
  ctx.globalAlpha = 1;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- render`
Expected: PASS (2 tests). Then run the whole suite: `npm test` — all green.

- [ ] **Step 5: Commit**

```bash
git add src/anim/render.ts src/__tests__/render.test.ts
git commit -m "feat(anim): frame compositor"
```

---

## Task 9: Reactive app state (`appState.svelte.ts`)

**Files:**
- Create: `src/state/appState.svelte.ts`

This holds the single reactive `Project`, the playhead, the active layer, the current tool, and brush settings. It also exposes a real `CanvasOps` built from the document factories, plus a `version` counter the canvas watches to know when to recomposite.

- [ ] **Step 1: Create the state module**

```ts
// src/state/appState.svelte.ts
import { createProject, createCellCanvas, cloneCanvas, type Project } from "../anim/document";
import { History } from "../anim/history";
import type { BrushSettings } from "../core/brush";
import type { CanvasOps } from "../anim/timeline";

export type Tool = "brush" | "eraser";

interface AnimState {
  project: Project;
  playhead: number;       // current frame index
  activeLayerId: number;
  tool: Tool;
  brush: BrushSettings;
  sizeRange: number;
  streamline: number;
  /** Bumped whenever the document changes so the canvas recomposites. */
  version: number;
}

const project = createProject();

export const state: AnimState = $state({
  project,
  playhead: 0,
  activeLayerId: project.layers[0].id,
  tool: "brush",
  brush: {
    size: 4,
    color: "#1a1a1a",
    opacity: 100,
    smoothing: 50,
    isEraser: false,
    drawBehind: false,
    alphaLock: false,
  },
  sizeRange: 1.0,
  streamline: 50,
  version: 0,
});

export const history = new History();

/** Device pixel ratio captured once at startup; cell canvases are sized to it. */
export const DPR = Math.max(1, Math.floor(window.devicePixelRatio || 1));

/** Real canvas operations for timeline.ts, sized to the active document. */
export const canvasOps: CanvasOps = {
  create: () => createCellCanvas(state.project.width, state.project.height, DPR),
  clone: (src) => cloneCanvas(src),
};

export function activeLayer() {
  return state.project.layers.find((l) => l.id === state.activeLayerId) ?? state.project.layers[0];
}

export function bump() {
  state.version++;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat(state): reactive animator app state"
```

---

## Task 10: Drawing surface (`Canvas.svelte`)

**Files:**
- Create: `src/lib/Canvas.svelte`

Wires `setupInput` → `drawStroke` onto the active layer's keyframe at the playhead (creating one via `ensureDrawableKeyframe` on first touch), records an undo command, and recomposites the display via `renderFrame`. Pan/zoom via `Viewport`.

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { setupInput, type InputPoint } from "../core/input";
  import { Viewport } from "../core/viewport";
  import { drawStroke } from "../core/brush";
  import { renderFrame } from "../anim/render";
  import { ensureDrawableKeyframe } from "../anim/timeline";
  import { state, history, DPR, canvasOps, activeLayer, bump } from "../state/appState.svelte";

  let display: HTMLCanvasElement;
  let displayCtx: CanvasRenderingContext2D;
  let stage: HTMLDivElement;
  let viewport: Viewport;

  // The cell canvas being drawn on for the current stroke, and its undo snapshot.
  let strokeCanvas: HTMLCanvasElement | null = null;
  let strokeCtx: CanvasRenderingContext2D | null = null;
  let beforeSnapshot: ImageData | null = null;

  function sizeDisplay() {
    display.width = state.project.width * DPR;
    display.height = state.project.height * DPR;
    display.style.width = `${state.project.width}px`;
    display.style.height = `${state.project.height}px`;
  }

  function recomposite() {
    renderFrame(displayCtx, state.project, state.playhead, DPR);
  }

  function onStroke(points: InputPoint[], done: boolean) {
    const layer = activeLayer();
    if (layer.locked) return;

    if (!strokeCanvas) {
      // First event of the stroke: make sure we have a keyframe to draw on.
      strokeCanvas = ensureDrawableKeyframe(layer, state.playhead, canvasOps);
      strokeCtx = strokeCanvas.getContext("2d", { willReadFrequently: true })!;
      beforeSnapshot = strokeCtx.getImageData(0, 0, strokeCanvas.width, strokeCanvas.height);
      bump();
    }

    // Re-render the in-progress stroke from the pre-stroke snapshot each move.
    strokeCtx!.putImageData(beforeSnapshot!, 0, 0);
    strokeCtx!.setTransform(DPR, 0, 0, DPR, 0, 0);
    const settings = { ...state.brush, isEraser: state.tool === "eraser" };
    drawStroke(strokeCtx!, points, settings, done, state.sizeRange);
    recomposite();

    if (done) {
      const after = strokeCtx!.getImageData(0, 0, strokeCanvas!.width, strokeCanvas!.height);
      const target = strokeCtx!;
      const before = beforeSnapshot!;
      history.push({
        undo: () => { target.putImageData(before, 0, 0); recomposite(); },
        redo: () => { target.putImageData(after, 0, 0); recomposite(); },
      });
      strokeCanvas = null;
      strokeCtx = null;
      beforeSnapshot = null;
    }
  }

  onMount(() => {
    displayCtx = display.getContext("2d")!;
    sizeDisplay();
    viewport = new Viewport(display);
    recomposite();

    const cleanup = setupInput(
      display,
      onStroke,
      (sx, sy) => viewport.screenToCanvas(sx, sy),
      { streamline: () => state.streamline / 100 }
    );

    // Recomposite when the document changes elsewhere (frame step, layer toggle…).
    let lastVersion = state.version;
    let lastPlayhead = state.playhead;
    const tick = () => {
      if (state.version !== lastVersion || state.playhead !== lastPlayhead) {
        lastVersion = state.version;
        lastPlayhead = state.playhead;
        recomposite();
      }
      raf = requestAnimationFrame(tick);
    };
    let raf = requestAnimationFrame(tick);

    return () => { cleanup(); cancelAnimationFrame(raf); };
  });

  // Wheel zoom + space-pan, mirroring slop-paint's gestures (minimal subset).
  function onWheel(e: WheelEvent) { e.preventDefault(); viewport.zoomAt(e.clientX, e.clientY, e.deltaY); }
</script>

<div bind:this={stage} class="relative flex-1 overflow-hidden bg-neutral-300" onwheel={onWheel}>
  <canvas bind:this={display} class="absolute left-0 top-0 shadow-lg touch-none"></canvas>
</div>
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: no errors. (If `state.streamline` getter typing complains, confirm `setupInput`'s `streamline` accepts `() => number` — it does per `input.ts`.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/Canvas.svelte
git commit -m "feat(ui): drawing surface wired to active cell + undo"
```

---

## Task 11: Toolbar, LayerList, and minimal Timeline

**Files:**
- Create: `src/lib/Toolbar.svelte`, `src/lib/LayerList.svelte`, `src/lib/Timeline.svelte`

- [ ] **Step 1: Create `Toolbar.svelte`**

```svelte
<script lang="ts">
  import { state, history } from "../state/appState.svelte";
</script>

<div class="flex items-center gap-2 p-2 border-b border-neutral-300 bg-neutral-100">
  <button class:font-bold={state.tool === "brush"} onclick={() => (state.tool = "brush")}>Brush</button>
  <button class:font-bold={state.tool === "eraser"} onclick={() => (state.tool = "eraser")}>Eraser</button>
  <label class="flex items-center gap-1 text-sm">Size
    <input type="range" min="1" max="60" bind:value={state.brush.size} />
  </label>
  <input type="color" bind:value={state.brush.color} />
  <button onclick={() => history.undo()}>Undo</button>
  <button onclick={() => history.redo()}>Redo</button>
</div>
```

- [ ] **Step 2: Create `LayerList.svelte`**

```svelte
<script lang="ts">
  import { state, bump } from "../state/appState.svelte";
  import { createDrawingLayer } from "../anim/document";

  function addLayer() {
    const layer = createDrawingLayer(state.project.frameCount);
    state.project.layers.push(layer);
    state.activeLayerId = layer.id;
    bump();
  }
</script>

<div class="w-48 border-l border-neutral-300 bg-neutral-100 p-2 flex flex-col gap-1">
  <div class="flex justify-between items-center">
    <span class="text-sm font-semibold">Layers</span>
    <button onclick={addLayer}>＋</button>
  </div>
  {#each [...state.project.layers].reverse() as layer (layer.id)}
    <div class="flex items-center gap-2 px-1 py-0.5 rounded"
         class:bg-neutral-300={layer.id === state.activeLayerId}>
      <input type="checkbox" bind:checked={layer.visible} onchange={bump} />
      <button class="flex-1 text-left text-sm" onclick={() => (state.activeLayerId = layer.id)}>
        {layer.name}
      </button>
    </div>
  {/each}
</div>
```

- [ ] **Step 3: Create `Timeline.svelte`**

```svelte
<script lang="ts">
  import { state, canvasOps, activeLayer, bump } from "../state/appState.svelte";
  import { addFrame, insertKeyframe, setHold, duplicateKeyframe } from "../anim/timeline";
  import { resolveKeyframeIndex } from "../anim/document";

  function cellLabel(layerCells: import("../anim/document").Cell[], f: number): string {
    const cell = layerCells[f];
    if (cell.kind === "key") return "●";
    return resolveKeyframeIndex(layerCells, f) === null ? "·" : "—";
  }

  function go(f: number) { state.playhead = Math.max(0, Math.min(state.project.frameCount - 1, f)); }
  function newFrame() { addFrame(state.project); go(state.project.frameCount - 1); bump(); }
  function key() { insertKeyframe(activeLayer(), state.playhead, canvasOps); bump(); }
  function hold() { setHold(activeLayer(), state.playhead); bump(); }
  function dup() { duplicateKeyframe(activeLayer(), state.playhead, canvasOps); bump(); }
</script>

<div class="border-t border-neutral-300 bg-neutral-100 p-2 text-sm">
  <div class="flex gap-2 mb-2">
    <button onclick={() => go(state.playhead - 1)}>◀</button>
    <span>Frame {state.playhead + 1} / {state.project.frameCount}</span>
    <button onclick={() => go(state.playhead + 1)}>▶</button>
    <button onclick={newFrame}>+ Frame</button>
    <button onclick={key}>Keyframe</button>
    <button onclick={dup}>Dup</button>
    <button onclick={hold}>Hold</button>
  </div>
  {#each [...state.project.layers].reverse() as layer (layer.id)}
    <div class="flex items-center gap-1">
      <span class="w-20 truncate">{layer.name}</span>
      {#each Array(state.project.frameCount) as _, f}
        <button
          class="w-6 h-6 border border-neutral-300 leading-none"
          class:bg-amber-200={f === state.playhead}
          onclick={() => go(f)}>{cellLabel(layer.cells, f)}</button>
      {/each}
    </div>
  {/each}
</div>
```

- [ ] **Step 4: Type-check**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Toolbar.svelte src/lib/LayerList.svelte src/lib/Timeline.svelte
git commit -m "feat(ui): toolbar, layer list, minimal timeline"
```

---

## Task 12: Compose the app and verify end-to-end

**Files:**
- Modify: `src/App.svelte`

- [ ] **Step 1: Assemble the layout + keyboard shortcuts**

```svelte
<script lang="ts">
  import Toolbar from "./lib/Toolbar.svelte";
  import Canvas from "./lib/Canvas.svelte";
  import LayerList from "./lib/LayerList.svelte";
  import Timeline from "./lib/Timeline.svelte";
  import { state, history } from "./state/appState.svelte";

  function onKey(e: KeyboardEvent) {
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) history.redo(); else history.undo();
    } else if (e.key === "b") state.tool = "brush";
    else if (e.key === "e") state.tool = "eraser";
    else if (e.key === ",") state.playhead = Math.max(0, state.playhead - 1);
    else if (e.key === ".") state.playhead = Math.min(state.project.frameCount - 1, state.playhead + 1);
    else if (e.key === "[") state.brush.size = Math.max(1, state.brush.size - 1);
    else if (e.key === "]") state.brush.size = Math.min(60, state.brush.size + 1);
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="h-full flex flex-col">
  <Toolbar />
  <div class="flex-1 flex min-h-0">
    <Canvas />
    <LayerList />
  </div>
  <Timeline />
</div>
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all `document`, `timeline`, `history`, `render` tests PASS.

- [ ] **Step 3: Manual verification (the Definition of Done for Plan 1)**

Run: `npm run dev`, open `http://localhost:5173`, and confirm each:
1. A paper-colored canvas is visible.
2. Drawing with the mouse produces a pressure-tapered ink stroke (thin→thick is only visible with a pen tablet; mouse draws at the slider size).
3. `Ctrl+Z` removes the last stroke; `Ctrl+Shift+Z` restores it.
4. `Eraser` (key `E`) erases pixels on the current frame.
5. `+ Frame` adds a frame; `◀`/`▶` (and `,`/`.`) step between frames; the current cell highlights.
6. On a held frame, drawing first inserts a keyframe (cell shows `●`) that clones the held drawing, and you draw on top.
7. `＋` in the Layers panel adds a layer; drawing on the new active layer composites above the lower one; toggling its checkbox hides/shows it.

Note any failures and fix before committing. (This step has no automated assertion; it gates the commit.)

- [ ] **Step 4: Commit**

```bash
git add src/App.svelte
git commit -m "feat(ui): compose animator layout + keyboard shortcuts"
```

---

## Self-Review (completed during planning)

**Spec coverage for Plan 1's slice:** scaffold ✓ (Task 1), core port ✓ (Task 2), `Cell = key|hold` model + resolver ✓ (Task 3), composite ordering ✓ (Tasks 4, 8), draw-on-hold clone-and-edit ✓ (Task 6 `ensureDrawableKeyframe` + Task 10), document-level undo over pixel edits ✓ (Task 7 + Task 10), multi-layer flat list ✓ (Tasks 9, 11), ink brush + eraser ✓ (Tasks 10–11), minimal timeline with keyframes/holds ✓ (Task 11). Deferred to later plans (correctly out of Plan 1): onion skin, playback, fill, selection/transform, reference layers, export, persistence.

**Placeholder scan:** no TBD/TODO; every code step contains complete code; every command has an expected result.

**Type consistency:** `Cell`, `DrawingLayer`, `Project`, `DrawOp`, `Command`, `CanvasOps` are defined once and used with the same shapes across tasks. `ensureDrawableKeyframe`, `resolveKeyframeIndex`, `buildFrameDrawList`, `renderFrame`, `addFrame`, `insertKeyframe`, `setHold`, `duplicateKeyframe`, `deleteFrame` keep identical signatures everywhere they appear. `state`, `history`, `canvasOps`, `DPR`, `activeLayer`, `bump` are the stable exports of `appState.svelte.ts`.

**Known limitation accepted for the MVP foundation:** the per-stroke undo command snapshots the whole cell `ImageData` (matches slop-paint's approach); fine at MVP doc sizes, revisited only if memory becomes an issue (spec §10).
