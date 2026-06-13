# Plan 7 — Persistence (save/load + autosave) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save and load a project as a `.zip` bundle (drawings + settings), and autosave to IndexedDB so work survives a page refresh.

**Architecture:** A pure `projectToJson` serializes the drawing-layer/timeline structure (cells as `"key"`/`"hold"`); `saveProjectBlob` zips `project.json` plus one PNG per key cell (via `fflate`). `loadProjectBlob` unzips, decodes each PNG back into a DPR-correct cell canvas, and reseeds the layer-id counter. Autosave debounces a save into IndexedDB on document changes and restores it on startup. Reference layers are **not** persisted in this MVP (see scope note).

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest, `fflate` (zip), IndexedDB (no extra dependency).

> ⚠️ **SCOPE NOTE — reference layers are NOT persisted in this plan.** The spec's bundle mentions "embedded reference media", but video/image embedding is heavy and references are transient trace material. This plan saves/loads **drawing layers + project settings only**; reference layers are dropped on save and absent on load (re-import them per session). Persisting reference media is a clean follow-up.

> ⚠️ **VERIFICATION NOTE:** the pure logic (`projectToJson`, `frameAssetPath`, `setMinLayerId`) is unit-tested. The **zip pack/unpack, PNG decode, and IndexedDB I/O are browser-only** and NOT unit-testable — those tasks' gate is type-check/build/no-regression plus **human** verification (save, refresh, reload).

**Builds on Plans 1–6 (on `main`).** Relevant existing code:
- `src/anim/document.ts`: `Project`, `DrawingLayer`, `Cell`, `isDrawingLayer`, `createCellCanvas(w,h,dpr)`, `createProject()`, module `let nextLayerId = 1` (used by `createDrawingLayer`/`createReferenceLayer`).
- `src/state/appState.svelte.ts`: `state`, `DPR`, `bump()`, `isDrawingLayer`/`Project` already imported.
- `src/export/download.ts`: `downloadBlob(blob, filename)`.
- `src/lib/Toolbar.svelte`: has a hidden `<input type=file>` + `pick(kind)`/`onFile()` for Add Image/Video.
- `fflate` exports `zipSync`, `unzipSync`, `strToU8`, `strFromU8`.
- tsconfig: `erasableSyntaxOnly`, `noUnusedLocals`.

---

## File Structure

```
src/
  anim/document.ts          ← MODIFY: setMinLayerId(n) to reseed ids on load
  persist/
    project-file.ts         ← NEW: ProjectJson types, projectToJson + frameAssetPath (pure),
                              saveProjectBlob / loadProjectBlob (integration)
    autosave.ts             ← NEW: IndexedDB get/put/delete + saveAutosave / loadAutosave / clearAutosave
  state/appState.svelte.ts  ← MODIFY: replaceProject(project)
  lib/Toolbar.svelte        ← MODIFY: Save / Open / New buttons (reuse the file input)
  App.svelte                ← MODIFY: restore autosave on mount + debounced autosave on change
  __tests__/persist.test.ts ← NEW (projectToJson, frameAssetPath, setMinLayerId)
```

---

## Task 1: Reseed layer ids on load (`setMinLayerId`)

**Files:**
- Modify: `src/anim/document.ts`
- Test: `src/__tests__/persist.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/persist.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { setMinLayerId, createDrawingLayer } from "../anim/document";

describe("setMinLayerId", () => {
  it("ensures subsequent created layers get ids at or above the floor", () => {
    setMinLayerId(500);
    expect(createDrawingLayer(1).id).toBeGreaterThanOrEqual(500);
  });
  it("never lowers the counter", () => {
    setMinLayerId(500);
    const a = createDrawingLayer(1).id;
    setMinLayerId(10); // below current — must be ignored
    const b = createDrawingLayer(1).id;
    expect(b).toBeGreaterThan(a);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- persist`
Expected: FAIL — `setMinLayerId` not exported.

- [ ] **Step 3: Implement**

In `src/anim/document.ts`, immediately after the `let nextLayerId = 1;` line, add:
```ts
/** Raise the layer-id counter so future ids don't collide with a loaded project's ids. */
export function setMinLayerId(n: number): void {
  if (n > nextLayerId) nextLayerId = n;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- persist` — PASS. `npm run check` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/anim/document.ts src/__tests__/persist.test.ts
git commit -m "feat(persist): setMinLayerId to reseed ids on project load"
```

---

## Task 2: Project JSON serialization (pure)

**Files:**
- Create: `src/persist/project-file.ts`
- Test: `src/__tests__/persist.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/__tests__/persist.test.ts`:
```ts
import { projectToJson, frameAssetPath } from "../persist/project-file";
import type { Project, Cell, DrawingLayer, ReferenceLayer } from "../anim/document";

