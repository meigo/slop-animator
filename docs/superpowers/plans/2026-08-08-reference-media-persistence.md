# Reference Media Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reference images (always) and videos (per-layer opt-in) survive reloads via a write-once IndexedDB media store, and travel inside the exported project .zip.

**Architecture:** Media blobs are written once at import/relink/toggle time to a new `ref-media` object store (DB version 2) — the 3s autosave debounce never touches them; the autosaved JSON carries only a `mediaId`. `saveProjectBlob` gains an `includeMedia` flag: the file-save path embeds `media/<mediaId>` zip entries at level 0 (images always, videos when `embedMedia`), the autosave path never does. Restore hydrates missing-media placeholders from the zip (file open, which also seeds the store) or from the store (autosave restore). Orphan blobs are pruned only at project-load boundaries.

**Tech Stack:** Svelte 5 runes, TypeScript, fflate (zip), IndexedDB, Vitest (node env — pure logic only).

**Spec:** `docs/superpowers/specs/2026-08-08-reference-media-persistence-design.md`

## Global Constraints

- `npm run build` (svelte-check + tsc + vite build) must pass with **0 errors, 0 warnings** after every task.
- `npm test` must stay green (baseline 345 passing) after every task.
- **Gotcha #8 (CLAUDE.md):** undo snapshots share layer objects. `removeLayer` must NOT delete media-store records; orphan pruning happens ONLY at load boundaries (`replaceProject` callers, New). `relinkReference` mints a NEW mediaId, never overwrites the old record.
- **Gotcha #1:** a component using the `$state` rune must `import { state as appState }`. `Toolbar.svelte` already does; follow whatever each touched file already uses.
- Zip media entries use compression **level 0** (media is already compressed — same as frame PNGs / `audio/track`).
- Zip entry path is `media/<mediaId>` with **no extension**, mime kept in `project.json` — follows the `audio/track` precedent. (The spec says `media/<mediaId>.<ext>`; Task 7 amends the spec to match.)
- `ProjectJson.version` stays `1`: all new fields are optional, old loaders ignore them (spec back-compat).
- One commit per task, `Co-Authored-By: Claude ...` trailer (pre-commit hook reformats — fine).

---

### Task 1: Model fields, JSON round-trip, and pure media-selection helpers

**Files:**
- Modify: `src/anim/document.ts:57-69` (ReferenceLayer)
- Modify: `src/persist/project-file.ts` (ReferenceJson, projectToJson, loadProjectBlob, new pure helpers)
- Test: `src/__tests__/persist.test.ts`

**Interfaces:**
- Consumes: existing `ReferenceLayer`, `ReferenceJson`, `projectToJson`, `loadProjectBlob`.
- Produces (later tasks rely on these exact names):
  - `ReferenceLayer` gains `mediaId?: string; mediaMime?: string; embedMedia?: boolean;`
  - `ReferenceJson` gains the same three optional fields.
  - `export function referencedMediaIds(layers: MediaRefShape[]): Set<string>`
  - `export function mediaIdsToEmbed(layers: MediaRefShape[]): string[]`
  - `export function shouldRestoreMedia(l: MediaRefShape): boolean`
  - `export interface MediaRefShape { kind: string; mediaId?: string; embedMedia?: boolean; media?: { type: string; was?: "image" | "video" }; }` — `media` is OPTIONAL so plain `Layer[]` (drawing layers have no `media`) passes the helpers without casts.

- [ ] **Step 1: Write the failing tests** — append to `src/__tests__/persist.test.ts` (import the three helpers from `../persist/project-file`; `createReferenceLayer` and the `missing` media variant need no DOM):

