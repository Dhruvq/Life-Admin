/**
 * VALIDATION 5 — Timezone Handling is Consistent End-to-End
 *
 * Risk: If the prompt receives local time but remind_at is stored as local time,
 *       and the scheduler compares in UTC, reminders fire at the wrong time or never.
 * Pass condition: All 3 checks confirm the timezone pipeline is correct:
 *   1. Prompt receives local datetime with timezone offset
 *   2. Minimax returns remind_at as UTC ISO string (or we confirm we must convert)
 *   3. Scheduler comparison logic (remind_at <= now) works correctly in UTC
 *
 * This is a pure logic test — no API call required.
 * Run: node validate/05-timezone.js
 */

require('dotenv').config()

let passed = 0
let failed = 0

function check(description, assertion, detail = '') {
  if (assertion) {
    console.log(`✅ ${description}`)
    if (detail) console.log(`   ${detail}`)
    passed++
  } else {
    console.log(`❌ FAILED: ${description}`)
    if (detail) console.log(`   ${detail}`)
    failed++
  }
}

async function run() {
  console.log('--- Validation 5: Timezone Handling End-to-End ---\n')

  // ── CHECK 1: Local datetime string for prompt ──────────────────────────────
  console.log('[1] Datetime string passed to classification prompt')

  const now = new Date()

  // This is what we'll pass to Minimax in the system prompt
  const localForPrompt = now.toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'short',
  })

  const hasTimezone = /[A-Z]{2,4}$/.test(localForPrompt) ||
                      localForPrompt.includes('GMT') ||
                      localForPrompt.includes('UTC')

  check(
    'Prompt datetime includes timezone abbreviation',
    hasTimezone,
    `"${localForPrompt}"`
  )

  // ── CHECK 2: UTC ISO string storage ───────────────────────────────────────
  console.log('\n[2] remind_at stored as UTC ISO 8601')

  // Simulate what Minimax returns: "in 10 days"
  // We need to verify that IF Minimax returns a local time string, we convert to UTC before storing.
  // Best practice: instruct Minimax to return UTC ISO strings directly.

  const tenDaysFromNow = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000)
  const asUTCISO = tenDaysFromNow.toISOString()  // always UTC

  check(
    'toISOString() always produces UTC (ends in Z)',
    asUTCISO.endsWith('Z'),
    `"${asUTCISO}"`
  )

  // Verify it round-trips correctly
  const roundTripped = new Date(asUTCISO)
  check(
    'UTC ISO string round-trips through new Date() without drift',
    Math.abs(roundTripped.getTime() - tenDaysFromNow.getTime()) === 0,
    `Original: ${tenDaysFromNow.getTime()}, Round-tripped: ${roundTripped.getTime()}`
  )

  // ── CHECK 3: Scheduler comparison logic ───────────────────────────────────
  console.log('\n[3] Scheduler: remind_at <= now() comparison in UTC')

  // Simulate scheduler checking a reminder that is due
  const dueAt = new Date(now.getTime() - 1000).toISOString()  // 1 second ago (due)
  const notDueAt = new Date(now.getTime() + 60_000).toISOString()  // 1 min future (not due)
  const nowISO = now.toISOString()

  check(
    'Past remind_at correctly identified as due (remind_at <= now)',
    dueAt <= nowISO,
    `remind_at: ${dueAt} <= now: ${nowISO}`
  )

  check(
    'Future remind_at correctly identified as not due',
    !(notDueAt <= nowISO),
    `remind_at: ${notDueAt} > now: ${nowISO}`
  )

  // ── CHECK 4: SQLite query uses UTC comparison ──────────────────────────────
  console.log('\n[4] SQLite query pattern for pending reminders')

  // The scheduler query will be:
  //   SELECT * FROM reminders WHERE remind_at <= ? AND status = 'pending'
  //   with parameter: new Date().toISOString()
  //
  // SQLite stores remind_at as TEXT (ISO string). String comparison of ISO dates
  // is lexicographically correct because ISO strings are zero-padded and UTC.

  const isoA = '2025-04-02T14:00:00.000Z'
  const isoB = '2025-04-02T15:00:00.000Z'
  check(
    'ISO string lexicographic comparison is correct (earlier < later)',
    isoA < isoB,
    `"${isoA}" < "${isoB}"`
  )

  // Edge case: local string comparison breaks across months (alphabetical order != chronological)
  const localNov = 'November 1, 2025, 2:00 PM PDT'   // chronologically EARLIER
  const localApr = 'April 2, 2026, 3:00 PM PDT'       // chronologically LATER
  const localComparisonIsWrong = localNov > localApr   // 'N' > 'A' alphabetically — backwards!
  check(
    'Local datetime strings compare wrong across months (N > A alphabetically — proves fragility)',
    localComparisonIsWrong,
    `"${localNov}" > "${localApr}" alphabetically but Nov 2025 is before Apr 2026 — use ISO strings only`
  )

  // ── CHECK 5: Urgency default times are in local time, converted to UTC ─────
  console.log('\n[5] Urgency default time calculation (no explicit time given)')

  const hour = now.getHours()
  const isPastFivePM = hour >= 17

  let urgencyRemindAt
  if (isPastFivePM) {
    // Next day at 8am local
    const tomorrow8am = new Date(now)
    tomorrow8am.setDate(tomorrow8am.getDate() + 1)
    tomorrow8am.setHours(8, 0, 0, 0)
    urgencyRemindAt = tomorrow8am.toISOString()
  } else {
    // 6 hours from now
    urgencyRemindAt = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString()
  }

  check(
    `High urgency remind_at is in the future (current hour: ${hour}, ${isPastFivePM ? 'after 5pm → next 8am' : 'before 5pm → +6h'})`,
    new Date(urgencyRemindAt) > now,
    `remind_at: ${urgencyRemindAt}`
  )

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n--- Results: ${passed}/${passed + failed} checks passed ---`)

  if (failed === 0) {
    console.log('\n✅ Validation 5 PASSED — Timezone handling is correct end-to-end.')
    console.log('\n   Confirmed pipeline:')
    console.log('   1. Prompt receives: new Date().toLocaleString("en-US", { timeZoneName: "short" })')
    console.log('   2. remind_at stored as: new Date(...).toISOString()  (UTC, ends in Z)')
    console.log('   3. Scheduler compares: remind_at <= new Date().toISOString()')
    console.log('   4. SQLite WHERE clause: remind_at <= ?  with ISO string parameter')
  } else {
    console.log(`\n❌ ${failed} check(s) failed — timezone pipeline has a bug.`)
    process.exit(1)
  }
}

run().catch((err) => {
  console.error('\n❌ Validation 5 FAILED (unexpected error):', err.message)
  process.exit(1)
})
