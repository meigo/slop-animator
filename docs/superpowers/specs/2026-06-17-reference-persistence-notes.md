# Reference Layer Persistence — Deferred Design Notes

**Status:** Deferred (exploration captured; not yet scheduled)
**Date:** 2026-06-17

## Problem

Reference layers (imported image/video used for tracing) disappear on page reload. They are
deliberately excluded from `projectToJson` / `saveProjectBlob`, so neither the autosave (IndexedDB)
nor an exported project `.zip` contains them. The user wants references to survive reloads — primarily
to avoid losing them on dev refreshes — **without storing the file bytes** (to avoid bloating
storage / the project file).

## Current persistence (for context)

- **Autosave** (`src/persist/autosave.ts`): stores the whole project blob in **IndexedDB** (debounced
  ~3 s after the last edit) and restores it on mount. Contains drawing layers, the audio track, and
  doc settings — but **not** reference layers.
- **Exported project** (`saveProjectBlob` → download / Open): same serializer, also no references.
- Reference media (`ReferenceMedia`) holds only the live `el` (an `<img>`/`<video>` whose `src` is a
  `createObjectURL` blob URL that dies on reload). The original bytes are **not** retained.

## The hard browser constraint

"Store only a file reference, no bytes" is much harder than it sounds in a browser:

- A file picked via `<input type="file">` is just an in-memory `File` + a temporary blob URL. There
  is **no file path** to store, and the blob URL is invalid after reload.
- The **only** way to re-open the same file after reload *without copying its bytes* is the
  **File System Access API** (`showOpenFilePicker` → a `FileSystemFileHandle` that is
  structured-cloneable into IndexedDB, re-acquired on reload after a permission re-grant, then
  re-read). This is **Chromium-desktop only (Chrome/Edge)** — **not supported on iPad Safari**,
  desktop Safari, or Firefox.

## Options (when revisited)

| Approach | Stores | Survives reload | iPad Safari |
|---|---|---|---|
| **File System Access handle** | a file handle (no bytes) | ✅ desktop Chrome/Edge, 1 permission click | ❌ unsupported |
| **Metadata-only placeholder** | name/type/transform/offset only | ⚠️ layer reappears as a "re-link" placeholder; user re-picks the file | ✅ (re-pick each reload) |
| **Bytes in IndexedDB** | the file bytes (autosave only, never the exported file) | ✅ everywhere, no re-pick | ✅ — but user ruled this out |

Conclusion: **no-bytes + auto-restore the actual content is only possible via the File System Access
API (Chromium desktop).** On iPad there is no way to re-read a file after reload without either
storing bytes or re-picking it.

## Likely direction (to confirm later)

- If dev refreshes happen on desktop Chrome/Edge: a **File System Access handle** stored in IndexedDB
  (alongside the layer metadata + transform + offset) is the clean no-bytes fix there. On iPad it
  would fall back to a **metadata placeholder** that needs re-linking.
- Whatever the mechanism, the persisted reference info (metadata, handle/placeholder) belongs in the
  **autosave / local channel only**, never in the exported/shared project file.

## Related

- The reference `transform` (dx/dy/scale/rotation) and video `offsetFrames` are already on the model
  and would persist for free once references are persisted.
- See the global preferences persistence work (started 2026-06-17) — a *separate* concern (small
  JSON of tool/brush/theme prefs to localStorage), independent of reference media.
