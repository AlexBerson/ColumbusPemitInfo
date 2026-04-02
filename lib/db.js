const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, '..', 'data.sqlite');

let db;

function init() {
  if (db) return;
  db = new Database(DB_PATH);

  db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
    key TEXT PRIMARY KEY,
    storageState TEXT,
    lastUpdated INTEGER
  )`).run();

  db.prepare(`CREATE TABLE IF NOT EXISTS permits (
    permitNo TEXT PRIMARY KEY,
    data TEXT,
    lastSynced INTEGER
  )`).run();
}

function saveSession(key, storageState) {
  init();
  const stmt = db.prepare('INSERT OR REPLACE INTO sessions (key, storageState, lastUpdated) VALUES (?, ?, ?)');
  stmt.run(key, JSON.stringify(storageState), Date.now());
}

function getSession(key) {
  init();
  const row = db.prepare('SELECT storageState, lastUpdated FROM sessions WHERE key = ?').get(key);
  if (!row) return null;
  try {
    return { storageState: JSON.parse(row.storageState), lastUpdated: row.lastUpdated };
  } catch (e) {
    return null;
  }
}

function savePermit(permitNo, data) {
  init();
  const stmt = db.prepare('INSERT OR REPLACE INTO permits (permitNo, data, lastSynced) VALUES (?, ?, ?)');
  stmt.run(permitNo, JSON.stringify(data), Date.now());
}

function getPermit(permitNo) {
  init();
  const row = db.prepare('SELECT data, lastSynced FROM permits WHERE permitNo = ?').get(permitNo);
  if (!row) return null;
  try {
    return { data: JSON.parse(row.data), lastSynced: row.lastSynced };
  } catch (e) {
    return null;
  }
}

function getAllPermits() {
  init();
  const rows = db.prepare('SELECT data FROM permits').all();
  return rows.map(r => JSON.parse(r.data));
}

function getAllPermitsWithMeta() {
  init();
  const rows = db.prepare('SELECT data, lastSynced FROM permits').all();
  return rows.map(r => ({ data: JSON.parse(r.data), lastSynced: r.lastSynced }));
}

module.exports = {
  init,
  saveSession,
  getSession,
  savePermit,
  getPermit,
  getAllPermits,
  getAllPermitsWithMeta,
};
