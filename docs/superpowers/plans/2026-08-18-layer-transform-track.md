# Layer Transform Track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Animate a layer's transform over time — keys at frames, interpolated between — so a drawing can pan, scale or rotate across the timeline without being redrawn.

**Architecture:** An optional `transformTrack` on each layer (absent = today's static behaviour, so no migration). A pure `transformAt(layer, frame)` resolves it; the render path and the compose-step builders call that instead of reading `layer.transform`. Keying needs no new drag lifecycle — the gizmo and on-canvas drags both route through a `getT`/`setT` pair, so swapping those two closures makes every existing bracket, undo entry and settle hook work unchanged.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest (node env, no DOM).

**Spec:** `docs/superpowers/specs/2026-08-18-layer-transform-track-design.md`

## Global Constraints

- **Absent means static.** `transformTrack` is optional on both layer kinds; `ProjectJson` version stays **1**; every existing save must load and render identically.
- **Never mutate a track in place.** Undo snapshots share layer objects (gotcha #8), so every writer replaces `layer.transformTrack` with a new object and a new `keys` array.
- **One undo entry per completed gesture.** A drag that does not change the transform writes nothing; no action may push an empty entry.
- **Rotation is absolute — no shortest-path normalisation.** The gizmo stores accumulated radians; 4π must render as two turns.
- **`track.box` supersedes `layer.transformBox`** wherever the pivot is read, while a track exists.
- **The build bar is 0 errors, 0 warnings** (`npm run build`), lint clean, and all tests green before each commit.
- **Only pure logic gets unit tests.** Canvas/DOM/gizmo code is build + review verified, per project convention.

---

### Task 1: Model and resolution

**Files:**

- Modify: `src/anim/document.ts` (types beside `RefTransform` ~line 55; `transformAt` beside `cellTransform` ~line 267)
- Test: `src/__tests__/transform-track.test.ts` (create)

**Interfaces:**

- Consumes: `RefTransform`, `Layer` from `document.ts`.
- Produces: `TransformKey`, `TransformTrack`, `transformAt(layer: Layer, frame: number): RefTransform`.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/transform-track.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { transformAt, type Layer, type TransformTrack } from "../anim/document";

const T = (dx: number, rotation = 0, scale = 1) => ({ dx, dy: 0, scale, rotation });
const layer = (track?: TransformTrack) =>
  ({ kind: "draw", id: 1, name: "L", transform: T(5), transformTrack: track }) as Layer;
const track = (over: Partial<TransformTrack> = {}): TransformTrack => ({
  keys: [
    { frame: 0, t: T(0) },
    { frame: 10, t: T(100) },
  ],
  interp: "linear",
  box: null,
  ...over,
});

describe("transformAt", () => {
  it("returns the static transform when there is no track", () => {
    expect(transformAt(layer(), 7).dx).toBe(5);
  });

  it("holds the single key everywhere", () => {
    const t = track({ keys: [{ frame: 4, t: T(20) }] });
    expect(transformAt(layer(t), 0).dx).toBe(20);
    expect(transformAt(layer(t), 99).dx).toBe(20);
  });

  // A track never extrapolates: outside the keys it holds the nearest one.
  it("holds before the first key and after the last", () => {
    expect(transformAt(layer(track()), -5).dx).toBe(0);
    expect(transformAt(layer(track()), 999).dx).toBe(100);
  });

  it("interpolates linearly between keys", () => {
    expect(transformAt(layer(track()), 5).dx).toBeCloseTo(50, 10);
    expect(transformAt(layer(track()), 2).dx).toBeCloseTo(20, 10);
  });

  it("hits an exact key exactly", () => {
    expect(transformAt(layer(track()), 10).dx).toBe(100);
  });

  it("hold mode does not interpolate", () => {
    const t = track({ interp: "hold" });
    expect(transformAt(layer(t), 9).dx).toBe(0);
    expect(transformAt(layer(t), 10).dx).toBe(100);
  });

  // Time is quantised GLOBALLY and then evaluated, so the motion updates on 2s like the drawings.
  it("sampleEvery steps the motion", () => {
    const t = track({ sampleEvery: 2 });
    expect(transformAt(layer(t), 4).dx).toBeCloseTo(40, 10);
    expect(transformAt(layer(t), 5).dx).toBeCloseTo(40, 10); // still showing frame 4's value
    expect(transformAt(layer(t), 6).dx).toBeCloseTo(60, 10);
  });

  // The grid is global, so the quantised frame can fall in an earlier bracket than `frame` does.
  // That is the intent — sample-and-hold the whole animation — not an edge case to correct.
  it("quantises into an earlier bracket when the grid is coarse", () => {
    const t = track({
      keys: [
        { frame: 0, t: T(0) },
        { frame: 3, t: T(30) },
        { frame: 10, t: T(100) },
      ],
      sampleEvery: 5,
    });
    expect(transformAt(layer(t), 4).dx).toBeCloseTo(0, 10); // q = 0
    expect(transformAt(layer(t), 5).dx).toBeCloseTo(50, 10); // q = 5, between 3 and 10
  });

  it("sampleEvery is ignored in hold mode", () => {
    const t = track({ interp: "hold", sampleEvery: 5 });
    expect(transformAt(layer(t), 9).dx).toBe(0);
  });

  // The one place the obvious implementation is wrong: a deliberate 720° spin is stored as 4π and
  // must render as two turns. Shortest-path normalisation would silently make it zero.
  it("interpolates rotation absolutely, without shortest-path normalisation", () => {
    const spin = track({
      keys: [
        { frame: 0, t: T(0, 0) },
        { frame: 10, t: T(0, 4 * Math.PI) },
      ],
    });
    expect(transformAt(layer(spin), 5).rotation).toBeCloseTo(2 * Math.PI, 10);
  });

  it("interpolates scale linearly", () => {
    const z = track({
      keys: [
        { frame: 0, t: T(0, 0, 1) },
        { frame: 10, t: T(0, 0, 3) },
      ],
    });
    expect(transformAt(layer(z), 5).scale).toBeCloseTo(2, 10);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/transform-track.test.ts`
Expected: FAIL — `transformAt` is not exported from `../anim/document`.

- [ ] **Step 3: Add the types**

In `src/anim/document.ts`, immediately after the `RefTransform` interface (~line 60):

```ts
export interface TransformKey {
  /** Project frame, >= 0. Unique within a track. */
  frame: number;
  t: RefTransform;
}

export interface TransformTrack {
  /** Sorted by `frame`, never empty. */
  keys: TransformKey[];
  /** "linear" interpolates between keys; "hold" keeps each key's value until the next. */
  interp: "linear" | "hold";
  /** Linear only: quantise the sampled frame to a multiple of this, so a move updates on 2s/3s
   *  like the drawings do. 1 (or absent) = every frame. */
  sampleEvery?: number;
  /** The pivot box, captured ONCE at track creation and shared by every key. A per-key box would
   *  make the pivot interpolate and warp the motion path between keys, invisibly. */
  box: { x: number; y: number; w: number; h: number } | null;
}
```

Add `transformTrack?: TransformTrack;` to **both** `DrawingLayer` (beside its `transform`, ~line 55) and `ReferenceLayer` (beside its `transform`, ~line 80).

- [ ] **Step 4: Implement `transformAt`**

In `src/anim/document.ts`, after `cellTransform` (~line 270):

```ts
/** Quantise `frame` onto a grid anchored at `origin`. Never rounds up: the value shown is always
 *  one the animation actually passed through. */
function quantiseFrame(frame: number, origin: number, every: number): number {
  const n = Math.max(1, Math.floor(every));
  return origin + Math.floor((frame - origin) / n) * n;
}

function lerpTransform(a: RefTransform, b: RefTransform, u: number): RefTransform {
  return {
    dx: a.dx + (b.dx - a.dx) * u,
    dy: a.dy + (b.dy - a.dy) * u,
    scale: a.scale + (b.scale - a.scale) * u,
    // Absolute, NOT shortest-path: the gizmo stores accumulated rotation, so a 720° spin is 4π and
    // has to render as two turns.
    rotation: a.rotation + (b.rotation - a.rotation) * u,
  };
}

/** The layer's transform at `frame`: its static value when there is no track, otherwise the track
 *  resolved (and held outside its key range — a track never extrapolates). */
export function transformAt(layer: Layer, frame: number): RefTransform {
  const track = layer.transformTrack;
  if (!track || track.keys.length === 0) return layer.transform;
  const keys = track.keys;
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (keys.length === 1 || frame <= first.frame) return first.t;
  if (frame >= last.frame) return last.t;

  // `q` is inside [first.frame, last.frame) — quantising only ever moves it earlier, and the
  // out-of-range cases already returned.
  const q = track.interp === "hold" ? frame : quantiseFrame(frame, first.frame, track.sampleEvery ?? 1);
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].frame <= q) i++;
  const a = keys[i];
  const b = keys[i + 1];
  if (track.interp === "hold" || q <= a.frame) return a.t;
  if (q >= b.frame) return b.t;
  return lerpTransform(a.t, b.t, (q - a.frame) / (b.frame - a.frame));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/transform-track.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 6: Verify the whole gate**

Run: `npm run build && npm test && npm run lint`
Expected: 0 errors, 0 warnings; all tests pass; lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/anim/document.ts src/__tests__/transform-track.test.ts
git commit -m "feat: transform track model and frame resolution"
```

---

### Task 2: Track mutations

**Files:**

- Modify: `src/anim/document.ts` (after `transformAt`)
- Test: `src/__tests__/transform-track.test.ts` (append)

**Interfaces:**

- Consumes: `TransformTrack`, `TransformKey`, `RefTransform` from Task 1.
- Produces: `createTransformTrack(t, box)`, `withTransformKey(track, frame, t)`, `withoutTransformKey(track, frame)`, `hasKeyAt(track, frame)` — all returning NEW track objects.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/transform-track.test.ts`:

```ts
import {
  createTransformTrack,
  withTransformKey,
  withoutTransformKey,
  hasKeyAt,
} from "../anim/document";

describe("track mutations", () => {
  it("createTransformTrack seeds one key at frame 0 with the static value", () => {
    const t = createTransformTrack(T(9), { x: 1, y: 2, w: 3, h: 4 });
    expect(t.keys).toEqual([{ frame: 0, t: T(9) }]);
    expect(t.interp).toBe("linear");
    expect(t.box).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it("createTransformTrack copies the transform and the box", () => {
    const src = T(9);
    const box = { x: 1, y: 2, w: 3, h: 4 };
    const t = createTransformTrack(src, box);
    expect(t.keys[0].t).not.toBe(src);
    expect(t.box).not.toBe(box);
  });

  it("withTransformKey inserts in frame order", () => {
    const t = withTransformKey(track(), 5, T(55));
    expect(t.keys.map((k) => k.frame)).toEqual([0, 5, 10]);
  });

  it("withTransformKey replaces a key at the same frame", () => {
    const t = withTransformKey(track(), 10, T(999));
    expect(t.keys).toHaveLength(2);
    expect(t.keys[1].t.dx).toBe(999);
  });

  // Undo snapshots share layer objects, so a writer must never touch the track it was handed.
  it("withTransformKey leaves the input untouched", () => {
    const original = track();
    withTransformKey(original, 5, T(55));
    expect(original.keys.map((k) => k.frame)).toEqual([0, 10]);
  });

  it("withoutTransformKey removes the key at that frame", () => {
    expect(withoutTransformKey(track(), 10).keys.map((k) => k.frame)).toEqual([0]);
  });

  // Returning the SAME object is how callers detect a no-op and skip pushing an empty undo entry.
  it("withoutTransformKey returns the same object when there is nothing at that frame", () => {
    const t = track();
    expect(withoutTransformKey(t, 7)).toBe(t);
  });

  it("withoutTransformKey refuses to empty the track", () => {
    const t = track({ keys: [{ frame: 0, t: T(0) }] });
    expect(withoutTransformKey(t, 0)).toBe(t);
  });

  it("hasKeyAt reports an exact frame match", () => {
    expect(hasKeyAt(track(), 10)).toBe(true);
    expect(hasKeyAt(track(), 9)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/transform-track.test.ts`
Expected: FAIL — `createTransformTrack` is not exported.

- [ ] **Step 3: Implement the mutations**

In `src/anim/document.ts`, after `transformAt`:

```ts
/** A fresh track holding `t` at frame 0 — that value has been true for every frame, so frame 0 is
 *  its honest home and the first drag at frame N then produces a clean 0→N tween. */
export function createTransformTrack(
  t: RefTransform,
  box: { x: number; y: number; w: number; h: number } | null,
): TransformTrack {
  return { keys: [{ frame: 0, t: { ...t } }], interp: "linear", box: box ? { ...box } : null };
}

/** Write a key at `frame`, replacing any key already there. Returns a NEW track: snapshots share
 *  layer objects, so no writer may mutate the one it was given (gotcha #8). */
export function withTransformKey(
  track: TransformTrack,
  frame: number,
  t: RefTransform,
): TransformTrack {
  const keys = track.keys.filter((k) => k.frame !== frame);
  keys.push({ frame, t: { ...t } });
  keys.sort((a, b) => a.frame - b.frame);
  return { ...track, keys };
}

/** Drop the key at `frame`. Returns the SAME object when nothing changes — including the attempt to
 *  remove the last key, since a track is never empty — so callers can skip an empty undo entry. */
export function withoutTransformKey(track: TransformTrack, frame: number): TransformTrack {
  if (track.keys.length <= 1) return track;
  const keys = track.keys.filter((k) => k.frame !== frame);
  return keys.length === track.keys.length ? track : { ...track, keys };
}

export function hasKeyAt(track: TransformTrack, frame: number): boolean {
  return track.keys.some((k) => k.frame === frame);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/transform-track.test.ts`
Expected: PASS (21 tests).

- [ ] **Step 5: Verify the whole gate**

Run: `npm run build && npm test && npm run lint`

- [ ] **Step 6: Commit**

```bash
git add src/anim/document.ts src/__tests__/transform-track.test.ts
git commit -m "feat: transform track mutations, all returning new objects"
```

---

### Task 3: Undo snapshot and persistence

**Files:**

- Modify: `src/state/appState.svelte.ts` (`cloneLayers` ~line 303; `restoreStructure` layer branch ~line 340)
- Modify: `src/persist/project-file.ts` (layer JSON type ~line 31/56; write ~line 193 and ~line 228; read — the layer reconstruction)
- Test: `src/__tests__/transform-track.test.ts` (append), `src/__tests__/persist.test.ts` (append)

**Interfaces:**

- Consumes: `TransformTrack` from Task 1.
- Produces: nothing new; existing snapshot/persist paths carry `transformTrack`.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/transform-track.test.ts`:

```ts
import { createProject, createDrawingLayer } from "../anim/document";
import { saveProjectBlob, loadProjectBlob } from "../persist/project-file";

describe("transform track persistence", () => {
  it("round-trips a track", async () => {
    const project = createProject();
    const l = createDrawingLayer(1, "L");
    l.transformTrack = {
      keys: [
        { frame: 0, t: T(0) },
        { frame: 8, t: T(80, 1.5) },
      ],
      interp: "hold",
      sampleEvery: 2,
      box: { x: 1, y: 2, w: 3, h: 4 },
    };
    project.layers.push(l);
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    const back = loaded.layers[loaded.layers.length - 1];
    expect(back.transformTrack).toEqual(l.transformTrack);
  });

  it("a layer with no track round-trips as undefined (old saves)", async () => {
    const project = createProject();
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    expect(loaded.layers[0].transformTrack).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/transform-track.test.ts`
Expected: FAIL — `back.transformTrack` is `undefined`.

- [ ] **Step 3: Deep-copy the track in `cloneLayers`**

In `src/state/appState.svelte.ts`, replace the body of `cloneLayers`:

```ts
function cloneLayers(layers: Layer[]): Layer[] {
  // Shallow per-layer clone with a fresh cells array (same cell + canvas refs), so later
  // in-place mutations (splice/replace) can't corrupt a stored snapshot. Deep-copy transform
  // so a future in-place field write cannot corrupt in-flight snapshots (groups already do this).
  // The transform TRACK is deep-copied for the same reason, down to each key's transform: a
  // snapshot that shared the keys array would be rewritten by the next key the artist drags in.
  const track = (t: Layer["transformTrack"]) =>
    t
      ? { ...t, keys: t.keys.map((k) => ({ frame: k.frame, t: { ...k.t } })), box: t.box ? { ...t.box } : null }
      : undefined;
  return layers.map((l) =>
    l.kind === "draw"
      ? {
          ...l,
          cells: l.cells.slice(),
          transform: { ...l.transform },
          transformTrack: track(l.transformTrack),
        }
      : {
          ...l,
          transform: { ...l.transform },
          range: l.range ? { ...l.range } : undefined,
          transformTrack: track(l.transformTrack),
        },
  );
}
```

- [ ] **Step 4: Restore the track in `restoreStructure`**

In `src/state/appState.svelte.ts`, in the live-layer branch of `restoreStructure`, immediately after the existing `live.transform = { ...snap.transform };` line:

```ts
      // Structural: it decides what renders at every frame, exactly like `range` does for a ref.
      live.transformTrack = snap.transformTrack
        ? {
            ...snap.transformTrack,
            keys: snap.transformTrack.keys.map((k) => ({ frame: k.frame, t: { ...k.t } })),
            box: snap.transformTrack.box ? { ...snap.transformTrack.box } : null,
          }
        : undefined;
```

- [ ] **Step 5: Persist the track**

In `src/persist/project-file.ts`, add `transformTrack?: TransformTrack;` to both layer JSON interfaces (~line 31 and ~line 56), importing the type from `../anim/document`. Then add `transformTrack: l.transformTrack,` beside `transform: l.transform,` at **both** write sites (~line 193 for drawing layers, ~line 228 for reference layers), and assign `transformTrack: j.transformTrack` where each layer is reconstructed on load.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/transform-track.test.ts`
Expected: PASS (23 tests).

- [ ] **Step 7: Verify the whole gate**

Run: `npm run build && npm test && npm run lint`

- [ ] **Step 8: Commit**

```bash
git add src/state/appState.svelte.ts src/persist/project-file.ts src/__tests__/transform-track.test.ts
git commit -m "feat: transform track survives undo and save/load"
```

---

### Task 4: Frame-aware rendering

**Files:**

- Modify: `src/anim/render.ts` (6 reads of `layer.transform`: ~78, ~89, ~224, ~234, ~268, ~281)
- Modify: `src/lib/Canvas.svelte` (`layerComposeSteps` ~line 96, and the `outerSteps.push` for the layer step in `onTransformDrag` ~line 740)
- Modify: `src/lib/RefTransformGizmo.svelte` (the layer step in the `frame` scope's `outer`, ~line 147)

**Interfaces:**

- Consumes: `transformAt` from Task 1.
- Produces: the whole compose chain resolves per frame; no new exports.

- [ ] **Step 1: Replace the render reads**

In `src/anim/render.ts`, import `transformAt` and replace each `layer.transform` with `transformAt(layer, frame)`. At the two `drawReferenceMedia` sites (~78, ~89) `frame` is optional, so use:

```ts
const lt = frame == null ? layer.transform : transformAt(layer, frame);
```

and pass `lt` to `drawTransformed`. At the four `compositeFrameLayers` sites (~224, ~234, ~268, ~281) `frame` is a required parameter already in scope, so `transformAt(layer, frame)` is direct. Hoist it once per layer iteration as `const layerT = transformAt(layer, frame);` and use `layerT` at each of the four, so a track is resolved once per layer per frame rather than four times.

- [ ] **Step 2: Make the compose builders frame-aware**

In `src/lib/Canvas.svelte`, in `layerComposeSteps` (~line 96) replace `t: layer.transform` with:

```ts
    // Resolved at the playhead, exactly as the group step below already is — an animated layer's
    // paint inverse, bounds hint and selection mapping must all follow the frame you are on.
    steps.push({ base: { x: 0, y: 0, w: W, h: H }, t: transformAt(layer, appState.playhead) });
```

In the same file, in `onTransformDrag`'s `frame` scope branch (~line 740) replace `t: layer.transform` with `t: transformAt(layer, appState.playhead)`.

In `src/lib/RefTransformGizmo.svelte` (~line 147), inside the `frame` scope's `outer` array, replace `t: l.transform` with `t: transformAt(l, appState.playhead)`.

- [ ] **Step 3: Verify nothing regressed**

Run: `npm run build && npm test && npm run lint`
Expected: 0 errors, 0 warnings; all tests pass. No behaviour change is expected yet — no layer has a track, so `transformAt` returns `layer.transform` at every site.

- [ ] **Step 4: Commit**

```bash
git add src/anim/render.ts src/lib/Canvas.svelte src/lib/RefTransformGizmo.svelte
git commit -m "feat: resolve the layer transform per frame throughout the compose chain"
```

---

### Task 5: Store actions

**Files:**

- Modify: `src/state/appState.svelte.ts` (beside `resetLayerTransform`)

**Interfaces:**

- Consumes: `createTransformTrack`, `withoutTransformKey`, `hasKeyAt`, `transformAt`, `transformBaseRect` from `document.ts`; `commitStructural`, `liftGuard` from this file.
- Produces: `animateLayer(layerId)`, `removeLayerAnimation(layerId)`, `deleteTransformKeyAtPlayhead(layerId)`, `setTransformTrackOptions(layerId, opts)`.

- [ ] **Step 1: Implement the actions**

In `src/state/appState.svelte.ts`, beside the other transform actions:

```ts
/** Start animating a layer: its current static transform becomes the key at frame 0, and the pivot
 *  box is captured ONCE for the whole track (a per-key box would warp the motion path). */
export function animateLayer(layerId: number): void {
  const l = state.project.layers.find((x) => x.id === layerId);
  if (!l || l.transformTrack || isLayerLocked(l, state.project.groups)) return;
  if (!isLayerVisible(l, state.project.groups)) return;
  const box =
    l.transformBox ?? transformBaseRect(l, state.project.width, state.project.height) ?? null;
  commitStructural(() => {
    l.transformTrack = createTransformTrack(l.transform, box);
  });
  bump();
}

/** Stop animating: bake what is on screen NOW into the static transform, then drop the track.
 *  WYSIWYG — the alternative (restoring the pre-animation value) would undo work invisibly. */
export function removeLayerAnimation(layerId: number): void {
  const l = state.project.layers.find((x) => x.id === layerId);
  if (!l?.transformTrack) return;
  const resolved = transformAt(l, state.playhead);
  commitStructural(() => {
    l.transform = { ...resolved };
    l.transformTrack = undefined;
  });
  bump();
}

/** Remove the key at the playhead. No-op (and no undo entry) when there is none, or when it is the
 *  last key — a track is never empty; Remove animation is the way out. */
export function deleteTransformKeyAtPlayhead(layerId: number): void {
  const l = state.project.layers.find((x) => x.id === layerId);
  const track = l?.transformTrack;
  if (!l || !track) return;
  const next = withoutTransformKey(track, state.playhead);
  if (next === track) return; // guard ABOVE the commit: a no-op must not push an empty entry
  commitStructural(() => {
    l.transformTrack = next;
  });
  bump();
}

/** Interpolation settings. Replaces the track object (gotcha #8) rather than writing in place. */
export function setTransformTrackOptions(
  layerId: number,
  opts: { interp?: "linear" | "hold"; sampleEvery?: number },
): void {
  const l = state.project.layers.find((x) => x.id === layerId);
  const track = l?.transformTrack;
  if (!l || !track) return;
  const interp = opts.interp ?? track.interp;
  const sampleEvery = Math.max(1, Math.floor(opts.sampleEvery ?? track.sampleEvery ?? 1));
  if (interp === track.interp && sampleEvery === (track.sampleEvery ?? 1)) return;
  commitStructural(() => {
    l.transformTrack = { ...track, interp, sampleEvery };
  });
  bump();
}
```

Add `animateLayer`, `removeLayerAnimation`, `deleteTransformKeyAtPlayhead`, `setTransformTrackOptions` to the imports of `createTransformTrack`, `withoutTransformKey`, `transformAt`, `transformBaseRect` from `../anim/document` as needed.

- [ ] **Step 2: Verify the gate**

Run: `npm run build && npm test && npm run lint`
Expected: 0 errors, 0 warnings. (`appState.svelte.ts` is not node-importable, so these actions are build + review verified — project convention.)

- [ ] **Step 3: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat: animate / remove-animation / delete-key actions"
```

---

### Task 6: Key on drag

**Files:**

- Modify: `src/lib/RefTransformGizmo.svelte` (the `scope = "layer"` return of `transformTarget`, ~line 162-172)
- Modify: `src/lib/Canvas.svelte` (`onTransformDrag`'s layer-scope branch)

**Interfaces:**

- Consumes: `transformAt`, `withTransformKey` from `document.ts`.
- Produces: dragging an animated layer writes a key at the playhead.

- [ ] **Step 1: Key through the gizmo's `setT`**

Both files need `transformAt` and `withTransformKey` added to their existing `../anim/document` imports.


In `src/lib/RefTransformGizmo.svelte`, replace the layer-scope return (~line 162):

```ts
    // scope = "layer" (or ref layer of any scope)
    const outer: ComposeStep[] = [...groupStep];
    return {
      // An animated layer reads and writes THROUGH the track. Everything else about the drag —
      // the undo bracket, the settle hook, the isSameTransform no-op check — works unchanged,
      // because the whole lifecycle already goes through this getT/setT pair.
      getT: () => transformAt(l, appState.playhead),
      setT: (t: RefTransform) => {
        const track = l.transformTrack;
        if (!track) {
          l.transform = t;
          return;
        }
        // Replace the track object: undo snapshots share the layer (gotcha #8).
        l.transformTrack = withTransformKey(track, appState.playhead, t);
      },
      base: l.transformTrack?.box ?? baseRect(l),
      outer,
      cell: null,
      group: g,
      scope: "layer",
    };
```

- [ ] **Step 2: Key through the on-canvas drag**

In `src/lib/Canvas.svelte`, in `onTransformDrag`'s layer-scope `else` branch (~line 746, the one commented `// scope = "layer" (or ref layer)`), replace its three lines:

```ts
      base = layer.transformTrack?.box ?? transformBaseRect(layer, W, H);
      getT = () => transformAt(layer, appState.playhead);
      setT = (nt) => {
        const track = layer.transformTrack;
        if (!track) {
          layer.transform = nt;
          return;
        }
        layer.transformTrack = withTransformKey(track, appState.playhead, nt);
      };
```

`transformBaseRect` returns `Rect | null` and the existing `if (!base)` bail below stays as it is; `track.box` is also nullable, so the `??` chain preserves that contract.

- [ ] **Step 3: Verify the gate**

Run: `npm run build && npm test && npm run lint`

- [ ] **Step 4: Commit**

```bash
git add src/lib/RefTransformGizmo.svelte src/lib/Canvas.svelte
git commit -m "feat: a drag on an animated layer keys at the playhead"
```

---

### Task 7: Timeline transform row

**Files:**

- Modify: `src/anim/row-layout.ts` (`TimelineRow`, `timelineRows`)
- Modify: `src/lib/Timeline.svelte` (the row `{#each}`, beside the group-row branch)
- Test: `src/__tests__/row-layout.test.ts` (append)

**Interfaces:**

- Consumes: `TimelineRow` from `row-layout.ts`.
- Produces: `{ kind: "transform"; layer: Layer }` rows.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/row-layout.test.ts`:

```ts
const animated = (id: number, groupId: number | null = null) =>
  ({
    kind: "draw",
    id,
    name: `L${id}`,
    groupId,
    transformTrack: { keys: [{ frame: 0, t: { dx: 0, dy: 0, scale: 1, rotation: 0 } }], interp: "linear", box: null },
  }) as Layer;

describe("timelineRows — transform tracks", () => {
  it("emits a transform row directly under its layer", () => {
    const rows = timelineRows(buildSegments([animated(1)], []));
    expect(rows.map((r) => r.kind)).toEqual(["layer", "transform"]);
  });

  it("emits nothing extra for a layer with no track", () => {
    expect(timelineRows(buildSegments([layer(1)], []))).toHaveLength(1);
  });

  it("emits the row for a grouped layer too", () => {
    const rows = timelineRows(buildSegments([animated(1, 10)], [group(10)]));
    expect(rows.map((r) => r.kind)).toEqual(["group", "layer", "transform"]);
  });

  // A collapsed group hides its members, so their tracks go with them.
  it("hides a member's transform row when its group is collapsed", () => {
    const rows = timelineRows(buildSegments([animated(1, 10)], [group(10, true)]));
    expect(rows.map((r) => r.kind)).toEqual(["group"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/row-layout.test.ts`
Expected: FAIL — only `["layer"]` is emitted.

- [ ] **Step 3: Extend the row model**

In `src/anim/row-layout.ts`, add to the `TimelineRow` union:

```ts
  | { kind: "transform"; layer: Layer }
```

and emit it from a small helper used by both branches of `timelineRows`:

```ts
function pushLayer(rows: TimelineRow[], layer: Layer): void {
  rows.push({ kind: "layer", layer });
  // Directly under its layer, and only when animated. Like the group row, it carries no layer
  // identity in the DOM, so it stays out of the timeline's selection axis.
  if (layer.transformTrack) rows.push({ kind: "transform", layer });
}
```

Replace both `rows.push({ kind: "layer", layer: … })` calls in `timelineRows` with `pushLayer(rows, …)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/row-layout.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Render the row**

In `src/lib/Timeline.svelte`, add a branch to the row `{#each}` before the layer branch, modelled on the group row (sticky label at `LABEL_W`, marker column at `left: LABEL_W`, `min-width: {stripMinW}px`, and **no `data-layer-id`**):

```svelte
      {:else if row.kind === "transform"}
        {@const tl = row.layer}
        <div class="flex w-max items-center" style="min-width: {stripMinW}px">
          <span
            class="shrink-0 sticky left-0 z-20 flex h-6 items-center gap-1 pl-4 pr-1 text-left bg-surface text-text-muted"
            style="width: {LABEL_W}px"
            title="Transform keys for {tl.name}"
          >
            <span class="min-w-0 flex-1 truncate">Transform</span>
          </span>
          <span
            class="sticky z-20 shrink-0 h-6 bg-surface border-r border-text-muted"
            role="presentation"
            style="left: {LABEL_W}px; width: {MARKER_W}px"
          ></span>
          <div class="flex select-none">
            {#each Array(appState.project.frameCount) as _, f (f)}
              <div
                class="box-border h-6 border border-border leading-none text-xs flex items-center justify-center text-text-secondary"
                style="width: {CELL_W}px"
              >
                {tl.transformTrack && hasKeyAt(tl.transformTrack, f) ? "◆" : ""}
              </div>
            {/each}
          </div>
        </div>
```

Import `hasKeyAt` from `../anim/document`.

- [ ] **Step 6: Verify the gate**

Run: `npm run build && npm test && npm run lint`

- [ ] **Step 7: Commit**

```bash
git add src/anim/row-layout.ts src/lib/Timeline.svelte src/__tests__/row-layout.test.ts
git commit -m "feat: a transform track gets its own timeline row"
```

---

### Task 8: ToolOptions controls

**Files:**

- Modify: `src/lib/ToolOptions.svelte` (transform section, ~line 240-280)
- Modify: `src/state/appState.svelte.ts` (export `animatedActiveLayer` derived helper if needed)

**Interfaces:**

- Consumes: `animateLayer`, `removeLayerAnimation`, `deleteTransformKeyAtPlayhead`, `setTransformTrackOptions` from Task 5; `hasKeyAt` from Task 2.
- Produces: the authoring UI.

- [ ] **Step 1: Add the controls**

In `src/lib/ToolOptions.svelte`, after the existing Reset-to-fit block (~line 273), add:

```svelte
{#if animTarget}
  {@const track = animTarget.transformTrack}
  {#if !track}
    <button
      class="px-2 py-1 rounded border border-border text-xs hover:bg-surface-hover"
      title="Animate this layer's transform — its current position becomes a key at frame 0"
      onclick={() => animateLayer(animTarget.id)}>Animate</button
    >
  {:else}
    <button
      class="px-2 py-1 rounded border border-border text-xs hover:bg-surface-hover aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
      aria-disabled={!hasKeyAt(track, appState.playhead) || track.keys.length <= 1}
      title={!hasKeyAt(track, appState.playhead)
        ? "Delete key — no key on this frame"
        : track.keys.length <= 1
          ? "Delete key — this is the only key; use Stop animating"
          : "Delete the key on this frame"}
      onclick={() => deleteTransformKeyAtPlayhead(animTarget.id)}>Delete key</button
    >
    <button
      class="px-2 py-1 rounded border border-border text-xs hover:bg-surface-hover"
      title="Stop animating — keeps the position you can see now"
      onclick={() => removeLayerAnimation(animTarget.id)}>Stop animating</button
    >
    <button
      class="px-2 py-1 rounded border border-border text-xs hover:bg-surface-hover"
      class:bg-surface-active={track.interp === "hold"}
      title={track.interp === "hold"
        ? "Hold — each key holds until the next (no interpolation)"
        : "Linear — interpolate between keys"}
      onclick={() =>
        setTransformTrackOptions(animTarget.id, {
          interp: track.interp === "hold" ? "linear" : "hold",
        })}>{track.interp === "hold" ? "Hold" : "Linear"}</button
    >
    {#if track.interp === "linear"}
      <label class="flex items-center gap-1 text-xs text-text-secondary" title="Update the move every N frames, so it can sit on 2s like the drawings">
        Step
        <input
          class="w-12 bg-surface border border-border text-text px-1"
          type="number"
          min="1"
          max="12"
          value={track.sampleEvery ?? 1}
          onchange={(e) =>
            setTransformTrackOptions(animTarget.id, {
              sampleEvery: Number((e.currentTarget as HTMLInputElement).value),
            })}
        />
      </label>
    {/if}
  {/if}
{/if}
```

Add `animateLayer`, `removeLayerAnimation`, `deleteTransformKeyAtPlayhead` and `setTransformTrackOptions` to the existing `../state/appState.svelte` import, and `hasKeyAt`, `isLayerLocked`, `isLayerVisible` from `../anim/document` (none of the three is imported in this file yet). Then add the `animTarget` derived in the script block — it encodes the spec's visibility rule (a drawing layer needs the Transform tool at Layer scope; a reference layer's gizmo is live under every tool):

```ts
  // Whose transform the Animate controls act on, or null when none applies. A ref is animatable
  // under any tool because its gizmo is always live — the same reason Reset-to-fit sits outside
  // the per-tool branches. A locked or hidden layer is never a target.
  const animTarget = $derived.by(() => {
    const l = appState.project.layers.find((x) => x.id === appState.activeLayerId);
    if (!l) return null;
    if (isLayerLocked(l, appState.project.groups)) return null;
    if (!isLayerVisible(l, appState.project.groups)) return null;
    if (l.kind === "ref") return l;
    return appState.tool === "transform" && appState.transformScope === "layer" ? l : null;
  });
```

- [ ] **Step 2: Verify the gate**

Run: `npm run build && npm test && npm run lint`

- [ ] **Step 3: Commit**

```bash
git add src/lib/ToolOptions.svelte
git commit -m "feat: Animate / Delete key / Stop animating / interpolation controls"
```

---

### Task 9: Guards and the status hint

**Files:**

- Modify: `src/state/appState.svelte.ts` (`applyLayerTransform`, `resetLayerTransform`)
- Modify: `src/lib/status-hint.ts` (`HintContext`, `contextHint`)
- Modify: `src/lib/StatusBar.svelte` (pass the new context field)
- Test: `src/__tests__/status-hint.test.ts` (append)

**Interfaces:**

- Consumes: `HintContext` from `status-hint.ts`.
- Produces: `HintContext.animatedFrame: number | null`.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/status-hint.test.ts`:

```ts
describe("contextHint — animated layer", () => {
  const base = {
    tool: "transform",
    locked: false,
    hiddenLayer: false,
    selectionActive: false,
    selectionFloating: false,
    poseActive: false,
  };

  // Auto-key's one real hazard is silence: a nudge made while scrubbed between keys bends the
  // motion with nothing said. Naming the frame is the mitigation, so it is not optional.
  it("names the frame a drag will key", () => {
    expect(contextHint({ ...base, animatedFrame: 12 })).toContain("12");
  });

  it("falls back to the plain transform hint when the layer is not animated", () => {
    expect(contextHint({ ...base, animatedFrame: null })).toBe(
      "Drag to move · corners scale · top handle rotates",
    );
  });

  // A hint for a gesture that currently does nothing is worse than none.
  it("still puts the locked refusal first", () => {
    expect(contextHint({ ...base, locked: true, animatedFrame: 12 })).toContain("locked");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/status-hint.test.ts`
Expected: FAIL — `animatedFrame` is not a property of `HintContext`.

- [ ] **Step 3: Extend the hint**

In `src/lib/status-hint.ts`, add to `HintContext`:

```ts
  /** The playhead frame when the active layer has a transform track, else null. A drag will write
   *  a key THERE, and saying so is the mitigation for auto-key's one hazard. */
  animatedFrame: number | null;
```

and in `contextHint`'s `case "transform":`, before the existing return:

```ts
    case "transform":
      if (c.animatedFrame !== null)
        return `Animated — a drag keys frame ${c.animatedFrame} · corners scale · top handle rotates`;
      return "Drag to move · corners scale · top handle rotates";
```

In `src/lib/StatusBar.svelte`, pass `animatedFrame` from the active layer's track:

```ts
  animatedFrame: activeLayer?.transformTrack ? appState.playhead : null,
```

- [ ] **Step 4: Refuse Apply and Reset on an animated layer**

In `src/state/appState.svelte.ts`, at the top of `applyLayerTransform` and `resetLayerTransform`, above their existing guards and above any `commitStructural`:

```ts
  // Baking pixels, or resetting to fit, only means something for a transform that does not vary.
  // Silent refusal matches the locked-layer convention; the status hint explains it.
  if (l.transformTrack) {
    state.statusHint = "Layer is animated — Stop animating first";
    return;
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run build && npm test && npm run lint`
Expected: 0 errors, 0 warnings; all tests pass.

- [ ] **Step 6: Update the docs**

Append a dated entry to `CLAUDE.md` covering: the optional-field opt-in and why the format version does not move; `track.box` being captured once (a per-key box would warp the motion path); rotation being absolute with no shortest-path normalisation; `sampleEvery` quantising time globally; keying happening inside the gizmo's existing `getT`/`setT` pair so no drag lifecycle changed; and the transform row carrying no `data-layer-id`. Update the test count in `README.md` (run `npm test` — do not guess).

- [ ] **Step 7: Commit**

```bash
git add src/state/appState.svelte.ts src/lib/status-hint.ts src/lib/StatusBar.svelte src/__tests__/status-hint.test.ts CLAUDE.md README.md
git commit -m "feat: guard Apply/Reset on an animated layer; say which frame a drag keys"
```

---

## Self-review notes

**Spec coverage.** Model → Task 1. Resolution incl. rotation/scale/quantisation → Task 1. Mutations and the never-empty rule → Task 2. Undo + persistence → Task 3. Frame-aware rendering (and therefore onion, export, bounds hint, selection mapping) → Task 4. Animate / Delete key / Remove animation / interpolation settings → Tasks 5 and 8. Auto-key → Task 6. Timeline row → Task 7. Status hint and the Apply/Reset refusal → Task 9. Deferred items are not implemented, by design.

**One naming change from the spec:** the button reads **"Stop animating"** rather than "Remove animation" — it is shorter for a crowded bar and says what happens rather than what is deleted. The action is `removeLayerAnimation`.

**Known ordering constraint:** Task 4 must land before Task 6, or a keyed transform would be written but never rendered.
