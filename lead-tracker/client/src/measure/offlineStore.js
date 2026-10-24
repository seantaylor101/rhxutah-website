// IndexedDB on the phone: every photo is written here the instant it's
// taken — before any upload is attempted — so a dead zone in a side yard, a
// closed app, or a dropped request never loses a shot. It's deleted from
// here only once the server has confirmed it. The last-loaded wall map is
// cached here too, so capture and auto-assignment keep working offline.

const DB_NAME = "lead-hammer-measure";
const VERSION = 1;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("queue")) {
        const q = db.createObjectStore("queue", { keyPath: "clientId" });
        q.createIndex("leadId", "leadId");
      }
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "leadId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let result;
        Promise.resolve(fn(s)).then((r) => {
          result = r;
        });
        t.oncomplete = () => resolve(result && typeof result === "object" && "result" in result ? result.result : result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error("IndexedDB transaction aborted"));
      }),
  );
}

export const offlineStore = {
  putQueued: (item) => tx("queue", "readwrite", (s) => s.put(item)),
  getQueued: (clientId) => tx("queue", "readonly", (s) => s.get(clientId)),
  deleteQueued: (clientId) => tx("queue", "readwrite", (s) => s.delete(clientId)),
  allQueued: () => tx("queue", "readonly", (s) => s.getAll()),
  queuedForLead: (leadId) => tx("queue", "readonly", (s) => s.index("leadId").getAll(leadId)),
  putProject: (leadId, payload) => tx("projects", "readwrite", (s) => s.put({ leadId, payload, savedAt: Date.now() })),
  getProject: (leadId) => tx("projects", "readonly", (s) => s.get(leadId)).then((r) => (r ? r.payload : null)),
};

// asks the browser not to clear this site's storage under space pressure —
// a queued photo that hasn't uploaded yet exists nowhere else
export function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch {
    // not supported — nothing to do
  }
}
