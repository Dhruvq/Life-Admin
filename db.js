/**
 * db.js — SQLite database layer
 *
 * Multi-user design: every bookmark, reminder, and settings key is scoped
 * to a sender (phone number string). Each user sees only their own data.
 *
 * Design decisions (from Pre-Build Risk Checklist):
 *   Item 6 — pending_action stored per-sender: key = "pending_action:<sender>"
 *   Item 7 — onboarded flag stored per-sender: key = "onboarded:<sender>"
 *   Item 8 — searchByEntityTags(tags, sender) for smart linking within a user's bookmarks
 */

const Database = require('better-sqlite3')
const path = require('path')

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'life-admin.db')
const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')

// ── Schema ─────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS bookmarks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    sender     TEXT NOT NULL DEFAULT '',
    item       TEXT NOT NULL,
    context    TEXT,
    tags       TEXT NOT NULL DEFAULT '[]',
    link_url   TEXT,
    link_title TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sender      TEXT NOT NULL DEFAULT '',
    task        TEXT NOT NULL,
    remind_at   TEXT NOT NULL,
    urgency     TEXT NOT NULL DEFAULT 'low',
    status      TEXT NOT NULL DEFAULT 'pending',
    entity_tags TEXT NOT NULL DEFAULT '[]',
    link_url    TEXT,
    link_title  TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- Settings: arbitrary key/value, keys are namespaced per-sender where needed
  -- e.g. "onboarded:<phone>", "pending_action:<phone>"
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

// ── Migrations for existing databases ─────────────────────────────────────

try { db.exec("ALTER TABLE bookmarks ADD COLUMN sender TEXT NOT NULL DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE reminders ADD COLUMN sender TEXT NOT NULL DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE bookmarks ADD COLUMN link_url TEXT") } catch {}
try { db.exec("ALTER TABLE bookmarks ADD COLUMN link_title TEXT") } catch {}
try { db.exec("ALTER TABLE reminders ADD COLUMN link_url TEXT") } catch {}
try { db.exec("ALTER TABLE reminders ADD COLUMN link_title TEXT") } catch {}

// ── Onboarding (per-sender) ────────────────────────────────────────────────

function isOnboarded(sender) {
  const key = `onboarded:${sender}`
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row?.value === 'true'
}

function markOnboarded(sender) {
  const key = `onboarded:${sender}`
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, 'true')
}

// ── Pending Action / Multi-turn Disambiguation (per-sender) ───────────────
//
// Shape of pending_action value (JSON string):
// {
//   type: 'delete_ambiguous' | 'duplicate_bookmark' | 'vague_reminder' | 'past_reminder',
//   matches: [{ id, kind, description }],  // delete_ambiguous
//   existingId, existingItem, newItem, newContext, newTags,  // duplicate_bookmark
//   task, urgency, entity_tags,            // past_reminder / vague_reminder
//   sender: string,
// }

function getPendingAction(sender) {
  const key = `pending_action:${sender}`
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  if (!row) return null
  try { return JSON.parse(row.value) } catch { return null }
}

function setPendingAction(action, sender) {
  const key = `pending_action:${sender}`
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    key, JSON.stringify(action)
  )
}

function clearPendingAction(sender) {
  const key = `pending_action:${sender}`
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}

// ── Bookmarks (per-sender) ─────────────────────────────────────────────────

function addBookmark({ sender = '', item, context, tags = [], link_url = null, link_title = null }) {
  const result = db.prepare(
    'INSERT INTO bookmarks (sender, item, context, tags, link_url, link_title) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(sender, item, context ?? null, JSON.stringify(tags), link_url, link_title)
  return result.lastInsertRowid
}

function getBookmarkById(id) {
  return db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id)
}

function updateBookmark(id, { item, context, tags, link_url = null, link_title = null }) {
  db.prepare(
    'UPDATE bookmarks SET item = ?, context = ?, tags = ?, link_url = ?, link_title = ? WHERE id = ?'
  ).run(item, context ?? null, JSON.stringify(tags), link_url, link_title, id)
}

function deleteBookmark(id) {
  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id)
}

function searchBookmarks(query, sender) {
  const pattern = `%${query}%`
  return db.prepare(
    `SELECT * FROM bookmarks
     WHERE sender = ? AND (item LIKE ? OR context LIKE ? OR tags LIKE ?)
     ORDER BY created_at DESC`
  ).all(sender, pattern, pattern, pattern)
}

// Item 8: Search bookmarks by entity tag overlap, scoped to sender
function searchByEntityTags(tags, sender) {
  if (!tags || tags.length === 0) return []
  const allBookmarks = db.prepare(
    'SELECT * FROM bookmarks WHERE sender = ? ORDER BY created_at DESC'
  ).all(sender)
  return allBookmarks.filter((b) => {
    try { return JSON.parse(b.tags).some((t) => tags.includes(t)) } catch { return false }
  })
}

// ── Reminders (per-sender) ─────────────────────────────────────────────────

function addReminder({ sender = '', task, remind_at, urgency = 'low', entity_tags = [], link_url = null, link_title = null }) {
  const result = db.prepare(
    'INSERT INTO reminders (sender, task, remind_at, urgency, entity_tags, link_url, link_title) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(sender, task, remind_at, urgency, JSON.stringify(entity_tags), link_url, link_title)
  return result.lastInsertRowid
}

// Scheduler uses this — returns ALL due reminders across all senders
function getPendingReminders() {
  const nowISO = new Date().toISOString()
  return db.prepare(
    "SELECT * FROM reminders WHERE remind_at <= ? AND status = 'pending'"
  ).all(nowISO)
}

function markReminderSent(id) {
  db.prepare("UPDATE reminders SET status = 'sent' WHERE id = ?").run(id)
}

function cancelReminder(id) {
  db.prepare("UPDATE reminders SET status = 'cancelled' WHERE id = ?").run(id)
}

function deleteAllBookmarks(sender) {
  return db.prepare('DELETE FROM bookmarks WHERE sender = ?').run(sender).changes
}

function deleteAllReminders(sender) {
  return db.prepare("UPDATE reminders SET status = 'cancelled' WHERE sender = ? AND status = 'pending'").run(sender).changes
}

function searchReminders(query, sender) {
  const pattern = `%${query}%`
  return db.prepare(
    `SELECT * FROM reminders
     WHERE sender = ? AND (task LIKE ? OR entity_tags LIKE ?) AND status = 'pending'
     ORDER BY remind_at ASC`
  ).all(sender, pattern, pattern)
}

// ── List All (per-sender) ──────────────────────────────────────────────────

function listAll(sender) {
  const bookmarks = db.prepare(
    'SELECT * FROM bookmarks WHERE sender = ? ORDER BY created_at DESC'
  ).all(sender)
  const reminders = db.prepare(
    "SELECT * FROM reminders WHERE sender = ? AND status = 'pending' ORDER BY remind_at ASC"
  ).all(sender)
  return { bookmarks, reminders }
}

// ── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  isOnboarded,
  markOnboarded,
  getPendingAction,
  setPendingAction,
  clearPendingAction,
  addBookmark,
  getBookmarkById,
  updateBookmark,
  deleteBookmark,
  deleteAllBookmarks,
  searchBookmarks,
  searchByEntityTags,
  addReminder,
  getPendingReminders,
  markReminderSent,
  cancelReminder,
  deleteAllReminders,
  searchReminders,
  listAll,
}
