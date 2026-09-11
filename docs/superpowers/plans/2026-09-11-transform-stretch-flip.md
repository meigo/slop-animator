# Transform Stretch & Flip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the uniform `scale` in the shared transform model with `scaleX`/`scaleY` (negative = mirrored), add side-stretch handles and a Keep proportions toggle to the layer/group/reference gizmo and the selection float, and add in-place Flip horizontal/vertical buttons that mirror a whole target, animation included.

**Architecture:** `RefTransform` becomes `{dx, dy, scaleX, scaleY, rotation}` with compose order `T(centre+d)·R(rotation)·S(scaleX,scaleY)·T(−centre)`. All transform maths stays in `src/core/ref-transform.ts` (pure, Vitest-covered); render/compose sites switch to per-axis scale; old files load through one `normalizeTransform`. Handle dispatch becomes one pure `dragTransform` shared by the gizmo and the on-canvas drag; flip is a pure closed-form `mirrorTransform` applied to the static value and every track key.

**Tech Stack:** Svelte 5 (runes) + TypeScript + Vite + Vitest (node env, no DOM) + lucide icons.

**Spec:** `docs/superpowers/specs/2026-09-11-transform-stretch-flip-design.md`

## Global Constraints

- `npm run build` (svelte-check + tsc + vite build) must end with **0 errors, 0 warnings** after every task. `tsconfig` includes `src/__tests__`, so test fixtures are type-checked too.
- `npm test` all green after every task (baseline **1245** at branch start).
- Magnitude floor: `|scaleX|, |scaleY| ≥ 0.05` (the existing `MIN_SCALE`), **sign kept**. Zero is never stored.
- Keep proportions: app-wide `appState.keepProportions`, **default on**, persisted with preferences, **absent = on**. Affects CORNERS only; sides always stretch one axis.
- Save format `version` stays **1**; saving writes `scaleX`/`scaleY` only (never `scale`).
- Gotcha #8: never mutate a layer's/group's transform, track or tracks bag in place inside an undoable edit — assign new objects.
- Gotcha #1: a component using the `$state` rune imports `state as appState`.
- Gotcha #12: buttons in the selection bar use the file's existing `tap(...)` `onpointerdown` pattern.
- UI copy, verbatim: `Flip horizontal`, `Flip vertical`, `Keep proportions`; status hint `Drag to move · corners scale · sides stretch · top handle rotates`.
- One commit per task. Commit trailer (both lines):
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01HLkha4dCQwJRZJYuNoXYza
  ```
- Pre-commit hook runs eslint --fix + prettier on staged files; reformatting on commit is expected.

---

### Task 1: `scaleX`/`scaleY` model, per-axis maths, load migration

Behaviour-neutral for uniform transforms: every existing transform keeps rendering exactly as before; files saved by the previous build (`scale`) load as `scaleX = scaleY = scale`.

**Files:**
- Modify: `src/anim/document.ts` (`RefTransform` ~L71-76, `IDENTITY_TRANSFORM` L283, `isIdentityTransform` L285-287, `isSameTransform` L430-432, `lerpTransform` L640-649, `createReferenceLayer` default transform ~L1272)
- Modify: `src/core/ref-transform.ts` (whole file — per-axis versions)
- Modify: `src/anim/render.ts` (the five `ctx.scale(X.scale, X.scale)` calls: L47, L94, L120, L127, L133)
- Modify: `src/lib/Canvas.svelte` (`IDENTITY` L107, `composeScaleOf` L143-145, `applyOverlayCompose` L175)
- Modify: `src/core/selection-map.ts` (`inverseComposeMatrix` L50-72)
- Modify: `src/persist/project-file.ts` (new exported `normalizeTransform`; `isTransformValue` L454-458; save identity check L236-246; load sites: cellTransforms L605-612, layer transform L623, reference transform L653, group transform L684, transform track keys in `sanitiseTracks` L519-521)
- Modify tests (fixture conversion): `animation-bar`, `cell-ink`, `document`, `layer-panel-actions`, `loop-keys`, `onion`, `persist`, `ref-transform`, `render`, `row-layout`, `selection-map`, `timeline-block`, `timeline-selection`, `timeline`, `transform-track` (all under `src/__tests__/`)

**Interfaces:**
- Produces: `RefTransform = { dx: number; dy: number; scaleX: number; scaleY: number; rotation: number }`; `IDENTITY_TRANSFORM = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 }`; `normalizeTransform(raw: unknown): RefTransform | null` exported from `src/persist/project-file.ts`; `MIN_SCALE` exported from `ref-transform.ts`; `floorScale(v: number): number` exported from `ref-transform.ts`.

- [ ] **Step 1: Write the failing `normalizeTransform` + legacy-load tests** — append to `src/__tests__/persist.test.ts` (add `normalizeTransform` to the existing `../persist/project-file` import):

```ts
describe("normalizeTransform", () => {
  it("promotes a legacy uniform scale to both axes", () => {
    expect(normalizeTransform({ dx: 1, dy: 2, scale: 1.5, rotation: 0.3 })).toEqual({
      dx: 1,
      dy: 2,
      scaleX: 1.5,
      scaleY: 1.5,
      rotation: 0.3,
    });
  });
  it("passes the new shape through and drops unknown fields", () => {
    expect(
      normalizeTransform({ dx: 0, dy: 0, scaleX: -1, scaleY: 2, rotation: 0, extra: 5 }),
    ).toEqual({ dx: 0, dy: 0, scaleX: -1, scaleY: 2, rotation: 0 });
  });
  it("prefers scaleX/scaleY when a value carries both shapes", () => {
    expect(normalizeTransform({ dx: 0, dy: 0, scale: 3, scaleX: 2, scaleY: 4, rotation: 0 })).toEqual(
      { dx: 0, dy: 0, scaleX: 2, scaleY: 4, rotation: 0 },
    );
  });
  it("rejects non-objects, non-finite fields, a missing scale and a zero scale", () => {
    expect(normalizeTransform(null)).toBeNull();
    expect(normalizeTransform("x")).toBeNull();
    expect(normalizeTransform({ dx: NaN, dy: 0, scale: 1, rotation: 0 })).toBeNull();
    expect(normalizeTransform({ dx: 0, dy: 0, rotation: 0 })).toBeNull();
    expect(normalizeTransform({ dx: 0, dy: 0, scaleX: 0, scaleY: 1, rotation: 0 })).toBeNull();
    expect(normalizeTransform({ dx: 0, dy: 0, scaleX: 1, scaleY: Infinity, rotation: 0 })).toBeNull();
  });
});

describe("legacy uniform-scale files", () => {
  // Save a real project, rewrite project.json into the PREVIOUS build's shape, load it back.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped project.json on purpose
  async function reloadEdited(project: Project, edit: (json: Record<string, any>) => void) {
    const zip = unzipSync(new Uint8Array(await (await saveProjectBlob(project)).arrayBuffer()));
    const json = JSON.parse(strFromU8(zip["project.json"]));
    edit(json);
    zip["project.json"] = strToU8(JSON.stringify(json));
    return loadProjectBlob(new Blob([zipSync(zip)]), 1);
  }
  const legacy = (scale: number) => ({ dx: 0, dy: 0, scale, rotation: 0 });
  const both = (s: number) => ({ dx: 0, dy: 0, scaleX: s, scaleY: s, rotation: 0 });

  it("migrates layer, cell, track-key, reference and group transforms", async () => {
    const project = createProject();
    project.layers.push(
      createReferenceLayer({ type: "missing", was: "image", name: "r.png" }, "R"),
    );
    const loaded = await reloadEdited(project, (json) => {
      json.layers[0].transform = legacy(2);
      json.layers[0].cellTransforms = { "0": { transform: legacy(0.5), transformBox: null } };
      json.layers[0].tracks = { transform: { keys: [{ frame: 0, v: legacy(1.5) }], box: null } };
      json.references[0].transform = legacy(3);
      json.groups = [
        {
          id: 90,
          name: "G",
          collapsed: false,
          visible: true,
          transform: legacy(1.2),
          transformBox: null,
          tracks: { transform: { keys: [{ frame: 0, v: legacy(0.7) }], box: null } },
        },
      ];
    });
    const dl = loaded.layers.find((l) => l.kind === "draw") as DrawingLayer;
    expect(dl.transform).toEqual(both(2));
    const c0 = dl.cells[0];
    expect(c0.kind === "key" && c0.transform).toEqual(both(0.5));
    expect(dl.tracks?.transform?.keys[0].v).toEqual(both(1.5));
    const ref = loaded.layers.find((l) => l.kind === "ref") as ReferenceLayer;
    expect(ref.transform).toEqual(both(3));
    expect(loaded.groups[0].transform).toEqual(both(1.2));
    expect(loaded.groups[0].tracks?.transform?.keys[0].v).toEqual(both(0.7));
  });

  it("a save writes scaleX/scaleY and never `scale`", async () => {
    const project = createProject();
    project.layers[0].transform = { dx: 1, dy: 0, scaleX: -1, scaleY: 2, rotation: 0 };
    const zip = unzipSync(new Uint8Array(await (await saveProjectBlob(project)).arrayBuffer()));
    const json = JSON.parse(strFromU8(zip["project.json"]));
    expect(json.layers[0].transform).toEqual({ dx: 1, dy: 0, scaleX: -1, scaleY: 2, rotation: 0 });
    expect("scale" in json.layers[0].transform).toBe(false);
  });
});
```

(`createProject()`'s first layer has a key cell at frame 0 — `createDrawingLayer(1, …)`. If `strToU8`/`zipSync`/`ReferenceLayer` are not yet imported in this file, add them: `fflate` already exports both, and `ReferenceLayer` is in the existing `../anim/document` type import.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/persist.test.ts`
Expected: FAIL — `normalizeTransform` is not exported.

