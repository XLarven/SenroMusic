import type { DownloadRecord } from '../types';

const DB_NAME = 'NorieMusic';
const DB_VERSION = 1;
const STATE_STORE = 'download-state';
const FILE_STORE = 'offline-store';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Tarayıcı IndexedDB desteklemiyor.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STATE_STORE)) {
        db.createObjectStore(STATE_STORE, { keyPath: 'trackId' });
      }
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        db.createObjectStore(FILE_STORE, { keyPath: 'trackId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Yerel veritabanı açılamadı.'));
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Yerel depolama isteği başarısız oldu.'));
  });
}

async function transaction(
  storeName: string,
  mode: IDBTransactionMode,
  // IndexedDB request result types are invariant in TypeScript's DOM lib; the
  // helper normalizes them through `any` before exposing `unknown`.
  run: (store: IDBObjectStore) => IDBRequest<any>,
): Promise<unknown> {
  const db = await openDb();
  const tx = db.transaction(storeName, mode);
  const request = run(tx.objectStore(storeName)) as unknown as IDBRequest<unknown>;
  const result = await requestToPromise(request);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Yerel depolama işlemi başarısız oldu.'));
  });
  return result;
}

export async function loadDownloadRecords(): Promise<DownloadRecord[]> {
  const result = (await transaction(STATE_STORE, 'readonly', (store) => store.getAll())) as DownloadRecord[];
  return Array.isArray(result) ? result : [];
}

export async function saveDownloadRecord(record: DownloadRecord): Promise<void> {
  await transaction(STATE_STORE, 'readwrite', (store) => store.put(record));
}

export async function deleteDownloadRecord(trackId: string): Promise<void> {
  await transaction(STATE_STORE, 'readwrite', (store) => store.delete(trackId));
}

export async function loadDownloadBlob(trackId: string): Promise<Blob | null> {
  const result = (await transaction(FILE_STORE, 'readonly', (store) => store.get(trackId))) as
    | { blob: Blob }
    | undefined;
  return result?.blob ?? null;
}

export async function saveDownloadBlob(trackId: string, blob: Blob): Promise<void> {
  await transaction(FILE_STORE, 'readwrite', (store) =>
    store.put({ trackId, blob, size: blob.size, savedAt: new Date().toISOString() }),
  );
}

export async function deleteDownloadBlob(trackId: string): Promise<void> {
  await transaction(FILE_STORE, 'readwrite', (store) => store.delete(trackId));
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage) return false;
    if (navigator.storage.persisted && await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}
