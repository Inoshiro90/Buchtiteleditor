// editor/db/db.js
// Lightweight IndexedDB wrapper — no external dependency, matches idb API shape

const DB_NAME = 'buchtiteleditor';
const DB_VERSION = 1;
const STORES = ['tables', 'schemas', 'meta'];

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      STORES.forEach((name) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
        }
      });
    };
    req.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const db = {
  async get(storeName, key) {
    return tx(storeName, 'readonly', (s) => s.get(key));
  },

  async set(storeName, key, value) {
    return tx(storeName, 'readwrite', (s) => s.put(value, key));
  },

  async delete(storeName, key) {
    return tx(storeName, 'readwrite', (s) => s.delete(key));
  },

  async keys(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getAll(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async clear(storeName) {
    return tx(storeName, 'readwrite', (s) => s.clear());
  },

  async isInitialized() {
    const flag = await this.get('meta', 'initialized');
    return flag === true;
  },

  async setInitialized() {
    return this.set('meta', 'initialized', true);
  },
};
