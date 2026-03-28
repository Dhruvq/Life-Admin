/**
 * Run all validations in sequence.
 * Usage: node validate/run-all.js
 *
 * Skips Validation 1 (interactive, requires iMessage) and
 * Validation 2 (requires a voice memo to be pre-sent) unless --interactive flag is set.
 * Skips Validation 3 (requires .m4a file + Minimax API) unless validate/sample.m4a exists.
 * Always runs Validations 4 (requires Minimax API) and 5 (pure logic, no deps).
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const INTERACTIVE = process.argv.includes('--interactive')
const HAS_M4A = fs.existsSync(path.join(__dirname, 'sample.m4a'))
const HAS_API_KEY = !!process.env.MINIMAX_API_KEY || fs.existsSync(path.join(__dirname, '../.env'))

const validations = [
  {
    id: 1,
    name: 'Photon SDK Hello World',
    file: '01-photon-hello-world.js',
    skip: !INTERACTIVE,
    skipReason: 'interactive (sends real iMessage). Run manually: node validate/01-photon-hello-world.js',
  },
  {
    id: 2,
    name: 'Photon Voice Memo Audio',
    file: '02-photon-voice-memo.js',
    skip: !INTERACTIVE,
    skipReason: 'interactive (watches for live voice memo). Run manually: node validate/02-photon-voice-memo.js',
  },
  {
    id: 3,
    name: 'Minimax STT .m4a Support',
    file: '03-minimax-stt.js',
    skip: !HAS_M4A,
    skipReason: 'no validate/sample.m4a found. Copy a voice memo file there and re-run.',
  },
  {
    id: 4,
    name: 'Minimax Classification JSON',
    file: '04-minimax-classification.js',
    skip: false,
  },
  {
    id: 5,
    name: 'Timezone Consistency',
    file: '05-timezone.js',
    skip: false,
  },
]

console.log('═══════════════════════════════════════════════')
console.log(' Life Admin — Pre-Build Risk Checklist Runner  ')
console.log('═══════════════════════════════════════════════\n')

let totalPassed = 0
let totalFailed = 0
let totalSkipped = 0

for (const v of validations) {
  const label = `[${v.id}] ${v.name}`

  if (v.skip) {
    console.log(`⏭  ${label}\n   SKIPPED: ${v.skipReason}\n`)
    totalSkipped++
    continue
  }

  console.log(`▶  ${label}`)
  console.log('─'.repeat(50))

  try {
    execSync(`node ${path.join(__dirname, v.file)}`, {
      stdio: 'inherit',
      env: { ...process.env },
    })
    console.log(`\n✅ PASSED: ${label}\n`)
    totalPassed++
  } catch {
    console.log(`\n❌ FAILED: ${label}\n`)
    totalFailed++
  }
}

console.log('═══════════════════════════════════════════════')
console.log(` Results: ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped`)
console.log('═══════════════════════════════════════════════')

if (totalFailed > 0) {
  console.log('\n⚠️  Fix failures before building core features.')
  process.exit(1)
} else {
  console.log('\n✅ All automated validations passed.')
  if (totalSkipped > 0) {
    console.log(`   Run with --interactive to test the ${totalSkipped} skipped validation(s).`)
  }
}
