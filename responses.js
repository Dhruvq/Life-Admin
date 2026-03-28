/**
 * responses.js — All iMessage copy and response formatting in one place.
 *
 * Pure functions only — no API calls, no DB access.
 * Every string the agent sends to the user comes from here.
 */

// ── Date formatting ───────────────────────────────────────────────────────────

/**
 * Formats a UTC ISO string into a friendly relative/absolute string.
 * e.g. "tomorrow at 6pm", "in 3 days", "April 2nd at 2pm"
 */
function formatDate(isoString) {
  const target = new Date(isoString)
  const now = new Date()

  const diffMs = target - now
  const diffMins = Math.round(diffMs / 60_000)
  const diffHours = Math.round(diffMs / 3_600_000)
  const diffDays = Math.round(diffMs / 86_400_000)

  const timeStr = target.toLocaleString('en-US', {
    hour: 'numeric',
    minute: target.getMinutes() !== 0 ? '2-digit' : undefined,
    hour12: true,
  }).toLowerCase()

  if (diffMins <= 2) return 'right now'
  if (diffMins < 60) return `in ${diffMins} minute${diffMins === 1 ? '' : 's'}`
  if (diffHours < 6) return `in about ${diffHours} hour${diffHours === 1 ? '' : 's'}`

  // Check if same calendar day
  const todayStr = now.toDateString()
  const targetStr = target.toDateString()
  const tomorrowStr = new Date(now.getTime() + 86_400_000).toDateString()

  if (targetStr === todayStr) return `today at ${timeStr}`
  if (targetStr === tomorrowStr) return `tomorrow at ${timeStr}`
  if (diffDays < 7) return `in ${diffDays} days at ${timeStr}`

  // Absolute date for anything further
  const dateStr = target.toLocaleString('en-US', { month: 'long', day: 'numeric' })
  return `${dateStr} at ${timeStr}`
}

// ── Onboarding ────────────────────────────────────────────────────────────────

function onboarding() {
  return "Hey! I'm Carl. I keep track of things so you don't have to.\n\nTry something like:\n• 'Bookmark AirPods Max as a gift for Dad'\n• 'Remind me to cancel my Netflix trial in 5 days'\n\nYou can also just send me a voice memo."
}

// ── Bookmark ──────────────────────────────────────────────────────────────────

/**
 * @param {string} item
 * @param {string|null} context
 * @param {Array} linked — related bookmarks found via entity tag overlap
 */
function bookmarkConfirmed(item, context, linked = []) {
  let msg = `📌 Bookmarked — ${item}`
  if (context) msg += ` (${context})`
  if (linked.length > 0) {
    msg += `\n🔗 Related to your saved: ${linked[0].item}`
  }
  return msg
}

function duplicateFound(existingItem) {
  return `You already saved something like that — "${existingItem}". Update it or save a new one? (reply "update" or "new")`
}

function duplicateUpdated(item) {
  return `✅ Updated — ${item}`
}

// ── Reminder ──────────────────────────────────────────────────────────────────

/**
 * @param {string} task
 * @param {string} remindAt — UTC ISO string
 * @param {string} urgency — 'high'|'medium'|'low'
 * @param {Array} linked — related bookmarks found via entity tag overlap
 */
function reminderConfirmed(task, remindAt, urgency, linked = []) {
  const dateStr = formatDate(remindAt)
  let msg = `⏰ Got it — I'll remind you to ${task} ${dateStr}`
  if (urgency === 'high') msg += ' — flagged as urgent'
  if (linked.length > 0) {
    msg += `\n🔗 You saved a ${linked[0].item} for that`
  }
  return msg
}

/**
 * Proactive message sent by the scheduler when a reminder fires.
 */
function reminderFired(task) {
  return `Hey — you wanted to ${task} today`
}

function vagueReminderAsk() {
  return "What did you want to be reminded about?"
}

function pastTimeAsk(task) {
  return `That time's already passed — remind you tomorrow morning at 8am instead? (yes/no)`
}

function pastTimeCancelled() {
  return "Got it, I'll skip that one."
}

// ── Query ─────────────────────────────────────────────────────────────────────

/**
 * @param {Array} bookmarks
 * @param {Array} reminders
 * @param {string} query — the original search term, used in the "no results" message
 */
