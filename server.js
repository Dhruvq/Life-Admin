/**
 * server.js — Carl web dashboard
 *
 * Express server that serves the frontend and exposes REST API endpoints.
 * Shares the same SQLite database as index.js (the iMessage watcher).
 * Uses a separate IMessageSDK instance just for sending (no startWatching).
 */

require('dotenv').config()

const express = require('express')
const path = require('path')
const { IMessageSDK } = require('@photon-ai/imessage-kit')
const db = require('./db')
const r = require('./responses')

const PORT = process.env.WEB_PORT || 3000
const app = express()

// SDK instance for sending only — no startWatching
const sdk = new IMessageSDK({ debug: false })

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ── Bookmarks ─────────────────────────────────────────────────────────────────

// GET /api/data?phone=+16501234567
app.get('/api/data', (req, res) => {
  const { phone } = req.query
  if (!phone) return res.status(400).json({ error: 'phone required' })
  const { bookmarks, reminders } = db.listAll(phone)
  res.json({ bookmarks, reminders })
})

// POST /api/bookmarks  { phone, item, context? }
app.post('/api/bookmarks', (req, res) => {
  const { phone, item, context } = req.body
  if (!phone || !item) return res.status(400).json({ error: 'phone and item required' })
  const id = db.addBookmark({ sender: phone, item, context: context || null, tags: [] })
  res.json({ id })
})

// DELETE /api/bookmarks/:id
app.delete('/api/bookmarks/:id', (req, res) => {
  db.deleteBookmark(parseInt(req.params.id, 10))
  res.json({ ok: true })
})

// ── Reminders ─────────────────────────────────────────────────────────────────

// POST /api/reminders  { phone, task, remind_at (ISO), urgency }
app.post('/api/reminders', (req, res) => {
  const { phone, task, remind_at } = req.body
  if (!phone || !task || !remind_at) {
    return res.status(400).json({ error: 'phone, task, and remind_at required' })
  }
  if (new Date(remind_at) < new Date(Date.now() + 60000)) {
    return res.status(400).json({ error: 'remind_at must be at least 1 minute in the future' })
  }
  // Web dashboard always provides an exact time via the datetime picker → scheduled
  const id = db.addReminder({ sender: phone, task, remind_at, urgency: 'scheduled', entity_tags: [] })
  res.json({ id })
})

// DELETE /api/reminders/:id
app.delete('/api/reminders/:id', (req, res) => {
  db.cancelReminder(parseInt(req.params.id, 10))
  res.json({ ok: true })
})

// ── Bulk clear ────────────────────────────────────────────────────────────────

// POST /api/clear  { phone, target: 'bookmarks'|'reminders'|'all' }
app.post('/api/clear', (req, res) => {
  const { phone, target = 'all' } = req.body
  if (!phone) return res.status(400).json({ error: 'phone required' })

  let bCount = 0
  let rCount = 0
  if (target === 'bookmarks' || target === 'all') bCount = db.deleteAllBookmarks(phone)
  if (target === 'reminders' || target === 'all') rCount = db.deleteAllReminders(phone)

  res.json({ bookmarks: bCount, reminders: rCount })
})

// ── Onboarding ────────────────────────────────────────────────────────────────

// POST /api/onboard  { phone }
// Sends the Carl intro iMessage and marks the user as onboarded in the DB.
app.post('/api/onboard', async (req, res) => {
  const { phone } = req.body
  if (!phone) return res.status(400).json({ error: 'phone required' })
  try {
    await sdk.send(phone, r.onboarding())
    db.markOnboarded(phone)
    res.json({ ok: true })
  } catch (err) {
    console.error(`[server] Onboard send failed: ${err.message}`)
    res.status(500).json({ error: err.message })
  }
})

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅ Carl dashboard running at http://localhost:${PORT}`)
})
