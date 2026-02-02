/**
 * IndexedDB Storage Layer for RiftBound Scanner
 *
 * Stores:
 *   - Reference card hashes (for pHash matching)
 *   - Card metadata (from Riftcodex/Riot API)
 *   - User scan history
 */

const DB_NAME = 'riftbound-scanner';
const DB_VERSION = 1;

const STORES = {
  CARDS: 'cards',           // Card metadata
  HASHES: 'hashes',         // pHash reference hashes
  SCAN_HISTORY: 'scans',    // Scan sessions
};

let dbInstance = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Cards store
      if (!db.objectStoreNames.contains(STORES.CARDS)) {
        const cardStore = db.createObjectStore(STORES.CARDS, { keyPath: 'id' });
        cardStore.createIndex('by_set', 'set', { unique: false });
        cardStore.createIndex('by_collector', ['set', 'collectorNumber'], { unique: true });
        cardStore.createIndex('by_name', 'name', { unique: false });
      }

      // Hashes store
      if (!db.objectStoreNames.contains(STORES.HASHES)) {
        const hashStore = db.createObjectStore(STORES.HASHES, { keyPath: 'cardId' });
        hashStore.createIndex('by_hash', 'hash', { unique: false });
        hashStore.createIndex('by_set', 'set', { unique: false });
      }

      // Scan history store
      if (!db.objectStoreNames.contains(STORES.SCAN_HISTORY)) {
        const scanStore = db.createObjectStore(STORES.SCAN_HISTORY, {
          keyPath: 'id',
          autoIncrement: true,
        });
        scanStore.createIndex('by_date', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject(new Error(`IndexedDB error: ${event.target.error?.message}`));
    };
  });
}

/**
 * Generic transaction helper
 */
async function withTransaction(storeName, mode, callback) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = callback(store);

    tx.oncomplete = () => resolve(result);
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ─── Card Metadata Operations ─────────────────────────────────────────────

/**
 * Store an array of cards from the API
 */
export async function storeCards(cards) {
  const db = await openDB();
  const tx = db.transaction(STORES.CARDS, 'readwrite');
  const store = tx.objectStore(STORES.CARDS);

  for (const card of cards) {
    store.put(card);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(cards.length);
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Get all cards, optionally filtered by set
 */
export async function getCards(setId = null) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CARDS, 'readonly');
    const store = tx.objectStore(STORES.CARDS);

    let request;
    if (setId) {
      const index = store.index('by_set');
      request = index.getAll(setId);
    } else {
      request = store.getAll();
    }

    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Get a card by its ID
 */
export async function getCard(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CARDS, 'readonly');
    const store = tx.objectStore(STORES.CARDS);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Look up a card by set and collector number
 */
export async function getCardByCollector(set, collectorNumber) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CARDS, 'readonly');
    const store = tx.objectStore(STORES.CARDS);
    const index = store.index('by_collector');
    const request = index.get([set, collectorNumber]);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

// ─── Hash Operations ──────────────────────────────────────────────────────

/**
 * Store reference hashes for cards
 * @param {Array<{cardId: string, hash: number, set: string}>} hashes
 */
export async function storeHashes(hashes) {
  const db = await openDB();
  const tx = db.transaction(STORES.HASHES, 'readwrite');
  const store = tx.objectStore(STORES.HASHES);

  for (const entry of hashes) {
    store.put(entry);
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(hashes.length);
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Get all reference hashes, optionally filtered by set
 * @returns {Array<{cardId: string, hash: number, set: string}>}
 */
export async function getHashes(setId = null) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.HASHES, 'readonly');
    const store = tx.objectStore(STORES.HASHES);

    let request;
    if (setId) {
      const index = store.index('by_set');
      request = index.getAll(setId);
    } else {
      request = store.getAll();
    }

    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Count stored hashes
 */
export async function getHashCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.HASHES, 'readonly');
    const store = tx.objectStore(STORES.HASHES);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

// ─── Scan History ─────────────────────────────────────────────────────────

/**
 * Save a scan session
 */
export async function saveScanSession(session) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SCAN_HISTORY, 'readwrite');
    const store = tx.objectStore(STORES.SCAN_HISTORY);
    const request = store.add({
      ...session,
      timestamp: new Date().toISOString(),
    });
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

// ─── Utility ──────────────────────────────────────────────────────────────

/**
 * Check if the database has been populated
 */
export async function isDatabasePopulated() {
  try {
    const cards = await getCards();
    return cards.length > 0;
  } catch {
    return false;
  }
}

/**
 * Clear all data (for debugging)
 */
export async function clearAll() {
  const db = await openDB();
  const tx = db.transaction([STORES.CARDS, STORES.HASHES, STORES.SCAN_HISTORY], 'readwrite');
  tx.objectStore(STORES.CARDS).clear();
  tx.objectStore(STORES.HASHES).clear();
  tx.objectStore(STORES.SCAN_HISTORY).clear();
  return new Promise((resolve) => { tx.oncomplete = resolve; });
}
