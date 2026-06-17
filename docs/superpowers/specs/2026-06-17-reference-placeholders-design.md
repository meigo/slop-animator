# Reference Layer Placeholders (persist + re-link) — Design

**Status:** Approved (design phase)
**Date:** 2026-06-17

## Goal

Persist reference layers across reloads **as metadata-only placeholders** — name, type, opacity,
visibility, video time-offset, transform, and z-order position — with **no media bytes**, plus a way
to **re-link** (re-pick) the file to restore the actual media. This is the universal, no-bytes path
from `2026-06-17-reference-persistence-notes.md` (works on iPad too).

## Background

Reference layers (image/video tracing aids) are excluded from `projectToJson`, so they vanish on
reload and lose their z-order entirely. Their media is a live `<img>`/`<video>` with a blob-URL `src`
that dies on reload; the bytes aren't retained. We persist only the *metadata* and let the user
re-pick the file. The reference `transform` (dx/dy/scale/rotation) and `offsetFrames` already exist
on the model and ride along for free.

`layer.media` is read in ~7 places. Crucially, **making `mediaIntrinsicSize` return `{ w: 0, h: 0 }`
for a placeholder means the existing zero-size / non-video guards already skip it** in the compositor
(`render.ts`), the gizmo, `Canvas` onStroke, and `syncReferenceVideos` — so no new guards are needed
there. Only `LayerList` (badge + a re-link affordance) needs UI changes.

## Decisions

1. **A `missing` media variant** (placeholders keep `media` non-null and explicit):
   ```ts
   type ReferenceMedia =
     | { type: "image"; el: HTMLImageElement }
     | { type: "video"; el: HTMLVideoElement }
     | { type: "missing"; was: "image" | "video"; name: string };
   ```
2. **Persist in `projectToJson` → both channels.** Placeholders carry no bytes, so they go in the
   autosave (survive reload) *and* the exported/shared project (portable; re-link on open).
3. **Render nothing** for a placeholder on the canvas (no outline); it's visible only as its LayerList
   row with a re-link button.
4. **Re-link allows any file** — picking an image or video just replaces the media (the stored `was`
   is a hint, not enforced).
5. **Z-order is preserved** by serializing references with their index in the full layer stack and
   splicing them back on load (no restructuring of the existing drawing-layer serialization).

## Model & touchpoints

### `src/anim/document.ts`
- Add the `missing` variant to `ReferenceMedia` (above). Widening the union does **not** break existing
  `media: { type: "image"|"video", … }` literals.
- `mediaIntrinsicSize`: return `{ w: 0, h: 0 }` for `type === "missing"` (image/video branches
  unchanged). This is what makes the render/gizmo/onStroke/video-sync guards skip placeholders for free.

### No-change touchpoints (verified)
- `render.ts` (both ref draws): `mediaIntrinsicSize` → `{0,0}` → the existing `if (size.w === 0 || size.h === 0) continue;` skips it.
- `RefTransformGizmo.svelte`: same — its `if (size.w > 0 && size.h > 0)` keeps the gizmo hidden for placeholders.
- `Canvas.svelte` onStroke ref-transform: its `if (size.w === 0 || size.h === 0) { … return; }` no-ops.
- `syncReferenceVideos`: `media.type !== "video"` already skips `missing`.

### `src/lib/LayerList.svelte`
- Badge (`{layer.media.type}`): for `missing`, show the `was` type styled as missing (e.g. `IMG?` / `VID?` or a "link-off" icon).
- Add a **re-link button** on a `missing` reference row → opens a file picker (a hidden `<input accept="image/*,video/*">`) targeting that layer; on pick, load the media and call `relinkReference`.
- Video time-offset input: only shows for live `video` media (unchanged); a `missing` row doesn't show it until re-linked. (The stored `offsetFrames` is preserved regardless.)

### `src/anim/reference.ts`
- Add `loadReferenceMedia(file, onSeeked): Promise<ReferenceMedia>` that dispatches by `file.type`
  (image vs video) and returns the loaded media (reusing the existing image/video element setup).
  Used by re-link. (`loadImageLayer`/`loadVideoLayer` stay for new imports.)

### `src/state/appState.svelte.ts`
- `relinkReference(id, media)`: replace the placeholder layer's `media` with the loaded `ReferenceMedia`,
  keeping all other fields (name/opacity/visible/offsetFrames/transform), then `bump()`. Not undoable
  (reference layers sit outside structural undo, like today).

## Persistence — `src/persist/project-file.ts`

Additive (keeps the drawing-layer serialization untouched):

```ts
export interface ReferenceJson {
  index: number;            // position in the full project.layers stack (for z-order)
  id: number;
  name: string;
  visible: boolean;
  opacity: number;
  offsetFrames: number;
  was: "image" | "video";   // the media kind (from media.type, or media.was if already a placeholder)
  transform: RefTransform;
}
```
- `ProjectJson` gains `references?: ReferenceJson[]` (optional → old saves load with none).
- `projectToJson`: map `project.layers` with their index, keep the references, emit `ReferenceJson`
  (using `media.type` or, if already `missing`, `media.was` for `was`).
- `loadProjectBlob`: after building the drawing `layers` array in order, splice each reference
  (sorted by ascending `index`) into `layers` at its `index` as a `missing` placeholder:
  `media: { type: "missing", was: rj.was, name: rj.name }`. Include reference ids when computing
  `maxId` for `setMinLayerId`.

Ascending-index splicing into the drawing-only array reconstructs the original interleaving (verified:
`[D,D,R,D]` and `[R,D,R,D]` both rebuild correctly).

## Testing

Vitest is **Node** (no canvas/DOM). Unit-test the pure logic; media loading, the LayerList UI, and the
full blob round-trip (canvas) are manual-verified.

**Unit:**
- `mediaIntrinsicSize` returns `{0,0}` for a `missing` media; unchanged for image/video (`document.test.ts`).
- `projectToJson` emits `references` with correct `index`, `was`, `offsetFrames`, and `transform`, in
  the presence of interleaved drawing + reference layers; omits the field's entries correctly when
  there are no references (`persist.test.ts`).
- A pure `insertReferencesByIndex(drawingLayers, refs)` helper (extracted for the splice logic) →
  rebuilds the correct ordered stack for interleaved cases. (Operates on lightweight `{id}`-ish stand-ins
  so it's Node-testable without canvases.)

**Manual (browser):**
- Import an image + a video reference, transform/offset them, reorder among drawing layers → reload →
  the layers reappear as placeholders at the right positions with name/opacity/visibility/transform/offset intact; canvas shows nothing for them.
- Re-link a placeholder (image and video) → media loads into that layer; the preserved transform/offset apply immediately; gizmo + video-offset input work again.
- Export a project with references, open it fresh → placeholders present, re-link works.
- A drawing-only project (no references) round-trips unchanged; an old save (no `references` field) loads fine.

## Out of scope

- Storing media bytes or auto-restoring content without re-picking (the File System Access / native
  paths in `2026-06-17-reference-persistence-notes.md`).
- A canvas placeholder indicator (renders nothing for now).

## Self-review notes

- The `{0,0}`-from-`mediaIntrinsicSize` insight collapses the touchpoints to just `LayerList` + a model
  variant + persistence — the rendering/gizmo/sync paths need no edits.
- Index-based reference splicing is additive to persistence (no change to drawing-layer JSON), with the
  tricky ordering logic extracted to a pure, tested helper.
- Transform + offset persist as a side effect, partially resolving the earlier "reference transform is
  session-only" gap (it survives as placeholder metadata; the *media* still needs a re-link).
