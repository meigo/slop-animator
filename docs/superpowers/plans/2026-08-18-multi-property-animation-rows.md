# Multi-Property Animation Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Animate layer opacity and group transform alongside the existing layer transform, each on its own timeline row, collapsible under its parent.

**Architecture:** Generalise the existing single-property track over its VALUE TYPE (one `resolveTrack<V>` skeleton, one `lerp` per property) and over its OWNER (a typed `tracks` bag on layers and groups). Opacity enters the render at exactly one already-frame-aware site, which makes it node-testable end to end; group transform reuses the transform machinery one level up.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest (node env, no DOM).

**Spec:** `docs/superpowers/specs/2026-08-18-multi-property-animation-rows-design.md`

## Global Constraints

- **Absent means static.** `tracks` is optional on layers and groups; a layer with no track renders exactly as today.
- **The extraction must be behaviour-preserving.** Every existing `transformAt` test must pass unchanged (bar the mechanical `t`→`v` rename). That is the evidence, not a claim in a report.
- **Never mutate a track in place.** Undo snapshots share layer and group objects, so every writer assigns a whole new object.
- **One copy path.** Exactly one `copyKeyframe` / `copyTrack` / `copyTracks` chain, used by every writer. The transform track's worst bug was two copy sites rebuilding a key as an explicit literal and silently dropping a field added later; the type system cannot catch it, because the field is optional.
- **No empty undo entries.** Every no-op guard sits ABOVE `commitStructural`, never inside its callback.
- **Group-derived state only.** `isLayerLocked(layer, groups)` / `isLayerVisible(layer, groups)`; never the raw `.locked` / `.visible`.
- **Rows that are not layers carry no `data-layer-id`** — that is what keeps them out of the timeline's selection axis for free.
- **Format version stays 1.** The loader reads both the legacy `transformTrack` and the new `tracks`; writing emits only `tracks`.
- **The build bar is 0 errors, 0 warnings** (`npm run build`), lint clean, all tests green before each commit.

---

### Task 1: Generic keyframe, track and resolver

**Files:**

