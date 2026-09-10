/**
 * Lightweight IndexedDB Helper for Large Binary Blobs
 * Enables high-performance, zero-copy blob passing between Service Worker and Offscreen Document.
 * Completely eliminates huge base64 data URLs, CPU lockups, and memory spikes.
 */

const DB_NAME = 'pesu_blob_cache';
const DB_VERSION = 1;
const STORE_NAME = 'blobs';

export function openBlobDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      console.warn('IndexedDB open blocked by another context');
    };
  });
}

export async function saveBlobToDB(key, blob) {
  const db = await openBlobDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, key);
    tx.oncomplete = () => {
      try { db.close(); } catch {}
      resolve();
    };
    tx.onerror = () => {
      try { db.close(); } catch {}
      reject(tx.error);
    };
  });
}

export async function getBlobFromDB(key) {
  const db = await openBlobDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => {
      try { db.close(); } catch {}
      resolve(req.result);
    };
    req.onerror = () => {
      try { db.close(); } catch {}
      reject(req.error);
    };
  });
}

export async function deleteBlobFromDB(key) {
  try {
    const db = await openBlobDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => {
        try { db.close(); } catch {}
        resolve();
      };
      tx.onerror = () => {
        try { db.close(); } catch {}
        reject(tx.error);
      };
    });
  } catch (e) {
    // Ignore cleanup errors
  }
}