function queryResults(bookmarks, reminders, query) {
  if (bookmarks.length === 0 && reminders.length === 0) {
    return noResults(query)
  }

  const lines = ["Here's what I've got:"]

  for (const b of bookmarks) {
    const age = _relativeAge(b.created_at)
    const ctx = b.context ? ` — ${b.context}` : ''
    lines.push(`📌 ${b.item}${ctx} (saved ${age})`)
  }

  for (const r of reminders) {
    const dateStr = formatDate(r.remind_at)
    lines.push(`⏰ ${r.task} — ${dateStr}`)
  }

  return lines.join('\n')
}

// ── List All ──────────────────────────────────────────────────────────────────

function formatListAll(bookmarks, reminders) {
  if (bookmarks.length === 0 && reminders.length === 0) {
    return "You've got nothing saved yet. Try 'bookmark [something]' or 'remind me to [something]'"
  }

  const lines = ["Here's what you've got going on:"]

  if (bookmarks.length > 0) {
    lines.push('')
    for (const b of bookmarks) {
      const age = _relativeAge(b.created_at)
      const ctx = b.context ? ` — ${b.context}` : ''
      lines.push(`📌 ${b.item}${ctx} (saved ${age})`)
    }
  }

  if (reminders.length > 0) {
    lines.push('')
    for (const r of reminders) {
      const dateStr = formatDate(r.remind_at)
      lines.push(`⏰ ${r.task} — ${dateStr}`)
    }
  }

  const bCount = bookmarks.length
  const rCount = reminders.length
  const parts = []
  if (bCount > 0) parts.push(`${bCount} bookmark${bCount === 1 ? '' : 's'}`)
  if (rCount > 0) parts.push(`${rCount} reminder${rCount === 1 ? '' : 's'}`)
  lines.push(`\nThat's ${parts.join(' and ')}.`)

  return lines.join('\n')
}

// ── Delete ────────────────────────────────────────────────────────────────────

function clearAllConfirmed(target, count) {
  if (target === 'bookmarks') return `✅ Cleared ${count} bookmark${count === 1 ? '' : 's'}.`
  if (target === 'reminders') return `✅ Cancelled ${count} reminder${count === 1 ? '' : 's'}.`
  return `✅ Cleared everything — ${count.bookmarks} bookmark${count.bookmarks === 1 ? '' : 's'} and ${count.reminders} reminder${count.reminders === 1 ? '' : 's'}.`
}

function deleteConfirmed(kind, description) {
  const label = kind === 'reminder' ? 'reminder' : 'bookmark'
  return `✅ Removed your ${label} — ${description}`
}

/**
 * @param {Array} matches — [{ id, kind, description }]
 */
function disambiguateDelete(matches) {
  const lines = [`I found ${matches.length} matches — which one?`]
  matches.forEach((m, i) => {
    lines.push(`${i + 1}) ${m.description}`)
  })
  return lines.join('\n')
}

// ── Errors & fallbacks ────────────────────────────────────────────────────────

function noResults(query) {
  return `I don't have anything saved about "${query}". Want to bookmark something?`
}

function unknownIntent() {
  return "I'm not sure what to do with that. Try 'bookmark [something]' or 'remind me to [something]'"
}

function apiError() {
  return "Hmm, something went wrong — try again?"
}

function voiceError() {
  return "I couldn't quite make that out. Mind sending another one or typing it instead?"
}

function conversational(reply) {
  return reply || "👍"
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _relativeAge(isoString) {
  const created = new Date(isoString)
  const now = new Date()
  const diffDays = Math.floor((now - created) / 86_400_000)

  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 14) return 'last week'
  return `${Math.floor(diffDays / 7)} weeks ago`
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  formatDate,
  onboarding,
  bookmarkConfirmed,
  duplicateFound,
  duplicateUpdated,
  reminderConfirmed,
  reminderFired,
  vagueReminderAsk,
  pastTimeAsk,
  pastTimeCancelled,
  queryResults,
  formatListAll,
  clearAllConfirmed,
  deleteConfirmed,
  disambiguateDelete,
  noResults,
  unknownIntent,
  apiError,
  voiceError,
  conversational,
}
