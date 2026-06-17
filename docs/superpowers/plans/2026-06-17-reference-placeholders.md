# Reference Layer Placeholders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist reference layers as metadata-only placeholders (no bytes) — name, type, opacity, visibility, video offset, transform, z-order — that survive reload and export, and can be re-linked to restore the media.

**Architecture:** A `missing` variant of `ReferenceMedia` represents a placeholder; `mediaIntrinsicSize` returns `{0,0}` for it, so the compositor/gizmo/onStroke/video-sync skip it via their existing zero-size guards (no edits there). Persistence serializes references with their stack index (z-order) into the project JSON, reconstructed on load by index-splicing. A `relinkReference` action + a LayerList re-link picker swap real media back in.

**Tech Stack:** TypeScript, Svelte 5, Vitest (Node — no canvas/DOM), fflate.

**Spec:** `docs/superpowers/specs/2026-06-17-reference-placeholders-design.md`

**Branch:** execute on a new branch `reference-placeholders` (off `main`).

**Key constraints (verified):**
- Widening `ReferenceMedia` with a `missing` variant does NOT break existing `{type:"image"|"video", el}` literals in tests.
- The `{0,0}`-for-missing trick means `render.ts` (both ref draws), `RefTransformGizmo`, `Canvas` onStroke, and `syncReferenceVideos` need **no changes** — their existing `size.w===0`/`!== "video"` guards already skip placeholders.
- `projectToJson` currently emits drawing layers only and no `references`; adding `references` will make the existing `projectToJson` test fail until its expected object is updated (TDD driver).
- Reference layers sit outside structural undo (like today); `relinkReference` is a direct mutation + `bump()`, not undoable.

---

### Task 1: `missing` media variant + `mediaIntrinsicSize`

**Files:**
- Modify: `src/anim/document.ts`
- Test: `src/__tests__/document.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/__tests__/document.test.ts`, ensure `mediaIntrinsicSize` is imported from `../anim/document` (add if missing), then append:

```ts
describe("mediaIntrinsicSize (missing media)", () => {
  it("returns {0,0} for a missing placeholder", () => {
    expect(mediaIntrinsicSize({ type: "missing", was: "image", name: "x.png" })).toEqual({ w: 0, h: 0 });
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run: `npx vitest run src/__tests__/document.test.ts`
Expected: FAIL — either a type error (the `missing` variant doesn't exist yet) or a wrong return (the current `mediaIntrinsicSize` falls through to the video branch and reads `.el`).

- [ ] **Step 3: Implement**

In `src/anim/document.ts`, widen the union:

```ts
export type ReferenceMedia =
  | { type: "image"; el: HTMLImageElement }
  | { type: "video"; el: HTMLVideoElement }
  | { type: "missing"; was: "image" | "video"; name: string };
```

And make `mediaIntrinsicSize` handle it:

```ts
export function mediaIntrinsicSize(media: ReferenceMedia): { w: number; h: number } {
  if (media.type === "image") return { w: media.el.naturalWidth, h: media.el.naturalHeight };
  if (media.type === "video") return { w: media.el.videoWidth, h: media.el.videoHeight };
  return { w: 0, h: 0 }; // missing placeholder — skipped by every zero-size guard
}
```

- [ ] **Step 4: Verify PASS + build**

Run: `npx vitest run src/__tests__/document.test.ts` → PASS.
Run: `npm run build` → 0 errors, 0 warnings. (If any `switch (media.type)` elsewhere becomes non-exhaustive, the build will flag it — there should be none, since the other readers use `if`-guards, but fix any that appear by skipping `missing`.)

- [ ] **Step 5: Commit**

```bash
git add src/anim/document.ts src/__tests__/document.test.ts
git commit -m "feat: missing ReferenceMedia variant (placeholder) + mediaIntrinsicSize 0,0"
```

---

### Task 2: persist references (serialize + load + index splice)

**Files:**
- Modify: `src/persist/project-file.ts`
- Test: `src/__tests__/persist.test.ts`

- [ ] **Step 1: Update/extend the tests (TDD)**

In `src/__tests__/persist.test.ts`:

(a) Add `references` to the existing `projectToJson` test's expected object. That test builds `p` with `layers: [dlayer(1, [key(), hold()]), rlayer(2)]` (the `rlayer` helper has `media:{type:"image",…}`, `offsetFrames:0`, `transform:{dx:0,dy:0,scale:1,rotation:0}`). Add to the `toEqual({...})`:

```ts
      references: [
        { index: 1, id: 2, name: "R2", visible: true, opacity: 60, offsetFrames: 0, was: "image",
          transform: { dx: 0, dy: 0, scale: 1, rotation: 0 } },
      ],
