# Plan 2 — Onion Skin & Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add onion skin (tinted ghosts of neighbouring frames) and animation playback (play/pause/loop, frame stepping, adjustable fps) on top of the Plan 1 drawing engine.

**Architecture:** A pure, unit-tested `computeOnionFrames` decides which neighbour frames to ghost and at what opacity; an integration `renderFrameWithOnion` composites background → tinted ghosts → current frame using a scratch canvas (`source-in` tinting). `render.ts` is refactored to share a `compositeFrameLayers` helper between the normal and onion render paths. Playback is a `Playback` class whose deterministic `step(nowMs)` advances the playhead from accumulated wall-clock time (unit-tested with synthetic timestamps); `requestAnimationFrame` only drives the thin loop. New reactive state (`onion`, `playback`) and a `Playbar` component expose the controls.

**Tech Stack:** Svelte 5 (runes), Vite, TypeScript, Tailwind 4, Vitest.

**Builds on Plan 1 (already on `main`).** Relevant existing APIs:
- `src/anim/document.ts`: `Project`, `DrawingLayer`, `Cell`, `resolveKeyframeIndex(cells, frame)`, `buildFrameDrawList(project, frame)`.
- `src/anim/render.ts`: `renderFrame(ctx, project, frame, dpr, opts?)` where `opts = { drawBg?: boolean }`.
- `src/state/appState.svelte.ts`: `state` ($state with `project`, `playhead`, `activeLayerId`, `tool`, `brush`, `version`, …), `bump()` (increments `state.version`), `DPR`, `canvasOps`, `activeLayer()`.
- `src/lib/Canvas.svelte`: `recomposite()` calls `renderFrame(displayCtx, state.project, state.playhead, DPR)`; an rAF poll recomposites when `state.version` or `state.playhead` change.
- TS config uses `erasableSyntaxOnly` and `noUnusedLocals` — **no constructor parameter-properties** (declare fields explicitly), and no unused locals.

---

## File Structure

```
src/
  anim/
    render.ts        ← MODIFY: extract compositeFrameLayers, reuse in renderFrame
    onion.ts         ← NEW: computeOnionFrames (pure) + renderFrameWithOnion (integration)
    playback.ts      ← NEW: advancePlayhead (pure) + Playback class (testable step)
  state/
    appState.svelte.ts ← MODIFY: add onion + playback state and playbackController
  lib/
    Canvas.svelte    ← MODIFY: scratch canvas; recomposite picks onion path when enabled
    Playbar.svelte   ← NEW: transport (play/pause/loop/step/jump), fps, onion controls
  App.svelte         ← MODIFY: mount Playbar; K/Enter play-pause; 'o' onion toggle
  __tests__/
    onion.test.ts    ← NEW
    playback.test.ts ← NEW
    render.test.ts   ← MODIFY: add compositeFrameLayers test (existing tests unchanged)
```

**Responsibilities:** `onion.ts` decides + draws ghosts; `playback.ts` owns time→frame advancement; `render.ts` owns frame compositing primitives; `Playbar.svelte` is the transport/onion UI; `appState` holds the reactive config and the single `playbackController`.

---

## Task 1: Extract `compositeFrameLayers` from `renderFrame`

**Files:**
- Modify: `src/anim/render.ts`
- Test: `src/__tests__/render.test.ts`

- [ ] **Step 1: Add a failing test for the extracted helper**

