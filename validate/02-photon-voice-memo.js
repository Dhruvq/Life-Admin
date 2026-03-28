/**
 * VALIDATION 2 — Photon SDK Exposes Voice Memo Audio
 *
 * Risk: Photon may surface voice memos as a message type with no accessible audio payload.
 * Pass condition: A voice memo sent in iMessage shows up with an attachment
 *                 whose mimeType includes "audio" and whose path points to a real .m4a file.
 *
 * How to run:
 *   1. Send yourself a voice memo in iMessage (hold mic button in Messages.app)
 *   2. node validate/02-photon-voice-memo.js
 *
 * Run: node validate/02-photon-voice-memo.js
 */

const { IMessageSDK, isAudioAttachment } = require('@photon-ai/imessage-kit')
const fs = require('fs')

async function run() {
  console.log('--- Validation 2: Voice Memo Audio Accessibility ---')

  const sdk = new IMessageSDK()

  // Query recent messages that have attachments
  console.log('\n[1] Querying recent messages with attachments...')
  const result = await sdk.getMessages({ hasAttachments: true, limit: 20 })

  const voiceMemos = result.messages.filter((msg) =>
    msg.attachments.some((a) => isAudioAttachment(a) || a.mimeType?.includes('audio') || a.filename?.endsWith('.m4a'))
  )

  if (voiceMemos.length === 0) {
    console.log('⚠️  No voice memos found in recent messages.')
    console.log('   → Send yourself a voice memo in iMessage, then re-run.')

    // Still watch live for one to arrive
    console.log('\n[2] Watching for incoming voice memo for 30 seconds...')
    await sdk.startWatching({
      onMessage: (msg) => {
        const audioAttachments = msg.attachments.filter(
          (a) => isAudioAttachment(a) || a.mimeType?.includes('audio') || a.filename?.endsWith('.m4a')
        )
        if (audioAttachments.length > 0) {
          checkAudioAttachment(audioAttachments[0])
        }
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 30_000))
    await sdk.close()
    return
  }

  await sdk.close()

  // Check the most recent voice memo
  const latestVoiceMemo = voiceMemos[0]
  const audioAttachment = latestVoiceMemo.attachments.find(
    (a) => isAudioAttachment(a) || a.mimeType?.includes('audio') || a.filename?.endsWith('.m4a')
  )

  checkAudioAttachment(audioAttachment)
}

function checkAudioAttachment(attachment) {
  console.log('\n✅ Found audio attachment:')
  console.log('   filename:', attachment.filename)
  console.log('   mimeType:', attachment.mimeType)
  console.log('   path:', attachment.path)
  console.log('   size (bytes):', attachment.size)

  // Confirm file actually exists at that path
  const exists = fs.existsSync(attachment.path)
  if (exists) {
    const stat = fs.statSync(attachment.path)
    console.log('\n✅ File exists on disk:', stat.size, 'bytes')
    console.log('\n✅ Validation 2 PASSED — Photon exposes voice memo as readable .m4a file path.')
    console.log('   Next step: pass attachment.path to Minimax STT (Validation 3).')
  } else {
    console.error('\n❌ Validation 2 FAILED — attachment.path does not exist on disk:', attachment.path)
    console.error('   Check if the file was downloaded/synced from iCloud.')
    process.exit(1)
  }
}

run().catch((err) => {
  console.error('\n❌ Validation 2 FAILED:', err.message)
  process.exit(1)
})
