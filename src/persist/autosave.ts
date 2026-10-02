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

export interface SaveHooks {
  /** Asked right before the write, after the encode (which reads the live canvases over many
   *  awaits): the meta to store, or null to store nothing — the drawings look blanked, so a copy
   *  encoded from canvases the iPad emptied mid-encode must not replace the latest. Being asked
   *  then also keeps the meta's inked count from the moment of the write. */
  describe: () => SaveMeta | null;
  /** A checkpoint write failed after the latest was stored (the save itself succeeded). */
  onCheckpointError?: (e: unknown) => void;
}

const get = <T>(key: string) => idbDo<T | undefined>(KV_STORE, "readonly", (s) => s.get(key));
/** Several puts (a value) and deletes (`undefined`) in ONE transaction: all land or none do, so a
 *  tab killed between them can't leave a blob listed with another copy's time or media list. */
const write = (entries: [string, unknown][]) =>
  idbDo(KV_STORE, "readwrite", (s) => {
    let last: IDBRequest | undefined;
    for (const [k, v] of entries) last = v === undefined ? s.delete(k) : s.put(v, k);
    return last!;
  });

/** Checkpoint-list edits (a save's rotation, shelving, setting aside) read, plan and write the
 *  list: run them one at a time so two can't each drop the other's entry. */
let listChain: Promise<unknown> = Promise.resolve();
function withList<T>(fn: () => Promise<T>): Promise<T> {
  const run = listChain.then(fn, fn);
  listChain = run.catch(() => undefined);
  return run;
}

/** Put a copy into the checkpoint rotation now, whatever its age: only the oldest one drops. */
function pushCheckpoint(blob: Blob, meta: AutosaveMeta): Promise<void> {
  return withList(async () => {
    const list = (await get<AutosaveEntry[]>(CHECKPOINTS_KEY)) ?? [];
    // -Infinity, not 0: a placeholder meta (savedAt 0) must not be refused as "too soon".
    const plan = planCheckpoint(list, meta, -Infinity, CHECKPOINTS_KEPT);
    await write([
      [plan.write!, blob],
      [CHECKPOINTS_KEY, plan.list],
    ]);
  });
}

/** For a copy stored by a version before metas: listed (and its media kept) all the same. */
function placeholderMeta(layers: Project["layers"]): AutosaveMeta {
  return {
    savedAt: 0,
    projectName: "",
    layerCount: 0,
    inkedCount: 0,
    mediaIds: [...referencedMediaIds(layers)],
  };
}

// One save at a time. Each save used to bump the generation and drop any older one still encoding,
// so on a project big enough that an encode outlasts the pause between edits every save was
// superseded before its write, and nothing reached the store for the whole session (2026-09-30
// review). Now a save that arrives while one runs queues ONE follow-up, which encodes the live
// document when it starts, so it holds every edit made meanwhile.
let running: Promise<void> | null = null;
let queued: { project: Project; gen: number; hooks: SaveHooks; done: Promise<void> } | null = null;

/** Serialize and store the project as the latest autosave, and as a checkpoint when the newest
 *  one is old enough. */
export function saveAutosave(project: Project, hooks: SaveHooks): Promise<void> {
  const gen = persistGeneration();
  if (!running) return start(project, gen, hooks);
  // A document replace (New / Open / restore) bumps the generation, so a follow-up queued for the
  // old document is not reused for the new one.
  if (queued && queued.project === project && queued.gen === gen) {
    queued.hooks = hooks; // the newest caller's
    return queued.done;
  }
  const entry = { project, gen, hooks, done: Promise.resolve() };
  entry.done = running
    .catch(() => undefined) // the follow-up runs whether or not the save before it failed
    .then(() => {
      if (queued === entry) queued = null;
      return start(entry.project, entry.gen, entry.hooks); // a stale entry's write returns at its first check
    });
  queued = entry;
  return entry.done;
}

function start(project: Project, gen: number, hooks: SaveHooks): Promise<void> {
  const run = save(project, gen, hooks).finally(() => {
    if (running === run) running = null;
  });
  running = run;
  return run;
}

async function save(project: Project, gen: number, hooks: SaveHooks): Promise<void> {
  if (gen !== persistGeneration()) return; // the document was replaced before this save began
  const mediaIds = [...referencedMediaIds(project.layers)];
  const blob = await saveProjectBlob(project);
  if (gen !== persistGeneration()) return; // …or while it encoded (or the guard paused autosave)
  const described = hooks.describe();
  if (!described) return; // the drawings look blanked: keep the stored copy
  const meta: AutosaveMeta = { ...described, mediaIds };
  await write([
    [LATEST_KEY, blob],
    [META_KEY, meta],
  ]);
  if (gen !== persistGeneration()) return; // …or while it wrote: no checkpoint of the old one
  // The latest is stored: a checkpoint that fails is its own, smaller problem, reported apart
  // (as "Autosave is failing" it re-encoded and failed again at every save).
  try {
    await withList(async () => {
      const list = (await get<AutosaveEntry[]>(CHECKPOINTS_KEY)) ?? [];
      const plan = planCheckpoint(list, meta, CHECKPOINT_INTERVAL_MS, CHECKPOINTS_KEPT);
      if (!plan.write) return;
      await write([
        [plan.write, blob],
        [CHECKPOINTS_KEY, plan.list],
      ]);
    });
  } catch (e) {
    hooks.onCheckpointError?.(e);
  }
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

/** Set the latest copy aside as the kept one (the layers went blank and the user carries on, or
 *  a New / Open replaces a paused document). A kept copy already there moves into the checkpoint
 *  rotation first, so a second set-aside can't lose the first good copy. A latest from before
 *  metas is kept with a placeholder meta (media ids from `layers`, the live project). */
export async function keepLatestAutosave(layers: Project["layers"]): Promise<void> {
  const blob = await get<Blob>(LATEST_KEY);
  if (!blob) return; // nothing stored: nothing to protect
  const meta = (await get<AutosaveMeta>(META_KEY)) ?? placeholderMeta(layers);
  const oldBlob = await get<Blob>(KEPT_KEY);
  if (oldBlob) {
    const oldMeta = (await get<AutosaveMeta>(KEPT_META_KEY)) ?? placeholderMeta([]);
    await pushCheckpoint(oldBlob, oldMeta);
  }
  await write([
    [KEPT_KEY, blob],
    [KEPT_META_KEY, meta],
  ]);
}

/** Before an older copy is restored over it: put the latest into the checkpoint rotation, since
 *  the restored copy's autosave will replace it seconds later. Skipped when it already is a
 *  checkpoint (the same save). */
export async function shelveLatestAutosave(layers: Project["layers"]): Promise<void> {
  const blob = await get<Blob>(LATEST_KEY);
  if (!blob) return;
  const meta = (await get<AutosaveMeta>(META_KEY)) ?? placeholderMeta(layers);
  const list = (await get<AutosaveEntry[]>(CHECKPOINTS_KEY)) ?? [];
  if (meta.savedAt && list.some((e) => e.savedAt === meta.savedAt)) return;
  await pushCheckpoint(blob, meta);
}

/** Forget the latest autosave (New). The kept copy and the checkpoints stay, so a New tapped by
 *  mistake can still be undone from File ▸ Restore autosave…. */
export async function clearAutosave(): Promise<void> {
  bumpPersistGeneration(); // drop any in-flight save of the outgoing document
  await write([
    [LATEST_KEY, undefined],
    [META_KEY, undefined],
  ]);
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