Append to `src/__tests__/render.test.ts`:
```ts
import { compositeFrameLayers } from "../anim/render";

describe("compositeFrameLayers", () => {
  it("draws each visible layer's keyframe bottom→top with layer alpha, no clear/fill", () => {
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
    compositeFrameLayers(ctx as unknown as CanvasRenderingContext2D, p, 0, 1);
    // No clear or fill — only the two draws, in order, with alpha.
    expect(ctx.calls.some((c) => c === "clearRect" || c.startsWith("fillRect"))).toBe(false);
    expect(ctx.calls.filter((c) => c.startsWith("drawImage"))).toEqual([
      `drawImage:${(c1 as unknown as { __id: number }).__id}@1`,
      `drawImage:${(c2 as unknown as { __id: number }).__id}@0.5`,
    ]);
  });
});
```
(`recordingCtx`, `keyCanvas`, `layer` already exist at the top of this test file from Plan 1.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- render`
Expected: FAIL — `compositeFrameLayers` is not exported.

- [ ] **Step 3: Refactor `render.ts`**

Replace the entire contents of `src/anim/render.ts` with:
```ts
import { buildFrameDrawList, type Project } from "./document";

interface RenderOpts {
  /** Paint the project background color first. Default true. */
  drawBg?: boolean;
}

/**
 * Draw the visible layers' resolved keyframes for `frame` onto `ctx`, bottom→top,
 * each at its layer opacity. Does NOT clear or fill — the caller is responsible for
 * resetting the transform to identity and clearing/filling beforehand.
 */
export function compositeFrameLayers(
  ctx: CanvasRenderingContext2D,
  project: Project,
  frame: number,
  _dpr: number
): void {
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

  // Reset to identity first so clearRect/fillRect/drawImage operate in raw device
  // pixels regardless of any transform the context carried in.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, project.width * dpr, project.height * dpr);

  if (drawBg) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = project.bgColor;
    ctx.fillRect(0, 0, project.width * dpr, project.height * dpr);
  }

  compositeFrameLayers(ctx, project, frame, dpr);
}
```
(`compositeFrameLayers` takes `_dpr` unused for now — it keeps a uniform signature with the rest of the render API and documents that callers work in device pixels. The underscore prefix satisfies `noUnusedLocals`.)

- [ ] **Step 4: Run to verify all render tests pass**

Run: `npm test -- render`
Expected: PASS — the new `compositeFrameLayers` test plus the two unchanged `renderFrame` tests.

- [ ] **Step 5: Commit**

```bash
git add src/anim/render.ts src/__tests__/render.test.ts
git commit -m "refactor(anim): extract compositeFrameLayers for reuse by onion"
```

---

## Task 2: `computeOnionFrames` (pure)

**Files:**
- Create: `src/anim/onion.ts`
- Test: `src/__tests__/onion.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/onion.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeOnionFrames, ONION_BASE_OPACITY } from "../anim/onion";

