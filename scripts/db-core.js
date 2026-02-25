/**
 * db-core.js
 * Core database engine for Manifest App
 * Loads manifest.db via sql.js, persists to IndexedDB
 */

const DB = (() => {
  const IDB_NAME    = 'manifest_store';
  const IDB_VERSION = 1;
  const IDB_STORE   = 'db_file';
  const IDB_KEY     = 'manifest.db';
  const DB_URL      = 'data/manifest.db'; // bundled seed DB

  let _db   = null;  // sql.js database instance
  let _SQL  = null;  // sql.js constructor
  let _dirty = false; // tracks if a write has occurred

  // ── IndexedDB helpers ──────────────────────────────────────────────────────

  function _openIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function _loadFromIDB() {
    const idb = await _openIDB();
    return new Promise((resolve, reject) => {
      const tx  = idb.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = e => resolve(e.target.result || null);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function _saveToIDB(uint8Array) {
    const idb = await _openIDB();
    return new Promise((resolve, reject) => {
      const tx  = idb.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).put(uint8Array, IDB_KEY);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ── DB initialisation ──────────────────────────────────────────────────────

  async function init(sqlJsConfig = {}) {
    if (_db) return _db; // already initialised

    // Load sql.js
    _SQL = await initSqlJs(sqlJsConfig);

    // Try loading existing DB from IndexedDB first
    const saved = await _loadFromIDB();

    if (saved) {
      _db = new _SQL.Database(saved);
      console.log('[DB] Loaded from IndexedDB');
    } else {
      // First run — fetch the bundled seed DB
      const res = await fetch(DB_URL);
      if (!res.ok) throw new Error(`Failed to fetch seed DB: ${res.status}`);
      const buf = await res.arrayBuffer();
      _db = new _SQL.Database(new Uint8Array(buf));
      await _saveToIDB(_db.export()); // persist immediately
      console.log('[DB] Loaded from seed file and saved to IndexedDB');
    }

    // Always enforce foreign keys per connection
    _db.run('PRAGMA foreign_keys = ON;');

    return _db;
  }

  // ── Query interface ────────────────────────────────────────────────────────

  /**
   * Run a SELECT query. Returns array of row objects.
   * @param {string} sql
   * @param {Array|Object} params
   * @returns {Array<Object>}
   */
  function query(sql, params = []) {
    if (!_db) throw new Error('[DB] Not initialised. Call DB.init() first.');
    const stmt    = _db.prepare(sql);
    const results = [];
    stmt.bind(params);
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  /**
   * Run an INSERT / UPDATE / DELETE.
   * Auto-persists to IndexedDB after write.
   * @param {string} sql
   * @param {Array|Object} params
   * @returns {{ changes: number, lastInsertRowid: number }}
   */
  async function run(sql, params = []) {
    if (!_db) throw new Error('[DB] Not initialised. Call DB.init() first.');
    _db.run(sql, params);
    _dirty = true;
    await persist();
    return {
      changes:         _db.getRowsModified(),
      lastInsertRowid: _db.exec('SELECT last_insert_rowid()')[0]?.values[0][0]
    };
  }

  /**
   * Run multiple statements in a transaction.
   * Rolls back everything if any statement fails.
   * @param {Function} fn  async function receiving { query, run }
   */
  async function transaction(fn) {
    if (!_db) throw new Error('[DB] Not initialised.');
    _db.run('BEGIN;');
    try {
      await fn({ query, run: _runInTransaction });
      _db.run('COMMIT;');
      _dirty = true;
      await persist();
    } catch (err) {
      _db.run('ROLLBACK;');
      throw err;
    }
  }

  // Internal run that doesn't auto-persist (used inside transactions)
  function _runInTransaction(sql, params = []) {
    _db.run(sql, params);
    return {
      changes:         _db.getRowsModified(),
      lastInsertRowid: _db.exec('SELECT last_insert_rowid()')[0]?.values[0][0]
    };
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  /**
   * Save current DB state to IndexedDB.
   * Called automatically after every run/transaction.
   */
  async function persist() {
    if (!_db || !_dirty) return;
    await _saveToIDB(_db.export());
    _dirty = false;
    console.log('[DB] Persisted to IndexedDB');
  }

  // ── Export / Restore (Help page backup) ───────────────────────────────────

  /**
   * Export DB as a downloadable .db file
   */
  function exportDB(filename = 'manifest-backup.db') {
    if (!_db) throw new Error('[DB] Not initialised.');
    const data = _db.export();
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Restore DB from a .db file picked by the user
   * @param {File} file
   */
  async function restoreDB(file) {
    const buf    = await file.arrayBuffer();
    const uint8  = new Uint8Array(buf);
    if (_db) _db.close();
    _db = new _SQL.Database(uint8);
    _db.run('PRAGMA foreign_keys = ON;');
    await _saveToIDB(_db.export());
    console.log('[DB] Restored from file');
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  /**
   * Format a number as Naira currency string
   * DB always stores plain numbers — symbol added only at display time
   */
  function formatNaira(amount) {
    if (amount === null || amount === undefined) return '—';
    return `₦${Number(amount).toLocaleString('en-NG')}`;
  }

  /**
   * Generate a booking code  e.g. TRP-20250420-00A3
   */
  function generateBookingCode() {
    const date    = new Date();
    const y       = date.getFullYear();
    const m       = String(date.getMonth() + 1).padStart(2, '0');
    const d       = String(date.getDate()).padStart(2, '0');
    const rand    = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `TRP-${y}${m}${d}-${rand}`;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    init,
    query,
    run,
    transaction,
    persist,
    exportDB,
    restoreDB,
    formatNaira,
    generateBookingCode,
  };

})();
