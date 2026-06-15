# Line Boil — WebGL Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Productionize the validated WebGL line-boil spike — add in-shader line-weight, export support, context-loss handling, the `scale`→`weight` rename, and remove the dead CPU mesh warp.

**Architecture:** All drawing layers composite (displaced, premultiplied, z-ordered) into one offscreen WebGL surface that the 2D compositor blits once per frame (the iOS-safe pattern). Noise stays cross-GPU-stable via `highp` + a CPU-reduced seed. Weight is a per-frame signed alpha-edge bias in the shader.

**Tech Stack:** WebGL1, TypeScript 5.9, Svelte 5, Vitest, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-06-15-line-boil-webgl-design.md` (supersedes the variant-cache/dilate-erode parts of the earlier line-boil spec).

**Branch:** build on `boil-webgl-spike` (the spike that proved the approach). It already has `src/core/boil-gl.ts` (begin/layer/blit, the cross-GPU seed fix) and `render.ts` wired to it.

---

## Context the implementer needs

- `src/core/boil-gl.ts` is the GL module-singleton. `boilBegin(w,h)`/`boilLayer(src,opacity,amount,freq,seed)`/`boilBlit(ctx)`. The shader already does displacement; this plan adds weight + a testable seed helper + context-loss.
- `src/anim/render.ts:compositeFrameLayers` already routes boil through the GL path (reference layers in 2D below; drawing layers via `boilLayer`; one `boilBlit`).
- `BoilConfig` (in `src/anim/document.ts`) is `{ enabled, amount, cols, rate, scale, holdsOnly }`. `scale` is the old uniform-scale weight → rename to `weight`. The UI label `grid` is relabeled `detail` (the field stays `cols`). `defaultBoilConfig()` + persistence + the Timeline popover all reference these.
- Persistence (`src/persist/project-file.ts`) serialises `project.boil` and loads `boil: json.boil ?? defaultBoilConfig()`. Old saves may carry `scale` (boil shipped only recently).
- Export (`src/export/video.ts:39`, `src/export/png-sequence.ts:18`) call `renderFrame(ctx, project, f, dpr, { drawBg: true, includeReference: false })` — no boil today.
- `src/core/boil.ts` is the dead CPU mesh warp (no longer imported anywhere after the spike).

**Run tests:** `npm test`. **Build:** `npm run build`. The GL output itself is manual-verified (browser + iPad); only the pure seed helper + config are unit-tested.

---

### Task 1: extract + test the seed→offset mapping

**Files:**
- Modify: `src/core/boil-gl.ts` (extract `boilSeedOffset`)
- Test: `src/__tests__/boil-gl.test.ts`

Pure refactor of the cross-GPU fix into a testable function (a regression here is what caused the noise to collapse, so it's worth pinning).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/boil-gl.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { boilSeedOffset } from "../core/boil-gl";

describe("boilSeedOffset", () => {
  it("is bounded well below the magnitudes that collapse GLSL noise", () => {
    for (const seed of [0, 1, 100003, 9176, 300009 + 27528, 1e7]) {
      const [x, y] = boilSeedOffset(seed);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(17);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(17);
    }
  });

  it("is deterministic", () => {
    expect(boilSeedOffset(42)).toEqual(boilSeedOffset(42));
  });

  it("gives distinct offsets for the rate/layer seeds it will see", () => {
    // seeds = (frame % rate) * 100003 + layerId * 9176 — neighbouring residues/layers must differ
    const a = boilSeedOffset(0 * 100003 + 1 * 9176);
    const b = boilSeedOffset(1 * 100003 + 1 * 9176);
    const c = boilSeedOffset(0 * 100003 + 2 * 9176);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/boil-gl.test.ts`
Expected: FAIL — `boilSeedOffset` not exported.

- [ ] **Step 3: Implement**

In `src/core/boil-gl.ts`, add the exported helper (above `boilLayer`):

