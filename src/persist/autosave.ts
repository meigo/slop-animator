import { saveProjectBlob, loadProjectBlob } from "./project-file";
import { idbDo, KV_STORE } from "./db";
import type { Project } from "../anim/document";

const KEY = "autosave";

/** Serialize and store the project as the single autosave slot. */
export async function saveAutosave(project: Project): Promise<void> {
  const blob = await saveProjectBlob(project);
  await idbDo(KV_STORE, "readwrite", (s) => s.put(blob, KEY));
}

/** Restore the autosaved project, or null if none. */
export async function loadAutosave(dpr: number): Promise<Project | null> {
  const blob = await idbDo<Blob | undefined>(KV_STORE, "readonly", (s) => s.get(KEY));
  return blob ? loadProjectBlob(blob, dpr) : null;
}

/** Forget the autosave (used by "New"). */
export async function clearAutosave(): Promise<void> {
  await idbDo(KV_STORE, "readwrite", (s) => s.delete(KEY));
}
