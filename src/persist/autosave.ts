import { saveProjectBlob, loadProjectBlob } from "./project-file";
import { idbDo, KV_STORE } from "./db";
import { bumpPersistGeneration, persistGeneration } from "./generation";
import type { Project } from "../anim/document";

const KEY = "autosave";

// One save at a time. Each save used to bump the generation and drop any older one still encoding,
// so on a project big enough that an encode outlasts the pause between edits every save was
// superseded before its write, and nothing reached the store for the whole session (2026-09-30
// review). Now a save that arrives while one runs queues ONE follow-up, which encodes the live
// document when it starts, so it holds every edit made meanwhile.
let running: Promise<void> | null = null;
let queued: { project: Project; gen: number; done: Promise<void> } | null = null;

/** Serialize and store the project as the single autosave slot. */
export function saveAutosave(project: Project): Promise<void> {
  const gen = persistGeneration();
  if (!running) return start(project, gen);
  // A document replace (New / Open / restore) bumps the generation, so a follow-up queued for the
  // old document is not reused for the new one.
  if (queued && queued.project === project && queued.gen === gen) return queued.done;
  const entry = { project, gen, done: Promise.resolve() };
  entry.done = running
    .catch(() => undefined) // the follow-up runs whether or not the save before it failed
    .then(() => {
      if (queued === entry) queued = null;
      return start(entry.project, entry.gen); // a stale entry's write returns at its first check
    });
  queued = entry;
  return entry.done;
}

function start(project: Project, gen: number): Promise<void> {
  const run = write(project, gen).finally(() => {
    if (running === run) running = null;
  });
  running = run;
  return run;
}

async function write(project: Project, gen: number): Promise<void> {
  if (gen !== persistGeneration()) return; // the document was replaced before this save began
  const blob = await saveProjectBlob(project);
  if (gen !== persistGeneration()) return; // …or while it encoded
  await idbDo(KV_STORE, "readwrite", (s) => s.put(blob, KEY));
}

/** Restore the autosaved project, or null if none. */
export async function loadAutosave(dpr: number): Promise<Project | null> {
  const blob = await idbDo<Blob | undefined>(KV_STORE, "readonly", (s) => s.get(KEY));
  return blob ? loadProjectBlob(blob, dpr) : null;
}

/** Forget the autosave (used by "New"). */
export async function clearAutosave(): Promise<void> {
  bumpPersistGeneration(); // drop any in-flight save of the outgoing document
  await idbDo(KV_STORE, "readwrite", (s) => s.delete(KEY));
}