```ts
/** Map a (possibly huge) seed to a SMALL bounded 2D offset on the CPU (float64, exact). Feeding a
 *  large coordinate into the GLSL noise collapses it (few/constant states) on most GPUs. */
export function boilSeedOffset(seed: number): [number, number] {
  return [
    Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 17,
    Math.abs(Math.sin(seed * 78.233) * 12543.1234) % 17,
  ];
}
```

Then in `boilLayer`, replace the inline `sx`/`sy` computation with a call:

```ts
  const [sx, sy] = boilSeedOffset(seed);
  g.uniform2f(uSeed, sx, sy);
```

- [ ] **Step 4: Run test + build**

Run: `npm test -- src/__tests__/boil-gl.test.ts` → PASS.
Run: `npm run build` → GREEN.

- [ ] **Step 5: Commit**

```bash
git add src/core/boil-gl.ts src/__tests__/boil-gl.test.ts
git commit -m "feat: extract + test boilSeedOffset (cross-GPU noise guard)"
```

---

### Task 2: rename `scale` → `weight` (config + persistence + UI)

**Files:**
- Modify: `src/anim/document.ts` (BoilConfig, defaultBoilConfig, comment)
- Modify: `src/persist/project-file.ts` (load migration)
- Modify: `src/lib/Timeline.svelte` (relabel `grid`→`detail`; rewire the weight slider)
- Test: `src/__tests__/document.test.ts`, `src/__tests__/persist.test.ts`

`weight` exists but isn't used by the renderer yet (Task 3 wires it) — so the build stays green.

- [ ] **Step 1: Update the failing tests**

In `src/__tests__/document.test.ts`, update the boil-defaults test's expected object — change `scale: 0.005` to `weight: 0.4`:

```ts
  it("a new project starts with disabled boil + tuned defaults", () => {
    expect(createProject().boil).toEqual({
      enabled: false, amount: 1, cols: 20, rate: 3, weight: 0.4, holdsOnly: true,
    });
  });
```

And update the `defaultBoilConfig` key-shape assertion if present (in `document.test.ts` or `persist.test.ts`) to expect `weight` instead of `scale`:

```ts
    expect(Object.keys(defaultBoilConfig()).sort()).toEqual(
      ["amount", "cols", "enabled", "holdsOnly", "rate", "weight"]
    );
```

In `src/__tests__/persist.test.ts`, in the `projectToJson` test replace `scale: 0.01` with `weight: 0.4` in BOTH the input `Project.boil` literal and the expected JSON `boil`. Add a migration test:

```ts
import { loadProjectBlob } from "../persist/project-file"; // if not already imported — else skip

// (If loadProjectBlob needs a zip + DOM it can't run headlessly; in that case test the migration
// helper directly — see Step 3 which exports `migrateBoil`.)
import { migrateBoil } from "../persist/project-file";
describe("boil migration", () => {
  it("an old save with `scale` loads with a default weight (scale dropped)", () => {
    const old = { enabled: true, amount: 2, cols: 16, rate: 2, scale: 0.005, holdsOnly: true } as unknown;
    const m = migrateBoil(old);
    expect(m.weight).toBe(0.4);
    expect("scale" in m).toBe(false);
    expect(m.amount).toBe(2);
  });
  it("a save with weight keeps it; missing boil → full default", () => {
    expect(migrateBoil({ enabled: true, amount: 3, cols: 8, rate: 1, weight: 0.7, holdsOnly: false }).weight).toBe(0.7);
    expect(migrateBoil(undefined).enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/__tests__/document.test.ts src/__tests__/persist.test.ts`
Expected: FAIL — `weight` not on the config; `migrateBoil` not exported.

- [ ] **Step 3: Implement**

In `src/anim/document.ts`:
- In `BoilConfig`, replace `scale: number;` with `weight: number;` and update the comment:

```ts
/** Line-boil settings, persisted per project. */
export interface BoilConfig {
  enabled: boolean;
  amount: number;    // displacement px
  cols: number;      // noise detail (frequency across the canvas)
  rate: number;      // cycle length (on twos/threes)
  weight: number;    // line-weight breathing (0..1, in-shader alpha dilate/erode)
  holdsOnly: boolean;
}
```
- In `defaultBoilConfig`, return `weight: 0.4` instead of `scale: 0.005`:

```ts
export function defaultBoilConfig(): BoilConfig {
  return { enabled: false, amount: 1, cols: 20, rate: 3, weight: 0.4, holdsOnly: true };
}
```
- Update the `DrawingLayer.boilStrength` comment from `amount/scale` to `amount/weight` (cosmetic).

In `src/persist/project-file.ts`:
- Add an exported migration helper (near the top, after imports):

```ts
/** Normalise a persisted boil blob (old saves used `scale`; weight has a different meaning, so old
 *  `scale` is dropped and weight falls back to the default). */
export function migrateBoil(raw: unknown): BoilConfig {
  const d = defaultBoilConfig();
  if (!raw || typeof raw !== "object") return d;
  const b = raw as Partial<BoilConfig>;
  return {
    enabled: b.enabled ?? d.enabled,
    amount: typeof b.amount === "number" ? b.amount : d.amount,
    cols: typeof b.cols === "number" ? b.cols : d.cols,
    rate: typeof b.rate === "number" ? b.rate : d.rate,
    weight: typeof b.weight === "number" ? b.weight : d.weight,
    holdsOnly: b.holdsOnly ?? d.holdsOnly,
  };
}
```
- In the load function, change `boil: json.boil ?? defaultBoilConfig(),` to `boil: migrateBoil(json.boil),`.

In `src/lib/Timeline.svelte` (the boil settings popover):
- Relabel the detail control: change the `<span ...>grid</span>` to `<span ...>detail</span>` (the slider already binds `state.project.boil.cols`; leave the bind).
- Rewire the weight slider (currently `bind:value={state.project.boil.scale}` min 0 max 0.05 step 0.005 with a `%` readout) to:

```svelte
          <label class="flex items-center gap-2" title="Boil line-weight breathing"><span class="w-10 text-text-secondary">weight</span>
            <input type="range" class="flex-1" min="0" max="1" step="0.05" bind:value={state.project.boil.weight} />
            <span class="w-8 text-right text-text-muted tabular-nums">{state.project.boil.weight}</span></label>
```

- [ ] **Step 4: Run tests + build**

Run: `npm test` → all green (document + persist updated).
Run: `npm run build` → GREEN, 0 warnings. (No `state.project.boil.scale` references remain — verify with `grep -rn "boil.scale\|\.scale" src/lib/Timeline.svelte`.)

- [ ] **Step 5: Commit**

```bash
git add src/anim/document.ts src/persist/project-file.ts src/lib/Timeline.svelte src/__tests__/document.test.ts src/__tests__/persist.test.ts
git commit -m "feat: rename boil scale→weight (config, migration, UI relabel grid→detail)"
```

---

### Task 3: in-shader line-weight + context-loss handling

**Files:**
- Modify: `src/core/boil-gl.ts` (weight uniform + shader; `resetBoilGL`; context-loss listeners)
- Modify: `src/anim/render.ts` (pass weight to `boilLayer`)

Build- + manual-verified (the shader is GPU).

- [ ] **Step 1: Add the weight uniform + shader edge bias**

In `src/core/boil-gl.ts`:
- Add a uniform handle: `let uWeight: WebGLUniformLocation | null = null;` (with the other `uX` lets).
- In the fragment shader source, add the uniform and apply a premultiplied-correct alpha-edge bias. Replace the `FRAG` `main()` end so it reads:

```glsl
uniform float uWeight; // signed edge bias: + fatten, - thin
...
void main() {
  vec2 e = smoothstep(0.0, 0.06, vUv) * smoothstep(0.0, 0.06, 1.0 - vUv);
  vec2 p = vUv * uFreq + uSeed;
  vec2 d = (vec2(vnoise(p), vnoise(p + vec2(19.3, 7.7))) - 0.5) * 2.0 * uAmount * (e.x * e.y);
  vec4 c = texture2D(uTex, vUv + d);
  // Line-weight: push the anti-aliased edge alpha (a*(1-a) peaks at edges); rescale rgb to stay premultiplied.
  float a0 = c.a;
  float a = clamp(a0 + uWeight * a0 * (1.0 - a0) * 4.0, 0.0, 1.0);
  vec3 rgb = a0 > 0.0 ? c.rgb * (a / a0) : c.rgb;
  gl_FragColor = vec4(rgb, a) * uOpacity;
}
```
(Add `uniform float uWeight;` to the uniform block near the other uniforms — shown above the `main`.)
- In `init()`, fetch the location: `uWeight = g.getUniformLocation(prog, "uWeight");`.
- Change `boilLayer`'s signature to take `weight` and set the uniform. The weight breathes (fattens on some frames, thins on others) via a per-frame signed jitter from the seed:

```ts
export function boilLayer(src: HTMLCanvasElement, opacity: number, amount: number, freq: number, weight: number, seed: number): void {
  const g = gl!;
  g.bindTexture(g.TEXTURE_2D, tex);
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src);
  g.uniform1i(uTex, 0);
  g.uniform2f(uAmount, amount / curW, amount / curH);
  g.uniform1f(uFreq, Math.max(1, freq));
  const [sx, sy] = boilSeedOffset(seed);
  g.uniform2f(uSeed, sx, sy);
  // Signed per-frame jitter in [-1,1] (different stream from the displacement seed) so weight breathes.
  const wjit = (boilSeedOffset(seed + 31)[0] / 17) * 2 - 1;
  // 0.12 = max edge-alpha push at full weight; keep it subtle.
  g.uniform1f(uWeight, weight * wjit * 0.12);
  g.uniform1f(uOpacity, opacity);
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
}
```

- [ ] **Step 2: Add context-loss handling**

In `src/core/boil-gl.ts`, add an exported reset and wire the lost-context listener in `init()`:
- Add:

```ts
/** Drop the GL state so the next boilBegin re-initialises (used on WebGL context loss). */
export function resetBoilGL(): void {
  gl = null; glCanvas = null; prog = null; tex = null;
}
```
- In `init()`, right after `glCanvas = document.createElement("canvas");`, add:

```ts
  glCanvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); resetBoilGL(); }, false);
```
(On loss the surface is dropped; the next `boilBegin` makes a fresh context, or returns false → that frame composites un-boiled. No throw.)

- [ ] **Step 3: Pass weight from the renderer**

In `src/anim/render.ts`, the boil drawing-layer loop currently calls:

```ts
      boilLayer(cell.canvas, op.opacity / 100, crisp ? 0 : boil.amount * strength, boil.cols, seed);
```

Change it to pass weight (crisp layers get 0 weight too):

```ts
      boilLayer(cell.canvas, op.opacity / 100, crisp ? 0 : boil.amount * strength, boil.cols, crisp ? 0 : boil.weight * strength, seed);
```

- [ ] **Step 4: Build + tests**

