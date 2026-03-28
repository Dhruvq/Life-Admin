/**
 * index.js — Life Admin Agent entry point
 *
 * Starts the Photon iMessage watcher and the reminder scheduler.
 * All incoming messages are routed through handleMessage().
 */

require('dotenv').config()

const { IMessageSDK } = require('@photon-ai/imessage-kit')
const { transcribe } = require('./transcriber')
const { classify } = require('./classifier')
const { startScheduler } = require('./scheduler')
const db = require('./db')
const r = require('./responses')

const PHONE = process.env.MY_PHONE_NUMBER

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  if (!PHONE) {
    console.error('❌ MY_PHONE_NUMBER not set in .env')
    process.exit(1)
  }

  const sdk = new IMessageSDK({ debug: false })

  startScheduler(sdk)

  await sdk.startWatching({
    onMessage: (msg) => handleMessage(msg, sdk),
  })

  console.log('✅ Carl is running — watching for iMessages...')
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
    if (!db.isOnboarded()) {
      await send(r.onboarding())
      db.markOnboarded()
      return
    }

    // ── 3. Multi-turn disambiguation ─────────────────────────────────────────
    const pending = db.getPendingAction()
    if (pending) {
      await handleDisambiguation(text, pending, sdk, sender)
      return
    }

    // ── 4. Classify intent ───────────────────────────────────────────────────
    const intent = await classify(text)

    // ── 5. Route ─────────────────────────────────────────────────────────────
    switch (intent.intent) {
      case 'bookmark':      await bookmarkFlow(intent, send); break
      case 'reminder':      await reminderFlow(intent, send, sender); break
      case 'query':         await queryFlow(intent, send); break
      case 'list_all':      await listAllFlow(send); break
      case 'delete':        await deleteFlow(intent, send); break
      case 'conversational': await send(r.conversational(intent.reply)); break
      default:              await send(r.unknownIntent()); break
    }

  } catch (err) {
    console.error(`[index] Unhandled error: ${err.message}`)
    await sdk.send(sender, r.apiError())
  }
}

// ── Intent flows ──────────────────────────────────────────────────────────────

async function bookmarkFlow(intent, send) {
  const { item, context, entity_tags = [] } = intent

  if (!item) {
    await send(r.unknownIntent())
    return
  }

  // Check for duplicate: same item text (case-insensitive) or overlapping tags
  const tagMatches = entity_tags.length > 0 ? db.searchByEntityTags(entity_tags) : []
  const textMatches = db.searchBookmarks(item)
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
    })
    await send(r.duplicateFound(duplicate.item))
    return
  }

  const id = db.addBookmark({ item, context, tags: entity_tags })
  console.log(`[index] Bookmark #${id} added: "${item}"`)

  // Smart linking: find related bookmarks by tag (exclude the one we just saved)
  const linked = entity_tags.length > 0
    ? db.searchByEntityTags(entity_tags).filter((b) => b.id !== id)
    : []

  await send(r.bookmarkConfirmed(item, context, linked))
}

async function reminderFlow(intent, send, sender = '') {
  const { task, remind_at, urgency = 'low', entity_tags = [] } = intent

  // Vague reminder — no task provided
  if (!task || task.trim().length < 5) {
    db.setPendingAction({ type: 'vague_reminder', sender })
    await send(r.vagueReminderAsk())
    return
  }

  // Past reminder time
  if (remind_at && new Date(remind_at) < new Date()) {
    db.setPendingAction({ type: 'past_reminder', task, urgency, entity_tags, sender })
    await send(r.pastTimeAsk(task))
    return
  }

  // Compute remind_at if not set (urgency defaults)
  const finalRemindAt = remind_at || _urgencyDefault(urgency)

  const id = db.addReminder({ task, remind_at: finalRemindAt, urgency, entity_tags, sender })
  console.log(`[index] Reminder #${id} added: "${task}" at ${finalRemindAt}`)

  // Smart linking
  const linked = entity_tags.length > 0 ? db.searchByEntityTags(entity_tags) : []

  await send(r.reminderConfirmed(task, finalRemindAt, urgency, linked))
}

async function queryFlow(intent, send) {
  const query = intent.query || intent.task || ''
  if (!query) {
    await send(r.unknownIntent())
    return
  }

  const bookmarks = db.searchBookmarks(query)
  const reminders = db.searchReminders(query)
  await send(r.queryResults(bookmarks, reminders, query))
}

async function listAllFlow(send) {
  const { bookmarks, reminders } = db.listAll()
  await send(r.formatListAll(bookmarks, reminders))
}

async function deleteFlow(intent, send) {
  const query = intent.query || intent.task || ''
  if (!query) {
    await send(r.unknownIntent())
    return
  }

  const bookmarks = db.searchBookmarks(query).map((b) => ({
    id: b.id,
    kind: 'bookmark',
    description: b.item,
  }))
  const reminders = db.searchReminders(query).map((rem) => ({
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
  db.setPendingAction({ type: 'delete_ambiguous', matches })
  await send(r.disambiguateDelete(matches))
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
        db.clearPendingAction()
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
        db.clearPendingAction()
        await send(r.duplicateUpdated(pending.newItem))
      } else if (lower.includes('new') || lower.includes('save') || lower.includes('no')) {
        const id = db.addBookmark({
          item: pending.newItem,
          context: pending.newContext,
          tags: pending.newTags,
        })
        console.log(`[index] New bookmark #${id} saved despite duplicate: "${pending.newItem}"`)
        db.clearPendingAction()
        await send(r.bookmarkConfirmed(pending.newItem, pending.newContext))
      } else {
        await send(r.duplicateFound(pending.existingItem))
      }
      break
    }

    case 'vague_reminder': {
      // Re-classify with the clarification as a reminder
      const clarified = await classify(`Remind me to ${text}`)
      db.clearPendingAction()
      if (clarified.intent === 'reminder' && clarified.task && clarified.task.length >= 5) {
        await reminderFlow(clarified, send, pending.sender || sender)
      } else {
        await send(r.unknownIntent())
      }
      break
    }

    case 'past_reminder': {
      if (/^(yes|yeah|yep|sure|ok|okay|yup)$/i.test(lower)) {
        const tomorrow8am = _nextMorning8am()
        const id = db.addReminder({
          task: pending.task,
          remind_at: tomorrow8am,
          urgency: pending.urgency,
          entity_tags: pending.entity_tags,
          sender: pending.sender || sender,
        })
        console.log(`[index] Rescheduled reminder #${id} to tomorrow 8am`)
        db.clearPendingAction()
        await send(r.reminderConfirmed(pending.task, tomorrow8am, pending.urgency))
      } else if (/^(no|nope|nah|cancel)$/i.test(lower)) {
        db.clearPendingAction()
        await send(r.pastTimeCancelled())
      } else {
        await send(r.pastTimeAsk(pending.task))
      }
      break
    }

    default:
      db.clearPendingAction()
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