```ts
describe("reference media persistence fields", () => {
  it("round-trips mediaId/mediaMime/embedMedia through save/load", async () => {
    const project = createProject();
    const ref = createReferenceLayer({ type: "missing", was: "video", name: "clip.mp4" }, "clip");
    ref.mediaId = "abc-123";
    ref.mediaMime = "video/mp4";
    ref.embedMedia = true;
    project.layers.push(ref);
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    const lref = loaded.layers.find((l) => l.kind === "ref")!;
    expect(lref.kind === "ref" && lref.mediaId).toBe("abc-123");
    expect(lref.kind === "ref" && lref.mediaMime).toBe("video/mp4");
    expect(lref.kind === "ref" && lref.embedMedia).toBe(true);
  });

  it("layers without the fields round-trip as undefined (old saves)", async () => {
    const project = createProject();
    project.layers.push(createReferenceLayer({ type: "missing", was: "image", name: "a.png" }));
    const loaded = await loadProjectBlob(await saveProjectBlob(project), 1);
    const lref = loaded.layers.find((l) => l.kind === "ref")!;
    expect(lref.kind === "ref" && lref.mediaId).toBeUndefined();
    expect(lref.kind === "ref" && lref.embedMedia).toBeUndefined();
  });
});

describe("media selection helpers", () => {
  const img = { kind: "ref", mediaId: "i1", media: { type: "image" } };
  const vidOn = { kind: "ref", mediaId: "v1", embedMedia: true, media: { type: "video" } };
  const vidOff = { kind: "ref", mediaId: "v2", media: { type: "video" } };
  const missing = { kind: "ref", mediaId: "m1", media: { type: "missing", was: "image" as const } };
  const noId = { kind: "ref", media: { type: "image" } };
  const draw = { kind: "draw" }; // drawing layers have no media property

  it("referencedMediaIds: every ref with a mediaId, live or missing", () => {
    expect(referencedMediaIds([img, vidOn, vidOff, missing, noId, draw])).toEqual(
      new Set(["i1", "v1", "v2", "m1"]),
    );
  });

  it("mediaIdsToEmbed: live images always, live videos only when embedMedia; never missing", () => {
    expect(mediaIdsToEmbed([img, vidOn, vidOff, missing, noId, draw])).toEqual(["i1", "v1"]);
  });

  it("shouldRestoreMedia: missing + mediaId; videos gated on embedMedia", () => {
    expect(shouldRestoreMedia(missing)).toBe(true);
    expect(shouldRestoreMedia({ ...missing, media: { type: "missing", was: "video" } })).toBe(false);
    expect(
      shouldRestoreMedia({ ...missing, embedMedia: true, media: { type: "missing", was: "video" } }),
    ).toBe(true);
    expect(shouldRestoreMedia(img)).toBe(false); // already live
    expect(shouldRestoreMedia({ kind: "ref", media: { type: "missing", was: "image" } })).toBe(false); // no id
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — `npm test -- persist` — expected: FAIL (helpers not exported; fields dropped by round-trip).

- [ ] **Step 3: Implement.**

In `src/anim/document.ts`, extend `ReferenceLayer` (after `audioEnabled`):

```ts
  mediaId?: string; // key into the ref-media IndexedDB store / media/<id> zip entry; absent = not persisted
  mediaMime?: string; // original file MIME (rebuilds the Blob type on restore)
  embedMedia?: boolean; // video-only opt-in: persist/embed the (potentially huge) video bytes
```

In `src/persist/project-file.ts`:

```ts
export interface MediaRefShape {
  kind: string;
  mediaId?: string;
  embedMedia?: boolean;
  media?: { type: string; was?: "image" | "video" }; // absent on drawing layers
}

/** Every media id the project still references (live or placeholder) — the prune keep-set. */
export function referencedMediaIds(layers: MediaRefShape[]): Set<string> {
  return new Set(
    layers.filter((l) => l.kind === "ref" && l.mediaId).map((l) => l.mediaId as string),
  );
}

/** Ids whose bytes go into the exported zip: live images always, live videos on opt-in. */
export function mediaIdsToEmbed(layers: MediaRefShape[]): string[] {
  return layers
    .filter(
      (l) =>
        l.kind === "ref" &&
        l.mediaId &&
        l.media &&
        l.media.type !== "missing" &&
        (l.media.type === "image" || l.embedMedia === true),
    )
    .map((l) => l.mediaId as string);
}