```

(b) Add a describe block for the pure splice helper:

```ts
import { insertReferencesByIndex } from "../persist/project-file";

describe("insertReferencesByIndex", () => {
  it("splices a reference into the middle", () => {
    expect(insertReferencesByIndex(["a", "b", "c"], [{ index: 1, value: "R" }])).toEqual(["a", "R", "b", "c"]);
  });
  it("reconstructs interleaved order (ascending index)", () => {
    // original [R,a,R,b] → drawing-only ["a","b"], refs at 0 and 2
    expect(insertReferencesByIndex(["a", "b"], [{ index: 2, value: "R2" }, { index: 0, value: "R0" }]))
      .toEqual(["R0", "a", "R2", "b"]);
  });
  it("clamps an out-of-range index to the end", () => {
    expect(insertReferencesByIndex(["a"], [{ index: 9, value: "R" }])).toEqual(["a", "R"]);
  });
});
```

Run: `npx vitest run src/__tests__/persist.test.ts` → FAIL (`references` missing from output; `insertReferencesByIndex` not exported).

- [ ] **Step 2: Implement in `src/persist/project-file.ts`**

(a) Add to the imports from `../anim/document`: `type ReferenceLayer, type RefTransform, type Layer`.

(b) Add the `ReferenceJson` interface and the pure helper:

```ts
export interface ReferenceJson {
  index: number;            // position in the full project.layers stack (z-order)
  id: number;
  name: string;
  visible: boolean;
  opacity: number;
  offsetFrames: number;
  was: "image" | "video";
  transform: RefTransform;
}

/** Splice `refs` (by their stack index, ascending) into `base`. Pure; reconstructs the original
 *  interleaving of references among the drawing layers. */
export function insertReferencesByIndex<T>(base: T[], refs: { index: number; value: T }[]): T[] {
  const out = base.slice();
  for (const r of refs.slice().sort((a, b) => a.index - b.index)) {
    out.splice(Math.min(r.index, out.length), 0, r.value);
  }
  return out;
}
```

(c) Add `references: ReferenceJson[]` to `ProjectJson`.

(d) In `projectToJson`, add to the returned object:

```ts
    references: project.layers
      .map((l, index) => ({ l, index }))
      .filter((e): e is { l: ReferenceLayer; index: number } => e.l.kind === "ref")
      .map(({ l, index }) => ({
        index, id: l.id, name: l.name, visible: l.visible, opacity: l.opacity,
        offsetFrames: l.offsetFrames,
        was: l.media.type === "missing" ? l.media.was : l.media.type,
        transform: l.transform,
      })),
```

(e) In `loadProjectBlob`, after the drawing-layer loop builds `layers` and before `setMinLayerId(maxId + 1)`, build placeholders, fold their ids into `maxId`, and splice them in. Replace the `const project: Project = { … layers, audio: null }` so `layers` is the spliced result:

```ts
  const refsJson = json.references ?? [];
  for (const rj of refsJson) maxId = Math.max(maxId, rj.id);
  const refLayers = refsJson.map((rj) => ({
    index: rj.index,
    value: {
      kind: "ref", id: rj.id, name: rj.name, visible: rj.visible, opacity: rj.opacity,
      offsetFrames: rj.offsetFrames, transform: rj.transform,
      media: { type: "missing", was: rj.was, name: rj.name },
    } as ReferenceLayer,
  }));
  const orderedLayers = insertReferencesByIndex<Layer>(layers, refLayers);
  setMinLayerId(maxId + 1);
  const project: Project = {
    width: json.width, height: json.height, fps: json.fps,
    bgColor: json.bgColor, frameCount: json.frameCount, boil: migrateBoil(json.boil),
    layers: orderedLayers,
    audio: null,
  };
