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

function idbDo<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
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