Run: `npm run build` → GREEN, 0 warnings.
Run: `npm test` → all green (Task 1's seed tests still pass).

- [ ] **Step 5: Manual verification** (`npm run dev`, and iPad via `npm run dev:lan`)

1. Enable boil, **Holds only off**, play: every drawing layer wobbles (its own phase), no skipping; the **weight** slider visibly fattens/thins the lines as it breathes (0 = none, 1 = obvious).
2. Multiple layers boil in correct z-order at their opacities.
3. Confirm on iPad Safari + Chrome and macOS Chrome + Safari (the four the spike was validated on).

- [ ] **Step 6: Commit**

```bash
git add src/core/boil-gl.ts src/anim/render.ts
git commit -m "feat: in-shader boil line-weight + WebGL context-loss recovery"
```

---

### Task 4: boil in export

**Files:**
- Modify: `src/export/video.ts`, `src/export/png-sequence.ts`

- [ ] **Step 1: Pass boil into the export render**

In `src/export/video.ts`, the per-frame render is:
```ts
    renderFrame(ctx, project, f, dpr, { drawBg: true, includeReference: false });
```
Change to:
```ts
    renderFrame(ctx, project, f, dpr, { drawBg: true, includeReference: false, boil: project.boil.enabled ? project.boil : undefined });
```

Make the identical change in `src/export/png-sequence.ts` (its `renderFrame(...)` call).

- [ ] **Step 2: Build + tests**

Run: `npm run build` → GREEN.
Run: `npm test` → all green.

- [ ] **Step 3: Manual verification**

Enable boil, export a short MP4 (or PNG sequence) → the output frames are boiled and match playback (deterministic by frame). Disable boil → export is un-boiled.

- [ ] **Step 4: Commit**

```bash
git add src/export/video.ts src/export/png-sequence.ts
git commit -m "feat: include line boil in MP4/PNG export"
```

---

### Task 5: remove the dead CPU mesh warp + final pass

**Files:**
- Delete: `src/core/boil.ts`

- [ ] **Step 1: Confirm it's unused, then delete**

Run: `grep -rn "core/boil\"\|from \"../core/boil\"\|drawBoiled\b" src` — expected: only `boil-gl` matches, NOTHING importing `../core/boil` (the CPU warp). If anything still imports `src/core/boil.ts`, stop and report.

Then:
```bash
git rm src/core/boil.ts
```

- [ ] **Step 2: Build + tests**

Run: `npm run build` → GREEN, 0 warnings.
Run: `npm test` → all green.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove dead CPU mesh-warp boil renderer (replaced by WebGL)"
```

---

## Final verification

- [ ] `npm test` → all green (Task 1's seed tests + Task 2's config/migration tests).
- [ ] `npm run build` → svelte-check + tsc + vite green, 0 warnings.
- [ ] Manual cross-platform: boil renders all layers, weight breathes, holds-only works, export matches preview, on macOS (Chrome+Safari) and iPad (Safari+Chrome).

---

## Self-Review (completed by plan author)

**Spec coverage:**
- One GL surface, single blit (already in the spike) — Tasks 3 keeps it; verified manual. ✓
- Cross-GPU noise (highp + bounded seed) → Task 1 extracts + tests it. ✓
- Weight = in-shader dilate/erode → Task 3. ✓
- `scale`→`weight` rename + migration + UI relabel `grid`→`detail` → Task 2. ✓
- Export includes boil (deterministic) → Task 4. ✓
- Context-loss handling → Task 3. ✓
- Delete CPU warp `boil.ts` → Task 5. ✓
- Reference-below z-order: already the spike's behaviour (kept; spec scopes proper interleave out). ✓

**Deferred (noted, not in this plan):** the per-layer **boilStrength UI** control — the model field + renderer support already exist (Phase 1), only a slider is missing; low value, easy follow-up. The `cols` field is kept (UI relabeled "detail") to avoid an extra rename+migration.

**Type/name consistency:** `boilSeedOffset(seed): [number, number]`, `BoilConfig.weight`, `migrateBoil(raw): BoilConfig`, `boilLayer(src, opacity, amount, freq, weight, seed)`, `resetBoilGL()` — referenced consistently; the renderer call in Task 3 matches the new `boilLayer` signature; the migration falls weight back to the default for old `scale` saves.

**Risk:** the weight shader rescales rgb by `a/a0` to stay premultiplied; at `a0 = 0` it leaves rgb as-is (already 0). The `0.12` edge-push constant is conservative; tune during manual verification if weight reads too weak/strong.