```

(`json.references` is optional → old saves yield `[]`. `refreshLength` and the audio block below are unchanged.)

- [ ] **Step 3: Verify PASS + build + full suite**

Run: `npx vitest run src/__tests__/persist.test.ts` → PASS.
Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass.

- [ ] **Step 4: Commit**

```bash
git add src/persist/project-file.ts src/__tests__/persist.test.ts
git commit -m "feat: persist reference layers as placeholders (metadata + z-order)"
```

---

### Task 3: media loaders + `relinkReference`

**Files:**
- Modify: `src/anim/reference.ts` (add media loaders)
- Modify: `src/state/appState.svelte.ts` (`relinkReference`)

No unit test (DOM/store). Verification = build + Task 4 manual.

- [ ] **Step 1: Media loaders in `src/anim/reference.ts`**

Add functions that load just the media element (returning `ReferenceMedia`), and refactor the existing layer loaders to reuse them:

```ts
import { createReferenceLayer, type ReferenceLayer, type ReferenceMedia, type Project } from "./document";

export function loadImageMedia(file: File): Promise<ReferenceMedia> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve({ type: "image", el });
    el.onerror = () => reject(new Error(`Failed to load image: ${file.name}`));
    el.src = URL.createObjectURL(file);
  });
}

export function loadVideoMedia(file: File, onSeeked: () => void): Promise<ReferenceMedia> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("video");
    el.muted = true;
    el.preload = "auto";
    el.playsInline = true;
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("loadeddata", () => resolve({ type: "video", el }), { once: true });
    el.addEventListener("error", () => reject(new Error(`Failed to load video: ${file.name}`)), { once: true });
    el.src = URL.createObjectURL(file);
  });
}

/** Load reference media of either kind, chosen by the file's MIME type (video/* → video, else image). */
export async function loadReferenceMedia(file: File, onSeeked: () => void): Promise<ReferenceMedia> {
  return file.type.startsWith("video") ? loadVideoMedia(file, onSeeked) : loadImageMedia(file);
}
```

Then rewrite `loadImageLayer`/`loadVideoLayer` to delegate (keeping their existing signatures and `createReferenceLayer(media, file.name)` wrap):

```ts
export async function loadImageLayer(file: File): Promise<ReferenceLayer> {
  return createReferenceLayer(await loadImageMedia(file), file.name);
}
export async function loadVideoLayer(file: File, onSeeked: () => void): Promise<ReferenceLayer> {
  return createReferenceLayer(await loadVideoMedia(file, onSeeked), file.name);
}
```

(`syncReferenceVideos` stays as-is.)

- [ ] **Step 2: `relinkReference` in `src/state/appState.svelte.ts`**

Add (near `renameLayer`/the other layer mutations):

```ts
import type { ReferenceMedia } from "../anim/document"; // add to the existing ../anim/document import

/** Replace a reference layer's media (e.g. re-linking a persisted placeholder), keeping its
 *  name/opacity/visibility/offset/transform. Not undoable. */
export function relinkReference(id: number, media: ReferenceMedia) {
  const layer = state.project.layers.find((l) => l.id === id);
  if (layer && layer.kind === "ref") { layer.media = media; bump(); }
}
```

- [ ] **Step 3: Build + tests**

Run: `npm run build` → 0 errors, 0 warnings.
Run: `npm test` → all pass (the `loadImageLayer`/`loadVideoLayer` refactor preserves their behavior; reference tests, if any, unaffected).

- [ ] **Step 4: Commit**

```bash
git add src/anim/reference.ts src/state/appState.svelte.ts
git commit -m "feat: reference media loaders + relinkReference action"
```

---

### Task 4: LayerList placeholder UI + re-link picker

**Files:**
- Modify: `src/lib/LayerList.svelte`

No automated test. Verification = build + manual.

- [ ] **Step 1: Imports + re-link picker state**

In `src/lib/LayerList.svelte`:
- Add `relinkReference` to the existing `../state/appState.svelte` import.
- Add `import { loadReferenceMedia } from "../anim/reference";`
- Add an icon for re-link to the `@lucide/svelte` import (e.g. `Link` or `Upload`).
- Add component state + handlers. IMPORTANT: `LayerList.svelte` imports the `state` binding, which collides with the `$state` rune — this file uses **plain `let`** (legacy reactive mode), the same as its existing `editingId`/`draft`. Do NOT use `$state(...)` here:

```ts
  let relinkInput: HTMLInputElement;
  let relinkTargetId: number | null = null; // plain let — legacy reactive, $state would misparse (state import)

  function startRelink(id: number) {
    relinkTargetId = id;
    relinkInput.value = "";
    relinkInput.click();
  }
  async function onRelinkFile() {
    const file = relinkInput.files?.[0];
    const id = relinkTargetId;
    if (!file || id == null) return;
    relinkReference(id, await loadReferenceMedia(file, () => bump()));
  }