function key(): Cell { return { kind: "key", canvas: {} as HTMLCanvasElement }; }
function hold(): Cell { return { kind: "hold" }; }
function dlayer(id: number, cells: Cell[]): DrawingLayer {
  return { kind: "draw", id, name: `L${id}`, visible: true, locked: false, opacity: 100, cells };
}
function rlayer(id: number): ReferenceLayer {
  return { kind: "ref", id, name: `R${id}`, visible: true, opacity: 60, offsetFrames: 0,
    media: { type: "image", el: {} as HTMLImageElement } };
}

describe("projectToJson", () => {
  it("serializes settings and drawing layers (cells as key/hold), excluding reference layers", () => {
    const p: Project = {
      width: 800, height: 600, fps: 8, bgColor: "#eee", frameCount: 2,
      layers: [dlayer(1, [key(), hold()]), rlayer(2)],
    };
    expect(projectToJson(p)).toEqual({
      version: 1,
      width: 800, height: 600, fps: 8, bgColor: "#eee", frameCount: 2,
      layers: [
        { id: 1, name: "L1", visible: true, locked: false, opacity: 100, cells: ["key", "hold"] },
      ],
    });
  });
});

describe("frameAssetPath", () => {
  it("builds frames/<layerId>/<frameIndex>.png", () => {
    expect(frameAssetPath(2, 5)).toBe("frames/2/5.png");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- persist`
Expected: FAIL — cannot find module `../persist/project-file`.

- [ ] **Step 3: Implement (pure part only)**

Create `src/persist/project-file.ts`:
```ts
import { isDrawingLayer, type Project } from "../anim/document";

export interface DrawingLayerJson {
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  cells: ("key" | "hold")[];
}

export interface ProjectJson {
  version: 1;
  width: number;
  height: number;
  fps: number;
  bgColor: string;
  frameCount: number;
  layers: DrawingLayerJson[];
}

/** Serialize the project structure (drawing layers only) — no pixel data, no reference layers. */
export function projectToJson(project: Project): ProjectJson {
  return {
    version: 1,
    width: project.width,
    height: project.height,
    fps: project.fps,
    bgColor: project.bgColor,
    frameCount: project.frameCount,
    layers: project.layers.filter(isDrawingLayer).map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      locked: l.locked,
      opacity: l.opacity,
      cells: l.cells.map((c) => c.kind),
    })),
  };
}

/** Path inside the zip for a key cell's PNG. */
export function frameAssetPath(layerId: number, frameIndex: number): string {
  return `frames/${layerId}/${frameIndex}.png`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- persist` — PASS. `npm run check` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/persist/project-file.ts src/__tests__/persist.test.ts
git commit -m "feat(persist): projectToJson + frameAssetPath (pure serialization)"
```

---

## Task 3: Save/load the zip bundle + replaceProject

**Files:**
- Modify: `src/persist/project-file.ts`, `src/state/appState.svelte.ts`

Integration (zip, canvas.toBlob, PNG decode) — no unit tests; verified by build + manual.

- [ ] **Step 1: Add save/load to `project-file.ts`**

Append to `src/persist/project-file.ts`:
```ts
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { createCellCanvas, setMinLayerId, type Cell, type DrawingLayer } from "../anim/document";

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(async (b) => {
      if (!b) return reject(new Error("toBlob failed"));
      resolve(new Uint8Array(await b.arrayBuffer()));
    }, "image/png")
  );
}

function decodePng(bytes: Uint8Array): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("png decode failed")); };
    img.src = url;
  });
}

/** Zip the project: `project.json` + one PNG per key cell. Reference layers are not saved. */
export async function saveProjectBlob(project: Project): Promise<Blob> {
  const files: Record<string, Uint8Array> = {
    "project.json": strToU8(JSON.stringify(projectToJson(project))),
  };
  for (const layer of project.layers) {
    if (!isDrawingLayer(layer)) continue;
    for (let i = 0; i < layer.cells.length; i++) {
      const cell = layer.cells[i];
      if (cell.kind !== "key") continue;
      files[frameAssetPath(layer.id, i)] = await canvasToPngBytes(cell.canvas);
    }
  }
  return new Blob([zipSync(files)], { type: "application/zip" });
}

/** Rebuild a Project from a saved zip. `dpr` sizes the rebuilt cell canvases for the current display. */
export async function loadProjectBlob(blob: Blob, dpr: number): Promise<Project> {
  const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const json = JSON.parse(strFromU8(zip["project.json"])) as ProjectJson;

  let maxId = 0;
  const layers: DrawingLayer[] = [];
  for (const lj of json.layers) {
    maxId = Math.max(maxId, lj.id);
    const cells: Cell[] = [];
    for (let i = 0; i < lj.cells.length; i++) {
      if (lj.cells[i] === "hold") { cells.push({ kind: "hold" }); continue; }
      const canvas = createCellCanvas(json.width, json.height, dpr);
      const bytes = zip[frameAssetPath(lj.id, i)];
      if (bytes) {
        const img = await decodePng(bytes);
        const ctx = canvas.getContext("2d")!;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      cells.push({ kind: "key", canvas });
    }
    layers.push({
      kind: "draw", id: lj.id, name: lj.name, visible: lj.visible,
      locked: lj.locked, opacity: lj.opacity, cells,
    });
  }
  setMinLayerId(maxId + 1);
  return {
    width: json.width, height: json.height, fps: json.fps,
    bgColor: json.bgColor, frameCount: json.frameCount, layers,
  };
}
```

- [ ] **Step 2: Add `replaceProject` to app state**

In `src/state/appState.svelte.ts`, after `export function removeLayer(id: number) { … }`, add:
```ts
/** Replace the whole document (e.g. after Open or autosave restore). */
export function replaceProject(project: Project) {
  state.project = project;
  state.playhead = 0;
  const firstDrawing = project.layers.find(isDrawingLayer) ?? project.layers[0];
  state.activeLayerId = firstDrawing.id;
  bump();
}
```
(`isDrawingLayer`, `bump`, and `type Project` are already imported/defined in this file.)

- [ ] **Step 3: Verify**

Run: `npm run check` — 0 errors (fflate `unzipSync`/`strFromU8` typed; `replaceProject` resolves). `npm test` — all pass (no new unit tests). `npx vite build` — succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/persist/project-file.ts src/state/appState.svelte.ts
git commit -m "feat(persist): save/load project zip + replaceProject"
```

---

## Task 4: IndexedDB autosave store

**Files:**
- Create: `src/persist/autosave.ts`

Integration (IndexedDB) — no unit tests; verified by build + manual.

- [ ] **Step 1: Create `src/persist/autosave.ts`**

```ts
import { saveProjectBlob, loadProjectBlob } from "./project-file";
import type { Project } from "../anim/document";

const DB_NAME = "slop-animator";
const STORE = "kv";
const KEY = "autosave";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbDo<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) =>
    new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    })
  );
}

