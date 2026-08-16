const DB_NAME = "slop-animator";
export const KV_STORE = "kv";
export const MEDIA_STORE = "ref-media";

/** An open that hasn't settled by now is not going to: `onblocked` covers the one KNOWN stall (an
 *  older-version tab holding the DB), and the timeout covers the rest. Long enough that a busy
 *  device isn't failed spuriously; short enough that startup doesn't hang on a blank canvas. */
const OPEN_TIMEOUT_MS = 10_000;

/** Open the DB, guaranteeing the promise SETTLES.
 *
 *  `onupgradeneeded`/`onsuccess`/`onerror` are not exhaustive: a version upgrade blocked by another
 *  open tab fires none of them, so the promise hung forever — at startup that meant the restore
 *  `await` never returned, autosave was never armed, and the app looked normal on a blank canvas
 *  with saving silently off for the whole session. */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    let settled = false;
    const finish = (act: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      act();
    };
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new Error("Storage did not respond — another tab may be using an older version")),
        ),
      OPEN_TIMEOUT_MS,
    );
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
    };
    req.onsuccess = () => {
      // A success arriving after the timeout would otherwise leak an open connection; WebKit
      // eventually refuses new opens when those pile up.
      if (settled) return req.result.close();
      finish(() => resolve(req.result));
    };
    req.onerror = () => finish(() => reject(req.error ?? new Error("Storage could not be opened")));
    req.onblocked = () =>
      finish(() =>
        reject(new Error("Storage is blocked by another tab — close other tabs and reload")),
      );
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
        let req: IDBRequest<T>;
        try {
          const tx = db.transaction(store, mode);
          req = fn(tx.objectStore(store));
          // Request success is not commit: Safari can abort after onsuccess on quota.
          // Resolve/reject on the transaction, and close in both paths so a leak
          // cannot pile up connections until WebKit refuses new opens.
          tx.oncomplete = () => {
            db.close();
            resolve(req.result);
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error ?? req.error ?? new Error("IndexedDB transaction aborted"));
          };
        } catch (e) {
          db.close();
          reject(e);
        }
      }),
  );
}