/** Whether a placeholder should hydrate from stored bytes (videos only on opt-in). */
export function shouldRestoreMedia(l: MediaRefShape): boolean {
  return (
    l.kind === "ref" &&
    !!l.mediaId &&
    l.media?.type === "missing" &&
    (l.media.was !== "video" || l.embedMedia === true)
  );
}
```

`ReferenceJson` gains `mediaId?: string; mediaMime?: string; embedMedia?: boolean;`. In `projectToJson`'s references map add `mediaId: l.mediaId, mediaMime: l.mediaMime, embedMedia: l.embedMedia,`. In `loadProjectBlob`'s `refLayers` construction add `mediaId: rj.mediaId, mediaMime: rj.mediaMime, embedMedia: rj.embedMedia,` to the `ReferenceLayer` literal.

- [ ] **Step 4: Run tests** — `npm test` all green; `npm run build` 0/0.
- [ ] **Step 5: Commit** — `feat: reference media id/mime/embed fields + selection helpers`

---

### Task 2: Shared IndexedDB open (v2) and the ref-media store

**Files:**
- Create: `src/persist/db.ts`
- Create: `src/persist/media-store.ts`
- Modify: `src/persist/autosave.ts` (drop its private `openDb`/`idbDo`, use `db.ts`)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `db.ts`: `export const KV_STORE = "kv"; export const MEDIA_STORE = "ref-media"; export function idbDo<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T>`
  - `media-store.ts`: `export interface MediaRecord { blob: Blob; mime: string; name: string; }` and `putMedia(id: string, rec: MediaRecord): Promise<void>`, `getMedia(id: string): Promise<MediaRecord | undefined>`, `pruneMedia(keep: Set<string>): Promise<void>`, `clearAllMedia(): Promise<void>` (all exported).

- [ ] **Step 1: Create `src/persist/db.ts`** — the current `openDb`/`idbDo` from `autosave.ts:8-31` generalized: DB name stays `"slop-animator"`, version bumped **1 → 2**, `onupgradeneeded` creates **both** stores guarded by `objectStoreNames.contains` (a fresh install jumps straight to v2; a v1 DB already has `kv`):

```ts
const DB_NAME = "slop-animator";
export const KV_STORE = "kv";
export const MEDIA_STORE = "ref-media";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function idbDo<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}
```

- [ ] **Step 2: Rewire `autosave.ts`** — delete its `openDb`/`idbDo`/`DB_NAME`/`STORE` consts, `import { idbDo, KV_STORE } from "./db"`, and change the three call sites to `idbDo(KV_STORE, ...)`. No behavior change.

- [ ] **Step 3: Create `src/persist/media-store.ts`:**

```ts
import { idbDo, MEDIA_STORE } from "./db";

export interface MediaRecord {
  blob: Blob;
  mime: string;
  name: string;
}

/** Write-once at import/relink/toggle time — the autosave debounce never touches this store. */
export function putMedia(id: string, rec: MediaRecord): Promise<void> {
  return idbDo(MEDIA_STORE, "readwrite", (s) => s.put(rec, id)).then(() => undefined);
}

export function getMedia(id: string): Promise<MediaRecord | undefined> {
  return idbDo<MediaRecord | undefined>(MEDIA_STORE, "readonly", (s) => s.get(id));
}

/** Delete every record not in `keep`. Call ONLY at project-load boundaries — undo snapshots
 *  share layer objects, so mid-session deletion could strand a restorable layer (gotcha #8). */
export async function pruneMedia(keep: Set<string>): Promise<void> {
  const keys = await idbDo<IDBValidKey[]>(MEDIA_STORE, "readonly", (s) => s.getAllKeys());
  for (const k of keys) {
    if (!keep.has(String(k))) await idbDo(MEDIA_STORE, "readwrite", (s) => s.delete(k));
  }
}