/** Serialize and store the project as the single autosave slot. */
export async function saveAutosave(project: Project): Promise<void> {
  const blob = await saveProjectBlob(project);
  await idbDo("readwrite", (s) => s.put(blob, KEY));
}

/** Restore the autosaved project, or null if none. */
export async function loadAutosave(dpr: number): Promise<Project | null> {
  const blob = await idbDo<Blob | undefined>("readonly", (s) => s.get(KEY));
  return blob ? loadProjectBlob(blob, dpr) : null;
}

/** Forget the autosave (used by "New"). */
export async function clearAutosave(): Promise<void> {
  await idbDo("readwrite", (s) => s.delete(KEY));
}
```

- [ ] **Step 2: Verify**

Run: `npm run check` — 0 errors. `npm test` — all pass. `npx vite build` — succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/persist/autosave.ts
git commit -m "feat(persist): IndexedDB autosave store"
```

---

## Task 5: Save/Open/New UI + autosave wiring; verification

**Files:**
- Modify: `src/lib/Toolbar.svelte`, `src/App.svelte`

- [ ] **Step 1: Add Save / Open / New to the toolbar**

Read `src/lib/Toolbar.svelte`. It has a `<script>` importing from appState + `loadImageLayer`/`loadVideoLayer`, a `fileInput`, `pendingKind: "image" | "video"`, `pick()`, `onFile()`. Update the `<script>` to add the persistence imports, widen `pendingKind`, and handle project files. Replace the existing `import { loadImageLayer, loadVideoLayer } from "../anim/reference";` line and the `pendingKind`/`onFile` definitions:

Add imports after the existing reference import:
```ts
  import { addLayerToProject, replaceProject } from "../state/appState.svelte";
  import { saveProjectBlob, loadProjectBlob } from "../persist/project-file";
  import { clearAutosave } from "../persist/autosave";
  import { downloadBlob } from "../export/download";
  import { createProject } from "../anim/document";
  import { DPR } from "../state/appState.svelte";
```
Change `let pendingKind: "image" | "video" = "image";` to:
```ts
  let pendingKind: "image" | "video" | "project" = "image";
```
Change `pick` so the project accept differs:
```ts
  function pick(kind: "image" | "video" | "project") {
    pendingKind = kind;
    fileInput.accept = kind === "image" ? "image/*" : kind === "video" ? "video/*" : ".zip,application/zip";
    fileInput.value = "";
    fileInput.click();
  }
```
Replace `onFile` with:
```ts
  async function onFile() {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (pendingKind === "project") {
      replaceProject(await loadProjectBlob(file, DPR));
      return;
    }
    const layer = pendingKind === "image"
      ? await loadImageLayer(file)
      : await loadVideoLayer(file, () => bump());
    addLayerToProject(layer);
  }

  async function saveProject() {
    downloadBlob(await saveProjectBlob(state.project), "project.zip");
  }

  async function newProject() {
    replaceProject(createProject());
    await clearAutosave();
  }
```
(NOTE: `state`, `history`, `bump` are already imported in the existing Toolbar script — keep them. If `bump` is not currently imported, add it to the appState import.)

