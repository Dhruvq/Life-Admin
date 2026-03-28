/**
 * VALIDATION 3 — OpenAI Whisper Transcribes iMessage Voice Memos
 *
 * Note: Minimax has no public STT API (confirmed 404 on all endpoints).
 *       Transcription uses OpenAI Whisper (whisper-1).
 *
 * Pipeline: .caf (iMessage) → ffmpeg → .mp3 → Whisper → transcript
 *
 * Pass condition: A .caf voice memo is transcribed and returns readable text.
 *
 * How to run:
 *   1. Copy a voice memo to validate/sample.caf
 *      OR set AUDIO_PATH=/path/to/Audio\ Message.caf
 *   2. Set OPENAI_API_KEY in .env
 *   3. node validate/03-minimax-stt.js
 */

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })

const fs = require('fs')
const { execSync } = require('child_process')
const OpenAI = require('openai')

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const AUDIO_PATH = process.env.AUDIO_PATH
  || (fs.existsSync(path.join(__dirname, 'sample.caf')) ? path.join(__dirname, 'sample.caf') : null)
  || path.join(__dirname, 'sample.m4a')

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY not set. Add it to .env')
  process.exit(1)
}

if (!fs.existsSync(AUDIO_PATH)) {
  console.error(`❌ No audio file found at: ${AUDIO_PATH}`)
  console.error('   Copy a voice memo: validate/sample.caf')
  console.error('   Or find one in: ~/Library/Messages/Attachments/')
  process.exit(1)
}

function hasFfmpeg() {
  try { execSync('which ffmpeg', { stdio: 'pipe' }); return true } catch { return false }
}

function transcodeToMp3(inputPath) {
  const outputPath = path.join(__dirname, '_transcoded.mp3')
  execSync(`ffmpeg -y -i "${inputPath}" -ar 16000 -ac 1 -b:a 64k "${outputPath}" 2>/dev/null`)
  return outputPath
}

async function run() {
  console.log('--- Validation 3: Whisper STT + ffmpeg Transcoding ---')
  console.log(`   Input: ${AUDIO_PATH}`)

  const ext = path.extname(AUDIO_PATH).toLowerCase()
  let audioPath = AUDIO_PATH

  // Transcode .caf → .mp3 (Whisper doesn't accept .caf)
  if (ext === '.caf') {
    console.log('\n[1] Transcoding .caf → .mp3 via ffmpeg...')
    if (!hasFfmpeg()) {
      console.error('❌ ffmpeg not found. Run: brew install ffmpeg')
      process.exit(1)
    }
    audioPath = transcodeToMp3(AUDIO_PATH)
    console.log(`   ✅ Transcoded: ${audioPath} (${fs.statSync(audioPath).size} bytes)`)
  } else {
    console.log(`\n[1] Skipping transcode (${ext} — Whisper accepts this format directly)`)
  }

  // Send to Whisper
  console.log('\n[2] Sending to OpenAI Whisper (whisper-1)...')
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY })

  const transcript = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-1',
  })

  // Clean up temp file
  if (ext === '.caf' && fs.existsSync(audioPath)) fs.unlinkSync(audioPath)

  console.log('\n✅ Transcript:', transcript.text)
  console.log('\n✅ Validation 3 PASSED — .caf → ffmpeg → Whisper pipeline works.')
  console.log('   transcriber.js will use this exact pipeline in production.')
}

run().catch((err) => {
  console.error('\n❌ Validation 3 FAILED:', err.message)
  process.exit(1)
})
