/**
 * index.js — Life Admin Agent entry point
 *
 * Starts the Photon iMessage watcher and the reminder scheduler.
 * All incoming messages are routed through handleMessage().
 */

require('dotenv').config()
const express = require('express')

const { IMessageSDK } = require('@photon-ai/imessage-kit')
const { transcribe } = require('./transcriber')
const { classify } = require('./classifier')
const { startScheduler } = require('./scheduler')
const db = require('./db')
const r = require('./responses')

const PHONE = process.env.MY_PHONE_NUMBER

// ── Message debounce buffer ───────────────────────────────────────────────────
//
// Problem: iMessage fires two Photon events when a message contains a URL —
// first the text, then a "richlink" preview card with no text. This causes
// Carl to process the same message twice (or process an empty follow-up).
//
// Fix: collect all events from the same sender within a 1.2s window, then
// process them as one combined input. The richlink event has no text and no
// audio, so it's naturally filtered out during the flush.

const DEBOUNCE_MS = 5000
const messageBuffer = new Map() // sender → { timer, text, audioAttachment }

function bufferMessage(msg, sdk) {
  const sender = msg.sender || PHONE
  const text = msg.text?.trim() || ''
  const audioAttachment = (msg.attachments || []).find((a) =>
    a.isAudioAttachment?.() ||
    a.mimeType?.startsWith('audio/') ||
    /\.(caf|m4a|mp3|wav)$/i.test(a.path || '')
  )

  // Skip pure richlink events (no text, no audio — just a URL preview card)
  if (!text && !audioAttachment) {
    console.log(`[index] Skipped richlink/empty event from ${sender}`)
    return
  }

  if (messageBuffer.has(sender)) {
    const buf = messageBuffer.get(sender)
    clearTimeout(buf.timer)
    // Append any new text (space-separated); keep first audio if already set
    if (text) buf.text = buf.text ? `${buf.text} ${text}` : text
    if (audioAttachment && !buf.audioAttachment) buf.audioAttachment = audioAttachment
    buf.timer = setTimeout(() => flushBuffer(sender, sdk), DEBOUNCE_MS)
  } else {
    const buf = { text, audioAttachment: audioAttachment || null, timer: null }
    buf.timer = setTimeout(() => flushBuffer(sender, sdk), DEBOUNCE_MS)
    messageBuffer.set(sender, buf)
  }
}

function flushBuffer(sender, sdk) {
  const buf = messageBuffer.get(sender)
  messageBuffer.delete(sender)
  if (!buf) return
  // Construct a minimal message object handleMessage expects
  const synthetic = {
    sender,
    text: buf.text,
    attachments: buf.audioAttachment ? [buf.audioAttachment] : [],
  }
  handleMessage(synthetic, sdk)
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  if (!PHONE) {
    console.error('❌ MY_PHONE_NUMBER not set in .env')
    process.exit(1)
  }

  const sdk = new IMessageSDK({ debug: false })

  startScheduler(sdk)

  await sdk.startWatching({
    onMessage: (msg) => bufferMessage(msg, sdk),
  })

  console.log('✅ Carl is running — watching for iMessages...')

  // ── Dashboard API Server ───────────────────────────────────────────────────
  const app = express()
  app.use(express.json())

  // Allow CORS so the local dashboard can call this API
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') return res.sendStatus(200)
    next()
  })

  app.post('/api/send-welcome', async (req, res) => {
    const { phoneNumber } = req.body
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number is required.' })

    try {
      console.log(`[API] Sending onboarding text to ${phoneNumber}`)
      await sdk.send(phoneNumber, r.onboarding())
      res.json({ success: true, message: 'Welcome text sent successfully.' })
    } catch (error) {
      console.error('[API] Failed to send welcome text:', error.message)
      res.status(500).json({ error: 'Failed to send text.' })
    }
  })

  const PORT = process.env.PORT || 3001
  app.listen(PORT, () => console.log(`🌐 Dashboard API listening on port ${PORT}`))
}

// ── Message handler ───────────────────────────────────────────────────────────