Then in the markup, after the `Export` button line (`<button onclick={() => (state.exportOpen = true)}>Export</button>`), add:
```svelte
  <span class="w-px h-5 bg-neutral-300 mx-1"></span>
  <button onclick={saveProject}>Save</button>
  <button onclick={() => pick("project")}>Open</button>
  <button onclick={newProject}>New</button>
```

- [ ] **Step 2: Restore autosave on mount + debounced autosave in `App.svelte`**

In `src/App.svelte`, add imports next to the existing ones:
```ts
  import { onMount } from "svelte";
  import { DPR, replaceProject } from "./state/appState.svelte";
  import { loadAutosave, saveAutosave } from "./persist/autosave";
```
(`state`, etc. are already imported — merge `DPR, replaceProject` into the existing appState import line rather than duplicating it.)
Then, inside the `<script>` (top level, after the existing `onKey` function), add:
```ts
  onMount(async () => {
    const restored = await loadAutosave(DPR);
    if (restored) replaceProject(restored);
  });

  let autosaveTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    state.version; // re-run whenever the document changes
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { void saveAutosave(state.project); }, 3000);
  });
```

- [ ] **Step 3: Automated verification (Definition of Done — run all, paste real output)**

1. `npm run check` — 0 errors.
2. `npm test` — all pass (65 + persist tests; the gate is all-green). Paste the `Tests` line.
3. `npx vite build` — successful production build.
4. Dev boot (headless): `npm run dev` short timeout — `Local:` URL, no compile/runtime errors, stop.

Do NOT claim save/load/refresh actually works — that's the human's manual step.

- [ ] **Step 4: Commit**

```bash
git add src/lib/Toolbar.svelte src/App.svelte
git commit -m "feat(ui): Save/Open/New project + autosave restore"
```

- [ ] **Step 5: Manual verification checklist (HUMAN — required; no browser automation here)**

Run `npm run dev`:
1. **Save/Open**: draw a few frames across 2 layers → "Save" → `project.zip` downloads. Click "New" (canvas clears) → "Open" → pick the zip → the drawing, layers, frame count, and fps come back.
2. **Autosave/refresh**: draw something, wait ~4 s, **refresh the page** → your work is restored automatically (from IndexedDB).
3. **New**: "New" clears to a blank single-layer project and forgets the autosave (refresh stays blank).
4. **Reference caveat**: add an image reference, Save, New, Open → the drawing returns but the reference does NOT (references aren't persisted in this version — re-import them).
5. **No regression**: drawing, onion, playback, fill, selection, export all still work.

---

## Self-Review (completed during planning)

**Spec coverage (spec §7 persistence — ".zip bundle (project.json + frame PNGs + reference media) + IndexedDB autosave"):** `.zip` with `project.json` + per-key-cell PNGs (Tasks 2–3); IndexedDB autosave + restore-on-startup (Tasks 4–5); Save/Open/New UI (Task 5). **Deviation (flagged):** reference media is NOT embedded — drawing layers + settings only. This is a deliberate MVP scope cut (heavy video bytes; references are transient); persisting reference media is a noted follow-up.

**Placeholder scan:** none — every step has complete code and an exact command + expected result.

**Type consistency:** `ProjectJson`/`DrawingLayerJson`, `projectToJson`, `frameAssetPath`, `saveProjectBlob`, `loadProjectBlob` defined in Tasks 2–3 and consumed by autosave (Task 4) + Toolbar (Task 5). `setMinLayerId` (Task 1) used by `loadProjectBlob` (Task 3). `replaceProject` (Task 3) used by Toolbar Open/New + App restore (Task 5). `saveAutosave`/`loadAutosave`/`clearAutosave` (Task 4) used in Task 5. `DPR` threads from appState into `loadProjectBlob`/`loadAutosave`.

**Risks / known limitations (flagged):**
- **Reference layers not persisted** (deliberate scope cut) — re-import per session.
- **Autosave re-renders all key cells to PNG every change (debounced 3 s)** — fine for small projects; large projects could make autosave heavy. A per-cell incremental store is a future optimization.
- **Auto-restore on startup** means the app always reopens the last session; "New" clears it. No multi-document management (single autosave slot).
- **DPR change between save and load** is handled by rescaling the saved PNG to the current cell resolution (slight quality change if DPR differs).
- **Save/load/IndexedDB are browser-only** — manual verification required.