```

Add a hidden input once in the markup (e.g. near the list root):

```svelte
<input bind:this={relinkInput} type="file" accept="image/*,video/*" class="hidden" onchange={onRelinkFile} />
```

- [ ] **Step 2: Placeholder badge + re-link button in the ref row**

The current badge line is:

```svelte
        {#if layer.kind === "ref"}
          <span class="text-[9px] px-1 rounded bg-surface-active text-text-muted uppercase">{layer.media.type}</span>
        {/if}
```

Replace it so a `missing` placeholder shows its original kind + a re-link affordance, and a live ref shows its kind as before:

```svelte
        {#if layer.kind === "ref"}
          {#if layer.media.type === "missing"}
            <span class="text-[9px] px-1 rounded bg-surface-active text-text-muted uppercase">{layer.media.was}?</span>
            <button class="text-text-muted hover:text-text-secondary" title="Re-link media"
                    onclick={(e) => { e.stopPropagation(); startRelink(layer.id); }}><Link size={13} /></button>
          {:else}
            <span class="text-[9px] px-1 rounded bg-surface-active text-text-muted uppercase">{layer.media.type}</span>
          {/if}
        {/if}
```

(The video time-offset input at the bottom of the row already guards `layer.media.type === "video"`, so it correctly hides for a `missing` placeholder and reappears once re-linked to a video. The `was + "?"` badge signals "missing, was a VID/IMG".)

- [ ] **Step 3: Build**

Run: `npm run build` → 0 errors, 0 warnings (the new locals are plain `let`, matching the file's legacy-reactive style — see Step 1).
Run: `npm test` → all pass, unchanged.

- [ ] **Step 4: Manual verification (browser)**

Run `npm run dev`:
- Import an image + a video reference; move/scale/rotate them; set a video offset; reorder them among drawing layers. Reload → both reappear as placeholders at the correct stack positions with name/opacity/visibility intact; the canvas shows nothing for them; the rows show `IMG?`/`VID?` + a re-link button.
- Re-link the image placeholder (pick an image) → it loads; its preserved transform applies immediately; the gizmo works.
- Re-link the video placeholder (pick a video) → loads; the video time-offset input reappears with the preserved offset and re-seeks.
- Export the project, open it fresh → placeholders present; re-link works.
- A reference-free project and an old save (no `references` field) both load unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/LayerList.svelte
git commit -m "feat: reference placeholder badge + re-link picker in LayerList"
```

---

## Final verification

- [ ] `npm run build` → 0 errors, 0 warnings.
- [ ] `npm test` → all pass (baseline + new pure tests).
- [ ] Manual checklist in Task 4 Step 4 confirmed (persist→reload→re-link, z-order, export).

## Self-Review (completed by plan author)

**Spec coverage:**
- `missing` variant + `mediaIntrinsicSize {0,0}` (so render/gizmo/onStroke/sync skip placeholders) → Task 1. ✅
- Persist references (metadata + z-order via index) in `projectToJson`, rebuild on load → Task 2 (with pure `insertReferencesByIndex` tested). ✅
- Media loaders + `relinkReference` → Task 3. ✅
- Placeholder badge + re-link picker; transform/offset preserved and re-applied → Task 4. ✅
- Both channels (projectToJson → autosave + export), render-nothing, allow-any-file → respected. ✅
- Out of scope (bytes / auto-restore / canvas indicator) absent. ✅

**Placeholder scan:** No TBD/TODO; complete code in every step. ✅

**Type consistency:** `ReferenceMedia` `missing` variant (Task 1) used by persistence load (Task 2), `relinkReference` (Task 3), and LayerList (Task 4). `ReferenceJson`/`insertReferencesByIndex` (Task 2) consistent across `projectToJson`/`loadProjectBlob`/tests. `loadReferenceMedia` (Task 3) used by LayerList (Task 4). `relinkReference(id, media)` defined Task 3, called Task 4. ✅