- [ ] **Step 3: Change the model in `src/anim/document.ts`**

```ts
export interface RefTransform {
  dx: number; // translate from fit-center, document logical px
  dy: number;
  /** Per-axis multipliers on the fit size, along the target's OWN (rotated) axes. 1 = fit;
   *  negative = mirrored on that axis. Magnitude is never below 0.05 (ref-transform MIN_SCALE). */
  scaleX: number;
  scaleY: number;
  rotation: number; // radians, clockwise, about the center
}
```

```ts
export const IDENTITY_TRANSFORM: RefTransform = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 };

export function isIdentityTransform(t: RefTransform): boolean {
  return t.dx === 0 && t.dy === 0 && t.scaleX === 1 && t.scaleY === 1 && t.rotation === 0;
}
```

`isSameTransform`:
```ts
  return (
    a.dx === b.dx &&
    a.dy === b.dy &&
    a.scaleX === b.scaleX &&
    a.scaleY === b.scaleY &&
    a.rotation === b.rotation
  );
```

`lerpTransform` — replace the `scale:` line with (a flip between keys passes through zero unless the key holds — the squash turnaround; see spec §1):
```ts
    scaleX: a.scaleX + (b.scaleX - a.scaleX) * u,
    scaleY: a.scaleY + (b.scaleY - a.scaleY) * u,
```

`createReferenceLayer`: `transform: { ...IDENTITY_TRANSFORM },`

- [ ] **Step 4: Per-axis `src/core/ref-transform.ts`**

Replace `const MIN_SCALE = 0.05;` and add the floor helper:
```ts
export const MIN_SCALE = 0.05;

/** Floor a scale's MAGNITUDE at MIN_SCALE, keeping its sign — so a drag through zero flips the axis
 *  instead of collapsing it, and nothing downstream ever divides by zero. 0 counts as positive. */
export function floorScale(v: number): number {
  return v < 0 ? Math.min(-MIN_SCALE, v) : Math.max(MIN_SCALE, v);
}
```

`transformedCorners`: `const hw = (base.w / 2) * t.scaleX, hh = (base.h / 2) * t.scaleY;` (signed on purpose: a mirrored axis swaps which corner is which, exactly as the pixels do).

`rotateHandlePos` — the handle stays beyond the VISUAL top edge whatever the sign of `scaleY`:
```ts
export function rotateHandlePos(base: Rect, t: RefTransform, gap: number): Pt {
  const c = transformCenter(base, t);
  const hh = (base.h / 2) * Math.abs(t.scaleY);
  return rotate({ x: c.x, y: c.y - hh - gap }, c, t.rotation);
}
```

`hitTestHandle` body test: `const hw = (base.w / 2) * Math.abs(t.scaleX), hh = (base.h / 2) * Math.abs(t.scaleY);`

`inverseTransformPoint` return: `return { x: cx + (ox * cos - oy * sin) / t.scaleX, y: cy + (ox * sin + oy * cos) / t.scaleY };`

`forwardTransformPoint`: `const ox = (p.x - cx) * t.scaleX, oy = (p.y - cy) * t.scaleY;`

`applyScale` (uniform ratio for now; Task 2 replaces it with the signed projection):
```ts
/** Proportional scale about `center`: both axes times |p-center|/|start-center|, signs kept. */
export function applyScale(t: RefTransform, center: Pt, start: Pt, p: Pt): RefTransform {
  const d0 = dist(start, center);
  if (d0 < 1e-6) return t;
  const k = dist(p, center) / d0;
  return { ...t, scaleX: floorScale(t.scaleX * k), scaleY: floorScale(t.scaleY * k) };
}
```

`isId`: `return t.dx === 0 && t.dy === 0 && t.scaleX === 1 && t.scaleY === 1 && t.rotation === 0;`

- [ ] **Step 5: Render and compose sites**

`src/anim/render.ts` — each of the five calls becomes per-axis, e.g. `ctx.scale(t.scaleX, t.scaleY);`, `ctx.scale(groupT.scaleX, groupT.scaleY);` (both group sites), `ctx.scale(layerT.scaleX, layerT.scaleY);`, `ctx.scale(cellT.scaleX, cellT.scaleY);`.

`src/lib/Canvas.svelte`:
- `const IDENTITY = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 };`
- `composeScaleOf` — a single number can't describe a stretch; the geometric mean keeps handle size screen-constant on average:
  ```ts
  function composeScaleOf(steps: ComposeStep[]): number {
    // One number cannot describe a stretch; the geometric mean keeps handles screen-constant on average.
    return steps.reduce((s, step) => s * Math.sqrt(Math.abs(step.t.scaleX * step.t.scaleY)), 1);
  }
  ```
- `applyOverlayCompose`: `ctx.scale(s.t.scaleX, s.t.scaleY);`

`src/core/selection-map.ts` `inverseComposeMatrix` — the inverse of `T(c+d)·R·S(sx,sy)·T(−c)` is `T(c)·S(1/sx,1/sy)·R(−rot)·T(−c−d)`; scaling the ROWS of the rotation:
```ts
    const kx = 1 / s.t.scaleX;
    const ky = 1 / s.t.scaleY;
    const cos = Math.cos(-s.t.rotation);
    const sin = Math.sin(-s.t.rotation);
    const a = kx * cos;
    const b = ky * sin;
    const c = -kx * sin;
    const d = ky * cos;
```
and update its doc comment to `S(1/scaleX, 1/scaleY)`.

- [ ] **Step 6: `normalizeTransform` and every load site in `src/persist/project-file.ts`**

Add (near `isTransformValue`), exported:
```ts
/**
 * A transform read from a file, in either shape: the previous build's uniform `{ scale }` (becomes
 * `scaleX = scaleY = scale`) or `{ scaleX, scaleY }` (wins when both are present). Anything
 * non-finite, missing or zero-scaled is rejected — a NaN poisons the whole compose chain and a zero
 * scale divides by zero in every inverse. Returns a FRESH object with only the model's fields.
 */
export function normalizeTransform(raw: unknown): RefTransform | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const perAxis = r.scaleX !== undefined || r.scaleY !== undefined;
  const t = {
    dx: r.dx,
    dy: r.dy,
    scaleX: perAxis ? r.scaleX : r.scale,
    scaleY: perAxis ? r.scaleY : r.scale,
    rotation: r.rotation,
  };
  const nums = [t.dx, t.dy, t.scaleX, t.scaleY, t.rotation];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if (t.scaleX === 0 || t.scaleY === 0) return null;
  return t as RefTransform;
}
```

Replace `isTransformValue`'s body: `return normalizeTransform(v) !== null;`

`sanitiseTracks` `"transform"` case — normalise each key's value BEFORE validating (so legacy `scale` keys survive, rewritten):
```ts
      case "transform": {
        const raw = tracks.transform;
        const normalised =
          raw && Array.isArray(raw.keys)
            ? {
                ...raw,
                keys: raw.keys.map((k) =>
                  k && typeof k === "object" ? { ...k, v: normalizeTransform(k.v) } : k,
                ),
              }
            : raw;
        const transform = sanitiseTrack(normalised as unknown as TransformTrack | undefined, isTransformValue);
        if (transform) out.transform = { ...transform, box: sanitiseTrackBox(transform.box) };
        break;
      }
```
(keep whatever `break`/structure the existing case has; only the first line changes into the block above).

Save-side identity check in `projectToJson`'s `cellTransforms` (L238-244): replace the four-field literal test with `!isIdentityTransform(c.transform)` (already imported in this file).

Load sites:
- cellTransforms loop:
  ```ts
      if (cell && cell.kind === "key") {
        const t = normalizeTransform(v.transform);
        if (t) cell.transform = t;
        cell.transformBox = v.transformBox ?? null;
      }
  ```
- drawing layer: `transform: normalizeTransform(lj.transform) ?? { ...IDENTITY_TRANSFORM },` (import `IDENTITY_TRANSFORM` from `../anim/document` if not already)
- reference: `transform: normalizeTransform(rj.transform) ?? { ...IDENTITY_TRANSFORM },`
- group: `transform: normalizeTransform(g.transform) ?? undefined,`

