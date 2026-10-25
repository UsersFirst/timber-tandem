// @ts-check
// ============================================================
// spike-store — the test log, kept in IndexedDB (PLAN §13.1)
// ============================================================
// The host appends log entries as it plays and flushes them here every few
// seconds, so closing the tab never loses a session. Download reads the
// current session, or the most recent one with anything in it when this is
// a fresh page. Only the last few sessions are kept.
// ============================================================

const DB = 'timber-spike';
const KEEP_SESSIONS = 6;

/** @returns {Promise<IDBDatabase|null>} */
function open() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('sessions', { keyPath: 'id' });
        const c = db.createObjectStore('chunks', { autoIncrement: true });
        c.createIndex('session', 'session');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

/** @param {IDBRequest|IDBTransaction} r */
const done = (r) => new Promise((resolve) => {
  if ('oncomplete' in r) { r.oncomplete = () => resolve(true); r.onerror = r.onabort = () => resolve(false); }
  else { r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(null); }
});

export class SpikeStore {
  constructor() {
    this.id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`;
    /** @type {any[]} */
    this.pending = [];
    this.count = 0;
    /** @type {Promise<IDBDatabase|null>} */
    this.db = open();
    this.started = false;
  }

  /** @param {any} entry */
  push(entry) { this.pending.push(entry); this.count++; }

  /** Write what's pending, plus the latest header (seats, scores, constants). @param {any} header */
  async flush(header) {
    const db = await this.db;
    if (!db || (!this.pending.length && this.started)) return;
    const entries = this.pending;
    this.pending = [];
    try {
      const tx = db.transaction(['sessions', 'chunks'], 'readwrite');
      tx.objectStore('sessions').put({ id: this.id, at: Date.now(), count: this.count, header });
      if (entries.length) tx.objectStore('chunks').add({ session: this.id, entries });
      if (!(await done(tx))) this.pending = entries.concat(this.pending);
      if (!this.started) { this.started = true; this._prune(db); }
    } catch { this.pending = entries.concat(this.pending); }
  }

  /** @param {IDBDatabase} db */
  async _prune(db) {
    try {
      const all = /** @type {any[]} */ (await done(db.transaction('sessions').objectStore('sessions').getAll())) || [];
      const old = all.sort((a, b) => b.at - a.at).slice(KEEP_SESSIONS);
      for (const s of old) {
        const tx = db.transaction(['sessions', 'chunks'], 'readwrite');
        tx.objectStore('sessions').delete(s.id);
        const keys = /** @type {IDBValidKey[]} */ (await done(tx.objectStore('chunks').index('session').getAllKeys(s.id))) || [];
        const tx2 = db.transaction('chunks', 'readwrite');
        for (const k of keys) tx2.objectStore('chunks').delete(k);
        await done(tx2);
      }
    } catch { /* pruning is best effort */ }
  }

  /**
   * The log to download: this session if it has entries, else the newest
   * stored session that does.
   * @param {any} header this session's live header
   */
  async dump(header) {
    await this.flush(header);
    const db = await this.db;
    if (!db) return { ...header, log: this.pending, note: 'IndexedDB unavailable: this tab only' };
    const all = /** @type {any[]} */ (await done(db.transaction('sessions').objectStore('sessions').getAll())) || [];
    const pick = this.count > 0 ? all.find((s) => s.id === this.id) : all.filter((s) => s.count > 0).sort((a, b) => b.at - a.at)[0];
    if (!pick) return { ...header, log: [], note: 'no logged session found' };
    const chunks = /** @type {any[]} */ (await done(db.transaction('chunks').objectStore('chunks').index('session').getAll(pick.id))) || [];
    return { ...pick.header, session: pick.id, savedAt: new Date(pick.at).toISOString(), log: chunks.flatMap((c) => c.entries) };
  }
}