export function clearAllMedia(): Promise<void> {
  return idbDo(MEDIA_STORE, "readwrite", (s) => s.clear()).then(() => undefined);
}
```

- [ ] **Step 4: Verify** — `npm run build` 0/0, `npm test` green (IndexedDB code is not node-testable — build + review only; browser verification lands with Task 5).
- [ ] **Step 5: Commit** — `feat: shared IDB open (v2) + write-once ref-media store`

---

### Task 3: Persist bytes at import / paste / relink, with quota warning

**Files:**
- Modify: `src/state/appState.svelte.ts` (new `persistReferenceMedia`, change `relinkReference`, `pasteImageReference`)
- Modify: `src/lib/Toolbar.svelte:64-68` (image/video import)
- Modify: `src/lib/LayerList.svelte:82` (relink passes the file)

**Interfaces:**
- Consumes: `putMedia` (Task 2); `ReferenceLayer.mediaId/mediaMime` (Task 1).
- Produces:
  - `export function persistReferenceMedia(layer: ReferenceLayer, blob: Blob, name?: string): void` in appState.
  - `relinkReference(id: number, media: ReferenceMedia, blob?: Blob)` — third param added.

- [ ] **Step 1: Add `persistReferenceMedia` to `appState.svelte.ts`** (near `pasteImageReference`; import `putMedia` from `"../persist/media-store"`):

```ts
/** Mint a mediaId and store the bytes (write-once). On failure (e.g. iPad quota) the layer
 *  stays live for the session but reverts to a re-link placeholder after reload. */
export function persistReferenceMedia(layer: ReferenceLayer, blob: Blob, name?: string): void {
  const id = crypto.randomUUID();
  layer.mediaId = id;
  layer.mediaMime = blob.type || (layer.media.type === "video" ? "video/mp4" : "image/png");
  void putMedia(id, { blob, mime: layer.mediaMime, name: name ?? layer.name }).catch(() => {
    if (layer.mediaId === id) layer.mediaId = undefined; // don't serialize a dangling id
    state.statusHint = "Storage full — this reference won't survive a reload";
  });
}
```

- [ ] **Step 2: Wire the three entry points.**
  - `Toolbar.svelte` `onFile()` — images persist immediately, videos wait for the opt-in toggle (Task 6):

```ts
    const layer =
      pendingKind === "image"
        ? await loadImageLayer(file)
        : await loadVideoLayer(file, () => bump());
    if (pendingKind === "image") persistReferenceMedia(layer, file, file.name);
    addLayerToProject(layer);