describe("computeOnionFrames", () => {
  it("returns nothing when both counts are zero", () => {
    expect(computeOnionFrames(3, 10, 0, 0)).toEqual([]);
  });

  it("emits prev frames (farthest→nearest) then next frames (farthest→nearest)", () => {
    // base opacity 0.4; nearest (distance 1) = full base, fading linearly with distance.
    expect(computeOnionFrames(3, 10, 2, 2)).toEqual([
      { frame: 1, kind: "prev", opacity: ONION_BASE_OPACITY * 0.5 }, // distance 2
      { frame: 2, kind: "prev", opacity: ONION_BASE_OPACITY * 1.0 }, // distance 1
      { frame: 5, kind: "next", opacity: ONION_BASE_OPACITY * 0.5 }, // distance 2
      { frame: 4, kind: "next", opacity: ONION_BASE_OPACITY * 1.0 }, // distance 1
    ]);
  });

  it("clamps at the start of the timeline (no negative frames)", () => {
    expect(computeOnionFrames(0, 3, 2, 1)).toEqual([
      { frame: 1, kind: "next", opacity: ONION_BASE_OPACITY * 1.0 },
    ]);
  });

  it("clamps at the end of the timeline (no frames past the last)", () => {
    expect(computeOnionFrames(2, 3, 1, 2)).toEqual([
      { frame: 1, kind: "prev", opacity: ONION_BASE_OPACITY * 1.0 },
    ]);
  });

  it("with count 1 each, nearest neighbours at full base opacity", () => {
    expect(computeOnionFrames(5, 10, 1, 1)).toEqual([
      { frame: 4, kind: "prev", opacity: ONION_BASE_OPACITY },
      { frame: 6, kind: "next", opacity: ONION_BASE_OPACITY },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- onion`
Expected: FAIL — cannot find module `../anim/onion`.

- [ ] **Step 3: Implement**

Create `src/anim/onion.ts`:
```ts
/** Opacity of the nearest onion ghost; farther ghosts fade linearly toward 0. */
export const ONION_BASE_OPACITY = 0.4;

export interface OnionFrame {
  frame: number;
  kind: "prev" | "next";
  opacity: number;
}

/** Linear fade: distance 1 → base, distance `count` → base/count. */
function ghostOpacity(distance: number, count: number): number {
  return ONION_BASE_OPACITY * ((count - distance + 1) / count);
}

/**
 * Which neighbour frames to ghost for `current`, in draw order (farthest first so the
 * nearest ghost paints on top). Out-of-range neighbours are dropped.
 */
export function computeOnionFrames(
  current: number,
  frameCount: number,
  prevCount: number,
  nextCount: number
): OnionFrame[] {
  const result: OnionFrame[] = [];

  // prev: farthest (current - prevCount) → nearest (current - 1)
  for (let d = prevCount; d >= 1; d--) {
    const frame = current - d;
    if (frame < 0) continue;
    result.push({ frame, kind: "prev", opacity: ghostOpacity(d, prevCount) });
  }
  // next: farthest (current + nextCount) → nearest (current + 1)
  for (let d = nextCount; d >= 1; d--) {
    const frame = current + d;
    if (frame > frameCount - 1) continue;
    result.push({ frame, kind: "next", opacity: ghostOpacity(d, nextCount) });
  }
  return result;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- onion`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/anim/onion.ts src/__tests__/onion.test.ts
git commit -m "feat(anim): computeOnionFrames neighbour selection + fade"
```

---

## Task 3: `renderFrameWithOnion` (integration)

**Files:**
- Modify: `src/anim/onion.ts`
- Test: `src/__tests__/onion.test.ts`

- [ ] **Step 1: Add a failing ordering test**

Append to `src/__tests__/onion.test.ts`:
```ts
import { renderFrameWithOnion, type OnionConfig } from "../anim/onion";
import type { Project, Cell, DrawingLayer } from "../anim/document";

// Minimal recording 2D context: records the visible-paint operations in order.
function recCtx(w = 100, h = 100) {
  const calls: string[] = [];
  const ctx = {
    calls,
    canvas: { width: w, height: h },
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "",
    setTransform: () => {},
    clearRect: () => calls.push("clear"),
    fillRect: () => calls.push(`fill:${ctx.fillStyle}:${ctx.globalCompositeOperation}`),
    drawImage: (img: { __id: number }) => calls.push(`draw:${img.__id}@${ctx.globalAlpha}`),
  };
  return ctx;
}

let oid = 0;
const kc = () => ({ __id: ++oid }) as unknown as HTMLCanvasElement;
function dlayer(id: number, cells: Cell[]): DrawingLayer {
  return { kind: "draw", id, name: `L${id}`, visible: true, locked: false, opacity: 100, cells };
}

describe("renderFrameWithOnion", () => {
  const onion: OnionConfig = {
    enabled: true, prev: 1, next: 1, allLayers: false,
    tintPrev: "#ff0000", tintNext: "#0000ff",
  };

  it("draws bg, then the prev ghost (tinted+faded) and next ghost, then the current frame on top", () => {
    const prevC = kc(); const curC = kc(); const nextC = kc();
    const layerId = 1;
    const p: Project = {
      width: 100, height: 100, fps: 12, bgColor: "#eee", frameCount: 3,
      layers: [dlayer(layerId, [
        { kind: "key", canvas: prevC }, { kind: "key", canvas: curC }, { kind: "key", canvas: nextC },
      ])],
    };
    const display = recCtx();
    const scratch = recCtx();
    renderFrameWithOnion(
      display as unknown as CanvasRenderingContext2D,
      scratch as unknown as CanvasRenderingContext2D,
      p, 1, 1, onion, layerId
    );

    // Background cleared+filled on the display first.
    expect(display.calls[0]).toBe("clear");
    expect(display.calls[1]).toBe("fill:#eee:source-over");

    // The two ghosts were colorized on the scratch ctx via source-in fills.
    expect(scratch.calls).toContain("fill:#ff0000:source-in");
    expect(scratch.calls).toContain("fill:#0000ff:source-in");

    // Ghost composites drawn onto display before the current frame's own canvas.
    const draws = display.calls.filter((c) => c.startsWith("draw:"));
    // two ghost draws (the scratch canvases) then the current keyframe canvas.
    expect(draws.length).toBe(3);
    expect(draws[2]).toBe(`draw:${(curC as unknown as { __id: number }).__id}@1`);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- onion`
Expected: FAIL — `renderFrameWithOnion` / `OnionConfig` not exported.

- [ ] **Step 3: Implement**

Append to `src/anim/onion.ts`:
```ts
import { resolveKeyframeIndex, type Project } from "./document";
import { compositeFrameLayers } from "./render";

export interface OnionConfig {
  enabled: boolean;
  prev: number;
  next: number;
  allLayers: boolean;
  tintPrev: string;
  tintNext: string;
}

/** Paint one ghost frame onto `display` via a `scratch` canvas: render the ghost, tint
 *  it with `source-in`, then draw it onto the display at `opacity`. */
function drawGhost(
  display: CanvasRenderingContext2D,
  scratch: CanvasRenderingContext2D,
  project: Project,
  ghostFrame: number,
  dpr: number,
  allLayers: boolean,
  activeLayerId: number,
  tint: string,
  opacity: number
): void {
  const w = project.width * dpr;
  const h = project.height * dpr;

  scratch.setTransform(1, 0, 0, 1, 0, 0);
  scratch.globalCompositeOperation = "source-over";
  scratch.globalAlpha = 1;
  scratch.clearRect(0, 0, w, h);

  if (allLayers) {
    compositeFrameLayers(scratch, project, ghostFrame, dpr);
  } else {
    const layer = project.layers.find((l) => l.id === activeLayerId);
    if (layer) {
      const ki = resolveKeyframeIndex(layer.cells, ghostFrame);
      const cell = ki === null ? null : layer.cells[ki];
      if (cell && cell.kind === "key") scratch.drawImage(cell.canvas, 0, 0);
    }
  }

  // Colorize the ghost's ink to the tint, preserving its alpha shape.
  scratch.globalCompositeOperation = "source-in";
  scratch.fillStyle = tint;
  scratch.fillRect(0, 0, w, h);
  scratch.globalCompositeOperation = "source-over";

  display.globalAlpha = opacity;
  display.drawImage(scratch.canvas, 0, 0);
  display.globalAlpha = 1;
}

/** Full composite for `frame` with onion ghosts underneath the current frame. */
export function renderFrameWithOnion(
  display: CanvasRenderingContext2D,
  scratch: CanvasRenderingContext2D,
  project: Project,
  frame: number,
  dpr: number,
  onion: OnionConfig,
  activeLayerId: number
): void {
  const w = project.width * dpr;
  const h = project.height * dpr;

  display.setTransform(1, 0, 0, 1, 0, 0);
  display.globalAlpha = 1;
  display.globalCompositeOperation = "source-over";
  display.clearRect(0, 0, w, h);
  display.fillStyle = project.bgColor;
  display.fillRect(0, 0, w, h);

  for (const g of computeOnionFrames(frame, project.frameCount, onion.prev, onion.next)) {
    const tint = g.kind === "prev" ? onion.tintPrev : onion.tintNext;
    drawGhost(display, scratch, project, g.frame, dpr, onion.allLayers, activeLayerId, tint, g.opacity);
  }

  compositeFrameLayers(display, project, frame, dpr);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- onion`
Expected: PASS (6 tests). Then run the whole suite: `npm test` — all green. Then `npm run check` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/anim/onion.ts src/__tests__/onion.test.ts
git commit -m "feat(anim): renderFrameWithOnion tinted ghost compositing"
```

---

## Task 4: Playback engine (`playback.ts`)

**Files:**
- Create: `src/anim/playback.ts`
- Test: `src/__tests__/playback.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/playback.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { advancePlayhead, Playback } from "../anim/playback";

describe("advancePlayhead", () => {
  it("advances to the next frame mid-timeline", () => {
    expect(advancePlayhead(1, 5, true)).toEqual({ frame: 2, stop: false });
  });
  it("wraps to 0 at the end when looping", () => {
    expect(advancePlayhead(4, 5, true)).toEqual({ frame: 0, stop: false });
  });
  it("stops at the end when not looping", () => {
    expect(advancePlayhead(4, 5, false)).toEqual({ frame: 4, stop: true });
  });
});

// A test harness around Playback.step using synthetic timestamps.
function harness(opts: { fps: number; frameCount: number; loop: boolean; start?: number }) {
  let current = opts.start ?? 0;
  let playing = true;
  const pb = new Playback({
    getFps: () => opts.fps,
    getFrameCount: () => opts.frameCount,
    getLoop: () => opts.loop,
    getCurrent: () => current,
    setFrame: (f) => { current = f; },
    onPlayingChange: (p) => { playing = p; },
  });
  return { pb, frame: () => current, playing: () => playing };
}

describe("Playback.step", () => {
  it("does not advance on the first step (establishes the time baseline)", () => {
    const h = harness({ fps: 10, frameCount: 5, loop: true });
    h.pb.step(0);
    expect(h.frame()).toBe(0);
  });

  it("advances one frame per fps interval of elapsed time", () => {
    const h = harness({ fps: 10, frameCount: 5, loop: true }); // 100ms / frame
    h.pb.step(0);
    h.pb.step(100);
    expect(h.frame()).toBe(1);
    h.pb.step(250); // +150ms → one more frame, 50ms remainder carried
    expect(h.frame()).toBe(2);
  });

  it("advances multiple frames when a big time gap elapses", () => {
    const h = harness({ fps: 10, frameCount: 10, loop: true });
    h.pb.step(0);
    h.pb.step(300); // 3 frames
    expect(h.frame()).toBe(3);
  });

  it("loops past the end when looping is on", () => {
    const h = harness({ fps: 10, frameCount: 3, loop: true, start: 2 });
    h.pb.step(0);
    h.pb.step(100); // 2 → wrap to 0
    expect(h.frame()).toBe(0);
  });

  it("stops at the last frame and reports playing=false when not looping", () => {
    const h = harness({ fps: 10, frameCount: 3, loop: false, start: 2 });
    h.pb.step(0);
    h.pb.step(100);
    expect(h.frame()).toBe(2);
    expect(h.playing()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- playback`
Expected: FAIL — cannot find module `../anim/playback`.

- [ ] **Step 3: Implement**

Create `src/anim/playback.ts`:
```ts
/** Next playhead position for a tick. `stop` is true when the end is reached and not looping. */
export function advancePlayhead(
  current: number,
  frameCount: number,
  loop: boolean
): { frame: number; stop: boolean } {
  if (current + 1 < frameCount) return { frame: current + 1, stop: false };
  if (loop) return { frame: 0, stop: false };
  return { frame: current, stop: true };
}

export interface PlaybackOptions {
  getFps: () => number;
  getFrameCount: () => number;
  getLoop: () => boolean;
  getCurrent: () => number;
  setFrame: (frame: number) => void;
  onPlayingChange: (playing: boolean) => void;
}

/**
 * Drives the playhead from wall-clock time. `step(nowMs)` is deterministic and
 * side-effect-injected (testable); `play()`/`pause()` own the requestAnimationFrame loop.
 */
export class Playback {
  private opts: PlaybackOptions;
  private playing = false;
  private accumulatorMs = 0;
  private lastMs: number | null = null;
  private raf = 0;

  constructor(opts: PlaybackOptions) {
    this.opts = opts;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Advance the playhead by however many fps-intervals elapsed since the previous step. */
  step(nowMs: number): void {
    if (this.lastMs === null) {
      this.lastMs = nowMs;
      return;
    }
    this.accumulatorMs += nowMs - this.lastMs;
    this.lastMs = nowMs;

    const frameDurMs = 1000 / this.opts.getFps();
    while (this.accumulatorMs >= frameDurMs) {
      this.accumulatorMs -= frameDurMs;
      const next = advancePlayhead(this.opts.getCurrent(), this.opts.getFrameCount(), this.opts.getLoop());
      if (next.stop) {
        this.playing = false;
        this.opts.onPlayingChange(false);
        return;
      }
      this.opts.setFrame(next.frame);
    }
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.lastMs = null;
    this.accumulatorMs = 0;
    this.opts.onPlayingChange(true);
    this.scheduleNext();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.opts.onPlayingChange(false);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  private scheduleNext(): void {
    this.raf = requestAnimationFrame((ts) => {
      if (!this.playing) return;
      this.step(ts);
      if (this.playing) this.scheduleNext();
    });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- playback`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/anim/playback.ts src/__tests__/playback.test.ts
git commit -m "feat(anim): playback engine (advancePlayhead + Playback)"
```

---

## Task 5: Wire onion + playback into app state

**Files:**
- Modify: `src/state/appState.svelte.ts`

- [ ] **Step 1: Add the imports and config types**

In `src/state/appState.svelte.ts`, update the import block at the top to add the onion and playback imports. The existing imports are:
```ts
import { createProject, createCellCanvas, cloneCanvas, type Project } from "../anim/document";
import { History } from "../anim/history";
import type { BrushSettings } from "../core/brush";
import type { CanvasOps } from "../anim/timeline";
```
Add immediately after them:
```ts
import type { OnionConfig } from "../anim/onion";
import { Playback } from "../anim/playback";
```

- [ ] **Step 2: Extend the state shape**

In the `interface AnimState { … }` block, add these two fields after `version: number;`:
```ts
  onion: OnionConfig;
  playback: { isPlaying: boolean; loop: boolean };
```

- [ ] **Step 3: Add their defaults to the `$state({...})` object**

In the `export const state: AnimState = $state({ … })` initializer, add after `version: 0,`:
```ts
  onion: {
    enabled: false,
    prev: 1,
    next: 1,
    allLayers: false,
    tintPrev: "#e0526a", // warm red
    tintNext: "#3f7fd0", // cool blue
  },
  playback: { isPlaying: false, loop: true },
```

- [ ] **Step 4: Add the playback controller after `bump()`**

At the end of the file, after the `export function bump() { … }` definition, add:
```ts
/**
 * The single playback driver. It mutates `state.playhead` each tick (the Canvas rAF poll
 * then recomposites) and reflects its running state into `state.playback.isPlaying`,
 * bumping the version so the onion overlay (hidden while playing) repaints on stop.
 */
export const playbackController = new Playback({
  getFps: () => state.project.fps,
  getFrameCount: () => state.project.frameCount,
  getLoop: () => state.playback.loop,
  getCurrent: () => state.playhead,
  setFrame: (f) => { state.playhead = f; },
  onPlayingChange: (p) => { state.playback.isPlaying = p; state.version++; },
});
```

- [ ] **Step 5: Verify**

Run: `npm run check`
Expected: 0 errors (the `OnionConfig` import resolves; `Playback` constructs with the options object). Run `npm test` — still all green.

- [ ] **Step 6: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat(state): onion + playback state and playback controller"
```

---

## Task 6: Render onion in the canvas

**Files:**
- Modify: `src/lib/Canvas.svelte`

- [ ] **Step 1: Import the onion renderer**

In `src/lib/Canvas.svelte`, the existing import of render is:
```ts
  import { renderFrame } from "../anim/render";
```
Replace it with:
```ts
  import { renderFrame } from "../anim/render";
  import { renderFrameWithOnion } from "../anim/onion";
```

- [ ] **Step 2: Add a scratch canvas alongside the other `let` declarations**

After the line `let viewport: Viewport;`, add:
```ts
  // Offscreen scratch surface used to tint onion-skin ghosts before compositing.
  let scratch: HTMLCanvasElement;
  let scratchCtx: CanvasRenderingContext2D;
```

- [ ] **Step 3: Update `recomposite()` to choose the onion path**

Replace the existing `recomposite` function:
```ts
  function recomposite() {
    renderFrame(displayCtx, state.project, state.playhead, DPR);
  }
```
with:
```ts
  function recomposite() {
    // Onion ghosts are hidden during playback (you want a clean preview while it runs).
    if (state.onion.enabled && !state.playback.isPlaying) {
      renderFrameWithOnion(
        displayCtx, scratchCtx, state.project, state.playhead, DPR,
        state.onion, state.activeLayerId
      );
    } else {
      renderFrame(displayCtx, state.project, state.playhead, DPR);
    }
  }
```

- [ ] **Step 4: Create the scratch canvas in `onMount` before the first `recomposite()`**

In `onMount`, the current opening lines are:
```ts
    displayCtx = display.getContext("2d")!;
    sizeDisplay();
    viewport = new Viewport(display);
    recomposite();
```
Replace them with:
```ts
    displayCtx = display.getContext("2d")!;
    scratch = document.createElement("canvas");
    scratch.width = state.project.width * DPR;
    scratch.height = state.project.height * DPR;
    scratchCtx = scratch.getContext("2d")!;
    sizeDisplay();
    viewport = new Viewport(display);
    recomposite();
```

- [ ] **Step 5: Verify**

Run: `npm run check`
Expected: 0 errors. Run `npm test` — still green. (The onion overlay itself is verified manually in Task 8.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/Canvas.svelte
git commit -m "feat(ui): render onion-skin ghosts on the canvas"
```

---

## Task 7: Playbar component

**Files:**
- Create: `src/lib/Playbar.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/Playbar.svelte`:
```svelte
<script lang="ts">
  import { state, bump, playbackController } from "../state/appState.svelte";

  const FPS_PRESETS = [6, 8, 12, 24];

  function go(f: number) {
    state.playhead = Math.max(0, Math.min(state.project.frameCount - 1, f));
  }
  function setFps(v: number) {
    state.project.fps = Math.max(1, Math.min(60, Math.round(v)));
    bump();
  }
</script>

<div class="flex items-center gap-3 p-2 border-t border-neutral-300 bg-neutral-100 text-sm">
  <!-- transport -->
  <div class="flex items-center gap-1">
    <button title="First frame" onclick={() => go(0)}>⏮</button>
    <button title="Previous frame" onclick={() => go(state.playhead - 1)}>◀</button>
    <button title="Play / pause" class="px-2 font-semibold" onclick={() => playbackController.toggle()}>
      {state.playback.isPlaying ? "⏸" : "▶"}
    </button>
    <button title="Next frame" onclick={() => go(state.playhead + 1)}>▶▎</button>
    <button title="Last frame" onclick={() => go(state.project.frameCount - 1)}>⏭</button>
    <label class="flex items-center gap-1 ml-1">
      <input type="checkbox" bind:checked={state.playback.loop} /> loop
    </label>
  </div>

  <span class="text-neutral-500">Frame {state.playhead + 1}/{state.project.frameCount}</span>

  <!-- fps -->
  <div class="flex items-center gap-1">
    <span>fps</span>
    <input class="w-12 border border-neutral-300 px-1" type="number" min="1" max="60"
           value={state.project.fps} onchange={(e) => setFps(+e.currentTarget.value)} />
    {#each FPS_PRESETS as p}
      <button class:font-bold={state.project.fps === p} onclick={() => setFps(p)}>{p}</button>
    {/each}
  </div>

  <!-- onion -->
  <div class="flex items-center gap-1 ml-auto">
    <label class="flex items-center gap-1">
      <input type="checkbox" bind:checked={state.onion.enabled} onchange={bump} /> onion
    </label>
    <span class="text-neutral-500">prev</span>
    <input class="w-10 border border-neutral-300 px-1" type="number" min="0" max="3"
           bind:value={state.onion.prev} onchange={bump} />
    <span class="text-neutral-500">next</span>
    <input class="w-10 border border-neutral-300 px-1" type="number" min="0" max="3"
           bind:value={state.onion.next} onchange={bump} />
    <label class="flex items-center gap-1">
      <input type="checkbox" bind:checked={state.onion.allLayers} onchange={bump} /> all layers
    </label>
  </div>
</div>
```

- [ ] **Step 2: Verify**

Run: `npm run check`
Expected: 0 errors. (a11y warnings are acceptable; ERRORS are not. If svelte-check errors on `+e.currentTarget.value` typing, the value is a string — `+value` coerces it; this is valid. Report any real error rather than reworking logic.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/Playbar.svelte
git commit -m "feat(ui): playbar with transport, fps, and onion controls"
```

---

## Task 8: Mount the Playbar and add keyboard shortcuts

**Files:**
- Modify: `src/App.svelte`

- [ ] **Step 1: Update App.svelte**

Replace the entire contents of `src/App.svelte` with:
```svelte
<script lang="ts">
  import Toolbar from "./lib/Toolbar.svelte";
  import Canvas from "./lib/Canvas.svelte";
  import LayerList from "./lib/LayerList.svelte";
  import Playbar from "./lib/Playbar.svelte";
  import Timeline from "./lib/Timeline.svelte";
  import { state, history, bump, playbackController } from "./state/appState.svelte";

  function onKey(e: KeyboardEvent) {
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) history.redo(); else history.undo();
      return;
    }
    // Don't hijack single-key shortcuts while typing in a field (e.g. the fps input).
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.key === "b") state.tool = "brush";
    else if (e.key === "e") state.tool = "eraser";
    else if (e.key === "k" || e.key === "Enter") { e.preventDefault(); playbackController.toggle(); }
    else if (e.key === "o") { state.onion.enabled = !state.onion.enabled; bump(); }
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
  <Playbar />
  <Timeline />
</div>
```

- [ ] **Step 2: Automated verification (Definition of Done)**

Run each and confirm:
1. `npm run check` — 0 errors.
2. `npm test` — all tests pass (Plan 1's 25 + onion 6 + playback 8 + the compositeFrameLayers test = 40).
3. `npx vite build` — successful production build.
4. Dev boot (headless): start `npm run dev` with a short timeout, confirm `Local: http://localhost:5173/` prints with no compile/runtime errors, then stop.

- [ ] **Step 3: Manual verification (requires a browser — for the human)**

Run `npm run dev`, open `http://localhost:5173`:
1. Draw on frame 1; `+ Frame` (Timeline) twice; draw different marks on frames 2 and 3.
2. Toggle **onion** on (Playbar checkbox or `o`). On frame 2 you should see frame 1 ghosted in warm red and frame 3 in cool blue, faintly, under your current drawing.
3. Set **prev**/**next** to 2 — more neighbour ghosts appear (fainter with distance). Toggle **all layers** — ghosts include every layer's content, not just the active one.
4. Press **play** (▶ or `K`/`Enter`) → the playhead advances through frames at the fps and **loops**; onion ghosts disappear during playback. Press again to pause; ghosts reappear (if on).
5. Change **fps** (type a value or click a preset 6/8/12/24) → playback speed changes; uncheck **loop** → playback stops at the last frame.
6. Transport buttons ⏮ ◀ ▶▎ ⏭ jump/step correctly; the frame readout updates.

- [ ] **Step 4: Commit**

```bash
git add src/App.svelte
git commit -m "feat(ui): mount playbar + play/pause and onion keyboard shortcuts"
```

---

## Self-Review (completed during planning)

**Spec coverage (spec §5 Onion skin + Playback):**
- Onion 1–3 prev/next, tinted (warm/cool), reduced opacity, current-layer-only default with all-layers toggle, reference layers excluded → `computeOnionFrames` (Task 2) + `renderFrameWithOnion` (Task 3) + config defaults `prev:1,next:1,allLayers:false` (Task 5) + controls (Task 7). Reference layers don't exist yet (Plan 4), so "excluded" is automatically satisfied; the active/all-layers paths only consider drawing layers.
- Onion hidden during playback → Task 6 guard.
- Playback play/pause/loop, step ±1, jump to start/end, fps field + presets 6/8/12/24, default fps 12 (already the project default from Plan 1) → Tasks 4, 7.
- `K`/`Enter` = play-pause, Space reserved for pan (unchanged) → Task 8.

**Placeholder scan:** none — every step has complete code and an exact command + expected result.

**Type consistency:** `OnionConfig` is defined once in `onion.ts` (Task 3) and imported by `appState` (Task 5) and used by `renderFrameWithOnion`. `OnionFrame`, `ONION_BASE_OPACITY`, `computeOnionFrames`, `renderFrameWithOnion`, `compositeFrameLayers`, `advancePlayhead`, `Playback`, `PlaybackOptions`, `playbackController` keep identical signatures across tasks. `Playback` uses an explicit `private opts` field (not a parameter-property) per `erasableSyntaxOnly`. State fields `state.onion`, `state.playback`, `state.project.fps` are referenced consistently in Canvas (Task 6), Playbar (Task 7), and App (Task 8).

**Known limitations (for later plans):** onion tint colors are fixed defaults (no color pickers yet — cheap to add later); the Timeline's existing ◀/▶ buttons now duplicate the Playbar's step buttons (harmless, left untouched per surgical-change discipline); playback uses the live `getFps`, so changing fps mid-play takes effect on the next tick (intended).