- Modify: `src/anim/document.ts` (the `TransformKey` / `TransformTrack` types and `transformAt`, ~lines 280-390)
- Modify: `src/__tests__/transform-track.test.ts`, `src/__tests__/timeline.test.ts`, `src/__tests__/timeline-block.test.ts`, `src/__tests__/document.test.ts` (mechanical `t:` → `v:` in key literals)
- Modify: `src/anim/timeline.ts`, `src/state/appState.svelte.ts`, `src/lib/Timeline.svelte`, `src/persist/project-file.ts` (wherever a key's `.t` is read or written)

**Interfaces:**

- Consumes: `RefTransform`, `KeyInterp` (unchanged).
- Produces: `Keyframe<V>`, `Track<V>`, `resolveTrack<V>(track, frame, lerp)`, `TransformKey = Keyframe<RefTransform>`, `TransformTrack = Track<RefTransform> & { box }`.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/transform-track.test.ts`:

```ts
import { resolveTrack, type Track } from "../anim/document";

// The skeleton is the part that took the most care — bracket search, quantisation, easing, holding
// at both ends. Proving it works for a SECOND value type is what says it was genuinely generic
// rather than transform-shaped with the names filed off.
describe("resolveTrack over a scalar", () => {
  const lerpNum = (a: number, b: number, u: number) => a + (b - a) * u;
  const t: Track<number> = {
    keys: [
      { frame: 0, v: 0 },
      { frame: 10, v: 100 },
    ],
  };

  it("interpolates, and holds at both ends", () => {
    expect(resolveTrack(t, -5, lerpNum)).toBe(0);
    expect(resolveTrack(t, 5, lerpNum)).toBeCloseTo(50, 10);
    expect(resolveTrack(t, 999, lerpNum)).toBe(100);
  });

  it("applies the segment's own easing", () => {
    const eased: Track<number> = {
      keys: [
        { frame: 0, v: 0, interp: "ease-in" },
        { frame: 10, v: 100 },
      ],
    };
    expect(resolveTrack(eased, 5, lerpNum)).toBeCloseTo(25, 10);
  });

  it("holds a `hold` segment without calling lerp at all", () => {
    let called = 0;
    const held: Track<number> = {
      keys: [
        { frame: 0, v: 0, interp: "hold" },
        { frame: 10, v: 100 },
      ],
    };
    resolveTrack(held, 5, (a, b, u) => {
      called++;
      return lerpNum(a, b, u);
    });
    expect(called).toBe(0);
  });

  it("quantises with sampleEvery", () => {
    expect(resolveTrack({ ...t, sampleEvery: 2 }, 5, lerpNum)).toBeCloseTo(40, 10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/transform-track.test.ts`
Expected: FAIL — `resolveTrack` is not exported.

- [ ] **Step 3: Generalise the types**

In `src/anim/document.ts`, replace the `TransformKey` and `TransformTrack` declarations. Keep the existing doc comment on `interp` verbatim — it explains WHY interpolation is per key, and that reasoning is unchanged.

```ts
export interface Keyframe<V> {
  /** Project frame, >= 0. Unique within a track. */
  frame: number;
  /** The value at this key. Named `v`, not `t`: this track is generic over its value type now, and
   *  `t` would read as "transform" on an opacity track and as "time" to anyone used to easing. */
  v: V;
  /** …existing interp doc comment, unchanged… */
  interp?: KeyInterp;
}

export interface Track<V> {
  /** Sorted by `frame`, never empty. */
  keys: Keyframe<V>[];
  /** …existing sampleEvery doc comment, unchanged… */
  sampleEvery?: number;
}

export type TransformKey = Keyframe<RefTransform>;
export interface TransformTrack extends Track<RefTransform> {
  /** …existing box doc comment, unchanged… */
  box: { x: number; y: number; w: number; h: number } | null;
}
```

- [ ] **Step 4: Extract the resolver**

Replace the body of `transformAt` with a wrapper, and move the skeleton into `resolveTrack`. The logic is copied verbatim — do not "improve" it while moving; its subtleties (quantise before picking the segment; the `keys.length - 2` bound) are load-bearing and tested.

```ts
/**
 * The value a track holds at `frame`. THE resolution skeleton — bracket search, `sampleEvery`
 * quantisation, per-key easing, hold at both ends — parameterised by the one thing that differs
 * between properties: how two values blend. Duplicating this per property is how two
 * implementations drift apart, which is the whole reason it is generic.
 */
export function resolveTrack<V>(
  track: Track<V>,
  frame: number,
  lerp: (a: V, b: V, u: number) => V,
): V {
  const keys = track.keys;
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (keys.length === 1 || frame <= first.frame) return first.v;
  if (frame >= last.frame) return last.v;

  // `q` is inside [first.frame, last.frame) — quantising only ever moves it earlier, and the
  // out-of-range cases already returned. Quantise BEFORE picking the segment, so the sampled time
  // and the segment it lands in always agree.
  const q = quantiseFrame(frame, first.frame, track.sampleEvery ?? 1);
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].frame <= q) i++;
  const a = keys[i];
  const b = keys[i + 1];
  // The segment's own interpolation — `a` starts it, so `a.interp` describes it.
  if (a.interp === "hold" || q <= a.frame) return a.v;
  if (q >= b.frame) return b.v;
  // Ease the TIME, not the value: `sampleEvery` has already quantised `q`, so a stepped move still
  // steps — it just steps along a curved timing instead of an even one.
  return lerp(a.v, b.v, easeU((q - a.frame) / (b.frame - a.frame), a.interp));
}

export function transformAt(layer: Layer, frame: number): RefTransform {
  const track = layer.transformTrack;
  if (!track || track.keys.length === 0) return layer.transform;
  return resolveTrack(track, frame, lerpTransform);
}
```

- [ ] **Step 5: Rename `t` to `v` everywhere a key is built or read**

Run `npx tsc --noEmit` and fix every error it reports. The rename is compiler-caught by construction: `v` is required, so no site can be missed silently. Sites to expect: `copyTransformKey`, `withTransformKey`, `withMovedTransformKey`, `withPastedTransformKey`, `withKeyInterp`, `createTransformTrack`, `shiftTransformTrackFrames`, `removeLayerAnimation`, `copyTransformKeyAtPlayhead`, `pasteTransformKeyAtPlayhead`, `sanitiseTransformTrack`, and every key literal in the four test files.

- [ ] **Step 6: Run the whole suite**

Run: `npm run build && npm test && npm run lint`
Expected: 0 errors, 0 warnings; **every pre-existing transform test passes unchanged apart from the rename**. If any assertion had to change, the extraction was not behaviour-preserving — stop and say so rather than adjusting the test.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: one resolver, generic over the value a track holds"
```

---

### Task 2: Generic copy helpers

**Files:**

- Modify: `src/anim/document.ts` (`copyTransformKey`, `withTrackKeys`)
- Test: `src/__tests__/transform-track.test.ts`

**Interfaces:**

- Consumes: `Keyframe<V>`, `Track<V>` from Task 1.
- Produces: `copyKeyframe<V>(k, copyValue)`, `copyTrack<V>(track, copyValue)`, `copyTransformKey(k)`, `copyTransformTrack(track)`.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/transform-track.test.ts`:

```ts
import { copyKeyframe, copyTrack } from "../anim/document";

// The single worst bug in the transform track was a copy site that rebuilt a key as an explicit
// literal and so dropped `interp` when it was added later. These pin that a copy carries EVERY
// field, including ones a future reader has not thought of.
describe("generic copy helpers", () => {
  const id = (n: number) => n;

  it("carries interp and every other field through a keyframe copy", () => {
    const k = { frame: 3, v: 42, interp: "ease-out" as const };
    expect(copyKeyframe(k, id)).toEqual(k);
  });

  it("deep-copies the value with the supplied copier", () => {
    const v = { dx: 1, dy: 2, scale: 1, rotation: 0 };
    const copied = copyKeyframe({ frame: 0, v }, (x: typeof v) => ({ ...x }));
    expect(copied.v).toEqual(v);
    expect(copied.v).not.toBe(v);
  });

  it("copies a whole track without sharing its keys array", () => {
    const t = { keys: [{ frame: 0, v: 1 }], sampleEvery: 3 };
    const c = copyTrack(t, id);
    expect(c).toEqual(t);
    expect(c.keys).not.toBe(t.keys);
    expect(c.keys[0]).not.toBe(t.keys[0]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/transform-track.test.ts`
Expected: FAIL — `copyKeyframe` is not exported.

- [ ] **Step 3: Implement**

In `src/anim/document.ts`, replacing `copyTransformKey`:

```ts
/**
 * Copy one keyframe. A SPREAD, never a field list — `interp` was added after the first writers
 * existed and the two that enumerated fields dropped it silently, so one undo flattened every
 * authored curve. A spread cannot drop a field added later; an explicit literal always can.
 */
export function copyKeyframe<V>(k: Keyframe<V>, copyValue: (v: V) => V): Keyframe<V> {
  return { ...k, v: copyValue(k.v) };
}

export function copyTrack<V>(track: Track<V>, copyValue: (v: V) => V): Track<V> {
  return { ...track, keys: track.keys.map((k) => copyKeyframe(k, copyValue)) };
}

const copyRefTransform = (t: RefTransform): RefTransform => ({ ...t });

export function copyTransformKey(k: TransformKey): TransformKey {
  return copyKeyframe(k, copyRefTransform);
}

export function copyTransformTrack(track: TransformTrack): TransformTrack {
  return {
    ...copyTrack(track, copyRefTransform),
    box: track.box ? { ...track.box } : null,
  };
}
```

Then point `cloneTransformTrack` (or whatever the current single track-copy site is called) at `copyTransformTrack`, and delete any now-duplicate implementation.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/__tests__/transform-track.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the gate and commit**

```bash
npm run build && npm test && npm run lint
git add -A
git commit -m "refactor: one copy path for keyframes and tracks"
```

---

### Task 3: The `tracks` bag, and the migration off `transformTrack`

**Files:**

- Modify: `src/anim/document.ts` (`DrawingLayer`, `ReferenceLayer`, `LayerGroup`, `transformAt`)
- Modify: `src/state/appState.svelte.ts` (`cloneLayers`, `restoreStructure`, group snapshot/restore, every action reading `layer.transformTrack`)
- Modify: `src/persist/project-file.ts` (the two layer JSON shapes, two writes, two reads, `sanitiseTransformTrack`; plus the group JSON)
- Modify: `src/lib/Timeline.svelte`, `src/lib/ToolOptions.svelte`, `src/lib/RefTransformGizmo.svelte`, `src/lib/Canvas.svelte`, `src/lib/StatusBar.svelte`, `src/lib/transform-target.ts`, `src/anim/timeline.ts`, `src/anim/timeline-block.ts`, `src/anim/row-layout.ts` (every `transformTrack` read)
- Test: `src/__tests__/transform-track.test.ts`

**Interfaces:**

- Consumes: `TransformTrack`, `copyTransformTrack` from Tasks 1-2.
- Produces: `LayerTracks`, `GroupTracks`, `Layer.tracks?`, `LayerGroup.tracks?`, `copyTracks(bag)`, `layerTransformTrack(layer)`.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/transform-track.test.ts`:

```ts
// transformTrack SHIPPED and is in real projects, including autosaves. The loader must promote it,
// or a saved animation silently disappears on the next open.
describe("legacy transformTrack promotion", () => {
  it("promotes a legacy track into the tracks bag on load", async () => {
    const project = createProject();
    const l = createDrawingLayer(1, "L");
    project.layers.push(l);
    const blob = await saveProjectBlob(project);
    // Hand-build the legacy shape: write the new file, then rewrite its JSON the old way.
    const legacy = await withLegacyTransformTrack(blob, l.id, {
      keys: [
        { frame: 0, v: T(0) },
        { frame: 6, v: T(60), interp: "hold" },
      ],
      box: null,
    });
    const loaded = await loadProjectBlob(legacy, 1);
    const back = loaded.layers.find((x) => x.id === l.id)!;
    expect(back.tracks?.transform?.keys.map((k) => k.frame)).toEqual([0, 6]);
    expect(back.tracks?.transform?.keys[1].interp).toBe("hold");
    expect((back as unknown as { transformTrack?: unknown }).transformTrack).toBeUndefined();
  });

  it("prefers the new shape when a file carries both", async () => {
    // A file written by this build and then edited by hand could hold both; `tracks` is authoritative.
    const project = createProject();
    const l = createDrawingLayer(1, "L");
    l.tracks = { transform: { keys: [{ frame: 9, v: T(90) }], box: null } };
    project.layers.push(l);
    const blob = await withLegacyTransformTrack(await saveProjectBlob(project), l.id, {
      keys: [{ frame: 0, v: T(0) }],
      box: null,
    });
    const loaded = await loadProjectBlob(blob, 1);
    expect(loaded.layers.find((x) => x.id === l.id)!.tracks?.transform?.keys[0].frame).toBe(9);
  });
});
```

Write the `withLegacyTransformTrack(blob, layerId, track)` helper at the top of the describe block: unzip the blob with `fflate`'s `unzipSync`, parse `project.json` (via `strFromU8`), find the layer by id, set `transformTrack` on it and delete `tracks`, re-zip with `zipSync` (via `strToU8`), and return a new `Blob`. `src/__tests__/persist.test.ts` already imports `unzipSync`/`strFromU8` from `fflate` this way, and `src/persist/project-file.ts` imports the full set — copy those usages rather than inventing one.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/transform-track.test.ts`
Expected: FAIL — `tracks` does not exist on the layer type.

- [ ] **Step 3: Add the bag**

In `src/anim/document.ts`:

```ts
/**
 * The animated properties of a layer. A typed bag, not a `Record<string, Track<unknown>>`: the set
 * is small and closed, and a record would lose the value type at every call site and push casts
 * into the render path.
 */
export interface LayerTracks {
  transform?: TransformTrack;
  opacity?: Track<number>;
}
export interface GroupTracks {
  transform?: TransformTrack;
}

export function copyTracks<T extends LayerTracks | GroupTracks>(tracks: T): T {
  const out = {} as T;
  if (tracks.transform) out.transform = copyTransformTrack(tracks.transform);
  if ("opacity" in tracks && tracks.opacity)
    (out as LayerTracks).opacity = copyTrack(tracks.opacity, (n: number) => n);
  return out;
}

/** The layer's transform track, or undefined. There are 58 `transformTrack` mentions across
 *  src/anim, src/lib, src/state and src/persist — one accessor so they do not each reach into the
 *  bag, and so a future move of the bag is one edit rather than fifty-eight. */
export function layerTransformTrack(layer: Layer): TransformTrack | undefined {
  return layer.tracks?.transform;
}
```

Add `tracks?: LayerTracks;` to `DrawingLayer` and `ReferenceLayer`, and `tracks?: GroupTracks;` to `LayerGroup`. Delete `transformTrack` from all three.

- [ ] **Step 4: Migrate every read site**

Run `npx tsc --noEmit` and work through the errors — there are **58 `transformTrack` mentions**
outside the tests, so expect this step to be the bulk of the task. Replace each `X.transformTrack`
with `layerTransformTrack(X)` for reads, and `X.tracks = { ...X.tracks, transform: … }` for writes. Deleting a track becomes `X.tracks = { ...X.tracks, transform: undefined }`. **Every write must still assign a whole new bag AND a whole new track** — the no-mutation rule now applies at two levels.

In `cloneLayers` and `restoreStructure`, replace the track deep-copy with `tracks: l.tracks ? copyTracks(l.tracks) : undefined`. Do the same in the GROUP branch of `restoreStructure` and in `snapshotStructure`'s group mapping — groups are snapshotted separately from layers, and this is the first time a group has carried a track.

- [ ] **Step 5: Migrate persistence**

In `src/persist/project-file.ts`: both layer JSON shapes gain `tracks?: LayerTracks` and keep `transformTrack?: TransformTrack` as a READ-ONLY legacy field; the group JSON gains `tracks?: GroupTracks`. Both writes emit `tracks` only. Both reads do:

```ts
// Read both shapes: `transformTrack` shipped and is in real projects, including autosaves.
// `tracks` wins when a file carries both.
tracks: sanitiseTracks(lj.tracks ?? (lj.transformTrack ? { transform: lj.transformTrack } : undefined)),
```

Rename `sanitiseTransformTrack` to `sanitiseTracks` and have it sort, de-duplicate and clamp each track in the bag, exactly as it does for one today.

- [ ] **Step 6: Run the tests**

Run: `npm run build && npm test && npm run lint`
Expected: 0 errors, 0 warnings, all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: tracks live in a typed bag, with the legacy field promoted on load"
```

---

### Task 4: The opacity track

**Files:**

- Modify: `src/anim/document.ts` (`opacityAt`, `buildFrameDrawList`)
- Modify: `src/state/appState.svelte.ts` (opacity track actions)
- Test: `src/__tests__/document.test.ts`

**Interfaces:**

- Consumes: `Track<number>`, `resolveTrack`, `LayerTracks` from Tasks 1-3.
- Produces: `opacityAt(layer, frame)`, `animateLayerOpacity(layerId)`, `removeLayerOpacityAnimation(layerId)`, `setLayerOpacityAt(layerId, frame, value)`.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/document.test.ts`:

```ts
// Opacity enters the render at exactly ONE site, and that site is pure — so unlike the transform
// track, an animated fade can be asserted end to end with no canvas at all. These are the cheapest
// confidence in the whole feature; write them properly.
describe("animated opacity through buildFrameDrawList", () => {
  function animatedLayer() {
    const l = createDrawingLayer(3, "L");
    l.cells = [{ kind: "key", canvas: {} as HTMLCanvasElement }];
    l.opacity = 100;
    l.tracks = {
      opacity: {
        keys: [
          { frame: 0, v: 0 },
          { frame: 10, v: 100 },
        ],
      },
    };
    return l;
  }

  it("stamps the RESOLVED opacity onto the draw op", () => {
    const p = createProject();
    p.layers = [animatedLayer()];
    p.frameCount = 11;
    expect(buildFrameDrawList(p, 0)[0].opacity).toBe(0);
    expect(buildFrameDrawList(p, 5)[0].opacity).toBeCloseTo(50, 10);
    expect(buildFrameDrawList(p, 10)[0].opacity).toBe(100);
  });

  it("a hold segment is a hard cut, not a fade", () => {
    const p = createProject();
    const l = animatedLayer();
    l.tracks!.opacity!.keys[0].interp = "hold";
    p.layers = [l];
    p.frameCount = 11;
    expect(buildFrameDrawList(p, 9)[0].opacity).toBe(0);
    expect(buildFrameDrawList(p, 10)[0].opacity).toBe(100);
  });

  it("falls back to the static field with no track", () => {
    const p = createProject();
    const l = animatedLayer();
    l.tracks = undefined;
    l.opacity = 42;
    p.layers = [l];
    expect(buildFrameDrawList(p, 5)[0].opacity).toBe(42);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/document.test.ts`
Expected: FAIL — frame 5 reports 100 (the static field), not 50.

- [ ] **Step 3: Implement the resolver and wire the one site**

In `src/anim/document.ts`:

```ts
/** The layer's opacity (0..100) at `frame` — its static field when there is no track. */
export function opacityAt(layer: Layer, frame: number): number {
  const track = layer.tracks?.opacity;
  if (!track || track.keys.length === 0) return layer.opacity;
  return resolveTrack(track, frame, (a, b, u) => a + (b - a) * u);
}
```

In `buildFrameDrawList`, replace both `opacity: layer.opacity` with `opacity: opacityAt(layer, frame)`. **These two lines are the whole render change** — `render.ts` is this function's only production consumer, so the editor and both exporters are covered by them.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/document.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the store actions**

In `src/state/appState.svelte.ts`, beside the transform-track actions and matching their shape exactly — guards above `commitStructural`, group-aware lock/visibility checks, a whole new bag and track assigned:

```ts
export function animateLayerOpacity(layerId: number): void;
export function removeLayerOpacityAnimation(layerId: number): void;
/** Auto-key: called by the opacity slider while a track exists. */
export function setLayerOpacityAt(layerId: number, frame: number, value: number): void;
```

`removeLayerOpacityAnimation` bakes the resolved value at the playhead into `layer.opacity` before dropping the track, exactly as `removeLayerAnimation` does for the transform — what is on screen is what the layer keeps.

- [ ] **Step 6: Verify the gate and commit**

```bash
npm run build && npm test && npm run lint
git add -A
git commit -m "feat: animated layer opacity"
```

---

### Task 5: The group transform track

**Files:**

- Modify: `src/anim/document.ts` (`groupTransformAt`)
- Modify: `src/anim/render.ts`, `src/lib/Canvas.svelte`, `src/lib/RefTransformGizmo.svelte`, `src/lib/LayerBoundsHint.svelte` (the `groupTransform(` call sites)
- Modify: `src/state/appState.svelte.ts` (group animate/remove actions)
- Test: `src/__tests__/transform-track.test.ts`

**Interfaces:**

- Consumes: `GroupTracks`, `TransformTrack`, `resolveTrack`.
- Produces: `groupTransformAt(group, frame)`, `animateGroup(groupId)`, `removeGroupAnimation(groupId)`.

- [ ] **Step 1: Write the failing test**

```ts
describe("groupTransformAt", () => {
  it("resolves the group's track at the frame, else its static transform", () => {
    const g = { id: 1, name: "G", collapsed: false, visible: true, transform: T(7) } as LayerGroup;
    expect(groupTransformAt(g, 5).dx).toBe(7);
    g.tracks = {
      transform: {
        keys: [
          { frame: 0, v: T(0) },
          { frame: 10, v: T(100) },
        ],
        box: null,
      },
    };
    expect(groupTransformAt(g, 5).dx).toBeCloseTo(50, 10);
  });

  it("is identity for a group with neither", () => {
    const g = { id: 1, name: "G", collapsed: false, visible: true } as LayerGroup;
    expect(groupTransformAt(g, 3)).toEqual({ dx: 0, dy: 0, scale: 1, rotation: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/transform-track.test.ts`
Expected: FAIL — `groupTransformAt` is not exported.

- [ ] **Step 3: Implement**

```ts
/** A group's transform at `frame`: its track when animated, else its static transform, else
 *  identity. The frame-aware twin of `groupTransform`. */
export function groupTransformAt(group: LayerGroup | null | undefined, frame: number): RefTransform {
  if (!group) return IDENTITY_TRANSFORM;
  const track = group.tracks?.transform;
  if (track && track.keys.length > 0) return resolveTrack(track, frame, lerpTransform);
  return group.transform ?? IDENTITY_TRANSFORM;
}
```

- [ ] **Step 4: Sweep the call sites**

Run `grep -rn "groupTransform(" src/ | grep -v "export function"` — there are about 14. For EACH, decide and record: does a frame exist in scope, and does this site render or compose (→ `groupTransformAt(g, frame)`), or is it a write / a UI indicator / genuinely frame-less (→ leave, with a one-line comment saying why)?

The transform track shipped with three sites reading a static value on an animated layer, every one found by review rather than by the compiler — so **write the classification into your report**, site by site. A sweep you cannot show is a sweep you did not do.

At the drag sites, the group-scope `getT`/`setT` pair keys the track exactly as the layer-scope pair does, using the frozen grab-time frame.

- [ ] **Step 5: Capture the box at group track creation**

`animateGroup` captures `groupBoxLogical(...)` into `track.box`, unlike `animateLayer` which stores `null`. Comment the asymmetry at the capture site or it reads as an inconsistency: a GROUP's base rect is the union of its members' content bounds at a frame, so it genuinely moves as the drawings change, and freezing it is what stops the pivot interpolating and warping the motion path between keys. A LAYER's base is the document rect or a media contain-fit, which does not drift.

- [ ] **Step 6: Verify the gate and commit**

```bash
npm run build && npm test && npm run lint
git add -A
git commit -m "feat: animated group transforms"
```

---

### Task 6: Rows per property, collapsible

**Files:**

- Modify: `src/anim/row-layout.ts` (`TimelineRow`, `timelineRows`)
- Modify: `src/anim/document.ts` (`tracksCollapsed` on the layer types)
- Modify: `src/lib/Timeline.svelte` (the row `{#each}`, the layer row's disclosure + icon)
- Modify: `src/state/appState.svelte.ts` (`toggleTracksCollapsed`)
- Modify: `src/persist/project-file.ts` (persist `tracksCollapsed`)
- Test: `src/__tests__/row-layout.test.ts`

**Interfaces:**

- Consumes: `LayerTracks`, `GroupTracks`.
- Produces: `TimelineRow` gains `{ kind: "track"; layer: Layer; prop: TrackProp }` and `{ kind: "grouptrack"; group: LayerGroup; prop: "transform" }`; `TRACK_PROPS` ordering.

- [ ] **Step 1: Write the failing test**

```ts
// Fixed order so rows never reorder under the artist as tracks are added.
describe("timelineRows — property rows", () => {
  const animated = (id: number, tracks: LayerTracks) =>
    ({ kind: "draw", id, name: `L${id}`, groupId: null, tracks }) as Layer;
  const bothTracks = {
    transform: { keys: [{ frame: 0, v: T0 }], box: null },
    opacity: { keys: [{ frame: 0, v: 100 }] },
  };

  it("emits one row per present track, transform before opacity", () => {
    const rows = timelineRows(buildSegments([animated(1, bothTracks)], []));
    expect(rows.map((r) => (r.kind === "track" ? r.prop : r.kind))).toEqual([
      "layer",
      "transform",
      "opacity",
    ]);
  });

  it("emits only the tracks that exist", () => {
    const rows = timelineRows(buildSegments([animated(1, { opacity: bothTracks.opacity })], []));
    expect(rows.map((r) => (r.kind === "track" ? r.prop : r.kind))).toEqual(["layer", "opacity"]);
  });

  it("omits every property row when the layer is collapsed", () => {
    const l = animated(1, bothTracks);
    (l as { tracksCollapsed?: boolean }).tracksCollapsed = true;
    expect(timelineRows(buildSegments([l], [])).map((r) => r.kind)).toEqual(["layer"]);
  });

  it("interleaves two animated layers rather than grouping all track rows at the end", () => {
    const rows = timelineRows(buildSegments([animated(1, bothTracks), animated(2, bothTracks)], []));
    expect(rows.map((r) => r.kind)).toEqual([
      "layer", "track", "track",
      "layer", "track", "track",
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/row-layout.test.ts`
Expected: FAIL — no `track` row kind.

- [ ] **Step 3: Implement the row model**

```ts
export type TrackProp = "transform" | "opacity";
/** Fixed order, so rows never reorder under the artist as tracks are added or removed. */
export const TRACK_PROPS: TrackProp[] = ["transform", "opacity"];
```

Replace the `{ kind: "transform" }` member with `{ kind: "track"; layer: Layer; prop: TrackProp }`, and add `{ kind: "grouptrack"; group: LayerGroup; prop: "transform" }`. In the layer emitter, iterate `TRACK_PROPS` and push a row for each present track, skipping all of them when `layer.tracksCollapsed`. Emit the group's track row directly after the group header row.

- [ ] **Step 4: Render the rows**

In `src/lib/Timeline.svelte`, generalise the existing transform-row markup to take the prop name as its label ("Transform" / "Opacity") and to read `layer.tracks[prop]`. **Keep it carrying no `data-layer-id`.** Add to the LAYER row a disclosure chevron and an animation icon after the name, shown only when the layer owns at least one track, wired to `toggleTracksCollapsed`. Mirror the group header's affordance exactly — same chevron, same place — so the timeline has one collapse idiom rather than two.

- [ ] **Step 5: Verify the gate and commit**

```bash
npm run build && npm test && npm run lint
git add -A
git commit -m "feat: a row per animated property, collapsible under its layer"
```

---

### Task 7: Authoring opacity from the layer panel

**Files:**

- Modify: `src/lib/LayerList.svelte` (the detail row's opacity slider)

**Interfaces:**

- Consumes: `animateLayerOpacity`, `removeLayerOpacityAnimation`, `setLayerOpacityAt` from Task 4.

- [ ] **Step 1: Wire the slider as the keying control**

The property's existing control IS its gizmo. In the layer detail row, when the layer has an opacity track, the slider writes through `setLayerOpacityAt(layer.id, appState.playhead, value)` instead of assigning `layer.opacity`; when it does not, it keeps assigning directly as today. The slider must SHOW `opacityAt(layer, appState.playhead)` so it tracks the playhead on an animated layer.

- [ ] **Step 2: Add the Animate entry point**

Beside the slider, a small button: "Animate" when there is no track, "Stop animating" when there is. It belongs here rather than in ToolOptions because opacity is not a tool. Use `aria-disabled` (never `disabled`) for any refusal whose title explains it — a disabled control dispatches no pointer events, so the status bar's delegated listener can never read its title, and on iPad a tap is the only route to that explanation.

- [ ] **Step 3: Verify the gate and commit**

```bash
npm run build && npm test && npm run lint
git add -A
git commit -m "feat: the opacity slider keys an animated layer"
```

---

### Task 8: Documentation

**Files:**

- Modify: `CLAUDE.md`, `README.md`

- [ ] **Step 1: Write the CLAUDE.md entry**

A dated entry in the style of the surrounding ones — WHY a decision was made and what it cost, not what the code does. Cover: the generic resolver and why duplicating it per property was the thing to avoid; the typed bag over a string-keyed record; `box` captured for GROUP tracks and null for layer tracks, with the reason for the asymmetry; opacity entering the render at one already-frame-aware site, which is what made it node-testable end to end; the legacy `transformTrack` promotion and the **one-way consequence** (a build older than this release opens such a file with its animation missing, and re-saving there drops it); and the single collapse idiom shared with group headers.

- [ ] **Step 2: Update README.md**

Add animated opacity and group transforms to the Features bullets, and remove them from the Roadmap paragraph, which currently lists group-level tracks as deferred. Run `npm test` and use the real number for the test count — do not guess.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: multi-property animation rows"
```

---

## Self-review notes

**Spec coverage.** Generic resolver → Task 1. Copy helpers → Task 2. Typed bag, both owners, migration → Task 3. Opacity (model, one render site, actions, node tests) → Task 4. Group transform, the ~14-site sweep, box capture → Task 5. Rows per property, fixed order, collapse state and affordance → Task 6. Opacity authoring → Task 7. Docs and the one-way migration note → Task 8.

**Ordering constraints.** Task 1 before everything (every later task uses `resolveTrack` and the `v` field). Task 3 before 4, 5 and 6 (they all read the bag). Task 4 before 7 (the slider calls its actions).

**The risk to watch.** Tasks 1 and 3 are refactors of code that shipped today, whose review found defects in exactly these places — copy helpers, snapshot restore, the render sweep. Task 1's evidence of correctness is that every pre-existing transform test passes unchanged apart from the mechanical rename; if any assertion needs adjusting, stop rather than adjust it.
