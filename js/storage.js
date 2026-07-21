// IndexedDB layer. Keeps the same conceptual schema as the original Prisma
// database (profile, categories, habits, days, entries, quotes) so the
// original business logic can run untouched on top of local storage.

const DB_NAME = "arete";
const DB_VERSION = 1;

const STORES = ["profile", "categories", "habits", "days", "entries", "quotes"];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("profile")) db.createObjectStore("profile", { keyPath: "id" });
      if (!db.objectStoreNames.contains("categories")) {
        const s = db.createObjectStore("categories", { keyPath: "id" });
        s.createIndex("key", "key", { unique: true });
        s.createIndex("position", "position");
      }
      if (!db.objectStoreNames.contains("habits")) {
        const s = db.createObjectStore("habits", { keyPath: "id" });
        s.createIndex("categoryId", "categoryId");
        s.createIndex("position", "position");
      }
      if (!db.objectStoreNames.contains("days")) {
        const s = db.createObjectStore("days", { keyPath: "id" });
        s.createIndex("date", "date", { unique: true });
        s.createIndex("status", "status");
      }
      if (!db.objectStoreNames.contains("entries")) {
        const s = db.createObjectStore("entries", { keyPath: "id" });
        s.createIndex("dayId", "dayId");
        s.createIndex("habitId", "habitId");
        s.createIndex("day_habit", ["dayId", "habitId"], { unique: true });
      }
      if (!db.objectStoreNames.contains("quotes")) {
        db.createObjectStore("quotes", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function tx(storeNames, mode = "readonly") {
  return openDB().then((db) => {
    const transaction = db.transaction(storeNames, mode);
    const stores = Array.isArray(storeNames)
      ? Object.fromEntries(storeNames.map((n) => [n, transaction.objectStore(n)]))
      : transaction.objectStore(storeNames);
    return { transaction, stores };
  });
}

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function all(storeName) {
  const { stores } = await tx(storeName);
  return req(stores.getAll());
}

async function get(storeName, key) {
  const { stores } = await tx(storeName);
  return req(stores.get(key));
}

async function put(storeName, value) {
  const { stores, transaction } = await tx(storeName, "readwrite");
  stores.put(value);
  await done(transaction);
  return value;
}

async function del(storeName, key) {
  const { stores, transaction } = await tx(storeName, "readwrite");
  stores.delete(key);
  await done(transaction);
}

async function clear(storeName) {
  const { stores, transaction } = await tx(storeName, "readwrite");
  stores.clear();
  await done(transaction);
}

function done(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function bulkPut(storeName, items) {
  const { stores, transaction } = await tx(storeName, "readwrite");
  for (const item of items) stores.put(item);
  await done(transaction);
}

async function findWhere(storeName, predicate) {
  const list = await all(storeName);
  return list.filter(predicate);
}

async function findOne(storeName, predicate) {
  const list = await all(storeName);
  return list.find(predicate) ?? null;
}

export const db = {
  open: openDB,
  all,
  get,
  put,
  del,
  clear,
  bulkPut,
  findWhere,
  findOne,
  tx,
  done,
  req,
};