async function handleMessage(msg, sdk) {
  // Respond back to whoever sent the message.
  // MY_PHONE_NUMBER is only used by the scheduler for proactive reminders.
  const sender = msg.sender || PHONE
  const send = (text) => sdk.send(sender, text)

  try {
    // ── 1. Extract text (or transcribe voice memo) ──────────────────────────
    let text = msg.text?.trim() || ''

    const audioAttachment = (msg.attachments || []).find((a) =>
      a.isAudioAttachment?.() ||
      a.mimeType?.startsWith('audio/') ||
      /\.(caf|m4a|mp3|wav)$/i.test(a.path || '')
    )

    if (audioAttachment) {
      console.log(`[index] Voice memo: ${audioAttachment.path}`)
      const transcript = await transcribe(audioAttachment.path)
      if (!transcript) {
        await send(r.voiceError())
        return
      }
      text = transcript
      console.log(`[index] Transcribed: "${text}"`)
    }

    if (!text) return  // empty message, ignore

    // ── 2. Onboarding ────────────────────────────────────────────────────────
    if (!db.isOnboarded(sender)) {
      await send(r.onboarding())
      db.markOnboarded(sender)
      return
    }

    // ── 3. Multi-turn disambiguation ─────────────────────────────────────────
    const pending = db.getPendingAction(sender)
    if (pending) {
      await handleDisambiguation(text, pending, sdk, sender)
      return
    }

    // ── 4. Classify intent ───────────────────────────────────────────────────
    const intent = await classify(text)

    // ── 5. Route ─────────────────────────────────────────────────────────────
    switch (intent.intent) {
      case 'bookmark':      await bookmarkFlow(intent, send, sender); break
      case 'reminder':      await reminderFlow(intent, send, sender); break
      case 'query':         await queryFlow(intent, send, sender); break
      case 'list_all':      await listAllFlow(send, sender); break
      case 'delete':        await deleteFlow(intent, send, sender); break
      case 'clear_all':     await clearAllFlow(intent, send, sender); break
      case 'conversational': await send(r.conversational(intent.reply)); break
      default:              await send(r.unknownIntent()); break
    }

  } catch (err) {
    console.error(`[index] Unhandled error: ${err.message}`)
    await sdk.send(sender, r.apiError())
  }
}

// ── Intent flows ──────────────────────────────────────────────────────────────

async function bookmarkFlow(intent, send, sender) {
  const { item, context, entity_tags = [] } = intent

  if (!item) {
    await send(r.unknownIntent())
    return
  }

  // Check for duplicate: same item text (case-insensitive) or overlapping tags
  const tagMatches = entity_tags.length > 0 ? db.searchByEntityTags(entity_tags, sender) : []
  const textMatches = db.searchBookmarks(item, sender)
  const allMatches = _dedup([...tagMatches, ...textMatches])
  const duplicate = allMatches.find(
    (b) => b.item.toLowerCase() === item.toLowerCase()
  ) || (allMatches.length > 0 && tagMatches.length > 0 ? allMatches[0] : null)

  if (duplicate) {
    db.setPendingAction({
      type: 'duplicate_bookmark',
      existingId: duplicate.id,
      existingItem: duplicate.item,
      newItem: item,
      newContext: context || null,
      newTags: entity_tags,
    }, sender)
    await send(r.duplicateFound(duplicate.item))
    return
  }

  const id = db.addBookmark({ sender, item, context, tags: entity_tags })
  console.log(`[index] Bookmark #${id} added for ${sender}: "${item}"`)

  // Smart linking: find related bookmarks by tag (exclude the one we just saved)
  const linked = entity_tags.length > 0
    ? db.searchByEntityTags(entity_tags, sender).filter((b) => b.id !== id)
    : []

  await send(r.bookmarkConfirmed(item, context, linked))
}

async function reminderFlow(intent, send, sender = '') {
  const { task, remind_at, urgency = 'low', entity_tags = [] } = intent

  // Vague reminder — no task provided
  if (!task || task.trim().length < 5) {
    db.setPendingAction({ type: 'vague_reminder' }, sender)
    await send(r.vagueReminderAsk())
    return
  }

  // Past reminder time
  if (remind_at && new Date(remind_at) < new Date()) {
    db.setPendingAction({ type: 'past_reminder', task, urgency, entity_tags }, sender)
    await send(r.pastTimeAsk(task))
    return
  }

  // Compute remind_at if not set (urgency defaults)
  const finalRemindAt = remind_at || _urgencyDefault(urgency)

  const id = db.addReminder({ sender, task, remind_at: finalRemindAt, urgency, entity_tags })
  console.log(`[index] Reminder #${id} added for ${sender}: "${task}" at ${finalRemindAt}`)

  // Smart linking
  const linked = entity_tags.length > 0 ? db.searchByEntityTags(entity_tags, sender) : []

  await send(r.reminderConfirmed(task, finalRemindAt, urgency, linked))
}

async function queryFlow(intent, send, sender) {
  const query = intent.query || intent.task || ''
  if (!query) {
    await send(r.unknownIntent())
    return
  }

  const bookmarks = db.searchBookmarks(query, sender)
  const reminders = db.searchReminders(query, sender)
  await send(r.queryResults(bookmarks, reminders, query))
}

async function listAllFlow(send, sender) {
  const { bookmarks, reminders } = db.listAll(sender)
  await send(r.formatListAll(bookmarks, reminders))
}

async function deleteFlow(intent, send, sender) {
  const query = intent.query || intent.task || ''
  if (!query) {
    await send(r.unknownIntent())
    return
  }

  const bookmarks = db.searchBookmarks(query, sender).map((b) => ({
    id: b.id,
    kind: 'bookmark',
    description: b.item,
  }))
  const reminders = db.searchReminders(query, sender).map((rem) => ({
    id: rem.id,
    kind: 'reminder',
    description: rem.task,
  }))
  const matches = [...bookmarks, ...reminders]

  if (matches.length === 0) {
    await send(r.noResults(query))
    return
  }

  if (matches.length === 1) {
    _deleteItem(matches[0])
    await send(r.deleteConfirmed(matches[0].kind, matches[0].description))
    return
  }

  // Multiple matches — ask user to pick
  db.setPendingAction({ type: 'delete_ambiguous', matches }, sender)
  await send(r.disambiguateDelete(matches))
}

