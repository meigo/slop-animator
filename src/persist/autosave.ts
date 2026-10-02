import { saveProjectBlob, loadProjectBlob, referencedMediaIds } from "./project-file";
import { idbDo, KV_STORE } from "./db";
import { bumpPersistGeneration, persistGeneration } from "./generation";
import { pruneMedia } from "./media-store";
import { planCheckpoint, type AutosaveEntry, type AutosaveMeta } from "./autosave-plan";
import type { Project } from "../anim/document";

export type { AutosaveEntry, AutosaveMeta } from "./autosave-plan";

/** The latest save: the one restored on startup. */
export const LATEST_KEY = "autosave";
/** A copy set aside when the layers went blank and the user chose to keep working (or replaced the
 *  document while autosave was paused), so the save that follows can't replace it. Replaced only
 *  by the next such event. */
export const KEPT_KEY = "autosave-kept";
const META_KEY = "autosave-meta";
const KEPT_META_KEY = "autosave-kept-meta";
const CHECKPOINTS_KEY = "autosave-checkpoints";

/** Older copies, at least this far apart: if a blank or broken document ever got saved, the work
 *  from a few minutes earlier is still there. (slop-paint `2c53625`.) */
export const CHECKPOINT_INTERVAL_MS = 5 * 60_000;
export const CHECKPOINTS_KEPT = 3;

/** What the caller knows about the save; the media ids are read from the project as it encodes. */
export type SaveMeta = Omit<AutosaveMeta, "mediaIds">;

const put = (key: string, value: unknown) => idbDo(KV_STORE, "readwrite", (s) => s.put(value, key));
const get = <T>(key: string) => idbDo<T | undefined>(KV_STORE, "readonly", (s) => s.get(key));
const del = (key: string) => idbDo(KV_STORE, "readwrite", (s) => s.delete(key));

// One save at a time. Each save used to bump the generation and drop any older one still encoding,
// so on a project big enough that an encode outlasts the pause between edits every save was
// superseded before its write, and nothing reached the store for the whole session (2026-09-30
// review). Now a save that arrives while one runs queues ONE follow-up, which encodes the live
// document when it starts, so it holds every edit made meanwhile.
let running: Promise<void> | null = null;
let queued: { project: Project; gen: number; meta: SaveMeta; done: Promise<void> } | null = null;

/** Serialize and store the project as the latest autosave, and as a checkpoint when the newest
 *  one is old enough. */
export function saveAutosave(project: Project, meta: SaveMeta): Promise<void> {
  const gen = persistGeneration();
  if (!running) return start(project, gen, meta);
  // A document replace (New / Open / restore) bumps the generation, so a follow-up queued for the
  // old document is not reused for the new one.
  if (queued && queued.project === project && queued.gen === gen) {
    queued.meta = meta; // the newest caller's description of the document
    return queued.done;
  }
  const entry = { project, gen, meta, done: Promise.resolve() };
  entry.done = running
    .catch(() => undefined) // the follow-up runs whether or not the save before it failed
    .then(() => {
      if (queued === entry) queued = null;
      return start(entry.project, entry.gen, entry.meta); // a stale entry's write returns at its first check
    });
  queued = entry;
  return entry.done;
}

function start(project: Project, gen: number, meta: SaveMeta): Promise<void> {
  const run = write(project, gen, meta).finally(() => {
    if (running === run) running = null;
  });
  running = run;
  return run;
}

async function write(project: Project, gen: number, saveMeta: SaveMeta): Promise<void> {
  if (gen !== persistGeneration()) return; // the document was replaced before this save began
  const meta: AutosaveMeta = { ...saveMeta, mediaIds: [...referencedMediaIds(project.layers)] };
  const blob = await saveProjectBlob(project);
  if (gen !== persistGeneration()) return; // …or while it encoded
  await put(LATEST_KEY, blob);
  await put(META_KEY, meta);
  if (gen !== persistGeneration()) return; // …or while it wrote: no checkpoint of the old one
  const list = (await get<AutosaveEntry[]>(CHECKPOINTS_KEY)) ?? [];
  const plan = planCheckpoint(list, meta, CHECKPOINT_INTERVAL_MS, CHECKPOINTS_KEPT);
  if (!plan.write) return;
  await put(plan.write, blob);
  await put(CHECKPOINTS_KEY, plan.list);
}

/** An autosaved project (the latest unless `key` names another copy), or null if there is none. */
export async function loadAutosave(dpr: number, key: string = LATEST_KEY): Promise<Project | null> {
  const blob = await get<Blob>(key);
  return blob ? loadProjectBlob(blob, dpr) : null;
}

/** Every stored copy, newest first: the latest, the kept one, then the checkpoints. */
export async function listAutosaves(): Promise<AutosaveEntry[]> {
  const out: AutosaveEntry[] = [];
  const latest = await get<AutosaveMeta>(META_KEY);
  if (latest) out.push({ ...latest, key: LATEST_KEY });
  // Saved by a version before the listing existed: still restorable, just without its details.
  else if (await idbDo(KV_STORE, "readonly", (s) => s.count(LATEST_KEY)))
    out.push({
      key: LATEST_KEY,
      savedAt: 0,
      projectName: "",
      layerCount: 0,
      inkedCount: 0,
      mediaIds: [],
    });
  const kept = await get<AutosaveMeta>(KEPT_META_KEY);
  if (kept) out.push({ ...kept, key: KEPT_KEY });
  out.push(...((await get<AutosaveEntry[]>(CHECKPOINTS_KEY)) ?? []));
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/** Set the latest copy aside as the kept one (the layers went blank and the user carries on). */
export async function keepLatestAutosave(): Promise<void> {
  const blob = await get<Blob>(LATEST_KEY);
  const meta = await get<AutosaveMeta>(META_KEY);
  if (!blob || !meta) return;
  await put(KEPT_KEY, blob);
  await put(KEPT_META_KEY, meta);
}

/** Forget the latest autosave (New). The kept copy and the checkpoints stay, so a New tapped by
 *  mistake can still be undone from File ▸ Restore autosave…. */
export async function clearAutosave(): Promise<void> {
  bumpPersistGeneration(); // drop any in-flight save of the outgoing document
  await del(LATEST_KEY);
  await del(META_KEY);
}

/**
 * Delete stored reference media nothing points at any more: not the live project (`layers`), and
 * not any stored copy (latest, kept, checkpoints — each meta lists its `mediaIds`), so a restored
 * copy comes back with its references. Call ONLY at project-load boundaries (see `pruneMedia`).
 * A copy saved before metas existed lists no ids: it is the latest, which at startup IS the live
 * project, and a New or Open replaces it.
 */
export async function pruneUnusedMedia(layers: Project["layers"]): Promise<void> {
  const started = persistGeneration();
  const keep = referencedMediaIds(layers);
  for (const e of await listAutosaves()) for (const id of e.mediaIds ?? []) keep.add(id);
  if (started !== persistGeneration()) return; // replaced while listing: `keep` is stale
  await pruneMedia(keep);
}