```

  - `pasteImageReference` (appState:312-319): after `const layer = createReferenceLayer(media, "Pasted image");` add `persistReferenceMedia(layer, blob, "Pasted image");`.
  - `relinkReference` (appState:596-603) — add `blob?: Blob` param; a relink mints a NEW id (never overwrite the old record — old snapshots may reference it; the orphan is pruned at the next load boundary):

```ts
export function relinkReference(id: number, media: ReferenceMedia, blob?: Blob) {
  const layer = state.project.layers.find((l) => l.id === id);
  if (layer && layer.kind === "ref") {
    releaseReferenceMedia(layer.media); // free the old media (this is not undoable)
    layer.media = media;
    if (blob && (media.type === "image" || (media.type === "video" && layer.embedMedia)))
      persistReferenceMedia(layer, blob, blob instanceof File ? blob.name : layer.name);
    bump();
  }
}
```

  - `LayerList.svelte:82`: `relinkReference(id, await loadReferenceMedia(file, () => bump()), file);`

- [ ] **Step 3: Verify** — `npm run build` 0/0, `npm test` green. (`appState.svelte.ts` is not node-importable — build + review verified, per project convention.)
- [ ] **Step 4: Commit** — `feat: store reference bytes at import/paste/relink (quota-safe)`

---

### Task 4: Zip embed on save, zip hydration + store seeding on open

**Files:**
- Modify: `src/anim/reference.ts` (new `mediaFromBlob`)
- Modify: `src/persist/project-file.ts` (`mediaAssetPath`, `saveProjectBlob` opts, `loadProjectBlob` hydration)
- Modify: `src/lib/Toolbar.svelte:57,96` (call-site flags/callbacks)
- Test: `src/__tests__/persist.test.ts`

**Interfaces:**
- Consumes: `mediaIdsToEmbed`/`shouldRestoreMedia` (Task 1), `putMedia` (Task 2).
- Produces:
  - `export function mediaFromBlob(blob: Blob, mime: string, name: string, onSeeked: () => void): Promise<ReferenceMedia>` in `anim/reference.ts`.
  - `export function mediaAssetPath(mediaId: string): string` → `` `media/${mediaId}` ``.
  - `saveProjectBlob(project: Project, includeMedia = false)` — autosave keeps calling it with one arg.
  - `loadProjectBlob(blob: Blob, dpr: number, onSeeked?: () => void, onMediaPersistFailed?: () => void)`.

- [ ] **Step 1: Write the failing test** (append to persist.test.ts — node-safe: the ref's media is `missing`, so `mediaIdsToEmbed` excludes it and no fetch/DOM runs; asserts the flag doesn't leak media entries for non-embeddable layers):

```ts
describe("zip media entries", () => {
  it("includeMedia=true writes no media/ entry for missing media; =false never writes any", async () => {
    const project = createProject();
    const ref = createReferenceLayer({ type: "missing", was: "image", name: "a.png" });
    ref.mediaId = "gone-1";
    project.layers.push(ref);
    for (const include of [true, false]) {
      const blob = await saveProjectBlob(project, include);
      const zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
      expect(Object.keys(zip).filter((k) => k.startsWith("media/"))).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run it** — `npm test -- persist` — FAIL (saveProjectBlob takes one arg).

- [ ] **Step 3: Implement.**

`src/anim/reference.ts`:

```ts
/** Rebuild live reference media from persisted bytes (zip entry or ref-media store). */
export async function mediaFromBlob(
  blob: Blob,
  mime: string,
  name: string,
  onSeeked: () => void,
): Promise<ReferenceMedia> {
  const file = new File([blob], name, { type: mime });
  return mime.startsWith("video") ? loadVideoMedia(file, onSeeked) : loadImageMedia(file);
}
```

`src/persist/project-file.ts`:
- `export function mediaAssetPath(mediaId: string): string { return `media/${mediaId}`; }` (next to `frameAssetPath`).
- In `saveProjectBlob(project: Project, includeMedia = false)`, after the audio line:

```ts
  if (includeMedia) {
    // Original media formats are already compressed — store at level 0, like audio/track.
    for (const id of mediaIdsToEmbed(project.layers)) {
      const layer = project.layers.find((l) => l.kind === "ref" && l.mediaId === id);
      if (!layer || layer.kind !== "ref" || layer.media.type === "missing") continue;
      const bytes = new Uint8Array(await (await fetch(layer.media.el.src)).arrayBuffer());
      files[mediaAssetPath(id)] = [bytes, { level: 0 }];
    }
  }
```

(The bytes come from the live element's blob URL, not the store — so a quota-failed image still embeds into an explicit file save.)

- In `loadProjectBlob(blob, dpr, onSeeked?, onMediaPersistFailed?)`, turn the `refLayers` `.map` into a `for..of` loop building the array, and after constructing each `ReferenceLayer` literal (which now carries `mediaId`/`mediaMime`/`embedMedia` from Task 1):

```ts
    const bytes = rj.mediaId ? zip[mediaAssetPath(rj.mediaId)] : undefined;
    if (bytes && rj.mediaId && shouldRestoreMedia(value)) {
      const mime = rj.mediaMime ?? (rj.was === "video" ? "video/mp4" : "image/png");
      const mediaBlob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
      try {
        value.media = await mediaFromBlob(mediaBlob, mime, rj.name, onSeeked ?? (() => {}));
        // Seed the local store so this file restores on every later reload (write-once path).
        void putMedia(rj.mediaId, { blob: mediaBlob, mime, name: rj.name }).catch(() =>
          onMediaPersistFailed?.(),
        );
      } catch {
        /* corrupt media entry → stays a re-link placeholder */
      }
    }
```

(`shouldRestoreMedia` on the just-built `value` — its media is still the `missing` literal at this point, and it gates videos on `embedMedia`.)

`src/lib/Toolbar.svelte`:
- line 96: `downloadBlob(await saveProjectBlob(appState.project, true), "project.zip");`
- line 57: `replaceProject(await loadProjectBlob(file, DPR, () => bump(), () => (appState.statusHint = "Storage full — references won't survive a reload")));` (check the file's store import name — gotcha #1; if it imports `state`, use that, but Toolbar already uses `appState`.)

- [ ] **Step 4: Run** — `npm test` green (round-trip tests from Task 1 still pass — autosave path embeds nothing), `npm run build` 0/0.
- [ ] **Step 5: Commit** — `feat: embed reference media in project zip; hydrate + seed store on open`

---

### Task 5: Autosave-restore hydration and load-boundary pruning

**Files:**
- Modify: `src/persist/media-store.ts` (new `hydrateFromStore`)
- Modify: `src/App.svelte:180-189` (onMount restore)
- Modify: `src/lib/Toolbar.svelte:57` (prune after open)
- Modify: `src/lib/SizeDialog.svelte:49` (New clears the store)

**Interfaces:**
- Consumes: `getMedia`/`pruneMedia`/`clearAllMedia` (Task 2), `mediaFromBlob` (Task 4), `shouldRestoreMedia`/`referencedMediaIds` (Task 1).
- Produces: `export async function hydrateFromStore(project: Project, onSeeked: () => void): Promise<boolean>` in `media-store.ts` (returns whether anything hydrated).

- [ ] **Step 1: Add `hydrateFromStore` to `media-store.ts`** (import `mediaFromBlob` from `"../anim/reference"`, `shouldRestoreMedia` from `"./project-file"`, `type Project` from `"../anim/document"` — persist importing anim matches `project-file.ts`):

```ts
/** Rebuild live media for every placeholder whose bytes are in the store (autosave restore path).
 *  Mutates the project's layers; returns true if anything hydrated (caller repaints). */
export async function hydrateFromStore(
  project: Project,
  onSeeked: () => void,
): Promise<boolean> {
  let changed = false;
  for (const l of project.layers) {
    if (l.kind !== "ref" || !shouldRestoreMedia(l) || !l.mediaId) continue;
    const rec = await getMedia(l.mediaId);
    if (!rec) continue;
    try {
      l.media = await mediaFromBlob(rec.blob, rec.mime, rec.name, onSeeked);
      changed = true;
    } catch {
      /* undecodable record → stays a re-link placeholder */
    }
  }
  return changed;
}
```

- [ ] **Step 2: Wire the three load boundaries.**
  - `App.svelte` onMount (imports: `hydrateFromStore`, `pruneMedia` from `"./persist/media-store"`, `referencedMediaIds` from `"./persist/project-file"`, `bump` from the state module):

```ts
    try {
      const restored = await loadAutosave(DPR);
      if (restored) replaceProject(restored);
      if (await hydrateFromStore(state.project, () => bump())) bump();
      // Prune INSIDE the try: if restore threw, we don't know what's referenced — keep everything.
      void pruneMedia(referencedMediaIds(state.project.layers));
    } finally {
      autosaveReady = true;
    }
```

  - `Toolbar.svelte` project-open branch, after `replaceProject(...)`: `void pruneMedia(referencedMediaIds(appState.project.layers));` (safe against the in-flight seeding puts from Task 4: the incoming project's ids are in the keep-set, so a racing `getAllKeys` can never select them for deletion).
  - `SizeDialog.svelte:49`, next to `clearAutosave()`: `void clearAllMedia();`

- [ ] **Step 3: Verify** — `npm run build` 0/0, `npm test` green. Browser check (dev server): import an image ref → reload → it restores with transform intact; delete the ref layer → undo → still live (store untouched by removeLayer — nothing to implement, verify nothing regressed); New → store cleared (DevTools → IndexedDB).
- [ ] **Step 4: Commit** — `feat: restore reference media from store on startup; prune at load boundaries`

---

### Task 6: LayerList embed toggle for video references

**Files:**
- Modify: `src/state/appState.svelte.ts` (new `toggleEmbedMedia`)
- Modify: `src/lib/LayerList.svelte:250-260` (button beside the 🔊 toggle)

**Interfaces:**
- Consumes: `persistReferenceMedia` (Task 3).
- Produces: `export async function toggleEmbedMedia(id: number): Promise<void>` in appState.

- [ ] **Step 1: Add `toggleEmbedMedia` to appState:**

```ts
/** Video-only opt-in to persist/embed the media bytes. Toggle-on stores the bytes now (from the
 *  live element's blob URL); toggle-off just clears the flag — the record is pruned at the next
 *  load boundary (never mid-session: undo snapshots may still reference it). */
export async function toggleEmbedMedia(id: number): Promise<void> {
  const layer = state.project.layers.find((l) => l.id === id);
  if (!layer || layer.kind !== "ref") return;
  layer.embedMedia = !layer.embedMedia;
  if (layer.embedMedia && layer.media.type === "video" && !layer.mediaId) {
    const blob = await fetch(layer.media.el.src).then((r) => r.blob());
    persistReferenceMedia(layer, blob);
  }
  bump(); // repaint + mark autosave dirty
}
```

(`!layer.mediaId` guard: re-toggling doesn't mint duplicate records. A toggle-on while the media is `missing` just sets the flag — the bytes get stored on re-link, which Task 3's `relinkReference` gates on `embedMedia`.)

- [ ] **Step 2: Add the button in `LayerList.svelte`** inside the existing `{#if layer.kind === "ref" && layer.media.type === "video"}` block (lines 246-261), directly after the audio `</button>`; import `Save` and `SaveOff` from `lucide-svelte` and `toggleEmbedMedia` from the state module:

```svelte
        <button
          class="text-text-secondary"
          onclick={(e) => {
            e.stopPropagation();
            void toggleEmbedMedia(layer.id);
          }}
          title={layer.embedMedia
            ? "Video stored in project — survives reload & save"
            : "Video not stored — re-link after reload (tap to keep it)"}
        >
          {#if layer.embedMedia}<Save size={15} />{:else}<SaveOff size={15} />{/if}
        </button>
```

(`e.stopPropagation()` matches the audio button — row clicks select the layer. The block's condition means the toggle hides while the media is `missing`; that's fine — `relinkReference` honors a previously-set `embedMedia`, and Task 3 covers the missing case.)

- [ ] **Step 3: Verify** — `npm run build` 0/0; browser: toggle on a video ref → reload → video restores; toggle off → reload → placeholder; save with toggle on → zip contains `media/<id>`.
- [ ] **Step 4: Commit** — `feat: per-video embed toggle in the layer list`

---

### Task 7: Docs, spec amendment, and verification sweep

**Files:**
- Modify: `docs/superpowers/specs/2026-08-08-reference-media-persistence-design.md` (zip path: `media/<mediaId>`, no extension, mime in JSON — matches implementation)
- Modify: `CLAUDE.md` (Current state + the owed-browser-pass list)
- Modify: memory `deferred-persistence-items.md` (reference persistence no longer deferred)

- [ ] **Step 1: Amend the spec's zip-format line** — replace `` `media/<mediaId>.<ext>` `` with `` `media/<mediaId>` `` and note "no extension; `mediaMime` in `project.json` rebuilds the Blob type — follows the `audio/track` precedent".
- [ ] **Step 2: CLAUDE.md** — add a dated entry to the shipped/verification sections: what shipped, and the owed browser pass: image import → reload → restore; opted-in video → reload → restore; non-embedded video → placeholder; quota warning; old-zip open; new zip on a second device; delete-ref → undo → media live; New clears store; iPad for all of it.
- [ ] **Step 3: Update the memory file** (`deferred-persistence-items.md`) — reference-media persistence is now implemented (bytes path); File-System-Access no-bytes restore remains rejected.
- [ ] **Step 4: Full verification** — `npm run build` (0/0), `npm test` (baseline 345 + new tests, all green), `npm run lint`.
- [ ] **Step 5: Commit** — `docs: reference media persistence — spec amendment, state, verification debt`

---

## Self-review notes

- **Spec coverage:** data model → T1; local store/write-once/quota → T2+T3; zip format/back-compat/seeding → T4; restore + GC boundaries + New → T5; UI toggle → T6; undo invariants → encoded as constraints (removeLayer untouched, relink new-id in T3, prune boundaries in T5); testing split → T1/T4 unit, rest build+review with the browser list in T7.
- **Known accepted gaps:** the media-embed zip branch and all IndexedDB paths are not node-testable (project convention); `pruneMedia` does one transaction per delete (simple; runs once per load, key count is tiny). `toggleEmbedMedia`'s `fetch` of a blob URL is same-origin and cannot taint anything.
