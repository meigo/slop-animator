# Reference Media Persistence — Design

**Status:** Approved (brainstormed 2026-08-08)
**Date:** 2026-08-08
**Supersedes:** the "likely direction" in `2026-06-17-reference-persistence-notes.md` (File System
Access handles — rejected here as Chromium-only YAGNI). Builds on the placeholder flow from
`2026-06-17-reference-placeholders-design.md`, which remains the fallback path.

## Problem

Reference layers persist as metadata-only placeholders: on every reload (and on any other device)
the user must re-pick the media file. The 2026-06 exploration ruled out storing bytes to avoid
storage bloat; that stance was revisited 2026-08-08 — the 1× scale change cut the app's storage
footprint 4×, image references are only a few MB, and the user now wants references to survive
sessions. Cloud/sync options were considered and rejected: they add auth, an online dependency, and
a canvas-tainting risk (cross-origin media without CORS breaks compositing/export) for a goal that
local storage fully covers.

## Requirements (user-confirmed)

1. **Same-device restore:** reopening the app restores references from autosave with no re-pick.
2. **Travels with the .zip:** a saved project file opened anywhere brings its references along.
3. **Images always; videos opt-in** per reference (default off), because video files can be
   100s of MB. A non-embedded video keeps today's placeholder + re-link flow.
4. No cloud, no accounts, no online dependency.

## Design

### Data model

- `ReferenceLayer` gains `mediaId: string` — a stable unique id generated at import and at relink.
- Video references gain `embedMedia?: boolean` (default/absent = `false`). Images have no flag;
  they always persist.
- A restored blob goes through the same object-URL → media-element path as a fresh import. The
  `missing` placeholder variant is unchanged and remains the fallback (non-embedded videos, quota
  failures, old files, unknown formats).

### Local store (autosave channel)

- A second object store (`ref-media`) in the existing autosave IndexedDB database (DB version
  bump), records `{ id, blob, type, name }`.
- **Write-once:** the blob is written at import/relink time only. The ~3s autosave debounce never
  touches it — this is the reason for a separate store rather than embedding media in the autosaved
  project blob, which would re-copy every media file on every edit.
- The autosaved project JSON carries only `mediaId` (+ existing metadata). Restore: for each
  reference layer whose `mediaId` has a stored blob, rebuild the media via the existing relink
  machinery (including the `loadeddata` → repaint handling from the 2026-07-12 video-perf work).
  Videos restore only if `embedMedia` is set; otherwise placeholder.
- **Quota/write failure:** the reference stays live for the session; a status-bar warning states it
  won't survive reload. Non-blocking, no dialog. The layer serializes as a placeholder.

### Zip format

- New entries `media/<mediaId>.<ext>` at **compression level 0** (media formats are already
  compressed — same reasoning as the level-0 frame PNGs from 2026-07-28).
- Images always written; videos only when `embedMedia` is on.
- `project.json` reference entries store `mediaId` and the `embedMedia` flag.
- **Back-compat, both directions:** old zips have no `media/` entries → placeholder flow. An old
  app version opening a new zip ignores unknown entries → placeholder + re-link, no crash.
- Opening a zip that contains media **seeds the local store** (same write-once path, same failure
  handling), so a file opened on the iPad restores on every subsequent reload.

### UI

- Video reference rows in `LayerList` get one embed-toggle icon beside the existing 🔊 audio
  toggle, same interaction pattern, with `title=` feeding the status-bar hint.
- Images get no UI — they just work. Toggling `embedMedia` marks the project autosave-dirty.

### Undo & lifecycle invariants

- `removeLayer` must **NOT** delete from the media store: undo snapshots share layer objects
  (CLAUDE.md gotcha #8), and an undone delete must find its blob intact. (Mirrors the existing
  rule that `removeLayer` only `pause()`s a video, never releases it.)
- **Orphan GC runs only at project-load boundaries** (`replaceProject` / open / startup restore):
  delete store records whose id is not referenced by the incoming project. History is cleared at
  that boundary, so no undo snapshot can reference a collected blob.
- `relinkReference` writes the new blob under a **new** `mediaId` (never overwrites the old
  record) — old snapshots may still reference the old id; the old record is collected at the next
  load boundary.

### Rejected alternatives

- **Media inside the autosaved project blob** — one serializer, but the 3s debounce would re-copy
  all media (potentially 100s of MB of video) into IndexedDB on every edit. Disqualifying.
- **File System Access handles** (no-bytes desktop restore) — Chromium-desktop only, permission
  re-grant flow, and the byte store already covers every platform including the primary one (iPad).
- **Cloud (Dropbox / R2 / URL references)** — only needed for cross-device *sync*, which is not a
  requirement; adds auth, online dependency, link rot, and CORS/canvas-taint risk.

## Testing & verification

- **Unit-tested (pure logic):** mediaId serialization round-trip, orphan-set computation, the
  embed-flag filtering of which media entries are written to the zip.
- **Build + review verified** (per project convention — IndexedDB/DOM are not node-testable), with
  a **browser pass owed:** image import → reload → auto-restore; video opt-in → reload → restore;
  non-embedded video → placeholder; quota-failure warning; opening an old (pre-media) zip; opening
  a new zip on a second device; delete a persisted reference layer → undo → media still live
  (same session — verifies `removeLayer` leaves the store alone); iPad for all of it.

## Out of scope

Cloud/sync of any kind; File System Access handles; keeping media of removed layers past the next
load boundary; any change to the re-link placeholder flow itself; per-reference size caps or
transcoding.
