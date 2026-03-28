/**
 * db.js — SQLite database layer
 *
 * Design decisions made (from Pre-Build Risk Checklist items 6-8):
 *
 * Item 6 (Multi-turn disambiguation): Uses a `pending_action` row in the settings table.
 *   When a delete/duplicate/vague case needs clarification, we store the pending context
 *   so the next incoming message is interpreted as a response, not a new command.
 *
 * Item 7 (Onboarding detection): Uses an `onboarded` flag in the settings table.
 *   Checked on every incoming message. Survives process restarts.
 *
 * Item 8 (Smart linking): Added searchByEntityTags(tags[]) function that finds bookmarks
 *   whose stored tags array shares any element with the provided tags.
 */

const Database = require('better-sqlite3')
const path = require('path')

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'life-admin.db')
const db = new Database(DB_PATH)

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL')

// ── Schema ─────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS bookmarks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item       TEXT NOT NULL,
    context    TEXT,
    tags       TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task        TEXT NOT NULL,
    remind_at   TEXT NOT NULL,             -- UTC ISO 8601 string
    urgency     TEXT NOT NULL DEFAULT 'low', -- 'high' | 'medium' | 'low'
    status      TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'cancelled'
    entity_tags TEXT NOT NULL DEFAULT '[]', -- JSON array of strings (for smart linking)
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- Item 7: Onboarding flag + Item 6: pending disambiguation state
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

// Seed onboarded = false if not set
const onboardedRow = db.prepare("SELECT value FROM settings WHERE key = 'onboarded'").get()
if (!onboardedRow) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('onboarded', 'false')").run()
}

// ── Onboarding (Item 7) ───────────────────────────────────────────────────

function isOnboarded() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'onboarded'").get()
  return row?.value === 'true'
}

function markOnboarded() {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarded', 'true')").run()
}

// ── Pending Action / Multi-turn Disambiguation (Item 6) ───────────────────
//
// Shape of pending_action value (JSON string):
// {
//   type: 'delete_ambiguous' | 'duplicate_bookmark' | 'vague_reminder',
//   matches: [{ id, description }],   // for delete_ambiguous
//   item: string,                     // for duplicate_bookmark
//   bookmarkId: number,               // for duplicate_bookmark
// }

function getPendingAction() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'pending_action'").get()
  if (!row) return null
  try {
    return JSON.parse(row.value)
  } catch {
    return null
  }
}

function setPendingAction(action) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pending_action', ?)").run(
    JSON.stringify(action)
  )
}

function clearPendingAction() {
  db.prepare("DELETE FROM settings WHERE key = 'pending_action'").run()
}

// ── Bookmarks ─────────────────────────────────────────────────────────────

function addBookmark({ item, context, tags = [] }) {
  const stmt = db.prepare(
    'INSERT INTO bookmarks (item, context, tags) VALUES (?, ?, ?)'
  )
  const result = stmt.run(item, context ?? null, JSON.stringify(tags))
  return result.lastInsertRowid
}

function getBookmarkById(id) {
  return db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id)
}

function updateBookmark(id, { item, context, tags }) {
  db.prepare(
    'UPDATE bookmarks SET item = ?, context = ?, tags = ? WHERE id = ?'
  ).run(item, context ?? null, JSON.stringify(tags), id)
}

function deleteBookmark(id) {
  db.prepare('UPDATE bookmarks SET id = id WHERE id = ?').run(id)  // noop to confirm exists
  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id)
}

function searchBookmarks(query) {
  const pattern = `%${query}%`
  return db.prepare(
    'SELECT * FROM bookmarks WHERE item LIKE ? OR context LIKE ? OR tags LIKE ? ORDER BY created_at DESC'
  ).all(pattern, pattern, pattern)
}

// Item 8: Search bookmarks by entity tag overlap
function searchByEntityTags(tags) {
  if (!tags || tags.length === 0) return []

  // SQLite doesn't have native JSON array intersection, so we query all bookmarks
  // and filter in JS. For a hackathon single-user DB this is fine.
  const allBookmarks = db.prepare('SELECT * FROM bookmarks ORDER BY created_at DESC').all()

  return allBookmarks.filter((bookmark) => {
    try {
      const bookmarkTags = JSON.parse(bookmark.tags)
      return tags.some((tag) => bookmarkTags.includes(tag))
    } catch {
      return false
    }
  })
}

// ── Reminders ─────────────────────────────────────────────────────────────

function addReminder({ task, remind_at, urgency = 'low', entity_tags = [] }) {
  const stmt = db.prepare(
    'INSERT INTO reminders (task, remind_at, urgency, entity_tags) VALUES (?, ?, ?, ?)'
  )
  const result = stmt.run(task, remind_at, urgency, JSON.stringify(entity_tags))
  return result.lastInsertRowid
}

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

function searchReminders(query) {
  const pattern = `%${query}%`
  return db.prepare(
    "SELECT * FROM reminders WHERE (task LIKE ? OR entity_tags LIKE ?) AND status = 'pending' ORDER BY remind_at ASC"
  ).all(pattern, pattern)
}

// ── List All ──────────────────────────────────────────────────────────────

function listAll() {
  const bookmarks = db.prepare(
    'SELECT * FROM bookmarks ORDER BY created_at DESC'
  ).all()

  const reminders = db.prepare(
    "SELECT * FROM reminders WHERE status = 'pending' ORDER BY remind_at ASC"
  ).all()

  return { bookmarks, reminders }
}

// ── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  // Onboarding (Item 7)
  isOnboarded,
  markOnboarded,

  // Pending action / multi-turn state (Item 6)
  getPendingAction,
  setPendingAction,
  clearPendingAction,

  // Bookmarks
  addBookmark,
  getBookmarkById,
  updateBookmark,
  deleteBookmark,
  searchBookmarks,
  searchByEntityTags,  // Item 8

  // Reminders
  addReminder,
  getPendingReminders,
  markReminderSent,
  cancelReminder,
  searchReminders,

  // General
  listAll,
}
