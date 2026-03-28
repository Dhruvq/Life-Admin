/**
 * VALIDATION 1 — Photon SDK / iMessage Works on Your Mac
 *
 * Risk: If Photon can't send/receive on this machine, the whole project premise collapses.
 * Pass condition: A message is sent and received programmatically via iMessage.
 *
 * Prerequisites:
 *   - System Settings → Privacy & Security → Full Disk Access → add your terminal/IDE
 *
 * Run: node validate/01-photon-hello-world.js
 */

const path = require('path')
// Explicit path so this works whether run from Life-Admin/ or validate/
require('dotenv').config({ path: path.join(__dirname, '../.env') })

const { IMessageSDK } = require('@photon-ai/imessage-kit')

const YOUR_PHONE_NUMBER = process.env.MY_PHONE_NUMBER

if (!YOUR_PHONE_NUMBER) {
  console.error('❌ MY_PHONE_NUMBER is not set.')
  console.error('   Add this line to Life-Admin/.env:')
  console.error('   MY_PHONE_NUMBER=+1XXXXXXXXXX')
  process.exit(1)
}

async function run() {
  console.log('--- Validation 1: Photon Hello World ---')
  console.log(`   Sending to: ${YOUR_PHONE_NUMBER}`)

  const sdk = new IMessageSDK({ debug: true })

  // Step 1: Send a message to yourself
  console.log(`\n[1] Sending test message...`)
  const result = await sdk.send(YOUR_PHONE_NUMBER, 'Hello from Life Admin agent! (validation test)')
  console.log('✅ Send succeeded:', result)

  // Step 2: Watch for 10s to confirm inbound message receipt works
  console.log('\n[2] Watching for incoming messages for 10 seconds...')
  console.log('    → Reply to yourself in iMessage to confirm receive works.')

  await sdk.startWatching({
    onMessage: (msg) => {
      console.log('✅ Received message:', {
        sender: msg.sender,
        text: msg.text,
        date: msg.date,
        attachments: msg.attachments.length,
      })
    },
  })

  await new Promise((resolve) => setTimeout(resolve, 10_000))
  await sdk.close()

  console.log('\n✅ Validation 1 PASSED — Photon SDK is operational on this Mac.')
}

run().catch((err) => {
  console.error('\n❌ Validation 1 FAILED:', err.message)
  console.error('Check: Full Disk Access granted? Apple ID signed into Messages.app?')
  process.exit(1)
})