- [ ] **Step 7: Convert every test fixture**

In the 15 test files listed under **Files**, every transform literal `scale: X` becomes `scaleX: X, scaleY: X`, and every read of a transform's `.scale` becomes `.scaleX` (add a matching `.scaleY` assertion where the test asserts a scale result). Specific shapes:
- `transform-track.test.ts` helper: `const T = (dx: number, rotation = 0, scale = 1) => ({ dx, dy: 0, scaleX: scale, scaleY: scale, rotation });` and `expect(transformAt(layer(z), 5).scaleX).toBeCloseTo(2, 10);`
- `selection-map.test.ts`: `id({ scale: 2 })` → `id({ scaleX: 2, scaleY: 2 })`; helper default `{ dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0, ...over }`.
- `ref-transform.test.ts`: `const id = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 };` (all three declarations), `{ ...id, scale: 2 }` → `{ ...id, scaleX: 2, scaleY: 2 }`, the hand-written forward formula at L130-131 multiplies `ox` by `t.scaleX` and `oy` by `t.scaleY` inside the rotation (`x: cx + t.dx + (t.scaleX * ox * cos - t.scaleY * oy * sin)`, `y: cy + t.dy + (t.scaleX * ox * sin + t.scaleY * oy * cos)`).
- **Do NOT touch**: `persist.test.ts` L195-205 (that `scale` is the BOIL config's legacy field) and `render.test.ts` L22 (`scale: () =>` is a mocked ctx method).

Then add two per-axis tests.

To `src/__tests__/transform-track.test.ts`, inside `describe("transformAt", …)`:
```ts
  it("interpolates scaleX and scaleY independently, through zero for a flip", () => {
    const flip = track({
      keys: [
        { frame: 0, v: { dx: 0, dy: 0, scaleX: 1, scaleY: 2, rotation: 0 } },
        { frame: 10, v: { dx: 0, dy: 0, scaleX: -1, scaleY: 4, rotation: 0 } },
      ],
    });
    const mid = transformAt(layer(flip), 5);
    expect(mid.scaleX).toBeCloseTo(0, 10);
    expect(mid.scaleY).toBeCloseTo(3, 10);
  });
```

To `src/__tests__/ref-transform.test.ts`:
```ts
describe("per-axis transforms", () => {
  const t = { dx: 12, dy: -7, scaleX: -1.5, scaleY: 0.8, rotation: 0.6 };
  it("forward then inverse round-trips with rotation, stretch and a mirror", () => {
    for (const p of [
      { x: 120, y: 130 },
      { x: 290, y: 190 },
      { x: 200, y: 150 },
    ]) {
      const q = inverseTransformPoint(base, t, forwardTransformPoint(base, t, p));
      expect(q.x).toBeCloseTo(p.x, 9);
      expect(q.y).toBeCloseTo(p.y, 9);
    }
  });
  it("corners are the forward map of the base corners", () => {
    const fwd = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 200 },
      { x: 100, y: 200 },
    ].map((p) => forwardTransformPoint(base, t, p));
    transformedCorners(base, t).forEach((c, i) => {
      expect(c.x).toBeCloseTo(fwd[i].x, 9);
      expect(c.y).toBeCloseTo(fwd[i].y, 9);
    });
  });
  it("isSameTransform compares both scales", () => {
    expect(isSameTransform(t, { ...t })).toBe(true);
    expect(isSameTransform(t, { ...t, scaleY: 0.81 })).toBe(false);
  });
});
```

And to `src/__tests__/selection-map.test.ts`, inside the `describe` holding the existing `"agrees with inverseChain …"` tests (it already has `SAMPLES`, `applyMat6`, `inverseChain`):
```ts
  it("agrees with inverseChain on a rotated, stretched and mirrored step", () => {
    const steps: ComposeStep[] = [
      {
        base: { x: 10, y: 30, w: 120, h: 70 },
        t: { dx: 6, dy: -4, scaleX: -1.3, scaleY: 0.7, rotation: 0.4 },
      },
      id({ dx: -12, scaleX: 1.6, scaleY: -0.9, rotation: -0.3 }),
    ];
    const m = inverseComposeMatrix(steps);
    for (const p of SAMPLES) {
      const viaMatrix = applyMat6(m, p);
      const viaChain = inverseChain(steps, p);
      expect(viaMatrix.x).toBeCloseTo(viaChain.x, 6);
      expect(viaMatrix.y).toBeCloseTo(viaChain.y, 6);
    }
  });
```

- [ ] **Step 8: Run the tests and the build**

Run: `npm test` → Expected: all pass (1245 + the new ones).
Run: `npm run build` → Expected: 0 errors, 0 warnings. Any remaining `scale` compile error names a missed site — convert it the same way.

- [ ] **Step 9: Commit**

```bash
git add -A src
git commit -m "feat: per-axis scaleX/scaleY transform model; old files load their uniform scale on both axes"
```
(with the trailer from Global Constraints)

---

### Task 2: Side handles, stretch/free/proportional maths, `dragTransform`, `mirrorTransform`

Pure additions to `src/core/ref-transform.ts`; nothing calls them yet except tests.

**Files:**
- Modify: `src/core/ref-transform.ts`
- Test: `src/__tests__/ref-transform.test.ts`

**Interfaces:**
- Consumes: Task 1's `RefTransform`, `floorScale`, `forwardTransformPoint`.
- Produces (exact signatures later tasks call):
  - `type Handle = "nw" | "ne" | "se" | "sw" | "n" | "e" | "s" | "w" | "rotate" | "body" | null`
  - `transformedSides(base: Rect, t: RefTransform): [Pt, Pt, Pt, Pt]` — N, E, S, W edge midpoints
  - `rotateHandleStem(base: Rect, t: RefTransform): Pt` — the visual-top edge midpoint the rotate stem starts from
  - `applyScale(t, center, start, p)` — now the SIGNED projection
  - `applyFreeScale(t: RefTransform, center: Pt, start: Pt, p: Pt): RefTransform`
  - `applyStretch(t: RefTransform, axis: "x" | "y", center: Pt, start: Pt, p: Pt): RefTransform`
  - `dragTransform(handle: Exclude<Handle, null>, startT: RefTransform, center: Pt, start: Pt, p: Pt, keepProportions: boolean): RefTransform`
  - `mirrorTransform(t: RefTransform, baseCentre: Pt, axis: "h" | "v", line: number): RefTransform`
  - `mirrorTransformTrack(track: TransformTrack, baseCentre: Pt, axis: "h" | "v", line: number): TransformTrack`

- [ ] **Step 1: Write the failing tests** — in `src/__tests__/ref-transform.test.ts`, add the new names to the import (`transformedSides`, `rotateHandleStem`, `applyFreeScale`, `applyStretch`, `dragTransform`, `mirrorTransform`, `mirrorTransformTrack`, `rotateHandlePos`), import `transformAt, type Layer, type TransformTrack` from `../anim/document`, **replace** the existing `describe("applyScale", …)` block, and append:

```ts
// base = { x: 100, y: 100, w: 200, h: 100 }, centre (200,150) — declared at the top of this file.
const c0 = { x: 200, y: 150 };

describe("side handles", () => {
  it("transformedSides are the N, E, S, W edge midpoints", () => {
    expect(transformedSides(base, id)).toEqual([
      { x: 200, y: 100 },
      { x: 300, y: 150 },
      { x: 200, y: 200 },
      { x: 100, y: 150 },
    ]);
  });
  it("hitTestHandle finds each side", () => {
    expect(hitTestHandle(base, id, { x: 200, y: 101 }, 5, 20)).toBe("n");
    expect(hitTestHandle(base, id, { x: 299, y: 150 }, 5, 20)).toBe("e");
    expect(hitTestHandle(base, id, { x: 200, y: 199 }, 5, 20)).toBe("s");
    expect(hitTestHandle(base, id, { x: 101, y: 150 }, 5, 20)).toBe("w");
  });
  it("sides follow rotation", () => {
    const r = { ...id, rotation: Math.PI / 2 };
    expect(hitTestHandle(base, r, { x: 200, y: 249 }, 5, 20)).toBe("e");
  });
  it("the rotate handle stays above the visual top edge when Y is mirrored", () => {
    const m = { ...id, scaleY: -1 };
    expect(rotateHandlePos(base, m, 20)).toEqual({ x: 200, y: 80 });
    expect(rotateHandleStem(base, m)).toEqual({ x: 200, y: 100 });
    expect(hitTestHandle(base, m, { x: 200, y: 150 }, 5, 20)).toBe("body");
  });
});

describe("applyScale (proportional)", () => {
  it("doubling the distance along the grab direction doubles both axes", () => {
    const out = applyScale(id, c0, { x: 300, y: 200 }, { x: 400, y: 250 });
    expect(out.scaleX).toBeCloseTo(2, 9);
    expect(out.scaleY).toBeCloseTo(2, 9);
    expect(out.dx).toBe(0);
    expect(out.rotation).toBe(0);
  });
  it("keeps each axis's sign", () => {
    const out = applyScale({ ...id, scaleX: -1, scaleY: 2 }, c0, { x: 300, y: 200 }, { x: 400, y: 250 });
    expect(out.scaleX).toBeCloseTo(-2, 9);
    expect(out.scaleY).toBeCloseTo(4, 9);
  });
  it("dragging through the centre flips both axes", () => {
    const out = applyScale(id, c0, { x: 300, y: 200 }, { x: 100, y: 100 });
    expect(out.scaleX).toBeCloseTo(-1, 9);
    expect(out.scaleY).toBeCloseTo(-1, 9);
  });
  it("floors the magnitude at 0.05 on either side of zero", () => {
    expect(applyScale(id, c0, { x: 300, y: 200 }, { x: 200.001, y: 150 }).scaleX).toBe(0.05);
    expect(applyScale(id, c0, { x: 300, y: 200 }, { x: 199.999, y: 150 }).scaleX).toBe(-0.05);
  });
  it("a grab at the centre changes nothing", () => {
    expect(applyScale(id, c0, c0, { x: 400, y: 400 })).toBe(id);
  });
});

describe("applyFreeScale", () => {
  it("each axis follows the pointer independently", () => {
    const out = applyFreeScale(id, c0, { x: 300, y: 200 }, { x: 400, y: 225 });
    expect(out.scaleX).toBeCloseTo(2, 9);
    expect(out.scaleY).toBeCloseTo(1.5, 9);
  });
  it("measures in the target's rotated frame", () => {
    const r = { ...id, rotation: Math.PI / 2 };
    // local SE corner (100, 50) sits at doc offset (-50, 100) under a 90° turn
    const out = applyFreeScale(r, c0, { x: 150, y: 250 }, { x: 100, y: 350 });
    expect(out.scaleX).toBeCloseTo(2, 9);
    expect(out.scaleY).toBeCloseTo(2, 9);
  });
});

describe("applyStretch", () => {
  it("stretches only the named axis", () => {
    const out = applyStretch(id, "x", c0, { x: 300, y: 150 }, { x: 400, y: 190 });
    expect(out.scaleX).toBeCloseTo(2, 9);
    expect(out.scaleY).toBe(1);
    const outY = applyStretch(id, "y", c0, { x: 200, y: 200 }, { x: 260, y: 175 });
    expect(outY.scaleY).toBeCloseTo(0.5, 9);
    expect(outY.scaleX).toBe(1);
  });
  it("crossing the centre mirrors that axis, floored at 0.05", () => {
    expect(applyStretch(id, "x", c0, { x: 300, y: 150 }, { x: 150, y: 150 }).scaleX).toBeCloseTo(-0.5, 9);
    expect(applyStretch(id, "x", c0, { x: 300, y: 150 }, { x: 199.999, y: 150 }).scaleX).toBe(-0.05);
  });
  it("follows rotation", () => {
    const r = { ...id, rotation: Math.PI / 2 };
    expect(applyStretch(r, "x", c0, { x: 200, y: 250 }, { x: 200, y: 350 }).scaleX).toBeCloseTo(2, 9);
  });
});

describe("dragTransform", () => {
  const start = { x: 300, y: 200 };
  const p = { x: 400, y: 225 };
  it("dispatches corners on keepProportions", () => {
    expect(dragTransform("se", id, c0, start, p, true)).toEqual(applyScale(id, c0, start, p));
    expect(dragTransform("se", id, c0, start, p, false)).toEqual(applyFreeScale(id, c0, start, p));
  });
  it("sides stretch one axis whatever keepProportions says", () => {
    const e = dragTransform("e", id, c0, { x: 300, y: 150 }, { x: 400, y: 150 }, true);
    expect([e.scaleX, e.scaleY]).toEqual([2, 1]);
    const n = dragTransform("n", id, c0, { x: 200, y: 100 }, { x: 200, y: 50 }, true);
    expect([n.scaleX, n.scaleY]).toEqual([1, 2]);
  });
  it("body moves and rotate rotates", () => {
    expect(dragTransform("body", id, c0, start, p, true)).toEqual(applyMove(id, 100, 25));
    expect(dragTransform("rotate", id, c0, start, p, true)).toEqual(applyRotate(id, c0, start, p));
  });
});

describe("mirrorTransform", () => {
  const t = { dx: 12, dy: -7, scaleX: 1.5, scaleY: -0.8, rotation: 0.6 };
  const probes = [
    { x: 110, y: 120 },
    { x: 290, y: 185 },
    { x: 200, y: 150 },
  ];
  it("H: every point lands on the reflection of where it was, across x = line", () => {
    const m = mirrorTransform(t, c0, "h", 230);
    for (const p of probes) {
      const q = forwardTransformPoint(base, t, p);
      const r = forwardTransformPoint(base, m, p);
      expect(r.x).toBeCloseTo(2 * 230 - q.x, 9);
      expect(r.y).toBeCloseTo(q.y, 9);
    }
  });
  it("V: the same across y = line", () => {
    const m = mirrorTransform(t, c0, "v", 140);
    for (const p of probes) {
      const q = forwardTransformPoint(base, t, p);
      const r = forwardTransformPoint(base, m, p);
      expect(r.x).toBeCloseTo(q.x, 9);
      expect(r.y).toBeCloseTo(2 * 140 - q.y, 9);
    }
  });
  it("mirroring twice is the identity", () => {
    for (const axis of ["h", "v"] as const) {
      const back = mirrorTransform(mirrorTransform(t, c0, axis, 230), c0, axis, 230);
      expect(back.dx).toBeCloseTo(t.dx, 9);
      expect(back.dy).toBeCloseTo(t.dy, 9);
      expect(back.scaleX).toBeCloseTo(t.scaleX, 9);
      expect(back.scaleY).toBeCloseTo(t.scaleY, 9);
      expect(back.rotation).toBeCloseTo(t.rotation, 9);
    }
  });
});

describe("mirrorTransformTrack", () => {
  const T = (dx: number, rotation: number, sx: number) => ({ dx, dy: 3, scaleX: sx, scaleY: 1, rotation });
  const track: TransformTrack = {
    keys: [
      { frame: 0, v: T(0, 0, 1), interp: "ease-in" },
      { frame: 10, v: T(80, 1.2, 2) },
    ],
    sampleEvery: 2,
    box: null,
  };
  const layerOf = (tr: TransformTrack) =>
    ({ kind: "draw", id: 1, name: "L", transform: T(0, 0, 1), tracks: { transform: tr } }) as Layer;

  it("an interpolated frame of the mirrored track is the mirror of the original's", () => {
    const m = mirrorTransformTrack(track, c0, "h", 250);
    for (const f of [0, 3, 4, 7, 10, 14]) {
      const want = mirrorTransform(transformAt(layerOf(track), f), c0, "h", 250);
      const got = transformAt(layerOf(m), f);
      expect(got.dx).toBeCloseTo(want.dx, 9);
      expect(got.scaleX).toBeCloseTo(want.scaleX, 9);
      expect(got.rotation).toBeCloseTo(want.rotation, 9);
    }
  });
  it("keeps frames, easing, sampling and box, and leaves the input untouched", () => {
    const before = JSON.stringify(track);
    const m = mirrorTransformTrack(track, c0, "v", 100);
    expect(m.keys.map((k) => [k.frame, k.interp])).toEqual([
      [0, "ease-in"],
      [10, undefined],
    ]);
    expect(m.sampleEvery).toBe(2);
    expect(m.box).toBeNull();
    expect(JSON.stringify(track)).toBe(before);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/ref-transform.test.ts`
Expected: FAIL — the new exports don't exist.

- [ ] **Step 3: Implement in `src/core/ref-transform.ts`**

Change the imports and `Handle`:
```ts
import type { RefTransform, TransformTrack } from "../anim/document";
```
```ts
export type Handle =
  | "nw" | "ne" | "se" | "sw"
  | "n" | "e" | "s" | "w"
  | "rotate" | "body" | null;
```

Add after `rotateHandlePos`:
```ts
/** Edge midpoints N, E, S, W of the transformed image (the side-stretch handles). */
export function transformedSides(base: Rect, t: RefTransform): [Pt, Pt, Pt, Pt] {
  const [nw, ne, se, sw] = transformedCorners(base, t);
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  return [mid(nw, ne), mid(ne, se), mid(se, sw), mid(sw, nw)];
}

/** Where the rotate handle's stem leaves the box: the VISUAL top edge's midpoint, which is local
 *  −y only while scaleY is positive — hence |scaleY|, matching `rotateHandlePos`. */
export function rotateHandleStem(base: Rect, t: RefTransform): Pt {
  const c = transformCenter(base, t);
  return rotate({ x: c.x, y: c.y - (base.h / 2) * Math.abs(t.scaleY) }, c, t.rotation);
}
```

In `hitTestHandle`, after the corners/rotate `named` loop and before the body test, add the sides (corners win where they overlap a side on a tiny target, since they are tested first):
```ts
  const [n, e, s, w] = transformedSides(base, t);
  const sides: [Handle, Pt][] = [
    ["n", n],
    ["e", e],
    ["s", s],
    ["w", w],
  ];
  for (const [h, pt] of sides) if (dist(p, pt) <= tolDoc) return h;
```

Replace `applyScale` and add the new operations:
```ts
/** The target's own axes in document space: local x → (cos, sin), local y → (−sin, cos). */
function localAxis(t: RefTransform, axis: "x" | "y"): Pt {
  const cos = Math.cos(t.rotation),
    sin = Math.sin(t.rotation);
  return axis === "x" ? { x: cos, y: sin } : { x: -sin, y: cos };
}

/** Ratio of the pointer's offset from `center` to the grab's, measured along `u`. Null when the
 *  grab sat on the centre line (nothing to measure against). Signed: past the centre is negative. */
function ratioAlong(u: Pt, center: Pt, start: Pt, p: Pt): number | null {
  const l0 = (start.x - center.x) * u.x + (start.y - center.y) * u.y;
  if (Math.abs(l0) < 1e-6) return null;
  return ((p.x - center.x) * u.x + (p.y - center.y) * u.y) / l0;
}

/** Proportional scale about `center`: ONE signed factor — the pointer's offset projected onto the
 *  grab direction — applied to both axes, so signs are kept and dragging through the centre flips
 *  both (a 180° turn). */
export function applyScale(t: RefTransform, center: Pt, start: Pt, p: Pt): RefTransform {
  const v0 = { x: start.x - center.x, y: start.y - center.y };
  const len2 = v0.x * v0.x + v0.y * v0.y;
  if (len2 < 1e-12) return t;
  const k = ((p.x - center.x) * v0.x + (p.y - center.y) * v0.y) / len2;
  return { ...t, scaleX: floorScale(t.scaleX * k), scaleY: floorScale(t.scaleY * k) };
}

/** Stretch ONE of the target's own axes about `center`. */
export function applyStretch(
  t: RefTransform,
  axis: "x" | "y",
  center: Pt,
  start: Pt,
  p: Pt,
): RefTransform {
  const k = ratioAlong(localAxis(t, axis), center, start, p);
  if (k === null) return t;
  return axis === "x"
    ? { ...t, scaleX: floorScale(t.scaleX * k) }
    : { ...t, scaleY: floorScale(t.scaleY * k) };
}

/** A corner with Keep proportions OFF: each axis follows the pointer independently. */
export function applyFreeScale(t: RefTransform, center: Pt, start: Pt, p: Pt): RefTransform {
  return applyStretch(applyStretch(t, "x", center, start, p), "y", center, start, p);
}

/** One handle drag, from the grab-time transform. THE dispatch the gizmo and the on-canvas drag
 *  share, so the two cannot drift. */
export function dragTransform(
  handle: Exclude<Handle, null>,
  startT: RefTransform,
  center: Pt,
  start: Pt,
  p: Pt,
  keepProportions: boolean,
): RefTransform {
  switch (handle) {
    case "body":
      return applyMove(startT, p.x - start.x, p.y - start.y);
    case "rotate":
      return applyRotate(startT, center, start, p);
    case "e":
    case "w":
      return applyStretch(startT, "x", center, start, p);
    case "n":
    case "s":
      return applyStretch(startT, "y", center, start, p);
    default:
      return keepProportions
        ? applyScale(startT, center, start, p)
        : applyFreeScale(startT, center, start, p);
  }
}

/**
 * Mirror a transform across the line x = `line` ("h") or y = `line` ("v"), in the target's parent
 * space, keeping the same base. Reflecting `C + d + R(θ)S(p − C)` by F = diag(−1, 1) gives
 * F·R(θ)·S = R(−θ)·S(−sx, sy), so the result is again a transform on the same base:
 * scaleX' = −scaleX, rotation' = −rotation, dx' = 2·line − 2·C.x − dx (the "v" case mirrors this on
 * y). Affine in every field, so it commutes with key interpolation — see `mirrorTransformTrack`.
 */
export function mirrorTransform(
  t: RefTransform,
  baseCentre: Pt,
  axis: "h" | "v",
  line: number,
): RefTransform {
  return axis === "h"
    ? { ...t, scaleX: -t.scaleX, rotation: -t.rotation, dx: 2 * line - 2 * baseCentre.x - t.dx }
    : { ...t, scaleY: -t.scaleY, rotation: -t.rotation, dy: 2 * line - 2 * baseCentre.y - t.dy };
}

/** Mirror every key of a transform track (a NEW track; frames, easing, sampling, box untouched). */
export function mirrorTransformTrack(
  track: TransformTrack,
  baseCentre: Pt,
  axis: "h" | "v",
  line: number,
): TransformTrack {
  return {
    ...track,
    keys: track.keys.map((k) => ({ ...k, v: mirrorTransform(k.v, baseCentre, axis, line) })),
  };
}
```

(`applyMove`/`applyRotate` are declared above `dragTransform` already; keep the file's declaration order such that nothing is used before a `const` it depends on — these are all `function` declarations, so order is free.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/ref-transform.test.ts` → PASS. Then `npm test` → all pass; `npm run build` → 0/0.

- [ ] **Step 5: Commit**

```bash
git add src/core/ref-transform.ts src/__tests__/ref-transform.test.ts
git commit -m "feat: side-stretch, free and signed proportional scale, and mirror maths for transforms"
```

---

### Task 3: Keep proportions setting + gizmo side handles + shared drag dispatch

**Files:**
- Modify: `src/persist/preferences.ts` (field + `keepProportionsPref`)
- Modify: `src/state/appState.svelte.ts` (`AppState` interface near `canResetTransform` L255, initial state near L335, `gatherPreferences` L1982, `applyPreferences` L1999)
- Modify: `src/lib/RefTransformGizmo.svelte` (imports, `DragHandle`, `sides`/`stemPt` state, `tick`, cursor helper, `onDragMove`, markup)
- Modify: `src/lib/Canvas.svelte` (`onTransformDrag` L1031-1037 dispatch; imports L93-97)
- Modify: `src/lib/status-hint.ts` L120-123 and `src/__tests__/status-hint.test.ts` L196
- Modify: `src/lib/ToolOptions.svelte` (new `transform` branch; lucide imports)
- Test: `src/__tests__/preferences.test.ts`

**Interfaces:**
- Consumes: Task 2's `dragTransform`, `transformedSides`, `rotateHandleStem`, `Handle`.
- Produces: `state.keepProportions: boolean`; `Preferences.keepProportions?: boolean`; `keepProportionsPref(p: Partial<Preferences>): boolean` exported from `src/persist/preferences.ts`; a `{:else if appState.tool === "transform"}` branch in ToolOptions holding the toggle (Task 5 adds the Flip buttons to it).

- [ ] **Step 1: Failing preferences test** — append to `src/__tests__/preferences.test.ts` (add `keepProportionsPref` to the import from `../persist/preferences`):

```ts
describe("keepProportions", () => {
  it("absent means on", () => {
    expect(keepProportionsPref({})).toBe(true);
    expect(keepProportionsPref(parsePreferences(null))).toBe(true);
  });
  it("round-trips an explicit off", () => {
    expect(keepProportionsPref(parsePreferences(JSON.stringify({ keepProportions: false })))).toBe(false);
  });
  it("ignores a non-boolean", () => {
    expect(keepProportionsPref(parsePreferences(JSON.stringify({ keepProportions: "no" })))).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/__tests__/preferences.test.ts` → FAIL (`keepProportionsPref` missing).

- [ ] **Step 3: Preferences + state**

`src/persist/preferences.ts` — add to `Preferences` (after `pressureCurve`):
```ts
  /** Transform corners scale proportionally. Absent = on (the default), so older prefs keep it. */
  keepProportions?: boolean;
```
and export:
```ts
/** The stored Keep proportions setting; anything but an explicit boolean means the default, on. */
export function keepProportionsPref(p: Partial<Preferences>): boolean {
  return typeof p.keepProportions === "boolean" ? p.keepProportions : true;
}
```

`src/state/appState.svelte.ts`:
- `AppState` interface, beside `canResetTransform`:
  ```ts
  /** Transform CORNERS keep the aspect ratio (gizmo and selection float). Sides always stretch one
   *  axis. A preference — see `keepProportionsPref`. */
  keepProportions: boolean;
  ```
- initial state: `keepProportions: true,`
- `gatherPreferences` return: add `keepProportions: state.keepProportions,`
- `applyPreferences`: add `state.keepProportions = keepProportionsPref(p);` and import `keepProportionsPref` from `../persist/preferences` (the file already has `import type { Preferences }` from there — add a value import alongside).

- [ ] **Step 4: Run** `npx vitest run src/__tests__/preferences.test.ts` → PASS.

- [ ] **Step 5: Gizmo side handles (`src/lib/RefTransformGizmo.svelte`)**

Imports from `../core/ref-transform`: drop `applyScale`, `applyRotate`; add `transformedSides`, `rotateHandleStem`, `dragTransform`.

State and type:
```ts
  let sides = $state<{ x: number; y: number }[]>([]);
  let stemPt = $state<{ x: number; y: number }>({ x: 0, y: 0 });
```
```ts
  type DragHandle = "nw" | "ne" | "se" | "sw" | "n" | "e" | "s" | "w" | "rotate";
```

`onDragMove` — replace the `const nt = …` ternary:
```ts
    const nt = dragTransform(d.handle, d.startT, d.center, d.start, p, appState.keepProportions);
```

`tick` — beside `corners = …`:
```ts
      sides = transformedSides(base, t).map(toLocal);
      stemPt = toLocal(rotateHandleStem(base, t));
```

Cursor helper — generalise `cornerCursor(i)` to take the handle's point (sides use it too):
```ts
  function resizeCursor(pt: { x: number; y: number }): string {
    // corners[0] and corners[2] are opposite corners, so their midpoint is the centre.
    const cx = (corners[0].x + corners[2].x) / 2;
    const cy = (corners[0].y + corners[2].y) / 2;
    const deg = (Math.atan2(pt.y - cy, pt.x - cx) * 180) / Math.PI;
    // Screen y grows DOWNWARD, so a down-right diagonal is the NW↔SE axis. A resize axis is the
    // same in both directions, so fold to [0,180) and bucket every 45°.
    const a = ((deg % 180) + 180) % 180;
    return RESIZE_CURSORS[Math.round(a / 45) % 4];
  }
```
Update the comment above `RESIZE_CURSORS` to say corners AND sides; corner rects use `resizeCursor(c)`.

Markup — the stem starts at the visual top edge (a mirrored Y put corners 0/1 at the bottom):
```svelte
    <line
      x1={stemPt.x}
      y1={stemPt.y}
      x2={rotatePt.x}
      y2={rotatePt.y}
      stroke="#3b82f6"
      stroke-width="1.5"
    />
```
Add after the corner `{#each}` (same size and styling as the corners, so the hit area matches):
```svelte
    {#each sides as s, i (i)}
      <rect
        role="button"
        tabindex="-1"
        aria-label="Stretch"
        class="pointer-events-auto {resizeCursor(s)}"
        data-ref-handle=""
        x={s.x - 6}
        y={s.y - 6}
        width="12"
        height="12"
        fill="#fff"
        stroke="#3b82f6"
        stroke-width="1.5"
        onpointerdown={(e) => startHandleDrag((["n", "e", "s", "w"] as const)[i], e)}
      />
    {/each}
```
Guard the whole block on `sides.length === 4` too: `{#if visible && corners.length === 4 && sides.length === 4}`.

- [ ] **Step 6: On-canvas drag (`src/lib/Canvas.svelte` `onTransformDrag`)**

Replace the nested ternary that computes `nt` with:
```ts
      const nt = dragTransform(d.handle, d.startT, d.center, d.start, pc, appState.keepProportions);
```
Import `dragTransform` from `../core/ref-transform`; remove `applyMove`, `applyScale`, `applyRotate` from that import if nothing else in the file uses them (check with grep).

- [ ] **Step 7: Status hint** — `src/lib/status-hint.ts`:
```ts
    case "transform":
      if (c.animatedFrame !== null)
        return `Animated — a drag keys frame ${c.animatedFrame + 1} · corners scale · sides stretch · top handle rotates`;
      return "Drag to move · corners scale · sides stretch · top handle rotates";
```
Update the matching expectation(s) in `src/__tests__/status-hint.test.ts` (L196, plus any animated-variant expectation containing `corners scale`).

- [ ] **Step 8: ToolOptions transform branch** — `src/lib/ToolOptions.svelte`. Add `Lock, LockOpen` to the `@lucide/svelte` import. Insert immediately BEFORE `{:else if appState.tool === "deform" || appState.tool === "pose"}`:
```svelte
  {:else if appState.tool === "transform"}
    <button
      class="h-7 px-2 rounded border border-border bg-surface text-text-secondary text-xs flex items-center gap-1 hover:bg-surface-hover hover:text-text"
      class:ui-on={appState.keepProportions}
      aria-pressed={appState.keepProportions}
      title={appState.keepProportions
        ? "Keep proportions — on: corners keep the shape (sides always stretch)"
        : "Keep proportions — off: corners stretch freely"}
      onclick={() => (appState.keepProportions = !appState.keepProportions)}
      >{#if appState.keepProportions}<Lock size={14} />{:else}<LockOpen size={14} />{/if}
      Keep proportions</button
    >
```

- [ ] **Step 9: Verify**

Run: `npm test` → all pass. Run: `npm run build` → 0/0.

- [ ] **Step 10: Commit**

```bash
git add -A src
git commit -m "feat: side handles stretch, Keep proportions toggle for transform corners"
```

---

### Task 4: Selection float — sides stretch (skew removed), proportional corners

**Files:**
- Modify: `src/core/selection.ts` (new exported `cornerScaleMatrix`, `sideStretchMatrix`; `keepProportions` field; `updateDrag` corner and side cases L604-666)
- Modify: `src/lib/Canvas.svelte` (select/lasso branch, before `selection.startDrag(handle, p.x, p.y)` ~L1250)
- Modify: `src/lib/SelectionActions.svelte` (Keep proportions toggle)
- Test: `src/__tests__/selection-flip.test.ts` (same pure-matrix style; the `Selection` class needs a canvas and is not node-testable)

**Interfaces:**
- Consumes: Task 3's `appState.keepProportions`.
- Produces: `cornerScaleMatrix(handle: "tl" | "tr" | "bl" | "br", rect: SelectionRect, mouseLocal: { x: number; y: number }, keepProportions: boolean): Mat`; `sideStretchMatrix(handle: "t" | "b" | "l" | "r", rect: SelectionRect, mouseLocal: { x: number; y: number }): Mat`; `Selection.keepProportions: boolean` (default `true`).

- [ ] **Step 1: Failing tests** — append to `src/__tests__/selection-flip.test.ts` (import `cornerScaleMatrix, sideStretchMatrix` from `../core/selection`; `rect`, `ap` and `I` already exist there — rect = `{ x: 10, y: 20, w: 40, h: 30 }`):

```ts
describe("sideStretchMatrix", () => {
  it("r: stretches x only, the left edge stays put", () => {
    const m = sideStretchMatrix("r", rect, { x: 90, y: 999 });
    expect(ap(m, 50, 25)).toEqual({ x: 90, y: 25 });
    expect(ap(m, 10, 44)).toEqual({ x: 10, y: 44 });
    expect(m.b).toBe(0);
    expect(m.c).toBe(0);
  });
  it("l: dragging past the anchored right edge mirrors", () => {
    const m = sideStretchMatrix("l", rect, { x: 70, y: 0 });
    expect(m.a).toBeCloseTo(-0.5, 12);
    expect(ap(m, 50, 30).x).toBeCloseTo(50, 12);
  });
  it("b and t: stretch y only, the opposite edge stays put", () => {
    const b = sideStretchMatrix("b", rect, { x: -5, y: 80 });
    expect(ap(b, 30, 50)).toEqual({ x: 30, y: 80 });
    expect(ap(b, 30, 20)).toEqual({ x: 30, y: 20 });
    const t = sideStretchMatrix("t", rect, { x: 0, y: 35 });
    expect(ap(t, 30, 20).y).toBeCloseTo(35, 12);
    expect(ap(t, 30, 50).y).toBeCloseTo(50, 12);
    expect(t.b).toBe(0);
    expect(t.c).toBe(0);
  });
});

describe("cornerScaleMatrix", () => {
  it("free: each axis follows the pointer (today's behaviour)", () => {
    const m = cornerScaleMatrix("br", rect, { x: 90, y: 60 }, false);
    expect(m.a).toBeCloseTo(2, 12);
    expect(m.d).toBeCloseTo(40 / 30, 12);
    const anchor = ap(m, 10, 20);
    expect(anchor.x).toBeCloseTo(10, 12);
    expect(anchor.y).toBeCloseTo(20, 12);
  });
  it("proportional: one factor along the diagonal from the anchor corner", () => {
    const m = cornerScaleMatrix("br", rect, { x: 90, y: 60 }, true);
    expect(m.a).toBeCloseTo(4400 / 2500, 12);
    expect(m.d).toBeCloseTo(m.a, 12);
    const anchor = ap(m, 10, 20);
    expect(anchor.x).toBeCloseTo(10, 12);
    expect(anchor.y).toBeCloseTo(20, 12);
  });
  it("proportional: crossing the anchor flips both axes", () => {
    const m = cornerScaleMatrix("br", rect, { x: -30, y: -10 }, true);
    expect(m.a).toBeCloseTo(-1, 12);
    expect(m.d).toBeCloseTo(-1, 12);
  });
  it("tl anchors at the bottom-right corner", () => {
    const m = cornerScaleMatrix("tl", rect, { x: -30, y: -10 }, true);
    const anchor = ap(m, 50, 50);
    expect(anchor.x).toBeCloseTo(50, 12);
    expect(anchor.y).toBeCloseTo(50, 12);
    expect(m.a).toBeCloseTo(2, 12);
    expect(m.d).toBeCloseTo(2, 12);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/__tests__/selection-flip.test.ts` → FAIL (exports missing).

- [ ] **Step 3: Implement in `src/core/selection.ts`**

Add after `flipMatrix` (exported, pure; both are RIGHT-multiplied onto `matrixStart`, so they act in the float's local rect coords):
```ts
/**
 * A corner scale about the OPPOSITE (anchor) corner, in local rect coords. `keepProportions` uses
 * one signed factor — the pointer's offset from the anchor projected onto the anchor→corner
 * diagonal — so the aspect holds and crossing the anchor flips both axes; off, each axis follows the
 * pointer on its own.
 */
export function cornerScaleMatrix(
  handle: "tl" | "tr" | "bl" | "br",
  r: SelectionRect,
  mouseLocal: { x: number; y: number },
  keepProportions: boolean,
): Mat {
  const left = handle === "tl" || handle === "bl";
  const top = handle === "tl" || handle === "tr";
  const ax = left ? r.x + r.w : r.x;
  const ay = top ? r.y + r.h : r.y;
  const denomX = (left ? r.x : r.x + r.w) - ax;
  const denomY = (top ? r.y : r.y + r.h) - ay;
  let sx = denomX !== 0 ? (mouseLocal.x - ax) / denomX : 1;
  let sy = denomY !== 0 ? (mouseLocal.y - ay) / denomY : 1;
  if (keepProportions) {
    const len2 = denomX * denomX + denomY * denomY;
    const k = len2 !== 0 ? ((mouseLocal.x - ax) * denomX + (mouseLocal.y - ay) * denomY) / len2 : 1;
    sx = sy = k;
  }
  // T(ax, ay) · Scale(sx, sy) · T(−ax, −ay)
  return { a: sx, b: 0, c: 0, d: sy, e: ax * (1 - sx), f: ay * (1 - sy) };
}

/** A side stretch: ONE axis, anchored at the opposite side, in local rect coords. Replaced the
 *  skew these handles used to do (spec 2026-09-11) — Distort and Mesh cover slanting. */
export function sideStretchMatrix(
  handle: "t" | "b" | "l" | "r",
  r: SelectionRect,
  mouseLocal: { x: number; y: number },
): Mat {
  if (handle === "l" || handle === "r") {
    const ax = handle === "r" ? r.x : r.x + r.w;
    const denom = (handle === "r" ? r.x + r.w : r.x) - ax;
    const sx = denom !== 0 ? (mouseLocal.x - ax) / denom : 1;
    return { a: sx, b: 0, c: 0, d: 1, e: ax * (1 - sx), f: 0 };
  }
  const ay = handle === "b" ? r.y : r.y + r.h;
  const denom = (handle === "b" ? r.y + r.h : r.y) - ay;
  const sy = denom !== 0 ? (mouseLocal.y - ay) / denom : 1;
  return { a: 1, b: 0, c: 0, d: sy, e: 0, f: ay * (1 - sy) };
}
```

In the class, beside `screenScale`:
```ts
  /** Corners keep the aspect ratio. Mirrors `appState.keepProportions`; Canvas sets it at grab. */
  keepProportions = true;
```

In `updateDrag`, replace the whole `case "tl" … case "br"` block and both side blocks (`"l"|"r"`, `"t"|"b"`) with:
```ts
      case "tl":
      case "tr":
      case "bl":
      case "br": {
        const mouseLocal = applyPoint(invert(this.matrixStart), x, y);
        const m = cornerScaleMatrix(this.dragging, r, mouseLocal, this.keepProportions);
        this.matrix = multiply(this.matrixStart, m);
        break;
      }

      case "l":
      case "r":
      case "t":
      case "b": {
        const mouseLocal = applyPoint(invert(this.matrixStart), x, y);
        this.matrix = multiply(this.matrixStart, sideStretchMatrix(this.dragging, r, mouseLocal));
        break;
      }
```
If `invertVec` has no remaining callers, delete it (it was only the skew's); if `dx`/`dy` at the top of `updateDrag` become unused in the transforming branch they are still used by `move` and warping — leave them.

- [ ] **Step 4: Run** `npx vitest run src/__tests__/selection-flip.test.ts` → PASS.

- [ ] **Step 5: Canvas syncs the setting at grab** — in `Canvas.svelte`'s select/lasso branch, the `else if ((selection.state === "transforming" || selection.state === "warping") && handle)` arm becomes:
```ts
          selectionMode = "drag";
          selection.keepProportions = appState.keepProportions; // read at grab, like every drag input
          selection.startDrag(handle, p.x, p.y);
```

- [ ] **Step 6: Toggle in the selection bar** — `src/lib/SelectionActions.svelte`. Add `Lock, LockOpen` to its lucide import. Inside the existing `{#if mode !== "warping"}` block, AFTER the Flip `{#each}`, add:
```svelte
      <!-- Keep proportions: shown whenever Flip is (plain AND lifted), not only once lifted — the bar
           is centred on the selection, so a button that appears on the lift re-centres it and slides
           every other button under the pen (the reason the dimmed ✓ exists). It is a setting, so it
           is harmless before the lift. Same value as the Transform bar's toggle. -->
      <button
        class="size-10 rounded-md border flex items-center justify-center"
        class:bg-accent={appState.keepProportions}
        class:text-accent-text={appState.keepProportions}
        class:border-accent={appState.keepProportions}
        class:bg-surface={!appState.keepProportions}
        class:text-text-secondary={!appState.keepProportions}
        class:border-border={!appState.keepProportions}
        class:hover:bg-surface-hover={!appState.keepProportions}
        aria-pressed={appState.keepProportions}
        onpointerdown={tap(() => (appState.keepProportions = !appState.keepProportions))}
        title={appState.keepProportions
          ? "Keep proportions — on: corners keep the shape (sides always stretch)"
          : "Keep proportions — off: corners stretch freely"}
      >
        {#if appState.keepProportions}<Lock size={18} />{:else}<LockOpen size={18} />{/if}
      </button>
```
(Ruling vs spec "while a selection is lifted": shown in both plain and lifted states so the bar width never changes on the lift — see the comment. Hidden in Distort/Mesh with Flip.)

- [ ] **Step 7: Verify** — `npm test` → pass; `npm run build` → 0/0.

- [ ] **Step 8: Commit**

```bash
git add -A src
git commit -m "feat: selection sides stretch instead of skew; corners keep proportions"
```

---

### Task 5: Flip horizontal / vertical for layer, reference and group transforms

**Files:**
- Modify: `src/state/appState.svelte.ts` (`flipLayerTransform`, `flipGroupTransform` beside `resetLayerTransform`/`resetGroupTransform` ~L833-890; `canFlipTransform` in `AppState` + initial state; `transformActions` type ~L2178)
- Modify: `src/lib/RefTransformGizmo.svelte` (`flipTransform`, register on `transformActions.flip`, publish `canFlipTransform` in `tick`)
- Modify: `src/lib/ToolOptions.svelte` (Flip buttons in the Task 3 transform branch)

**Interfaces:**
- Consumes: Task 2's `mirrorTransform`, `mirrorTransformTrack`, `transformCenter`, `forwardChain`; Task 3's transform branch.
- Produces: `flipLayerTransform(layerId: number, axis: "h" | "v"): void`; `flipGroupTransform(groupId: number, axis: "h" | "v"): void`; `transformActions.flip: ((axis: "h" | "v") => void) | null`; `state.canFlipTransform: boolean`.

The logic is the pure, tested `mirrorTransform`/`mirrorTransformTrack` (Task 2); this task is glue (store + DOM), not node-testable — it is covered by the owed browser pass.

- [ ] **Step 1: State + actions in `src/state/appState.svelte.ts`**

`AppState` interface, beside `canResetTransform`:
```ts
  /** A live gizmo target exists, so Flip horizontal/vertical would act. Mirrored from
   *  RefTransformGizmo's tick, like `canResetTransform`. */
  canFlipTransform: boolean;
```
initial state: `canFlipTransform: false,`

`transformActions`:
```ts
export const transformActions: {
  reset: (() => void) | null;
  flip: ((axis: "h" | "v") => void) | null;
} = { reset: null, flip: null };
```

Imports: add `mirrorTransform`, `mirrorTransformTrack`, `transformCenter`, `forwardChain`, `type Pt` from `../core/ref-transform`; `contentBounds`, `contentBoxLogical` alongside `groupBoxLogical` from `../lib/cell-ink`; and from `../anim/document` any of `transformAt`, `transformBaseRect`, `resolvedDisplayKeyCell`, `cellTransform`, `isLayerLocked`, `groupTransformAt`, `layerTransformTrack`, `type DrawingLayer`, `type RefTransform` not already imported (check the existing import block at the top of the file).

Add after `resetGroupTransform`:
```ts
/** The point a layer flip mirrors through, at `frame`, in the layer's parent space: the centre of
 *  what is ON SCREEN. A drawing layer uses its displayed key's ink, carried through the cell and
 *  layer transforms; an empty frame, or a reference, uses the transform centre. */
function layerFlipCentre(
  layer: Layer,
  base: { x: number; y: number; w: number; h: number },
  t: RefTransform,
  frame: number,
): Pt {
  if (layer.kind !== "draw") return transformCenter(base, t);
  const rk = resolvedDisplayKeyCell(layer, frame);
  const ink = rk ? contentBounds(rk.cell.canvas, state.version) : null;
  if (!rk || !ink) return transformCenter(base, t);
  const W = state.project.width,
    H = state.project.height;
  const cellBox = contentBoxLogical(rk.cell.canvas, rk.cell.transformBox, W, H, DPR, state.version);
  const inkCentre = { x: (ink.x + ink.w / 2) / DPR, y: (ink.y + ink.h / 2) / DPR };
  return forwardChain(
    [
      { base: cellBox, t: cellTransform(rk.cell) },
      { base, t },
    ],
    inkCentre,
  );
}

/** Mirror a layer's (or reference's) transform in place, across the line through the centre of
 *  what is on screen at the playhead. An animated layer mirrors the static value AND every key —
 *  the mirror is affine, so every in-between frame is mirrored exactly too. One undo step. */
export function flipLayerTransform(layerId: number, axis: "h" | "v"): void {
  const layer = state.project.layers.find((l) => l.id === layerId);
  if (!layer) return;
  if (layer.kind === "draw" && !isLayerEditable(layer, state.project.groups)) return; // locked/hidden = content is immutable
  if (layer.kind === "ref" && isLayerLocked(layer, state.project.groups)) return; // a locked ref is pinned
  const base = transformBaseRect(layer, state.project.width, state.project.height);
  if (!base) return; // reference media not loaded
  const frame = state.playhead;
  const centre = layerFlipCentre(layer, base, transformAt(layer, frame), frame);
  const line = axis === "h" ? centre.x : centre.y;
  const baseCentre = { x: base.x + base.w / 2, y: base.y + base.h / 2 };
  const track = layerTransformTrack(layer);
  commitStructural(() => {
    // New objects only — undo snapshots share the layer (gotcha #8, at the bag level too).
    layer.transform = mirrorTransform(layer.transform, baseCentre, axis, line);
    if (track)
      layer.tracks = {
        ...layer.tracks,
        transform: mirrorTransformTrack(track, baseCentre, axis, line),
      };
  });
}

/** Mirror a group's transform in place across the line through its box centre at the playhead —
 *  static value and every key, as `flipLayerTransform`. One undo step. */
export function flipGroupTransform(groupId: number, axis: "h" | "v"): void {
  const g = state.project.groups.find((x) => x.id === groupId);
  if (!g) return;
  if (groupHasLockedLayer(g, state.project.layers)) return; // a locked member pins the whole group
  const frame = state.playhead;
  const box = groupBoxLogical(g, state.project, frame, DPR, state.version);
  const t = groupTransformAt(g, frame);
  const centre = transformCenter(box, t);
  const line = axis === "h" ? centre.x : centre.y;
  const baseCentre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const track = g.tracks?.transform;
  commitStructural(() => {
    // Freeze the pivot box exactly as a drag's grab does on an identity group: without it the box
    // stays live content bounds, and drawing more would slide the pivot under the flip.
    if (!track && isIdentityTransform(t)) g.transformBox = box;
    // The static value is mirrored too (retained-but-ignored while animated), but an animated group
    // with NO static value keeps none — mirroring the identity would invent one.
    if (g.transform || !track)
      g.transform = mirrorTransform(g.transform ?? IDENTITY_TRANSFORM, baseCentre, axis, line);
    if (track)
      g.tracks = { ...g.tracks, transform: mirrorTransformTrack(track, baseCentre, axis, line) };
  });
}
```

- [ ] **Step 2: Gizmo dispatch (`src/lib/RefTransformGizmo.svelte`)**

Import `flipLayerTransform`, `flipGroupTransform` from `../state/appState.svelte`. Add beside `resetTransform`:
```ts
  function flipTransform(axis: "h" | "v") {
    const l = activeTransformLayer();
    const tgt = transformTarget();
    if (!l || !tgt || !tgt.base) return;
    if (tgt.scope === "group" && tgt.group) flipGroupTransform(tgt.group.id, axis);
    else flipLayerTransform(l.id, axis); // draw layer AND reference
  }
```
In `onMount`: `transformActions.flip = flipTransform;` and in its cleanup `transformActions.flip = null; appState.canFlipTransform = false;`.

In `tick`: in the visible branch `appState.canFlipTransform = true;`, in the `else` branch `appState.canFlipTransform = false;`.

- [ ] **Step 3: Flip buttons (`src/lib/ToolOptions.svelte`)**

Add `FlipHorizontal2, FlipVertical2` to the lucide import. In the `{:else if appState.tool === "transform"}` branch, BEFORE the Keep proportions button:
```svelte
    {@const flipBtn =
      "w-9 h-9 rounded border border-border bg-surface text-text-secondary flex items-center justify-center hover:bg-surface-hover aria-disabled:opacity-40 aria-disabled:cursor-default aria-disabled:hover:bg-surface"}
    {#each [{ axis: "h", title: "Flip horizontal" }, { axis: "v", title: "Flip vertical" }] as const as f (f.axis)}
      <!-- aria-disabled, NOT disabled — see the select/lasso branch above for why. -->
      <button
        class={flipBtn}
        title={appState.canFlipTransform ? `${f.title} — in place` : `${f.title} — nothing to flip here`}
        aria-disabled={!appState.canFlipTransform}
        onclick={() => {
          if (appState.canFlipTransform) transformActions.flip?.(f.axis);
        }}
        >{#if f.axis === "h"}<FlipHorizontal2 size={16} />{:else}<FlipVertical2 size={16} />{/if}</button
      >
    {/each}
    <span class="mx-1 h-5 w-px bg-border"></span>
```

- [ ] **Step 4: Verify** — `npm test` → pass; `npm run build` → 0/0.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat: Flip horizontal/vertical for layer, reference and group transforms, animation included"
```

---

### Task 6: Docs

**Files:**
- Modify: `README.md` (Features transform bullet ~L54; test count L102)
- Modify: `docs/superpowers/CHANGELOG.md` (append an entry)
- Modify: `CLAUDE.md` (test baseline in Commands; one line in Current state)

- [ ] **Step 1: Count tests** — run `npm test` and read the passing total.

- [ ] **Step 2: README** — the transform bullet (L54) gains, after its existing text: `; side handles stretch one axis, corners keep proportions (toggleable), and Flip horizontal/vertical mirrors a layer, reference or group in place — animated ones included`. Update the `npm test` line's count to the number from Step 1. No new keyboard shortcut, no roadmap item shipped.

- [ ] **Step 3: CHANGELOG** — append a dated `2026-09-11` entry titled **Transform stretch & flip** covering: `scaleX`/`scaleY` replace `scale` (old files migrate via `normalizeTransform`; saves write the new shape, format version still 1 — a pre-change build would mis-read a new file, accepted); side handles stretch on gizmo and selection (selection skew removed); Keep proportions (default on, preference, corners only; the selection-bar toggle shows in plain and lifted states to keep the bar's width fixed); Flip H/V in the Transform bar mirrors in place about what is on screen at the playhead, whole animation included, one undo step; link the spec and plan; **owed a browser + iPad pass**: side handles and proportional corners on a layer, a group and a reference; the toggle in both bars; flip on each (static and animated); Apply with a flip; an export containing a flip.

- [ ] **Step 4: CLAUDE.md** — update the `npm test` baseline number in **Commands**, and add to the end of the **Current state** section: `Transforms are per-axis (scaleX/scaleY; negative = mirrored): side handles stretch, corners keep proportions (toggle), Flip H/V in the Transform bar (2026-09-11).`

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md docs/superpowers/CHANGELOG.md
git commit -m "docs: transform stretch & flip"
```
