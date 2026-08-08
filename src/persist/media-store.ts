import { idbDo, MEDIA_STORE } from "./db";
import { mediaFromBlob } from "../anim/reference";
import { shouldRestoreMedia } from "./project-file";
import type { Project } from "../anim/document";

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

/** Rebuild live media for every placeholder whose bytes are in the store (autosave restore path).
 *  Mutates the project's layers; returns true if anything hydrated (caller repaints). */
export async function hydrateFromStore(project: Project, onSeeked: () => void): Promise<boolean> {
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
