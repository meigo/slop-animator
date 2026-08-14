const DB_NAME = "slop-animator";
export const KV_STORE = "kv";
export const MEDIA_STORE = "ref-media";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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
