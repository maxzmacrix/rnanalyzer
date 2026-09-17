// IndexedDB persistence: laps (metadata), samples (typed arrays), videos (Blobs), settings, custom sectors.
// Everything stays on the device – the app is fully offline‑capable.

const DB_NAME = 'rn-analyzer';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('laps')) {
        const laps = db.createObjectStore('laps', { keyPath: 'id' });
        laps.createIndex('startMs', 'startMs');
        laps.createIndex('trackId', 'track.id');
      }
      if (!db.objectStoreNames.contains('samples')) db.createObjectStore('samples', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('raw')) db.createObjectStore('raw', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos', { keyPath: 'fileName' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('sectors')) db.createObjectStore('sectors', { keyPath: 'trackId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  return dbPromise;
}

function tx(db, stores, mode = 'readonly') {
  return db.transaction(stores, mode);
}
function reqp(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function txDone(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

export const db = {
  async putLap(lap, samples, raw) {
    const d = await open();
    const t = tx(d, ['laps', 'samples', 'raw'], 'readwrite');
    t.objectStore('laps').put(lap);
    t.objectStore('samples').put({ id: lap.id, ...samples });
    if (raw) t.objectStore('raw').put({ id: lap.id, data: raw, fileName: lap.source.fileName });
    await txDone(t);
  },
  async updateLap(lap) {
    const d = await open();
    const t = tx(d, ['laps'], 'readwrite');
    t.objectStore('laps').put(lap);
    await txDone(t);
  },
  async getLap(id) {
    const d = await open();
    return reqp(tx(d, ['laps']).objectStore('laps').get(id));
  },
  async allLaps() {
    const d = await open();
    const laps = await reqp(tx(d, ['laps']).objectStore('laps').getAll());
    laps.sort((a, b) => a.startMs - b.startMs);
    return laps;
  },
  async getSamples(id) {
    const d = await open();
    return reqp(tx(d, ['samples']).objectStore('samples').get(id));
  },
  async getRaw(id) {
    const d = await open();
    return reqp(tx(d, ['raw']).objectStore('raw').get(id));
  },
  async deleteLap(id) {
    const d = await open();
    const t = tx(d, ['laps', 'samples', 'raw'], 'readwrite');
    t.objectStore('laps').delete(id);
    t.objectStore('samples').delete(id);
    t.objectStore('raw').delete(id);
    await txDone(t);
  },

  async putVideo(fileName, blob) {
    const d = await open();
    const t = tx(d, ['videos'], 'readwrite');
    t.objectStore('videos').put({ fileName, blob, size: blob.size, type: blob.type || 'video/mp4', addedAt: Date.now() });
    await txDone(t);
  },
  async getVideo(fileName) {
    const d = await open();
    return reqp(tx(d, ['videos']).objectStore('videos').get(fileName));
  },
  async videoNames() {
    const d = await open();
    return reqp(tx(d, ['videos']).objectStore('videos').getAllKeys());
  },
  async videoInfos() {
    const d = await open();
    const t = tx(d, ['videos']);
    const store = t.objectStore('videos');
    return new Promise((resolve, reject) => {
      const out = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(out);
        out.push({ fileName: c.value.fileName, size: c.value.size, addedAt: c.value.addedAt });
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },
  async deleteVideo(fileName) {
    const d = await open();
    const t = tx(d, ['videos'], 'readwrite');
    t.objectStore('videos').delete(fileName);
    await txDone(t);
  },
  async deleteAllVideos() {
    const d = await open();
    const t = tx(d, ['videos'], 'readwrite');
    t.objectStore('videos').clear();
    await txDone(t);
  },

  async getSetting(key, def) {
    const d = await open();
    const r = await reqp(tx(d, ['settings']).objectStore('settings').get(key));
    return r ? r.value : def;
  },
  async setSetting(key, value) {
    const d = await open();
    const t = tx(d, ['settings'], 'readwrite');
    t.objectStore('settings').put({ key, value });
    await txDone(t);
  },

  async getCustomSectors(trackId) {
    const d = await open();
    const r = await reqp(tx(d, ['sectors']).objectStore('sectors').get(trackId));
    return r ? r.splits : [];
  },
  async setCustomSectors(trackId, splits) {
    const d = await open();
    const t = tx(d, ['sectors'], 'readwrite');
    t.objectStore('sectors').put({ trackId, splits });
    await txDone(t);
  },

  async clearAll() {
    const d = await open();
    const stores = ['laps', 'samples', 'raw', 'videos', 'sectors'];
    const t = tx(d, stores, 'readwrite');
    for (const s of stores) t.objectStore(s).clear();
    await txDone(t);
  },

  async estimate() {
    if (navigator.storage && navigator.storage.estimate) {
      try { return await navigator.storage.estimate(); } catch { /* ignore */ }
    }
    return null;
  },
  async persist() {
    if (navigator.storage && navigator.storage.persist) {
      try { return await navigator.storage.persist(); } catch { return false; }
    }
    return false;
  },
};
