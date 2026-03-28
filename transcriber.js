/**
 * transcriber.js — Audio transcription via OpenAI Whisper
 *
 * Pipeline: .caf (iMessage) → ffmpeg → .mp3 → Whisper → transcript string
 *
 * .caf files must be transcoded first — Whisper doesn't accept .caf.
 * All other common formats (.m4a, .mp3, .wav) go straight to Whisper.
 */

require('dotenv').config()

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync } = require('child_process')
const OpenAI = require('openai')

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const TMP_PATH = path.join(os.tmpdir(), '_life-admin-audio.mp3')

/**
 * Transcribe an audio file to text.
 * @param {string} filePath — absolute path to the audio file
 * @returns {Promise<string|null>} transcript string, or null on failure
 */
async function transcribe(filePath) {
  if (!OPENAI_API_KEY) {
    console.error('[transcriber] OPENAI_API_KEY not set')
    return null
  }

  if (!fs.existsSync(filePath)) {
    console.error(`[transcriber] File not found: ${filePath}`)
    return null
  }

  const ext = path.extname(filePath).toLowerCase()
  let audioPath = filePath
  let didTranscode = false

  try {
    // Transcode .caf → .mp3 (Whisper doesn't accept .caf)
    if (ext === '.caf') {
      console.log(`[transcriber] Transcoding .caf → .mp3...`)
      execSync(
        `ffmpeg -y -i "${filePath}" -ar 16000 -ac 1 -b:a 64k "${TMP_PATH}" 2>/dev/null`,
        { stdio: 'pipe' }
      )
      audioPath = TMP_PATH
      didTranscode = true
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY })
    const transcript = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1',
    })

    console.log(`[transcriber] Transcript: "${transcript.text}"`)
    return transcript.text

  } catch (err) {
    console.error(`[transcriber] Failed: ${err.message}`)
    return null

  } finally {
    // Clean up temp file
    if (didTranscode && fs.existsSync(TMP_PATH)) {
      fs.unlinkSync(TMP_PATH)
    }
  }
}

module.exports = { transcribe }