async function clearAllFlow(intent, send, sender) {
  const target = intent.clear_target || 'all'

  if (target === 'bookmarks') {
    const count = db.deleteAllBookmarks(sender)
    await send(r.clearAllConfirmed('bookmarks', count))
  } else if (target === 'reminders') {
    const count = db.deleteAllReminders(sender)
    await send(r.clearAllConfirmed('reminders', count))
  } else {
    const bCount = db.deleteAllBookmarks(sender)
    const rCount = db.deleteAllReminders(sender)
    await send(r.clearAllConfirmed('all', { bookmarks: bCount, reminders: rCount }))
  }
}

// ── Disambiguation handler ────────────────────────────────────────────────────

async function handleDisambiguation(text, pending, sdk, sender) {
  const send = (msg) => sdk.send(sender, msg)
  const lower = text.toLowerCase().trim()

  switch (pending.type) {

    case 'delete_ambiguous': {
      const num = parseInt(text.trim(), 10)
      const idx = num - 1
      if (!isNaN(num) && idx >= 0 && idx < pending.matches.length) {
        const match = pending.matches[idx]
        _deleteItem(match)
        db.clearPendingAction(sender)
        await send(r.deleteConfirmed(match.kind, match.description))
      } else {
        // Re-ask
        await send(r.disambiguateDelete(pending.matches))
      }
      break
    }

    case 'duplicate_bookmark': {
      if (lower.includes('update') || lower.includes('yes')) {
        db.updateBookmark(pending.existingId, {
          item: pending.newItem,
          context: pending.newContext,
          tags: pending.newTags,
        })
        db.clearPendingAction(sender)
        await send(r.duplicateUpdated(pending.newItem))
      } else if (lower.includes('new') || lower.includes('save') || lower.includes('no')) {
        const id = db.addBookmark({
          sender,
          item: pending.newItem,
          context: pending.newContext,
          tags: pending.newTags,
        })
        console.log(`[index] New bookmark #${id} saved despite duplicate: "${pending.newItem}"`)
        db.clearPendingAction(sender)
        await send(r.bookmarkConfirmed(pending.newItem, pending.newContext))
      } else {
        await send(r.duplicateFound(pending.existingItem))
      }
      break
    }

    case 'vague_reminder': {
      const clarified = await classify(`Remind me to ${text}`)
      db.clearPendingAction(sender)
      if (clarified.intent === 'reminder' && clarified.task && clarified.task.length >= 5) {
        await reminderFlow(clarified, send, sender)
      } else {
        await send(r.unknownIntent())
      }
      break
    }

    case 'past_reminder': {
      if (/^(yes|yeah|yep|sure|ok|okay|yup)$/i.test(lower)) {
        const tomorrow8am = _nextMorning8am()
        const id = db.addReminder({
          sender,
          task: pending.task,
          remind_at: tomorrow8am,
          urgency: pending.urgency,
          entity_tags: pending.entity_tags,
        })
        console.log(`[index] Rescheduled reminder #${id} to tomorrow 8am for ${sender}`)
        db.clearPendingAction(sender)
        await send(r.reminderConfirmed(pending.task, tomorrow8am, pending.urgency))
      } else if (/^(no|nope|nah|cancel)$/i.test(lower)) {
        db.clearPendingAction(sender)
        await send(r.pastTimeCancelled())
      } else {
        await send(r.pastTimeAsk(pending.task))
      }
      break
    }

    default:
      db.clearPendingAction(sender)
      break
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _deleteItem(match) {
  if (match.kind === 'reminder') {
    db.cancelReminder(match.id)
  } else {
    db.deleteBookmark(match.id)
  }
}

function _dedup(arr) {
  const seen = new Set()
  return arr.filter((b) => {
    if (seen.has(b.id)) return false
    seen.add(b.id)
    return true
  })
}

function _urgencyDefault(urgency) {
  const now = new Date()
  const hour = now.getHours()

  if (urgency === 'high') {
    if (hour >= 17) return _nextMorning8am()
    return new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString()
  }

  if (urgency === 'medium') {
    // Same day at 7pm
    const today7pm = new Date(now)
    today7pm.setHours(19, 0, 0, 0)
    if (today7pm > now) return today7pm.toISOString()
    return _nextMorning8am()
  }

  // low — next morning at 8am
  return _nextMorning8am()
}

function _nextMorning8am() {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(8, 0, 0, 0)
  return tomorrow.toISOString()
}

// ── Start ─────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('❌ Fatal error:', err.message)
  process.exit(1)
})
