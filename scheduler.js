/**
 * scheduler.js — Proactive reminder delivery
 *
 * Polls the reminders table every 30 seconds.
 * For each reminder where remind_at <= now and status = 'pending',
 * sends a message via Photon and marks it as sent.
 */

const { getPendingReminders, markReminderSent } = require('./db')
const { reminderFired } = require('./responses')

const POLL_INTERVAL_MS = 30_000

/**
 * Start the reminder scheduler.
 * @param {object} sdk — IMessageSDK instance
 * @returns {NodeJS.Timeout} — the interval handle (call clearInterval to stop)
 */
function startScheduler(sdk) {
  const phoneNumber = process.env.MY_PHONE_NUMBER

  if (!phoneNumber) {
    console.error('[scheduler] MY_PHONE_NUMBER not set — proactive reminders disabled')
    return null
  }

  console.log(`[scheduler] Started — polling every ${POLL_INTERVAL_MS / 1000}s`)

  const interval = setInterval(async () => {
    try {
      const due = getPendingReminders()
      if (due.length === 0) return

      console.log(`[scheduler] ${due.length} reminder(s) due`)

      for (const reminder of due) {
        try {
          // Send to whoever created the reminder; fall back to MY_PHONE_NUMBER
          const target = reminder.sender || phoneNumber
          const msg = reminderFired(reminder.task)
          await sdk.send(target, msg)
          markReminderSent(reminder.id)
          console.log(`[scheduler] Fired reminder #${reminder.id} → ${target}: "${reminder.task}"`)
        } catch (err) {
          console.error(`[scheduler] Failed to send reminder #${reminder.id}: ${err.message}`)
        }
      }
    } catch (err) {
      console.error(`[scheduler] Poll error: ${err.message}`)
    }
  }, POLL_INTERVAL_MS)

  return interval
}

module.exports = { startScheduler }
